package core

import "errors"

var (
	ErrAttemptExpired  = errors.New("Request attempt has expired.")
	ErrAttemptState    = errors.New("Request attempt cannot make this transition.")
	ErrAttemptTime     = errors.New("Expected a positive safe integer.")
	ErrAttemptDeadline = errors.New("Request deadline is outside the supported range.")
)

// AttemptTransition describes one compare-and-swap change within a write
// transaction. The expected state is From.
type AttemptTransition struct {
	AttemptID            AttemptID
	From                 AttemptStatus
	To                   AttemptStatus
	AtMs                 uint64
	RetentionExpiresAtMs *uint64
	CadenceReserved      bool
	ReleaseWait          bool
}

// PlanBeginSend returns a transition to persist before doing any host work.
// If the delivery deadline passed, persist the unsent failure and waiter
// release before returning ErrAttemptExpired to the caller.
func PlanBeginSend(attempt RequestAttempt, nowMs uint64) (*AttemptTransition, error) {
	if nowMs == 0 || !ValidJSSafeInteger(nowMs) {
		return nil, ErrAttemptTime
	}
	if nowMs >= attempt.RetentionExpiresAtMs {
		return nil, ErrAttemptExpired
	}
	if attempt.Status != AttemptPrepared {
		return nil, ErrAttemptState
	}
	transition := AttemptTransition{
		AttemptID: attempt.AttemptID, From: attempt.Status, To: AttemptSending,
		AtMs: nowMs, CadenceReserved: attempt.CadenceReserved,
	}
	if nowMs >= attempt.ExpiresAtMs {
		transition.To = AttemptDefinitelyFailed
		transition.CadenceReserved = false
		transition.ReleaseWait = attempt.WaitActive
		return &transition, ErrAttemptExpired
	}
	return &transition, nil
}

// PlanSettlement preserves uncertainty after a possible delivery. A nil
// transition and nil error mean the same effective outcome already settled.
func PlanSettlement(attempt RequestAttempt, outcome Settlement, nowMs uint64) (*AttemptTransition, error) {
	if nowMs == 0 || !ValidJSSafeInteger(nowMs) {
		return nil, ErrAttemptTime
	}
	if nowMs >= attempt.RetentionExpiresAtMs &&
		(attempt.Status == AttemptPrepared || attempt.Status == AttemptSending) {
		return nil, ErrAttemptExpired
	}

	var effective AttemptStatus
	switch outcome {
	case SettlementSent:
		effective = AttemptSent
	case SettlementUncertain:
		effective = AttemptUncertain
	case SettlementDefinitelyFailed:
		effective = AttemptDefinitelyFailed
		if (attempt.Status == AttemptSending && nowMs >= attempt.ExpiresAtMs) ||
			(attempt.ResponseSubmittedAtMs != nil && (attempt.Status == AttemptSending || attempt.Status == AttemptUncertain)) {
			effective = AttemptUncertain
		}
	default:
		return nil, ErrAttemptState
	}
	switch attempt.Status {
	case AttemptSent, AttemptQueued, AttemptUncertain, AttemptDefinitelyFailed:
		if attempt.Status == effective {
			return nil, nil
		}
		return nil, ErrAttemptState
	case AttemptPrepared:
		if effective != AttemptDefinitelyFailed {
			return nil, ErrAttemptState
		}
	case AttemptSending:
		// All local outcomes can settle a sending attempt.
	default:
		return nil, ErrAttemptState
	}
	horizon, ok := CheckedDeadline(nowMs, MetadataSettlementFloorMs)
	if !ok {
		return nil, ErrAttemptDeadline
	}
	horizon = max(horizon, attempt.RetentionExpiresAtMs)
	return &AttemptTransition{
		AttemptID: attempt.AttemptID, From: attempt.Status, To: effective, AtMs: nowMs,
		RetentionExpiresAtMs: &horizon,
		CadenceReserved:      attempt.CadenceReserved && effective != AttemptDefinitelyFailed,
	}, nil
}
