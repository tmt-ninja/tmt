package invoke

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestInvokingTMTRequiresSuppliedAbsolutePath(t *testing.T) {
	t.Setenv("TMT_EXECUTABLE", "")
	if err := os.Unsetenv("TMT_EXECUTABLE"); err != nil {
		t.Fatal(err)
	}
	if _, err := InvokingTMT(); err == nil || err.Error() != "TMT_EXECUTABLE is required" {
		t.Fatalf("InvokingTMT with absent path returned %v", err)
	}
	t.Setenv("TMT_EXECUTABLE", "./tmt-go")
	if _, err := InvokingTMT(); err == nil || err.Error() != "TMT_EXECUTABLE must be absolute" {
		t.Fatalf("InvokingTMT with relative path returned %v", err)
	}
	raw := t.TempDir() + "/../file that need not exist"
	t.Setenv("TMT_EXECUTABLE", raw)
	if got, err := InvokingTMT(); err != nil || got != raw {
		t.Fatalf("InvokingTMT = %q, %v", got, err)
	}
}

func TestFindExecutableUsesSuppliedSearchOrder(t *testing.T) {
	first, second, third := t.TempDir(), t.TempDir(), t.TempDir()
	name := "child program"
	if err := os.WriteFile(filepath.Join(first, name), nil, 0600); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{second, third} {
		if err := os.WriteFile(filepath.Join(dir, name), nil, 0700); err != nil {
			t.Fatal(err)
		}
	}
	searchPath := first + ":" + second + ":" + third
	if got, ok := FindExecutable(name, searchPath); !ok || got != filepath.Join(second, name) {
		t.Fatalf("FindExecutable = %q, %v", got, ok)
	}
	t.Chdir(second)
	if got, ok := FindExecutable(name, first+":"); !ok || got != name {
		t.Fatalf("FindExecutable with empty PATH component = %q, %v", got, ok)
	}
}

func TestOverlayEnvLeavesBaseUntouched(t *testing.T) {
	base := []string{"A=parent", "B=kept"}
	want := []string{"A=second=child", "B=kept", "C="}
	got := OverlayEnv(base, []string{"A=first", "A=second=child", "C="})
	if !slices.Equal(got, want) || !slices.Equal(base, []string{"A=parent", "B=kept"}) {
		t.Fatalf("OverlayEnv = %v, base = %v", got, base)
	}
}
