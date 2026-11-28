package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestCompletionInspectsStartupWithoutChangingIt(t *testing.T) {
	world := t.TempDir()
	t.Setenv("HOME", world)
	t.Setenv("TMT_GO_HOME", filepath.Join(world, "go"))
	t.Setenv("ZDOTDIR", world)
	t.Setenv("SHELL", "/bin/zsh")
	path := filepath.Join(world, ".zshrc")
	setup := "source <(tmt-go __completion-script zsh)\ncommand compinit\ntmt-go __completion-script bash\n"
	if err := os.WriteFile(path, []byte(setup), 0600); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	if status := (application{}).run(context.Background(), []string{"completion", "--json"}, &stdout, &stderr); status != 0 || stderr.Len() != 0 {
		t.Fatalf("completion status %d: %q, %q", status, &stdout, &stderr)
	}
	var report completionReport
	if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if !report.Installed || report.File != path || report.Line != completionSetupLine("zsh") ||
		report.Detected == nil || *report.Detected != "zsh" || !slices.Equal(report.Warnings, []string{
		"Line 1 precedes any recognized compinit call; place completion after compinit.",
		"Line 3 mentions completion but is not a recognized setup line for this shell; inspect it manually.",
		"Multiple completion lines found; remove duplicates manually.",
	}) {
		t.Fatalf("completion report: %+v", report)
	}
	if actual, err := os.ReadFile(path); err != nil || string(actual) != setup {
		t.Fatalf("startup changed: %q, %v", actual, err)
	}
	if _, err := os.Stat(filepath.Join(world, "go")); !os.IsNotExist(err) {
		t.Fatalf("completion created data: %v", err)
	}
}

func TestCompletionEmitsLiteralCandidatesAndRunnableSetup(t *testing.T) {
	for _, tt := range []struct {
		args []string
		want string
	}{
		{[]string{"__complete", "--", "iden"}, "identity\n"},
		{[]string{"__complete", "--", "identity", "sta"}, "status\n"},
		{[]string{"__complete", "--", "talk", "--de"}, "--delay\n--detach\n"},
		{[]string{"__complete", "--", "run", "worker", "--j"}, ""},
	} {
		var stdout, stderr bytes.Buffer
		if status := (application{}).run(t.Context(), tt.args, &stdout, &stderr); status != 0 ||
			stderr.Len() != 0 || stdout.String() != tt.want {
			t.Fatalf("%q exit %d: %q, %q", tt.args, status, &stdout, &stderr)
		}
	}
	for _, shell := range completionShells {
		var stdout, stderr bytes.Buffer
		if status := (application{}).run(t.Context(), []string{"__completion-script", shell}, &stdout, &stderr); status != 0 ||
			stderr.Len() != 0 || !strings.Contains(stdout.String(), "tmt-go __complete --") {
			t.Fatalf("%s script exit %d: %q, %q", shell, status, &stdout, &stderr)
		}
	}
}
