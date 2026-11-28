package storage

import (
	"path/filepath"
	"reflect"
	"slices"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const roomDispatchOperation core.DispatchOperationID = "b93903f5-4c38-4e1b-81ea-2bc7cfe40fdc"
const otherDispatchOperation core.DispatchOperationID = "6e6bccf7-e661-4390-bc3a-cd9bcb3b7511"

func roomDispatchFixture(t *testing.T) (*Storage, *RequestService, core.RoomDispatchInput) {
	t.Helper()
	store := bindingFixture(t)
	sender := bindingOwnerID
	input := core.RoomDispatchInput{
		OperationID: roomDispatchOperation, RoomID: testRoomID, Kind: core.RequestKindRequest, RetentionDays: 7,
		RecipientIDs: []core.IdentityID{bindingOtherID, bindingOwnerID, bindingOtherID},
		Message:      "  exact 🦀\r\n room text\x00  ",
		Originator:   core.Originator{Kind: core.OriginatorExplicit, IdentityID: &sender},
	}
	room := putRoomFixture(t, store, testRoomID, core.RoomWrite{Name: "Dispatch room", MemberIDs: input.RecipientIDs})
	input.Revision = room.Revision
	return store, NewRequestService(store, &requestClock{ms: 10_000}), input
}

type dispatchReplayClock struct{}

func (dispatchReplayClock) NowMs() int64 { panic("dispatch replay read the clock") }

func assertDispatchRows(t *testing.T, store *Storage, operations, attempts int) {
	t.Helper()
	var actualOperations, actualAttempts int
	err := store.db.QueryRowContext(t.Context(), `SELECT
		(SELECT COUNT(*) FROM office_dispatch_operations), (SELECT COUNT(*) FROM request_attempts)`).
		Scan(&actualOperations, &actualAttempts)
	if err != nil || actualOperations != operations || actualAttempts != attempts {
		t.Fatalf("dispatch rows = (%d, %d), want (%d, %d), %v", actualOperations, actualAttempts, operations, attempts, err)
	}
}

func TestRoomDispatchDigestMatchesCurrentNativeBytes(t *testing.T) {
	sender := core.IdentityID("71f0da70-d145-40b3-90c7-44ab8c2d5942")
	const recipient core.IdentityID = "804aba9c-6c6b-4b31-a32b-e85fa0431445"
	// Native storage::dispatch_request and the resulting office ledger,
	// generated from main's adapter for exactly these inputs.
	for _, tc := range []struct {
		kind core.RequestKind
		op   core.DispatchOperationID
		want string
	}{
		{core.RequestKindRequest, "22222222-2222-4222-8222-222222222222", "f4cbf01c784a8956e0ad22259d8f53f8a09ecece945d5d0fae03ed840123c12a"},
		{core.RequestKindAnnouncement, "33333333-3333-4333-8333-333333333333", "06149987c27f13d1dbbeaaaae90277ea5286da7244888c122491da06efa5e7f1"},
	} {
		in, ok := (core.RoomDispatchInput{
			OperationID: tc.op, RoomID: testRoomID, Revision: 1, RecipientIDs: []core.IdentityID{recipient, recipient},
			Kind: tc.kind, Message: " <&> \u2028日本\x00\r\n ", RetentionDays: 7,
			Originator: core.Originator{Kind: core.OriginatorExplicit, IdentityID: &sender},
		}).Normalize()
		if !ok {
			t.Fatal("native input did not normalize")
		}
		if got, err := roomDispatchDigest(in); err != nil || got != tc.want {
			t.Fatalf("digest for %s = %s, %v, want %s", tc.kind, got, err, tc.want)
		}
	}
}

func TestRoomDispatchFreezesAudienceAndConflictsNeverWrite(t *testing.T) {
	parallelStorageFixture(t)
	store, service, input := roomDispatchFixture(t)
	ctx := t.Context()
	receipt, err := service.DispatchRoom(ctx, input)
	if err != nil || !receipt.Valid() || receipt.CreatedAtMs != 10_000 || len(receipt.Items) != 2 {
		t.Fatalf("dispatch receipt = %+v, %v", receipt, err)
	}
	for _, item := range receipt.Items {
		if item.Acceptance != core.DispatchQueued {
			t.Fatalf("acceptance = %+v", item)
		}
		detail, err := service.ShowX(ctx, item.RecipientID, core.XIncoming, item.RequestID)
		if err != nil || detail.Prompt == nil || *detail.Prompt != input.Message || detail.Receipt == nil ||
			detail.Exchange.RoomID == nil || *detail.Exchange.RoomID != input.RoomID {
			t.Fatalf("incoming dispatch = %+v, %v", detail, err)
		}
		var origin, provenance string
		if err := store.db.QueryRowContext(ctx, "SELECT origin,originator_kind FROM request_attempts WHERE request_id=?", item.RequestID).
			Scan(&origin, &provenance); err != nil || origin != "person" || provenance != "explicit" {
			t.Fatalf("dispatch origin = %q/%q, %v", origin, provenance, err)
		}
	}
	before := roomFixtureCursor(t, store)
	noClock := NewRequestService(store, dispatchReplayClock{})
	for _, change := range []func(*core.RoomDispatchInput){
		func(in *core.RoomDispatchInput) { in.Message += "\n" },
		func(in *core.RoomDispatchInput) { in.RecipientIDs = []core.IdentityID{bindingOtherID} },
		func(in *core.RoomDispatchInput) { in.Originator.Kind = core.OriginatorVerified },
		func(in *core.RoomDispatchInput) { in.Kind = core.RequestKindAnnouncement },
		func(in *core.RoomDispatchInput) { in.Revision++ },
	} {
		conflict := input
		change(&conflict)
		_, err := noClock.DispatchRoom(ctx, conflict)
		requireRequestFailure(t, err, "DISPATCH_IDEMPOTENCY_CONFLICT", 1)
		assertDispatchRows(t, store, 1, 2)
		if cursor := roomFixtureCursor(t, store); cursor != before {
			t.Fatalf("conflict changed cursor: %d to %d", before, cursor)
		}
	}
	_, err = writeRoomFixture(t, store, func(repo ports.RoomRepo) (core.MeetingRoom, error) {
		return repo.Retire(testRoomID, input.Revision)
	})
	if err != nil {
		t.Fatal(err)
	}
	input.RecipientIDs = []core.IdentityID{bindingOwnerID, bindingOtherID}
	input.RetentionDays = 1
	before = roomFixtureCursor(t, store)
	got, err := noClock.DispatchRoom(ctx, input)
	if err != nil || !reflect.DeepEqual(got, receipt) || roomFixtureCursor(t, store) != before {
		t.Fatalf("replay after retirement = %+v, %v, want %+v", got, err, receipt)
	}
	newIntent := input
	newIntent.OperationID = otherDispatchOperation
	_, err = noClock.DispatchRoom(ctx, newIntent)
	requireRequestFailure(t, err, "ROOM_ROSTER_CHANGED", 1)
	assertDispatchRows(t, store, 1, 2)
}

func TestRoomBroadcastHasNoReplyAndRosterRevisionFencesActiveAudience(t *testing.T) {
	parallelStorageFixture(t)
	store, service, input := roomDispatchFixture(t)
	ctx := t.Context()
	input.Kind = core.RequestKindAnnouncement
	editResumeFixture(t, store, "UPDATE identities SET retired_at_ms=11000 WHERE id=?", bindingOtherID)
	before := roomFixtureCursor(t, store)
	_, err := NewRequestService(store, dispatchReplayClock{}).DispatchRoom(ctx, input)
	requireRequestFailure(t, err, "ROOM_ROSTER_CHANGED", 1)
	if roomFixtureCursor(t, store) != before {
		t.Fatal("roster refusal changed the cursor")
	}
	assertDispatchRows(t, store, 0, 0)
	input.RecipientIDs = []core.IdentityID{bindingOwnerID}
	receipt, err := service.DispatchRoom(ctx, input)
	if err != nil || len(receipt.Items) != 1 {
		t.Fatalf("broadcast = %+v, %v", receipt, err)
	}
	id := receipt.Items[0].RequestID
	detail, err := service.ShowX(ctx, bindingOwnerID, core.XIncoming, id)
	if err != nil || detail.Receipt != nil || detail.Exchange.Kind != core.XAnnouncement ||
		detail.Exchange.Final.Status != core.FinalNotRequired || detail.Exchange.RoomID == nil || *detail.Exchange.RoomID != input.RoomID {
		t.Fatalf("broadcast detail = %+v, %v", detail, err)
	}
	final, err := service.Result(ctx, id)
	if err != nil || final.Status != core.ResponseNotRequired {
		t.Fatalf("broadcast result = %+v, %v", final, err)
	}
}

func TestRoomDispatchReceiptFailureRollsBackAndRetryPublishesOnce(t *testing.T) {
	parallelStorageFixture(t)
	store, service, input := roomDispatchFixture(t)
	ctx := t.Context()
	editResumeFixture(t, store, `CREATE TRIGGER reject_dispatch_receipt BEFORE INSERT ON office_dispatch_operations
		BEGIN SELECT RAISE(ABORT, 'fixture dispatch receipt failure'); END`)
	before := roomFixtureCursor(t, store)
	receipt, err := service.DispatchRoom(ctx, input)
	if err == nil || receipt.OperationID != "" {
		t.Fatalf("failed commit returned receipt = %+v, %v", receipt, err)
	}
	assertDispatchRows(t, store, 0, 0)
	if roomFixtureCursor(t, store) != before {
		t.Fatal("receipt error left request effects")
	}
	editResumeFixture(t, store, "DROP TRIGGER reject_dispatch_receipt")

	db, err := openSQLite(filepath.Join(filepath.Dir(store.path), home.DatabaseName))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	other := NewRequestService(&Storage{db: db, path: store.path}, &requestClock{ms: 20_000})
	type result struct {
		receipt core.DispatchReceipt
		err     error
	}
	results := make(chan result, 2)
	start := make(chan struct{})
	for _, candidate := range []*RequestService{service, other} {
		go func() {
			<-start
			got, err := candidate.DispatchRoom(ctx, input)
			results <- result{got, err}
		}()
	}
	close(start)
	first, second := <-results, <-results
	if first.err != nil || second.err != nil || !first.receipt.Valid() || !reflect.DeepEqual(first.receipt, second.receipt) {
		t.Fatalf("concurrent replay = %+v and %+v", first, second)
	}
	assertDispatchRows(t, store, 1, 2)
}

func TestRoomDispatchUsesNativeRouteGrantsAndTalkLimit(t *testing.T) {
	parallelStorageFixture(t)
	store, service, input := roomDispatchFixture(t)
	ctx := t.Context()
	const third core.IdentityID = "44444444-4444-4444-8444-444444444444"
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		return tx.Identities().Insert(core.Identity{ID: third, Name: "Casey", CanonicalName: "casey", Lifetime: core.LifetimeSaved}, 1000)
	})
	input.RecipientIDs = []core.IdentityID{third, bindingOtherID}
	room := putRoomFixture(t, store, testRoomID, core.RoomWrite{
		ExpectedRevision: input.Revision, Name: "Dispatch room", MemberIDs: input.RecipientIDs,
	})
	input.Revision = room.Revision
	editResumeFixture(t, store, "INSERT INTO orchestration_settings VALUES (1,9,'UTC')")
	editResumeFixture(t, store, `INSERT INTO orchestration_plans(id,name,revision,priority,enabled,schedule,fields)
		VALUES (?,'Outbound',1,1,1,'{"kind":"always"}','{"sending":"paused","talkLimit":1}')`, orchPlanID)
	editResumeFixture(t, store, "INSERT INTO orchestration_plan_targets(plan_id,position,target) VALUES (?,0,'{\"kind\":\"all\"}')", orchPlanID)
	editResumeFixture(t, store, "INSERT INTO orchestration_route_grants(from_id,to_id,until_ms) VALUES (?,?,20000)", bindingOwnerID, bindingOtherID)

	dispatch := func(op core.DispatchOperationID, want core.DispatchAcceptance) core.DispatchReceipt {
		t.Helper()
		input.OperationID = op
		result, err := service.DispatchRoom(ctx, input)
		if err != nil || len(result.Items) != 2 {
			t.Fatalf("policy dispatch = %+v, %v", result, err)
		}
		for _, item := range result.Items {
			if item.RecipientID == bindingOtherID && item.Acceptance != want ||
				item.RecipientID == third && item.Acceptance != core.DispatchRestricted {
				t.Fatalf("policy acceptance = %+v, want %s for granted recipient", result, want)
			}
		}
		return result
	}
	dispatch(roomDispatchOperation, core.DispatchQueued)
	held := dispatch(otherDispatchOperation, core.DispatchHeld)
	index := slices.IndexFunc(held.Items, func(i core.DispatchItem) bool { return i.RecipientID == bindingOtherID })
	heldRequest := held.Items[index].RequestID
	assertDispatchRows(t, store, 2, 2)
	var status core.AttemptStatus
	var incoming, expires uint64
	err := store.db.QueryRowContext(ctx, `SELECT status,recipient_attention_revision,expires_at_ms
		FROM request_attempts WHERE request_id=?`, heldRequest).Scan(&status, &incoming, &expires)
	if err != nil || status != core.AttemptPrepared || incoming != 0 || expires != 10_000+orchPersonHoldMs {
		t.Fatalf("held attempt = %v %d %d, %v", status, incoming, expires, err)
	}
	decisions, err := store.ReadJournal(ctx, core.OrchJournalQuery{
		Subject: core.OrchJournalSubject{Kind: core.OrchSubjectRequest, ID: string(heldRequest)}, NowMs: 10000, Limit: 10,
	})
	if err != nil || len(decisions.Items) != 2 || decisions.Items[0].Reason != "route_grant" || decisions.Items[1].Reason != "talk_limit" {
		t.Fatalf("hold journal = %+v, %v", decisions, err)
	}
	block, err := store.ReadJournal(ctx, core.OrchJournalQuery{
		Subject: core.OrchJournalSubject{Kind: core.OrchSubjectIdentity, ID: string(bindingOwnerID)}, NowMs: 10000, Limit: 10,
	})
	if err != nil || len(block.Items) != 1 || block.Items[0].Reason != "route_restricted" {
		t.Fatalf("coalesced route refusal journal = %+v, %v", block, err)
	}
}
