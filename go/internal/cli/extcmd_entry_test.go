package cli

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/home"
)

func TestAdapterCommandEntry(t *testing.T) {
	if os.Getenv("TMT_GO_CLI_TEST_ADAPTER") == "1" {
		for i, arg := range os.Args {
			if arg == "--" {
				os.Exit(Main(os.Args[i+1:], os.Stdout, os.Stderr))
			}
		}
		os.Exit(1)
	}
	root := t.TempDir()
	goHome := filepath.Join(root, "go state")
	native := filepath.Join(root, "native state")
	bin := filepath.Join(root, "bin")
	if err := os.Mkdir(bin, 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"fixture", "identity", "list", "api"} {
		body := "#!/bin/sh\nprintf '%s\\n' \"$TMT_HOME\" \"$TMT_GO_HOME\" \"$TMT_GO_COMPANION_ROOT\" \"$TMT_EXECUTABLE\" \"$@\"\nexit 23\n"
		if err := os.WriteFile(filepath.Join(bin, "tmt-"+name), []byte(body), 0700); err != nil {
			t.Fatal(err)
		}
	}
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	call := func(input string, args ...string) ([]byte, string, int) {
		t.Helper()
		cmd := exec.CommandContext(t.Context(), self, append([]string{"-test.run=^TestAdapterCommandEntry$", "--"}, args...)...)
		cmd.Env = []string{"TMT_GO_CLI_TEST_ADAPTER=1", "PATH=" + bin, "HOME=" + root,
			"TMT_HOME=" + native, home.EnvHome + "=" + goHome, "TMT_EXECUTABLE=" + filepath.Join(bin, "wrong")}
		cmd.Stdin = strings.NewReader(input)
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		out, err := cmd.Output()
		code := 0
		if status, ok := err.(*exec.ExitError); ok {
			code = status.ExitCode()
		} else if err != nil {
			t.Fatal(err)
		}
		return out, stderr.String(), code
	}
	out, stderr, code := call("", "fixture", "--json", "space ; literal")
	want := strings.Join([]string{goHome, goHome, goHome, self, "--json", "space ; literal", ""}, "\n")
	if code != 23 || string(out) != want || stderr != "" {
		t.Fatalf("external dispatch = %d, %q, %q; want 23, %q", code, out, stderr, want)
	}
	for _, tc := range []struct{ name, usage string }{{"identity", "identity"}, {"list", "ls"}} {
		out, stderr, code := call("", tc.name, "--help")
		if code != 0 || !bytes.Contains(out, []byte("tmt-go "+tc.usage)) || stderr != "" {
			t.Fatalf("core route %q: %d %q %q", tc.name, code, out, stderr)
		}
	}
	const storageRoot = `{"version":1,"operation":"storage.root","input":{}}`
	for _, session := range []bool{false, true} {
		input, args := storageRoot, []string{"api"}
		if session {
			input += "\n" + storageRoot + "\n"
			args = append(args, "--session")
		}
		out, stderr, code := call(input, args...)
		want := 1
		if session {
			want = 2
		}
		if code != 0 || stderr != "" || bytes.Count(out, []byte(`"dataRoot":`)) != want || !bytes.Contains(out, []byte(goHome)) {
			t.Fatalf("API %v: %d %q %q", args, code, out, stderr)
		}
	}
	if _, err := os.Stat(goHome); !os.IsNotExist(err) {
		t.Fatalf("discovery should leave Go home unopened: %v", err)
	}
}
