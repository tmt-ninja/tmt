package api

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

func TestUsageHistoryAdmissionRejectsInvalidPinsAndBuckets(t *testing.T) {
	now := uint64(1_790_000_000_000)
	const id = "633631ab-fe10-45b3-832b-c76c9d0a97d6"
	for _, fields := range []string{
		`,"throughMs":null`, `,"throughMs":1790000005000`, `,"throughMs":1789999935000`,
		`,"throughMs":1789999999999`, `,"maxBuckets":721`, `,"includeRetired":null`,
	} {
		raw := fmt.Appendf(nil, `{"identityIds":[%q],"windowsMs":[5000]%s}`, id, fields)
		if decodeUsage("consumption.history", raw, now) != nil {
			t.Errorf("admitted invalid history query %s", raw)
		}
	}
	raw := fmt.Appendf(nil, `{"identityIds":[%q],"windowsMs":[5000,3900000],"throughMs":%d}`, id, now-60_000)
	q, ok := decodeConsumptionHistory(raw, now)
	if !ok || q.ThroughMs == nil || *q.ThroughMs != now-60_000 || q.MaxBuckets != 120 {
		t.Fatalf("valid pinned query = %+v, %v", q, ok)
	}
}

func TestUsageAPIWithEmptySQLiteEvidence(t *testing.T) {
	dir := t.TempDir()
	root := home.Root{Dir: dir, Database: filepath.Join(dir, home.DatabaseName)}
	store, err := storage.Open(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	const unknown = "633631ab-fe10-45b3-832b-c76c9d0a97d6"
	cut := uint64(time.Now().UnixMilli()) / fineBucketMs * fineBucketMs
	history := fmt.Sprintf(`{"version":1,"operation":"consumption.history","input":{"identityIds":[%q],"windowsMs":[5000],"throughMs":%d}}`, unknown, cut)
	input, output := sessionFiles(t, []byte(history+"\n"+
		`{"version":1,"operation":"consumption.retired","input":{"fromMs":0}}`+"\n"+
		`{"version":1,"operation":"digest.wakeTurns","input":{"fromMs":0,"throughMs":1}}`+"\n"))
	status, err := (Server{Root: root}).ServeSession(input, output)
	transcript, readErr := os.ReadFile(output.Name())
	lines := strings.Split(strings.TrimSuffix(string(transcript), "\n"), "\n")
	if status != 0 || err != nil || readErr != nil || len(lines) != 3 {
		t.Fatalf("usage session = %d, %v, %v: %q", status, err, readErr, transcript)
	}
	var doc struct {
		ThroughMs  uint64
		Identities []map[string]any
	}
	if err := json.Unmarshal([]byte(lines[0]), &doc); err != nil || doc.ThroughMs != cut ||
		len(doc.Identities) != 1 || len(doc.Identities[0]) != 2 ||
		doc.Identities[0]["id"] != unknown || doc.Identities[0]["found"] != false {
		t.Fatalf("history = %s, %v", lines[0], err)
	}
	if lines[1] != `{"fromMs":0,"identityIds":[],"truncated":false}` ||
		lines[2] != `{"fromMs":0,"more":false,"throughMs":1,"turns":[]}` {
		t.Fatalf("usage empty pages = %q", lines[1:])
	}
}

func TestWakeTurnsKeepPartialTokensAndUnknownModelSplit(t *testing.T) {
	rows := []core.WakeTurn{
		{StartedAtMs: 1, EndedAtMs: 2, Tokens: &core.UsageTokens{InputTokens: 3}},
		{StartedAtMs: 2, EndedAtMs: 3},
	}
	document, err := json.Marshal(wakeTurnsDocument(core.WakeTurnPage{Turns: rows}))
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Turns []struct {
			Tokens   *core.UsageTokens
			ByModel  json.RawMessage
			Measured bool
		}
	}
	if err := json.Unmarshal(document, &result); err != nil || len(result.Turns) != 2 {
		t.Fatalf("wake turns = %s, %v", document, err)
	}
	partial, unknown := result.Turns[0], result.Turns[1]
	if partial.Measured || partial.Tokens == nil || partial.Tokens.InputTokens != 3 || string(partial.ByModel) != "null" ||
		unknown.Measured || unknown.Tokens != nil || string(unknown.ByModel) != "null" {
		t.Fatalf("wake turns = %s", document)
	}
}
