package release

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const (
	repository       = "tmt-ninja/tmt"
	runURL           = "https://github.com/" + repository + "/actions/runs/"
	maxManifestBytes = 16 << 10
	maxBinaryBytes   = 64 << 20
)

// Source discovers builds using the user's gh CLI. It retains the last
// verified download so approval and application can use the same bytes.
type Source struct {
	process ports.Process
	ghPath  string
	env     []string

	mu       sync.Mutex
	artifact ports.Artifact
	binary   []byte
}

var _ ports.ReleaseSource = (*Source)(nil)

func New(process ports.Process) (*Source, error) {
	gh, err := exec.LookPath("gh")
	if err != nil {
		return nil, fmt.Errorf("find GitHub CLI (gh): %w", err)
	}
	gh, err = filepath.Abs(gh)
	if err != nil {
		return nil, fmt.Errorf("resolve GitHub CLI path: %w", err)
	}
	env := os.Environ()
	for i, kv := range env {
		if strings.HasPrefix(kv, "GH_PROMPT_DISABLED=") {
			env = append(env[:i], env[i+1:]...)
			break
		}
	}
	return &Source{process: process, ghPath: gh, env: append(env, "GH_PROMPT_DISABLED=1")}, nil
}

func (s *Source) Latest(ctx context.Context, osName, arch string) (ports.Artifact, error) {
	name, err := binaryName(osName, arch)
	if err != nil {
		return ports.Artifact{}, err
	}
	result, err := s.run(ctx, 30*time.Second, "run", "list", "--workflow", "go.yml",
		"--branch", "poc/go", "--status", "success", "--limit", "1", "--json", "databaseId,headSha,number")
	if err != nil {
		return ports.Artifact{}, err
	}
	var runs []struct {
		DatabaseID int64
		HeadSHA    string
		Number     int64
	}
	if err := json.Unmarshal(result, &runs); err != nil {
		return ports.Artifact{}, fmt.Errorf("decode Go workflow run: %w", err)
	}
	if len(runs) == 0 {
		return ports.Artifact{}, errors.New("no successful go.yml run on poc/go")
	}
	run := runs[0]
	if _, err := hex.DecodeString(run.HeadSHA); err != nil || len(run.HeadSHA) != 40 || run.DatabaseID <= 0 || run.Number <= 0 {
		return ports.Artifact{}, errors.New("invalid metadata for the successful Go workflow run")
	}

	binary, manifest, err := s.download(ctx, run.DatabaseID, name)
	if err != nil {
		return ports.Artifact{}, err
	}
	digest, err := checksum(manifest, name)
	if err != nil {
		return ports.Artifact{}, err
	}
	if err := verify(binary, digest); err != nil {
		return ports.Artifact{}, err
	}
	artifact := ports.Artifact{
		Version: fmt.Sprintf("0.0.0-go.%d+%s", run.Number, run.HeadSHA[:10]),
		OS:      osName,
		Arch:    arch,
		URL:     runURL + strconv.FormatInt(run.DatabaseID, 10),
		SHA256:  digest,
	}
	s.mu.Lock()
	s.artifact, s.binary = artifact, binary
	s.mu.Unlock()
	return artifact, nil
}

func (s *Source) Fetch(ctx context.Context, artifact ports.Artifact) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	if s.binary != nil && s.artifact == artifact {
		binary := bytes.Clone(s.binary)
		s.mu.Unlock()
		return binary, nil
	}
	s.mu.Unlock()

	name, err := binaryName(artifact.OS, artifact.Arch)
	if err != nil {
		return nil, err
	}
	idText, ok := strings.CutPrefix(artifact.URL, runURL)
	id, err := strconv.ParseInt(idText, 10, 64)
	if !ok || err != nil || id <= 0 || strconv.FormatInt(id, 10) != idText {
		return nil, errors.New("invalid Go workflow run URL")
	}
	binary, manifest, err := s.download(ctx, id, name)
	if err != nil {
		return nil, err
	}
	digest, err := checksum(manifest, name)
	if err != nil {
		return nil, err
	}
	if digest != artifact.SHA256 {
		return nil, errors.New("Go artifact checksum changed after selection")
	}
	if err := verify(binary, digest); err != nil {
		return nil, err
	}
	return binary, nil
}

func (s *Source) run(ctx context.Context, timeout time.Duration, args ...string) ([]byte, error) {
	result, err := s.process.Run(ctx, ports.ProcessSpec{
		Path:    s.ghPath,
		Args:    append(args, "--repo", repository),
		Env:     s.env,
		Timeout: timeout,
		MaxOut:  32 << 10,
	})
	if err != nil {
		return nil, fmt.Errorf("gh %s %s: %w", args[0], args[1], err)
	}
	if result.ExitCode != 0 || result.Truncated {
		return nil, fmt.Errorf("gh %s %s failed (exit %d): %s", args[0], args[1], result.ExitCode, bytes.TrimSpace(result.Stderr))
	}
	return result.Stdout, nil
}

func (s *Source) download(ctx context.Context, runID int64, name string) ([]byte, []byte, error) {
	dir, err := os.MkdirTemp("", "tmt-go-release-")
	if err != nil {
		return nil, nil, err
	}
	defer os.RemoveAll(dir)
	_, err = s.run(ctx, 2*time.Minute, "run", "download", strconv.FormatInt(runID, 10),
		"--name", "tmt-go", "--dir", dir)
	if err != nil {
		return nil, nil, err
	}
	manifest, err := readArtifactFile(dir, "SHA256SUMS", maxManifestBytes)
	if err != nil {
		return nil, nil, err
	}
	binary, err := readArtifactFile(dir, name, maxBinaryBytes)
	return binary, manifest, err
}

func readArtifactFile(dir, name string, maxSize int64) ([]byte, error) {
	path := filepath.Join(dir, name)
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > maxSize {
		return nil, fmt.Errorf("invalid workflow artifact file %s", name)
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	content, err := io.ReadAll(io.LimitReader(f, maxSize+1))
	if err != nil {
		return nil, err
	}
	if int64(len(content)) > maxSize {
		return nil, fmt.Errorf("workflow artifact file %s exceeds size limit", name)
	}
	return content, nil
}

func binaryName(osName, arch string) (string, error) {
	if (osName != "darwin" && osName != "linux") || (arch != "amd64" && arch != "arm64") {
		return "", fmt.Errorf("no Go workflow build for %s/%s", osName, arch)
	}
	return "tmt-go-" + osName + "-" + arch, nil
}

func checksum(manifest []byte, name string) (string, error) {
	var digest string
	for line := range strings.SplitSeq(string(manifest), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 || strings.TrimPrefix(fields[1], "*") != name {
			continue
		}
		if _, err := hex.DecodeString(fields[0]); err != nil || len(fields[0]) != 2*sha256.Size || digest != "" {
			return "", fmt.Errorf("invalid or duplicate SHA256SUMS entry for %s", name)
		}
		digest = strings.ToLower(fields[0])
	}
	if digest == "" {
		return "", fmt.Errorf("SHA256SUMS has no entry for %s", name)
	}
	return digest, nil
}

func verify(binary []byte, digest string) error {
	if len(binary) == 0 || fmt.Sprintf("%x", sha256.Sum256(binary)) != digest {
		return errors.New("Go artifact SHA256 verification failed")
	}
	return nil
}
