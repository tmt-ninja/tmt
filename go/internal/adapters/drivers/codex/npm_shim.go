package codex

import (
	"bytes"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/invoke"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const npmPackageLimit = 64 * 1024

var errUnprovedNpmLauncher = errors.New("could not verify the selected Codex npm launcher")

// NpmLauncher pins the selected Codex npm package and its executable script.
type NpmLauncher struct {
	selected, script, manifest string
	stamp                      os.FileInfo
	packageBytes               []byte
}

// InspectNpmLauncher pins the selected executable before spawn. A nil
// result permits ordinary direct proof. An invalid shim returns an error
// and grants no fallback runtime admission.
func InspectNpmLauncher(command ports.ProcessSpec) (*NpmLauncher, error) {
	executable := command.Path
	if !filepath.IsAbs(executable) || !invoke.IsExecutable(executable) {
		return nil, nil
	}
	script, err := filepath.EvalSymlinks(executable)
	if err != nil {
		return nil, errUnprovedNpmLauncher
	}
	if filepath.Base(script) != "codex.js" {
		return nil, nil
	}
	bin := filepath.Dir(script)
	if filepath.Base(bin) != "bin" {
		return nil, errUnprovedNpmLauncher
	}
	root := filepath.Dir(bin)
	const manifest = "package.json"
	data, err := readCodexFile(root, manifest, npmPackageLimit)
	if err != nil {
		return nil, errUnprovedNpmLauncher
	}
	var pkg struct {
		Name string         `json:"name"`
		Bin  jsontext.Value `json:"bin"`
	}
	if json.Unmarshal(data, &pkg) != nil || pkg.Name != "@openai/codex" {
		return nil, errUnprovedNpmLauncher
	}
	var target string
	if pkg.Bin.Kind() == '"' {
		if json.Unmarshal(pkg.Bin, &target) != nil {
			return nil, errUnprovedNpmLauncher
		}
	} else {
		var bins map[string]string
		if json.Unmarshal(pkg.Bin, &bins) != nil {
			return nil, errUnprovedNpmLauncher
		}
		target = bins["codex"]
	}
	if target == "" {
		return nil, errUnprovedNpmLauncher
	}
	mapped, err := filepath.EvalSymlinks(resolve(root, target))
	if err != nil || mapped != script {
		return nil, errUnprovedNpmLauncher
	}
	stamp, err := os.Stat(script)
	if err != nil || !stamp.Mode().IsRegular() {
		return nil, errUnprovedNpmLauncher
	}
	return &NpmLauncher{selected: executable, script: script, manifest: filepath.Join(root, manifest),
		stamp: stamp, packageBytes: data}, nil
}

func (s *NpmLauncher) unchanged() bool {
	target, err := filepath.EvalSymlinks(s.selected)
	if err != nil || target != s.script {
		return false
	}
	stamp, err := os.Stat(s.script)
	if err != nil || !stamp.Mode().IsRegular() || !os.SameFile(stamp, s.stamp) ||
		stamp.Size() != s.stamp.Size() || !stamp.ModTime().Equal(s.stamp.ModTime()) {
		return false
	}
	data, err := readCodexFile(filepath.Dir(s.manifest), filepath.Base(s.manifest), npmPackageLimit)
	return err == nil && bytes.Equal(data, s.packageBytes)
}

func (s *NpmLauncher) matchesArguments(text string) bool {
	// ps cannot preserve argument quoting. An ambiguous script pathname
	// therefore does not prove the selected launcher.
	words := strings.Fields(text)
	if len(words) < 2 {
		return false
	}
	switch filepath.Base(words[0]) {
	case "node", "nodejs":
	default:
		return false
	}
	script, err := filepath.EvalSymlinks(words[1])
	return err == nil && script == s.script
}
