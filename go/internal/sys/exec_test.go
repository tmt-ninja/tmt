//go:build darwin || linux

package sys

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestExecReplacesProcess(t *testing.T) {
	const helper = "TMT_GO_EXEC_TEST_HELPER"
	if os.Getenv(helper) == "1" {
		err := Exec("/bin/sh", []string{"fixture-argv-zero", "-c",
			`printf '%s|%s|%s|%s\n' "$$" "$0" "$TMT_GO_EXEC_TEST_VALUE" "$TMT_GO_EXEC_TEST_HELPER"; exit 17`,
		}, []string{"TMT_GO_EXEC_TEST_VALUE=child"})
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	path, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	child := exec.CommandContext(t.Context(), path, "-test.run=^TestExecReplacesProcess$")
	child.Env = []string{helper + "=1"}
	output, err := child.CombinedOutput()
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() != 17 {
		t.Fatalf("replacement exit = %v, output %q", err, output)
	}
	want := fmt.Sprintf("%d|fixture-argv-zero|child|\n", child.Process.Pid)
	if string(output) != want {
		t.Fatalf("replacement output = %q, want %q", output, want)
	}
}

func TestExecReturnsReplacementError(t *testing.T) {
	path := filepath.Join(t.TempDir(), "absent")
	if err := Exec(path, []string{path}, nil); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Exec with absent path returned %v", err)
	}
}
