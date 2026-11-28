package storage

import (
	"errors"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const (
	launchMaximumLeaseMs = 24 * 60 * 60 * 1000
	launchRetainedCount  = 8
)

type storedLaunchIntent struct {
	driver      core.DriverName
	starts      uint64
	expires     uint64
	digest      string
	status      string
	runtimePID  *uint64
	runtimeKey  *string
	session     *string
	mode        *string
	transition  *core.LaunchTransition
	observedAt  *uint64
	driverState *string
	version     *uint16
}

func validLaunchIntent(in ports.LaunchIntent) bool {
	return in.Driver.Valid() && safeTime(in.Owner.PID) && validStart(in.Owner.StartIdentity) &&
		safeTime(in.CreatedAtMs) && safeTime(in.ExpiresAtMs) && in.ExpiresAtMs > in.CreatedAtMs &&
		in.ExpiresAtMs-in.CreatedAtMs <= launchMaximumLeaseMs
}

func (r bindingRows) findLaunchIntent(intent ports.LaunchIntent) (*storedLaunchIntent, error) {
	var stored storedLaunchIntent
	err := r.one(`SELECT driver, created_at_ms, expires_at_ms, preferences_fingerprint, status,
		provider_pid, provider_start, provider_session, runtime_mode, provider_transition, observed_at_ms,
		driver_state, driver_state_version
		FROM launch_observations WHERE binding_id = ? AND owner_pid = ? AND owner_start = ?`,
		intent.Expected.ID, intent.Owner.PID, intent.Owner.StartIdentity).
		Scan(&stored.driver, &stored.starts, &stored.expires, &stored.digest, &stored.status, &stored.runtimePID,
			&stored.runtimeKey, &stored.session, &stored.mode, &stored.transition, &stored.observedAt, &stored.driverState, &stored.version)
	return optional(&stored, err)
}

func (s storedLaunchIntent) matches(intent ports.LaunchIntent, digest string) bool {
	return s.driver == intent.Driver && s.starts == intent.CreatedAtMs && s.expires == intent.ExpiresAtMs && s.digest == digest
}

func (r bindingRows) CreateLaunchIntent(intent ports.LaunchIntent) (bool, error) {
	if !validLaunchIntent(intent) {
		return false, nil
	}
	binding, err := r.FindByIdentity(intent.Expected.IdentityID)
	if err != nil || !matchBinding(binding, &intent.Expected, false) || binding.Session.RuntimeState == "running" {
		return false, err
	}
	digest, err := launchPreferencesFingerprint(r.records, binding.ID)
	if err != nil {
		return false, err
	}
	if _, err := r.exec("DELETE FROM launch_observations WHERE binding_id = ? AND expires_at_ms <= ?",
		binding.ID, intent.CreatedAtMs); err != nil {
		return false, err
	}
	stored, err := r.findLaunchIntent(intent)
	if err != nil {
		return false, err
	}
	if stored != nil {
		return stored.status == "intent" && stored.matches(intent, digest), nil
	}
	if _, err := r.exec(`DELETE FROM launch_observations WHERE binding_id = ?1 AND (owner_pid, owner_start) IN (
		SELECT owner_pid, owner_start FROM launch_observations WHERE binding_id = ?1
		ORDER BY created_at_ms DESC, owner_pid DESC, owner_start DESC LIMIT -1 OFFSET ?2)`,
		binding.ID, launchRetainedCount-1); err != nil {
		return false, err
	}
	return affectedOne(r.exec(`INSERT INTO launch_observations (binding_id, owner_pid, owner_start, driver,
		created_at_ms, expires_at_ms, preferences_fingerprint, step, reason)
		VALUES (?, ?, ?, ?, ?, ?, ?, 'input', 'not_admitted')`,
		binding.ID, intent.Owner.PID, intent.Owner.StartIdentity, intent.Driver, intent.CreatedAtMs, intent.ExpiresAtMs, digest))
}

func (r bindingRows) AdmitLaunch(admission ports.LaunchAdmission) (*core.Binding, error) {
	intent := admission.Intent
	runtime, now := admission.Runtime, admission.ObservedAtMs
	if !validLaunchIntent(intent) || !safeTime(runtime.PID) || !validStart(runtime.StartIdentity) ||
		now < intent.CreatedAtMs || now >= intent.ExpiresAtMs {
		return nil, nil
	}
	binding, err := r.FindByIdentity(intent.Expected.IdentityID)
	if err != nil || !matchBinding(binding, &intent.Expected, false) || binding.Session.RuntimeState == "running" {
		return nil, err
	}
	// Replayed process evidence cannot resurrect an already settled runtime.
	if binding.Session.Runtime != nil && *binding.Session.Runtime == runtime {
		return nil, nil
	}
	stored, err := r.findLaunchIntent(intent)
	if err != nil || stored == nil {
		return nil, err
	}
	if stored.status != "intent" && stored.status != "pending" {
		return nil, nil
	}
	digest, err := launchPreferencesFingerprint(r.records, binding.ID)
	if err != nil || !stored.matches(intent, digest) {
		return nil, err
	}

	transition := core.LaunchTransitionStarted
	if stored.status == "pending" {
		if !matchesPendingLaunch(*stored, runtime) {
			return nil, nil
		}
		if err := r.rememberLaunch(binding.IdentityID, intent.Driver, *stored); err != nil {
			return nil, err
		}
		transition = *stored.transition
	}
	changed, err := affectedOne(r.exec(`UPDATE bindings SET runtime_state = 'running', last_transition = ?1,
		runtime_pid = ?2, runtime_start_identity = ?3, observed_provider_session_id = ?4,
		launch_owner_pid = ?5, launch_owner_start_identity = ?6, runtime_start_refusal = NULL, plain_program = NULL
		WHERE id = ?7 AND identity_id = ?8`, transition, runtime.PID, runtime.StartIdentity, stored.session,
		intent.Owner.PID, intent.Owner.StartIdentity, binding.ID, binding.IdentityID))
	if err != nil || !changed {
		return nil, requiredMutation(changed, err, "binding changed during launch admission")
	}
	if _, err := r.exec("UPDATE capture_batches SET closed_ms = MAX(created_ms, ?1) WHERE binding_id = ?2 AND closed_ms IS NULL",
		now, binding.ID); err != nil {
		return nil, err
	}
	changed, err = affectedOne(r.exec(`UPDATE launch_observations SET status = 'admitted',
		provider_pid = NULL, provider_start = NULL, provider_session = NULL, provider_transition = NULL,
		runtime_mode = NULL, observed_at_ms = NULL, driver_state = NULL, driver_state_version = NULL,
		step = NULL, reason = NULL, detail = NULL
		WHERE binding_id = ?1 AND owner_pid = ?2 AND owner_start = ?3
		  AND status = ?4 AND preferences_fingerprint = ?5`, binding.ID, intent.Owner.PID, intent.Owner.StartIdentity,
		stored.status, digest))
	if err != nil || !changed {
		return nil, requiredMutation(changed, err, "launch intent changed during runtime admission")
	}
	return r.FindByIdentity(binding.IdentityID)
}

func matchesPendingLaunch(stored storedLaunchIntent, runtime core.ProcessIncarnation) bool {
	return stored.driver == core.DriverClaude &&
		stored.runtimePID != nil && *stored.runtimePID == runtime.PID &&
		stored.runtimeKey != nil && *stored.runtimeKey == runtime.StartIdentity &&
		stored.session != nil && validStart(*stored.session) && stored.mode != nil && *stored.mode != "" &&
		stored.observedAt != nil && *stored.observedAt >= stored.starts && *stored.observedAt < stored.expires &&
		stored.transition != nil && (*stored.transition == core.LaunchTransitionStarted || *stored.transition == core.LaunchTransitionResumed)
}

// Remember the admitted session while retaining a previous driver independently.
func (r bindingRows) rememberLaunch(identity core.IdentityID, driver core.DriverName, stored storedLaunchIntent) error {
	if stored.session == nil || stored.mode == nil {
		return errors.New("pending launch is missing its session")
	}
	if _, err := r.exec(`INSERT INTO identity_resume_records (identity_id, harness, runtime_mode, provider_session_id,
		driver_state, driver_state_version, stale_at_ms, resume_pending_at_ms, channel)
		SELECT identity_id, remembered_harness, runtime_mode, provider_session_id, driver_state, driver_state_version,
			stale_at_ms, resume_pending_at_ms, CASE WHEN preferred_harness = remembered_harness THEN channel END
		FROM identity_session_preferences WHERE identity_id = ?1 AND remembered_harness IS NOT NULL AND remembered_harness <> ?2
		ON CONFLICT (identity_id, harness) DO UPDATE SET runtime_mode = excluded.runtime_mode,
			provider_session_id = excluded.provider_session_id, driver_state = excluded.driver_state,
			driver_state_version = excluded.driver_state_version, stale_at_ms = excluded.stale_at_ms,
			resume_pending_at_ms = excluded.resume_pending_at_ms, channel = excluded.channel`, identity, driver); err != nil {
		return err
	}
	if _, err := r.exec("DELETE FROM identity_resume_records WHERE identity_id = ? AND harness = ?", identity, driver); err != nil {
		return err
	}
	_, err := r.exec(`INSERT INTO identity_session_preferences (identity_id, preferred_harness, remembered_harness,
		runtime_mode, provider_session_id, driver_state, driver_state_version)
		VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6)
		ON CONFLICT(identity_id) DO UPDATE SET
			channel = CASE WHEN preferred_harness = excluded.preferred_harness
				AND (remembered_harness IS NULL OR remembered_harness = excluded.remembered_harness) THEN channel END,
			preferred_harness = excluded.preferred_harness, remembered_harness = excluded.remembered_harness,
			runtime_mode = excluded.runtime_mode, provider_session_id = excluded.provider_session_id,
			driver_state = excluded.driver_state, driver_state_version = excluded.driver_state_version,
			stale_at_ms = NULL, resume_pending_at_ms = NULL`, identity, driver, *stored.mode, *stored.session, stored.driverState, stored.version)
	return err
}
