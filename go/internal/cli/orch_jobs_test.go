package cli

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

// Maps the exact show, CLI/API list and no-change assertions from the native
// job_help_preview_exact_message_and_cli_api_reads_are_causal fixture.
func TestOrchJobShowExactBytesAndListMatchesAPI(t *testing.T) {
	dir := t.TempDir()
	t.Setenv(flavor.EnvHome, dir)
	t.Setenv("TZ", "UTC")
	call := func(app application, args ...string) map[string]any {
		t.Helper()
		var stdout, stderr bytes.Buffer
		status := app.run(t.Context(), args, &stdout, &stderr)
		var result map[string]any
		if status != 0 || stderr.Len() != 0 || json.Unmarshal(stdout.Bytes(), &result) != nil {
			t.Fatalf("%v: status=%d stdout=%q stderr=%q", args, status, &stdout, &stderr)
		}
		delete(result, "observedAtMs")
		return result
	}
	cli := systemApplication()
	identity := call(cli, "identity", "create", "Night-1", "--json")
	owner := identity["identity"].(map[string]any)["id"].(string)
	db, err := sql.Open("sqlite", filepath.Join(dir, home.DatabaseName))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	const jobID = "22222222-2222-4222-8222-222222222222"
	const message = "  hello\x00雪\r\n"
	for _, statement := range []struct {
		text string
		args []any
	}{
		{"INSERT INTO orchestration_settings VALUES(1,5,'UTC')", nil},
		{`INSERT INTO orchestration_jobs(id,revision,owner_id,title,message,schedule,pause_by,pause_ms)
			VALUES(?,1,?,'Standup',?,'{"kind":"every","zone":"UTC","seconds":10,"anchorMs":0}', 'manual', 1700000000000)`,
			[]any{jobID, owner, message}},
	} {
		if _, err := db.ExecContext(t.Context(), statement.text, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	cursor := func() uint64 {
		t.Helper()
		var value uint64
		if err := db.QueryRowContext(t.Context(), "SELECT value FROM change_cursor WHERE id=1").Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	before := cursor()
	show := call(cli, "orch", "job", "show", "j1", "--json")
	row := show["job"].(map[string]any)
	if row["jobId"] != jobID || row["definition"].(map[string]any)["message"] != message || row["lastRun"] != nil {
		t.Fatalf("show = %+v", show)
	}
	list := call(cli, "orch", "job", "ls", "--owner", "Night-1", "--json")
	input, err := os.CreateTemp(dir, "api-input")
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	if err := json.NewEncoder(input).Encode(map[string]any{
		"version": 1, "operation": "orchestration.read",
		"input": map[string]any{"view": "jobs", "ownerIdentityId": owner, "limit": 50},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := input.Seek(0, 0); err != nil {
		t.Fatal(err)
	}
	api := systemApplication()
	api.stdin = input
	viaAPI := call(api, "api")
	if !reflect.DeepEqual(list, viaAPI) || cursor() != before {
		t.Fatalf("CLI=%+v API=%+v cursor=%d want=%d", list, viaAPI, cursor(), before)
	}
}
