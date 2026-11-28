package storage

import (
	"context"
	"encoding/json/v2"
	"slices"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

type digestEligibility struct {
	through   uint64
	selection string
	receiving digestReceiving
}

const digestAll = "1"
const digestIncoming = "i.source='incoming'"
const digestUrgent = digestIncoming + " AND EXISTS(SELECT 1 FROM request_delivery_policies p WHERE p.request_id=i.request_id AND p.urgent=1)"
const digestNotices = "i.source!='incoming'"
const digestNone = "0"
const digestPending = "i.identity_id=?1 AND i.checklist_id IS NULL AND i.sequence<=?2 AND a.retention_expires_at_ms>?3"
const digestUnconfirmed = "c.identity_id=?1 AND c.projection='full' AND c.state='delivered' AND c.opportunity='idle' AND c.confirmed_at_ms IS NULL"

func digestEligibilityFor(r records, identity *core.Identity, policy *core.DigestPolicy, cal digestCalendar, op core.DigestOpportunity, now uint64) (digestEligibility, error) {
	e := digestEligibility{through: core.MaxJSSafeInteger, selection: digestAll}
	user, err := digestIsUser(r, identity.ID)
	if err != nil || user {
		e.through = 0
		return e, err
	}
	active := policy != nil && policy.UntilMs > now
	if active {
		e.receiving, err = resolveDigestReceiving(r, identity, cal, now)
		if err != nil {
			return e, err
		}
	}
	var marker bool
	if err := r.one("SELECT EXISTS(SELECT 1 FROM orchestration_pending_wakes WHERE identity_id=?)", identity.ID).Scan(&marker); err != nil {
		return e, err
	}
	switch {
	case marker && (e.receiving.mode == core.OrchReceivingHold || e.receiving.mode == core.OrchReceivingUrgent):
		e.selection = digestNone
	case marker:
		e.selection = digestNotices
	case e.receiving.mode == core.OrchReceivingUrgent:
		e.selection = digestUrgent
	}
	switch {
	case e.receiving.mode == core.OrchReceivingHold:
		e.through = 0
	case op == core.DigestOpportunityIdle && active && e.receiving.mode != core.OrchReceivingDirect:
		e.through, _, err = digestCounters(r, identity.ID)
	}
	return e, err
}

func digestSelectedCount(r records, id core.IdentityID, e digestEligibility, now uint64) (core.DigestDue, error) {
	var count core.DigestDue
	err := r.one("SELECT COUNT(*),COALESCE(MAX(i.sequence),0) FROM focus_items i JOIN request_attempts a USING(request_id) WHERE "+digestPending+" AND ("+e.selection+")",
		id, e.through, now).Scan(&count.HeldCount, &count.ThroughSequence)
	return count, err
}

func (s *Storage) ReadStats(ctx context.Context, q core.DigestIdentityQuery) ([]core.DigestStats, error) {
	if !safeTime(q.NowMs) || len(q.IdentityIDs) == 0 || len(q.IdentityIDs) > 256 {
		return nil, digestInvalid()
	}
	cal, err := s.loadDigestCalendar(ctx)
	if err != nil {
		return nil, err
	}
	return digestBatch(s, ctx, q, func(r records, i *core.Identity) (core.DigestStats, error) {
		return readDigestStats(r, i, cal, q.NowMs)
	})
}

func readDigestStats(r records, identity *core.Identity, cal digestCalendar, now uint64) (core.DigestStats, error) {
	id := identity.ID
	stats := core.DigestStats{IdentityID: id, ObservedAtMs: now}
	view, err := digestPolicyView(r, id, now)
	if err != nil {
		return stats, err
	}
	stats.HeldCount = view.HeldCount
	var oldest *uint64
	err = r.one(`SELECT MIN(i.created_at_ms) FROM focus_items i JOIN request_attempts a USING(request_id)
		WHERE i.identity_id=?1 AND a.retention_expires_at_ms>?2 AND
		(i.checklist_id IS NULL OR i.checklist_id=(SELECT id FROM focus_checklists WHERE identity_id=?1 AND state='claimed'))`,
		id, now).Scan(&oldest)
	if err != nil {
		return stats, err
	}
	if oldest != nil {
		age := subtractUsageMs(now, *oldest)
		stats.OldestHeldAgeMs = &age
	}
	_, stats.DeliveredDigests, err = digestCounters(r, id)
	if err != nil || view.ActiveChecklist != nil {
		return stats, err
	}
	eligible, err := digestEligibilityFor(r, identity, view.Policy, cal, core.DigestOpportunityIdle, now)
	if err != nil {
		return stats, err
	}
	count, err := digestSelectedCount(r, id, eligible, now)
	if err != nil {
		return stats, err
	}
	stats.DueCount = count.HeldCount
	switch {
	case count.HeldCount > 0:
		stats.NextEligibleAtMs = &now
	case view.HeldCount > 0:
		if view.Policy != nil {
			eligible.receiving.consider(now, view.Policy.UntilMs)
		}
		stats.NextEligibleAtMs = eligible.receiving.nextChange
	}
	return stats, nil
}

func (s *Storage) ClaimableItems(ctx context.Context, q core.DigestClaimableQuery) (core.DigestChecklistPage, error) {
	if !validDigestPage(q.NowMs, 0, q.Limit) || !q.Opportunity.Valid() {
		return core.DigestChecklistPage{}, digestInvalid()
	}
	cal, err := s.loadDigestCalendar(ctx)
	if err != nil {
		return core.DigestChecklistPage{}, err
	}
	var page core.DigestChecklistPage
	err = s.transact(ctx, true, func(r records) error {
		identity, err := digestIdentity(r, q.IdentityID)
		if err != nil {
			return err
		}
		policy, err := digestPolicy(r, identity.ID)
		if err != nil {
			return err
		}
		e, err := digestEligibilityFor(r, identity, policy, cal, q.Opportunity, q.NowMs)
		if err != nil {
			return err
		}
		active, err := activeDigest(r, identity.ID)
		if err != nil {
			return err
		}
		if active != nil {
			page.ActiveChecklist = &active.DigestChecklist
		}
		selected, err := digestItems(r, digestPending+" AND ("+e.selection+") ORDER BY i.sequence LIMIT ?4", identity.ID, e.through, q.NowMs, q.Limit)
		if err != nil {
			return err
		}
		if q.Opportunity == core.DigestOpportunityTurnBoundary && e.through > 0 {
			reoffers, _, err := digestUnconfirmedItems(r, identity.ID, q.NowMs)
			if err != nil {
				return err
			}
			stale, err := digestStale(r, identity.ID, q.NowMs)
			if err != nil {
				return err
			}
			if stale != nil && stale.Projection == core.DigestProjectionFull {
				items, err := digestWorthOffering(r, identity.ID, &stale.ID, q.NowMs)
				if err != nil {
					return err
				}
				reoffers = append(reoffers, items...)
			}
			for _, item := range reoffers {
				eligible, err := digestItemSelected(r, item, e)
				if err != nil {
					return err
				}
				if eligible {
					selected = append(selected, item)
				}
			}
			slices.SortFunc(selected, func(a, b digestItemRow) int {
				if a.Sequence < b.Sequence {
					return -1
				}
				if a.Sequence > b.Sequence {
					return 1
				}
				return 0
			})
		}
		page.Total = uint64(len(selected))
		selected = selected[:min(uint64(len(selected)), q.Limit)]
		page.Items, err = hydrateDigestItems(r, selected, q.NowMs)
		return err
	})
	if err != nil {
		return core.DigestChecklistPage{}, err
	}
	return page, nil
}

func digestItemSelected(r records, item digestItemRow, e digestEligibility) (bool, error) {
	if item.Sequence > e.through {
		return false, nil
	}
	switch e.selection {
	case digestAll:
		return true, nil
	case digestNotices:
		return item.Source != core.DigestSourceIncoming, nil
	case digestUrgent:
		if item.Source != core.DigestSourceIncoming {
			return false, nil
		}
		p, err := deliveryPolicy(r, item.RequestID)
		return p.urgent, err
	default:
		return false, nil
	}
}

func digestOfferable(r records, id core.IdentityID, item digestItemRow, now uint64) (bool, error) {
	if item.Source == core.DigestSourceIncoming {
		a, err := r.Requests().FindByID(item.RequestID)
		if err != nil || a == nil {
			return false, err
		}
		p, err := deliveryPolicy(r, item.RequestID)
		return err == nil && firstFinalRefusal(*a, p.mode, now) == nil, err
	}
	var read bool
	err := r.one(`SELECT EXISTS(SELECT 1 FROM request_attempts a JOIN request_attention_identities c ON c.identity_id=a.originator_identity_id
		WHERE a.request_id=?1 AND a.originator_identity_id=?2 AND a.attention_revision>0
		AND MAX(a.attention_acknowledged_revision,c.acknowledged_through)>=a.attention_revision)`, item.RequestID, id).Scan(&read)
	return !read, err
}

func digestUnconfirmedItems(r records, id core.IdentityID, now uint64) ([]digestItemRow, uint64, error) {
	items, err := digestItems(r, `i.identity_id=?1 AND i.checklist_id IN(SELECT c.id FROM focus_checklists c WHERE `+digestUnconfirmed+`)
		AND a.retention_expires_at_ms>?2 ORDER BY i.sequence LIMIT 512`, id, now)
	if err != nil {
		return nil, 0, err
	}
	through := uint64(core.MaxJSSafeInteger)
	if len(items) == 512 {
		through = items[len(items)-1].Sequence
	}
	open := items[:0]
	for _, item := range items {
		ok, err := digestOfferable(r, id, item, now)
		if err != nil {
			return nil, 0, err
		}
		if ok {
			open = append(open, item)
		}
	}
	return open, through, nil
}

func digestWorthOffering(r records, id core.IdentityID, batch *core.DigestChecklistID, now uint64) ([]digestItemRow, error) {
	var out []digestItemRow
	var after uint64
	for {
		items, err := digestItems(r, digestScope+" ORDER BY i.sequence LIMIT 128", id, batch, now, after)
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			ok, err := digestOfferable(r, id, item, now)
			if err != nil {
				return nil, err
			}
			if ok {
				out = append(out, item)
			}
		}
		if len(items) < 128 {
			return out, nil
		}
		after = items[len(items)-1].Sequence
	}
}

func releaseDigestReoffers(r records, id core.IdentityID, e digestEligibility, now uint64) error {
	open, through, err := digestUnconfirmedItems(r, id, now)
	if err != nil {
		return err
	}
	later := make([]uint64, 0)
	for _, item := range open {
		eligible, err := digestItemSelected(r, item, e)
		if err != nil {
			return err
		}
		if !eligible {
			later = append(later, item.Sequence)
			continue
		}
		if _, err := r.exec("UPDATE focus_items SET checklist_id=NULL WHERE identity_id=? AND sequence=?", id, item.Sequence); err != nil {
			return err
		}
	}
	if e.selection != digestAll {
		return nil
	}
	encoded, err := json.Marshal(later)
	if err != nil {
		return err
	}
	_, err = r.exec(`UPDATE focus_checklists AS c SET confirmed_at_ms=?2 WHERE `+digestUnconfirmed+`
		AND NOT EXISTS(SELECT 1 FROM focus_items i WHERE i.checklist_id=c.id AND
			(i.sequence>?3 OR i.sequence IN(SELECT value FROM json_each(?4))))`, id, now, through, string(encoded))
	return err
}
