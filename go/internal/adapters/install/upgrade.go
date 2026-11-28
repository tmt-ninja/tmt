package install

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// ErrNoNewerBuild means the selected CI run is no newer than the running build.
var ErrNoNewerBuild = errors.New("no newer Go workflow build")

// ReplaceExecutable applies an approved, newer artifact to the running executable.
func ReplaceExecutable(ctx context.Context, source ports.ReleaseSource, artifact ports.Artifact, currentVersion string) error {
	path, err := os.Executable()
	if err != nil {
		return err
	}
	return replaceExecutable(ctx, source, artifact, currentVersion, path)
}

func replaceExecutable(ctx context.Context, source ports.ReleaseSource, artifact ports.Artifact, currentVersion, path string) error {
	nextRun, err := runNumber(artifact.Version)
	if err != nil {
		return err
	}
	var currentRun int64
	if currentVersion != "0.0.0-go-dev" {
		currentRun, err = runNumber(currentVersion)
		if err != nil {
			return err
		}
	}
	if nextRun <= currentRun {
		return fmt.Errorf("%w: running %s, selected %s", ErrNoNewerBuild, currentVersion, artifact.Version)
	}
	if artifact.OS != runtime.GOOS || artifact.Arch != runtime.GOARCH {
		return fmt.Errorf("artifact %s/%s does not match the running %s", artifact.OS, artifact.Arch, flavor.Binary)
	}
	name := filepath.Base(path)
	if !filepath.IsAbs(path) || (name != flavor.Binary && name != flavor.Binary+"-"+runtime.GOOS+"-"+runtime.GOARCH) {
		return fmt.Errorf("refusing to replace unexpected executable %s", path)
	}
	original, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !original.Mode().IsRegular() || original.Mode().Perm()&0111 == 0 {
		return fmt.Errorf("refusing to replace non-regular executable %s", path)
	}
	binary, err := source.Fetch(ctx, artifact)
	if err != nil {
		return err
	}
	if len(binary) == 0 || fmt.Sprintf("%x", sha256.Sum256(binary)) != artifact.SHA256 {
		return fmt.Errorf("Go artifact SHA256 verification failed")
	}

	stage, err := os.CreateTemp(filepath.Dir(path), "."+flavor.Binary+"-upgrade-")
	if err != nil {
		return err
	}
	defer os.Remove(stage.Name())
	defer stage.Close()
	if _, err := stage.Write(binary); err != nil {
		return err
	}
	if err := stage.Chmod(original.Mode().Perm()); err != nil {
		return err
	}
	if err := stage.Sync(); err != nil {
		return err
	}
	if err := stage.Close(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	current, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !os.SameFile(original, current) {
		return fmt.Errorf("executable changed during upgrade: %s", path)
	}
	return os.Rename(stage.Name(), path)
}

// runNumber parses the format injected by go.yml. The SHA identifies the
// build, while only the workflow run number defines upgrade ordering.
func runNumber(version string) (int64, error) {
	build, ok := strings.CutPrefix(version, "0.0.0-go.")
	number, sha, hasSHA := strings.Cut(build, "+")
	value, parseErr := strconv.ParseInt(number, 10, 64)
	_, hexErr := hex.DecodeString(sha)
	if !ok || !hasSHA || parseErr != nil || value <= 0 || strconv.FormatInt(value, 10) != number || len(sha) != 10 || hexErr != nil {
		return 0, fmt.Errorf("invalid Go workflow build version %q", version)
	}
	return value, nil
}
