package storage

import "github.com/tmt-ninja/tmt/go/internal/core"

const cleanupBatchSize = 100

// Read paths interpret deadlines in their snapshot. Bounded physical cleanup
// runs when a request writer is already held, so a result read stays deferred.
func pruneRequests(r records, now uint64) error {
	if err := expireAttempts(r, now); err != nil {
		return err
	}
	statements := [...]struct {
		query string
		args  []any
	}{
		{`UPDATE request_attempts SET message_text = NULL, message_bytes = NULL
			WHERE attempt_id IN (SELECT attempt_id FROM request_attempts
				WHERE message_text IS NOT NULL AND message_expires_at_ms <= ?
				ORDER BY message_expires_at_ms, attempt_id LIMIT ?)`, []any{now, cleanupBatchSize}},
		{`DELETE FROM request_responses WHERE request_id IN (
				SELECT request_id FROM request_responses WHERE response_expires_at_ms <= ?
					AND NOT EXISTS (SELECT 1 FROM request_attempts a
						WHERE a.request_id = request_responses.request_id AND a.keep_reply = 1 AND a.keep_removed = 0)
				ORDER BY response_expires_at_ms, request_id LIMIT ?)`, []any{now, cleanupBatchSize}},
		{`DELETE FROM request_attempts WHERE attempt_id IN (
				SELECT attempt_id FROM request_attempts WHERE wait_active = 0
					AND status IN ('sent', 'queued', 'uncertain', 'definitely_failed')
					AND settled_at_ms <= ?1 AND retention_expires_at_ms <= ?2
					AND NOT EXISTS (SELECT 1 FROM request_responses
						WHERE request_responses.attempt_id = request_attempts.attempt_id
							AND (request_responses.response_expires_at_ms > ?2
								OR (request_attempts.keep_reply = 1 AND request_attempts.keep_removed = 0)))
					AND NOT (keep_reply = 1 AND keep_removed = 0 AND kept_capture_sequence IS NOT NULL)
				ORDER BY retention_expires_at_ms, attempt_id LIMIT ?3)`,
			[]any{now - min(now, core.MetadataSettlementFloorMs), now, cleanupBatchSize}},
	}
	for _, step := range statements {
		if _, err := r.exec(step.query, step.args...); err != nil {
			return err
		}
	}
	// NOT PORTED (#6938): Digest, flow, capture, and incremental-vacuum cleanup.
	return nil
}

func expireAttempts(r records, now uint64) error {
	rows, err := r.query(`SELECT attempt_id, status, wait_active, cadence_reserved
		FROM request_attempts WHERE expires_at_ms <= ?
			AND (wait_active = 1 OR status IN ('prepared', 'sending'))
		ORDER BY expires_at_ms, attempt_id LIMIT ?`, now, cleanupBatchSize)
	if err != nil {
		return err
	}
	defer rows.Close()
	var expired []core.AttemptTransition
	for rows.Next() {
		change := core.AttemptTransition{AtMs: now}
		if err := rows.Scan(&change.AttemptID, &change.From, &change.ReleaseWait, &change.CadenceReserved); err != nil {
			return err
		}
		switch change.From {
		case core.AttemptPrepared:
			change.To, change.CadenceReserved = core.AttemptDefinitelyFailed, false
		case core.AttemptSending:
			change.To = core.AttemptUncertain
		}
		expired = append(expired, change)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	requests := requestRows{r}
	for _, change := range expired {
		if change.To == "" {
			if err := requests.ReleaseWait(change.AttemptID, now); err != nil {
				return err
			}
			continue
		}
		if err := changeAttempt(r, &change); err != nil {
			return err
		}
	}
	return nil
}
