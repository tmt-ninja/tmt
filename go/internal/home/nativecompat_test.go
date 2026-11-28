//go:build nativecompat

package home

import (
	"path/filepath"
	"testing"
)

func TestNativeCompatibleResolvesLikeNative(t *testing.T) {
	user := t.TempDir()
	cases := []struct {
		name string
		env  map[string]string
		want string
	}{
		{"default", nil, filepath.Join(user, ".config", "tmt")},
		{"xdg", map[string]string{"XDG_CONFIG_HOME": filepath.Join(user, "x")}, filepath.Join(user, "x", "tmt")},
		{"TMT_HOME wins", map[string]string{"XDG_CONFIG_HOME": filepath.Join(user, "x"), "TMT_HOME": filepath.Join(user, "h")}, filepath.Join(user, "h")},
	}
	for _, c := range cases {
		root, err := Resolve(envOf(c.env), user)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if root.Dir != c.want || filepath.Base(root.Database) != "tmt.db" {
			t.Errorf("%s: got %s %s, want %s/tmt.db", c.name, root.Dir, root.Database, c.want)
		}
	}
	env := CompanionEnv([]string{"TMT_HOME=/elsewhere", "PATH=/bin"}, Root{Dir: "/r"})
	if len(env) != 2 || env[1] != "TMT_HOME=/r" {
		t.Fatalf("companion env %v", env)
	}
}

func envOf(m map[string]string) Env {
	return func(k string) (string, bool) { v, ok := m[k]; return v, ok }
}
