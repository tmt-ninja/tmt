package storage

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

const digestTestChecklist core.DigestChecklistID = "0c711d7a-f732-46c2-9fa7-63d5ed0507cc"
const digestTestNext core.DigestChecklistID = "4d0a0945-780a-4c30-9f4d-eebcd17507ca"
const digestTestToken core.DigestAttemptToken = "cf833f67-8323-45d3-9a18-48d48aa48b44"
const digestTestNextToken core.DigestAttemptToken = "b86df686-46b2-42ee-a152-75e261f83316"

func seedDigestRequest(t *testing.T, s *Storage, n uint64, urgent bool) (core.RequestID, core.Receipt) {
	t.Helper()
	from, to := bindingOtherID, bindingOwnerID
	req := inboxRequest(core.RequestID(fmt.Sprintf("req_020b1600-4d94-4f36-91e0-%012d", n)))
	req.Originator.IdentityID, req.Recipient, req.Route.Recipient = &from, &to, &to
	prepared, err := NewRequestService(s, &requestClock{ms: 10000}).Enqueue(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.ExecContext(t.Context(), `INSERT INTO request_delivery_policies(request_id,urgent,kind,automatic,mode)
		VALUES (?,?,'review',1,'request')`, req.RequestID, urgent); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.ExecContext(t.Context(), `INSERT INTO focus_items(identity_id,request_id,kind,source,created_at_ms,
		context_tokens_at_arrival,context_observed_at_ms,phase_at_arrival)
		VALUES (?,?,'review','incoming',10500,0,10200,'working')`, to, req.RequestID); err != nil {
		t.Fatal(err)
	}
	return req.RequestID, prepared.Receipt
}

func TestDigestClaimSealsExactPrefixAndSettlesOnce(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	store := bindingFixture(t)
	binding := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	first, receipt := seedDigestRequest(t, store, 1, false)
	second, _ := seedDigestRequest(t, store, 2, true)
	if _, err := store.db.ExecContext(ctx, "INSERT INTO identity_metadata VALUES (?,'user','true')", bindingOtherID); err != nil {
		t.Fatal(err)
	}
	policy := core.DigestPolicyWrite{IdentityID: bindingOwnerID, OwnerID: bindingOtherID, SetterID: bindingOtherID, UntilMs: 30000, NowMs: 11000}
	view, err := store.WritePolicy(ctx, policy)
	if err != nil || view.Policy == nil || view.Policy.Revision != 1 || view.HeldCount != 2 {
		t.Fatalf("policy view: %+v %v", view, err)
	}
	if _, err := store.WritePolicy(ctx, policy); err == nil {
		t.Fatal("stale policy revision was accepted")
	} else {
		requireRequestFailure(t, err, "DIGEST_REVISION_CONFLICT", 5)
	}
	views, err := store.ReadPolicies(ctx, core.DigestIdentityQuery{IdentityIDs: []core.IdentityID{bindingOtherID, bindingOwnerID, bindingOtherID}, NowMs: 11100})
	if err != nil || len(views) != 3 || views[0].IdentityID != bindingOtherID || views[1].HeldCount != 2 || views[2].Policy != nil {
		t.Fatalf("caller policy order: %+v %v", views, err)
	}
	stats, err := store.ReadStats(ctx, core.DigestIdentityQuery{IdentityIDs: []core.IdentityID{bindingOwnerID}, NowMs: 11100})
	if err != nil || len(stats) != 1 || stats[0].DueCount != 0 || stats[0].OldestHeldAgeMs == nil || *stats[0].OldestHeldAgeMs != 600 ||
		stats[0].NextEligibleAtMs == nil || *stats[0].NextEligibleAtMs != 30000 {
		t.Fatalf("stats before due: %+v %v", stats, err)
	}

	read := core.DigestChecklistQuery{IdentityID: bindingOwnerID, NowMs: 11200, Limit: 5}
	list, err := store.ReadChecklist(ctx, read)
	if err != nil || list.Total != 2 || len(list.Items) != 2 {
		t.Fatalf("unsealed checklist: %+v %v", list, err)
	}
	item := list.Items[0]
	if item.RequestID != first || item.SenderID == nil || *item.SenderID != bindingOtherID || item.SenderName == nil || !item.FromUser ||
		item.Prompt == nil || *item.Prompt != inboxRequest(first).Message || item.Reply == nil || item.Reply.Receipt != receipt ||
		item.Reply.Route.Kind != core.RequestRouteInbox || item.ContextTokensAtArrival == nil || *item.ContextTokensAtArrival != 0 {
		t.Fatalf("live canonical item: %+v", item)
	}

	claim := core.DigestClaim{IdentityID: bindingOwnerID, ChecklistID: digestTestChecklist, AttemptToken: digestTestToken,
		Opportunity: core.DigestOpportunityIdle, Kind: core.DigestProjectionFull, NowMs: 12000, ThroughLimit: &item.Sequence}
	if got, err := store.Claim(ctx, claim); err != nil || got != nil {
		t.Fatalf("idle claim before due = %+v %v", got, err)
	}
	due, err := store.MarkDue(ctx, core.DigestDueQuery{IdentityID: bindingOwnerID, NowMs: 12000})
	if err != nil || due.HeldCount != 2 || due.ThroughSequence != list.Items[1].Sequence {
		t.Fatalf("due watermark: %+v %v", due, err)
	}
	preview, err := store.ClaimableItems(ctx, core.DigestClaimableQuery{IdentityID: bindingOwnerID, Opportunity: core.DigestOpportunityIdle, Limit: 1, NowMs: 12100})
	if err != nil || len(preview.Items) != 1 || preview.Items[0].RequestID != first {
		t.Fatalf("preview: %+v %v", preview, err)
	}

	if _, err := store.db.ExecContext(ctx, `CREATE TRIGGER fail_digest_input BEFORE INSERT ON capture_entries
		BEGIN SELECT RAISE(ABORT,'capture refused'); END`); err != nil {
		t.Fatal(err)
	}
	if got, err := store.Claim(ctx, claim); err == nil || got != nil {
		t.Fatalf("failed capture reservation granted a claim: %+v %v", got, err)
	}
	list, err = store.ReadChecklist(ctx, read)
	if err != nil || list.Total != 2 || list.ActiveChecklist != nil {
		t.Fatalf("claim or membership leaked: %+v %v", list, err)
	}
	if _, err := store.db.ExecContext(ctx, "DROP TRIGGER fail_digest_input"); err != nil {
		t.Fatal(err)
	}

	got, err := store.Claim(ctx, claim)
	if err != nil || got == nil || got.ThroughSequence != item.Sequence || got.State != core.DigestStateClaimed {
		t.Fatalf("prefix claim: %+v %v", got, err)
	}
	read.ChecklistID = &got.ID
	list, err = store.ReadChecklist(ctx, read)
	if err != nil || list.Total != 1 || list.Items[0].RequestID != first {
		t.Fatalf("sealed membership: %+v %v", list, err)
	}
	if repeat, err := store.Claim(ctx, claim); err != nil || repeat != nil {
		t.Fatalf("replay granted transport: %+v %v", repeat, err)
	}
	settle := core.DigestSettlement{IdentityID: bindingOwnerID, ChecklistID: got.ID, AttemptToken: digestTestNextToken, Outcome: core.DigestStateDelivered, NowMs: 12500}
	_, err = store.Settle(ctx, settle)
	requireRequestFailure(t, err, "DIGEST_ATTEMPT_MISMATCH", 5)
	settle.AttemptToken = got.AttemptToken
	if changed, err := store.Settle(ctx, settle); err != nil || !changed {
		t.Fatalf("settle: %t %v", changed, err)
	}
	if changed, err := store.Settle(ctx, settle); err != nil || changed {
		t.Fatalf("settlement replay: %t %v", changed, err)
	}
	settle.Outcome = core.DigestStateUncertain
	_, err = store.Settle(ctx, settle)
	requireRequestFailure(t, err, "DIGEST_STATE_INVALID", 5)

	history, err := store.ReadHistory(ctx, read)
	if err != nil || len(history.Checklists) != 1 || history.DeliveredDigests != 1 {
		t.Fatalf("history: %+v %v", history, err)
	}
	h := history.Checklists[0]
	if h.Outcome != core.DigestStateDelivered || h.SealedCount == nil || *h.SealedCount != 1 || h.SettledAtMs == nil ||
		*h.SettledAtMs != 12500 || len(h.Items) != 1 || !reflect.DeepEqual(h.Items[0], item.DigestItemEvidence) {
		t.Fatalf("content-free settlement evidence: %+v", h)
	}
	var delivery string
	if err := store.db.QueryRowContext(ctx, "SELECT delivery FROM capture_entries WHERE request_id=?", first).Scan(&delivery); err != nil || delivery != "delivered" {
		t.Fatalf("capture state = %q %v", delivery, err)
	}
	read.ChecklistID = nil
	list, err = store.ReadChecklist(ctx, read)
	if err != nil || list.Total != 1 || list.Items[0].RequestID != second {
		t.Fatalf("unsealed suffix: %+v %v", list, err)
	}
	// A different runtime cannot use the stopped runtime's claimed authority.
	claim.ChecklistID, claim.AttemptToken, claim.ThroughLimit = digestTestNext, digestTestNextToken, nil
	claim.Opportunity = core.DigestOpportunityTurnBoundary
	claim.Launch = &core.DigestLaunchFence{Expected: binding, Driver: core.DriverClaude, ProviderSession: "wrong"}
	_, err = store.Claim(ctx, claim)
	requireRequestFailure(t, err, "DIGEST_ATTEMPT_MISMATCH", 5)
}

func TestDigestReceivingSummaryFreezeAndWakeAdmission(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	store := bindingFixture(t)
	first, _ := seedDigestRequest(t, store, 1, false)
	seedDigestRequest(t, store, 2, true)
	receiving := core.DigestReceivingWrite{Enabled: true, Default: core.OrchReceiving{Mode: core.OrchReceivingAuto},
		Members: []core.DigestReceivingMember{{IdentityID: bindingOtherID, Receiving: core.OrchReceiving{Mode: core.OrchReceivingDirect}},
			{IdentityID: bindingOwnerID, Receiving: core.OrchReceiving{Mode: core.OrchReceivingAuto}}}}
	if rev, err := store.SyncReceiving(ctx, receiving); err != nil || rev != 1 {
		t.Fatalf("publish: %d %v", rev, err)
	}
	receiving.ExpectedRevision = 1
	receiving.Members[0], receiving.Members[1] = receiving.Members[1], receiving.Members[0]
	if rev, err := store.SyncReceiving(ctx, receiving); err != nil || rev != 1 {
		t.Fatalf("identical settings: %d %v", rev, err)
	}
	receiving.ExpectedRevision = 0
	_, err := store.SyncReceiving(ctx, receiving)
	requireRequestFailure(t, err, "ORCH_CONFLICT", 5)

	if _, err := store.db.ExecContext(ctx, "INSERT INTO orchestration_pending_wakes(identity_id,released_classes,released_at_ms) VALUES (?,3,11000)", bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	q := core.DigestClaim{IdentityID: bindingOwnerID, ChecklistID: digestTestChecklist, AttemptToken: digestTestToken,
		Opportunity: core.DigestOpportunityIdle, Kind: core.DigestProjectionIncomingSummary, NowMs: 12000}
	got, err := store.Claim(ctx, q)
	if err != nil || got == nil || got.Summary == nil || got.Summary.IncomingCount != 2 || got.Summary.UrgentCount != 1 {
		t.Fatalf("summary freeze: %+v %v", got, err)
	}
	if next, err := store.WakeAdmissionMs(ctx); err != nil || next != 13000 {
		t.Fatalf("admission clock: %d %v", next, err)
	}
	var count int
	if err := store.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM capture_entries").Scan(&count); err != nil || count != 0 {
		t.Fatalf("summary reserved full capture: %d %v", count, err)
	}
	settle := core.DigestSettlement{IdentityID: q.IdentityID, ChecklistID: q.ChecklistID, AttemptToken: q.AttemptToken,
		Outcome: core.DigestStateDefinitelyUnsent, NowMs: 12100}
	if changed, err := store.Settle(ctx, settle); err != nil || !changed {
		t.Fatalf("release summary: %v %v", changed, err)
	}
	q.ChecklistID, q.AttemptToken, q.NowMs = digestTestNext, digestTestNextToken, 12999
	if got, err := store.Claim(ctx, q); err != nil || got != nil {
		t.Fatalf("global wake clock bypassed: %+v %v", got, err)
	}
	q.NowMs = 13000
	got, err = store.Claim(ctx, q)
	if err != nil || got == nil || got.Summary == nil || got.Summary.IncomingCount != 2 {
		t.Fatalf("reclaimed unsent summary: %+v %v", got, err)
	}
	if _, err := store.db.ExecContext(ctx, "UPDATE request_delivery_policies SET urgent=1 WHERE request_id=?", first); err != nil {
		t.Fatal(err)
	}
	settle.ChecklistID, settle.AttemptToken, settle.Outcome, settle.NowMs = q.ChecklistID, q.AttemptToken, core.DigestStateUncertain, 13500
	if changed, err := store.Settle(ctx, settle); err != nil || !changed {
		t.Fatalf("settle summary uncertain: %v %v", changed, err)
	}
	h, err := store.ReadHistory(ctx, core.DigestChecklistQuery{IdentityID: bindingOwnerID, ChecklistID: &q.ChecklistID, NowMs: 14000, Limit: 1})
	if err != nil || len(h.Checklists) != 1 || h.Checklists[0].Summary == nil || h.Checklists[0].Summary.UrgentCount != 1 ||
		h.Checklists[0].RetainedCount != 2 || h.Checklists[0].NextItemAfter == nil || h.DeliveredDigests != 0 {
		t.Fatalf("frozen summary history: %+v %v", h, err)
	}
	if err := store.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM orchestration_pending_wakes").Scan(&count); err != nil || count != 0 {
		t.Fatalf("uncertain summary was reoffered: %d %v", count, err)
	}
	if err := store.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM orchestration_decisions WHERE reason='digest_uncertain'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("frozen receiving decision unavailable: %d %v", count, err)
	}
}

func TestDigestCalendarPinsDSTBoundaries(t *testing.T) {
	zone, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	spring := time.Date(2026, 3, 8, 0, 0, 0, 0, time.UTC)
	want := time.Date(2026, 3, 8, 7, 0, 0, 0, time.UTC).UnixMilli()
	if got := digestCalendarBoundary(spring, 2*60+30, zone, false); got != want {
		t.Fatalf("spring gap: %d want %d", got, want)
	}
	fall := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	first := digestCalendarBoundary(fall, 90, zone, false)
	last := digestCalendarBoundary(fall, 90, zone, true)
	if first != time.Date(2026, 11, 1, 5, 30, 0, 0, time.UTC).UnixMilli() || last-first != 3600000 {
		t.Fatalf("fall fold: %d to %d", first, last)
	}
}

func TestDigestRefusesUnknownStoredEnums(t *testing.T) {
	t.Parallel()
	store := bindingFixture(t)
	seedDigestRequest(t, store, 1, false)
	ctx := t.Context()
	if _, err := store.db.ExecContext(ctx, "PRAGMA ignore_check_constraints=ON"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, "UPDATE focus_items SET phase_at_arrival='unknown-future-value'"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ReadChecklist(ctx, core.DigestChecklistQuery{IdentityID: bindingOwnerID, Limit: 1, NowMs: 12000}); !errors.Is(err, errDigestEvidence) {
		t.Fatalf("unknown stored phase = %v", err)
	}
	if !core.DigestStateDelivered.Valid() || core.DigestState(strings.Repeat("z", 2)).Valid() {
		t.Fatal("Digest state enum admission")
	}
}

func TestDigestLaunchRechecksAndReapsStrandedTurn(t *testing.T) {
	t.Parallel()
	store := bindingFixture(t)
	ctx := t.Context()
	binding := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	request, _ := seedDigestRequest(t, store, 1, false)
	if _, err := store.db.ExecContext(ctx, `UPDATE bindings SET runtime_state='running',last_transition='started',
		runtime_pid=601,runtime_start_identity='runtime',launch_owner_pid=600,launch_owner_start_identity='owner',
		observed_provider_session_id='session' WHERE id=?`, binding.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO identity_session_preferences
		(identity_id,preferred_harness,remembered_harness,runtime_mode,provider_session_id)
		VALUES (?,'claude','claude','default','session')`, bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	var running *core.Binding
	if err := store.transact(ctx, true, func(r records) error {
		var err error
		running, err = r.Bindings().FindByIdentity(bindingOwnerID)
		return err
	}); err != nil || running == nil {
		t.Fatalf("running: %+v %v", running, err)
	}
	fence := core.DigestLaunchFence{Expected: *running, Driver: core.DriverClaude, ProviderSession: "session"}
	q := core.DigestClaim{IdentityID: bindingOwnerID, ChecklistID: digestTestChecklist, AttemptToken: digestTestToken,
		Opportunity: core.DigestOpportunityTurnBoundary, Kind: core.DigestProjectionFull, NowMs: 12000, Launch: &fence}
	if got, err := store.Claim(ctx, q); err != nil || got == nil {
		t.Fatalf("exact launch: %+v %v", got, err)
	}
	q.ChecklistID, q.AttemptToken, q.NowMs = digestTestNext, digestTestNextToken, 21999
	if got, err := store.Claim(ctx, q); err != nil || got != nil {
		t.Fatalf("unexpired active claim replaced: %+v %v", got, err)
	}
	q.NowMs = 22000
	preview, err := store.ClaimableItems(ctx, core.DigestClaimableQuery{IdentityID: bindingOwnerID, NowMs: q.NowMs, Limit: 1, Opportunity: q.Opportunity})
	if err != nil || len(preview.Items) != 1 || preview.Items[0].RequestID != request {
		t.Fatalf("reoffer preview: %+v %v", preview, err)
	}
	if _, err := store.db.ExecContext(ctx, "UPDATE identity_session_preferences SET provider_session_id='new-session' WHERE identity_id=?", bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	_, err = store.Claim(ctx, q)
	requireRequestFailure(t, err, "DIGEST_ATTEMPT_MISMATCH", 5)
	if _, err := store.db.ExecContext(ctx, "UPDATE identity_session_preferences SET provider_session_id='session' WHERE identity_id=?", bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	got, err := store.Claim(ctx, q)
	if err != nil || got == nil || got.ID != digestTestNext || got.ThroughSequence != preview.Items[0].Sequence {
		t.Fatalf("stranded prefix: %+v %v", got, err)
	}
	h, err := store.ReadHistory(ctx, core.DigestChecklistQuery{IdentityID: bindingOwnerID, NowMs: q.NowMs, Limit: 10})
	if err != nil || len(h.Checklists) != 1 || h.Checklists[0].Outcome != core.DigestStateUncertain || h.Checklists[0].RetainedCount != 0 {
		t.Fatalf("stranded settlement: %+v %v", h, err)
	}
	settle := core.DigestSettlement{IdentityID: q.IdentityID, ChecklistID: q.ChecklistID, AttemptToken: q.AttemptToken,
		Outcome: core.DigestStateDelivered, MessageStarted: true, NowMs: 22100}
	if changed, err := store.Settle(ctx, settle); err != nil || !changed {
		t.Fatalf("verified delivered handoff: %v %v", changed, err)
	}
	var confirmation uint64
	if err := store.db.QueryRowContext(ctx, "SELECT confirmed_at_ms FROM focus_checklists WHERE id=?", got.ID).Scan(&confirmation); err != nil || confirmation != settle.NowMs {
		t.Fatalf("atomic handoff confirmation: %d %v", confirmation, err)
	}
}
