package storage

import (
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestEndLaunchRefusesSupersededRuntimeAndSettlesOnlyExactCapture(t *testing.T) {
	store := bindingFixture(t)
	binding := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	ctx := t.Context()
	recordRuntime := func(pid uint64, start string) core.Binding {
		t.Helper()
		if _, err := store.db.ExecContext(ctx, `UPDATE bindings SET runtime_state='running',last_transition='started',
			runtime_pid=?,runtime_start_identity=?,observed_provider_session_id='session',
			launch_owner_pid=600,launch_owner_start_identity='owner' WHERE id=?`, pid, start, binding.ID); err != nil {
			t.Fatal(err)
		}
		var current *core.Binding
		if err := store.Read(ctx, func(tx ports.StoreTx) error {
			var err error
			current, err = tx.Bindings().FindByIdentity(bindingOwnerID)
			return err
		}); err != nil || current == nil {
			t.Fatalf("fixture binding = %+v, %v", current, err)
		}
		return *current
	}
	old := recordRuntime(601, "old-runtime")
	current := recordRuntime(601, "new-runtime") // PID reuse with a different incarnation.
	if _, err := store.db.ExecContext(ctx, `INSERT INTO identity_session_preferences
		(identity_id,preferred_harness,remembered_harness,runtime_mode,provider_session_id,channel)
		VALUES (?,'claude','claude','default','session',1)`, bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	for id, owner := range map[string]core.IdentityID{"matching": bindingOwnerID, "unrelated": bindingOtherID} {
		if _, err := store.db.ExecContext(ctx, `INSERT INTO capture_batches
			(id,identity_id,binding_id,driver,session_id,runtime_pid,runtime_start,created_ms)
			VALUES (?,?,?,'claude','session',601,'new-runtime',2900)`, id, owner, binding.ID); err != nil {
			t.Fatal(err)
		}
	}
	end := ports.LaunchEnd{
		Expected: old, Owner: *old.Session.LaunchOwner, Runtime: *old.Session.Runtime, ObservedAtMs: 3000,
	}
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		ok, err := tx.Bindings().EndLaunch(end)
		requireBindingChange(t, ok, err, false)
		found, err := tx.Bindings().FindByIdentity(bindingOwnerID)
		if err != nil || !matchBinding(found, &current, false) {
			t.Fatalf("stale end changed the newer binding: %+v, %v", found, err)
		}
		return nil
	})
	var before *uint64
	if err := store.db.QueryRowContext(ctx, "SELECT closed_ms FROM capture_batches WHERE id='matching'").Scan(&before); err != nil || before != nil {
		t.Fatalf("stale end closed current capture: %v, %v", before, err)
	}
	end.Expected, end.Owner, end.Runtime = current, *current.Session.LaunchOwner, *current.Session.Runtime
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		ok, err := tx.Bindings().EndLaunch(end)
		requireBindingChange(t, ok, err, true)
		ok, err = tx.Bindings().EndLaunch(end)
		requireBindingChange(t, ok, err, false)
		ended, err := tx.Bindings().FindByIdentity(bindingOwnerID)
		if err != nil || ended == nil || ended.Session.RuntimeState != "ended" ||
			ended.Session.LastTransition == nil || *ended.Session.LastTransition != "ended" ||
			ended.Session.ProviderSessionID == nil || *ended.Session.ProviderSessionID != "session" {
			t.Fatalf("ended binding = %+v, %v", ended, err)
		}
		ok, err = tx.Bindings().CreateLaunchIntent(ports.LaunchIntent{
			Expected: *ended, Owner: core.ProcessIncarnation{PID: 700, StartIdentity: "next-owner"},
			Driver: core.DriverClaude, CreatedAtMs: 3100, ExpiresAtMs: 4100,
		})
		requireBindingChange(t, ok, err, true)
		return nil
	})
	var matching, unrelated *uint64
	if err := store.db.QueryRowContext(ctx, `SELECT
		(SELECT closed_ms FROM capture_batches WHERE id='matching'),
		(SELECT closed_ms FROM capture_batches WHERE id='unrelated')`).Scan(&matching, &unrelated); err != nil || matching == nil || *matching != 3000 || unrelated != nil {
		t.Fatalf("matching and unrelated close times = %v and %v, %v", matching, unrelated, err)
	}
	var remembered string
	var channel bool
	if err := store.db.QueryRowContext(ctx, "SELECT provider_session_id,channel FROM identity_session_preferences WHERE identity_id=?",
		bindingOwnerID).Scan(&remembered, &channel); err != nil || remembered != "session" || !channel {
		t.Fatalf("end changed session preferences: %q, %t, %v", remembered, channel, err)
	}
}
