package extcmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/invoke"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

const prefix = "tmt-"

// ValidName recognizes the external command spelling. Core name reservations
// belong to the CLI grammar.
func ValidName(name string) bool {
	if name == "" {
		return false
	}
	for i := range len(name) {
		c := name[i]
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || (i > 0 && c == '-') {
			continue
		}
		return false
	}
	return true
}

// tmt-go and its platform-specific distribution binaries are Core executables.
func isGoBinary(name string) bool {
	return name == "go" || strings.HasPrefix(name, "go-")
}

// Resolve probes the exact filename in PATH order.
func Resolve(name, searchPath string) (string, error) {
	if !ValidName(name) || isGoBinary(name) {
		return "", nil
	}
	path, found := invoke.FindExecutable(prefix+name, searchPath)
	if !found {
		return "", nil
	}
	return absolute(path)
}

// Discover enumerates commands for help, completion and suggestions. It also
// returns reserved spellings so the CLI can report collisions.
func Discover(searchPath string) (map[string]string, error) {
	found := make(map[string]string)
	for dir := range strings.SplitSeq(searchPath, string(os.PathListSeparator)) {
		directory, err := absolute(dir)
		if err != nil {
			return nil, err
		}
		entries, err := os.ReadDir(directory)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			name, ok := strings.CutPrefix(entry.Name(), prefix)
			if !ok || name == "" || !utf8.ValidString(name) || isGoBinary(name) || found[name] != "" {
				continue
			}
			path := appendPath(directory, entry.Name())
			if invoke.IsExecutable(path) {
				found[name] = path
			}
		}
	}
	return found, nil
}

// Execute replaces the current process, leaving the extension in control of
// stdin, stdout, stderr, the terminal and the process exit status.
//
// NOT PORTED (#6938): workspace restore dispatch markers.
func Execute(executable string, args []string, root home.Root) error {
	if !filepath.IsAbs(executable) {
		return fmt.Errorf("extension executable path must be absolute: %q", executable)
	}
	env, err := childEnv(root)
	if err != nil {
		return err
	}
	return sys.Exec(executable, append([]string{executable}, args...), env)
}

// Complete implements optional completion v1. Invalid or unavailable output
// returns nil so the shell can use filename completion.
func Complete(ctx context.Context, process ports.Process, executable string, words []string, root home.Root) []string {
	if !filepath.IsAbs(executable) {
		return nil
	}
	env, err := childEnv(root)
	if err != nil {
		return nil
	}
	result, err := process.Run(ctx, ports.ProcessSpec{
		Path:    executable,
		Args:    append([]string{"__complete", "--"}, words...),
		Env:     env,
		Timeout: time.Second,
		MaxOut:  64 << 10,
	})
	if err != nil || result.ExitCode != 0 || result.Truncated || !utf8.Valid(result.Stdout) {
		return nil
	}
	text := string(result.Stdout)
	if strings.ContainsRune(text, '\x00') {
		return nil
	}
	var candidates []string
	for line := range strings.SplitSeq(text, "\n") {
		if line != "" {
			candidates = append(candidates, line)
		}
	}
	return candidates
}

func childEnv(root home.Root) ([]string, error) {
	if !filepath.IsAbs(root.Dir) {
		return nil, fmt.Errorf("extension dispatch requires a resolved %s home", flavor.Binary)
	}
	core, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("resolve %s executable: %w", flavor.Binary, err)
	}
	if !filepath.IsAbs(core) {
		return nil, fmt.Errorf("%s executable path must be absolute: %q", flavor.Binary, core)
	}
	return invoke.OverlayEnv(home.CompanionEnv(os.Environ(), root), []string{"TMT_EXECUTABLE=" + core}), nil
}

func absolute(path string) (string, error) {
	if filepath.IsAbs(path) {
		return path, nil
	}
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	if path == "" {
		return cwd, nil
	}
	return appendPath(cwd, path), nil
}

// Avoid lexical cleaning through a relative symlink followed by ".." in PATH.
func appendPath(dir, name string) string {
	return strings.TrimSuffix(dir, string(os.PathSeparator)) + string(os.PathSeparator) + name
}
