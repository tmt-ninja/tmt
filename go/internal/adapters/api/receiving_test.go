package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/home"
)

func TestReceivingSyncRejectsInvalidInputBeforeOpeningStorage(t *testing.T) {
	root := filepath.Join(t.TempDir(), "absent")
	session := requestSession{root: home.Root{Dir: root, Database: filepath.Join(root, home.DatabaseName)}}
	for _, input := range []string{
		`{"expectedRevision":0,"defaultReceiving":{"mode":"auto"},"members":[]}`,
		`{"expectedRevision":0,"enabled":true,"defaultReceiving":{"mode":"direct","intervalMs":null},"members":[]}`,
		`{"expectedRevision":0,"enabled":true,"defaultReceiving":{"mode":"batch","intervalMs":0},"members":[]}`,
		`{"expectedRevision":0,"enabled":true,"defaultReceiving":{"mode":"urgent"},"members":[]}`,
		`{"expectedRevision":0,"enabled":true,"defaultReceiving":{"mode":"auto"},"members":null}`,
		`{"expectedRevision":0,"enabled":true,"defaultReceiving":{"mode":"auto"},"members":[{"identityId":"00000000-0000-0000-0000-000000000000","receiving":{"mode":"direct"}}]}`,
	} {
		result, err := session.respond([]byte(`{"version":1,"operation":"digest.receiving.sync","input":` + input + `}`))
		if err != nil || result.Status != 1 || !bytes.Contains(result.Body, []byte(`"code":"API_INPUT_INVALID"`)) {
			t.Fatalf("admitted %s: %d %s, %v", input, result.Status, result.Body, err)
		}
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatalf("invalid publication touched storage: %v", err)
	}
}

func TestReceivingSyncCASAndIdenticalPublicationDoesNotAdvanceCursor(t *testing.T) {
	t.Setenv("TZ", "UTC")
	root := t.TempDir()
	dbPath := filepath.Join(root, home.DatabaseName)
	session := requestSession{root: home.Root{Dir: root, Database: dbPath}}
	defer session.close()
	publish := func(revision int) SessionResponse {
		t.Helper()
		result, err := session.respond([]byte(fmt.Sprintf(`{"version":1,"operation":"digest.receiving.sync","input":{"expectedRevision":%d,"enabled":true,"defaultReceiving":{"mode":"batch","intervalMs":1501},"members":[]}}`, revision)))
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	observe := func(response SessionResponse) {
		t.Helper()
		var published receivingPublication
		if response.Status != 0 || json.Unmarshal(response.Body, &published) != nil ||
			published.Revision != 1 || published.Projection.ReceivingRevision != 1 {
			t.Fatalf("publication = %d %s", response.Status, response.Body)
		}
	}
	observe(publish(0))
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cursor := func() uint64 {
		t.Helper()
		var value uint64
		if err := db.QueryRowContext(t.Context(), "SELECT value FROM change_cursor WHERE id=1").Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	before := cursor()
	observe(publish(1))
	stale := publish(0)
	if stale.Status != 1 || !bytes.Contains(stale.Body, []byte(`"code":"ORCH_CONFLICT"`)) || cursor() != before {
		t.Fatalf("stale publication = %d %s; cursor=%d want=%d", stale.Status, stale.Body, cursor(), before)
	}
}
