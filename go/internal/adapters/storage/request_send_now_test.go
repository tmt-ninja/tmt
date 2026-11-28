package storage

import (
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

const sendNowID core.RequestID = "req_11223344-5566-4777-8888-9999aabbccdd"
const sendNowOther core.RequestID = "req_11223344-5566-4777-8888-9999aabbccee"

func requireClaim(t *testing.T, s *RequestService, q core.ReleasedWakeQuery) core.ReleasedWakeProof {
	t.Helper()
	claim, err := s.ClaimReleasedWake(t.Context(), q)
	if err != nil || !claim.Claimed || claim.State != core.WakeClaimed || claim.Generation == nil || claim.DigestUntilMs != nil {
		t.Fatalf("wake claim = %+v, %v", claim, err)
	}
	return core.ReleasedWakeProof{RequestID: q.RequestID, RecipientID: q.RecipientID, Generation: *claim.Generation}
}

func TestSendNowReleasesOnlyExactIncomingHoldAndUsesNativeSelector(t *testing.T) {
	parallelStorageFixture(t)
	store, service, _ := seedRequestService(t)
	ctx := t.Context()
	for _, id := range []core.RequestID{sendNowID, sendNowOther} {
		if _, err := service.Enqueue(ctx, inboxRequest(id)); err != nil {
			t.Fatal(err)
		}
		if _, err := store.db.ExecContext(ctx, `INSERT INTO focus_items(identity_id,request_id,kind,source,created_at_ms)
			VALUES ('receiver',?,'review','incoming',10000)`, id); err != nil {
			t.Fatal(err)
		}
	}
	_, err := service.ReleaseSendNow(ctx, "11223344", "sender")
	failure := requireRequestFailure(t, err, "USAGE_ERROR", 1)
	if !strings.HasPrefix(failure.Message, "Request-ID prefix is ambiguous: ") ||
		!strings.Contains(failure.Message, string(sendNowID)+", "+string(sendNowOther)) {
		t.Fatalf("ambiguous prefix = %s", failure.Message)
	}
	_, err = service.ReleaseSendNow(ctx, "99887766", "sender")
	requireRequestFailure(t, err, "SEND_NOW_NOT_FOUND", 3)
	_, err = service.ReleaseSendNow(ctx, core.RequestRef(sendNowID), "other")
	requireRequestFailure(t, err, "SEND_NOW_NOT_ALLOWED", 1)

	person := core.IdentityID("other")
	if _, err := store.db.ExecContext(ctx, "INSERT INTO identity_metadata VALUES (?,'user','true')", person); err != nil {
		t.Fatal(err)
	}
	prefix := core.RequestRef(strings.TrimSuffix(string(sendNowID), "dd"))
	// The two IDs share this shorter prefix, so narrow it by one hex digit.
	prefix += "d"
	release, err := service.ReleaseSendNow(ctx, prefix, person)
	if err != nil || release.RequestID != sendNowID || release.RecipientID != "receiver" || release.Already != nil {
		t.Fatalf("selected release = %+v, %v", release, err)
	}
	var first, second, urgent bool
	err = store.db.QueryRowContext(ctx, `SELECT
		EXISTS(SELECT 1 FROM focus_items WHERE request_id=?1),
		EXISTS(SELECT 1 FROM focus_items WHERE request_id=?2),
		(SELECT urgent FROM request_delivery_policies WHERE request_id=?1)`, sendNowID, sendNowOther).Scan(&first, &second, &urgent)
	if err != nil || first || !second || !urgent {
		t.Fatalf("release touched wrong evidence: first %t second %t urgent %t, %v", first, second, urgent, err)
	}
}

func TestSendNowFreshGenerationRefusesDelayedSettlementAfterReopen(t *testing.T) {
	parallelStorageFixture(t)
	store, service, clock := seedRequestService(t)
	ctx := t.Context()
	input := inboxRequest(sendNowID)
	if _, err := service.Enqueue(ctx, input); err != nil {
		t.Fatal(err)
	}
	if release, err := service.ReleaseSendNow(ctx, core.RequestRef(sendNowID), "sender"); err != nil || release.Already != nil {
		t.Fatalf("released = %+v, %v", release, err)
	}
	query := core.ReleasedWakeQuery{RequestID: sendNowID, RecipientID: "receiver"}
	old := requireClaim(t, service, query)
	other := NewRequestService(store, clock)
	if clash, err := other.ClaimReleasedWake(ctx, query); err != nil || clash.Claimed ||
		clash.Generation != nil || clash.State != core.WakeClaimed {
		t.Fatalf("competing process claimed the same request: %+v, %v", clash, err)
	}
	if _, err := other.ReadClaimedWake(ctx, old); err == nil {
		t.Fatal("a different service used the old capability")
	}
	if err := service.SettleReleasedWake(ctx, core.ReleasedWakeSettlement{Proof: old, Outcome: core.WakeUnavailable}); err != nil {
		t.Fatal(err)
	}
	if actual, err := other.ClaimReleasedWake(ctx, query); err != nil || actual.Claimed || actual.State != core.WakeUnavailable {
		t.Fatalf("unavailable wake reopened without release: %+v, %v", actual, err)
	}
	if release, err := service.ReleaseSendNow(ctx, core.RequestRef(sendNowID), "sender"); err != nil || release.Already != nil {
		t.Fatalf("reopened = %+v, %v", release, err)
	}
	fresh := requireClaim(t, service, query)
	if fresh.Generation == old.Generation {
		t.Fatal("reopened request reused generation")
	}
	requireRequestFailure(t, service.SettleReleasedWake(ctx, core.ReleasedWakeSettlement{Proof: old, Outcome: core.WakeSent}),
		"REQUEST_STATE_ERROR", 1)
	_, err := service.ReadClaimedWake(ctx, old)
	requireRequestFailure(t, err, "REQUEST_STATE_ERROR", 1)
	payload, err := service.ReadClaimedWake(ctx, fresh)
	if err != nil || payload == nil || payload.Attempt.RequestID != sendNowID || payload.Message != input.Message || payload.SenderName != "sender" || payload.ThreadRoot != nil {
		t.Fatalf("fresh exact payload = %+v, %v", payload, err)
	}
	if err := service.SettleReleasedWake(ctx, core.ReleasedWakeSettlement{Proof: fresh, Outcome: core.WakeSent}); err != nil {
		t.Fatal(err)
	}
	var wake core.WakeState
	var incoming, acknowledged, outgoing uint64
	err = store.db.QueryRowContext(ctx, `SELECT wake_state,recipient_attention_revision,
		recipient_attention_acknowledged_revision,attention_acknowledged_revision FROM request_attempts WHERE request_id=?`, sendNowID).
		Scan(&wake, &incoming, &acknowledged, &outgoing)
	if err != nil || wake != core.WakeSent || incoming == 0 || acknowledged != incoming || outgoing != 0 {
		t.Fatalf("terminal attention = %q receiver %d/%d sender %d, %v", wake, acknowledged, incoming, outgoing, err)
	}
	release, err := other.ReleaseSendNow(ctx, core.RequestRef(sendNowID), "sender")
	if err != nil || release.Already == nil || *release.Already != core.SendNowAlreadyDelivered {
		t.Fatalf("already delivered = %+v, %v", release, err)
	}
}

func TestSendNowNeverReplaysUncertainAndRechecksClosedBeforePaste(t *testing.T) {
	parallelStorageFixture(t)
	store, service, clock := seedRequestService(t)
	ctx := t.Context()
	input := inboxRequest(sendNowID)
	if _, err := service.Enqueue(ctx, input); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ReleaseSendNow(ctx, core.RequestRef(sendNowID), "sender"); err != nil {
		t.Fatal(err)
	}
	deadline := uint64(clock.ms) + 50
	query := core.ReleasedWakeQuery{RequestID: sendNowID, RecipientID: "receiver", ReceiptDeadlineMs: &deadline}
	proof := requireClaim(t, service, query)
	other := NewRequestService(store, clock)
	clock.ms += 60
	pending, err := other.ClaimReleasedWake(ctx, core.ReleasedWakeQuery{RequestID: sendNowID, RecipientID: "receiver"})
	if err != nil || pending.Claimed || pending.State != core.WakeUncertain || pending.Generation != nil {
		t.Fatalf("expired lost claim is not terminal: %+v, %v", pending, err)
	}
	if payload, err := service.ReadClaimedWake(ctx, proof); err != nil || payload != nil {
		t.Fatalf("expired receipt granted a payload: %+v, %v", payload, err)
	}
	_, err = service.ReleaseSendNow(ctx, core.RequestRef(sendNowID), "sender")
	requireRequestFailure(t, err, "SEND_NOW_UNCONFIRMED", 1)
	if err := service.SettleReleasedWake(ctx, core.ReleasedWakeSettlement{Proof: proof, Outcome: core.WakeUncertain}); err != nil {
		t.Fatal(err)
	}

	otherInput := inboxRequest(sendNowOther)
	prepared, err := service.Enqueue(ctx, otherInput)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ReleaseSendNow(ctx, core.RequestRef(sendNowOther), "sender"); err != nil {
		t.Fatal(err)
	}
	closed := requireClaim(t, service, core.ReleasedWakeQuery{RequestID: sendNowOther, RecipientID: "receiver"})
	if _, err := service.SubmitResponse(ctx, core.SubmitResponse{RequestID: sendNowOther, Receipt: prepared.Receipt, Body: "closed during probe"}); err != nil {
		t.Fatal(err)
	}
	if got, err := service.ReadClaimedWake(ctx, closed); err != nil || got != nil {
		t.Fatalf("closed request still granted payload: %+v, %v", got, err)
	}
	if err := service.SettleReleasedWake(ctx, core.ReleasedWakeSettlement{Proof: closed, Outcome: core.WakeUnavailable}); err != nil {
		t.Fatal(err)
	}
	_, err = other.ReleaseSendNow(ctx, core.RequestRef(sendNowOther), "sender")
	requireRequestFailure(t, err, "SEND_NOW_CLOSED", 1)
}

func TestSendNowProjectsExactRetainedThreadRoot(t *testing.T) {
	parallelStorageFixture(t)
	store, service, clock := seedRequestService(t)
	ctx := t.Context()
	root := inboxRequest(sendNowOther)
	root.Message = "\r\nReview the saved sketch.\nSecond line. "
	child := inboxRequest(sendNowID)
	child.Message = "On it."
	for _, input := range []core.PrepareRequest{root, child} {
		if _, err := service.Enqueue(ctx, input); err != nil {
			t.Fatal(err)
		}
	}
	const updateRoot = "UPDATE request_attempts SET thread_root_request_id=? WHERE request_id=?"
	if _, err := store.db.ExecContext(ctx, updateRoot, root.RequestID, child.RequestID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ReleaseSendNow(ctx, core.RequestRef(child.RequestID), "sender"); err != nil {
		t.Fatal(err)
	}
	proof := requireClaim(t, service, core.ReleasedWakeQuery{RequestID: child.RequestID, RecipientID: "receiver"})
	readRoot := func(t *testing.T, wantID core.RequestID, wantText *string) {
		t.Helper()
		payload, err := service.ReadClaimedWake(t.Context(), proof)
		if err != nil || payload == nil || payload.Message != child.Message || payload.ThreadRoot == nil {
			t.Fatalf("threaded payload = %+v, %v", payload, err)
		}
		got := payload.ThreadRoot
		if got.RequestID != wantID || (got.Text == nil) != (wantText == nil) ||
			(wantText != nil && *got.Text != *wantText) {
			t.Fatalf("thread root = %+v, want ID %s and text %v", got, wantID, wantText)
		}
	}

	readRoot(t, root.RequestID, &root.Message)
	if _, err := store.db.ExecContext(ctx, "UPDATE request_attempts SET message_expires_at_ms=? WHERE request_id=?", clock.ms, root.RequestID); err != nil {
		t.Fatal(err)
	}
	readRoot(t, root.RequestID, nil)
	if _, err := store.db.ExecContext(ctx, "UPDATE request_attempts SET message_expires_at_ms=?,retention_expires_at_ms=? WHERE request_id=?",
		clock.ms+1, clock.ms, root.RequestID); err != nil {
		t.Fatal(err)
	}
	readRoot(t, root.RequestID, nil)
	missingRoot := core.RequestID("req_00112233-4455-4666-8777-8899aabbccdd")
	if _, err := store.db.ExecContext(ctx, updateRoot, missingRoot, child.RequestID); err != nil {
		t.Fatal(err)
	}
	readRoot(t, missingRoot, nil)
}
