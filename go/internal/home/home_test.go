package home

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func envOf(m map[string]string) Env {
	return func(k string) (string, bool) { v, ok := m[k]; return v, ok }
}

func TestResolveDefaultsUnderUserHome(t *testing.T) {
	user := t.TempDir()
	root, err := Resolve(envOf(nil), user)
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(user, ".local", "share", "tmt-go"); root.Dir != want {
		t.Fatalf("dir %q, want %q", root.Dir, want)
	}
	if filepath.Base(root.Database) != DatabaseName {
		t.Fatalf("database %q", root.Database)
	}
}

func TestResolveIgnoresTMTHome(t *testing.T) {
	user := t.TempDir()
	native := filepath.Join(user, "native")
	root, err := Resolve(envOf(map[string]string{"TMT_HOME": native}), user)
	if err != nil {
		t.Fatal(err)
	}
	if root.Dir == native {
		t.Fatal("TMT_HOME must not select the tmt-go root")
	}
}

func TestGuardRefusesNativeOverlap(t *testing.T) {
	user := t.TempDir()
	xdg := filepath.Join(user, "xdg")
	native := filepath.Join(user, "native")
	cases := map[string]string{
		"default config":   filepath.Join(user, ".config", "tmt"),
		"inside default":   filepath.Join(user, ".config", "tmt", "go"),
		"parent of native": filepath.Join(user, ".config"),
		"xdg root":         filepath.Join(xdg, "tmt"),
		"TMT_HOME root":    native,
	}
	env := map[string]string{"XDG_CONFIG_HOME": xdg, "TMT_HOME": native}
	for name, dir := range cases {
		env[EnvHome] = dir
		if _, err := Resolve(envOf(env), user); !errors.Is(err, ErrNativeRoot) {
			t.Errorf("%s: got %v, want ErrNativeRoot", name, err)
		}
	}
}

func TestGuardRefusesNativeDatabaseFile(t *testing.T) {
	user := t.TempDir()
	dir := filepath.Join(user, "elsewhere")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "tmt.db"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Resolve(envOf(map[string]string{EnvHome: dir}), user); !errors.Is(err, ErrNativeRoot) {
		t.Fatalf("got %v, want ErrNativeRoot", err)
	}
}

func TestCompanionEnvPinsTMTHomeToGoRoot(t *testing.T) {
	root := Root{Dir: filepath.Join(t.TempDir(), "go-root")}
	in := []string{"PATH=/bin", "TMT_HOME=/Users/someone/.config/tmt", "TMT_GO_HOME=/elsewhere", "HOME=/h"}
	got := map[string][]string{}
	for _, kv := range CompanionEnv(in, root) {
		k, v, _ := strings.Cut(kv, "=")
		got[k] = append(got[k], v)
	}
	if len(got["TMT_HOME"]) != 1 || got["TMT_HOME"][0] != root.Dir {
		t.Fatalf("TMT_HOME = %v, want exactly [%s]", got["TMT_HOME"], root.Dir)
	}
	for _, key := range []string{EnvHome, EnvCompanionRoot} {
		if len(got[key]) != 1 || got[key][0] != root.Dir {
			t.Fatalf("%s = %v", key, got[key])
		}
	}
	if got["PATH"][0] != "/bin" || got["HOME"][0] != "/h" {
		t.Fatal("other variables must pass through")
	}
}

func envFromList(list []string) Env {
	m := map[string]string{}
	for _, kv := range list {
		k, v, _ := strings.Cut(kv, "=")
		m[k] = v
	}
	return envOf(m)
}

func TestCompanionCallbackIsAdmitted(t *testing.T) {
	user := t.TempDir()
	root, err := Resolve(envOf(map[string]string{EnvHome: filepath.Join(user, "go")}), user)
	if err != nil {
		t.Fatal(err)
	}
	child := CompanionEnv([]string{"TMT_HOME=" + filepath.Join(user, ".config", "tmt")}, root)
	got, err := Resolve(envFromList(child), user)
	if err != nil {
		t.Fatalf("companion callback refused: %v", err)
	}
	if got.Dir != root.Dir {
		t.Fatalf("callback root %q, want %q", got.Dir, root.Dir)
	}
}

func TestPinnedTMTHomeNeedsTheMarker(t *testing.T) {
	user := t.TempDir()
	dir := filepath.Join(user, "shared")
	// A user who points both variables at one directory without the marker is refused.
	if _, err := Resolve(envOf(map[string]string{"TMT_HOME": dir, EnvHome: dir}), user); !errors.Is(err, ErrNativeRoot) {
		t.Fatalf("got %v, want ErrNativeRoot", err)
	}
	// The marker for another directory does not exempt it either.
	other := map[string]string{"TMT_HOME": dir, EnvHome: dir, EnvCompanionRoot: filepath.Join(user, "else")}
	if _, err := Resolve(envOf(other), user); !errors.Is(err, ErrNativeRoot) {
		t.Fatalf("got %v, want ErrNativeRoot", err)
	}
	// The default native root stays refused even with a matching marker.
	native := filepath.Join(user, ".config", "tmt")
	pinned := map[string]string{"TMT_HOME": native, EnvHome: native, EnvCompanionRoot: native}
	if _, err := Resolve(envOf(pinned), user); !errors.Is(err, ErrNativeRoot) {
		t.Fatalf("got %v, want ErrNativeRoot", err)
	}
}
