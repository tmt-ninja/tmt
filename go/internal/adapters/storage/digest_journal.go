package storage

import (
	"encoding/json/v2"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

type digestJournalContext struct {
	Revision uint64          `json:"configurationRevision"`
	TimeZone string          `json:"timeZone"`
	Source   core.OrchSource `json:"source"`
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
	if json.Unmarshal(raw, &evidence, json.RejectUnknownMembers(true)) != nil || evidence.TimeZone == "" || !evidence.Source.Valid() {
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

func appendDigestDecision(r records, id core.IdentityID, e digestJournalContext, now uint64, outcome, reason string) error {
	expires, ok := core.CheckedDeadline(now, orchJournalRetentionMs)
	if !ok {
		return errDigestEvidence
	}
	sources, err := json.Marshal([]core.OrchDecisionSource{{Field: core.OrchFieldReceiving, Source: e.Source}})
	if err != nil {
		return err
	}
	_, err = r.exec(`INSERT INTO orchestration_decisions(recorded_ms,expires_ms,subject_kind,subject_id,recipient_id,
		action,outcome,reason,configuration_revision,time_zone,sources) VALUES(?,?,'identity',?,?,'send',?,?,?,?,?)`,
		now, expires, id, id, outcome, reason, e.Revision, e.TimeZone, string(sources))
	return err
}
