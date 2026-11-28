package api

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type digestTestClock int64

func (c digestTestClock) NowMs() int64 { return int64(c) }

func TestDigestAPIClaimsExactHeldRequestAndFlushRefusesOffline(t *testing.T) {
	dir := t.TempDir()
	root := home.Root{Dir: dir, Database: filepath.Join(dir, home.DatabaseName)}
	session := requestSession{root: root}
	if err := session.open(t.Context()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := session.close(); err != nil {
			t.Error(err)
		}
	})
	worker := core.IdentityID("633631ab-fe10-45b3-832b-c76c9d0a97d6")
	sender := core.IdentityID("772ea84a-0238-4e82-935c-be14058d0729")
	lead := core.IdentityID("757d5538-4d65-4239-88b8-bd2ec5e1ee2b")
	now := uint64(time.Now().UnixMilli())
	if err := session.store.Write(t.Context(), func(tx ports.StoreTx) error {
		for _, identity := range []core.Identity{
			{ID: worker, Name: "Worker", CanonicalName: "worker", Lifetime: core.LifetimeSaved},
			{ID: sender, Name: "Sender", CanonicalName: "sender", Lifetime: core.LifetimeSaved},
			{ID: lead, Name: "Lead", CanonicalName: "lead", Lifetime: core.LifetimeSaved},
		} {
			if err := tx.Identities().Insert(identity, now); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := session.store.WritePolicy(t.Context(), core.DigestPolicyWrite{
		IdentityID: worker, OwnerID: lead, SetterID: lead, NowMs: now, UntilMs: now + 60_000,
	}); err != nil {
		t.Fatal(err)
	}
	in := core.PrepareRequest{
		RequestID: "req_09175482-a733-409c-b94e-05f93de8e1a8", AttemptID: "a_req_09175482-a733-409c-b94e-05f93de8e1a8",
		Kind: core.RequestKindRequest, Origin: core.RequestOriginAutomation,
		Originator: core.Originator{Kind: core.OriginatorExplicit, IdentityID: &sender}, Recipient: &worker,
		Route: core.RequestRoute{Kind: core.RequestRouteInbox, Recipient: &worker}, Message: "exact prompt 🌙\nsecond line",
		ExpiresAtMs: now + 120_000, RetentionDays: 1,
		DeliveryPolicy: &core.RequestDeliveryPolicy{Kind: core.DigestKindReview, Mode: core.RequestDeliveryRequest, Automatic: true},
	}
	prepared, err := storage.NewRequestService(session.store, digestTestClock(now)).Enqueue(t.Context(), in)
	if err != nil || prepared.DigestUntilMs == nil {
		t.Fatalf("enqueue held request = %+v, %v", prepared, err)
	}
	call := func(operation, input string) SessionResponse {
		t.Helper()
		body := fmt.Sprintf(`{"version":1,"operation":%q,"input":%s}`, operation, input)
		response, err := session.respond([]byte(body))
		if err != nil {
			t.Fatal(err)
		}
		return response
	}
	if got := call("digest.checklist.flush", fmt.Sprintf(`{"identityId":%q,"whenBusy":null}`, worker)); got.Status != 1 {
		t.Fatalf("null whenBusy admitted: %+v", got)
	}
	if _, err := session.store.MarkDue(t.Context(), core.DigestDueQuery{IdentityID: worker, NowMs: now}); err != nil {
		t.Fatal(err)
	}
	got := call("digest.checklist.flush", fmt.Sprintf(`{"identityId":%q,"whenBusy":true}`, worker))
	if got.Status != 0 || !strings.Contains(string(got.Body), `"state":"not_idle"`) {
		t.Fatalf("offline flush = %s", got.Body)
	}
	inClaim := fmt.Sprintf(`{"identityId":%q,"opportunity":"turn_boundary"}`, worker)
	got = call("digest.checklist.claim", inClaim)
	var claim struct {
		Claimed   bool
		Checklist struct{ ChecklistID, AttemptToken string }
		Text      string
		Page      struct {
			Items []struct{ RequestID core.RequestID }
			Total uint64
		}
	}
	if err := json.Unmarshal(got.Body, &claim); got.Status != 0 || err != nil || !claim.Claimed || claim.Page.Total != 1 ||
		len(claim.Page.Items) != 1 || claim.Page.Items[0].RequestID != in.RequestID ||
		!strings.Contains(claim.Text, in.Message) || !strings.Contains(claim.Text, "--receipt "+string(prepared.Receipt)) {
		t.Fatalf("claim exact page and receipt = %s (%v)", got.Body, err)
	}
	if again := call("digest.checklist.claim", inClaim); string(again.Body) != `{"claimed":false}` || again.Status != 0 {
		t.Fatalf("active claim replay = %s", again.Body)
	}
	settle := fmt.Sprintf(`{"identityId":%q,"checklistId":%q,"attemptToken":%q,"outcome":"definitely_unsent"}`,
		worker, claim.Checklist.ChecklistID, claim.Checklist.AttemptToken)
	if done := call("digest.checklist.settle", settle); done.Status != 0 || !strings.Contains(string(done.Body), `"changed":true`) {
		t.Fatalf("exact settlement = %s", done.Body)
	}
}
