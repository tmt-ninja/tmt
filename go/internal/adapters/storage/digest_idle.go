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

// ObserveDigestPrompt records a verified main-session Claude turn start and
// confirms any open Digest continuation in the same writer.
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
	var old *string
	var version *uint16
	err = r.one(`SELECT driver_state,driver_state_version FROM identity_session_preferences
		WHERE identity_id=? AND remembered_harness=? AND provider_session_id=?`,
		current.IdentityID, core.DriverClaude, p.ProviderSession).Scan(&old, &version)
	if isNoRows(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	document, previous, valid := loadActivityDocument(old, version)
	if !valid || previous != nil && previous.Session == p.ProviderSession &&
		previous.PID == p.Runtime.PID && previous.Start == p.Runtime.StartIdentity &&
		p.ObservedAtMs < previous.LastActivityMs {
		return false, nil
	}
	// Claude supplies no turn ID. Native Activity::observe treats each
	// verified prompt as a new Working turn, including when Stop was missed.
	encoded, next, err := activityDocument(document, launchActivity{
		Session: p.ProviderSession, PID: p.Runtime.PID, Start: p.Runtime.StartIdentity, State: "working",
		SinceMs: p.ObservedAtMs, LastActivityMs: p.ObservedAtMs,
	})
	if err != nil {
		return false, err
	}
	changed, err := affectedOne(r.exec(`UPDATE identity_session_preferences SET driver_state=?,driver_state_version=?
		WHERE identity_id=? AND remembered_harness=? AND provider_session_id=?`,
		encoded, next, current.IdentityID, core.DriverClaude, p.ProviderSession))
	if err != nil || !changed {
		return false, err
	}
	err = endDigestContinuation(r.records, current.IdentityID, p.ObservedAtMs)
	return err == nil, err
}
