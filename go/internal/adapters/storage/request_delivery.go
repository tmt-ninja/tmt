package storage

import (
	"encoding/json/v2"
	"errors"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

var errDeliveryEvidence = errors.New("invalid stored delivery evidence")

// Each projector belongs to one read snapshot, or to the read portion of a
// write before its first mutation. Cached recipient evidence is never reused
// after a write or across transactions.
type deliveryProjector struct {
	r          records
	calendar   digestCalendar
	now        uint64
	recipients map[core.IdentityID]deliveryRecipient
}

type deliveryRecipient struct {
	identity      *core.Identity
	person        bool
	activity      *core.DeliveryActivity
	refusal       string
	recovery      string
	holdRead      bool
	effectiveRead bool
	holdUntil     uint64
	legacyMaxHold *uint64
	maxHold       *uint64
	oldestHeld    *uint64
}

func (p *deliveryProjector) project(attempt core.RequestAttempt) (core.DeliveryView, error) {
	facts := core.DeliveryFacts{Attempt: attempt}
	var err error
	facts.Answer, err = readDeliveryAnswer(p.r, attempt, p.now)
	if err != nil {
		return core.DeliveryView{}, err
	}
	if facts.Answer != core.DeliveryNoAnswer {
		return core.ProjectDelivery(facts, p.now), nil
	}
	wake, err := readRequestWake(p.r, attempt.RequestID)
	if err != nil {
		return core.DeliveryView{}, err
	}
	facts.Wake = wake.observed(p.now)
	if err := p.readTurn(&facts); err != nil {
		return core.DeliveryView{}, err
	}
	if err := p.r.one("SELECT EXISTS(SELECT 1 FROM orchestration_talk_holds WHERE request_id=?)", attempt.RequestID).
		Scan(&facts.TalkHeld); err != nil {
		return core.DeliveryView{}, err
	}
	if attempt.Recipient != nil {
		if err := p.addRecipientFacts(&facts, *attempt.Recipient); err != nil {
			return core.DeliveryView{}, err
		}
	}
	return core.ProjectDelivery(facts, p.now), nil
}

func (p *deliveryProjector) readTurn(facts *core.DeliveryFacts) error {
	var ended *uint64
	err := p.r.one("SELECT started_ms,ended_ms FROM request_turns WHERE request_id=?", facts.Attempt.RequestID).
		Scan(&facts.TurnStartedMs, &ended)
	if isNoRows(err) {
		return nil
	}
	facts.TurnEnded = ended != nil
	return err
}

func (p *deliveryProjector) addRecipientFacts(facts *core.DeliveryFacts, id core.IdentityID) error {
	hold, since, err := readDeliveryHold(p.r, id, facts.Attempt.RequestID)
	if err != nil {
		return err
	}
	facts.Hold, facts.HeldAtMs = hold, since
	recipient, found := p.recipients[id]
	if !found {
		recipient, err = readDeliveryRecipient(p.r, id, p.now)
		if err != nil {
			return err
		}
	}
	var senderPerson bool
	if hold == core.DeliveryHoldOpen && !recipient.person {
		if facts.Attempt.Originator.IdentityID != nil {
			senderPerson, err = digestIsUser(p.r, *facts.Attempt.Originator.IdentityID)
			if err != nil {
				return err
			}
		}
		if err := p.readHoldLimits(id, &recipient, !senderPerson); err != nil {
			return err
		}
	}
	if p.recipients == nil {
		p.recipients = make(map[core.IdentityID]deliveryRecipient)
	}
	p.recipients[id] = recipient
	facts.RecipientPerson, facts.Activity = recipient.person, recipient.activity
	facts.RecipientStartRefusal, facts.RecipientRecovery = recipient.refusal, recipient.recovery
	if recipient.identity != nil {
		facts.RecipientName = string(recipient.identity.Name)
	}
	if hold == core.DeliveryHoldOpen {
		facts.OldestHeldAtMs, facts.MaxHoldMs = recipient.oldestHeld, recipient.maxHold
		if senderPerson {
			facts.MaxHoldMs = recipient.legacyMaxHold
		}
	}
	return nil
}

func (p *deliveryProjector) readHoldLimits(id core.IdentityID, recipient *deliveryRecipient, effective bool) error {
	if !recipient.holdRead {
		if err := p.readLegacyHold(id, recipient); err != nil {
			return err
		}
	}
	if effective && !recipient.effectiveRead && recipient.identity != nil && p.now < recipient.holdUntil {
		resolved, err := resolveDigestReceiving(p.r, recipient.identity, p.calendar, p.now)
		if err != nil {
			return err
		}
		switch resolved.mode {
		case core.OrchReceivingBatch:
			recipient.maxHold = &resolved.intervalMs
		case core.OrchReceivingDirect, core.OrchReceivingUrgent, core.OrchReceivingHold:
			recipient.maxHold = nil
		}
		recipient.effectiveRead = true
	}
	return nil
}

func (p *deliveryProjector) readLegacyHold(id core.IdentityID, recipient *deliveryRecipient) error {
	const oldest = `SELECT MIN(held) FROM (
		SELECT MIN(i.created_at_ms) AS held FROM focus_items i JOIN request_attempts a USING(request_id)
		WHERE i.identity_id=?1 AND i.checklist_id IS NULL AND a.retention_expires_at_ms>?2
		UNION ALL
		SELECT MIN(i.created_at_ms) FROM focus_checklists c JOIN focus_items i ON i.checklist_id=c.id
		JOIN request_attempts a USING(request_id)
		WHERE c.identity_id=?1 AND c.state='claimed' AND i.identity_id=?1 AND a.retention_expires_at_ms>?2)`
	if err := p.r.one(oldest, id, p.now).Scan(&recipient.oldestHeld); err != nil {
		return err
	}
	legacy, err := digestPolicy(p.r, id)
	if err != nil {
		return err
	}
	if legacy != nil {
		recipient.holdUntil = legacy.UntilMs
		recipient.legacyMaxHold, recipient.maxHold = legacy.MaxHoldMs, legacy.MaxHoldMs
	}
	recipient.holdRead = true
	return nil
}

func readDeliveryRecipient(r records, id core.IdentityID, now uint64) (deliveryRecipient, error) {
	var out deliveryRecipient
	var err error
	out.identity, err = (identityRows{r}).FindByID(id)
	if err != nil || out.identity == nil {
		return out, err
	}
	out.person, err = digestIsUser(r, id)
	if err != nil {
		return out, err
	}
	evidence, err := digestRecipientEvidence(r, id)
	if err != nil {
		return out, err
	}
	if activity := wakeActivity(evidence); activity != nil {
		out.activity = &core.DeliveryActivity{Phase: core.DigestPhase(activity.State), SinceMs: activity.SinceMs}
	}
	if evidence.binding != nil {
		out.refusal, out.recovery, err = readDeliveryRefusal(r, *out.identity, evidence, now)
	}
	return out, err
}

func readDeliveryRefusal(r records, identity core.Identity, evidence digestRecipient, now uint64) (string, string, error) {
	if raw := evidence.binding.Session.StartRefusal; raw != nil {
		var refusal struct {
			Driver  string  `json:"driver"`
			Session string  `json:"session"`
			Reason  string  `json:"reason"`
			AtMs    *uint64 `json:"atMs"`
		}
		if err := json.Unmarshal([]byte(*raw), &refusal, json.RejectUnknownMembers(true)); err != nil ||
			!validResumeToken(refusal.Driver) || !validStart(refusal.Session) || refusal.AtMs == nil || !core.ValidJSSafeInteger(*refusal.AtMs) {
			return "", "", errDeliveryEvidence
		}
		switch refusal.Reason {
		case "driver_mismatch", "previous_session_live", "previous_session_unknown", "private_process_unverified",
			"shared_runtime", "pane_process", "admission_refused", "session_not_learned":
			return refusal.Reason, "", nil
		default:
			return "", "", errDeliveryEvidence
		}
	}
	var driver core.DriverName
	var status string
	var step, reason *string
	err := r.one(`SELECT driver,status,step,reason FROM launch_observations
		WHERE binding_id=? AND expires_at_ms>? ORDER BY created_at_ms DESC,owner_pid DESC,owner_start DESC LIMIT 1`,
		evidence.binding.ID, now).Scan(&driver, &status, &step, &reason)
	if isNoRows(err) || err == nil && (status == "admitted" || step == nil || reason == nil) {
		return "", "", nil
	}
	if err != nil {
		return "", "", err
	}
	recovery := "Exit the agent in its pane, then start it again with tmt run in that pane."
	if evidence.rememberedSession != nil && evidence.driver != nil && *evidence.driver == driver {
		recovery = "Exit the agent in its pane, then run: tmt resume -- " + string(identity.ID)
	} else if driver.Valid() {
		command := "Exit the agent in its pane, then run: tmt run -- " + core.CommandWord(string(identity.Name)) + " " + string(driver)
		if len(command) <= 256 {
			recovery = command
		}
	}
	if len("session not bound · ")+len(recovery) > 256 {
		recovery = "Inspect the recipient and its next step: tmt identity show " + string(identity.ID)
	}
	return "session_not_learned", recovery, nil
}

func readDeliveryAnswer(r records, attempt core.RequestAttempt, now uint64) (core.DeliveryAnswer, error) {
	if attempt.ResponseSubmittedAtMs != nil {
		return core.DeliveryFinalAnswer, nil
	}
	var state string
	var delivered uint64
	var bound *uint64
	var folded bool
	err := r.one("SELECT state,delivered_at_ms,bound_at_ms,folded FROM request_passthrough WHERE request_id=?", attempt.RequestID).
		Scan(&state, &delivered, &bound, &folded)
	if isNoRows(err) {
		return core.DeliveryNoAnswer, nil
	}
	if err != nil {
		return core.DeliveryNoAnswer, err
	}
	switch state {
	case "answered":
		if folded {
			return core.DeliveryFoldedAnswer, nil
		}
		return core.DeliveryTurnAnswer, nil
	case "pending":
		if now-min(now, delivered) <= core.DeliveryBindWindowMs {
			return core.DeliveryNoAnswer, nil
		}
	case "bound":
		if bound != nil && now-min(now, *bound) <= core.DeliveryTurnWindowMs {
			return core.DeliveryNoAnswer, nil
		}
	case "no_answer":
	default:
		return core.DeliveryNoAnswer, errDeliveryEvidence
	}
	if bound != nil {
		return core.DeliveryTurnNoAnswer, nil
	}
	return core.DeliveryNoTurnStarted, nil
}

func readDeliveryHold(r records, recipient core.IdentityID, id core.RequestID) (core.DeliveryHold, uint64, error) {
	var since uint64
	var state *core.DigestState
	var opportunity *core.DigestOpportunity
	var confirmed *uint64
	err := r.one(`SELECT i.created_at_ms,c.state,c.opportunity,c.confirmed_at_ms FROM focus_items i
		LEFT JOIN focus_checklists c ON c.id=i.checklist_id
		WHERE i.identity_id=? AND i.request_id=? AND i.source='incoming'`, recipient, id).
		Scan(&since, &state, &opportunity, &confirmed)
	if isNoRows(err) {
		return core.DeliveryHoldNone, 0, nil
	}
	if err != nil {
		return core.DeliveryHoldNone, 0, err
	}
	switch {
	case state == nil || *state == core.DigestStateDefinitelyUnsent:
		return core.DeliveryHoldOpen, since, nil
	case *state == core.DigestStateClaimed:
		return core.DeliveryHoldClaimed, since, nil
	case *state == core.DigestStateDelivered:
		if opportunity != nil && *opportunity == core.DigestOpportunityIdle && confirmed == nil {
			return core.DeliveryHoldUnconfirmed, since, nil
		}
		return core.DeliveryHoldDelivered, since, nil
	case *state == core.DigestStateUncertain:
		return core.DeliveryHoldUnconfirmed, since, nil
	default:
		return core.DeliveryHoldNone, 0, errDeliveryEvidence
	}
}

func wakeActivity(evidence digestRecipient) *launchActivity {
	if !evidence.supportsDigestIdle() {
		return nil
	}
	return evidence.activity()
}
