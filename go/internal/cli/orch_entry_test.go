package cli

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/orchestration"
	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

func TestOrchWhyUsesSharedReport(t *testing.T) {
	t.Setenv(flavor.EnvHome, t.TempDir())
	const request = "req_11111111-1111-4111-8111-111111111111"
	var stdout, stderr bytes.Buffer
	if status := Main([]string{"orch", "why", request, "--limit", "2", "--before", "4", "--json"}, &stdout, &stderr); status != 0 || stderr.Len() != 0 {
		t.Fatalf("exit %d, stdout %q, stderr %q", status, &stdout, &stderr)
	}
	var page orchestration.JournalView
	if err := json.Unmarshal(stdout.Bytes(), &page); err != nil || page.Subject.Kind != "request" ||
		page.Subject.ID != request || page.Items == nil || len(page.Items) != 0 || page.NextBefore != nil ||
		!page.Coverage.LiveProducers {
		t.Fatalf("empty response = %s, %v", &stdout, err)
	}

	stdout.Reset()
	if status := Main([]string{"orch", "why", "job:example"}, &stdout, &stderr); status != 0 || stderr.Len() != 0 ||
		stdout.String() != "hint: No recorded decision. Slice 1 provides the journal; live producers arrive in slices 2–4\n" {
		t.Fatalf("exit %d, stdout %q, stderr %q", status, &stdout, &stderr)
	}
}

// The plan-show assertions mirror the native test's UUID-shaped name collision.
func TestOrchPlanShowSelectsExactNameAndNeverTreatsUUIDAsName(t *testing.T) {
	dir := t.TempDir()
	t.Setenv(flavor.EnvHome, dir)
	root := home.Root{Dir: dir, Database: filepath.Join(dir, home.DatabaseName)}
	store, err := storage.Open(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", root.Database)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	const shift = "22222222-2222-4222-8222-222222222222"
	const missing = "55555555-5555-4555-8555-555555555555"
	for _, plan := range []struct {
		id, name string
		priority int
	}{
		{shift, "Shift", 2},
		{"44444444-4444-4444-8444-444444444444", shift, 3},
		{"33333333-3333-4333-8333-333333333333", missing, 1},
	} {
		if _, err := db.ExecContext(t.Context(), `INSERT INTO orchestration_plans VALUES(?,?,1,?,1,'{"kind":"always"}','{"talkLimit":null}')`, plan.id, plan.name, plan.priority); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(t.Context(), `INSERT INTO orchestration_plan_targets VALUES(?,0,'{"kind":"all"}')`, plan.id); err != nil {
			t.Fatal(err)
		}
	}
	// Plans do not expand the selected member set, even beyond the overview cap.
	if _, err := db.ExecContext(t.Context(), `WITH RECURSIVE member(n) AS (
		SELECT 1 UNION ALL SELECT n+1 FROM member WHERE n<257
	)
	INSERT INTO identities(id,name,canonical_name,created_at,updated_at)
	SELECT printf('77777777-7777-4777-8777-%012d',n), printf('Seat %d',n),
		printf('seat %d',n), '2026-11-28', '2026-11-28' FROM member`); err != nil {
		t.Fatal(err)
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
	for _, selector := range []string{"Shift", shift} {
		var stdout, stderr bytes.Buffer
		status := Main([]string{"orch", "plan", "show", selector, "--json"}, &stdout, &stderr)
		var page orchestration.PlansView
		if err := json.Unmarshal(stdout.Bytes(), &page); status != 0 || stderr.Len() != 0 || err != nil ||
			len(page.Plans) != 1 || page.Plans[0].Name != "Shift" || page.Plans[0].ID != shift {
			t.Fatalf("select %q: exit %d, stdout %q, stderr %q", selector, status, &stdout, &stderr)
		}
		if value, present := page.Plans[0].Fields["talkLimit"]; !present || value != nil || page.Plans[0].Members == nil {
			t.Fatalf("wire document = %s", &stdout)
		}
	}
	var stdout, stderr bytes.Buffer
	status := Main([]string{"orch", "plan", "show", missing, "--json"}, &stdout, &stderr)
	if status != 3 || stderr.Len() != 0 || !bytes.Contains(stdout.Bytes(), []byte(`"code":"ORCH_PLAN_NOT_FOUND"`)) {
		t.Fatalf("missing UUID: exit %d, stdout %q, stderr %q", status, &stdout, &stderr)
	}
	stdout.Reset()
	status = Main([]string{"orch", "plan", "list", "--json"}, &stdout, &stderr)
	var page orchestration.PlansView
	if err := json.Unmarshal(stdout.Bytes(), &page); status != 0 || stderr.Len() != 0 || err != nil ||
		len(page.Plans) != 3 || page.Plans[0].Priority != 1 || page.Plans[2].Priority != 3 {
		t.Fatalf("list with 257 identities: exit %d, stdout %q, stderr %q", status, &stdout, &stderr)
	}
	if after := cursor(); after != before {
		t.Fatalf("change cursor: before %d, after %d", before, after)
	}
}
