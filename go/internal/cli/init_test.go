package cli

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestInitCreatesOnlyWorkspaceConfigAndPreservesExistingFiles(t *testing.T) {
	world := t.TempDir()
	data := filepath.Join(world, "data")
	t.Setenv("HOME", world)
	t.Setenv("TMT_GO_HOME", data)
	workspace := filepath.Join(world, "workspace")
	nested := filepath.Join(workspace, "nested")
	if err := os.MkdirAll(nested, 0700); err != nil {
		t.Fatal(err)
	}
	t.Chdir(workspace)
	path := filepath.Join(workspace, "tmt-go.json")
	run := func(want int, json bool) string {
		t.Helper()
		args := []string{"init"}
		if json {
			args = append(args, "--json")
		}
		var stdout, stderr bytes.Buffer
		if status := (application{}).run(context.Background(), args, &stdout, &stderr); status != want || json && stderr.Len() != 0 {
			t.Fatalf("init exit %d: stdout %q, stderr %q", status, &stdout, &stderr)
		}
		return stdout.String()
	}
	if got := run(0, false); got != "✓ Created "+path+"\n" {
		t.Fatalf("init: %q", got)
	}
	body, err := os.ReadFile(path)
	if err != nil || string(body) != "{}\n" {
		t.Fatalf("workspace: %q, %v", body, err)
	}
	if _, err := os.Stat(data); !os.IsNotExist(err) {
		t.Fatalf("init touched state: %v", err)
	}
	if err := os.WriteFile(path, []byte("leave me"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Chdir(nested)
	if got := run(1, true); !bytes.Contains([]byte(got), []byte(path+" already exists")) {
		t.Fatalf("reinitialize: %q", got)
	}
	body, err = os.ReadFile(path)
	if err != nil || string(body) != "leave me" {
		t.Fatalf("workspace changed: %q, %v", body, err)
	}
	if _, err := os.Stat(filepath.Join(nested, "tmt-go.json")); !os.IsNotExist(err) {
		t.Fatalf("init created a second file: %v", err)
	}
}
