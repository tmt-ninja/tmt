package storage

import (
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const (
	bindingOwnerID core.IdentityID = "04de7153-8b12-4665-8fba-718e358fa68c"
	bindingOtherID core.IdentityID = "f54672ae-5a6f-4d3b-92a6-bfef8480d66c"
	bindingID1     core.BindingID  = "6c57fcc9-96b1-4022-b071-870b81288814"
	bindingID2     core.BindingID  = "8ef77f8d-ee4e-4468-b327-34edda97075a"
)

func bindingFixture(t *testing.T) *Storage {
	t.Helper()
	store := testStorage(t)
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		if err := tx.Identities().Insert(core.Identity{
			ID: bindingOwnerID, Name: "Alice", CanonicalName: "alice", Lifetime: core.LifetimeSaved, AutoNamed: true,
		}, 1000); err != nil {
			return err
		}
		return tx.Identities().Insert(core.Identity{
			ID: bindingOtherID, Name: "Bob", CanonicalName: "bob", Lifetime: core.LifetimeTemporary,
		}, 1000)
	})
	return store
}

func reservationFixture(id core.BindingID, owner core.IdentityID, pane string) core.BindingReservation {
	start := "pane-start"
	return core.BindingReservation{
		Target: core.Binding{
			ID: id, IdentityID: owner, PaneID: pane, PanePID: 789, PaneIncarnation: &start,
			Server: core.ServerEvidence{Host: "tmux", ID: "server-id", Socket: "/tmp/go-fixture.sock", PID: 456, StartTime: "server-start"},
		},
		Publisher:   core.ProcessIncarnation{PID: 123, StartIdentity: "publisher-start"},
		CreatedAtMs: 2000, ExpiresAtMs: 3000,
	}
}

func writeBindingTest(t *testing.T, store *Storage, provide func(ports.StoreTx) error) {
	t.Helper()
	if err := store.Write(t.Context(), provide); err != nil {
		t.Fatal(err)
	}
}

func requireBindingChange(t *testing.T, changed bool, err error, want bool) {
	t.Helper()
	if err != nil || changed != want {
		t.Fatalf("binding change = %t, %v, want %t", changed, err, want)
	}
}

func publishBindingFixture(t *testing.T, store *Storage, reservation core.BindingReservation) core.Binding {
	t.Helper()
	var binding *core.Binding
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		reserved, err := tx.Bindings().Reserve(reservation, nil)
		requireBindingChange(t, reserved, err, true)
		return nil
	})
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		var err error
		binding, err = tx.Bindings().Activate(reservation, nil, 2100)
		return err
	})
	if binding == nil {
		t.Fatal("activation returned no binding")
	}
	return *binding
}

func TestBindingReservationAndMoveFence(t *testing.T) {
	store := bindingFixture(t)
	original := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	move := reservationFixture(bindingID2, bindingOwnerID, "%2")
	move.OldBindingID = &original.ID

	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		reserved, err := tx.Bindings().Reserve(move, &original)
		requireBindingChange(t, reserved, err, true)
		return nil
	})
	if err := store.Read(t.Context(), func(tx ports.StoreTx) error {
		bindings := tx.Bindings()
		byIdentity, err := bindings.FindReservationByIdentity(bindingOwnerID)
		if err != nil || !sameReservation(byIdentity, move) {
			t.Fatalf("reservation by identity = %+v, %v", byIdentity, err)
		}
		byEndpoint, err := bindings.FindReservationByEndpoint(move.Target.EndpointKey())
		if err != nil || !sameReservation(byEndpoint, move) {
			t.Fatalf("reservation by endpoint = %+v, %v", byEndpoint, err)
		}
		byID, err := bindings.FindByIdentity(bindingOwnerID)
		if err != nil || !matchBinding(byID, &original, false) {
			t.Fatalf("move lost old ownership before activation: %+v, %v", byID, err)
		}
		published, err := bindings.FindByEndpoint(move.Target.EndpointKey())
		if err != nil || published != nil {
			t.Fatalf("reserved endpoint appeared active: %+v, %v", published, err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		bindings := tx.Bindings()
		competitor := reservationFixture("a937752d-02bb-41d6-9831-e6fb6a9f414d", bindingOtherID, "%2")
		ok, err := bindings.Reserve(competitor, nil)
		requireBindingChange(t, ok, err, false)
		ok, err = bindings.Detach(original)
		requireBindingChange(t, ok, err, false)
		stale := move
		stale.Publisher.StartIdentity = "other-publisher"
		ok, err = bindings.ReleaseReservation(stale)
		requireBindingChange(t, ok, err, false)
		if got, err := bindings.Activate(stale, &original, 2100); got != nil || err != nil {
			t.Fatalf("wrong publisher activated move: %+v, %v", got, err)
		}
		if got, err := bindings.Activate(move, &original, move.ExpiresAtMs); got != nil || err != nil {
			t.Fatalf("expired reservation activated move: %+v, %v", got, err)
		}
		return nil
	})
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		b, err := tx.Bindings().Activate(move, &original, 2500)
		if err != nil || b == nil || b.ID != bindingID2 || b.PaneID != "%2" {
			t.Fatalf("activation = %+v, %v", b, err)
		}
		return nil
	})
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		bindings := tx.Bindings()
		ok, err := bindings.Detach(original)
		requireBindingChange(t, ok, err, false)
		ok, err = bindings.Touch(original, 2600)
		requireBindingChange(t, ok, err, false)
		pending, err := bindings.FindReservationByIdentity(bindingOwnerID)
		if err != nil || pending != nil {
			t.Fatalf("consumed reservation = %+v, %v", pending, err)
		}
		previous, err := bindings.FindByEndpoint(original.EndpointKey())
		if err != nil || previous != nil {
			t.Fatalf("old endpoint was still active: %+v, %v", previous, err)
		}
		return nil
	})
}

func TestBindingMoveAdmitsOnlyTheSameSettledRuntime(t *testing.T) {
	store := bindingFixture(t)
	binding := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	if _, err := store.db.ExecContext(t.Context(), `UPDATE bindings SET runtime_state='running', last_transition='started',
		runtime_pid=125,runtime_start_identity='runtime', observed_provider_session_id='session',
		launch_owner_pid=126,launch_owner_start_identity='owner' WHERE id=?`, binding.ID); err != nil {
		t.Fatal(err)
	}
	var old *core.Binding
	move := reservationFixture(bindingID2, bindingOwnerID, "%2")
	move.OldBindingID = &binding.ID
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		var err error
		old, err = tx.Bindings().FindByIdentity(bindingOwnerID)
		if err != nil {
			return err
		}
		ok, err := tx.Bindings().Reserve(move, old)
		requireBindingChange(t, ok, err, true)
		return nil
	})
	if _, err := store.db.ExecContext(t.Context(), "UPDATE bindings SET runtime_pid=444 WHERE id=?", binding.ID); err != nil {
		t.Fatal(err)
	}
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		got, err := tx.Bindings().Activate(move, old, 2200)
		if err != nil || got != nil {
			t.Fatalf("stale runtime activated move: %+v, %v", got, err)
		}
		return nil
	})
	if _, err := store.db.ExecContext(t.Context(), "UPDATE bindings SET runtime_pid=125,runtime_state='ended',last_transition='ended' WHERE id=?", binding.ID); err != nil {
		t.Fatal(err)
	}
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		got, err := tx.Bindings().Activate(move, old, 2400)
		if err != nil || got == nil || got.ID != bindingID2 {
			t.Fatalf("same runtime settled before move: %+v, %v", got, err)
		}
		return nil
	})
}

func TestRenameAndRetirePreserveIdentityHistory(t *testing.T) {
	store := bindingFixture(t)
	binding := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	request := inboxRequest("preserved-request")
	request.Route.Recipient, request.Recipient = new(bindingOwnerID), new(bindingOwnerID)
	request.Originator.IdentityID = new(bindingOtherID)
	service := NewRequestService(store, &requestClock{ms: 2500})
	if _, err := service.Enqueue(t.Context(), request); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		"INSERT INTO identity_metadata VALUES (?, 'user', 'true')",
		"INSERT INTO identity_hooks VALUES ('capture', ?, 'local', 'registered', 0)",
		"INSERT INTO preamble_counters VALUES (?, 2, 2500)",
	} {
		if _, err := store.db.ExecContext(t.Context(), sql, bindingOwnerID); err != nil {
			t.Fatal(err)
		}
	}
	name, err := core.ValidateName("ALICE")
	if err != nil {
		t.Fatal(err)
	}
	var prior, renamed *core.Identity
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		var err error
		prior, err = tx.Identities().FindByID(bindingOwnerID)
		if err != nil {
			return err
		}
		renamed, err = tx.Identities().Rename(*prior, name, 2600)
		if err != nil || renamed == nil || renamed.ID != bindingOwnerID || renamed.Name != "ALICE" || renamed.AutoNamed {
			t.Fatalf("rename result = %+v, %v", renamed, err)
		}
		return nil
	})
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		ok, err := tx.Identities().Retire(*prior, &binding, true, 2700)
		requireBindingChange(t, ok, err, false)
		ok, err = tx.Identities().Retire(*renamed, nil, true, 2700)
		requireBindingChange(t, ok, err, false)
		ok, err = tx.Identities().Retire(*renamed, &binding, true, 2700)
		requireBindingChange(t, ok, err, true)
		return tx.Identities().Insert(core.Identity{
			ID: "3a276f55-b1e3-452b-84d4-8d32eea88013", Name: "Alice", CanonicalName: "alice", Lifetime: core.LifetimeSaved,
		}, 2800)
	})
	for query, want := range map[string]string{
		"SELECT COUNT(*) FROM bindings WHERE identity_id=?":                   "0",
		"SELECT COUNT(*) FROM identity_metadata WHERE identity_id=?":          "0",
		"SELECT state FROM identity_hooks WHERE identity_id=?":                "pending",
		"SELECT reserved_count FROM preamble_counters WHERE identity_id=?":    "2",
		"SELECT COUNT(*) FROM request_attempts WHERE recipient_identity_id=?": "1",
	} {
		var got string
		if err := store.db.QueryRowContext(t.Context(), query, bindingOwnerID).Scan(&got); err != nil || got != want {
			t.Errorf("%s = %q, %v, want %q", query, got, err, want)
		}
	}
}
