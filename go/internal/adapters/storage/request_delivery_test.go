package storage

import (
	"reflect"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

func TestDeliveryMergesHeldCountdownAndApprovalAcrossInboxAndX(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	ctx := t.Context()
	first, _ := seedDigestRequest(t, store, 1, false)
	second, _ := seedDigestRequest(t, store, 2, false)
	binding := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	if _, err := store.db.ExecContext(ctx, `UPDATE focus_items SET created_at_ms=10600 WHERE request_id=?`, second); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE bindings SET runtime_state='running',runtime_pid=601,
		runtime_start_identity='runtime',launch_owner_pid=600,launch_owner_start_identity='owner',
		observed_provider_session_id='session' WHERE id=?`, binding.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO identity_session_preferences
		(identity_id,preferred_harness,remembered_harness,runtime_mode,provider_session_id,driver_state_version,driver_state)
		VALUES (?,'claude','claude','default','session',3,
		'{"activity":{"session":"session","pid":601,"start":"runtime","state":"waiting","turn":null,"sinceMs":11000,"lastActivityMs":11000}}')`,
		bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	limit := uint64(8000)
	if _, err := store.WritePolicy(ctx, core.DigestPolicyWrite{IdentityID: bindingOwnerID, OwnerID: bindingOtherID,
		SetterID: bindingOtherID, UntilMs: 30000, MaxHoldMs: &limit, NowMs: 11000}); err != nil {
		t.Fatal(err)
	}
	clock := &requestClock{ms: 12_000}
	service := NewRequestService(store, clock)
	check := func(latest uint64, canSend bool) {
		t.Helper()
		inbox, err := service.Inbox(ctx, core.InboxQuery{Recipient: bindingOwnerID})
		if err != nil || len(inbox.Items) != 2 {
			t.Fatalf("inbox = %+v, %v", inbox, err)
		}
		x, err := service.ListX(ctx, core.XQuery{Identity: bindingOwnerID, Direction: core.XIncoming})
		if err != nil || len(x.Items) != 2 {
			t.Fatalf("X page = %+v, %v", x, err)
		}
		show, err := service.ShowX(ctx, bindingOwnerID, core.XIncoming, second)
		if err != nil {
			t.Fatal(err)
		}
		remaining := latest - min(latest, uint64(clock.ms))
		want := core.DeliveryView{
			State: "batched", Reason: "held_to_save_usage", ReasonText: "batched to save usage, sends when the agent finishes this turn",
			LatestMs: &latest, RemainingMs: &remaining, CanSendNow: canSend,
		}
		for _, got := range []core.DeliveryView{inbox.Items[0].MessageState, inbox.Items[1].MessageState,
			x.Items[0].MessageState, x.Items[1].MessageState, show.Exchange.MessageState} {
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("shared view = %+v, want %+v", got, want)
			}
		}
	}
	check(18_500, false)
	_, err := service.ReleaseSendNow(ctx, core.RequestRef(first), bindingOtherID)
	failure := requireRequestFailure(t, err, "SEND_NOW_NOT_AVAILABLE", 1)
	if failure.Message != "Could not send now: batched to save usage, sends when the agent finishes this turn" {
		t.Fatal(failure.Message)
	}
	if _, err := store.SyncReceiving(ctx, core.DigestReceivingWrite{Enabled: true,
		Default: core.OrchReceiving{Mode: core.OrchReceivingBatch, IntervalMs: 60_000}}); err != nil {
		t.Fatal(err)
	}
	check(70_500, false)
	clock.ms = 30_000
	check(18_500, false)
	clock.ms = 12_000
	if _, err := store.db.ExecContext(ctx, "INSERT INTO identity_metadata VALUES (?,'user','true')", bindingOtherID); err != nil {
		t.Fatal(err)
	}
	check(18_500, false)
	if _, err := store.db.ExecContext(ctx, "UPDATE identity_metadata SET value='false' WHERE identity_id=? AND key='user'", bindingOtherID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE identity_session_preferences
		SET driver_state=json_set(driver_state,'$.activity.pid',777) WHERE identity_id=?`, bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	check(70_500, true)
	if _, err := service.ReleaseSendNow(ctx, core.RequestRef(first), bindingOtherID); err != nil {
		t.Fatalf("activity for a superseded runtime blocked send now: %v", err)
	}
}

func TestDeliveryUsesRetainedPassthroughWindowAndTurnEnd(t *testing.T) {
	parallelStorageFixture(t)
	store, service, clock := seedRequestService(t)
	ctx := t.Context()
	if _, err := service.Enqueue(ctx, inboxRequest(sendNowID)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, "UPDATE request_attempts SET wake_state='sent' WHERE request_id=?", sendNowID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, "INSERT INTO request_turns VALUES (?,10000,11000)", sendNowID); err != nil {
		t.Fatal(err)
	}
	show := func(reason string) {
		t.Helper()
		x, err := service.ShowX(ctx, "receiver", core.XIncoming, sendNowID)
		if err != nil || x.Exchange.MessageState.State != "unconfirmed" || x.Exchange.MessageState.Reason != reason {
			t.Fatalf("delivery = %+v, %v, want %s", x.Exchange.MessageState, err, reason)
		}
	}
	show("turn_ended_without_reply")
	if _, err := store.db.ExecContext(ctx, `INSERT INTO request_passthrough(request_id,delivered_at_ms,state)
		VALUES (?,10000,'pending')`, sendNowID); err != nil {
		t.Fatal(err)
	}
	clock.ms = 10_000 + int64(core.DeliveryBindWindowMs)
	show("turn_ended_without_reply")
	clock.ms++
	show("no_turn_started")
}
