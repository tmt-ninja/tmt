package storage

import (
	"encoding/json/v2"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

const (
	digestOrdinaryClass = 1
	digestUrgentClass   = 2
	digestAllClasses    = digestOrdinaryClass | digestUrgentClass
)

type digestWakeMarker struct {
	classes   uint8
	checklist *core.DigestChecklistID
}

func readDigestWakeMarker(r records, id core.IdentityID) (*digestWakeMarker, error) {
	var m digestWakeMarker
	err := r.one("SELECT released_classes,checklist_id FROM orchestration_pending_wakes WHERE identity_id=?", id).Scan(&m.classes, &m.checklist)
	return optional(&m, err)
}

type digestSummaryMember struct {
	sequence uint64
	class    uint8
}

const digestSummaryScope = `i.identity_id=?1 AND i.checklist_id IS NULL AND i.source='incoming'
		AND a.route_kind='inbox' AND a.recipient_identity_id=?1 AND a.retention_expires_at_ms>?2
		AND a.request_kind='request' AND a.withdrawn_at_ms IS NULL AND a.response_submitted_at_ms IS NULL
		AND a.status IN ('sending','sent','queued','uncertain')
		AND (a.expires_at_ms>?2 OR a.prepared_at_ms>?3)
		AND NOT EXISTS(SELECT 1 FROM identity_metadata m WHERE m.identity_id=a.originator_identity_id AND m.key='user' AND m.value='true')
		AND EXISTS(SELECT 1 FROM request_delivery_policies p WHERE p.request_id=i.request_id AND p.automatic=1
			AND p.mode='request' AND (?4 & CASE WHEN p.urgent=1 THEN 2 ELSE 1 END)!=0)`

func digestSummaryMembers(r records, id core.IdentityID, classes uint8, now uint64) ([]digestSummaryMember, error) {
	// Only requests that would still admit a first final are summary members.
	// A pending wake holds classes, never a second copy of membership.

	floor := int64(now) - int64(core.ResponseAcceptanceWindowMs)
	return scanRows(r, `SELECT i.sequence,CASE WHEN p.urgent=1 THEN 2 ELSE 1 END FROM focus_items i
		JOIN request_attempts a USING(request_id) JOIN request_delivery_policies p USING(request_id) WHERE `+digestSummaryScope+" ORDER BY i.sequence",
		func(row scanner) (digestSummaryMember, error) {
			var m digestSummaryMember
			err := row.Scan(&m.sequence, &m.class)
			return m, err
		}, id, now, floor, classes)
}

func claimDigestSummary(r records, identity *core.Identity, q core.DigestClaim, cal digestCalendar) (*core.DigestChecklist, error) {
	user, err := digestIsUser(r, identity.ID)
	if err != nil || user {
		return nil, err
	}
	marker, err := readDigestWakeMarker(r, identity.ID)
	if err != nil || marker == nil || marker.checklist != nil {
		return nil, err
	}
	receiving, err := resolveDigestReceiving(r, identity, cal, q.NowMs)
	if err != nil || receiving.mode == "" {
		return nil, err
	}
	members, err := digestSummaryMembers(r, identity.ID, marker.classes, q.NowMs)
	if err != nil {
		return nil, err
	}
	if len(members) == 0 {
		_, err = r.exec("DELETE FROM orchestration_pending_wakes WHERE identity_id=?", identity.ID)
		return nil, err
	}
	released, err := releasedDigestClasses(r, identity.ID, receiving.mode, q.NowMs)
	if err != nil {
		return nil, err
	}

	sequences := make([]uint64, 0, len(members))
	var urgent uint64
	for _, member := range members {
		if member.class&released == 0 {
			continue
		}
		sequences = append(sequences, member.sequence)
		if member.class == digestUrgentClass {
			urgent++
		}
	}
	if len(sequences) == 0 {
		return nil, nil
	}
	clock, err := digestWakeClock(r)
	if err != nil || clock.NextAdmissionMs > q.NowMs {
		return nil, err
	}

	admit, ok := core.CheckedDeadline(q.NowMs, 1000)
	if !ok {
		return nil, digestFailure("REQUEST_REVISION_EXHAUSTED", 5)
	}
	c, err := insertDigestClaim(r, q, sequences[len(sequences)-1], uint64(len(sequences)), &urgent)
	if err != nil {
		return nil, err
	}
	data, err := json.Marshal(sequences)
	if err != nil {
		return nil, err
	}
	result, err := r.exec(`UPDATE focus_items SET checklist_id=? WHERE identity_id=? AND checklist_id IS NULL
		AND source='incoming' AND sequence IN(SELECT value FROM json_each(?))`, c.ID, identity.ID, string(data))
	if err := checkDigestMembers(result, err, uint64(len(sequences))); err != nil {
		return nil, err
	}
	result, err = r.exec("UPDATE orchestration_pending_wakes SET checklist_id=? WHERE identity_id=? AND checklist_id IS NULL", c.ID, identity.ID)
	if err := checkDigestMembers(result, err, 1); err != nil {
		return nil, err
	}
	_, err = r.exec(`INSERT INTO orchestration_wake_clock(id,next_admission_ms) VALUES(1,?)
		ON CONFLICT(id) DO UPDATE SET next_admission_ms=excluded.next_admission_ms,scan_after_identity_id=NULL`, admit)
	if err != nil {
		return nil, err
	}
	return c, recordDigestClaim(r, *c, receiving, q.NowMs)
}

func settleDigestWakeMarker(r records, c *digestChecklistRow, now uint64) error {
	m, err := readDigestWakeMarker(r, c.IdentityID)
	if err != nil || m == nil || m.checklist == nil || *m.checklist != c.ID {
		return err
	}
	classes, err := eligibleDigestWakeClasses(r, c.IdentityID, m.classes, now)
	if err != nil {
		return err
	}

	if classes == 0 {
		_, err = r.exec("DELETE FROM orchestration_pending_wakes WHERE identity_id=? AND checklist_id=?", c.IdentityID, c.ID)
	} else {
		_, err = r.exec("UPDATE orchestration_pending_wakes SET released_classes=?,checklist_id=NULL WHERE identity_id=? AND checklist_id=?",
			classes, c.IdentityID, c.ID)
	}
	return err
}

func eligibleDigestWakeClasses(r records, id core.IdentityID, classes uint8, now uint64) (uint8, error) {
	var eligible uint8
	floor := int64(now) - int64(core.ResponseAcceptanceWindowMs)
	err := r.one(`SELECT COALESCE(MAX(CASE WHEN p.urgent=0 THEN 1 ELSE 0 END),0)
		| COALESCE(MAX(CASE WHEN p.urgent=1 THEN 2 ELSE 0 END),0)
		FROM focus_items i JOIN request_attempts a USING(request_id) JOIN request_delivery_policies p USING(request_id)
		WHERE `+digestSummaryScope, id, now, floor, classes).Scan(&eligible)
	return eligible, err
}
