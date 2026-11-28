package cli

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/flavor"
)

func TestRoleAndPreambleKeepIndependentIdentityContent(t *testing.T) {
	world := t.TempDir()
	t.Setenv("HOME", world)
	t.Setenv(flavor.EnvHome, filepath.Join(world, "go"))
	run := func(want int, args ...string) map[string]any {
		t.Helper()
		var stdout, stderr bytes.Buffer
		app := application{}
		if status := app.run(t.Context(), append(args, "--json"), &stdout, &stderr); status != want || stderr.Len() != 0 {
			t.Fatalf("%q: exit %d, stdout %q, stderr %q", args, status, &stdout, &stderr)
		}
		var doc map[string]any
		if err := json.Unmarshal(stdout.Bytes(), &doc); err != nil {
			t.Fatalf("%q: %v", &stdout, err)
		}
		return doc
	}

	run(0, "identity", "create", "Worker")
	path := filepath.Join(world, "role.md")
	if err := os.WriteFile(path, []byte("\ufeffreview\r\nRust changes"), 0600); err != nil {
		t.Fatal(err)
	}
	role := run(0, "role", "--identity", "Worker", "set", "--file", path)["role"].(map[string]any)
	if role["content"] != "review\nRust changes" || role["updatedAt"] == "" {
		t.Fatalf("role: %v", role)
	}
	preamble := run(0, "preamble", "set", "Worker", "Be", "precise")
	if preamble["preamble"] != "Be precise" || preamble["status"] != "set" {
		t.Fatalf("preamble: %v", preamble)
	}
	rejected := run(1, "role", "set", "  ", "--identity", "Worker")
	if rejected["error"].(map[string]any)["code"] != "ROLE_INPUT_INVALID" {
		t.Fatalf("invalid content: %v", rejected)
	}
	run(0, "identity", "mv", "Worker", "Reviewer")
	role = run(0, "role", "show", "--identity", "Reviewer")["role"].(map[string]any)
	if role["content"] != "review\nRust changes" {
		t.Fatalf("role after rename or rejected write: %v", role)
	}
	rows := run(0, "preamble")["preambles"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["agent"] != "Reviewer" {
		t.Fatalf("preambles after rename: %v", rows)
	}
	if result := run(0, "preamble", "clear", "Reviewer"); result["status"] != "cleared" {
		t.Fatalf("first clear: %v", result)
	}
	if result := run(0, "preamble", "rm", "Reviewer"); result["status"] != "not_set" {
		t.Fatalf("second clear: %v", result)
	}
	if result := run(0, "role", "show", "--identity", "Reviewer"); result["role"] == nil {
		t.Fatalf("clearing preamble also cleared role: %v", result)
	}
	if result := run(0, "role", "rm", "--identity", "Reviewer"); result["role"] != nil {
		t.Fatalf("role after clear: %v", result)
	}
}
