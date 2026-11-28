package storage

import (
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func (r bindingRows) EndLaunch(end ports.LaunchEnd) (bool, error) {
	if !safeTime(end.ObservedAtMs) || !safeTime(end.Owner.PID) || !validStart(end.Owner.StartIdentity) ||
		!safeTime(end.Runtime.PID) || !validStart(end.Runtime.StartIdentity) {
		return false, nil
	}
	current, err := r.FindByIdentity(end.Expected.IdentityID)
	if err != nil || !matchBinding(current, &end.Expected, false) {
		return false, err
	}
	session := current.Session
	if session.RuntimeState != "running" || session.LaunchOwner == nil || *session.LaunchOwner != end.Owner ||
		session.Runtime == nil || *session.Runtime != end.Runtime {
		return false, nil
	}
	changed, err := affectedOne(r.exec(`UPDATE bindings SET runtime_state = 'ended', last_transition = 'ended', plain_program = NULL
		WHERE id = ? AND identity_id = ? AND runtime_state = 'running'
			AND launch_owner_pid = ? AND launch_owner_start_identity = ?
			AND runtime_pid = ? AND runtime_start_identity = ?`,
		current.ID, current.IdentityID, end.Owner.PID, end.Owner.StartIdentity, end.Runtime.PID, end.Runtime.StartIdentity))
	if err != nil || !changed {
		return false, err
	}
	_, err = r.exec(`UPDATE capture_batches SET closed_ms = MAX(created_ms, ?)
		WHERE identity_id = ? AND binding_id = ? AND runtime_pid = ? AND runtime_start = ?
			AND session_id IS ? AND closed_ms IS NULL`,
		end.ObservedAtMs, current.IdentityID, current.ID, end.Runtime.PID, end.Runtime.StartIdentity, session.ProviderSessionID)
	if err != nil {
		return false, err
	}
	err = endDigestContinuation(r.records, current.IdentityID, end.ObservedAtMs)
	return err == nil, err
}

func (r bindingRows) CanClosePane(expected core.Binding, observedAtMs uint64) (bool, error) {
	if !safeTime(observedAtMs) || expected.Session.RuntimeState != "ended" {
		return false, nil
	}
	current, err := r.FindByIdentity(expected.IdentityID)
	if err != nil || !matchBinding(current, &expected, false) {
		return false, err
	}
	var pending bool
	err = r.one(`SELECT EXISTS(SELECT 1 FROM launch_observations
		WHERE binding_id = ? AND status IN ('intent', 'pending') AND expires_at_ms > ?)`,
		current.ID, observedAtMs).Scan(&pending)
	return err == nil && !pending, err
}
