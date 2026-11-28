package storage

import (
	"context"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

func (s *RequestService) ReleaseSendNow(ctx context.Context, ref core.RequestRef, caller core.IdentityID) (core.SendNowRelease, error) {
	if ref == "" || caller == "" {
		return core.SendNowRelease{}, requestState()
	}
	var release core.SendNowRelease
	err := s.transact(ctx, false, func(r records, now uint64) error {
		id, err := selectResultID(r, core.RequestID(ref), now)
		if err != nil {
			return err
		}
		attempt, err := (requestRows{r}).FindByID(id)
		if err != nil {
			return err
		}
		if attempt == nil || now >= attempt.RetentionExpiresAtMs {
			return sendNowNotFound()
		}
		allowed, err := sendNowCaller(r, *attempt, caller)
		if err != nil {
			return err
		}
		if !allowed {
			return sendNowRefusal("SEND_NOW_NOT_ALLOWED", "only its sender or the owner can send it early")
		}
		policy, err := deliveryPolicy(r, id)
		if err != nil {
			return err
		}
		if !ordinaryInboxRequest(*attempt, policy) {
			return sendNowRefusal("SEND_NOW_NOT_APPLICABLE", "it is not an ordinary message to an agent")
		}
		if !liveWakeRequest(*attempt, now) {
			return sendNowRefusal("SEND_NOW_CLOSED", "it already has an answer, or was withdrawn or expired")
		}
		recipient := *attempt.Route.Recipient
		wake, err := readRequestWake(r, id)
		if err != nil {
			return err
		}
		already, err := sendNowDelivery(r, *attempt, wake.observed(now), now)
		if err != nil {
			return err
		}
		release = core.SendNowRelease{RequestID: id, RecipientID: recipient, Already: already}
		if already != nil {
			return nil
		}
		if _, err := r.exec(`DELETE FROM focus_items WHERE identity_id=? AND request_id=?
			AND source='incoming' AND checklist_id IS NULL`, recipient, id); err != nil {
			return err
		}
		if !policy.urgent {
			if err := insertOrElevateSendNowPolicy(r, id, policy); err != nil {
				return err
			}
		}
		if wake.state == core.WakeUnavailable {
			_, err = r.exec("UPDATE request_attempts SET wake_state='not_attempted' WHERE request_id=? AND wake_state='unavailable'", id)
		}
		return err
	})
	if err != nil {
		return core.SendNowRelease{}, err
	}
	return release, nil
}

func ordinaryInboxRequest(attempt core.RequestAttempt, policy storedPolicy) bool {
	return attempt.Kind == core.RequestKindRequest && attempt.Route.Kind == core.RequestRouteInbox &&
		policy.automatic && policy.mode == string(core.RequestDeliveryRequest)
}

func sendNowCaller(r records, attempt core.RequestAttempt, id core.IdentityID) (bool, error) {
	active, err := (identityRows{r}).FindByID(id)
	if err != nil || active == nil {
		return false, err
	}
	if matchesIdentity(attempt.Originator.IdentityID, id) {
		return true, nil
	}
	return digestIsUser(r, id)
}

func insertOrElevateSendNowPolicy(r records, id core.RequestID, policy storedPolicy) error {
	_, err := r.exec(`INSERT INTO request_delivery_policies(request_id, urgent, kind, automatic, mode)
		VALUES (?,1,?,?,?) ON CONFLICT(request_id) DO UPDATE SET urgent=1`, id, policy.kind, policy.automatic, policy.mode)
	return err
}

func sendNowNotFound() *core.RequestFailure {
	return requestFailure("SEND_NOW_NOT_FOUND", "That request was not found or is no longer retained.", 3)
}

func sendNowRefusal(code, reason string) *core.RequestFailure {
	return requestFailure(code, "Could not send now: "+reason, 1)
}

func sendNowUnconfirmed(id core.RequestID) *core.RequestFailure {
	failure := sendNowRefusal("SEND_NOW_UNCONFIRMED", "an earlier delivery is unconfirmed, do not resend")
	failure.Suggestion = "Inspect with 'tmt result " + string(id) + "'."
	return failure
}

// Only the delivery facts that authorize an early release are needed here.
func sendNowDelivery(r records, attempt core.RequestAttempt, state core.WakeState, now uint64) (*core.SendNowAlready, error) {
	recipient, id := *attempt.Route.Recipient, attempt.RequestID
	person, err := digestIsUser(r, recipient)
	if err != nil {
		return nil, err
	}
	if person && (attempt.Status == core.AttemptQueued || attempt.Status == core.AttemptSent) {
		already := core.SendNowAlreadyDelivered
		return &already, nil
	}
	var heldAtLimit bool
	if err := r.one("SELECT EXISTS(SELECT 1 FROM orchestration_talk_holds WHERE request_id=?)", id).Scan(&heldAtLimit); err != nil {
		return nil, err
	}
	switch {
	case heldAtLimit && attempt.Status == core.AttemptDefinitelyFailed:
		return nil, sendNowRefusal("SEND_NOW_NOT_AVAILABLE", "not sent, the talk-limit hold was not resumed in time")
	case heldAtLimit && state == core.WakeNotAttempted:
		return nil, sendNowRefusal("SEND_NOW_NOT_AVAILABLE", "held at the talk limit, sends when a person or a lead resumes the pair")
	}
	hold, err := readSendNowHold(r, recipient, id)
	if err != nil {
		return nil, err
	}
	switch {
	case state == core.WakeUncertain || hold == sendNowHoldUnconfirmed:
		return nil, sendNowUnconfirmed(id)
	case state == core.WakeUnavailable:
		return nil, nil
	case state == core.WakeSent:
		return sentWakeDisposition(r, attempt, now)
	case hold == sendNowHoldDelivered:
		already := core.SendNowAlreadyDelivered
		return &already, nil
	case state == core.WakeClaimed || hold == sendNowHoldClaimed:
		return nil, sendNowRefusal("SEND_NOW_NOT_AVAILABLE", "waiting for delivery")
	}
	evidence, err := digestRecipientEvidence(r, recipient)
	if err != nil && !isNoRows(err) {
		return nil, err
	}
	if activity := wakeActivity(evidence); activity != nil && core.DigestPhase(activity.State) == core.DigestPhaseWaiting {
		if hold == sendNowHoldOpen {
			return nil, sendNowRefusal("SEND_NOW_NOT_AVAILABLE", "batched to save usage, sends when the agent finishes this turn")
		}
		return nil, sendNowRefusal("SEND_NOW_NOT_AVAILABLE", "waiting for the agent's approval prompt to clear")
	}
	return nil, nil
}

type sendNowHold uint8

const (
	sendNowHoldNone sendNowHold = iota
	sendNowHoldOpen
	sendNowHoldClaimed
	sendNowHoldDelivered
	sendNowHoldUnconfirmed
)

func readSendNowHold(r records, recipient core.IdentityID, id core.RequestID) (sendNowHold, error) {
	var state *core.DigestState
	var opportunity *core.DigestOpportunity
	var confirmed *uint64
	err := r.one(`SELECT c.state, c.opportunity, c.confirmed_at_ms FROM focus_items i
		LEFT JOIN focus_checklists c ON c.id=i.checklist_id
		WHERE i.identity_id=? AND i.request_id=? AND i.source='incoming'`, recipient, id).
		Scan(&state, &opportunity, &confirmed)
	if err != nil {
		if isNoRows(err) {
			return sendNowHoldNone, nil
		}
		return sendNowHoldNone, err
	}
	switch {
	case state == nil || *state == core.DigestStateDefinitelyUnsent:
		return sendNowHoldOpen, nil
	case *state == core.DigestStateClaimed:
		return sendNowHoldClaimed, nil
	case *state == core.DigestStateDelivered:
		if opportunity != nil && *opportunity == core.DigestOpportunityIdle && confirmed == nil {
			return sendNowHoldUnconfirmed, nil
		}
		return sendNowHoldDelivered, nil
	case *state == core.DigestStateUncertain:
		return sendNowHoldUnconfirmed, nil
	default:
		return sendNowHoldNone, errDigestEvidence
	}
}

func wakeActivity(evidence digestRecipient) *launchActivity {
	if !evidence.supportsDigestIdle() {
		return nil
	}
	return evidence.activity()
}

func sentWakeDisposition(r records, attempt core.RequestAttempt, now uint64) (*core.SendNowAlready, error) {
	const workingWindowMs = 21_600_000
	var started, ended *uint64
	err := r.one("SELECT started_ms,ended_ms FROM request_turns WHERE request_id=?", attempt.RequestID).Scan(&started, &ended)
	if err != nil && !isNoRows(err) {
		return nil, err
	}
	evidence, err := digestRecipientEvidence(r, *attempt.Route.Recipient)
	if err != nil && !isNoRows(err) {
		return nil, err
	}
	activity := wakeActivity(evidence)
	idle := activity != nil && core.DigestPhase(activity.State) == core.DigestPhaseIdle
	if ended != nil || started != nil && (idle || now > *started && now-*started > workingWindowMs) {
		return nil, sendNowUnconfirmed(attempt.RequestID)
	}
	already := core.SendNowAlreadyDelivered
	since := attempt.PreparedAtMs
	if attempt.SettledAtMs != nil {
		since = *attempt.SettledAtMs
	}
	if activity != nil && !idle && evidence.binding.Session.StartRefusal == nil && activity.SinceMs >= since {
		start := activity.SinceMs
		if started != nil {
			start = *started
		}
		if now <= start || now-start <= workingWindowMs {
			already = core.SendNowAlreadyWorking
		}
	}
	return &already, nil
}
