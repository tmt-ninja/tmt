// Package home resolves the tmt-go data root and refuses any root that could
// reach the native tmt installation. It is lead-owned: every adapter that
// touches the filesystem receives its paths from a Root, never from the
// environment directly.
package home

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/flavor"
)

// EnvHome selects the data root. The isolated build deliberately ignores
// TMT_HOME (agent shells may export it for the native binary); the
// native-compatible build uses TMT_HOME exactly as native does.
const EnvHome = flavor.EnvHome

// DatabaseName is the store file inside Root.Dir.
const DatabaseName = flavor.DatabaseName

// nativeDatabaseNames are the native store files; their presence marks a native root.
var nativeDatabaseNames = []string{"tmt.db", "tmux-team.db"}

// Root is the resolved, guarded tmt-go data root.
type Root struct {
	Dir      string // absolute data and config directory
	Database string // Dir/tmt-go.db
	Config   string // Dir/config.json
}

// ErrNativeRoot reports a root that overlaps the native installation.
var ErrNativeRoot = errors.New("tmt-go refuses a data root that overlaps the native tmt installation")

// Env is the process environment lookup; tests pass a map-backed function.
type Env func(key string) (string, bool)

// Resolve picks EnvHome, else the flavor's default root, and applies Guard.
// The native-compatible build follows native: TMT_HOME, else
// $XDG_CONFIG_HOME/tmt, else ~/.config/tmt.
func Resolve(env Env, userHome string) (Root, error) {
	dir, ok := env(EnvHome)
	if !ok || dir == "" {
		if xdg, set := env("XDG_CONFIG_HOME"); flavor.NativeCompatible && set && xdg != "" {
			dir = filepath.Join(xdg, "tmt")
		} else {
			dir = filepath.Join(append([]string{userHome}, flavor.DefaultRoot...)...)
		}
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return Root{}, fmt.Errorf("resolve %s: %w", EnvHome, err)
	}
	root := Root{Dir: abs, Database: filepath.Join(abs, DatabaseName), Config: filepath.Join(abs, "config.json")}
	if err := Guard(root, env, userHome); err != nil {
		return Root{}, err
	}
	return root, nil
}

// NativeRoots lists every directory the native binary may use as its global
// root; a set TMT_HOME is always the last entry.
func NativeRoots(env Env, userHome string) []string {
	roots := []string{filepath.Join(userHome, ".config", "tmt")}
	if v, ok := env("XDG_CONFIG_HOME"); ok && v != "" {
		roots = append(roots, filepath.Join(v, "tmt"))
	}
	if v, ok := env("TMT_HOME"); ok && v != "" {
		roots = append(roots, v)
	}
	return roots
}

// EnvCompanionRoot marks a child environment built by CompanionEnv. Only
// there may TMT_HOME equal the tmt-go root: the companion calls back into
// tmt-go with the TMT_HOME that CompanionEnv pinned.
const EnvCompanionRoot = "TMT_GO_COMPANION_ROOT"

// pinnedByCompanionEnv reports a TMT_HOME that CompanionEnv set: TMT_HOME,
// TMT_GO_HOME and the marker all name dir.
func pinnedByCompanionEnv(env Env, dir string) bool {
	for _, key := range []string{"TMT_HOME", EnvHome, EnvCompanionRoot} {
		v, ok := env(key)
		if !ok || v == "" || clean(v) != dir {
			return false
		}
	}
	return true
}

// Guard refuses a root equal to, inside, or containing a native root, and a
// root that already holds a native database file. A TMT_HOME pinned by
// CompanionEnv is the tmt-go root itself, not a native root.
func Guard(root Root, env Env, userHome string) error {
	if flavor.NativeCompatible {
		return nil // the native-compatible build is the native installation
	}
	dir := clean(root.Dir)
	natives := NativeRoots(env, userHome)
	if pinnedByCompanionEnv(env, dir) {
		natives = natives[:len(natives)-1] // the pinned TMT_HOME entry, always last
	}
	for _, native := range natives {
		n := clean(native)
		if dir == n || within(dir, n) || within(n, dir) {
			return fmt.Errorf("%w: %s overlaps %s", ErrNativeRoot, root.Dir, native)
		}
	}
	for _, name := range nativeDatabaseNames {
		if _, err := os.Lstat(filepath.Join(root.Dir, name)); err == nil {
			return fmt.Errorf("%w: %s holds a native %s", ErrNativeRoot, root.Dir, name)
		}
	}
	return nil
}

// clean returns p made absolute with symlinks resolved through its deepest
// existing ancestor, so a root that does not exist yet still compares
// correctly with one under a symlinked directory (macOS /var -> /private/var).
func clean(p string) string {
	if abs, err := filepath.Abs(p); err == nil {
		p = abs
	}
	p = filepath.Clean(p)
	rest := ""
	for dir := p; ; dir = filepath.Dir(dir) {
		if real, err := filepath.EvalSymlinks(dir); err == nil {
			return filepath.Join(real, rest)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return p
		}
		rest = filepath.Join(filepath.Base(dir), rest)
	}
}

func within(child, parent string) bool {
	rel, err := filepath.Rel(parent, child)
	return err == nil && rel != "." && !strings.HasPrefix(rel, "..")
}

// CompanionEnv returns env for a companion child (tmt-ops, tmt-colab, ...):
// TMT_HOME is always the tmt-go root, never the caller's, so a companion can
// never reach native state; TMT_GO_HOME is pinned too. Every launcher of a
// companion or external tmt-<name> command builds its environment here.
func CompanionEnv(env []string, root Root) []string {
	out := make([]string, 0, len(env)+2)
	for _, kv := range env {
		if strings.HasPrefix(kv, "TMT_HOME=") || strings.HasPrefix(kv, EnvHome+"=") || strings.HasPrefix(kv, EnvCompanionRoot+"=") {
			continue
		}
		out = append(out, kv)
	}
	if flavor.NativeCompatible {
		return append(out, "TMT_HOME="+root.Dir)
	}
	return append(out, "TMT_HOME="+root.Dir, EnvHome+"="+root.Dir, EnvCompanionRoot+"="+root.Dir)
}
