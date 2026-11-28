package invoke

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// InvokingTMT returns the supplied executable path without probing the file.
func InvokingTMT() (string, error) {
	path, found := os.LookupEnv("TMT_EXECUTABLE")
	if !found {
		return "", errors.New("TMT_EXECUTABLE is required")
	}
	if !filepath.IsAbs(path) {
		return "", errors.New("TMT_EXECUTABLE must be absolute")
	}
	return path, nil
}

// FindExecutable searches the supplied PATH in order, including empty entries
// for the current directory. The returned path may be relative.
func FindExecutable(name, searchPath string) (string, bool) {
	if name == "" {
		return "", false
	}
	if filepath.IsAbs(name) {
		return name, IsExecutable(name)
	}
	for _, dir := range strings.Split(searchPath, string(os.PathListSeparator)) {
		candidate := name
		if dir != "" {
			// Joining must preserve symlink/.. traversal and a leading ./.
			candidate = dir + string(os.PathSeparator) + name
		}
		if IsExecutable(candidate) {
			return candidate, true
		}
	}
	return "", false
}

func IsExecutable(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0111 != 0
}

// OverlayEnv replaces variables in a child environment without changing the
// base slice or the parent process. A last occurrence wins.
func OverlayEnv(base, values []string) []string {
	env := make([]string, 0, len(base)+len(values))
	index := make(map[string]int, cap(env))
	for _, entries := range [][]string{base, values} {
		for _, entry := range entries {
			key, _, _ := strings.Cut(entry, "=")
			if i, found := index[key]; found {
				env[i] = entry
				continue
			}
			index[key] = len(env)
			env = append(env, entry)
		}
	}
	return env
}
