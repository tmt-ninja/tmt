package storage

import (
	"context"
	"encoding/json/v2"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

const talkHeldShownLimit = 20

func (s *Storage) ReadTalkFacts(ctx context.Context, q core.OrchTalkFactsQuery) (core.OrchTalkFactsPage, error) {
	if !q.Mode.Valid() || !safeTime(q.ObservedAtMs) {
		return core.OrchTalkFactsPage{}, requestFailure("ORCH_INPUT_INVALID", "Invalid orchestration input or calendar selection.", 1)
	}
	var page core.OrchTalkFactsPage
	err := s.transact(ctx, true, func(r records) error {
		members, err := scanOrchMembers(r, nil)
		if err != nil {
			return err
		}
		selected := members
		if q.MemberQuery != nil {
			normalized := core.NormalizeName(*q.MemberQuery)
			selected, err = scanOrchMembers(r, &normalized)
			if err != nil {
				return err
			}
		}
		page.Policy, err = readOrchPolicy(r, orchMemberNames(members))
		if err != nil {
			return err
		}
		page.SelectedIDs = orchMemberIDs(selected)
		page.Pairs = []core.OrchTalkPair{}
		if q.Mode == core.OrchTalkFactsRoutesAt || len(selected) == 0 {
			return nil
		}
		overflow := len(members) > orchSnapshotMemberLimit || len(selected) > orchSnapshotMemberLimit
		if overflow && q.Mode == core.OrchTalkFactsRoutesNow {
			return nil
		}
		page.Pairs, err = selectTalkPairs(r, orchMemberIDs(members), page.SelectedIDs, q, overflow)
		if err != nil || overflow {
			return err
		}
		for i := range page.Pairs {
			if err := readTalkPair(r, &page.Pairs[i], q); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return core.OrchTalkFactsPage{}, err
	}
	return page, nil
}

func orchMemberIDs(members []orchMember) []core.IdentityID {
	ids := make([]core.IdentityID, 0, len(members))
	for _, member := range members {
		ids = append(ids, member.id)
	}
	return ids
}

func selectTalkPairs(r records, members, selected []core.IdentityID, q core.OrchTalkFactsQuery, overflow bool) ([]core.OrchTalkPair, error) {
	allJSON, err := json.Marshal(members)
	if err != nil {
		return nil, err
	}
	selectedJSON, err := json.Marshal(selected)
	if err != nil {
		return nil, err
	}
	const pairs = `WITH active(id) AS (SELECT value FROM json_each(?1)), selected(id) AS (SELECT value FROM json_each(?2)),
		pairs(first_id, second_id) AS (
			SELECT MIN(originator_identity_id,recipient_identity_id), MAX(originator_identity_id,recipient_identity_id)
			FROM request_attempts WHERE request_kind='request' AND prepared_at_ms>=?3
			AND originator_identity_id IN (SELECT id FROM active) AND recipient_identity_id IN (SELECT id FROM active)
			AND originator_identity_id<>recipient_identity_id
			UNION
			SELECT MIN(from_id,to_id), MAX(from_id,to_id) FROM orchestration_talk_holds
			WHERE from_id IN (SELECT id FROM active) AND to_id IN (SELECT id FROM active)
		)
		SELECT first_id, second_id FROM pairs WHERE `
	scope := "(first_id IN (SELECT id FROM selected) OR second_id IN (SELECT id FROM selected))"
	if q.Mode == core.OrchTalkFactsRoutesNow {
		scope = "first_id IN (SELECT id FROM selected) AND second_id IN (SELECT id FROM selected) AND first_id <> second_id"
	}
	// The native member cap is checked when a pair needs evaluation. Keep
	// enough evidence to distinguish an empty view from a capped one.
	limit := len(members) * (len(members) + 1) / 2
	if overflow {
		limit = 1
	}
	return scanRows(r, pairs+scope+" ORDER BY first_id,second_id LIMIT ?4", func(row scanner) (core.OrchTalkPair, error) {
		var pair core.OrchTalkPair
		err := row.Scan(&pair.FirstID, &pair.SecondID)
		return pair, err
	}, string(allJSON), string(selectedJSON), q.ObservedAtMs-min(q.ObservedAtMs, orchTalkWindowMs), limit)
}

func readTalkPair(r records, pair *core.OrchTalkPair, q core.OrchTalkFactsQuery) error {
	a, b := pair.FirstID, pair.SecondID
	start, err := readTalkPairWindow(r, a, b, q.ObservedAtMs)
	if err != nil {
		return err
	}
	pair.Count, err = countTalkPair(r, a, b, start)
	if err != nil || q.Mode == core.OrchTalkFactsRoutesNow {
		return err
	}
	pair.WindowStartMs = start
	if err := r.one(`SELECT MAX(prepared_at_ms) FROM request_attempts WHERE request_kind='request'
		AND ((originator_identity_id=?1 AND recipient_identity_id=?2)
		     OR (originator_identity_id=?2 AND recipient_identity_id=?1))`, a, b).Scan(&pair.LastAtMs); err != nil {
		return err
	}
	const held = ` FROM orchestration_talk_holds h JOIN request_attempts a ON a.request_id=h.request_id
		WHERE (h.from_id=?1 AND h.to_id=?2) OR (h.from_id=?2 AND h.to_id=?1)`
	if err := r.one("SELECT COUNT(*),COALESCE(MAX(a.expires_at_ms>?3),0)"+held, a, b, q.ObservedAtMs).
		Scan(&pair.HeldCount, &pair.HasLiveHold); err != nil {
		return err
	}
	pair.Held, err = scanRows(r, `SELECT h.request_id,h.from_id,h.to_id,h.held_ms,a.expires_at_ms`+held+
		" ORDER BY h.held_ms,h.request_id LIMIT ?3", func(row scanner) (core.OrchHeldTalk, error) {
		var item core.OrchHeldTalk
		err := row.Scan(&item.RequestID, &item.FromID, &item.ToID, &item.HeldAtMs, &item.ExpiresAtMs)
		return item, err
	}, a, b, talkHeldShownLimit)
	return err
}
