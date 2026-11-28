package orchestration

import (
	"context"
	"errors"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const JournalDefaultLimit = 50
const JournalMaxLimit = 100

type JournalSubject struct {
	Kind core.OrchSubjectKind `json:"kind"`
	ID   string               `json:"id"`
}

type JournalEntry struct {
	ID                    uint64                    `json:"id"`
	RecordedAtMs          uint64                    `json:"recordedAtMs"`
	Subject               JournalSubject            `json:"subject"`
	ActorID               *core.IdentityID          `json:"actorId"`
	RecipientID           *core.IdentityID          `json:"recipientId"`
	Action                core.OrchDecisionAction   `json:"action"`
	Outcome               core.OrchDecisionOutcome  `json:"outcome"`
	Reason                string                    `json:"reason"`
	ConfigurationRevision uint64                    `json:"configurationRevision"`
	TimeZone              string                    `json:"timeZone"`
	Sources               []core.OrchDecisionSource `json:"sources"`
}

type JournalCoverage struct {
	RetentionMs     uint64   `json:"retentionMs"`
	RetainedAfterMs uint64   `json:"retainedAfterMs"`
	LiveProducers   bool     `json:"liveProducers"`
	Producers       []string `json:"producers"`
	HistoryComplete bool     `json:"historyComplete"`
}

type JournalView struct {
	SchemaVersion int             `json:"schemaVersion"`
	ObservedAtMs  uint64          `json:"observedAtMs"`
	Subject       JournalSubject  `json:"subject"`
	Items         []JournalEntry  `json:"items"`
	NextBefore    *uint64         `json:"nextBefore"`
	Coverage      JournalCoverage `json:"coverage"`
}

// ValidWhy checks the input limits shared by CLI and API.
func ValidWhy(query core.OrchJournalQuery) bool {
	return query.Subject.Valid() && query.Limit >= 1 && query.Limit <= JournalMaxLimit &&
		(query.Before == nil || *query.Before > 0 && core.ValidJSSafeInteger(*query.Before))
}

// ReadWhy projects one retained journal page for both public transports.
func ReadWhy(ctx context.Context, reader ports.OrchReader, query core.OrchJournalQuery) (JournalView, *core.RequestFailure) {
	page, err := reader.ReadJournal(ctx, query)
	if err != nil {
		return JournalView{}, readFailure(err)
	}
	items := make([]JournalEntry, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, JournalEntry{
			ID: item.ID, RecordedAtMs: item.RecordedAtMs, Subject: JournalSubject(item.Subject),
			ActorID: item.ActorID, RecipientID: item.RecipientID, Action: item.Action, Outcome: item.Outcome,
			Reason: item.Reason, ConfigurationRevision: item.ConfigurationRevision, TimeZone: item.TimeZone,
			Sources: item.Sources,
		})
	}
	return JournalView{
		SchemaVersion: 1, ObservedAtMs: query.NowMs, Subject: JournalSubject(query.Subject),
		Items: items, NextBefore: page.NextBefore,
		Coverage: JournalCoverage{
			RetentionMs: 30 * core.RetentionDayMs, RetainedAfterMs: page.RetainedAfterMs,
			LiveProducers: true, Producers: []string{"digest_claim", "digest_settlement"},
		},
	}, nil
}

func readFailure(err error) *core.RequestFailure {
	var failure *core.RequestFailure
	if errors.As(err, &failure) {
		return failure
	}
	return &core.RequestFailure{Code: "ORCH_STORAGE_UNAVAILABLE", Message: "Could not read orchestration storage.", Status: 1}
}
