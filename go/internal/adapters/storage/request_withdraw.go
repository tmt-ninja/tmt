package storage

import (
	"context"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

func (s *RequestService) Withdraw(ctx context.Context, originator core.IdentityID, id core.RequestID, reason string) (core.WithdrawResult, error) {
	if originator == "" || id == "" || len(reason) < 1 || len(reason) > 1024 || !utf8.ValidString(reason) {
		return core.WithdrawResult{}, requestFailure("REQUEST_WITHDRAWAL_INPUT_INVALID",
			"Withdrawal requires an originator, request ID and reason of 1–1024 UTF-8 bytes.", 1)
	}
	var withdrawal core.WithdrawResult
	err := s.transact(ctx, false, func(r records, now uint64) error {
		attempt, err := (requestRows{r}).FindByID(id)
		if err != nil {
			return err
		}
		if attempt == nil || now >= attempt.RetentionExpiresAtMs {
			return requestFailure("REQUEST_NOT_FOUND", "Request was not found or is no longer retained.", 3)
		}
		if !matchesIdentity(attempt.Originator.IdentityID, originator) {
			return requestFailure("REQUEST_ORIGINATOR_MISMATCH", "Only the recorded originator identity may withdraw; anonymous requests cannot be withdrawn.", 5)
		}
		if attempt.Kind != core.RequestKindRequest {
			return requestFailure("REQUEST_WITHDRAWAL_NOT_REQUIRED", "Announcements cannot be withdrawn as requests.", 5)
		}
		var hasFinal bool
		if err := r.one("SELECT EXISTS(SELECT 1 FROM request_responses WHERE request_id = ?)", id).Scan(&hasFinal); err != nil {
			return err
		}
		if attempt.ResponseSubmittedAtMs != nil || hasFinal {
			return requestFailure("REQUEST_ALREADY_FINAL", "Request already has a submitted final response.", 5)
		}
		if attempt.Withdrawal != nil {
			if attempt.Withdrawal.Reason != reason {
				return requestFailure("REQUEST_WITHDRAWAL_CONFLICT", "Request was already withdrawn with a different reason.", 5)
			}
			withdrawal = core.WithdrawResult{RequestID: id, Withdrawal: *attempt.Withdrawal}
			return nil
		}
		change, err := r.exec(`UPDATE request_attempts SET withdrawn_at_ms = ?1, withdrawal_reason = ?2,
			wait_released_at_ms = CASE WHEN wait_active = 1 THEN ?1 ELSE wait_released_at_ms END, wait_active = 0
			WHERE request_id = ?3 AND response_submitted_at_ms IS NULL AND withdrawn_at_ms IS NULL`, now, reason, id)
		if err != nil {
			return err
		}
		if count, err := change.RowsAffected(); err != nil {
			return err
		} else if count != 1 {
			return requestState()
		}
		withdrawal = core.WithdrawResult{
			RequestID: id, Changed: true, Withdrawal: core.Withdrawal{Reason: reason, WithdrawnAtMs: now},
		}
		return nil
	})
	if err != nil {
		return core.WithdrawResult{}, err
	}
	return withdrawal, nil
}
