package storage

import (
	"errors"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const savedResumeSession = "ed3e0815-19b0-468f-897d-c4217150d2df"

func seedResumeFixture(t *testing.T, store *Storage) {
	t.Helper()
	editResumeFixture(t, store, `INSERT INTO identity_session_preferences
		(identity_id,preferred_harness,remembered_harness,runtime_mode,provider_session_id,
		 driver_state_version,driver_state,channel)
		VALUES(?,'codex','claude','default',?,2,'{"state":"saved"}',0)`, bindingOwnerID, savedResumeSession)
}

func editResumeFixture(t *testing.T, store *Storage, sql string, args ...any) {
	t.Helper()
	if _, err := store.db.ExecContext(t.Context(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

func resumeFixtureSnapshot(t *testing.T, store *Storage, id core.IdentityID) *core.ResumeSnapshot {
	t.Helper()
	var result *core.ResumeSnapshot
	if err := store.Read(t.Context(), func(tx ports.StoreTx) error {
		var err error
		result, err = tx.Bindings().ReadResume(id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return result
}

func requireResumeFailure(t *testing.T, err error, code, reason string) {
	t.Helper()
	var failure *core.RequestFailure
	if !errors.As(err, &failure) || failure.Code != code || failure.Reason != reason || failure.Message == "" {
		t.Fatalf("resume failure = %#v (%v), want %s/%s", failure, err, code, reason)
	}
}

func TestReadResumePinsExactActiveIdentityAndStoredEvidence(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	if result := resumeFixtureSnapshot(t, store, "alice"); result != nil {
		t.Fatalf("UUID read fell back to canonical name: %+v", result)
	}
	empty := resumeFixtureSnapshot(t, store, bindingOtherID)
	if empty == nil || empty.Selected != nil || empty.PriorBinding != nil || empty.Fence.Version != resumeFenceVersion {
		t.Fatalf("unbound identity without a saved session = %+v", empty)
	}
	seedResumeFixture(t, store)
	binding := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	got := resumeFixtureSnapshot(t, store, bindingOwnerID)
	if got == nil || got.Identity.ID != bindingOwnerID || !matchBinding(got.PriorBinding, &binding, false) ||
		got.PreferredDriver == nil || *got.PreferredDriver != core.DriverCodex || got.Selected == nil {
		t.Fatalf("resume snapshot = %+v", got)
	}
	selected := got.Selected
	if selected.Driver != core.DriverClaude || selected.ProviderSession != savedResumeSession ||
		selected.Mode != "default" || selected.Channel == nil || *selected.Channel ||
		selected.State == nil || *selected.State != (core.ResumeDriverState{Version: 2, JSON: `{"state":"saved"}`}) {
		t.Fatalf("selected session = %+v", selected)
	}

	editResumeFixture(t, store, `UPDATE bindings SET runtime_state='running',runtime_pid=100,
		runtime_start_identity='new-child',observed_provider_session_id=? WHERE id=?`, savedResumeSession, bindingID1)
	err := store.Write(t.Context(), func(tx ports.StoreTx) error {
		return tx.Bindings().VerifyResume(*got)
	})
	requireResumeFailure(t, err, "RUNTIME_CONFLICT", "resume_drift")
}

func TestVerifyResumeRefusesSavedEvidenceBeforeMutation(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	seedResumeFixture(t, store)
	prior := resumeFixtureSnapshot(t, store, bindingOwnerID)
	reservation := reservationFixture(bindingID1, bindingOwnerID, "%1")
	tests := []struct {
		name, update, reset, code, reason string
	}{
		{"stale", "stale_at_ms=2000", "stale_at_ms=NULL", "RESUME_UNAVAILABLE", "session_stale"},
		{"pending", "resume_pending_at_ms=2000", "resume_pending_at_ms=NULL", "RESUME_UNAVAILABLE", "session_pending"},
		{"channel", "channel=1", "channel=0", "RESUME_UNSUPPORTED", "channel_enrolled"},
		{"driver", "remembered_harness='gemini'", "remembered_harness='claude'", "RESUME_UNSUPPORTED", "unsupported_driver"},
		{"mode", "runtime_mode='unsupported'", "runtime_mode='default'", "RESUME_UNSUPPORTED", "unsupported_mode"},
		{"alias", "provider_session_id='latest'", "provider_session_id='" + savedResumeSession + "'", "RESUME_UNAVAILABLE", "invalid_session"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			editResumeFixture(t, store, "UPDATE identity_session_preferences SET "+test.update+" WHERE identity_id=?", bindingOwnerID)
			current := resumeFixtureSnapshot(t, store, bindingOwnerID)
			err := store.Write(t.Context(), func(tx ports.StoreTx) error {
				return tx.Bindings().VerifyResume(*prior)
			})
			requireResumeFailure(t, err, "RUNTIME_CONFLICT", "resume_drift")
			err = store.Write(t.Context(), func(tx ports.StoreTx) error {
				if err := tx.Bindings().VerifyResume(*current); err != nil {
					return err
				}
				_, err := tx.Bindings().Reserve(reservation, nil)
				return err
			})
			requireResumeFailure(t, err, test.code, test.reason)
			editResumeFixture(t, store, "UPDATE identity_session_preferences SET "+test.reset+" WHERE identity_id=?", bindingOwnerID)
		})
	}
	var pending *core.BindingReservation
	if err := store.Read(t.Context(), func(tx ports.StoreTx) error {
		var err error
		pending, err = tx.Bindings().FindReservationByIdentity(bindingOwnerID)
		return err
	}); err != nil || pending != nil {
		t.Fatalf("refused resume left a reservation: %+v, %v", pending, err)
	}

	for _, mode := range []string{"shared", "embedded"} {
		editResumeFixture(t, store, "UPDATE identity_session_preferences SET remembered_harness='codex',runtime_mode=? WHERE identity_id=?", mode, bindingOwnerID)
		current := resumeFixtureSnapshot(t, store, bindingOwnerID)
		writeBindingTest(t, store, func(tx ports.StoreTx) error {
			return tx.Bindings().VerifyResume(*current)
		})
	}
}

func TestResumeFenceSurvivesActivationAndAdmissionRequiresIt(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	seedResumeFixture(t, store)
	original := resumeFixtureSnapshot(t, store, bindingOwnerID)
	reservation := reservationFixture(bindingID1, bindingOwnerID, "%1")
	var binding *core.Binding
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		if err := tx.Bindings().VerifyResume(*original); err != nil {
			return err
		}
		ok, err := tx.Bindings().Reserve(reservation, nil)
		requireBindingChange(t, ok, err, true)
		return nil
	})
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		if err := tx.Bindings().VerifyResume(*original); err != nil {
			return err
		}
		var err error
		binding, err = tx.Bindings().Activate(reservation, nil, 2100)
		return err
	})
	if binding == nil {
		t.Fatal("no activated binding")
	}
	stored := resumeFixtureSnapshot(t, store, bindingOwnerID)
	if stored.Fence != original.Fence || !matchBinding(stored.PriorBinding, binding, false) {
		t.Fatalf("activation changed preferences or lost binding: %+v", stored)
	}
	intent := ports.LaunchIntent{
		Expected: *binding, Driver: core.DriverClaude,
		Owner:       core.ProcessIncarnation{PID: 601, StartIdentity: "owner"},
		CreatedAtMs: 2500, ExpiresAtMs: 3000,
		Resume: &core.ResumeExpectation{
			IdentityID: bindingOwnerID, Driver: core.DriverClaude,
			ProviderSession: savedResumeSession, Fence: original.Fence,
		},
	}
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		ok, err := tx.Bindings().CreateLaunchIntent(intent)
		requireBindingChange(t, ok, err, true)
		return nil
	})
	child := core.ProcessIncarnation{PID: 602, StartIdentity: "child"}
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		replayedFresh := intent
		replayedFresh.Resume = nil
		got, err := tx.Bindings().AdmitLaunch(ports.LaunchAdmission{Intent: replayedFresh, Runtime: child, ObservedAtMs: 2600})
		if got != nil || err != nil {
			t.Fatalf("fresh replay admitted: %+v, %v", got, err)
		}
		return nil
	})
	editResumeFixture(t, store, `UPDATE identity_session_preferences SET driver_state='new state' WHERE identity_id=?`, bindingOwnerID)
	err := store.Write(t.Context(), func(tx ports.StoreTx) error {
		_, err := tx.Bindings().AdmitLaunch(ports.LaunchAdmission{Intent: intent, Runtime: child, ObservedAtMs: 2600})
		return err
	})
	requireResumeFailure(t, err, "RUNTIME_CONFLICT", "resume_drift")
	editResumeFixture(t, store, `UPDATE identity_session_preferences SET driver_state='{"state":"saved"}' WHERE identity_id=?`, bindingOwnerID)

	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		repo := tx.Bindings()
		observation := ports.LaunchActivityObservation{
			Expected: *binding, Owner: intent.Owner, Runtime: child, ProviderSession: "unrelated-session",
			Transition: core.LaunchTransitionResumed, ObservedAtMs: 2600,
		}
		ok, err := repo.ObserveLaunchActivity(observation)
		requireBindingChange(t, ok, err, false)
		observation.ProviderSession = savedResumeSession
		ok, err = repo.ObserveLaunchActivity(observation)
		requireBindingChange(t, ok, err, true)
		got, err := repo.AdmitLaunch(ports.LaunchAdmission{Intent: intent, Runtime: child, ObservedAtMs: 2601})
		if err != nil || got == nil || got.Session.Runtime == nil || *got.Session.Runtime != child ||
			got.Session.ProviderSessionID == nil || *got.Session.ProviderSessionID != savedResumeSession {
			t.Fatalf("exact resume admission = %+v, %v", got, err)
		}
		return nil
	})
}

func TestResumePresetProjectionAndFence(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	seedResumeFixture(t, store)
	old := resumeFixtureSnapshot(t, store, bindingOwnerID)
	preset := `{"executable":"fixture-provider","model":"opus","effort":null,"env":{"CLAUDE_MINI_PCT":"5"},"binding":"` +
		string(bindingID1) + `","owner_pid":100,"owner_start":"start","harness":"claude","session":"` + savedResumeSession + `"}`
	editResumeFixture(t, store, "INSERT INTO identity_metadata(identity_id,key,value) VALUES(?,'resume.launch',?)", bindingOwnerID, preset)
	current := resumeFixtureSnapshot(t, store, bindingOwnerID)
	projected := current.LaunchPreset
	if projected == nil || projected.Executable != "fixture-provider" || projected.Model == nil || *projected.Model != "opus" ||
		projected.Effort != nil || !projected.Associated || len(projected.Env) != 1 || projected.Env["CLAUDE_MINI_PCT"] != "5" ||
		!current.Selected.HasMatchingPreset || current.Fence == old.Fence {
		t.Fatalf("preset projection = %+v, matching = %t", projected, current.Selected.HasMatchingPreset)
	}
	err := store.Write(t.Context(), func(tx ports.StoreTx) error {
		return tx.Bindings().VerifyResume(*current)
	})
	requireResumeFailure(t, err, "RESUME_UNSUPPORTED", "launch_preset")

	editResumeFixture(t, store, "UPDATE identity_metadata SET value=? WHERE identity_id=? AND key='resume.launch'",
		strings.Replace(preset, "CLAUDE_MINI_PCT", "UNSUPPORTED_ENV", 1), bindingOwnerID)
	rejected := resumeFixtureSnapshot(t, store, bindingOwnerID)
	if rejected.LaunchPreset != nil || rejected.Selected.HasMatchingPreset || rejected.Fence == current.Fence {
		t.Fatalf("disallowed env projection = %+v", rejected)
	}

	editResumeFixture(t, store, "INSERT INTO identity_metadata(identity_id,key,value) VALUES(?,'resume.driver.claude',?)", bindingOwnerID, preset)
	retained := resumeFixtureSnapshot(t, store, bindingOwnerID)
	if retained.LaunchPreset != nil || !retained.Selected.HasMatchingPreset || retained.Fence == rejected.Fence {
		t.Fatalf("matching retained preset = %+v", retained)
	}
}

func TestForgetResumeLaunchAndSessionKeepIndependentEvidence(t *testing.T) {
	parallelStorageFixture(t)
	ctx := t.Context()
	store := bindingFixture(t)
	expectedBinding := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	seedResumeFixture(t, store)
	editResumeFixture(t, store, `UPDATE identity_session_preferences
		SET channel=1,stale_at_ms=2200,resume_pending_at_ms=2300 WHERE identity_id=?`, bindingOwnerID)
	editResumeFixture(t, store, `INSERT INTO identity_resume_records
		(identity_id,harness,runtime_mode,provider_session_id) VALUES (?,'codex','shared','other-session')`, bindingOwnerID)
	editResumeFixture(t, store, `INSERT INTO identity_metadata (identity_id,key,value) VALUES
		(?1,'resume.launch','launch'),(?1,'resume.driver.claude','claude'),(?1,'resume.driver.codex','codex')`, bindingOwnerID)

	original := resumeFixtureSnapshot(t, store, bindingOwnerID)
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		stale := original.Identity
		stale.Name = "Stale"
		if err := tx.Bindings().ForgetResumeLaunch(stale); !errors.Is(err, core.ErrIdentityInactive) {
			t.Fatalf("drifted preset clear = %v", err)
		}
		if _, err := tx.Bindings().ForgetResume(stale); !errors.Is(err, core.ErrIdentityInactive) {
			t.Fatalf("drifted session clear = %v", err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	afterDrift := resumeFixtureSnapshot(t, store, bindingOwnerID)
	if afterDrift.Fence != original.Fence {
		t.Fatal("refused clears changed saved preferences or metadata")
	}
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		bindings := tx.Bindings()
		if err := bindings.ForgetResumeLaunch(original.Identity); err != nil {
			return err
		}
		return bindings.ForgetResumeLaunch(original.Identity)
	}); err != nil {
		t.Fatal(err)
	}
	afterPreset := resumeFixtureSnapshot(t, store, bindingOwnerID)
	if afterPreset.Selected == nil || afterPreset.Selected.ProviderSession != savedResumeSession ||
		!matchBinding(afterPreset.PriorBinding, &expectedBinding, false) {
		t.Fatalf("preset clear changed remembered session or binding: %+v", afterPreset)
	}
	var remaining string
	if err := store.db.QueryRowContext(ctx, "SELECT group_concat(key,',') FROM identity_metadata WHERE identity_id=?",
		bindingOwnerID).Scan(&remaining); err != nil || remaining != "resume.driver.codex" {
		t.Fatalf("metadata after preset clear = %q, %v", remaining, err)
	}

	editResumeFixture(t, store, "INSERT INTO identity_metadata VALUES (?,'resume.launch','independent preset')", bindingOwnerID)
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		bindings := tx.Bindings()
		driver, err := bindings.ForgetResume(original.Identity)
		if err != nil || driver == nil || *driver != core.DriverClaude {
			t.Fatalf("first session clear = %v, %v", driver, err)
		}
		driver, err = bindings.ForgetResume(original.Identity)
		if err != nil || driver != nil {
			t.Fatalf("second session clear = %v, %v", driver, err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	afterSession := resumeFixtureSnapshot(t, store, bindingOwnerID)
	if afterSession.Selected != nil || afterSession.PreferredDriver == nil || *afterSession.PreferredDriver != core.DriverCodex ||
		!matchBinding(afterSession.PriorBinding, &expectedBinding, false) {
		t.Fatalf("session clear changed preferred driver or binding: %+v", afterSession)
	}
	var channel, carried bool
	var retained, preset string
	err := store.db.QueryRowContext(ctx, `SELECT channel,driver_state IS NOT NULL OR
		driver_state_version IS NOT NULL OR stale_at_ms IS NOT NULL OR resume_pending_at_ms IS NOT NULL,
		(SELECT provider_session_id FROM identity_resume_records WHERE identity_id=?1 AND harness='codex'),
		(SELECT value FROM identity_metadata WHERE identity_id=?1 AND key='resume.launch')
		FROM identity_session_preferences WHERE identity_id=?1`, bindingOwnerID).
		Scan(&channel, &carried, &retained, &preset)
	if err != nil || !channel || carried || retained != "other-session" || preset != "independent preset" {
		t.Fatalf("state after session clear: channel %t, stale state %t, retained %q, preset %q, error %v",
			channel, carried, retained, preset, err)
	}
}
