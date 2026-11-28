package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/orchestration"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

const whyIdentity = "11111111-1111-4111-8111-111111111111"

func whyRequest(fields string) []byte {
	return []byte(`{"version":1,"operation":"orchestration.read","input":` + fields + `}`)
}

func TestWhyRejectsInvalidQueriesBeforeOpeningStorage(t *testing.T) {
	const subject = `"subject":{"kind":"identity","id":"` + whyIdentity + `"}`
	dir := filepath.Join(t.TempDir(), "absent")
	session := requestSession{root: home.Root{Dir: dir, Database: filepath.Join(dir, home.DatabaseName)}}
	for _, input := range []string{
		`{"view":"why"}`,
		`{"view":"why","subject":{"kind":"request","id":"` + whyIdentity + `"}}`,
		`{"view":"why","subject":{"kind":"identity","kind":"identity","id":"` + whyIdentity + `"}}`,
		`{"view":"why","subject":{"kind":"identity","id":"` + whyIdentity + `","name":"name"}}`,
		`{"view":"why",` + subject + `,"before":0}`,
		`{"view":"why",` + subject + `,"before":9007199254740992}`,
		`{"view":"why",` + subject + `,"limit":0}`,
		`{"view":"why",` + subject + `,"limit":101}`,
		`{"view":"why",` + subject + `,"rangeDays":1}`,
	} {
		t.Run(input, func(t *testing.T) {
			result, err := session.respond(whyRequest(input))
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
		result, err := session.respond(whyRequest(`{"view":"why",` + subject + fields + `}`))
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
