package api

import (
	"context"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"errors"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const orchestrationRead = "orchestration.read"

type journalSubject struct {
	Kind core.OrchSubjectKind `json:"kind"`
	ID   string               `json:"id"`
}

type journalEntry struct {
	ID                    uint64                    `json:"id"`
	RecordedAtMs          uint64                    `json:"recordedAtMs"`
	Subject               journalSubject            `json:"subject"`
	ActorID               *core.IdentityID          `json:"actorId"`
	RecipientID           *core.IdentityID          `json:"recipientId"`
	Action                core.OrchDecisionAction   `json:"action"`
	Outcome               core.OrchDecisionOutcome  `json:"outcome"`
	Reason                string                    `json:"reason"`
	ConfigurationRevision uint64                    `json:"configurationRevision"`
	TimeZone              string                    `json:"timeZone"`
	Sources               []core.OrchDecisionSource `json:"sources"`
}

type journalCoverage struct {
	RetentionMs     uint64   `json:"retentionMs"`
	RetainedAfterMs uint64   `json:"retainedAfterMs"`
	LiveProducers   bool     `json:"liveProducers"`
	Producers       []string `json:"producers"`
	HistoryComplete bool     `json:"historyComplete"`
}

type journalView struct {
	SchemaVersion int             `json:"schemaVersion"`
	ObservedAtMs  uint64          `json:"observedAtMs"`
	Subject       journalSubject  `json:"subject"`
	Items         []journalEntry  `json:"items"`
	NextBefore    *uint64         `json:"nextBefore"`
	Coverage      journalCoverage `json:"coverage"`
}

func decodeWhy(input jsontext.Value, now uint64) (core.OrchJournalQuery, bool) {
	var wire struct {
		View    string         `json:"view"`
		Subject journalSubject `json:"subject"`
		Before  *uint64        `json:"before"`
		Limit   *uint16        `json:"limit"`
	}
	if json.Unmarshal(input, &wire, json.RejectUnknownMembers(true)) != nil || wire.View != "why" {
		return core.OrchJournalQuery{}, false
	}
	query := core.OrchJournalQuery{
		Subject: core.OrchJournalSubject(wire.Subject),
		Before:  wire.Before,
		Limit:   50,
		NowMs:   now,
	}
	if wire.Limit != nil {
		query.Limit = *wire.Limit
	}
	return query, query.Subject.Valid() && query.Limit >= 1 && query.Limit <= 100 &&
		(query.Before == nil || *query.Before > 0 && core.ValidJSSafeInteger(*query.Before))
}

func readWhy(ctx context.Context, reader ports.OrchReader, query core.OrchJournalQuery) (journalView, error) {
	page, err := reader.ReadJournal(ctx, query)
	if err != nil {
		return journalView{}, err
	}
	items := make([]journalEntry, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, journalEntry{
			ID: item.ID, RecordedAtMs: item.RecordedAtMs, Subject: journalSubject(item.Subject),
			ActorID: item.ActorID, RecipientID: item.RecipientID, Action: item.Action, Outcome: item.Outcome,
			Reason: item.Reason, ConfigurationRevision: item.ConfigurationRevision, TimeZone: item.TimeZone,
			Sources: item.Sources,
		})
	}
	return journalView{
		SchemaVersion: 1, ObservedAtMs: query.NowMs, Subject: journalSubject(query.Subject),
		Items: items, NextBefore: page.NextBefore,
		Coverage: journalCoverage{
			RetentionMs: 30 * core.RetentionDayMs, RetainedAfterMs: page.RetainedAfterMs,
			LiveProducers: true, Producers: []string{"digest_claim", "digest_settlement"},
		},
	}, nil
}

func orchestrationFault(err error) *Fault {
	var failure *core.RequestFailure
	if errors.As(err, &failure) {
		return operationFault(err)
	}
	return &Fault{Code: "ORCH_STORAGE_UNAVAILABLE", Message: "Could not read orchestration storage."}
}
