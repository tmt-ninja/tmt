//go:build darwin || linux

package codex

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"unicode/utf8"

	"github.com/pelletier/go-toml/v2"
)

// FolderTrustAdvisory is informational. The provider still resolves effective
// trust and owns any prompt.
func FolderTrustAdvisory(cwd string) string {
	paths, err := currentProviderPaths()
	if err != nil {
		return ""
	}
	return folderTrustAdvisory(paths.home, cwd)
}

type trust uint8

const (
	trustUnknown trust = iota
	trustUnset
	trustUntrusted
	trustTrusted
)

func folderTrustAdvisory(home, cwd string) string {
	switch localProjectTrust(home, cwd) {
	case trustUnset, trustUntrusted:
		return "Codex may ask you to trust this folder in its own window."
	default:
		return ""
	}
}

func localProjectTrust(home, cwd string) trust {
	if !filepath.IsAbs(cwd) || !utf8.ValidString(cwd) {
		return trustUnknown
	}
	info, err := os.Stat(cwd)
	if err != nil || !info.IsDir() {
		return trustUnknown
	}
	canonical, err := filepath.EvalSymlinks(cwd)
	if err != nil || !utf8.ValidString(canonical) {
		return trustUnknown
	}
	data, err := readSettings(home, "config.toml")
	if err != nil {
		return trustUnknown
	}
	var doc map[string]any
	if toml.Unmarshal(data, &doc) != nil {
		return trustUnknown
	}
	projects, ok := doc["projects"].(map[string]any)
	if !ok && doc["projects"] != nil {
		return trustUnknown
	}
	lookup := func(canonical, raw string) (trust, bool) {
		for _, path := range []string{canonical, raw} {
			value, present := projects[path]
			if !present {
				continue
			}
			entry, ok := value.(map[string]any)
			if !ok {
				return trustUnknown, true
			}
			switch entry["trust_level"] {
			case nil:
				return trustUnset, true
			case "trusted":
				return trustTrusted, true
			case "untrusted":
				return trustUntrusted, true
			default:
				return trustUnknown, true
			}
		}
		return trustUnset, false
	}
	if state, found := lookup(canonical, cwd); found {
		return state
	}
	root, ok := repositoryRoot(cwd)
	if !ok {
		return trustUnknown
	}
	if root != "" {
		physical, err := filepath.EvalSymlinks(root)
		if err == nil && utf8.ValidString(physical) {
			state, _ := lookup(physical, root)
			return state
		}
	}
	return trustUnset
}

func repositoryRoot(cwd string) (string, bool) {
	for depth := 0; depth < 128; depth++ {
		git := filepath.Join(cwd, ".git")
		info, err := os.Lstat(git)
		switch {
		case err == nil && info.IsDir():
			if _, err := os.Stat(filepath.Join(git, "HEAD")); err == nil {
				return cwd, true
			} else if !errors.Is(err, fs.ErrNotExist) {
				return "", false
			}
		case !errors.Is(err, fs.ErrNotExist):
			// Native defers linked worktrees and separate git directories.
			return "", false
		}
		parent := filepath.Dir(cwd)
		if parent == cwd {
			return "", true
		}
		cwd = parent
	}
	return "", false
}
