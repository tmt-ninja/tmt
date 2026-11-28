package storage

import (
	"context"
	"database/sql"
	"errors"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// RequestService applies durable exchange rules. The caller performs host
// effects between transactions and supplies the invocation clock.
type RequestService struct {
	store *Storage
	clock ports.Clock
}

func NewRequestService(store *Storage, clock ports.Clock) *RequestService {
	return &RequestService{store: store, clock: clock}
}

func requestFailure(code, message string, status int) *core.RequestFailure {
	return &core.RequestFailure{Code: code, Message: message, Status: status}
}

func requestState() *core.RequestFailure {
	return requestFailure("REQUEST_STATE_ERROR", "Request attempt cannot make this transition.", 1)
}

func (s *RequestService) transact(ctx context.Context, readOnly bool, fn func(records, uint64) error) error {
	return s.store.transact(ctx, readOnly, func(r records) error {
		now := s.clock.NowMs()
		if now <= 0 || !core.ValidJSSafeInteger(uint64(now)) {
			return core.ErrAttemptTime
		}
		return fn(r, uint64(now))
	})
}

func (s *RequestService) Prepare(ctx context.Context, in core.PrepareRequest) (core.PreparedRequest, error) {
	return s.prepare(ctx, in, false)
}

func (s *RequestService) Enqueue(ctx context.Context, in core.PrepareRequest) (core.PreparedRequest, error) {
	return s.prepare(ctx, in, true)
}

func (s *RequestService) prepare(ctx context.Context, in core.PrepareRequest, enqueue bool) (core.PreparedRequest, error) {
	if err := validatePrepared(in, enqueue); err != nil {
		return core.PreparedRequest{}, err
	}
	var calendar digestCalendar
	if in.DeliveryPolicy != nil && in.DeliveryPolicy.Automatic && in.Route.Kind == core.RequestRouteInbox {
		var err error
		calendar, err = s.store.loadDigestCalendar(ctx)
		if err != nil {
			return core.PreparedRequest{}, err
		}
	}
	var prepared core.PreparedRequest
	var refused error
	err := s.transact(ctx, false, func(r records, now uint64) error {
		attempt, err := prepareAttempt(in, now)
		if err != nil {
			return err
		}
		if err := pruneRequests(r, now); err != nil {
			return err
		}
		hold, err := incomingDigestHold(r, in, calendar, now)
		if err != nil {
			return err
		}
		if hold != nil {
			attempt.WaitActive = false
		}
		requests, responses := requestRows{r}, responseRows{r}
		existing, err := responses.FindByRequest(in.RequestID)
		if err != nil {
			return err
		}
		if existing != nil {
			return requestFailure("REQUEST_STATE_ERROR", "Request ID already has a retained final.", 1)
		}
		if err := requests.Insert(attempt, in.Message); err != nil {
			return err
		}
		if in.DeliveryPolicy != nil {
			if err := insertRequestDeliveryPolicy(r, in.RequestID, *in.DeliveryPolicy); err != nil {
				return err
			}
		}
		if in.Originator.IdentityID != nil {
			if err := raiseAttention(r, in.RequestID, *in.Originator.IdentityID, false); err != nil {
				return err
			}
		}
		if enqueue || hold != nil {
			status, err := queueAttempt(r, attempt, now)
			if err != nil {
				return err
			}
			if status == core.AttemptDefinitelyFailed {
				refused = requestFailure("REQUEST_STATE_ERROR", "Request attempt was not found.", 1)
				return nil
			}
		}
		prepared = core.PreparedRequest{RequestID: in.RequestID, AttemptID: in.AttemptID}
		if hold != nil {
			if err := recordIncomingDigestHold(r, in, *hold, now); err != nil {
				return err
			}
			prepared.DigestUntilMs = &hold.until
		}
		if in.Kind == core.RequestKindRequest &&
			(in.DeliveryPolicy == nil || in.DeliveryPolicy.Mode == core.RequestDeliveryRequest) {
			prepared.Receipt = core.EncodeReceipt(in.RequestID, in.AttemptID, in.Route)
		}
		return nil
	})
	if err != nil {
		return core.PreparedRequest{}, err
	}
	return prepared, refused
}

func validatePrepared(in core.PrepareRequest, enqueue bool) error {
	if !core.ValidExchangeText(in.Message) {
		return requestFailure("REQUEST_INPUT_TOO_LARGE", "Original request exceeds the UTF-8 byte limit.", 1)
	}
	if in.RequestID == "" || in.AttemptID == "" || !safeTime(in.ExpiresAtMs) || !core.ValidRetentionDays(in.RetentionDays) {
		return requestState()
	}
	if p := in.DeliveryPolicy; p != nil && (!p.Mode.Valid() || !p.Kind.Valid() || p.Kind == core.DigestKindResult) {
		return requestFailure("REQUEST_INPUT_INVALID", "Invalid request delivery policy.", 1)
	}
	switch in.Kind {
	case core.RequestKindRequest:
	case core.RequestKindAnnouncement:
		if in.Wait || in.Route.Kind != core.RequestRouteInbox {
			return requestState()
		}
	default:
		return requestState()
	}
	switch in.Originator.Kind {
	case core.OriginatorUnknown:
		if in.Originator.IdentityID != nil {
			return requestState()
		}
	case core.OriginatorExplicit, core.OriginatorVerified:
		if in.Originator.IdentityID == nil || *in.Originator.IdentityID == "" {
			return requestState()
		}
	default:
		return requestState()
	}
	if in.Recipient != nil && *in.Recipient == "" {
		return requestState()
	}
	if _, err := routeValues(in.Route); err != nil {
		return requestState()
	}
	if in.Route.Kind == core.RequestRouteInbox {
		if in.Recipient == nil || *in.Recipient != *in.Route.Recipient {
			return requestState()
		}
		return nil
	}
	if enqueue {
		return requestState()
	}
	pane := in.Route.Pane
	if pane.Server.Host == "" || pane.Server.ID == "" || pane.Server.Socket == "" || pane.Server.StartTime == "" ||
		pane.PaneID == "" || !safeTime(pane.Server.PID) || !safeTime(pane.PanePID) {
		return requestState()
	}
	return nil
}

func prepareAttempt(in core.PrepareRequest, now uint64) (core.RequestAttempt, error) {
	minExpiry, minOK := core.CheckedDeadline(now, core.RequestMinExpiryMs)
	expires := max(in.ExpiresAtMs, minExpiry)
	prompt, promptOK := core.RetentionDeadline(now, in.RetentionDays)
	acceptance, acceptOK := core.CheckedDeadline(now, core.ResponseAcceptanceWindowMs)
	settlement, settleOK := core.CheckedDeadline(expires, core.MetadataSettlementFloorMs)
	if !minOK || !promptOK || !acceptOK || !settleOK {
		return core.RequestAttempt{}, core.ErrAttemptDeadline
	}
	return core.RequestAttempt{
		RequestID: in.RequestID, AttemptID: in.AttemptID, Kind: in.Kind, Origin: in.Origin,
		Route: in.Route, Originator: in.Originator, Recipient: in.Recipient, WaitActive: in.Wait,
		Status: core.AttemptPrepared, PreparedAtMs: now, ExpiresAtMs: expires,
		RetentionDays: in.RetentionDays, RetentionExpiresAtMs: max(prompt, acceptance, settlement),
	}, nil
}

func queueAttempt(r records, attempt core.RequestAttempt, now uint64) (core.AttemptStatus, error) {
	recipient := *attempt.Route.Recipient
	active, err := (identityRows{r}).FindByID(recipient)
	if err != nil {
		return "", err
	}
	transition := core.AttemptTransition{
		AttemptID: attempt.AttemptID, From: core.AttemptPrepared, To: core.AttemptQueued, AtMs: now,
	}
	if active == nil {
		transition.To = core.AttemptDefinitelyFailed
		transition.ReleaseWait = attempt.WaitActive
	} else if err := raiseAttention(r, attempt.RequestID, recipient, true); err != nil {
		return "", err
	}
	return transition.To, changeAttempt(r, &transition)
}

func (s *RequestService) BeginSend(ctx context.Context, id core.AttemptID) error {
	return s.transition(ctx, id, core.PlanBeginSend)
}

func (s *RequestService) Settle(ctx context.Context, id core.AttemptID, outcome core.Settlement) error {
	return s.transition(ctx, id, func(attempt core.RequestAttempt, now uint64) (*core.AttemptTransition, error) {
		return core.PlanSettlement(attempt, outcome, now)
	})
}

func (s *RequestService) transition(ctx context.Context, id core.AttemptID, plan func(core.RequestAttempt, uint64) (*core.AttemptTransition, error)) error {
	if id == "" {
		return requestState()
	}
	var rejected error
	err := s.transact(ctx, false, func(r records, now uint64) error {
		attempt, err := (requestRows{r}).FindByAttemptID(id)
		if err != nil {
			return err
		}
		if attempt == nil {
			return requestFailure("REQUEST_STATE_ERROR", "Request attempt was not found.", 1)
		}
		change, err := plan(*attempt, now)
		if change == nil {
			return err
		}
		rejected = err
		return changeAttempt(r, change)
	})
	if err != nil {
		return err
	}
	return rejected
}

func changeAttempt(r records, transition *core.AttemptTransition) error {
	changed, err := (requestRows{r}).UpdateState(*transition)
	if err != nil {
		return err
	}
	if !changed {
		return requestState()
	}
	return nil
}

func (s *RequestService) ReleaseWait(ctx context.Context, id core.AttemptID) error {
	if id == "" {
		return requestState()
	}
	return s.transact(ctx, false, func(r records, now uint64) error {
		return (requestRows{r}).ReleaseWait(id, now)
	})
}

// The recipient stream shares the identity's revision allocator with reply
// notices so a combined incoming list has no duplicate cursor positions.
func raiseAttention(r records, id core.RequestID, identity core.IdentityID, incoming bool) error {
	if _, err := r.exec(`INSERT INTO request_attention_identities (identity_id, latest_revision, acknowledged_through)
		VALUES (?, 0, 0) ON CONFLICT(identity_id) DO NOTHING`, identity); err != nil {
		return err
	}
	result, err := r.exec(`UPDATE request_attention_identities SET latest_revision = latest_revision + 1
		WHERE identity_id = ? AND latest_revision < ?`, identity, core.MaxJSSafeInteger)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return requestFailure("X_REVISION_EXHAUSTED", "Exchange attention revision counter is exhausted.", 1)
	}
	var revision uint64
	if err := r.one("SELECT latest_revision FROM request_attention_identities WHERE identity_id = ?", identity).Scan(&revision); err != nil {
		return err
	}
	if incoming {
		if _, err := r.exec(`INSERT INTO request_recipient_attention_identities (identity_id, latest_revision, acknowledged_through)
			VALUES (?, ?, 0) ON CONFLICT(identity_id) DO UPDATE SET latest_revision = excluded.latest_revision`, identity, revision); err != nil {
			return err
		}
		_, err = r.exec("UPDATE request_attempts SET recipient_attention_revision = ? WHERE request_id = ?", revision, id)
	} else {
		_, err = r.exec("UPDATE request_attempts SET attention_revision = ? WHERE request_id = ?", revision, id)
	}
	return err
}

func isNoRows(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}
