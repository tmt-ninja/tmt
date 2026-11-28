package storage

import (
	"context"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const openDigestContinuation = `identity_id=?1 AND projection='full' AND opportunity='turn_boundary'
	AND state IN ('delivered','uncertain') AND confirmed_at_ms IS NULL`

func (s *Storage) DigestIdleBinding(ctx context.Context, id core.IdentityID) (*core.DigestLaunchFence, error) {
	var fence *core.DigestLaunchFence
	err := s.transact(ctx, true, func(r records) error {
		recipient, err := digestRecipientEvidence(r, id)
		if isNoRows(err) {
			return nil
		}
		if err != nil {
			return err
		}
		binding := recipient.binding
		if binding == nil || binding.Session.RuntimeState != "running" || binding.Session.LaunchOwner == nil ||
			binding.Session.PlainProgram != nil || !recipient.currentUsage || !recipient.supportsDigestIdle() {
			return nil
		}
		activity := recipient.activity()
		if activity == nil || core.DigestPhase(activity.State) != core.DigestPhaseIdle {
			return nil
		}
		var open bool
		if err := r.one("SELECT EXISTS(SELECT 1 FROM focus_checklists WHERE "+openDigestContinuation+")", id).Scan(&open); err != nil {
			return err
		}
		if !open {
			fence = &core.DigestLaunchFence{Expected: *binding, Driver: *recipient.driver, ProviderSession: activity.Session}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return fence, nil
}

func (d digestRecipient) supportsDigestIdle() bool {
	// NOT PORTED (#6938, GO1-22): Agy and Pi use driver-owned activity decoding.
	return d.driver != nil && (*d.driver == core.DriverClaude || *d.driver == core.DriverCodex) &&
		d.stateVersion != nil && *d.stateVersion >= 3 && *d.stateVersion <= 6
}

func endDigestContinuation(r records, id core.IdentityID, nowMs uint64) error {
	_, err := r.exec("UPDATE focus_checklists SET confirmed_at_ms=?2 WHERE "+openDigestContinuation, id, nowMs)
	return err
}

// ObserveDigestPrompt confirms a continuation only after exact main-session
// prompt evidence. Stop follows the separate capture path.
func (r bindingRows) ObserveDigestPrompt(p ports.DigestPromptObservation) (bool, error) {
	if !safeTime(p.ObservedAtMs) || !safeTime(p.Owner.PID) || !validStart(p.Owner.StartIdentity) ||
		!safeTime(p.Runtime.PID) || !validStart(p.Runtime.StartIdentity) || !validStart(p.ProviderSession) {
		return false, nil
	}
	current, err := r.FindByIdentity(p.Expected.IdentityID)
	if err != nil || !matchBinding(current, &p.Expected, false) {
		return false, err
	}
	session := current.Session
	if session.RuntimeState != "running" || session.PlainProgram != nil ||
		session.LaunchOwner == nil || *session.LaunchOwner != p.Owner ||
		session.Runtime == nil || *session.Runtime != p.Runtime ||
		session.ProviderSessionID == nil || *session.ProviderSessionID != p.ProviderSession {
		return false, nil
	}
	var remembered bool
	err = r.one(`SELECT EXISTS(SELECT 1 FROM identity_session_preferences
		WHERE identity_id=? AND remembered_harness IS NOT NULL AND provider_session_id=?)`,
		current.IdentityID, p.ProviderSession).Scan(&remembered)
	if err != nil || !remembered {
		return false, err
	}
	err = endDigestContinuation(r.records, current.IdentityID, p.ObservedAtMs)
	return err == nil, err
}
