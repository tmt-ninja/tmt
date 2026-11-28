package storage

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

const (
	defaultExchangeLimit = 50
	maxExchangeLimit     = 200
	previewScalars       = 160
)

func (s *RequestService) Inbox(ctx context.Context, q core.InboxQuery) (core.InboxPage, error) {
	limit := q.Limit
	if limit == 0 {
		limit = defaultExchangeLimit
	}
	if q.Recipient == "" || limit > maxExchangeLimit || (q.Originator != nil && *q.Originator == "") {
		return core.InboxPage{}, requestFailure("ANSWER_INPUT_INVALID", "Invalid inbox limit or originator.", 1)
	}
	calendar, err := s.store.loadDigestCalendar(ctx)
	if err != nil {
		return core.InboxPage{}, err
	}
	var page core.InboxPage
	err = s.transact(ctx, true, func(r records, now uint64) error {
		items, err := openRequests(r, q.Recipient, q.Originator, limit+1, now)
		if err != nil {
			return err
		}
		page.More = len(items) > int(limit)
		page.Items = items[:min(len(items), int(limit))]
		delivery := deliveryProjector{r: r, now: now, calendar: calendar}
		for i := range page.Items {
			attempt, err := r.Requests().FindByID(page.Items[i].RequestID)
			if err != nil {
				return err
			}
			if attempt == nil {
				return errDeliveryEvidence
			}
			page.Items[i].MessageState, err = delivery.project(*attempt)
			if err != nil {
				return err
			}
		}
		return nil
	})
	return page, err
}

func openRequests(r records, recipient core.IdentityID, originator *core.IdentityID, limit, now uint64) ([]core.InboxItem, error) {
	windowStart := now - min(now, core.ResponseAcceptanceWindowMs)
	rows, err := r.query(`SELECT request_id, originator_kind, originator_identity_id, prepared_at_ms, status,
			CASE WHEN message_expires_at_ms > ?3 THEN substr(CAST(message_text AS BLOB), 1, ?6) ELSE NULL END
		FROM request_attempts
		WHERE recipient_identity_id = ?1 AND (?2 IS NULL OR originator_identity_id = ?2)
			AND request_kind = 'request' AND response_submitted_at_ms IS NULL AND withdrawn_at_ms IS NULL
			AND status IN ('sending', 'sent', 'queued', 'uncertain') AND retention_expires_at_ms > ?3
			AND (expires_at_ms > ?3 OR prepared_at_ms > ?4)
			AND NOT EXISTS (SELECT 1 FROM request_delivery_policies p
				WHERE p.request_id = request_attempts.request_id AND p.mode = 'passthrough')
		ORDER BY prepared_at_ms, request_id LIMIT ?5`, recipient, originator, now, windowStart, limit, previewScalars*utf8.UTFMax)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []core.InboxItem{}
	for rows.Next() {
		var item core.InboxItem
		var preview []byte
		if err := rows.Scan(&item.RequestID, &item.Originator.Kind, &item.Originator.IdentityID,
			&item.PreparedAtMs, &item.Delivery, &preview); err != nil {
			return nil, err
		}
		if preview != nil {
			text := trimPreview(string(preview))
			item.Preview = &text
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func trimPreview(text string) string {
	count := 0
	for offset, char := range text {
		if count == previewScalars || (char == utf8.RuneError && !utf8.FullRuneInString(text[offset:])) {
			return text[:offset]
		}
		count++
	}
	return text
}

func (s *RequestService) Answer(ctx context.Context, in core.AnswerRequest) (core.AnswerResult, error) {
	if in.Recipient == "" || (in.Originator != nil && *in.Originator == "") || (in.RequestID != nil && *in.RequestID == "") {
		return core.AnswerResult{}, requestFailure("ANSWER_INPUT_INVALID", "Identifiers must be non-empty.", 1)
	}
	if in.Originator == nil && in.RequestID == nil {
		return core.AnswerResult{}, requestFailure("ANSWER_INPUT_INVALID", "Name the originator or the request to answer.", 1)
	}
	if err := validateResponseInput("answer", in.Body); err != nil {
		return core.AnswerResult{}, err
	}
	var result core.AnswerResult
	err := s.transact(ctx, false, func(r records, now uint64) error {
		attempt, err := selectAnswer(r, in, now)
		if err != nil {
			return err
		}
		id := attempt.RequestID
		proof, err := core.DecodeReceipt(core.EncodeReceipt(id, attempt.AttemptID, attempt.Route), id)
		if err != nil {
			return err
		}
		final, err := acceptResponse(r, id, in.Body, proof, now)
		if err != nil {
			return err
		}
		result = core.AnswerResult{Final: final, Originator: attempt.Originator}
		return nil
	})
	if err != nil {
		return core.AnswerResult{}, err
	}
	return result, nil
}

func selectAnswer(r records, in core.AnswerRequest, now uint64) (*core.RequestAttempt, error) {
	var label string
	if in.Originator != nil {
		identity, err := (identityRows{r}).FindByID(*in.Originator)
		if err != nil {
			return nil, err
		}
		label = string(*in.Originator)
		if identity != nil {
			label = identity.CanonicalName
		}
	}
	var id core.RequestID
	if in.RequestID != nil {
		id = *in.RequestID
	} else {
		open, err := openRequests(r, in.Recipient, in.Originator, defaultExchangeLimit, now)
		if err != nil {
			return nil, err
		}
		switch len(open) {
		case 0:
			f := requestFailure("ANSWER_NOT_WAITING", fmt.Sprintf("%s is not waiting on you for a response.", label), 3)
			f.Suggestion = "tmt inbox"
			return nil, f
		case 1:
			id = open[0].RequestID
		default:
			var message strings.Builder
			fmt.Fprintf(&message, "%s is waiting on you for %d requests; nothing was sent.", label, len(open))
			for _, item := range open {
				preview := "(prompt no longer retained)"
				if item.Preview != nil && *item.Preview != "" {
					preview, _, _ = strings.Cut(*item.Preview, "\n")
					preview = strings.TrimSuffix(preview, "\r")
				}
				fmt.Fprintf(&message, "\n  %s  %s", item.RequestID, preview)
			}
			f := requestFailure("ANSWER_AMBIGUOUS", message.String(), 1)
			f.Suggestion = "choose one with --request <request-id>"
			return nil, f
		}
	}
	attempt, err := (requestRows{r}).FindByID(id)
	if err != nil {
		return nil, err
	}
	if attempt == nil || now >= attempt.RetentionExpiresAtMs || !matchesIdentity(attempt.Recipient, in.Recipient) ||
		(in.Originator != nil && !matchesIdentity(attempt.Originator.IdentityID, *in.Originator)) {
		message := "That request is not addressed to you."
		if label != "" {
			message = fmt.Sprintf("That request is not one %s sent you.", label)
		}
		return nil, requestFailure("X_NOT_FOUND", message, 3)
	}
	return attempt, nil
}

func matchesIdentity(identity *core.IdentityID, expected core.IdentityID) bool {
	return identity != nil && *identity == expected
}
