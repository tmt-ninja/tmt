package api

import (
	"context"
	"encoding/json/jsontext"
	json "encoding/json/v2"

	"github.com/tmt-ninja/tmt/go/internal/adapters/orchestration"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const orchestrationRead = "orchestration.read"
const orchestrationQueryLimit = 32_768 + 4_096

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

type orchestrationAction func(context.Context, ports.OrchReader) (any, *core.RequestFailure)

func decodeOrchestration(input jsontext.Value, now uint64) orchestrationAction {
	if len(input) > orchestrationQueryLimit {
		return nil
	}
	var tag struct {
		View string `json:"view"`
	}
	if json.Unmarshal(input, &tag) != nil {
		return nil
	}
	switch tag.View {
	case "why":
		query, ok := decodeWhy(input, now)
		if !ok {
			return nil
		}
		return func(ctx context.Context, reader ports.OrchReader) (any, *core.RequestFailure) {
			return orchestration.ReadWhy(ctx, reader, query)
		}
	case "overview":
		var wire struct {
			View        string  `json:"view"`
			RangeDays   *uint8  `json:"rangeDays"`
			AtMs        *uint64 `json:"atMs"`
			Plan        *string `json:"plan"`
			MemberQuery *string `json:"memberQuery"`
		}
		if json.Unmarshal(input, &wire, json.RejectUnknownMembers(true)) != nil {
			return nil
		}
		query := orchestration.OverviewQuery{RangeDays: 1, AtMs: wire.AtMs, Plan: wire.Plan, MemberQuery: wire.MemberQuery}
		if wire.RangeDays != nil {
			query.RangeDays = *wire.RangeDays
		}
		if !orchestration.ValidOverview(query) {
			return nil
		}
		return func(ctx context.Context, reader ports.OrchReader) (any, *core.RequestFailure) {
			return orchestration.ReadOverview(ctx, reader, query, now)
		}
	case "plans":
		var wire struct {
			View string  `json:"view"`
			Plan *string `json:"plan"`
		}
		if json.Unmarshal(input, &wire, json.RejectUnknownMembers(true)) != nil || !orchestration.ValidPlanSelector(wire.Plan) {
			return nil
		}
		return func(ctx context.Context, reader ports.OrchReader) (any, *core.RequestFailure) {
			return orchestration.ReadPlans(ctx, reader, wire.Plan, now)
		}
	default:
		return nil
	}
}
