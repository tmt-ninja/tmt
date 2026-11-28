package storage

import (
	"bytes"
	"context"
	"encoding/json/v2"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

const orchJournalRetentionMs = 30 * core.RetentionDayMs

func (s *Storage) ReadJournal(ctx context.Context, q core.OrchJournalQuery) (core.OrchJournalPage, error) {
	if !q.Subject.Valid() || !safeTime(q.NowMs) || q.Limit == 0 || q.Limit > 100 || q.Before != nil && !safeTime(*q.Before) {
		return core.OrchJournalPage{}, requestFailure("ORCH_INPUT_INVALID", "Invalid orchestration input or calendar selection.", 1)
	}
	before := uint64(core.MaxJSSafeInteger)
	if q.Before != nil {
		before = *q.Before
	}
	page := core.OrchJournalPage{RetainedAfterMs: subtractUsageMs(q.NowMs, orchJournalRetentionMs)}
	err := s.transact(ctx, true, func(r records) error {
		var err error
		page.Items, err = scanRows(r, `SELECT id,recorded_ms,subject_kind,subject_id,actor_id,recipient_id,
			action,outcome,reason,configuration_revision,time_zone,sources
			FROM orchestration_decisions WHERE subject_kind=?1 AND subject_id=?2 AND id<?3 AND expires_ms>?4
			ORDER BY id DESC LIMIT ?5`, scanOrchJournalEntry, q.Subject.Kind, q.Subject.ID, before, q.NowMs, q.Limit+1)
		return err
	})
	if err != nil {
		return core.OrchJournalPage{}, err
	}
	if len(page.Items) > int(q.Limit) {
		page.Items = page.Items[:q.Limit]
		last := page.Items[len(page.Items)-1].ID
		page.NextBefore = &last
	}
	return page, nil
}

func scanOrchJournalEntry(row scanner) (core.OrchJournalEntry, error) {
	var entry core.OrchJournalEntry
	var sources []byte
	err := row.Scan(&entry.ID, &entry.RecordedAtMs, &entry.Subject.Kind, &entry.Subject.ID, &entry.ActorID, &entry.RecipientID,
		&entry.Action, &entry.Outcome, &entry.Reason, &entry.ConfigurationRevision, &entry.TimeZone, &sources)
	if err != nil {
		return entry, err
	}
	if !entry.Subject.Valid() || !entry.Action.Valid() || !entry.Outcome.Valid() ||
		!safeTime(entry.ID) || !safeTime(entry.RecordedAtMs) || !core.ValidJSSafeInteger(entry.ConfigurationRevision) ||
		!validJournalIdentity(entry.ActorID) || !validJournalIdentity(entry.RecipientID) ||
		!validOrchJournalZone(entry.TimeZone) || !validOrchJournalReason(entry.Reason) {
		return entry, errInvalidOrchRow
	}
	entry.Sources, err = decodeOrchJournalSources(sources)
	return entry, err
}

func validJournalIdentity(id *core.IdentityID) bool {
	return id == nil || (core.OrchJournalSubject{Kind: core.OrchSubjectIdentity, ID: string(*id)}).Valid()
}

func validOrchJournalZone(zone string) bool {
	if zone == "" || len(zone) > 128 || zone[0] == '/' || zone[len(zone)-1] == '/' || strings.Contains(zone, "//") {
		return false
	}
	return !strings.ContainsFunc(zone, func(c rune) bool {
		return !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune("_/-+", c))
	})
}

func validOrchJournalReason(reason string) bool {
	return len(reason) <= 256 && strings.TrimSpace(reason) != "" && utf8.ValidString(reason) && !strings.ContainsFunc(reason, unicode.IsControl)
}

func decodeOrchJournalSources(raw []byte) ([]core.OrchDecisionSource, error) {
	encoded := bytes.TrimSpace(raw)
	if len(encoded) == 0 || len(encoded) > 8192 || encoded[0] != '[' {
		return nil, errInvalidOrchRow
	}
	// Revision and Defaulted are required even when zero or false.
	type storedSource struct {
		core.OrchSource
		Revision  *uint64 `json:"revision"`
		Defaulted *bool   `json:"defaulted"`
	}
	var rows []struct {
		Field  core.OrchPolicyField `json:"field"`
		Source storedSource         `json:"source"`
	}
	if json.Unmarshal(encoded, &rows, json.RejectUnknownMembers(true)) != nil || len(rows) > 5 {
		return nil, errInvalidOrchRow
	}
	sources := make([]core.OrchDecisionSource, 0, len(rows))
	seen := make(map[core.OrchPolicyField]bool, len(rows))
	for _, row := range rows {
		if !row.Field.Valid() || seen[row.Field] || row.Source.Revision == nil || row.Source.Defaulted == nil {
			return nil, errInvalidOrchRow
		}
		source := row.Source.OrchSource
		source.Revision, source.Defaulted = *row.Source.Revision, *row.Source.Defaulted
		if !source.Valid() {
			return nil, errInvalidOrchRow
		}
		seen[row.Field] = true
		sources = append(sources, core.OrchDecisionSource{Field: row.Field, Source: source})
	}
	return sources, nil
}
