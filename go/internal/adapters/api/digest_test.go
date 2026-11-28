package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestInvalidDigestInputDoesNotCreateStorage(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "unopened")
	server := Server{Root: home.Root{Dir: dir, Database: filepath.Join(dir, home.DatabaseName)}}
	input, _ := sessionFiles(t, []byte(`{"version":1,"operation":"digest.policy.show","input":{"identities":["not-an-id"]}}`))
	var output bytes.Buffer
	status, err := server.ServeOnce(input, &output)
	if err != nil || status != 1 || !strings.Contains(output.String(), "API_INPUT_INVALID") {
		t.Fatalf("invalid request = %d, %v, %s", status, err, output.String())
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("invalid Digest input created storage: %v", err)
	}
}

func TestDigestSessionPersistsPolicyAndPreservesRevisionFault(t *testing.T) {
	dir := t.TempDir()
	root := home.Root{Dir: dir, Database: filepath.Join(dir, home.DatabaseName)}
	store, err := storage.Open(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	const worker = "633631ab-fe10-45b3-832b-c76c9d0a97d6"
	const owner = "772ea84a-0238-4e82-935c-be14058d0729"
	now := uint64(time.Now().UnixMilli())
	err = store.Write(t.Context(), func(tx ports.StoreTx) error {
		if err := tx.Identities().Insert(core.Identity{ID: worker, Name: "Worker", CanonicalName: "worker", Lifetime: core.LifetimeSaved}, now); err != nil {
			return err
		}
		return tx.Identities().Insert(core.Identity{ID: owner, Name: "Owner", CanonicalName: "owner", Lifetime: core.LifetimeSaved}, now)
	})
	closeErr := store.Close()
	if err != nil || closeErr != nil {
		t.Fatalf("seed identities: %v, %v", err, closeErr)
	}

	until := now + 60_000
	write := fmt.Sprintf(`{"version":1,"operation":"digest.policy.set","input":{"identityId":%q,"ownerIdentityId":%q,"setterIdentityId":%q,"expectedRevision":0,"untilMs":%d,"maxHoldMs":1000}}`, worker, owner, owner, until)
	show := fmt.Sprintf(`{"version":1,"operation":"digest.policy.show","input":{"identities":[%q,%q]}}`, owner, worker)
	stats := fmt.Sprintf(`{"version":1,"operation":"digest.stats.show","input":{"identities":[%q]}}`, worker)
	input, output := sessionFiles(t, []byte(strings.Join([]string{write, write, show, stats, ""}, "\n")))
	server := Server{Root: root}
	status, err := server.ServeSession(input, output)
	bytes, readErr := os.ReadFile(output.Name())
	if err != nil || readErr != nil || status != 0 {
		t.Fatalf("session: %d, %v, %v", status, err, readErr)
	}
	lines := strings.Split(strings.TrimSuffix(string(bytes), "\n"), "\n")
	if len(lines) != 4 {
		t.Fatalf("session output = %q", bytes)
	}
	type policy struct {
		IdentityID                         string
		Revision, DigestUntilMs, MaxHoldMs uint64
		Active                             bool
		ActiveChecklist                    json.RawMessage
	}
	var current policy
	if err := json.Unmarshal([]byte(lines[0]), &current); err != nil || current.IdentityID != worker ||
		current.Revision != 1 || current.DigestUntilMs != until || !current.Active ||
		current.MaxHoldMs != 1000 || string(current.ActiveChecklist) != "null" {
		t.Fatalf("policy write = %s, %v", lines[0], err)
	}
	var rejected struct{ Error Fault }
	if err := json.Unmarshal([]byte(lines[1]), &rejected); err != nil || rejected.Error.Code != "DIGEST_REVISION_CONFLICT" {
		t.Fatalf("stale policy write = %s, %v", lines[1], err)
	}
	var policies struct{ Policies []policy }
	if err := json.Unmarshal([]byte(lines[2]), &policies); err != nil || len(policies.Policies) != 2 ||
		policies.Policies[0].IdentityID != owner || policies.Policies[0].Revision != 0 ||
		policies.Policies[1].IdentityID != worker || policies.Policies[1].Revision != 1 {
		t.Fatalf("policy read = %s, %v", lines[2], err)
	}
	if !strings.Contains(lines[3], `"oldestHeldAgeMs":null`) || !strings.Contains(lines[3], `"dueCount":0`) {
		t.Fatalf("Digest stats = %s", lines[3])
	}
}

func TestDigestChecklistReadKeepsSummaryCountsOnly(t *testing.T) {
	const id = core.IdentityID("633631ab-fe10-45b3-832b-c76c9d0a97d6")
	checklist := core.DigestChecklistID("772ea84a-0238-4e82-935c-be14058d0729")
	const request = core.RequestID("req_09175482-a733-409c-b94e-05f93de8e1a8")
	selected := &core.DigestChecklist{
		ID: checklist, State: core.DigestStateDelivered, Projection: core.DigestProjectionIncomingSummary,
		Summary: &core.DigestSummaryCounts{IncomingCount: 2, UrgentCount: 1},
	}
	prompt := "first\r\nsecond\u202e line"
	page := core.DigestChecklistPage{SelectedChecklist: selected, Total: 2, Items: []core.DigestItem{{
		DigestItemEvidence: core.DigestItemEvidence{Sequence: 4, CreatedAtMs: 50}, RequestID: request,
		Source: core.DigestSourceIncoming, Prompt: &prompt,
		Reply: &core.DigestReplyProof{Receipt: "v2_fixture"},
	}}}
	query := core.DigestChecklistQuery{IdentityID: id, ChecklistID: &checklist, Limit: 1}
	wire, err := json.Marshal(checklistPageDocument(query, page))
	if err != nil || string(wire) != `{"checklistId":"772ea84a-0238-4e82-935c-be14058d0729","identityId":"633631ab-fe10-45b3-832b-c76c9d0a97d6","incomingCount":2,"items":[],"nextAfter":null,"projection":"incoming_summary","remaining":0,"total":2,"urgentCount":1}` {
		t.Fatalf("settled summary = %s, %v", wire, err)
	}
	page.SelectedChecklist = nil
	wire, err = json.Marshal(checklistPageDocument(query, page))
	if err != nil || !strings.Contains(string(wire), `"nextAfter":4`) || !strings.Contains(string(wire), `"remaining":1`) ||
		!strings.Contains(string(wire), `"preview":"first second  line"`) ||
		!strings.Contains(string(wire), `"inspectCommand":"`+flavor.Binary+` result `+string(request)+` --json"`) ||
		!strings.Contains(string(wire), `"replyCommand":"`+flavor.Binary+` reply `+string(request)+` --receipt v2_fixture --message \u003ctext\u003e"`) {
		t.Fatalf("ordinary page = %s, %v", wire, err)
	}
	long := strings.Repeat("界", 161)
	if got := digestPreview(&long); got != strings.Repeat("界", 160) {
		t.Fatalf("Unicode preview = %q", got)
	}
}
