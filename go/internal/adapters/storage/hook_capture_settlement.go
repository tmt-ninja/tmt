package storage

import (
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

func pruneHookResponses(r records, id core.IdentityID, now uint64) error {
	var cutoff uint64
	err := r.one(`SELECT COALESCE((SELECT sequence FROM recent_responses WHERE identity_id=? AND ordinary_dropped=0
		ORDER BY sequence DESC LIMIT 1 OFFSET 1000),0)`, id).Scan(&cutoff)
	if err != nil {
		return err
	}
	const doomed = "identity_id=?1 AND ordinary_dropped=0 AND (expires_ms<=?2 OR sequence<=?3)"
	const pinned = `(recent_responses.kept_owner_identity_id IS NOT NULL OR EXISTS (
		SELECT 1 FROM request_attempts a WHERE a.kept_capture_sequence=recent_responses.sequence
		AND a.keep_reply=1 AND a.keep_removed=0))`
	ops := []string{
		"INSERT INTO recent_response_floor(identity_id,dropped_through_ms) SELECT identity_id,MAX(ended_ms) FROM recent_responses WHERE " + doomed +
			" GROUP BY identity_id ON CONFLICT(identity_id) DO UPDATE SET dropped_through_ms=MAX(dropped_through_ms,excluded.dropped_through_ms)",
		"UPDATE recent_responses SET ordinary_dropped=1 WHERE " + doomed + " AND " + pinned,
		"DELETE FROM recent_responses WHERE ((ordinary_dropped=1 AND identity_id=?1) OR (" + doomed + ")) AND NOT " + pinned,
	}
	for _, op := range ops {
		if _, err := r.exec(op, id, now, cutoff); err != nil {
			return err
		}
	}
	return nil
}

func settleHookPassthrough(r records, c *core.HookPendingCapture, sequence, now uint64) error {
	const boundWindowMs = 21600000
	var floor uint64
	if c.NowMs > boundWindowMs {
		floor = c.NowMs - boundWindowMs
	}
	const ofAgent = "request_id IN (SELECT request_id FROM request_attempts WHERE recipient_identity_id=?1)"
	if _, err := r.exec("UPDATE request_passthrough SET state='no_answer',settled_at_ms=?3 WHERE state='bound' AND "+ofAgent+
		" AND (bound_session<>?2 OR bound_at_ms<?4)", c.Identity, c.Session, c.NowMs, floor); err != nil {
		return err
	}
	const inTurn = "state='bound' AND bound_session=?2 AND (?3 IS NULL OR bound_turn IS NULL OR bound_turn=?3) AND " + ofAgent
	if sequence == 0 {
		_, err := r.exec("UPDATE request_passthrough SET state='no_answer',settled_at_ms=?4 WHERE "+inTurn, c.Identity, c.Session, c.Turn, c.NowMs)
		return err
	}
	type boundRequest struct {
		id     core.RequestID
		sender *core.IdentityID
	}
	answered, err := scanRows(r, `SELECT p.request_id,a.originator_identity_id FROM request_passthrough p
		JOIN request_attempts a ON a.request_id=p.request_id WHERE p.state='bound' AND p.bound_session=?2
		AND (?3 IS NULL OR p.bound_turn IS NULL OR p.bound_turn=?3) AND a.recipient_identity_id=?1`,
		func(row scanner) (boundRequest, error) {
			var b boundRequest
			err := row.Scan(&b.id, &b.sender)
			return b, err
		}, c.Identity, c.Session, c.Turn)
	if err != nil {
		return err
	}
	if len(answered) == 1 {
		if err := pinHookPassthrough(r, answered[0].id, sequence, now); err != nil {
			return err
		}
	}
	text := c.Response.Text
	if len(text) > 8192 {
		end := 8192
		for !utf8.RuneStart(text[end]) {
			end--
		}
		text = text[:end]
	}
	_, err = r.exec(`UPDATE request_passthrough SET state='answered',answer_text=?4,answer_truncated=?5,
		answer_provider=?6,answer_ended_ms=?7,settled_at_ms=?7,answer_response=?8 WHERE `+inTurn,
		c.Identity, c.Session, c.Turn, text, c.Response.OriginalBytes > uint64(len(text)), c.Provider, c.NowMs, sequence)
	if err != nil {
		return err
	}
	for _, request := range answered {
		if request.sender != nil {
			if err := raiseAttention(r, request.id, *request.sender, false); err != nil {
				return err
			}
		}
	}
	_, err = r.exec(`INSERT INTO capture_acknowledgements(entry_sequence,request_id,identity_id,revision)
		SELECT e.sequence,a.request_id,a.originator_identity_id,a.attention_revision
		FROM request_passthrough p JOIN request_attempts a ON p.request_id=a.request_id
		JOIN capture_entries e ON e.identity_id=a.recipient_identity_id AND e.response_sequence=p.answer_response AND e.kind='final'
		WHERE p.answer_response=? AND a.originator_identity_id IS NOT NULL AND a.response_submitted_at_ms IS NULL
		ON CONFLICT DO NOTHING`, sequence)
	return err
}

func pinHookPassthrough(r records, id core.RequestID, sequence, now uint64) error {
	acceptanceFloor := int64(now) - int64(core.ResponseAcceptanceWindowMs)
	_, err := r.exec(`UPDATE request_attempts SET kept_capture_sequence=?2
		WHERE request_id=?1 AND keep_reply=1 AND keep_removed=0
		  AND kept_capture_sequence IS NULL AND withdrawn_at_ms IS NULL
		  AND (expires_at_ms>?3 OR prepared_at_ms>?4)
		  AND EXISTS (SELECT 1 FROM capture_entries e
			JOIN capture_entries input ON input.batch_id=e.batch_id
			JOIN request_passthrough p ON p.request_id=input.request_id
			WHERE e.response_sequence=?2 AND e.kind='final' AND input.kind='input'
			  AND input.source='incoming' AND input.request_id=request_attempts.request_id AND p.folded=0)`, id, sequence, now, acceptanceFloor)
	return err
}
