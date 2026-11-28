package api

import (
	"encoding/json/jsontext"
	json "encoding/json/v2"

	"github.com/tmt-ninja/tmt/go/internal/adapters/orchestration"
	"github.com/tmt-ninja/tmt/go/internal/core"
)

const orchestrationRead = "orchestration.read"

func decodeWhy(input jsontext.Value, now uint64) (core.OrchJournalQuery, bool) {
	var wire struct {
		View    string                       `json:"view"`
		Subject orchestration.JournalSubject `json:"subject"`
		Before  *uint64                      `json:"before"`
		Limit   *uint16                      `json:"limit"`
	}
	if json.Unmarshal(input, &wire, json.RejectUnknownMembers(true)) != nil || wire.View != "why" {
		return core.OrchJournalQuery{}, false
	}
	query := core.OrchJournalQuery{
		Subject: core.OrchJournalSubject(wire.Subject),
		Before:  wire.Before,
		Limit:   orchestration.JournalDefaultLimit,
		NowMs:   now,
	}
	if wire.Limit != nil {
		query.Limit = *wire.Limit
	}
	return query, orchestration.ValidWhy(query)
}
