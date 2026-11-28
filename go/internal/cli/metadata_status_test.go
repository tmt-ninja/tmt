package cli

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestIdentityMetadataAndStatusThroughCLI(t *testing.T) {
	world := t.TempDir()
	t.Setenv("HOME", world)
	t.Setenv(home.EnvHome, filepath.Join(world, "data"))
	root, err := home.Resolve(os.LookupEnv, world)
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	run := func(want int, input string, args ...string) map[string]any {
		t.Helper()
		app := application{store: store}
		if input != "" {
			reader, writer, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			defer reader.Close()
			_, err = io.WriteString(writer, input)
			closeErr := writer.Close()
			if err != nil || closeErr != nil {
				t.Fatalf("pipe: %v, %v", err, closeErr)
			}
			app.stdin = reader
		}
		var stdout, stderr bytes.Buffer
		if status := app.run(t.Context(), append(args, "--json"), &stdout, &stderr); status != want || stderr.Len() != 0 {
			t.Fatalf("%q: exit %d, stdout %q, stderr %q", args, status, &stdout, &stderr)
		}
		var doc map[string]any
		if err := json.Unmarshal(stdout.Bytes(), &doc); err != nil {
			t.Fatalf("%q: %v", &stdout, err)
		}
		return doc
	}
	id := run(0, "", "identity", "create", "Worker")["identity"].(map[string]any)["id"].(string)
	run(0, "", "identity", "create", "Other")
	run(0, "", "identity", "meta", "set", "team", "infra", "--identity", id)
	run(0, "", "identity", "meta", "set", "team", "infra", "--identity", "Other")
	run(0, "", "identity", "meta", "set", "queue", "1", "--identity", id)
	if listed := run(0, "", "identity", "ls", "--where", "team=infra", "--has", "queue")["identities"].([]any); len(listed) != 1 || listed[0].(map[string]any)["id"] != id {
		t.Fatalf("conjunctive selection: %v", listed)
	}
	if listed := run(0, "", "identity", "ls", "--where", "team=infra", "--where", "team=ops")["identities"].([]any); len(listed) != 0 {
		t.Fatalf("repeated filters were collapsed: %v", listed)
	}
	batch := `[
		{"key":"team","expect":{"value":"infra"},"then":{"set":"platform"}},
		{"key":"queue","expect":"absent","then":"remove"},
		{"key":"missing","expect":{"value":"x"},"then":{"set":"yes"}}
	]`
	bad := run(5, batch, "identity", "meta", "apply", "--identity", id)["error"].(map[string]any)
	current := bad["current"].(map[string]any)
	missing, ok := current["missing"]
	if bad["code"] != "METADATA_CONFLICT" || len(current) != 2 || current["queue"] != "1" || !ok || missing != nil {
		t.Fatalf("conditional conflict: %v", bad)
	}
	if got := run(0, "", "identity", "meta", "get", "team", "--identity", id)["value"]; got != "infra" {
		t.Fatalf("conflicting batch wrote a change: %v", got)
	}
	batch = `[
		{"key":"team","expect":{"value":"infra"},"then":{"set":"platform"}},
		{"key":"queue","expect":{"value":"1"},"then":"remove"}
	]`
	if got := run(0, batch, "identity", "meta", "apply", "--identity", id)["changed"]; got != true {
		t.Fatalf("apply: %v", got)
	}
	meta := run(0, "", "identity", "meta", "ls", "--identity", id)["metadata"].(map[string]any)
	if len(meta) != 1 || meta["team"] != "platform" {
		t.Fatalf("metadata after apply: %v", meta)
	}
	if removed := run(0, "", "identity", "meta", "rm", "queue", "--identity", id)["removed"]; removed != false {
		t.Fatalf("absent metadata removal: %v", removed)
	}

	status := run(0, "", "identity", "status", "set", "Reviewing", "--identity", id, "--mood", "ready", "--for", "1.5s")["status"].(map[string]any)
	if status["activity"] != "Reviewing" || status["mood"] != "ready" ||
		status["expiresAtMs"].(float64)-status["updatedAtMs"].(float64) != 1_500 {
		t.Fatalf("set status: %v", status)
	}
	if got := run(1, "", "identity", "status", "set", strings.Repeat("é", 81), "--identity", id)["error"].(map[string]any)["code"]; got != "IDENTITY_STATUS_INVALID" {
		t.Fatalf("invalid status error: %v", got)
	}
	now := uint64(wallClock{}.NowMs())
	if err := store.Write(t.Context(), func(tx ports.StoreTx) error {
		stale, err := core.NewIdentityStatus("Past", nil, now-20_000, 1000)
		if err != nil {
			return err
		}
		return tx.Identities().PutStatus(core.IdentityID(id), stale)
	}); err != nil {
		t.Fatal(err)
	}
	status = run(0, "", "identity", "status", "show", "--identity", id)["status"].(map[string]any)
	if status["stale"] != true || status["activity"] != "Past" || status["mood"] != nil {
		t.Fatalf("stale status: %v", status)
	}
	if removed := run(0, "", "identity", "status", "clear", "--identity", id)["removed"]; removed != true {
		t.Fatalf("clear: %v", removed)
	}
	if status := run(0, "", "identity", "status", "show", "--identity", id)["status"]; status != nil {
		t.Fatalf("cleared status: %v", status)
	}
	run(0, "", "rm", "Worker", "--force")
	run(0, "", "identity", "create", id)
	if got := run(5, "", "identity", "show", id, "--expect-name", "Worker")["error"].(map[string]any)["code"]; got != "IDENTITY_CHANGED" {
		t.Fatalf("retired UUID error: %v", got)
	}
	run(3, batch, "identity", "meta", "apply", "--identity", id)
}
