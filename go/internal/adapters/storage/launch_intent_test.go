package storage

import (
	"encoding/json"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestLaunchIntentAdmitsMatchingStagedClaudeEvidence(t *testing.T) {
	t.Parallel()
	store := bindingFixture(t)
	binding := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	ctx := t.Context()
	if _, err := store.db.ExecContext(ctx, `INSERT INTO identity_session_preferences
		(identity_id,preferred_harness,remembered_harness,runtime_mode,provider_session_id,channel)
		VALUES (?,'codex','codex','default','older-session',1)`, bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	intent := ports.LaunchIntent{
		Expected: binding, Owner: core.ProcessIncarnation{PID: 601, StartIdentity: "owner"},
		Driver: core.DriverClaude, CreatedAtMs: 2500, ExpiresAtMs: 3000,
	}
	child := core.ProcessIncarnation{PID: 602, StartIdentity: "child"}
	var observed *core.Binding
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		repo := tx.Bindings()
		for range 2 {
			ok, err := repo.CreateLaunchIntent(intent)
			requireBindingChange(t, ok, err, true)
		}
		wrong := intent
		wrong.ExpiresAtMs++
		ok, err := repo.CreateLaunchIntent(wrong)
		requireBindingChange(t, ok, err, false)
		observed, err = repo.FindByIdentity(bindingOwnerID)
		return err
	})
	if !matchBinding(observed, &binding, false) {
		t.Fatalf("intent creation changed the binding: %+v", observed)
	}
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		ok, err := tx.Bindings().ObserveLaunchActivity(ports.LaunchActivityObservation{
			Expected: binding, Owner: intent.Owner, Runtime: child, ProviderSession: "new-session",
			Transition: core.LaunchTransitionResumed, InitialIdle: true, ObservedAtMs: 2600,
		})
		requireBindingChange(t, ok, err, true)
		return nil
	})
	attempt := ports.LaunchAdmission{Intent: intent, Runtime: child, ObservedAtMs: 2700}
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		repo := tx.Bindings()
		mismatch := attempt
		mismatch.Runtime.StartIdentity = "reused-child"
		if got, err := repo.AdmitLaunch(mismatch); err != nil || got != nil {
			t.Fatalf("mismatched staged runtime = %+v, %v", got, err)
		}
		mismatch = attempt
		mismatch.Intent.Owner.StartIdentity = "reused-owner"
		if got, err := repo.AdmitLaunch(mismatch); err != nil || got != nil {
			t.Fatalf("mismatched owner = %+v, %v", got, err)
		}
		mismatch = attempt
		mismatch.ObservedAtMs = intent.ExpiresAtMs
		if got, err := repo.AdmitLaunch(mismatch); err != nil || got != nil {
			t.Fatalf("expired launch = %+v, %v", got, err)
		}
		return nil
	})
	if _, err := store.db.ExecContext(ctx, "UPDATE identity_session_preferences SET channel=0 WHERE identity_id=?", bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		if got, err := tx.Bindings().AdmitLaunch(attempt); err != nil || got != nil {
			t.Fatalf("changed preferences admitted stale launch: %+v, %v", got, err)
		}
		return nil
	})
	if _, err := store.db.ExecContext(ctx, "UPDATE identity_session_preferences SET channel=1 WHERE identity_id=?", bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		admitted, err := tx.Bindings().AdmitLaunch(attempt)
		if err != nil {
			return err
		}
		if admitted == nil || admitted.Session.RuntimeState != "running" || admitted.Session.Runtime == nil ||
			*admitted.Session.Runtime != child || admitted.Session.LaunchOwner == nil || *admitted.Session.LaunchOwner != intent.Owner ||
			admitted.Session.ProviderSessionID == nil || *admitted.Session.ProviderSessionID != "new-session" ||
			admitted.Session.LastTransition == nil || *admitted.Session.LastTransition != string(core.LaunchTransitionResumed) {
			t.Fatalf("admitted binding = %+v", admitted)
		}
		return nil
	})
	var driver, session, document string
	if err := store.db.QueryRowContext(ctx, `SELECT remembered_harness,provider_session_id,driver_state
		FROM identity_session_preferences WHERE identity_id=?`, bindingOwnerID).Scan(&driver, &session, &document); err != nil {
		t.Fatal(err)
	}
	var state struct {
		Activity launchActivity `json:"activity"`
	}
	if err := json.Unmarshal([]byte(document), &state); err != nil || state.Activity.SinceMs != 2600 ||
		state.Activity.State != "idle" || session != "new-session" || driver != "claude" {
		t.Fatalf("session preferences = %q %q %+v, %v", driver, session, state, err)
	}
	var oldSession string
	var channel bool
	err := store.db.QueryRowContext(ctx, `SELECT provider_session_id,channel
		FROM identity_resume_records WHERE identity_id=? AND harness='codex'`, bindingOwnerID).Scan(&oldSession, &channel)
	if err != nil || oldSession != "older-session" || !channel {
		t.Fatalf("previous provider record = %q %t, %v", oldSession, channel, err)
	}
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		if got, err := tx.Bindings().AdmitLaunch(attempt); err != nil || got != nil {
			t.Fatalf("admission replay = %+v, %v", got, err)
		}
		return nil
	})
}

func TestLaunchAdmissionWithoutStagedEvidenceDoesNotInventSessionOrActivity(t *testing.T) {
	t.Parallel()
	store := bindingFixture(t)
	binding := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	intent := ports.LaunchIntent{
		Expected: binding, Owner: core.ProcessIncarnation{PID: 601, StartIdentity: "owner"},
		Driver: core.DriverCodex, CreatedAtMs: 2500, ExpiresAtMs: 3000,
	}
	attempt := ports.LaunchAdmission{
		Intent: intent, Runtime: core.ProcessIncarnation{PID: 602, StartIdentity: "child"}, ObservedAtMs: 2700,
	}
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		repo := tx.Bindings()
		if got, err := repo.AdmitLaunch(attempt); err != nil || got != nil {
			t.Fatalf("missing intent admitted runtime: %+v, %v", got, err)
		}
		bad := intent
		bad.Driver = core.DriverName("unregistered")
		ok, err := repo.CreateLaunchIntent(bad)
		requireBindingChange(t, ok, err, false)
		ok, err = repo.CreateLaunchIntent(intent)
		requireBindingChange(t, ok, err, true)
		return nil
	})

	// Fault the last write to demonstrate that the runtime update rolls back.
	if _, err := store.db.ExecContext(t.Context(), `CREATE TRIGGER reject_admission BEFORE UPDATE ON launch_observations
		WHEN NEW.status='admitted' BEGIN SELECT RAISE(ABORT,'fixture admission rollback'); END`); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(t.Context(), func(tx ports.StoreTx) error {
		_, err := tx.Bindings().AdmitLaunch(attempt)
		return err
	}); err == nil {
		t.Fatal("admission with a failed final write unexpectedly succeeded")
	}
	if _, err := store.db.ExecContext(t.Context(), "DROP TRIGGER reject_admission"); err != nil {
		t.Fatal(err)
	}
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		repo := tx.Bindings()
		current, err := repo.FindByIdentity(bindingOwnerID)
		if err != nil || !matchBinding(current, &binding, false) {
			t.Fatalf("runtime was changed despite rollback: %+v, %v", current, err)
		}
		got, err := repo.AdmitLaunch(attempt)
		if err != nil || got == nil || got.Session.RuntimeState != "running" || got.Session.Runtime == nil ||
			*got.Session.Runtime != attempt.Runtime || got.Session.ProviderSessionID != nil {
			t.Fatalf("sessionless admission = %+v, %v", got, err)
		}
		return nil
	})
	var count int
	if err := store.db.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM identity_session_preferences").Scan(&count); err != nil || count != 0 {
		t.Fatalf("sessionless admission invented preferences: %d, %v", count, err)
	}
	var status string
	if err := store.db.QueryRowContext(t.Context(), "SELECT status FROM launch_observations WHERE binding_id=?", binding.ID).
		Scan(&status); err != nil || status != "admitted" {
		t.Fatalf("launch intent status = %q, %v", status, err)
	}
}
