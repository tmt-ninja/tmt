package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/orchestration"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

const whyIdentity = "11111111-1111-4111-8111-111111111111"

func orchRequest(fields string) []byte {
	return []byte(`{"version":1,"operation":"orchestration.read","input":` + fields + `}`)
}

func TestOrchestrationRejectsInvalidQueriesBeforeOpeningStorage(t *testing.T) {
	const subject = `"subject":{"kind":"identity","id":"` + whyIdentity + `"}`
	dir := filepath.Join(t.TempDir(), "absent")
	session := requestSession{root: home.Root{Dir: dir, Database: filepath.Join(dir, home.DatabaseName)}}
	for i, input := range []string{
		`{"view":"why"}`,
		`{"view":"plans","plan":" "}`,
		`{"view":"plans","plan":1}`,
		`{"view":"plans","plan":"Quiet","plan":"Shift"}`,
		`{"view":"plans","rangeDays":1}`,
		`{"view":"overview","rangeDays":2}`,
		`{"view":"overview","atMs":0}`,
		`{"view":"overview","memberQuery":" "}`,
		`{"view":"preview"}`,
		`{"view":"preview","candidate":{"id":"a","id":"b"}}`,
		`{"view":"overview","candidate":null}`,
		`{"view":` + strings.Repeat(" ", 36_865) + `"plans"}`,
		`{"view":"why","subject":{"kind":"request","id":"` + whyIdentity + `"}}`,
		`{"view":"why","subject":{"kind":"identity","kind":"identity","id":"` + whyIdentity + `"}}`,
		`{"view":"why","subject":{"kind":"identity","id":"` + whyIdentity + `","name":"name"}}`,
		`{"view":"why",` + subject + `,"before":0}`,
		`{"view":"why",` + subject + `,"before":9007199254740992}`,
		`{"view":"why",` + subject + `,"limit":0}`,
		`{"view":"why",` + subject + `,"limit":101}`,
		`{"view":"why",` + subject + `,"rangeDays":1}`,
	} {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			result, err := session.respond(orchRequest(input))
			var body struct{ Error Fault }
			if err != nil || result.Status != 1 || json.Unmarshal(result.Body, &body) != nil || body.Error.Code != "API_INPUT_INVALID" {
				t.Fatalf("result = %d %s, %v", result.Status, result.Body, err)
			}
		})
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("invalid query touched storage: %v", err)
	}
}

// Mirrors the native Why journal ordering, uncertainty and read-only cursor assertions.
func TestWhyReadsTransactionalEventsAndPreservesUncertainty(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, home.DatabaseName)
	session := requestSession{root: home.Root{Dir: dir, Database: dbPath}}
	t.Cleanup(func() {
		if err := session.close(); err != nil {
			t.Error(err)
		}
	})
	const subject = `"subject":{"kind":"identity","id":"` + whyIdentity + `"}`
	read := func(fields string) orchestration.JournalView {
		t.Helper()
		result, err := session.respond(orchRequest(`{"view":"why",` + subject + fields + `}`))
		var page orchestration.JournalView
		if err != nil || result.Status != 0 || json.Unmarshal(result.Body, &page) != nil {
			t.Fatalf("result = %d %s, %v", result.Status, result.Body, err)
		}
		return page
	}
	empty := read("")
	if empty.SchemaVersion != 1 || empty.Subject.ID != whyIdentity || empty.Items == nil || len(empty.Items) != 0 || empty.NextBefore != nil ||
		!empty.Coverage.LiveProducers || empty.Coverage.HistoryComplete ||
		!reflect.DeepEqual(empty.Coverage.Producers, []string{"digest_claim", "digest_settlement"}) {
		t.Fatalf("empty page = %+v", empty)
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UnixMilli()
	tx, err := db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	for _, pair := range [][2]string{{"block", "held"}, {"delay", "held"}, {"send", "uncertain"}, {"jobRun", "completed"}} {
		_, err := tx.ExecContext(t.Context(), `INSERT INTO orchestration_decisions
			(recorded_ms,expires_ms,subject_kind,subject_id,recipient_id,action,outcome,reason,configuration_revision,time_zone,sources)
			VALUES(?,?,'identity',?,?,?,?,'fixture_transition',4,'Asia/Tokyo','[]')`,
			now, now+60_000, whyIdentity, whyIdentity, pair[0], pair[1])
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
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
	first := read(`,"limit":2`)
	if len(first.Items) != 2 || first.Items[0].Action != "jobRun" || first.Items[1].Outcome != "uncertain" ||
		first.NextBefore == nil || *first.NextBefore != first.Items[1].ID {
		t.Fatalf("first page = %+v", first)
	}
	second := read(fmt.Sprintf(`,"before":%d`, *first.NextBefore))
	if len(second.Items) != 2 || second.Items[0].Action != "delay" || second.Items[1].Action != "block" || second.NextBefore != nil {
		t.Fatalf("second page = %+v", second)
	}
	entry := second.Items[0]
	if entry.ActorID != nil || entry.RecipientID == nil || string(*entry.RecipientID) != whyIdentity ||
		entry.Subject != empty.Subject || entry.Sources == nil || len(entry.Sources) != 0 ||
		entry.Reason != "fixture_transition" || entry.ConfigurationRevision != 4 || entry.TimeZone != "Asia/Tokyo" ||
		entry.RecordedAtMs != uint64(now) || second.ObservedAtMs-second.Coverage.RetainedAfterMs != second.Coverage.RetentionMs ||
		cursor() != before {
		t.Fatalf("journal evidence = %+v, coverage = %+v", entry, second.Coverage)
	}
}

func TestPlansAPIUsesNativeScheduleFields(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, home.DatabaseName)
	session := requestSession{root: home.Root{Dir: dir, Database: dbPath}}
	if fault := session.open(t.Context()); fault != nil {
		t.Fatal(fault)
	}
	defer session.close()
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if _, err := db.ExecContext(t.Context(), `INSERT INTO orchestration_plans VALUES
		('11111111-1111-4111-8111-111111111111','Quiet',1,1,1,
		'{"kind":"daily","start":"08:00","end":"14:00","allDay":false}','{"receiving":{"mode":"direct"}}');
		INSERT INTO orchestration_plan_targets VALUES
		('11111111-1111-4111-8111-111111111111',0,'{"kind":"all"}');`); err != nil {
		t.Fatal(err)
	}
	result, err := session.respond(orchRequest(`{"view":"plans","plan":"Quiet"}`))
	var body struct {
		Plans []struct {
			Schedule map[string]any
			Fields   map[string]any
		}
	}
	if err != nil || result.Status != 0 || json.Unmarshal(result.Body, &body) != nil || len(body.Plans) != 1 {
		t.Fatalf("plans response = %d %s, %v", result.Status, result.Body, err)
	}
	var want map[string]any
	if err := json.Unmarshal([]byte(`{"kind":"weekly","anchorDate":"1969-12-29","intervalWeeks":1,"weekdays":[1,2,3,4,5,6,7],"start":"08:00","end":"14:00","allDay":false}`), &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(body.Plans[0].Schedule, want) ||
		!reflect.DeepEqual(body.Plans[0].Fields["receiving"], map[string]any{"mode": "direct"}) {
		t.Fatalf("native schedule fields = %s", result.Body)
	}
}
