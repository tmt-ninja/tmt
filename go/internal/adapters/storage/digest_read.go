package storage

import (
	"context"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

const digestItemColumns = "i.sequence,i.created_at_ms,i.context_tokens_at_arrival,i.context_observed_at_ms,i.phase_at_arrival,i.request_id,i.kind,i.source,i.checklist_id"

type digestItemRow struct {
	core.DigestItem
	checklist *core.DigestChecklistID
}

func scanDigestItem(row scanner) (digestItemRow, error) {
	var item digestItemRow
	err := row.Scan(&item.Sequence, &item.CreatedAtMs, &item.ContextTokensAtArrival, &item.ContextObservedAtMs,
		&item.PhaseAtArrival, &item.RequestID, &item.Kind, &item.Source, &item.checklist)
	if err == nil && (!item.Kind.Valid() || !item.Source.Valid() || item.PhaseAtArrival != nil && !item.PhaseAtArrival.Valid() ||
		!safeTime(item.Sequence) || !safeTime(item.CreatedAtMs)) {
		err = errDigestEvidence
	}
	return item, err
}

func digestItems(r records, where string, args ...any) ([]digestItemRow, error) {
	return scanRows(r, "SELECT "+digestItemColumns+" FROM focus_items i JOIN request_attempts a USING(request_id) WHERE "+where, scanDigestItem, args...)
}

func hydrateDigestItems(r records, rows []digestItemRow, now uint64) ([]core.DigestItem, error) {
	items := make([]core.DigestItem, 0, len(rows))
	for _, row := range rows {
		item := row.DigestItem
		err := hydrateDigestItem(r, &item, now)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func hydrateDigestItem(r records, item *core.DigestItem, now uint64) error {
	attempt, err := r.Requests().FindByID(item.RequestID)
	if err != nil {
		return err
	}
	if attempt == nil {
		return errDigestEvidence
	}
	item.Originator = attempt.Originator
	item.SenderID = attempt.Originator.IdentityID
	if item.Source != core.DigestSourceIncoming {
		item.SenderID = attempt.Recipient
	}
	if item.SenderID != nil {
		sender, err := r.Identities().FindByID(*item.SenderID)
		if err != nil {
			return err
		}
		if sender != nil {
			item.SenderName = &sender.Name
		}
		item.FromUser, err = digestIsUser(r, *item.SenderID)
		if err != nil {
			return err
		}
	}
	policy, err := deliveryPolicy(r, item.RequestID)
	if err != nil {
		return err
	}
	item.Urgent = policy.urgent
	err = r.one(`SELECT CASE WHEN message_expires_at_ms>?2 AND message_bytes IS NOT NULL THEN message_text END,
		message_expires_at_ms FROM request_attempts WHERE request_id=?1`, item.RequestID, now).Scan(&item.Prompt, &item.PromptExpiresAtMs)
	if err != nil {
		return err
	}
	item.Final, err = projectFinal(r, *attempt, policy.mode, now)
	if err != nil {
		return err
	}
	if item.Final.Status == core.FinalRetained {
		if err := r.one("SELECT body FROM request_responses WHERE request_id=?", item.RequestID).Scan(&item.Final.Response); err != nil {
			return err
		}
	}
	if item.Source == core.DigestSourceIncoming && item.Prompt != nil && firstFinalRefusal(*attempt, policy.mode, now) == nil {
		item.Reply = &core.DigestReplyProof{Route: attempt.Route, Receipt: core.EncodeReceipt(attempt.RequestID, attempt.AttemptID, attempt.Route)}
		item.ThreadRoot, err = readRequestThreadRoot(r, item.RequestID, now)
	}
	return err
}

func validDigestPage(now, after, limit uint64) bool {
	return safeTime(now) && core.ValidJSSafeInteger(after) && limit > 0 && limit <= 128
}

func (s *Storage) ReadChecklist(ctx context.Context, q core.DigestChecklistQuery) (core.DigestChecklistPage, error) {
	if !validDigestPage(q.NowMs, q.After, q.Limit) {
		return core.DigestChecklistPage{}, digestInvalid()
	}
	var page core.DigestChecklistPage
	err := s.transact(ctx, true, func(r records) error {
		if _, err := digestIdentity(r, q.IdentityID); err != nil {
			return err
		}
		if q.ChecklistID != nil {
			selected, err := exactDigest(r, q.IdentityID, *q.ChecklistID)
			if err != nil {
				return err
			}
			page.SelectedChecklist = &selected.DigestChecklist
			if selected.Projection == core.DigestProjectionIncomingSummary {
				page.Total = selected.Summary.IncomingCount
				page.Items = []core.DigestItem{}
				return nil
			}
		}
		active, err := activeDigest(r, q.IdentityID)
		if err != nil {
			return err
		}
		if active != nil {
			page.ActiveChecklist = &active.DigestChecklist
		}
		user, err := digestIsUser(r, q.IdentityID)
		if err != nil || user {
			return err
		}
		count, err := digestInventory(r, q.IdentityID, q.ChecklistID, q.After, q.NowMs)
		if err != nil {
			return err
		}
		page.Total = count.HeldCount
		items, err := digestItems(r, digestScope+" ORDER BY i.sequence LIMIT ?5", q.IdentityID, q.ChecklistID, q.NowMs, q.After, q.Limit)
		if err != nil {
			return err
		}
		page.Items, err = hydrateDigestItems(r, items, q.NowMs)
		return err
	})
	if err != nil {
		return core.DigestChecklistPage{}, err
	}
	return page, nil
}

func (s *Storage) ReadHistory(ctx context.Context, q core.DigestChecklistQuery) (core.DigestHistoryPage, error) {
	if !validDigestPage(q.NowMs, q.After, q.Limit) {
		return core.DigestHistoryPage{}, digestInvalid()
	}
	var page core.DigestHistoryPage
	err := s.transact(ctx, true, func(r records) error {
		if _, err := digestIdentity(r, q.IdentityID); err != nil {
			return err
		}
		if q.ChecklistID != nil {
			if _, err := exactDigest(r, q.IdentityID, *q.ChecklistID); err != nil {
				return err
			}
		}
		var err error
		page, err = readDigestHistory(r, q)
		return err
	})
	if err != nil {
		return core.DigestHistoryPage{}, err
	}
	return page, nil
}

func readDigestHistory(r records, q core.DigestChecklistQuery) (core.DigestHistoryPage, error) {
	page := core.DigestHistoryPage{ObservedAtMs: q.NowMs, Checklists: make([]core.DigestHistoryRecord, 0)}
	if err := r.one("SELECT value FROM change_cursor WHERE id=1").Scan(&page.ThroughSequence); err != nil {
		return page, err
	}
	err := r.one(`SELECT MIN(settlement_sequence),COUNT(CASE WHEN settlement_sequence IS NULL AND state!='claimed' THEN 1 END)
		FROM focus_checklists WHERE identity_id=?`, q.IdentityID).Scan(&page.RetainedFromSequence, &page.LegacySettledCount)
	if err != nil {
		return page, err
	}
	_, page.DeliveredDigests, err = digestCounters(r, q.IdentityID)
	if err != nil {
		return page, err
	}

	budget, limit, itemAfter := uint64(128), q.Limit+1, uint64(0)
	if q.ChecklistID != nil {
		budget, limit, itemAfter = q.Limit, 1, q.After
	}
	rows, err := scanRows(r, "SELECT "+digestChecklistColumns+`,settlement_sequence,settled_at_ms
		FROM focus_checklists WHERE identity_id=?1 AND settlement_sequence IS NOT NULL
		AND ((?2 IS NULL AND settlement_sequence>?3) OR id=?2) ORDER BY settlement_sequence LIMIT ?4`,
		scanDigestHistoryRecord, q.IdentityID, q.ChecklistID, q.After, limit)
	if err != nil {
		return page, err
	}
	for _, entry := range rows {
		retained, err := digestInventory(r, q.IdentityID, &entry.ChecklistID, 0, q.NowMs)
		if err != nil {
			return page, err
		}
		entry.RetainedCount = retained.HeldCount
		remaining := retained
		if itemAfter > 0 {
			remaining, err = digestInventory(r, q.IdentityID, &entry.ChecklistID, itemAfter, q.NowMs)
			if err != nil {
				return page, err
			}
		}
		if q.ChecklistID == nil && len(page.Checklists) > 0 && (uint64(len(page.Checklists)) >= q.Limit || remaining.HeldCount > budget) {
			last := page.Checklists[len(page.Checklists)-1].SettlementSequence
			page.NextAfter = &last
			break
		}
		items, err := digestItems(r, digestScope+" ORDER BY i.sequence LIMIT ?5", q.IdentityID, &entry.ChecklistID, q.NowMs, itemAfter, budget)
		if err != nil {
			return page, err
		}
		entry.Items = make([]core.DigestItemEvidence, 0, len(items))
		for _, item := range items {
			entry.Items = append(entry.Items, item.DigestItemEvidence)
		}
		if uint64(len(items)) < remaining.HeldCount && len(items) > 0 {
			last := items[len(items)-1].Sequence
			entry.NextItemAfter = &last
		}
		budget -= uint64(len(items))
		page.Checklists = append(page.Checklists, entry)
	}
	return page, nil
}

func scanDigestHistoryRecord(row scanner) (core.DigestHistoryRecord, error) {
	var c digestChecklistRow
	var h core.DigestHistoryRecord
	fields := c.fields()
	err := row.Scan(append(fields, &h.SettlementSequence, &h.SettledAtMs)...)
	if err == nil {
		err = c.validate()
	}
	if err == nil && c.State == core.DigestStateClaimed {
		err = errDigestEvidence
	}
	h.ChecklistID, h.ClaimedAtMs, h.SealedCount, h.Opportunity, h.Outcome, h.Summary = c.ID, c.CreatedAtMs, c.sealed, c.opportunity, c.State, c.Summary
	return h, err
}
