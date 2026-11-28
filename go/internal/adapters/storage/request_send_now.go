package storage

import (
	"context"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

func (s *RequestService) ReleaseSendNow(ctx context.Context, ref core.RequestRef, caller core.IdentityID) (core.SendNowRelease, error) {
	if ref == "" || caller == "" {
		return core.SendNowRelease{}, requestState()
	}
	calendar, err := s.store.loadDigestCalendar(ctx)
	if err != nil {
		return core.SendNowRelease{}, err
	}
	var release core.SendNowRelease
	err = s.transact(ctx, false, func(r records, now uint64) error {
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
		projection := deliveryProjector{r: r, now: now, calendar: calendar}
		view, err := projection.project(*attempt)
		if err != nil {
			return err
		}
		release = core.SendNowRelease{RequestID: id, RecipientID: recipient}
		switch view.State {
		case "delivered", "working":
			already := core.SendNowAlready(view.State)
			release.Already = &already
			return nil
		case "unconfirmed":
			return sendNowUnconfirmed(id)
		}
		if !view.CanSendNow {
			return sendNowRefusal("SEND_NOW_NOT_AVAILABLE", view.ReasonText)
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
		_, err = r.exec("UPDATE request_attempts SET wake_state='not_attempted' WHERE request_id=? AND wake_state='unavailable'", id)
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
