package storage

import (
	"context"
	"fmt"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

func (s *RequestService) SubmitResponse(ctx context.Context, in core.SubmitResponse) (core.FinalResponse, error) {
	proof, err := core.DecodeReceipt(in.Receipt, in.RequestID)
	if err != nil {
		return core.FinalResponse{}, err
	}
	if err := validateResponseInput(in.RequestID, in.Body); err != nil {
		return core.FinalResponse{}, err
	}
	var final core.FinalResponse
	err = s.transact(ctx, false, func(r records, now uint64) error {
		var err error
		final, err = acceptResponse(r, in.RequestID, in.Body, proof, now)
		return err
	})
	if err != nil {
		return core.FinalResponse{}, err
	}
	return final, nil
}

func validateResponseInput(id core.RequestID, body string) error {
	if id == "" {
		return requestFailure("RESPONSE_INPUT_INVALID", "Response input is invalid.", 1)
	}
	if !core.ValidExchangeText(body) {
		return requestFailure("RESPONSE_INPUT_TOO_LARGE", "Response body exceeds the UTF-8 byte limit.", 1)
	}
	return nil
}

func acceptResponse(r records, id core.RequestID, body string, proof core.ReceiptProof, now uint64) (core.FinalResponse, error) {
	existing, err := (responseRows{r}).FindByRequest(id)
	if err != nil {
		return core.FinalResponse{}, err
	}
	if existing != nil {
		if err := proof.Verify(id, existing.AttemptID, existing.Route); err != nil {
			return core.FinalResponse{}, err
		}
		if now >= existing.ResponseExpiresAtMs {
			return core.FinalResponse{}, responseExpired()
		}
		if body != existing.Body {
			return core.FinalResponse{}, requestFailure("RESPONSE_CONFLICT", "Request already has a different final response.", 5)
		}
		return *existing, nil
	}
	attempt, err := (requestRows{r}).FindByID(id)
	if err != nil {
		return core.FinalResponse{}, err
	}
	if attempt == nil {
		return core.FinalResponse{}, requestFailure("RESPONSE_REQUEST_NOT_FOUND", "Request was not found.", 3)
	}
	if err := proof.Verify(id, attempt.AttemptID, attempt.Route); err != nil {
		return core.FinalResponse{}, err
	}
	policy, err := deliveryPolicy(r, id)
	if err != nil {
		return core.FinalResponse{}, err
	}
	if err := firstFinalRefusal(*attempt, policy.mode, now); err != nil {
		return core.FinalResponse{}, err
	}
	return storeFinal(r, *attempt, body, now)
}

func responseExpired() *core.RequestFailure {
	return requestFailure("RESPONSE_EXPIRED", "Final response can no longer be accepted or is no longer retained.", 1)
}

func firstFinalRefusal(attempt core.RequestAttempt, mode string, now uint64) error {
	if mode == "passthrough" {
		return requestFailure("RESPONSE_NOT_REQUIRED", "Announcements and typed passthrough messages do not accept replies.", 1)
	}
	switch {
	case attempt.Withdrawal != nil:
		return requestFailure("REQUEST_WITHDRAWN", "Request was withdrawn by its originator.", 5)
	case attempt.Kind == core.RequestKindAnnouncement:
		return requestFailure("RESPONSE_NOT_REQUIRED", "Announcements and typed passthrough messages do not accept replies.", 1)
	case attempt.ResponseSubmittedAtMs != nil || core.ResponseDeadlinePassed(now, attempt.PreparedAtMs, attempt.ExpiresAtMs):
		return responseExpired()
	}
	switch attempt.Status {
	case core.AttemptSending, core.AttemptSent, core.AttemptQueued, core.AttemptUncertain:
		return nil
	default:
		return requestFailure("RESPONSE_STATE_INVALID", "Final response cannot be accepted in the current request state.", 1)
	}
}

func storeFinal(r records, attempt core.RequestAttempt, body string, now uint64) (core.FinalResponse, error) {
	expires, ok := core.RetentionDeadline(now, attempt.RetentionDays)
	if !ok {
		return core.FinalResponse{}, core.ErrAttemptDeadline
	}
	final := core.FinalResponse{
		RequestID: attempt.RequestID, AttemptID: attempt.AttemptID, Route: attempt.Route,
		Body: body, BodyBytes: uint64(len(body)), SubmittedAtMs: now, ResponseExpiresAtMs: expires,
	}
	if err := (responseRows{r}).Insert(final); err != nil {
		return core.FinalResponse{}, err
	}
	result, err := r.exec(`UPDATE request_attempts SET response_submitted_at_ms = ?,
		retention_expires_at_ms = MAX(retention_expires_at_ms, ?)
		WHERE attempt_id = ? AND request_id = ? AND response_submitted_at_ms IS NULL AND withdrawn_at_ms IS NULL`,
		now, expires, attempt.AttemptID, attempt.RequestID)
	if err != nil {
		return core.FinalResponse{}, err
	}
	if count, err := result.RowsAffected(); err != nil || count != 1 {
		if err != nil {
			return core.FinalResponse{}, err
		}
		return core.FinalResponse{}, requestState()
	}
	if attempt.Originator.IdentityID != nil {
		if err := raiseAttention(r, attempt.RequestID, *attempt.Originator.IdentityID, false); err != nil {
			return core.FinalResponse{}, err
		}
	}
	// NOT PORTED (#6938, GO1-11): reply callbacks, provider capture, and flow accounting.
	return final, nil
}

func (s *RequestService) Result(ctx context.Context, id core.RequestID) (core.ResponseLookup, error) {
	_, result, err := s.selectResult(ctx, id, false)
	return result, err
}

func (s *RequestService) ResultByPrefix(ctx context.Context, input string) (core.RequestID, core.ResponseLookup, error) {
	return s.selectResult(ctx, core.RequestID(input), true)
}

func (s *RequestService) selectResult(ctx context.Context, id core.RequestID, prefix bool) (core.RequestID, core.ResponseLookup, error) {
	if id == "" {
		return "", core.ResponseLookup{}, requestFailure("RESPONSE_INPUT_INVALID", "Response input is invalid.", 1)
	}
	var result core.ResponseLookup
	err := s.transact(ctx, true, func(r records, now uint64) error {
		if prefix {
			selected, err := selectResultID(r, id, now)
			if err != nil {
				return err
			}
			id = selected
		}
		var err error
		result, err = lookupResponse(r, id, now)
		return err
	})
	if err != nil {
		return "", core.ResponseLookup{}, err
	}
	return id, result, nil
}

func lookupResponse(r records, id core.RequestID, now uint64) (core.ResponseLookup, error) {
	response, err := (responseRows{r}).FindByRequest(id)
	if err != nil {
		return core.ResponseLookup{}, err
	}
	if response != nil && now < response.ResponseExpiresAtMs {
		return core.ResponseLookup{Status: core.ResponseAvailable, Final: response}, nil
	}
	attempt, err := (requestRows{r}).FindByID(id)
	if err != nil {
		return core.ResponseLookup{}, err
	}
	if attempt != nil && now < attempt.RetentionExpiresAtMs {
		if attempt.Withdrawal != nil {
			return core.ResponseLookup{Status: core.ResponseWithdrawn, Withdrawal: attempt.Withdrawal}, nil
		}
		policy, err := deliveryPolicy(r, id)
		if err != nil {
			return core.ResponseLookup{}, err
		}
		if attempt.Kind == core.RequestKindAnnouncement || policy.mode == "passthrough" {
			return core.ResponseLookup{Status: core.ResponseNotRequired}, nil
		}
	}
	return core.ResponseLookup{Status: core.ResponseUnavailable}, nil
}

func selectResultID(r records, input core.RequestID, now uint64) (core.RequestID, error) {
	var exact bool
	if err := r.one(`SELECT EXISTS(SELECT 1 FROM request_attempts WHERE request_id = ?1
		UNION ALL SELECT 1 FROM request_responses WHERE request_id = ?1)`, input).Scan(&exact); err != nil {
		return "", err
	}
	if exact {
		return input, nil
	}
	lower, upper, err := resultPrefixRange(string(input))
	if err != nil || lower == "" {
		return input, err
	}
	const matches = `SELECT request_id FROM request_attempts WHERE request_id >= ?1 AND request_id < ?2 AND retention_expires_at_ms > ?3`
	rows, err := r.query("SELECT request_id FROM ("+matches+") ORDER BY request_id LIMIT 6", lower, upper, now)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var sample []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return "", err
		}
		sample = append(sample, id)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	switch len(sample) {
	case 0:
		return input, nil
	case 1:
		return core.RequestID(sample[0]), nil
	}
	message := "Request-ID prefix is ambiguous: "
	if len(sample) > 5 {
		var count uint64
		if err := r.one("SELECT COUNT(*) FROM ("+matches+")", lower, upper, now).Scan(&count); err != nil {
			return "", err
		}
		message += strings.Join(sample[:5], ", ") + fmt.Sprintf("; …and %d more", count-5)
	} else {
		message += strings.Join(sample, ", ")
	}
	return "", requestFailure("USAGE_ERROR", message, 1)
}

func resultPrefixRange(input string) (string, string, error) {
	prefix, prefixed := strings.CutPrefix(input, "req_")
	if len(prefix) > 36 || (prefixed && len(prefix) == 36) {
		return "", "", nil
	}
	hex := 0
	for index, b := range []byte(prefix) {
		switch index {
		case 8, 13, 18, 23:
			if b != '-' {
				return "", "", nil
			}
		default:
			if !(b >= '0' && b <= '9' || b >= 'a' && b <= 'f' || b >= 'A' && b <= 'F') {
				return "", "", nil
			}
			hex++
		}
	}
	if hex < 8 {
		return "", "", requestFailure("USAGE_ERROR", "Request-ID prefixes require at least 8 hex characters.", 1)
	}
	lower := "req_" + strings.ToLower(prefix)
	upper := []byte(lower)
	upper[len(upper)-1]++
	return lower, string(upper), nil
}

type storedPolicy struct {
	urgent    bool
	automatic bool
	kind      string
	mode      string
}

func deliveryPolicy(r records, id core.RequestID) (storedPolicy, error) {
	var p storedPolicy
	err := r.one("SELECT urgent, automatic, kind, mode FROM request_delivery_policies WHERE request_id = ?", id).
		Scan(&p.urgent, &p.automatic, &p.kind, &p.mode)
	if isNoRows(err) {
		return storedPolicy{automatic: true, kind: "fyi", mode: "request"}, nil
	}
	return p, err
}
