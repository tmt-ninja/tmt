package storage

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const hookID1 core.HookEventID = "307e3578-0424-43be-92cb-28d649a39325"
const hookID2 core.HookEventID = "ec8e9394-ef48-4844-8d84-b688ba053a01"

func hookDiagnostic(id core.HookEventID, owner core.IdentityID) core.HookCaptureEvent {
	return core.HookCaptureEvent{Version: 1, ID: id, DiagnosticFence: &core.HookDiagnosticFence{},
		FollowUp: core.HookCaptureFollowUp{Learning: &core.HookCaptureLearning{
			Provider: "claude", Launch: core.HookCaptureLaunch{IdentityID: owner, BindingID: bindingID1, OwnerPID: 123, OwnerStart: "start", StartupInput: true},
		}}}
}

func testHookOpen(t *testing.T, root home.Root) *HookQueue {
	t.Helper()
	q, err := OpenHookQueue(t.Context(), root, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := q.Close(); err != nil {
			t.Error(err)
		}
	})
	return q
}

func TestHookQueueClaimAndReceiptRecovery(t *testing.T) {
	parallelStorageFixture(t)
	ctx := t.Context()
	root := testRoot(t)
	store, err := Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	q, other := testHookOpen(t, root), testHookOpen(t, root)
	claim, ok, err := q.TryClaim(ctx)
	if err != nil || !ok {
		t.Fatalf("claim: %v, %v", ok, err)
	}
	defer claim.Close()

	event := hookDiagnostic(hookID1, bindingOwnerID)
	pub, err := q.Enqueue(ctx, event)
	if err != nil || pub.Status != core.HookPublicationQueued {
		t.Fatalf("enqueue: %+v, %v", pub, err)
	}
	if empty, err := q.FinishIfEmpty(ctx, claim); err != nil || empty {
		t.Fatalf("nonempty finish: %v, %v", empty, err)
	}
	if _, ok, err := other.TryClaim(ctx); err != nil || ok {
		t.Fatalf("contending claim: %v, %v", ok, err)
	}

	entry, err := other.Next(ctx)
	if err != nil || entry == nil || entry.Committed || !reflect.DeepEqual(entry.Event, event) {
		t.Fatalf("next: %+v, %v", entry, err)
	}
	receipt, err := store.CommitCapture(ctx, entry.Event)
	if err != nil || receipt.Outcome != core.HookCaptureNotApplicable || receipt.IdentityID == nil || *receipt.IdentityID != bindingOwnerID {
		t.Fatalf("receipt: %+v, %v", receipt, err)
	}
	if err := q.MarkCommitted(ctx, event.ID); err != nil {
		t.Fatal(err)
	}
	entry, err = other.Next(ctx)
	if err != nil || entry == nil || !entry.Committed || !reflect.DeepEqual(entry.Event, event) {
		t.Fatalf("follow-up recovery: %+v, %v", entry, err)
	}
	if next, err := other.NextUncommitted(ctx, nil); err != nil || next != nil {
		t.Fatalf("committed entry leaked: %+v, %v", next, err)
	}
	again, err := store.CommitCapture(ctx, entry.Event)
	if err != nil || !reflect.DeepEqual(receipt, again) {
		t.Fatalf("replay: %+v, %v", again, err)
	}
	if err := q.Acknowledge(ctx, event.ID); err != nil {
		t.Fatal(err)
	}

	failed := errors.New("injected commit failure")
	pub, err = q.observePublication(ctx, event.ID, failed)
	if err != nil || pub.Status != core.HookPublicationRecorded || !reflect.DeepEqual(pub.Receipt, &receipt) {
		t.Fatalf("recorded publication: %+v, %v", pub, err)
	}
	pub, err = q.observePublication(ctx, hookID2, failed)
	if !errors.Is(err, failed) || pub.Status != core.HookPublicationUnpublished {
		t.Fatalf("unpublished: %+v, %v", pub, err)
	}
	if empty, err := q.FinishIfEmpty(ctx, claim); err != nil || !empty {
		t.Fatalf("empty finish: %v, %v", empty, err)
	}
	if err := claim.Close(); err != nil {
		t.Fatal(err)
	}
	claim, ok, err = other.TryClaim(ctx)
	if err != nil || !ok {
		t.Fatalf("claim after handoff: %v, %v", ok, err)
	}
	defer claim.Close()
}

func TestHookQueueAdmitsOnlyExistingPrivateQueue(t *testing.T) {
	ctx := t.Context()
	root := testRoot(t)
	if err := os.Mkdir(root.Dir, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root.Dir, hookQueueFilename)
	if q, err := OpenHookQueue(ctx, root, 0); q != nil || !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("no queue: %v, %v", q, err)
	}
	target := filepath.Join(root.Dir, "other")
	if err := os.WriteFile(target, []byte("untouched"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, path); err != nil {
		t.Fatal(err)
	}
	if q, err := OpenHookQueue(ctx, root, 0); q != nil || err == nil {
		t.Fatalf("symlink admitted: %v, %v", q, err)
	}
	text, err := os.ReadFile(target)
	if err != nil || string(text) != "untouched" {
		t.Fatalf("symlink target changed: %q, %v", text, err)
	}
}

func TestHookQueueQuarantineAndProvisionalBatchReuse(t *testing.T) {
	parallelStorageFixture(t)
	ctx := t.Context()
	root := testRoot(t)
	store, err := Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	queue := testHookOpen(t, root)
	if _, err := queue.db.ExecContext(ctx, `INSERT INTO hook_writes(event_id,identity_id,kind,enqueued_ms,payload)
		VALUES ('invalid',?,'capture',0,'private untrusted text')`, bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	batch := "1f2f8c9c-ecc4-46e5-9230-e08a7bf54f61"
	event := historicalHookCapture(hookID1, batch)
	event.Capture.Provisional = true
	pub, err := queue.Enqueue(ctx, event)
	if err != nil || pub.Status != core.HookPublicationQueued {
		t.Fatalf("enqueue: %+v, %v", pub, err)
	}
	owner, other := bindingOwnerID, bindingOtherID
	if next, err := queue.NextUncommitted(ctx, &other); err != nil || next != nil {
		t.Fatalf("owner filtering: %+v, %v", next, err)
	}
	next, err := queue.NextUncommitted(ctx, &owner)
	if err != nil || next == nil || next.Event.ID != hookID1 {
		t.Fatalf("next: %+v, %v", next, err)
	}
	var quarantined bool
	if err := queue.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM invalid_hook_writes WHERE event_id='invalid')").Scan(&quarantined); err != nil || !quarantined {
		t.Fatalf("invalid row not quarantined: %v, %v", quarantined, err)
	}
	if err := queue.Acknowledge(ctx, hookID1); err != nil {
		t.Fatal(err)
	}
	event.ID = hookID2
	competing := "df87582e-1c7d-4c52-99d0-42368aa750af"
	event.Capture.Batch = &competing
	if _, err := queue.Enqueue(ctx, event); err != nil {
		t.Fatal(err)
	}
	next, err = queue.Next(ctx)
	if err != nil || next == nil || next.Event.ID != hookID2 || *next.Event.Capture.Batch != batch || *event.Capture.Batch != competing {
		t.Fatalf("batch allocation after acknowledgement: %+v, %v", next, err)
	}

	failed := errors.New("injected append failure")
	if err := queue.Close(); err != nil {
		t.Fatal(err)
	}
	pub, err = queue.observePublication(ctx, hookID2, failed)
	if !errors.Is(err, failed) || pub.Status != core.HookPublicationUnknown {
		t.Fatalf("unknown publication: %+v, %v", pub, err)
	}
}

func historicalHookCapture(id core.HookEventID, batch string) core.HookCaptureEvent {
	return core.HookCaptureEvent{Version: 1, ID: id, Capture: &core.HookPendingCapture{
		Identity: bindingOwnerID, Binding: bindingID1, BindingFingerprint: "0000000000000000000000000000000000000000000000000000000000000000",
		Batch: &batch, Provider: "claude", Session: "old-session", PID: 120, Start: "old-start",
		NowMs: uint64(time.Now().UnixMilli()), Admitted: core.HookCaptureCommitted, Response: &core.HookFinalText{Text: "exact final", OriginalBytes: 11},
	}}
}

func TestCommitHookFinalAndReceiptAtomicallyWithoutChangingNewerBatch(t *testing.T) {
	parallelStorageFixture(t)
	ctx := t.Context()
	store := bindingFixture(t)
	binding := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	oldBatch := "1f2f8c9c-ecc4-46e5-9230-e08a7bf54f61"
	event := historicalHookCapture(hookID1, oldBatch)
	now := event.Capture.NowMs
	if _, err := store.db.ExecContext(ctx, `INSERT INTO capture_batches
		(id,identity_id,binding_id,driver,session_id,runtime_pid,runtime_start,created_ms,closed_ms)
		VALUES (?,?,?,'claude','old-session',120,'old-start',?,?),
		('new',?,?,'claude','new-session',121,'new-start',?,NULL)`, oldBatch, bindingOwnerID, binding.ID, now-5000, now-3000, bindingOwnerID, binding.ID, now-1000); err != nil {
		t.Fatal(err)
	}
	// Force the last write to fail and verify it rolls the final back too.
	if _, err := store.db.ExecContext(ctx, `CREATE TRIGGER reject_receipt BEFORE INSERT ON hook_capture_receipts
		BEGIN SELECT RAISE(ABORT,'test receipt failure'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CommitCapture(ctx, event); err == nil {
		t.Fatal("commit succeeded without its receipt")
	}
	var count int
	if err := store.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM capture_entries").Scan(&count); err != nil || count != 0 {
		t.Fatalf("uncommitted final leaked: %d, %v", count, err)
	}
	if _, err := store.db.ExecContext(ctx, "DROP TRIGGER reject_receipt"); err != nil {
		t.Fatal(err)
	}
	receipt, err := store.CommitCapture(ctx, event)
	if err != nil || receipt.Outcome != core.HookCaptureCommitted || receipt.BatchID == nil || *receipt.BatchID != oldBatch {
		t.Fatalf("historical final receipt: %+v, %v", receipt, err)
	}
	var text, batch string
	var closed *uint64
	if err := store.db.QueryRowContext(ctx, `SELECT f.text,e.batch_id,(SELECT closed_ms FROM capture_batches WHERE id='new')
		FROM capture_entries e JOIN recent_responses f ON f.sequence=e.response_sequence`).Scan(&text, &batch, &closed); err != nil || text != "exact final" || batch != oldBatch || closed != nil {
		t.Fatalf("final provenance or newer batch changed: %q %q %v, %v", text, batch, closed, err)
	}
	event.ID = hookID2
	receipt, err = store.CommitCapture(ctx, event)
	if err != nil || receipt.Outcome != core.HookCaptureDuplicate {
		t.Fatalf("duplicate final: %+v %v", receipt, err)
	}
}

func TestCurrentCaptureAdvancesOnlyMatchingTurnActivity(t *testing.T) {
	parallelStorageFixture(t)
	ctx := t.Context()
	store := bindingFixture(t)
	binding := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	batch := "1f2f8c9c-ecc4-46e5-9230-e08a7bf54f61"
	event := historicalHookCapture(hookID1, batch)
	c := event.Capture
	c.NowMs = 10000
	turn, model := "live-turn", "claude-test"
	c.Turn, c.Model = &turn, &model
	if _, err := store.db.ExecContext(ctx, `UPDATE bindings SET runtime_state='running',last_transition='started',
		runtime_pid=120,runtime_start_identity='old-start',observed_provider_session_id='old-session',
		launch_owner_pid=119,launch_owner_start_identity='owner-start' WHERE id=?`, binding.ID); err != nil {
		t.Fatal(err)
	}
	var serialized string
	if err := store.db.QueryRowContext(ctx, "SELECT json_array("+nativeCaptureBindingColumns+") FROM bindings b WHERE b.id=?", binding.ID).Scan(&serialized); err != nil {
		t.Fatal(err)
	}
	c.BindingFingerprint = fmt.Sprintf("%x", sha256.Sum256([]byte(serialized)))
	if _, err := store.db.ExecContext(ctx, `INSERT INTO identity_session_preferences(identity_id,preferred_harness,remembered_harness,
		runtime_mode,provider_session_id,driver_state,driver_state_version)
		VALUES (?,'claude','claude','default','old-session',
		'{"activity":{"session":"old-session","pid":120,"start":"old-start","turn":"live-turn","state":"working","sinceMs":9000,"lastActivityMs":9000}}',3)`,
		bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO capture_batches(id,identity_id,binding_id,driver,session_id,runtime_pid,runtime_start,
		provider_turn,created_ms) VALUES (?,?,?,'claude','old-session',120,'old-start',?,9000)`,
		batch, bindingOwnerID, binding.ID, turn); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, "INSERT INTO wake_turns(identity_id,started_ms) VALUES (?,9000)", bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	// Native a_stop_blocked_continuation_stays_open_until_its_own_stop_or_a_prompt.
	assertDigestContinuation(t, store, false)
	handOverDigestContinuation(t, store, digestTestChecklist, digestTestToken, core.DigestStateDelivered)
	assertDigestContinuation(t, store, true)
	receipt, err := store.CommitCapture(ctx, event)
	if err != nil || receipt.Outcome != core.HookCaptureCommitted {
		t.Fatalf("receipt: %+v, %v", receipt, err)
	}
	var phase, observed string
	var observedAt, ended uint64
	if err := store.db.QueryRowContext(ctx, `SELECT json_extract(driver_state,'$.activity.state'),json_extract(driver_state,'$.observed.model'),
		json_extract(driver_state,'$.observed.observedAtMs'),(SELECT ended_ms FROM wake_turns)
		FROM identity_session_preferences WHERE identity_id=?`, bindingOwnerID).Scan(&phase, &observed, &observedAt, &ended); err != nil || phase != "idle" || observed != model || observedAt != 10000 || ended != 10000 {
		t.Fatalf("stop state: %q %q %d %d, %v", phase, observed, observedAt, ended, err)
	}

	// The blocked Stop ended the turn, but the provider is still continuing.
	assertDigestContinuation(t, store, true)
	event.ID = hookID2
	c.Continuation, c.Response, c.NowMs = true, nil, 10100
	receipt, err = store.CommitCapture(ctx, event)
	if err != nil || receipt.Outcome != core.HookCaptureCommitted {
		t.Fatalf("continuation Stop receipt: %+v, %v", receipt, err)
	}
	assertDigestContinuation(t, store, false)

	handOverDigestContinuation(t, store, digestTestNext, digestTestNextToken, core.DigestStateUncertain)
	assertDigestContinuation(t, store, true)
	current := currentDigestBinding(t, store)
	prompt := ports.DigestPromptObservation{Expected: current, Owner: *current.Session.LaunchOwner,
		Runtime: *current.Session.Runtime, ProviderSession: "old-session", ObservedAtMs: 10200}
	for _, reject := range []func(*ports.DigestPromptObservation){
		func(p *ports.DigestPromptObservation) { p.Expected.ID = bindingID2 },
		func(p *ports.DigestPromptObservation) { p.ProviderSession = "different-session" },
		func(p *ports.DigestPromptObservation) { p.Runtime.PID++ },
	} {
		wrong := prompt
		reject(&wrong)
		writeBindingTest(t, store, func(tx ports.StoreTx) error {
			ok, err := tx.Bindings().ObserveDigestPrompt(wrong)
			requireBindingChange(t, ok, err, false)
			return nil
		})
		assertDigestContinuation(t, store, true)
	}
	if _, err := store.db.ExecContext(ctx, "UPDATE identity_session_preferences SET provider_session_id='different-session' WHERE identity_id=?", bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		ok, err := tx.Bindings().ObserveDigestPrompt(prompt)
		requireBindingChange(t, ok, err, false)
		return nil
	})
	assertDigestContinuation(t, store, true)
	if _, err := store.db.ExecContext(ctx, "UPDATE identity_session_preferences SET provider_session_id='old-session' WHERE identity_id=?", bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		ok, err := tx.Bindings().ObserveDigestPrompt(prompt)
		requireBindingChange(t, ok, err, true)
		return nil
	})
	assertDigestContinuation(t, store, false)

	handOverDigestContinuation(t, store, "0f63bced-e4c4-4e66-8d59-965427581f72",
		"f2285bd5-97ff-48c1-bffc-8ee7220c9d28", core.DigestStateDefinitelyUnsent)
	assertDigestContinuation(t, store, false)
}
