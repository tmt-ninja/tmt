package storage

import (
	"context"
	"database/sql"
	"errors"
	"reflect"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

const holdPolicyOwner core.IdentityID = "757d5538-4d65-4239-88b8-bd2ec5e1ee2b"
const holdRequestID core.RequestID = "req_05b6cc7a-e63c-4b23-94d2-d78db328128c"

func holdRequest() core.PrepareRequest {
	in := inboxRequest(holdRequestID)
	sender, recipient := bindingOtherID, bindingOwnerID
	in.Originator.IdentityID, in.Recipient, in.Route.Recipient = &sender, &recipient, &recipient
	return in
}

func optIntoRequestHold(in core.PrepareRequest) core.PrepareRequest {
	in.DeliveryPolicy = &core.RequestDeliveryPolicy{Kind: core.DigestKindReview, Mode: core.RequestDeliveryRequest, Automatic: true}
	return in
}

func holdStorageFixture(t *testing.T) *Storage {
	t.Helper()
	store := bindingFixture(t)
	ctx := t.Context()
	if err := store.transact(ctx, false, func(r records) error {
		return r.Identities().Insert(core.Identity{ID: holdPolicyOwner, Name: "Lead", CanonicalName: "lead", Lifetime: core.LifetimeSaved}, 9000)
	}); err != nil {
		t.Fatal(err)
	}
	view, err := store.WritePolicy(ctx, core.DigestPolicyWrite{IdentityID: bindingOwnerID, OwnerID: holdPolicyOwner, SetterID: holdPolicyOwner,
		NowMs: 9000, UntilMs: 30000})
	if err != nil || view.Policy == nil {
		t.Fatalf("lease: %+v %v", view, err)
	}
	if _, err := store.SyncReceiving(ctx, core.DigestReceivingWrite{Enabled: true, Default: core.OrchReceiving{Mode: core.OrchReceivingAuto}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, "INSERT INTO orchestration_focus(identity_id,revision,start_ms,end_ms) VALUES (?,1,9500,20000)", bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	return store
}

func TestPrepareNilPolicyPreservesLegacyRows(t *testing.T) {
	t.Parallel()
	modern, legacy := holdStorageFixture(t), holdStorageFixture(t)
	ctx := t.Context()
	in := holdRequest()
	got, err := NewRequestService(modern, &requestClock{ms: 10000}).Prepare(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	expected := core.PreparedRequest{RequestID: in.RequestID, AttemptID: in.AttemptID,
		Receipt: core.EncodeReceipt(in.RequestID, in.AttemptID, in.Route)}
	if !reflect.DeepEqual(got, expected) {
		t.Fatalf("prepared result changed: %+v", got)
	}
	// Reconstruct the existing nil-policy transaction from its row operations.
	if err := legacy.transact(ctx, false, func(r records) error {
		attempt, err := prepareAttempt(in, 10000)
		if err != nil {
			return err
		}
		if err := pruneRequests(r, 10000); err != nil {
			return err
		}
		if err := r.Requests().Insert(attempt, in.Message); err != nil {
			return err
		}
		return raiseAttention(r, in.RequestID, *in.Originator.IdentityID, false)
	}); err != nil {
		t.Fatal(err)
	}

	for _, table := range []string{"request_attempts", "request_attention_identities", "request_recipient_attention_identities",
		"request_delivery_policies", "focus_items", "orchestration_pending_wakes", "change_cursor"} {
		wanted := snapshotRequestTestTable(t, legacy.db, table)
		actual := snapshotRequestTestTable(t, modern.db, table)
		if !reflect.DeepEqual(actual, wanted) {
			t.Fatalf("%s changed\n got %v\nwant %v", table, actual, wanted)
		}
		if (table == "focus_items" || table == "orchestration_pending_wakes") && len(actual) != 0 {
			t.Fatalf("nil policy wrote %s", table)
		}
	}
}

func snapshotRequestTestTable(t *testing.T, db *sql.DB, table string) [][]any {
	t.Helper()
	rows, err := db.QueryContext(t.Context(), "SELECT * FROM "+table+" ORDER BY 1")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		t.Fatal(err)
	}
	var result [][]any
	for rows.Next() {
		values := make([]any, len(columns))
		args := make([]any, len(columns))
		for i := range values {
			args[i] = &values[i]
		}
		if err := rows.Scan(args...); err != nil {
			t.Fatal(err)
		}
		result = append(result, values)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestExplicitPaneRequestNeverHolds(t *testing.T) {
	t.Parallel()
	store := holdStorageFixture(t)
	ctx := t.Context()
	in := optIntoRequestHold(holdRequest())
	in.Route = paneRequest(in.RequestID).Route
	prepared, err := NewRequestService(store, &requestClock{ms: 10000}).Prepare(ctx, in)
	if err != nil || prepared.DigestUntilMs != nil {
		t.Fatalf("explicit pane: %+v %v", prepared, err)
	}
	var status core.AttemptStatus
	var wait bool
	var mode core.RequestDeliveryMode
	if err := store.db.QueryRowContext(ctx, `SELECT a.status,a.wait_active,p.mode FROM request_attempts a JOIN request_delivery_policies p
		USING(request_id) WHERE a.request_id=?`, in.RequestID).Scan(&status, &wait, &mode); err != nil ||
		status != core.AttemptPrepared || !wait || mode != core.RequestDeliveryRequest {
		t.Fatalf("explicit pane state: %s %t %s %v", status, wait, mode, err)
	}
	for _, table := range []string{"focus_items", "orchestration_pending_wakes"} {
		if len(snapshotRequestTestTable(t, store.db, table)) != 0 {
			t.Fatalf("explicit routing wrote %s", table)
		}
	}
}

func TestRequestHoldQueuesAtomicallyAndSnapshotsStoredActivity(t *testing.T) {
	t.Parallel()
	store := holdStorageFixture(t)
	ctx := t.Context()
	binding := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	if _, err := store.db.ExecContext(ctx, `UPDATE bindings SET runtime_state='running',runtime_pid=601,runtime_start_identity='provider',
		observed_provider_session_id='session',launch_owner_pid=600,launch_owner_start_identity='owner' WHERE id=?`, binding.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO identity_session_preferences(identity_id,preferred_harness,remembered_harness,
		runtime_mode,provider_session_id,driver_state,driver_state_version)
		VALUES (?,'claude','claude','default','session',
		'{"usage":{"tokens":0,"observedAtMs":9700},"activity":{"state":"working","session":"session","pid":601,"start":"provider","turn":null,"sinceMs":9500,"lastActivityMs":9800}}',3)`, bindingOwnerID); err != nil {
		t.Fatal(err)
	}

	in := optIntoRequestHold(holdRequest())
	clock := &requestClock{ms: 10000}
	svc := NewRequestService(store, clock)
	if _, err := store.db.ExecContext(ctx, `CREATE TRIGGER block_wake_marker BEFORE INSERT ON orchestration_pending_wakes
		BEGIN SELECT RAISE(ABORT,'test wake failure'); END`); err != nil {
		t.Fatal(err)
	}
	if got, err := svc.Prepare(ctx, in); err == nil || got.DigestUntilMs != nil {
		t.Fatalf("failed marker published: %+v %v", got, err)
	}
	for _, table := range []string{"request_attempts", "request_delivery_policies", "focus_items", "request_attention_identities",
		"request_recipient_attention_identities", "orchestration_pending_wakes"} {
		if len(snapshotRequestTestTable(t, store.db, table)) != 0 {
			t.Fatalf("rollback leaked %s", table)
		}
	}
	if _, err := store.db.ExecContext(ctx, "DROP TRIGGER block_wake_marker"); err != nil {
		t.Fatal(err)
	}
	prepared, err := svc.Prepare(ctx, in)
	if err != nil || prepared.DigestUntilMs == nil || *prepared.DigestUntilMs != 20000 {
		t.Fatalf("queued hold: %+v %v", prepared, err)
	}
	var status core.AttemptStatus
	var wait bool
	var kind core.DigestKind
	var phase core.DigestPhase
	var tokens, observed, heldAt uint64
	var classes uint8
	err = store.db.QueryRowContext(ctx, `SELECT a.status,a.wait_active,i.kind,i.phase_at_arrival,i.context_tokens_at_arrival,
		i.context_observed_at_ms,w.released_at_ms,w.released_classes FROM focus_items i JOIN request_attempts a USING(request_id)
		JOIN orchestration_pending_wakes w ON w.identity_id=i.identity_id WHERE a.request_id=?`, in.RequestID).
		Scan(&status, &wait, &kind, &phase, &tokens, &observed, &heldAt, &classes)
	if err != nil || status != core.AttemptQueued || wait || kind != core.DigestKindReview || phase != core.DigestPhaseWorking ||
		tokens != 0 || observed != 9700 || heldAt != 10000 || classes != digestOrdinaryClass {
		t.Fatalf("hold rows: %s %t %s %s %d %d %d %d %v", status, wait, kind, phase, tokens, observed, heldAt, classes, err)
	}
	if err := svc.BeginSend(ctx, prepared.AttemptID); err == nil {
		t.Fatal("a queued hold granted pane transport")
	}
	// An urgent request passes through focus while its ordinary neighbor stays held.
	in.RequestID, in.AttemptID = "req_2a71218a-c4c2-4d4b-98e2-8cbf8bd5fd38", "urgent-attempt"
	in.DeliveryPolicy.Urgent = true
	if got, err := svc.Enqueue(ctx, in); err != nil || got.DigestUntilMs != nil {
		t.Fatalf("urgent focus bypass: %+v %v", got, err)
	}

	q := core.DigestDueQuery{IdentityID: bindingOwnerID, NowMs: 19999}
	if released, err := store.WakeReleased(ctx, q); err != nil || released {
		t.Fatalf("ordinary wakes in focus: %t %v", released, err)
	}
	q.NowMs = 20000
	if released, err := store.WakeReleased(ctx, q); err != nil || !released {
		t.Fatalf("expired focus releases: %t %v", released, err)
	}
	claim, err := store.Claim(ctx, core.DigestClaim{IdentityID: bindingOwnerID, ChecklistID: digestTestChecklist, AttemptToken: digestTestToken,
		Opportunity: core.DigestOpportunityIdle, Kind: core.DigestProjectionIncomingSummary, NowMs: q.NowMs})
	if err != nil || claim == nil || claim.Summary == nil || claim.Summary.IncomingCount != 1 {
		t.Fatalf("real hold to frozen wake: %+v %v", claim, err)
	}
	before := snapshotRequestTestTable(t, store.db, "orchestration_pending_wakes")
	if released, err := store.WakeReleased(ctx, q); err != nil || released {
		t.Fatalf("claimed marker re-released: %t %v", released, err)
	}
	if got := snapshotRequestTestTable(t, store.db, "orchestration_pending_wakes"); !reflect.DeepEqual(got, before) {
		t.Fatalf("claimed marker changed: %v", got)
	}
}

func TestWakeCandidatesAndScanNeverRewriteAdmission(t *testing.T) {
	t.Parallel()
	store := holdStorageFixture(t)
	ctx := t.Context()
	if _, err := store.db.ExecContext(ctx, "INSERT INTO orchestration_pending_wakes(identity_id,released_classes,released_at_ms) VALUES (?,1,11000),(?,1,11000)",
		bindingOtherID, bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, "INSERT INTO orchestration_wake_clock(id,next_admission_ms) VALUES (1,95000)"); err != nil {
		t.Fatal(err)
	}
	p, err := store.WakeCandidates(ctx, 1)
	if err != nil || !reflect.DeepEqual(p.IdentityIDs, []core.IdentityID{bindingOwnerID}) || p.Clock.NextAdmissionMs != 95000 || p.Clock.ScanAfterIdentityID != nil {
		t.Fatalf("first scan page: %+v %v", p, err)
	}
	cursor := bindingOwnerID
	if err := store.AdvanceWakeScan(ctx, &cursor); err != nil {
		t.Fatal(err)
	}
	p, err = store.WakeCandidates(ctx, 1)
	if err != nil || !reflect.DeepEqual(p.IdentityIDs, []core.IdentityID{bindingOtherID}) || p.Clock.NextAdmissionMs != 95000 ||
		p.Clock.ScanAfterIdentityID == nil || *p.Clock.ScanAfterIdentityID != bindingOwnerID {
		t.Fatalf("next page: %+v %v", p, err)
	}
	if _, err := store.db.ExecContext(ctx, "UPDATE identities SET retired_at_ms=20000 WHERE id=?", cursor); err != nil {
		t.Fatal(err)
	}
	if err := store.AdvanceWakeScan(ctx, &cursor); err != nil {
		t.Fatal(err)
	}
	p, err = store.WakeCandidates(ctx, 256)
	if err != nil || p.Clock.ScanAfterIdentityID != nil || p.Clock.NextAdmissionMs != 95000 ||
		!reflect.DeepEqual(p.IdentityIDs, []core.IdentityID{bindingOtherID}) {
		t.Fatalf("retired cursor reset: %+v %v", p, err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	q := core.DigestDueQuery{IdentityID: bindingOtherID, NowMs: 20000}
	if _, err := store.WakeReleased(cancelled, q); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled scan: %v", err)
	}
	if pending, err := store.WakePending(ctx, bindingOtherID); err != nil || !pending {
		t.Fatalf("cancelled scan changed marker: %t %v", pending, err)
	}
	if released, err := store.WakeReleased(ctx, q); err != nil || released {
		t.Fatalf("dead marker released: %t %v", released, err)
	}
	if pending, err := store.WakePending(ctx, bindingOtherID); err != nil || pending {
		t.Fatalf("dead marker retained: %t %v", pending, err)
	}
}
