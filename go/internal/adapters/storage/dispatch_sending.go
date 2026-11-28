package storage

import (
	"errors"
	"slices"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

const (
	orchTalkWindowMs       = 60 * 60 * 1000
	orchPersonHoldMs       = 7 * core.RetentionDayMs
	orchRouteRefusalWindow = 10 * 60 * 1000
)

type roomSendingPolicy struct {
	snapshot core.OrchPolicySnapshot
	from     core.IdentityID
	sender   core.OrchEffective
	zone     string
}

type roomSendingDecision struct {
	acceptance core.DispatchAcceptance
	granted    bool
}

func readRoomSending(r records, in core.RoomDispatchInput, cal digestCalendar, now uint64) (*roomSendingPolicy, error) {
	if in.Kind != core.RequestKindRequest || in.Originator.IdentityID == nil {
		return nil, nil
	}
	from := *in.Originator.IdentityID
	person, err := digestIsUser(r, from)
	if err != nil || person {
		return nil, err
	}
	for _, to := range in.RecipientIDs {
		person, err := digestIsUser(r, to)
		if err != nil {
			return nil, err
		}
		if !person {
			return loadRoomSending(r, from, cal, now)
		}
	}
	return nil, nil
}

func loadRoomSending(r records, from core.IdentityID, cal digestCalendar, now uint64) (*roomSendingPolicy, error) {
	// The unpublished Base permits every route and has no pair limit.
	var revision uint64
	err := r.one("SELECT COALESCE((SELECT revision FROM orchestration_settings WHERE id=1),0)").Scan(&revision)
	if err != nil || revision == 0 {
		return nil, err
	}
	members, err := readOrchMembers(r, nil)
	if err != nil {
		return nil, err
	}
	snapshot, err := readOrchPolicy(r, orchMemberNames(members))
	if err != nil {
		return nil, err
	}
	if !equalOptionalText(snapshot.TimeZone, cal.configured) {
		return nil, errors.New("orchestration calendar selection changed; retry the operation")
	}
	if cal.loadErr != nil {
		return nil, cal.loadErr
	}
	sender, err := core.ResolveOrchEffective(snapshot, from, now, cal.calendar)
	if err != nil {
		return nil, err
	}
	return &roomSendingPolicy{snapshot: snapshot, from: from, sender: sender, zone: cal.calendar.Name()}, nil
}

func (p *roomSendingPolicy) isLead(id core.IdentityID) bool {
	_, active := p.snapshot.Identities[id]
	return active && slices.Contains(p.snapshot.Leads, id)
}

func (p *roomSendingPolicy) admit(r records, to core.IdentityID, cal digestCalendar, now uint64) (roomSendingDecision, error) {
	var decision roomSendingDecision
	if p == nil {
		return decision, nil
	}
	person, err := digestIsUser(r, to)
	if err != nil || person {
		return decision, err
	}
	evidence := core.OrchSendingEvidence{
		AtMs: now, SenderIsLead: p.isLead(p.from), RecipientIsLead: p.isLead(to),
	}
	for _, grant := range p.snapshot.RouteGrants {
		if grant.FromID == p.from && grant.ToID == to {
			evidence.GrantUntilMs = grant.UntilMs
			break
		}
	}
	route := core.ResolveOrchSending(p.sender, core.OrchEffective{}, evidence).Route
	if route == core.OrchSendingRestricted {
		decision.acceptance = core.DispatchRestricted
		return decision, nil
	}
	decision.granted = route == core.OrchSendingGranted
	if evidence.SenderIsLead {
		return decision, nil
	}
	recipient, err := core.ResolveOrchEffective(p.snapshot, to, now, cal.calendar)
	if err != nil {
		return decision, err
	}
	if core.OrchPairLimit(p.sender.TalkLimit.Value, recipient.TalkLimit.Value) == nil {
		return decision, nil
	}
	start, err := readTalkPairWindow(r, p.from, to, now)
	if err != nil {
		return decision, err
	}
	count, err := countTalkPair(r, p.from, to, start)
	if err != nil {
		return decision, err
	}
	evidence.Count = &count
	if core.ResolveOrchSending(p.sender, recipient, evidence).NeedsPerson {
		decision.acceptance = core.DispatchHeld
	}
	return decision, nil
}

func readTalkPairWindow(r records, a, b core.IdentityID, now uint64) (uint64, error) {
	var resumed uint64
	err := r.one("SELECT resumed_ms FROM orchestration_talk_resumes WHERE first_id=? AND second_id=?",
		min(a, b), max(a, b)).Scan(&resumed)
	if err != nil && !isNoRows(err) {
		return 0, err
	}
	return max(now-min(now, orchTalkWindowMs), resumed), nil
}

func countTalkPair(r records, a, b core.IdentityID, start uint64) (uint64, error) {
	var count uint64
	err := r.one(`SELECT COUNT(*) FROM request_attempts r
		WHERE r.request_kind='request' AND r.prepared_at_ms>=?1
		AND ((r.originator_identity_id=?2 AND r.recipient_identity_id=?3) OR
			(r.originator_identity_id=?3 AND r.recipient_identity_id=?2))
		AND NOT EXISTS (SELECT 1 FROM orchestration_talk_holds h WHERE h.request_id=r.request_id)
		AND NOT EXISTS (SELECT 1 FROM orchestration_leads l JOIN identities i ON i.id=l.identity_id
			WHERE l.identity_id=r.originator_identity_id AND i.retired_at_ms IS NULL)`, start, a, b).Scan(&count)
	return count, err
}

func (p *roomSendingPolicy) record(r records, decision roomSendingDecision, item core.DispatchItem, now uint64) error {
	if p == nil {
		return nil
	}
	entry := core.OrchJournalEntry{
		RecordedAtMs: now, ActorID: &p.from, RecipientID: &item.RecipientID,
		Subject:               core.OrchJournalSubject{Kind: core.OrchSubjectRequest, ID: string(item.RequestID)},
		ConfigurationRevision: p.snapshot.Revision, TimeZone: p.zone,
	}
	switch decision.acceptance {
	case core.DispatchRestricted:
		var recent bool
		err := r.one(`SELECT EXISTS(SELECT 1 FROM orchestration_decisions
			WHERE subject_kind='identity' AND subject_id=?1 AND recipient_id=?2 AND reason='route_restricted'
			AND configuration_revision=?3 AND recorded_ms>?4)`,
			p.from, item.RecipientID, p.snapshot.Revision, now-min(now, orchRouteRefusalWindow)).Scan(&recent)
		if err != nil || recent {
			return err
		}
		entry.Subject = core.OrchJournalSubject{Kind: core.OrchSubjectIdentity, ID: string(p.from)}
		entry.Action, entry.Outcome, entry.Reason = core.OrchActionBlock, core.OrchOutcomeFailed, "route_restricted"
		entry.Sources = []core.OrchDecisionSource{{Field: core.OrchFieldSending, Source: p.sender.Sending.Source}}
		return appendOrchJournal(r, entry)
	case core.DispatchHeld:
		if _, err := r.exec("INSERT INTO orchestration_talk_holds(request_id,from_id,to_id,held_ms) VALUES(?,?,?,?)",
			item.RequestID, p.from, item.RecipientID, now); err != nil {
			return err
		}
		if _, err := r.exec(`UPDATE request_attempts SET expires_at_ms=MIN(?2,COALESCE(message_expires_at_ms,?2))
			WHERE request_id=?1`, item.RequestID, now+orchPersonHoldMs); err != nil {
			return err
		}
		entry.Action, entry.Outcome, entry.Reason = core.OrchActionDelay, core.OrchOutcomeHeld, "talk_limit"
		entry.Sources = []core.OrchDecisionSource{{Field: core.OrchFieldTalkLimit, Source: p.sender.TalkLimit.Source}}
		if err := appendOrchJournal(r, entry); err != nil {
			return err
		}
	}
	if decision.granted {
		entry.Action, entry.Outcome, entry.Reason = core.OrchActionSend, core.OrchOutcomeAllowed, "route_grant"
		entry.Sources = []core.OrchDecisionSource{{Field: core.OrchFieldSending, Source: p.sender.Sending.Source}}
		return appendOrchJournal(r, entry)
	}
	return nil
}
