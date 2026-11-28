package storage

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestLaunchActivityStagesOnlyExistingUnexpiredMatchingIntent(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	binding := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	observation := ports.LaunchActivityObservation{
		Expected: binding, Owner: core.ProcessIncarnation{PID: 666, StartIdentity: "owner"},
		Runtime:         core.ProcessIncarnation{PID: 777, StartIdentity: "runtime"},
		ProviderSession: "session", Transition: core.LaunchTransitionStarted, InitialIdle: true, ObservedAtMs: 2600,
	}
	observe := func(in ports.LaunchActivityObservation, want bool) {
		t.Helper()
		writeBindingTest(t, store, func(tx ports.StoreTx) error {
			ok, err := tx.Bindings().ObserveLaunchActivity(in)
			requireBindingChange(t, ok, err, want)
			return nil
		})
	}
	observe(observation, false)
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte("[[],[]]")))
	if _, err := store.db.ExecContext(t.Context(), `INSERT INTO launch_observations
		(binding_id, owner_pid, owner_start, driver, created_at_ms, expires_at_ms, preferences_fingerprint)
		VALUES (?, ?, ?, 'claude', 2500, 2700, ?)`, binding.ID, observation.Owner.PID, observation.Owner.StartIdentity, digest); err != nil {
		t.Fatal(err)
	}
	next := observation
	next.Owner.StartIdentity = "reused"
	observe(next, false)
	next = observation
	next.ObservedAtMs = 2700
	observe(next, false)
	if _, err := store.db.ExecContext(t.Context(), "INSERT INTO identity_session_preferences(identity_id,preferred_harness) VALUES (?,'codex')", bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	observe(observation, false)
	if _, err := store.db.ExecContext(t.Context(), "DELETE FROM identity_session_preferences WHERE identity_id=?", bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	observe(observation, true)
	observe(observation, false)

	var status, runtimeState, transition string
	var driverState []byte
	var pid uint64
	err := store.db.QueryRowContext(t.Context(), `SELECT l.status,b.runtime_state,l.provider_transition,l.driver_state,l.provider_pid
		FROM launch_observations l JOIN bindings b ON b.id=l.binding_id WHERE b.id=?`, binding.ID).
		Scan(&status, &runtimeState, &transition, &driverState, &pid)
	if err != nil || status != "pending" || runtimeState != "unknown" || transition != "started" || pid != observation.Runtime.PID {
		t.Fatalf("staged observation = %q %q %q %d, %v", status, runtimeState, transition, pid, err)
	}
	var state struct {
		Activity launchActivity `json:"activity"`
	}
	if err := json.Unmarshal(driverState, &state); err != nil || state.Activity.State != "idle" ||
		state.Activity.Session != observation.ProviderSession || state.Activity.SinceMs != observation.ObservedAtMs {
		t.Fatalf("staged activity = %+v, %v", state, err)
	}
}

func TestAdmittedLaunchActivityPreservesAnyExistingExactTurn(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	binding := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	ctx := t.Context()
	if _, err := store.db.ExecContext(ctx, `UPDATE bindings SET runtime_state='running',last_transition='resumed',
		runtime_pid=777,runtime_start_identity='runtime',observed_provider_session_id='session',
		launch_owner_pid=666,launch_owner_start_identity='owner' WHERE id=?`, binding.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO identity_session_preferences
		(identity_id,remembered_harness,runtime_mode,provider_session_id) VALUES (?,'claude','default','session')`, bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	var observation ports.LaunchActivityObservation
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		current, err := tx.Bindings().FindByIdentity(bindingOwnerID)
		if err != nil {
			return err
		}
		observation = ports.LaunchActivityObservation{
			Expected: *current, Owner: *current.Session.LaunchOwner, Runtime: *current.Session.Runtime,
			ProviderSession: "session", Transition: core.LaunchTransitionResumed, InitialIdle: true, ObservedAtMs: 2500,
		}
		stale := observation
		stale.Runtime.StartIdentity = "newer-process"
		ok, err := tx.Bindings().ObserveLaunchActivity(stale)
		requireBindingChange(t, ok, err, false)
		ok, err = tx.Bindings().ObserveLaunchActivity(observation)
		requireBindingChange(t, ok, err, true)
		return nil
	})
	var saved string
	if err := store.db.QueryRowContext(ctx, "SELECT driver_state FROM identity_session_preferences WHERE identity_id=?", bindingOwnerID).Scan(&saved); err != nil {
		t.Fatal(err)
	}
	var state struct {
		Activity launchActivity `json:"activity"`
	}
	if err := json.Unmarshal([]byte(saved), &state); err != nil || state.Activity.State != "idle" || state.Activity.SinceMs != 2500 {
		t.Fatalf("admitted startup state = %s, %v", saved, err)
	}
	const activeTurn = `{"activity":{"session":"session","pid":777,"start":"runtime","state":"busy","turn":"turn","sinceMs":2600,"lastActivityMs":2700}}`
	if _, err := store.db.ExecContext(ctx, "UPDATE identity_session_preferences SET driver_state=? WHERE identity_id=?", activeTurn, bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		observation.ObservedAtMs = 2800
		ok, err := tx.Bindings().ObserveLaunchActivity(observation)
		requireBindingChange(t, ok, err, true)
		return nil
	})
	if err := store.db.QueryRowContext(ctx, "SELECT driver_state FROM identity_session_preferences WHERE identity_id=?", bindingOwnerID).Scan(&saved); err != nil || saved != activeTurn {
		t.Fatalf("startup replay changed active turn: %s, %v", saved, err)
	}
}
