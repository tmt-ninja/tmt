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
	if len(got[EnvHome]) != 1 || got[EnvHome][0] != root.Dir {
		t.Fatalf("%s = %v", EnvHome, got[EnvHome])
	}
	if got["PATH"][0] != "/bin" || got["HOME"][0] != "/h" {
		t.Fatal("other variables must pass through")
	}
}
