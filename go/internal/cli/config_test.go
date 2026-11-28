package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/flavor"
)

func TestConfigSettingsThroughCLI(t *testing.T) {
	user := t.TempDir()
	t.Setenv("HOME", user)
	t.Setenv(flavor.EnvHome, filepath.Join(user, "go"))
	workspace := filepath.Join(user, "workspace")
	if err := os.Mkdir(workspace, 0700); err != nil {
		t.Fatal(err)
	}
	t.Chdir(workspace)

	run := func(wantStatus int, args ...string) map[string]any {
		t.Helper()
		var stdout, stderr bytes.Buffer
		args = append(args, "--json")
		if status := (application{}).run(context.Background(), args, &stdout, &stderr); status != wantStatus || stderr.Len() != 0 {
			t.Fatalf("%v: exit %d, stdout %q, stderr %q", args, status, &stdout, &stderr)
		}
		var value map[string]any
		if err := json.Unmarshal(stdout.Bytes(), &value); err != nil {
			t.Fatalf("%v: %v, stdout %q", args, err, &stdout)
		}
		return value
	}
	localPath := filepath.Join(workspace, flavor.WorkspaceFile)
	run(0, "config", "rm", "preambleEvery")
	if _, err := os.Stat(localPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("clearing an absent key created a file: %v", err)
	}
	if err := os.WriteFile(localPath, []byte(`{"agent": {"command": "fixture"}, "$config":{"mode":"obsolete"}}`), 0600); err != nil {
		t.Fatal(err)
	}
	run(0, "config", "set", "preambleEvery", "7", "--global")
	run(0, "config", "set", "preambleEvery", "11")
	run(0, "config", "set", "theme.base", "mono", "--global")
	invalid := run(1, "config", "set", "preambleEvery", "-1")
	if message := invalid["error"].(map[string]any)["message"]; !strings.Contains(message.(string), "Must be a non-negative integer") {
		t.Fatalf("negative value: %v", invalid)
	}
	run(1, "config", "set", "notes.compactionReminder", "false")
	run(1, "config", "set", "--global", "theme.base", "auto")

	show := run(0, "config")
	values := show["resolved"].(map[string]any)
	sources := show["sources"].(map[string]any)
	if sources["preambleEvery"] != "local" || values["preambleEvery"] != 11.0 || values["theme"].(map[string]any)["base"] != "mono" {
		t.Fatalf("show: %v", show)
	}
	run(0, "config", "clear", "mode")
	run(0, "config", "rm")
	show = run(0, "config", "show")
	values, sources = show["resolved"].(map[string]any), show["sources"].(map[string]any)
	if sources["preambleEvery"] != "global" || values["preambleEvery"] != 7.0 {
		t.Fatalf("show after clear: %v", show)
	}
	local, err := os.ReadFile(localPath)
	if err != nil || !bytes.Contains(local, []byte(`"fixture"`)) || bytes.Contains(local, []byte(`"$config"`)) {
		t.Fatalf("cleared workspace: %q, error %v", local, err)
	}
}
