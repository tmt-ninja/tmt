package storage

import (
	"context"
	"encoding/json/v2"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

func (s *Storage) Claim(ctx context.Context, q core.DigestClaim) (*core.DigestChecklist, error) {
	if !safeTime(q.NowMs) || !q.Opportunity.Valid() || !q.Kind.Valid() || !core.ValidUUID(string(q.ChecklistID)) ||
		!core.ValidUUID(string(q.AttemptToken)) || q.ThroughLimit != nil && !core.ValidJSSafeInteger(*q.ThroughLimit) {
		return nil, digestInvalid()
	}
	cal, err := s.loadDigestCalendar(ctx)
	if err != nil {
		return nil, err
	}
	var claim *core.DigestChecklist
	err = s.transact(ctx, false, func(r records) error {
		identity, err := digestIdentity(r, q.IdentityID)
		if err != nil {
			return err
		}
		if q.Launch != nil {
			if err := verifyDigestLaunch(r, q.IdentityID, *q.Launch); err != nil {
				return err
			}
		}
		current, err := readDigestChecklist(r, "id=?", q.ChecklistID)
		if err != nil {
			return err
		}
		if current != nil {
			if current.IdentityID != q.IdentityID || current.AttemptToken != q.AttemptToken {
				return digestFailure("DIGEST_ATTEMPT_MISMATCH", 5)
			}
			return nil // This ID has already spent its one transport permission.
		}
		active, err := activeDigest(r, q.IdentityID)
		if err != nil {
			return err
		}
		if q.Kind == core.DigestProjectionIncomingSummary {
			if active != nil {
				return nil
			}
			claim, err = claimDigestSummary(r, identity, q, cal)
			return err
		}
		if active != nil {
			stale, err := digestStale(r, q.IdentityID, q.NowMs)
			if err != nil || stale == nil {
				return err
			}
			if err := reapDigestClaim(r, stale, q.NowMs); err != nil {
				return err
			}
		}
		claim, err = claimFullDigest(r, identity, q, cal)
		return err
	})
	if err != nil {
		return nil, err
	}
	return claim, nil
}

func verifyDigestLaunch(r records, id core.IdentityID, fence core.DigestLaunchFence) error {
	found, err := r.Bindings().FindByIdentity(id)
	if err != nil {
		return err
	}
	expected := fence.Expected
	if found == nil || expected.IdentityID != id || found.Session.RuntimeState != "running" ||
		found.Session.Runtime == nil || found.Session.LaunchOwner == nil || found.Session.ProviderSessionID == nil ||
		*found.Session.ProviderSessionID != fence.ProviderSession {
		return digestFailure("DIGEST_ATTEMPT_MISMATCH", 5)
	}
	// Lifecycle telemetry can change while the Stop hook prepares its payload.
	expected.Session.LastTransition = found.Session.LastTransition
	expected.Session.StartRefusal = found.Session.StartRefusal
	expected.Session.PlainProgram = found.Session.PlainProgram
	if !matchBinding(found, &expected, false) {
		return digestFailure("DIGEST_ATTEMPT_MISMATCH", 5)
	}
	var remembered bool
	err = r.one(`SELECT EXISTS(SELECT 1 FROM identity_session_preferences WHERE identity_id=?
		AND remembered_harness=? AND provider_session_id=?)`, id, fence.Driver, fence.ProviderSession).Scan(&remembered)
	if err != nil {
		return err
	}
	if !remembered {
		return digestFailure("DIGEST_ATTEMPT_MISMATCH", 5)
	}
	return nil
}

func claimFullDigest(r records, identity *core.Identity, q core.DigestClaim, cal digestCalendar) (*core.DigestChecklist, error) {
	policy, err := digestPolicy(r, identity.ID)
	if err != nil {
		return nil, err
	}
	e, err := digestEligibilityFor(r, identity, policy, cal, q.Opportunity, q.NowMs)
	if err != nil {
		return nil, err
	}
	if q.ThroughLimit != nil {
		e.through = min(e.through, *q.ThroughLimit)
	}
	if q.Opportunity == core.DigestOpportunityTurnBoundary {
		if err := releaseDigestReoffers(r, identity.ID, e, q.NowMs); err != nil {
			return nil, err
		}
	}
	count, err := digestSelectedCount(r, identity.ID, e, q.NowMs)
	if err != nil || count.HeldCount == 0 {
		return nil, err
	}
	claim, err := insertDigestClaim(r, q, count.ThroughSequence, count.HeldCount, nil)
	if err != nil {
		return nil, err
	}
	result, err := r.exec(`UPDATE focus_items AS i SET checklist_id=?4 WHERE i.identity_id=?1 AND i.checklist_id IS NULL
		AND i.sequence<=?2 AND (`+e.selection+`) AND EXISTS(
			SELECT 1 FROM request_attempts a WHERE a.request_id=i.request_id AND a.retention_expires_at_ms>?3)`,
		q.IdentityID, claim.ThroughSequence, q.NowMs, claim.ID)
	if err := checkDigestMembers(result, err, count.HeldCount); err != nil {
		return nil, err
	}
	if err := reserveDigestEntries(r, *claim, q.Opportunity); err != nil {
		return nil, err
	}
	return claim, recordDigestClaim(r, *claim, e.receiving, q.NowMs)
}

func insertDigestClaim(r records, q core.DigestClaim, through, count uint64, urgent *uint64) (*core.DigestChecklist, error) {
	c := &core.DigestChecklist{ID: q.ChecklistID, IdentityID: q.IdentityID, AttemptToken: q.AttemptToken, ThroughSequence: through,
		State: core.DigestStateClaimed, CreatedAtMs: q.NowMs, Projection: q.Kind}
	if urgent != nil {
		c.Summary = &core.DigestSummaryCounts{IncomingCount: count, UrgentCount: *urgent}
	}
	var inUse bool
	if err := r.one("SELECT EXISTS(SELECT 1 FROM focus_checklists WHERE attempt_token=?)", q.AttemptToken).Scan(&inUse); err != nil {
		return nil, err
	}
	if inUse {
		return nil, digestFailure("DIGEST_ATTEMPT_MISMATCH", 5)
	}
	_, err := r.exec(`INSERT INTO focus_checklists(id,identity_id,attempt_token,through_sequence,state,created_at_ms,
		opportunity,sealed_count,projection,summary_urgent_count) VALUES(?,?,?,?,'claimed',?,?,?,?,?)`,
		c.ID, c.IdentityID, c.AttemptToken, through, c.CreatedAtMs, q.Opportunity, count, c.Projection, urgent)
	return c, err
}

type rowCount interface{ RowsAffected() (int64, error) }

func checkDigestMembers(res rowCount, err error, expected uint64) error {
	if err != nil {
		return err
	}
	count, err := res.RowsAffected()
	if err == nil && uint64(count) != expected {
		return errDigestEvidence
	}
	return err
}

func reserveDigestEntries(r records, c core.DigestChecklist, opportunity core.DigestOpportunity) error {
	_, err := r.exec(`INSERT INTO capture_entries(identity_id,batch_id,kind,request_id,source,delivery,checklist_id,created_ms)
		SELECT ?1,CASE WHEN ?2='turn_boundary' THEN (SELECT id FROM capture_batches WHERE identity_id=?1 AND closed_ms IS NULL) END,
			'input',request_id,source,'pending',?3,?4 FROM focus_items WHERE checklist_id=?3
		AND EXISTS(SELECT 1 FROM bindings WHERE identity_id=?1) ORDER BY sequence ON CONFLICT DO NOTHING`,
		c.IdentityID, opportunity, c.ID, c.CreatedAtMs)
	return err
}

func digestStale(r records, id core.IdentityID, now uint64) (*digestChecklistRow, error) {
	if now <= 10000 {
		return nil, nil
	}
	return readDigestChecklist(r, "identity_id=? AND state='claimed' AND opportunity='turn_boundary' AND created_at_ms<=?", id, now-10000)
}

func reapDigestClaim(r records, c *digestChecklistRow, now uint64) error {
	if c.Projection == core.DigestProjectionIncomingSummary {
		return settleDigestRows(r, c, core.DigestStateUncertain, now, false)
	}
	open, err := digestWorthOffering(r, c.IdentityID, &c.ID, now)
	if err != nil {
		return err
	}
	result, err := r.exec(`UPDATE focus_checklists SET state='uncertain',settled_at_ms=?2,confirmed_at_ms=?2,
		settlement_sequence=(SELECT value+1 FROM change_cursor WHERE id=1) WHERE id=?1 AND state='claimed'`, c.ID, now)
	if err := checkDigestMembers(result, err, 1); err != nil {
		return err
	}
	sequences := make([]uint64, 0, len(open))
	for _, item := range open {
		sequences = append(sequences, item.Sequence)
	}
	encoded, err := json.Marshal(sequences)
	if err != nil {
		return err
	}
	_, err = r.exec(`UPDATE focus_items SET checklist_id=NULL WHERE checklist_id=? AND sequence IN(SELECT value FROM json_each(?))`,
		c.ID, string(encoded))
	if err != nil {
		return err
	}
	return recordDigestSettlement(r, *c, core.DigestStateUncertain, now)
}

func (s *Storage) Settle(ctx context.Context, q core.DigestSettlement) (bool, error) {
	if !safeTime(q.NowMs) || !q.Outcome.Valid() || q.Outcome == core.DigestStateClaimed ||
		q.MessageStarted && q.Outcome != core.DigestStateDelivered {
		return false, digestInvalid()
	}
	var changed bool
	err := s.transact(ctx, false, func(r records) error {
		if _, err := digestIdentity(r, q.IdentityID); err != nil {
			return err
		}
		current, err := exactDigest(r, q.IdentityID, q.ChecklistID)
		if err != nil {
			return err
		}
		if current.AttemptToken != q.AttemptToken {
			return digestFailure("DIGEST_ATTEMPT_MISMATCH", 5)
		}
		if current.State == q.Outcome {
			return nil
		}
		if current.State != core.DigestStateClaimed {
			return digestFailure("DIGEST_STATE_INVALID", 5)
		}
		if err := settleDigestRows(r, current, q.Outcome, q.NowMs, q.MessageStarted); err != nil {
			return err
		}
		changed = true
		return nil
	})
	return err == nil && changed, err
}

func settleDigestRows(r records, c *digestChecklistRow, outcome core.DigestState, now uint64, started bool) error {
	if outcome == core.DigestStateDelivered {
		_, delivered, err := digestCounters(r, c.IdentityID)
		if err != nil {
			return err
		}
		if delivered >= core.MaxJSSafeInteger {
			return digestFailure("REQUEST_REVISION_EXHAUSTED", 5)
		}
	}
	result, err := r.exec(`UPDATE focus_checklists SET state=?1,settled_at_ms=?2,
		confirmed_at_ms=CASE WHEN projection='incoming_summary' THEN ?2 ELSE confirmed_at_ms END,
		settlement_sequence=(SELECT value+1 FROM change_cursor WHERE id=1)
		WHERE id=?3 AND identity_id=?4 AND attempt_token=?5 AND state='claimed'`, outcome, now, c.ID, c.IdentityID, c.AttemptToken)
	if err := checkDigestMembers(result, err, 1); err != nil {
		return err
	}
	switch outcome {
	case core.DigestStateDefinitelyUnsent:
		if _, err := r.exec("DELETE FROM capture_entries WHERE checklist_id=? AND delivery='pending'", c.ID); err != nil {
			return err
		}
		if _, err := r.exec("UPDATE focus_items SET checklist_id=NULL WHERE checklist_id=?", c.ID); err != nil {
			return err
		}
	case core.DigestStateDelivered, core.DigestStateUncertain:
		if _, err := r.exec("UPDATE capture_entries SET delivery=? WHERE checklist_id=? AND delivery='pending'", outcome, c.ID); err != nil {
			return err
		}
	}
	if outcome == core.DigestStateDelivered {
		if _, err := r.exec(`INSERT INTO digest_counters(identity_id,delivered_digests) VALUES(?,1)
			ON CONFLICT(identity_id) DO UPDATE SET delivered_digests=digest_counters.delivered_digests+1`, c.IdentityID); err != nil {
			return err
		}
		if c.Projection == core.DigestProjectionFull {
			if err := confirmDeliveredDigest(r, c, now, started); err != nil {
				return err
			}
		}
	}
	if c.Projection == core.DigestProjectionIncomingSummary {
		if err := settleDigestWakeMarker(r, c, now); err != nil {
			return err
		}
	}
	return recordDigestSettlement(r, *c, outcome, now)
}

func confirmDeliveredDigest(r records, c *digestChecklistRow, now uint64, started bool) error {
	if !started {
		if c.opportunity == nil || *c.opportunity != core.DigestOpportunityIdle {
			return nil
		}
		working, err := digestCurrentWorking(r, c.IdentityID)
		if err != nil || !working {
			return err
		}
	}
	changed, err := affectedOne(r.exec("UPDATE focus_checklists SET confirmed_at_ms=? WHERE id=? AND confirmed_at_ms IS NULL", now, c.ID))
	if err != nil || !changed {
		return err
	}
	_, err = r.exec(`UPDATE capture_entries SET batch_id=(SELECT id FROM capture_batches WHERE identity_id=?1 AND closed_ms IS NULL)
		WHERE identity_id=?1 AND checklist_id=?2 AND kind='input'
		AND EXISTS(SELECT 1 FROM capture_batches WHERE identity_id=?1 AND closed_ms IS NULL)`, c.IdentityID, c.ID)
	return err
}

func digestCurrentWorking(r records, id core.IdentityID) (bool, error) {
	var working bool
	err := r.one(`SELECT EXISTS(SELECT 1 FROM bindings b JOIN identity_session_preferences p ON p.identity_id=b.identity_id
		WHERE b.identity_id=? AND b.runtime_state='running' AND b.observed_provider_session_id=p.provider_session_id
		AND CASE WHEN json_valid(p.driver_state) THEN json_extract(p.driver_state,'$.activity.pid')=b.runtime_pid
		AND json_extract(p.driver_state,'$.activity.start')=b.runtime_start_identity
		AND json_extract(p.driver_state,'$.activity.session')=p.provider_session_id
		AND json_extract(p.driver_state,'$.activity.state')='working' END)`, id).Scan(&working)
	return working, err
}
