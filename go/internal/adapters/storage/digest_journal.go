package storage

import (
	"encoding/json/v2"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

type digestJournalSlot struct {
	StartMs uint64 `json:"startMs"`
	EndMs   uint64 `json:"endMs"`
}

type digestReceivingSource struct {
	Kind       string             `json:"kind"`
	PlanID     *string            `json:"planId"`
	IdentityID *core.IdentityID   `json:"identityId"`
	Revision   uint64             `json:"revision"`
	Slot       *digestJournalSlot `json:"slot"`
	Defaulted  bool               `json:"defaulted"`
}

type digestJournalContext struct {
	Revision uint64                `json:"configurationRevision"`
	TimeZone string                `json:"timeZone"`
	Source   digestReceivingSource `json:"source"`
}

func recordDigestClaim(r records, c core.DigestChecklist, d digestReceiving, now uint64) error {
	if d.mode == "" {
		return nil
	}
	evidence := digestJournalContext{Revision: d.revision, TimeZone: d.zone, Source: d.source}
	content, err := json.Marshal(evidence)
	if err != nil {
		return err
	}
	if _, err := r.exec("UPDATE focus_checklists SET orchestration_context=? WHERE id=?", string(content), c.ID); err != nil {
		return err
	}
	return appendDigestDecision(r, c.IdentityID, evidence, now, "allowed", "digest_claim")
}

func recordDigestSettlement(r records, c digestChecklistRow, outcome core.DigestState, now uint64) error {
	var raw []byte
	if err := r.one("SELECT orchestration_context FROM focus_checklists WHERE id=?", c.ID).Scan(&raw); err != nil || raw == nil {
		return err
	}
	var evidence digestJournalContext
	if json.Unmarshal(raw, &evidence, json.RejectUnknownMembers(true)) != nil || evidence.TimeZone == "" || !validDigestSource(evidence.Source) {
		return errDigestEvidence
	}
	switch outcome {
	case core.DigestStateDelivered:
		return appendDigestDecision(r, c.IdentityID, evidence, now, "sent", "digest_delivered")
	case core.DigestStateDefinitelyUnsent:
		return appendDigestDecision(r, c.IdentityID, evidence, now, "failed", "digest_unsent")
	case core.DigestStateUncertain:
		return appendDigestDecision(r, c.IdentityID, evidence, now, "uncertain", "digest_uncertain")
	default:
		return errDigestEvidence
	}
}

func validDigestSource(s digestReceivingSource) bool {
	if !core.ValidJSSafeInteger(s.Revision) || !optionalOrchID(s.PlanID) || !optionalOrchID(s.IdentityID) ||
		s.Slot != nil && (!safeTime(s.Slot.StartMs) || !safeTime(s.Slot.EndMs) || s.Slot.StartMs >= s.Slot.EndMs) {
		return false
	}
	switch s.Kind {
	case "base":
		return s.PlanID == nil && s.Slot == nil && !s.Defaulted && (s.Revision > 0 || s.IdentityID == nil)
	case "plan":
		return s.PlanID != nil && s.IdentityID == nil && s.Revision > 0
	case "member":
		return s.PlanID != nil && s.IdentityID != nil && s.Revision > 0
	case "focus":
		return s.PlanID == nil && s.IdentityID != nil && s.Revision > 0
	default:
		return false
	}
}

func appendDigestDecision(r records, id core.IdentityID, e digestJournalContext, now uint64, outcome, reason string) error {
	expires, ok := core.CheckedDeadline(now, 30*core.RetentionDayMs)
	if !ok {
		return errDigestEvidence
	}
	sources, err := json.Marshal([]struct {
		Field  string                `json:"field"`
		Source digestReceivingSource `json:"source"`
	}{{Field: "receiving", Source: e.Source}})
	if err != nil {
		return err
	}
	_, err = r.exec(`INSERT INTO orchestration_decisions(recorded_ms,expires_ms,subject_kind,subject_id,recipient_id,
		action,outcome,reason,configuration_revision,time_zone,sources) VALUES(?,?,'identity',?,?,'send',?,?,?,?,?)`,
		now, expires, id, id, outcome, reason, e.Revision, e.TimeZone, string(sources))
	return err
}
