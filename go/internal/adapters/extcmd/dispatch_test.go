package extcmd

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/invoke"
)

func TestResolveAndDiscoverUsePATHOrder(t *testing.T) {
	first, second := t.TempDir(), t.TempDir()
	want := fixture(t, first, "tmt-example", 0700, "")
	fixture(t, second, "tmt-example", 0700, "")
	fixture(t, first, "tmt-hidden", 0600, "")
	reserved := fixture(t, first, "tmt-__complete", 0700, "")
	searchPath := strings.Join([]string{first, second}, string(os.PathListSeparator))

	got, err := Resolve("example", searchPath)
	if err != nil || got != want {
		t.Fatalf("resolve = %q, %v; want %q", got, err, want)
	}
	for _, name := range []string{"", "hidden", "../example", "-example", "__complete", "Example"} {
		if got, err := Resolve(name, searchPath); got != "" || err != nil {
			t.Fatalf("resolved %q as %q, %v", name, got, err)
		}
	}
	found, err := Discover(searchPath)
	if err != nil || !reflect.DeepEqual(found, map[string]string{"example": want, "__complete": reserved}) {
		t.Fatalf("discover = %v, %v", found, err)
	}
}

func TestCoreGoBinariesAreNotDispatchedOrDiscovered(t *testing.T) {
	dir := t.TempDir()
	names := []string{"go", "go-darwin-arm64", "go-linux-amd64", "go-experimental", "go-"}
	for _, name := range names {
		fixture(t, dir, "tmt-"+name, 0700, "")
		if path, err := Resolve(name, dir); path != "" || err != nil {
			t.Fatalf("resolved Core binary %q as %q, %v", name, path, err)
		}
	}
	want := fixture(t, dir, "tmt-gopher", 0700, "")
	discovered, err := Discover(dir)
	if err != nil || !reflect.DeepEqual(discovered, map[string]string{"gopher": want}) {
		t.Fatalf("discover = %v, %v", discovered, err)
	}
}

func TestResolveKeepsSymlinkParentTraversalInRelativePATH(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "real", "nested")
	if err := os.MkdirAll(nested, 0700); err != nil {
		t.Fatal(err)
	}
	fixture(t, filepath.Join(root, "real"), "tmt-example", 0700, "")
	if err := os.Symlink(nested, filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	t.Chdir(root)
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	got, err := Resolve("example", "link/..")
	want := cwd + "/link/../tmt-example"
	if err != nil || got != want {
		t.Fatalf("resolve = %q, %v; want %q", got, err, want)
	}
}

func TestExecuteCompanionAndCoreCallbackUseOnlyGoHome(t *testing.T) {
	userHome := t.TempDir()
	native := filepath.Join(userHome, ".config", "tmt")
	goHome := filepath.Join(userHome, "go home")
	for _, dir := range []string{native, goHome} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	sentinel := fixture(t, native, "companion-evidence", 0600, "native sentinel")
	bin := t.TempDir()
	fixture(t, bin, "tmt-example", 0700, `#!/bin/sh
set -eu
printf 'pid=%s\n' "$$"
printf 'arg=%s\n' "$@"
IFS= read -r input
printf 'stdin=%s\n' "$input"
printf 'core=%s\n' "$TMT_EXECUTABLE"
printf 'home=%s\n' "$TMT_HOME"
printf 'go-home=%s\n' "$TMT_GO_HOME"
printf 'companion stderr\n' >&2
TMT_GO_EXTCMD_TEST=callback "$TMT_EXECUTABLE" -test.run '^TestCompanionSubprocess$'
printf %s "go companion" > "$TMT_HOME/companion-evidence"
exit 23
`)
	core, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(t.Context(), core, "-test.run", "^TestCompanionSubprocess$")
	cmd.Env = []string{
		"HOME=" + userHome, "TMT_HOME=" + native, "TMT_GO_HOME=" + goHome,
		"PATH=" + bin, "TMT_GO_EXTCMD_TEST=dispatch", "TMT_EXECUTABLE=/inherited/native/tmt",
	}
	cmd.Stdin = strings.NewReader("from caller\n")
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	exit, ok := cmd.Wait().(*exec.ExitError)
	if !ok || exit.ExitCode() != 23 {
		t.Fatalf("exit = %v, out = %q, stderr = %q", exit, out.String(), errOut.String())
	}
	want := fmt.Sprintf("pid=%d\narg=--json\narg=space ; literal\nstdin=from caller\ncore=%s\nhome=%s\ngo-home=%s\ncallback=%s\n",
		cmd.Process.Pid, core, goHome, goHome, goHome)
	if out.String() != want || errOut.String() != "companion stderr\n" {
		t.Fatalf("stdout = %q, stderr = %q; want %q and companion stderr", out.String(), errOut.String(), want)
	}
	for path, expected := range map[string]string{
		sentinel: "native sentinel", filepath.Join(goHome, "companion-evidence"): "go companion",
	} {
		got, err := os.ReadFile(path)
		if err != nil || string(got) != expected {
			t.Fatalf("%s: %q, %v; want %q", path, got, err, expected)
		}
	}
}

// The test executable supplies an invocation entry point and a real callback
// through the same home resolver used by tmt-go.
func TestCompanionSubprocess(t *testing.T) {
	mode := os.Getenv("TMT_GO_EXTCMD_TEST")
	if mode == "" {
		return
	}
	root, err := home.Resolve(os.LookupEnv, os.Getenv("HOME"))
	if err != nil {
		t.Fatal(err)
	}
	switch mode {
	case "dispatch":
		path, err := Resolve("example", os.Getenv("PATH"))
		if err != nil {
			t.Fatal(err)
		}
		t.Fatal(Execute(path, []string{"--json", "space ; literal"}, root))
	case "callback":
		fmt.Printf("callback=%s\n", root.Dir)
		os.Exit(0)
	default:
		t.Fatalf("unexpected subprocess mode %q", mode)
	}
}

func TestCompleteForwardsLiteralWordsAndIsolatesCompanion(t *testing.T) {
	path := fixture(t, t.TempDir(), "tmt-example", 0700, `#!/bin/sh
printf '%s\n' "$@" "$TMT_HOME" "$TMT_GO_HOME" "$TMT_EXECUTABLE"
`)
	root := home.Root{Dir: t.TempDir()}
	t.Setenv("TMT_HOME", "/inherited/native/home")
	t.Setenv("TMT_GO_HOME", "/inherited/go/home")
	t.Setenv("TMT_EXECUTABLE", "/inherited/native/executable")
	core, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	got := Complete(t.Context(), process.Runner{}, path, []string{"space ; literal"}, root)
	want := []string{"__complete", "--", "space ; literal", root.Dir, root.Dir, core}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("completion = %q; want %q", got, want)
	}
	if got, err := invoke.InvokingTMT(); err != nil || got != "/inherited/native/executable" {
		t.Fatalf("parent callback changed: %q, %v", got, err)
	}
	if os.Getenv("TMT_HOME") != "/inherited/native/home" || os.Getenv("TMT_GO_HOME") != "/inherited/go/home" {
		t.Fatal("completion changed the parent home environment")
	}
}

func fixture(t *testing.T, dir, name string, mode os.FileMode, data string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(data), mode); err != nil {
		t.Fatal(err)
	}
	return path
}
