package storage

import (
	"errors"
	"path/filepath"
	"reflect"
	"slices"
	"sync"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const testRoomID core.RoomID = "11111111-1111-4111-8111-111111111111"
const secondRoomID core.RoomID = "22222222-2222-4222-8222-222222222222"
const thirdRoomID core.RoomID = "33333333-3333-4333-8333-333333333333"

func writeRoomFixture(t *testing.T, store *Storage, action func(ports.RoomRepo) (core.MeetingRoom, error)) (core.MeetingRoom, error) {
	t.Helper()
	var room core.MeetingRoom
	err := store.Write(t.Context(), func(tx ports.StoreTx) error {
		var err error
		room, err = action(tx.Rooms())
		return err
	})
	return room, err
}

func putRoomFixture(t *testing.T, store *Storage, id core.RoomID, input core.RoomWrite) core.MeetingRoom {
	t.Helper()
	room, err := writeRoomFixture(t, store, func(repo ports.RoomRepo) (core.MeetingRoom, error) {
		return repo.Put(id, input)
	})
	if err != nil {
		t.Fatal(err)
	}
	return room
}

func readRoomFixture(t *testing.T, store *Storage, id core.RoomID) core.MeetingRoom {
	t.Helper()
	var found *core.MeetingRoom
	if err := store.Read(t.Context(), func(tx ports.StoreTx) error {
		var err error
		found, err = tx.Rooms().FindHistorical(id)
		return err
	}); err != nil || found == nil {
		t.Fatalf("historical room %s = %+v, %v", id, found, err)
	}
	return *found
}

func requireRoomFailure(t *testing.T, err error, code string) {
	t.Helper()
	var failure *core.RoomFailure
	if !errors.As(err, &failure) || failure.Code != code {
		t.Fatalf("Room error = %v, want %s", err, code)
	}
}

func roomFixtureCursor(t *testing.T, store *Storage) uint64 {
	t.Helper()
	var cursor uint64
	if err := store.db.QueryRowContext(t.Context(), "SELECT value FROM change_cursor WHERE id=1").Scan(&cursor); err != nil {
		t.Fatal(err)
	}
	return cursor
}

func TestRoomOfflineRosterRoundTripsWithCASAndEffectiveMembership(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	input := core.RoomWrite{Name: "Design room", MemberIDs: []core.IdentityID{bindingOtherID, bindingOwnerID, bindingOtherID}}
	wantMembers := []core.IdentityID{bindingOwnerID, bindingOtherID}
	slices.Sort(wantMembers)
	room := putRoomFixture(t, store, testRoomID, input)
	if room.Revision != 1 || !slices.Equal(room.MemberIDs, wantMembers) ||
		!slices.Equal(input.MemberIDs, []core.IdentityID{bindingOtherID, bindingOwnerID, bindingOtherID}) {
		t.Fatalf("initial roster=%+v input=%+v", room, input)
	}
	_, err := writeRoomFixture(t, store, func(repo ports.RoomRepo) (core.MeetingRoom, error) {
		return repo.Put(testRoomID, core.RoomWrite{Name: room.Name})
	})
	requireRoomFailure(t, err, "ROOM_REVISION_CONFLICT")
	cursor := roomFixtureCursor(t, store)
	input.ExpectedRevision = room.Revision
	if got := putRoomFixture(t, store, testRoomID, input); !reflect.DeepEqual(got, room) ||
		roomFixtureCursor(t, store) != cursor {
		t.Fatalf("identical save changed room, cursor or membership: %+v", got)
	}
	// Active rooms use exact name and then UUID order, including duplicate names.
	putRoomFixture(t, store, secondRoomID, core.RoomWrite{Name: room.Name})
	putRoomFixture(t, store, thirdRoomID, core.RoomWrite{Name: "Before design"})
	root := home.Root{Dir: filepath.Dir(store.path), Database: store.path}
	other, err := Open(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := other.Close(); err != nil {
			t.Error(err)
		}
	})
	if err := other.Read(t.Context(), func(tx ports.StoreTx) error {
		rooms, err := tx.Rooms().ListActive()
		if err != nil {
			return err
		}
		if len(rooms) != 3 || rooms[0].ID != thirdRoomID || rooms[2].ID != secondRoomID || !reflect.DeepEqual(rooms[1], room) {
			t.Fatalf("reopened active list = %+v", rooms)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	editResumeFixture(t, store, "UPDATE identities SET retired_at_ms=3000 WHERE id=?", bindingOtherID)
	effective := readRoomFixture(t, other, testRoomID)
	if effective.Revision != room.Revision || !slices.Equal(effective.MemberIDs, []core.IdentityID{bindingOwnerID}) {
		t.Fatalf("retired member changed room revision or stayed active: %+v", effective)
	}
	_, err = writeRoomFixture(t, store, func(repo ports.RoomRepo) (core.MeetingRoom, error) {
		return repo.Put(testRoomID, input)
	})
	requireRoomFailure(t, err, "ROOM_IDENTITY_INACTIVE")
	empty := putRoomFixture(t, store, testRoomID, core.RoomWrite{ExpectedRevision: 1, Name: room.Name})
	if empty.Revision != 2 || empty.MemberIDs == nil || len(empty.MemberIDs) != 0 {
		t.Fatalf("saved empty roster = %+v", empty)
	}
}

func TestRoomMembershipEditsAreIdempotentAndRollBackOnLateFailure(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	original := putRoomFixture(t, store, testRoomID, core.RoomWrite{Name: "Design room", MemberIDs: []core.IdentityID{bindingOtherID}})
	putRoomFixture(t, store, secondRoomID, core.RoomWrite{Name: "Another room"})
	change := func(id core.RoomID, member core.IdentityID, op core.RoomMembershipChange) (core.MeetingRoom, error) {
		t.Helper()
		return writeRoomFixture(t, store, func(repo ports.RoomRepo) (core.MeetingRoom, error) {
			return repo.ChangeMembership(id, member, op)
		})
	}
	joined, err := change(testRoomID, bindingOwnerID, core.RoomMembershipJoin)
	if err != nil || joined.Revision != 2 || len(joined.MemberIDs) != 2 {
		t.Fatalf("join = %+v, %v", joined, err)
	}
	cursor := roomFixtureCursor(t, store)
	replay, err := change(testRoomID, bindingOwnerID, core.RoomMembershipJoin)
	if err != nil || !reflect.DeepEqual(replay, joined) || roomFixtureCursor(t, store) != cursor {
		t.Fatalf("join replay = %+v, %v", replay, err)
	}
	other, err := change(secondRoomID, bindingOwnerID, core.RoomMembershipJoin)
	if err != nil || !slices.Equal(other.MemberIDs, []core.IdentityID{bindingOwnerID}) {
		t.Fatalf("separate room join = %+v, %v", other, err)
	}
	left, err := change(testRoomID, bindingOwnerID, core.RoomMembershipLeave)
	if err != nil || left.Revision != 3 || !slices.Equal(left.MemberIDs, original.MemberIDs) {
		t.Fatalf("leave = %+v, %v", left, err)
	}
	cursor = roomFixtureCursor(t, store)
	replay, err = change(testRoomID, bindingOwnerID, core.RoomMembershipLeave)
	if err != nil || !reflect.DeepEqual(replay, left) || roomFixtureCursor(t, store) != cursor {
		t.Fatalf("leave replay = %+v, %v", replay, err)
	}
	_, err = change(testRoomID, core.IdentityID(thirdRoomID), core.RoomMembershipJoin)
	requireRoomFailure(t, err, "ROOM_IDENTITY_INACTIVE")
	editResumeFixture(t, store, `CREATE TRIGGER reject_room_member BEFORE INSERT ON office_meeting_members
		BEGIN SELECT RAISE(ABORT, 'fixture late membership failure'); END`)
	if _, err := change(testRoomID, bindingOwnerID, core.RoomMembershipJoin); err == nil {
		t.Fatal("late membership failure committed")
	}
	if got := readRoomFixture(t, store, testRoomID); !reflect.DeepEqual(got, left) || roomFixtureCursor(t, store) != cursor {
		t.Fatalf("late join failure changed room or cursor: %+v", got)
	}
	if got := readRoomFixture(t, store, secondRoomID); !reflect.DeepEqual(got, other) {
		t.Fatalf("another room changed: %+v", got)
	}
}

func TestConcurrentRoomJoinsPreserveExistingRoster(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	casey := core.IdentityID("44444444-4444-4444-8444-444444444444")
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		return tx.Identities().Insert(core.Identity{ID: casey, Name: "Casey", CanonicalName: "casey", Lifetime: core.LifetimeSaved}, 2000)
	})
	putRoomFixture(t, store, testRoomID, core.RoomWrite{Name: "Design room", MemberIDs: []core.IdentityID{casey}})
	root := home.Root{Dir: filepath.Dir(store.path), Database: store.path}
	other, err := Open(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := other.Close(); err != nil {
			t.Error(err)
		}
	})
	start := make(chan struct{})
	results := make(chan error, 2)
	var ready sync.WaitGroup
	for _, caller := range []struct {
		store *Storage
		id    core.IdentityID
	}{{store, bindingOwnerID}, {other, bindingOtherID}} {
		ready.Add(1)
		go func() {
			ready.Done()
			<-start
			results <- caller.store.Write(t.Context(), func(tx ports.StoreTx) error {
				_, err := tx.Rooms().ChangeMembership(testRoomID, caller.id, core.RoomMembershipJoin)
				return err
			})
		}()
	}
	ready.Wait()
	close(start)
	for i := 0; i < cap(results); i++ {
		if err := <-results; err != nil {
			t.Error(err)
		}
	}
	want := []core.IdentityID{bindingOwnerID, bindingOtherID, casey}
	slices.Sort(want)
	if room := readRoomFixture(t, store, testRoomID); room.Revision != 3 || !slices.Equal(room.MemberIDs, want) {
		t.Fatalf("concurrent joins = %+v, want %v", room, want)
	}
}

func TestRoomRetirementPreservesHistoricalRosterAndReplaysAtMaxRevision(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	original := putRoomFixture(t, store, testRoomID, core.RoomWrite{Name: "Design room", MemberIDs: []core.IdentityID{bindingOwnerID}})
	retire := func(revision uint64) (core.MeetingRoom, error) {
		t.Helper()
		return writeRoomFixture(t, store, func(repo ports.RoomRepo) (core.MeetingRoom, error) {
			return repo.Retire(testRoomID, revision)
		})
	}
	_, err := retire(2)
	requireRoomFailure(t, err, "ROOM_REVISION_CONFLICT")
	if got := readRoomFixture(t, store, testRoomID); !reflect.DeepEqual(got, original) {
		t.Fatalf("revision conflict changed room: %+v", got)
	}
	editResumeFixture(t, store, `CREATE TRIGGER reject_room_retire BEFORE UPDATE OF retired ON office_meeting_rooms
		BEGIN SELECT RAISE(ABORT, 'fixture retirement failure'); END`)
	cursor := roomFixtureCursor(t, store)
	if _, err := retire(1); err == nil {
		t.Fatal("injected retirement failure committed")
	}
	if got := readRoomFixture(t, store, testRoomID); !reflect.DeepEqual(got, original) || roomFixtureCursor(t, store) != cursor {
		t.Fatalf("failed retirement changed room or cursor: %+v", got)
	}
	editResumeFixture(t, store, "DROP TRIGGER reject_room_retire")
	const last = core.MaxJSSafeInteger
	editResumeFixture(t, store, "UPDATE office_meeting_rooms SET revision=? WHERE room_id=?", last-1, testRoomID)
	retired, err := retire(last - 1)
	if err != nil || !retired.Retired || retired.Revision != last || !slices.Equal(retired.MemberIDs, original.MemberIDs) {
		t.Fatalf("retired room = %+v, %v", retired, err)
	}
	cursor = roomFixtureCursor(t, store)
	for _, revision := range []uint64{last - 1, last} {
		replay, err := retire(revision)
		if err != nil || !reflect.DeepEqual(replay, retired) || roomFixtureCursor(t, store) != cursor {
			t.Fatalf("retire replay = %+v, %v", replay, err)
		}
	}
	_, err = retire(last + 1)
	requireRoomFailure(t, err, "ROOM_INVALID")
	if err := store.Read(t.Context(), func(tx ports.StoreTx) error {
		repo := tx.Rooms()
		rooms, err := repo.ListActive()
		if err != nil || len(rooms) != 0 {
			t.Fatalf("active rooms after retirement = %+v, %v", rooms, err)
		}
		got, err := repo.FindActive(testRoomID)
		if err != nil || got != nil {
			t.Fatalf("active lookup after retirement = %+v, %v", got, err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if got := readRoomFixture(t, store, testRoomID); !reflect.DeepEqual(got, retired) {
		t.Fatalf("historical room = %+v", got)
	}
	_, err = writeRoomFixture(t, store, func(repo ports.RoomRepo) (core.MeetingRoom, error) {
		return repo.Put(testRoomID, core.RoomWrite{Name: original.Name})
	})
	requireRoomFailure(t, err, "ROOM_RETIRED")
	_, err = writeRoomFixture(t, store, func(repo ports.RoomRepo) (core.MeetingRoom, error) {
		return repo.ChangeMembership(testRoomID, bindingOwnerID, core.RoomMembershipLeave)
	})
	requireRoomFailure(t, err, "ROOM_NOT_FOUND")
	replacement := putRoomFixture(t, store, secondRoomID, core.RoomWrite{Name: original.Name})
	if replacement.ID == original.ID || len(replacement.MemberIDs) != 0 {
		t.Fatalf("replacement reused historical roster: %+v", replacement)
	}
}

func TestRoomWriteRejectsInvalidNamesAndOversizedRosterBeforeDeduplication(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	members := make([]core.IdentityID, 65)
	for i := range members {
		members[i] = bindingOwnerID
	}
	for _, input := range []core.RoomWrite{
		{Name: "  "},
		{Name: "literal\nline"},
		{Name: "Design room", MemberIDs: members},
		{Name: "Design room", MemberIDs: []core.IdentityID{"not-a-uuid"}},
	} {
		_, err := writeRoomFixture(t, store, func(repo ports.RoomRepo) (core.MeetingRoom, error) {
			return repo.Put(testRoomID, input)
		})
		requireRoomFailure(t, err, "ROOM_INVALID")
	}
	room := putRoomFixture(t, store, testRoomID, core.RoomWrite{Name: " Design room ", MemberIDs: members[:64]})
	if room.Name != " Design room " || !slices.Equal(room.MemberIDs, []core.IdentityID{bindingOwnerID}) || room.Revision != 1 {
		t.Fatalf("normalization changed the name or valid duplicate roster: %+v", room)
	}
}
