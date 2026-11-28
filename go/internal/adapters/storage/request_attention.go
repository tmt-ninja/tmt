package storage

import (
	"cmp"
	"context"
	"fmt"
	"slices"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

var _ ports.RequestService = (*RequestService)(nil)
var _ ports.IncomingXObserver = (*RequestService)(nil)

type attentionScope struct {
	owner, revision, acknowledged, counters string
}

var outgoingAttention = attentionScope{
	owner: "originator_identity_id", revision: "attention_revision",
	acknowledged: "attention_acknowledged_revision", counters: "request_attention_identities",
}

var incomingAttention = attentionScope{
	owner: "recipient_identity_id", revision: "recipient_attention_revision",
	acknowledged: "recipient_attention_acknowledged_revision", counters: "request_recipient_attention_identities",
}

func xScope(direction core.XDirection) (attentionScope, bool) {
	switch direction {
	case core.XOutgoing:
		return outgoingAttention, true
	case core.XIncoming:
		return incomingAttention, true
	default:
		return attentionScope{}, false
	}
}

type attentionKey struct {
	id           core.RequestID
	revision     uint64
	acknowledged bool
	response     bool
}

func (a attentionScope) selectSQL(index string) string {
	query := fmt.Sprintf(`SELECT a.request_id, a.%[1]s, MAX(a.%[2]s, c.acknowledged_through) >= a.%[1]s
		FROM request_attempts a %[5]s JOIN %[3]s c ON c.identity_id = a.%[4]s
		WHERE a.%[4]s = ?1 AND a.%[1]s > 0 AND a.retention_expires_at_ms > ?2`,
		a.revision, a.acknowledged, a.counters, a.owner, index)
	if a == incomingAttention {
		query += " AND a.route_kind = 'inbox' AND a.status = 'queued'"
	}
	return query
}

func validIncomingRoom(room *core.RoomID) bool {
	return room == nil || core.ValidUUID(string(*room)) && *room != "00000000-0000-0000-0000-000000000000"
}

func (s *RequestService) ListX(ctx context.Context, q core.XQuery) (core.XPage, error) {
	scope, ok := xScope(q.Direction)
	limit := q.Limit
	if limit == 0 {
		limit = defaultExchangeLimit
	}
	if !ok || q.Identity == "" || limit > maxExchangeLimit || !core.ValidJSSafeInteger(q.After) {
		return core.XPage{}, requestFailure("X_INPUT_INVALID", "Invalid exchange list limit or cursor.", 1)
	}
	if q.RoomID != nil && (q.Direction != core.XIncoming || !validIncomingRoom(q.RoomID)) {
		return core.XPage{}, requestFailure("X_INPUT_INVALID", "Invalid room UUID.", 1)
	}
	calendar, err := s.store.loadDigestCalendar(ctx)
	if err != nil {
		return core.XPage{}, err
	}
	page := core.XPage{Items: []core.XItem{}}
	err = s.transact(ctx, true, func(r records, now uint64) error {
		delivery := deliveryProjector{r: r, now: now, calendar: calendar}
		keys, err := listAttention(r, scope, q, limit+1, now, false, false)
		if err != nil {
			return err
		}
		if q.Direction == core.XIncoming {
			replies, err := listAttention(r, outgoingAttention, q, limit+1, now, true, false)
			if err != nil {
				return err
			}
			keys = append(keys, replies...)
			slices.SortFunc(keys, func(a, b attentionKey) int {
				if order := cmp.Compare(a.revision, b.revision); order != 0 {
					return order
				}
				return cmp.Compare(a.id, b.id)
			})
		}
		if len(keys) > int(limit) {
			keys = keys[:int(limit)]
			next := keys[len(keys)-1].revision
			page.NextAfter = &next
		}
		for _, key := range keys {
			item, _, err := projectAttention(&delivery, key)
			if err != nil {
				return err
			}
			page.Items = append(page.Items, item)
		}
		return nil
	})
	if err != nil {
		return core.XPage{}, err
	}
	return page, nil
}

func (s *RequestService) IncomingXWatermark(ctx context.Context, id core.IdentityID, room *core.RoomID) (uint64, error) {
	if id == "" {
		return 0, requestFailure("X_INPUT_INVALID", "Identifiers must be non-empty.", 1)
	}
	if !validIncomingRoom(room) {
		return 0, requestFailure("X_INPUT_INVALID", "Invalid room UUID.", 1)
	}
	query := core.XQuery{Identity: id, Direction: core.XIncoming, RoomID: room}
	var watermark uint64
	err := s.transact(ctx, true, func(r records, now uint64) error {
		requests, err := listAttention(r, incomingAttention, query, 1, now, false, true)
		if err != nil {
			return err
		}
		replies, err := listAttention(r, outgoingAttention, query, 1, now, true, true)
		if err != nil {
			return err
		}
		if len(requests) > 0 {
			watermark = requests[0].revision
		}
		if len(replies) > 0 {
			watermark = max(watermark, replies[0].revision)
		}
		return nil
	})
	return watermark, err
}

func listAttention(r records, scope attentionScope, q core.XQuery, limit, now uint64, responses, newest bool) ([]attentionKey, error) {
	index := ""
	switch {
	case q.RoomID != nil && responses:
		index = "INDEXED BY request_attempts_room_response_attention"
	case q.RoomID != nil:
		index = "INDEXED BY request_attempts_room_recipient_attention"
	case responses:
		index = "INDEXED BY request_attempts_response_attention"
	case scope == incomingAttention:
		index = "INDEXED BY request_attempts_recipient_attention"
	}
	query := scope.selectSQL(index) + fmt.Sprintf(` AND a.%[1]s > ?3
		AND a.%[2]s < a.%[1]s AND c.acknowledged_through < a.%[1]s`, scope.revision, scope.acknowledged)
	if responses {
		query += " AND a.response_submitted_at_ms IS NOT NULL"
	}
	args := []any{q.Identity, now, q.After, limit}
	if q.RoomID != nil {
		query += " AND a.room_id = ?5"
		args = append(args, q.RoomID)
	}
	order := ""
	if newest {
		order = " DESC"
	}
	query += " ORDER BY a." + scope.revision + order + ", a.request_id" + order + " LIMIT ?4"
	rows, err := r.query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []attentionKey
	for rows.Next() {
		key := attentionKey{response: responses}
		if err := rows.Scan(&key.id, &key.revision, &key.acknowledged); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func getAttention(r records, scope attentionScope, identity core.IdentityID, id core.RequestID, now uint64) (attentionKey, error) {
	var key attentionKey
	err := r.one(scope.selectSQL("")+" AND a.request_id = ?3", identity, now, id).
		Scan(&key.id, &key.revision, &key.acknowledged)
	if isNoRows(err) {
		err = requestFailure("X_NOT_FOUND", "Exchange was not found for this identity or is no longer retained.", 3)
	}
	return key, err
}

func projectAttention(delivery *deliveryProjector, key attentionKey) (core.XItem, *core.RequestAttempt, error) {
	r, now := delivery.r, delivery.now
	attempt, err := (requestRows{r}).FindByID(key.id)
	if err != nil {
		return core.XItem{}, nil, err
	}
	if attempt == nil {
		return core.XItem{}, nil, requestFailure("X_NOT_FOUND", "Exchange was not found for this identity or is no longer retained.", 3)
	}
	policy, err := deliveryPolicy(r, key.id)
	if err != nil {
		return core.XItem{}, nil, err
	}
	final, err := projectFinal(r, *attempt, policy.mode, now)
	if err != nil {
		return core.XItem{}, nil, err
	}
	view, err := delivery.project(*attempt)
	if err != nil {
		return core.XItem{}, nil, err
	}
	item := core.XItem{
		RequestID: key.id, RoomID: attempt.RoomID, Kind: core.XKind(attempt.Kind), Sender: attempt.Originator.IdentityID,
		Recipient: attempt.Recipient, PreparedAtMs: attempt.PreparedAtMs, Delivery: attempt.Status,
		MessageState: view, Final: final, Revision: key.revision, Acknowledged: key.acknowledged,
		Settled: attempt.Withdrawal != nil || (key.acknowledged &&
			(attempt.Kind == core.RequestKindAnnouncement || attempt.ResponseSubmittedAtMs != nil)),
		RetentionExpiresAtMs: attempt.RetentionExpiresAtMs,
		Urgent:               policy.urgent, DigestKind: policy.kind, Mode: policy.mode,
	}
	if key.response {
		item.Kind = core.XResponse
		item.Sender, item.Recipient = item.Recipient, item.Sender
	}
	return item, attempt, nil
}

func projectFinal(r records, attempt core.RequestAttempt, mode string, now uint64) (core.XFinal, error) {
	switch {
	case attempt.Withdrawal != nil:
		return core.XFinal{Status: core.FinalWithdrawn, Withdrawal: attempt.Withdrawal}, nil
	case attempt.Kind == core.RequestKindAnnouncement || mode == "passthrough":
		return core.XFinal{Status: core.FinalNotRequired}, nil
	case attempt.ResponseSubmittedAtMs == nil:
		return core.XFinal{Status: core.FinalNotSubmitted}, nil
	}
	var bodyBytes, expires uint64
	err := r.one("SELECT body_bytes, response_expires_at_ms FROM request_responses WHERE request_id = ?", attempt.RequestID).
		Scan(&bodyBytes, &expires)
	switch {
	case isNoRows(err):
		var ok bool
		expires, ok = core.RetentionDeadline(*attempt.ResponseSubmittedAtMs, attempt.RetentionDays)
		if !ok {
			return core.XFinal{}, core.ErrAttemptDeadline
		}
	case err != nil:
		return core.XFinal{}, err
	}
	final := core.XFinal{SubmittedAtMs: attempt.ResponseSubmittedAtMs, ExpiresAtMs: &expires}
	switch {
	case now >= expires:
		final.Status = core.FinalExpired
	case isNoRows(err):
		final.Status = core.FinalUnavailable
	default:
		final.Status, final.BodyBytes = core.FinalRetained, &bodyBytes
	}
	return final, nil
}

func (s *RequestService) ShowX(ctx context.Context, identity core.IdentityID, direction core.XDirection, id core.RequestID) (core.XDetail, error) {
	scope, ok := xScope(direction)
	if !ok || identity == "" || id == "" {
		return core.XDetail{}, requestFailure("X_INPUT_INVALID", "Identifiers must be non-empty.", 1)
	}
	calendar, err := s.store.loadDigestCalendar(ctx)
	if err != nil {
		return core.XDetail{}, err
	}
	var detail core.XDetail
	err = s.transact(ctx, true, func(r records, now uint64) error {
		key, err := getAttention(r, scope, identity, id, now)
		if err != nil {
			return err
		}
		delivery := deliveryProjector{r: r, now: now, calendar: calendar}
		item, attempt, err := projectAttention(&delivery, key)
		if err != nil {
			return err
		}
		detail.Exchange = item
		if err := r.one(`SELECT CASE WHEN message_expires_at_ms > ?2 AND message_bytes IS NOT NULL THEN message_text END,
			message_expires_at_ms FROM request_attempts WHERE request_id = ?1`, id, now).
			Scan(&detail.Prompt, &detail.PromptExpiresAtMs); err != nil {
			return err
		}
		if item.Final.Status == core.FinalRetained {
			if err := r.one("SELECT body FROM request_responses WHERE request_id = ?", id).
				Scan(&detail.Exchange.Final.Response); err != nil {
				return err
			}
		}
		if direction == core.XIncoming && item.Final.Status != core.FinalNotRequired && item.Final.Status != core.FinalWithdrawn {
			receipt := core.EncodeReceipt(id, attempt.AttemptID, attempt.Route)
			detail.Receipt = &receipt
		}
		return nil
	})
	if err != nil {
		return core.XDetail{}, err
	}
	return detail, nil
}

func (s *RequestService) AckX(ctx context.Context, identity core.IdentityID, direction core.XDirection, id core.RequestID, revision uint64) (core.AckResult, error) {
	scope, ok := xScope(direction)
	if !ok || identity == "" || id == "" {
		return core.AckResult{}, requestFailure("X_INPUT_INVALID", "Identifiers must be non-empty.", 1)
	}
	if !safeTime(revision) {
		return core.AckResult{}, requestFailure("X_INPUT_INVALID", "Revision must be a positive safe integer.", 1)
	}
	result := core.AckResult{RequestID: id, Revision: revision}
	err := s.transact(ctx, false, func(r records, now uint64) error {
		key, err := getAttention(r, scope, identity, id, now)
		if err != nil {
			return err
		}
		if key.revision != revision {
			return requestFailure("X_REVISION_CONFLICT", fmt.Sprintf("Exchange is at revision %d, not %d.", key.revision, revision), 5)
		}
		if key.acknowledged {
			return nil
		}
		query := fmt.Sprintf(`UPDATE request_attempts SET %[1]s = ?1
			WHERE request_id = ?2 AND %[2]s = ?3 AND %[3]s = ?1 AND %[1]s < ?1`, scope.acknowledged, scope.owner, scope.revision)
		change, err := r.exec(query, revision, id, identity)
		if err != nil {
			return err
		}
		count, err := change.RowsAffected()
		if err != nil {
			return err
		}
		if count != 1 {
			return requestState()
		}
		result.Changed = true
		return nil
	})
	if err != nil {
		return core.AckResult{}, err
	}
	return result, nil
}

func (s *RequestService) AckAllX(ctx context.Context, identity core.IdentityID, direction core.XDirection) (uint64, error) {
	scope, ok := xScope(direction)
	if !ok || identity == "" {
		return 0, requestFailure("X_INPUT_INVALID", "Identifiers must be non-empty.", 1)
	}
	var through uint64
	err := s.transact(ctx, false, func(r records, _ uint64) error {
		query := "UPDATE " + scope.counters + " SET acknowledged_through = latest_revision WHERE identity_id = ? RETURNING latest_revision"
		// The cursor update is a mutation, even though RETURNING reads its result.
		err := r.one(query, identity).Scan(&through)
		if isNoRows(err) {
			return nil
		}
		return err
	})
	return through, err
}
