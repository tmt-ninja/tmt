package api

import (
	"context"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/digest"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type digestAction func(context.Context, ports.DigestStore) (any, error)

var digestOperations = []string{
	"digest.policy.set",
	"digest.policy.clear",
	"digest.policy.show",
	"digest.checklist.dueNow",
	"digest.stats.show",
	"digest.checklist.history",
	"digest.checklist.read",
	"digest.checklist.claim",
	"digest.checklist.flush",
	"digest.checklist.settle",
}

func decodeDigest(operation string, input jsontext.Value, now uint64) digestAction {
	switch operation {
	case "digest.policy.set", "digest.policy.clear":
		return decodeDigestPolicy(operation, input, now)
	case "digest.policy.show", "digest.stats.show":
		var wire struct {
			Identities []core.IdentityID `json:"identities"`
		}
		if !decodeObject(input, &wire) || !validIdentities(wire.Identities, 1, 256) {
			return nil
		}
		query := core.DigestIdentityQuery{IdentityIDs: wire.Identities, NowMs: now}
		if operation == "digest.stats.show" {
			return func(ctx context.Context, store ports.DigestStore) (any, error) {
				stats, err := store.ReadStats(ctx, query)
				rows := make([]any, 0, len(stats))
				for _, stat := range stats {
					rows = append(rows, map[string]any{
						"identityId": stat.IdentityID, "heldCount": stat.HeldCount, "oldestHeldAgeMs": stat.OldestHeldAgeMs,
						"deliveredDigests": stat.DeliveredDigests, "dueCount": stat.DueCount,
						"nextEligibleAtMs": stat.NextEligibleAtMs, "observedAtMs": stat.ObservedAtMs,
					})
				}
				return map[string]any{"stats": rows}, err
			}
		}
		return func(ctx context.Context, store ports.DigestStore) (any, error) {
			views, err := store.ReadPolicies(ctx, query)
			policies := make([]any, 0, len(views))
			for _, view := range views {
				document := policyDocument(view)
				document["identityId"] = view.IdentityID
				policies = append(policies, document)
			}
			return map[string]any{"policies": policies}, err
		}
	case "digest.checklist.dueNow":
		var wire struct {
			IdentityID core.IdentityID `json:"identityId"`
		}
		if !decodeObject(input, &wire) || !core.ValidUUID(string(wire.IdentityID)) {
			return nil
		}
		return func(ctx context.Context, store ports.DigestStore) (any, error) {
			due, err := store.MarkDue(ctx, core.DigestDueQuery{IdentityID: wire.IdentityID, NowMs: now})
			return map[string]any{
				"identityId": wire.IdentityID, "heldCount": due.HeldCount, "throughSequence": due.ThroughSequence,
			}, err
		}
	case "digest.checklist.read", "digest.checklist.history":
		query, ok := decodeChecklistQuery(input, now)
		if !ok {
			return nil
		}
		if operation == "digest.checklist.read" {
			return func(ctx context.Context, store ports.DigestStore) (any, error) {
				page, err := store.ReadChecklist(ctx, query)
				return checklistPageDocument(query, page), err
			}
		}
		return func(ctx context.Context, store ports.DigestStore) (any, error) {
			page, err := store.ReadHistory(ctx, query)
			return historyDocument(query.IdentityID, page), err
		}
	case "digest.checklist.settle":
		var wire struct {
			IdentityID   core.IdentityID         `json:"identityId"`
			ChecklistID  core.DigestChecklistID  `json:"checklistId"`
			AttemptToken core.DigestAttemptToken `json:"attemptToken"`
			Outcome      core.DigestState        `json:"outcome"`
		}
		if !decodeObject(input, &wire) || !core.ValidUUID(string(wire.IdentityID)) ||
			!core.ValidUUID(string(wire.ChecklistID)) || !core.ValidUUID(string(wire.AttemptToken)) ||
			!wire.Outcome.Valid() || wire.Outcome == core.DigestStateClaimed {
			return nil
		}
		return func(ctx context.Context, store ports.DigestStore) (any, error) {
			changed, err := store.Settle(ctx, core.DigestSettlement{
				IdentityID: wire.IdentityID, ChecklistID: wire.ChecklistID,
				AttemptToken: wire.AttemptToken, Outcome: wire.Outcome, NowMs: now,
			})
			return map[string]any{"changed": changed, "state": wire.Outcome}, err
		}
	default:
		return nil
	}
}

func decodeDigestPolicy(operation string, input jsontext.Value, now uint64) digestAction {
	var wire struct {
		IdentityID       core.IdentityID `json:"identityId"`
		OwnerID          core.IdentityID `json:"ownerIdentityId"`
		SetterID         core.IdentityID `json:"setterIdentityId"`
		ExpectedRevision *uint64         `json:"expectedRevision"`
		UntilMs          *uint64         `json:"untilMs"`
		MaxHoldMs        *uint64         `json:"maxHoldMs"`
	}
	if !decodeObject(input, &wire) || !core.ValidUUID(string(wire.IdentityID)) ||
		!core.ValidUUID(string(wire.OwnerID)) || !core.ValidUUID(string(wire.SetterID)) ||
		wire.ExpectedRevision == nil || !core.ValidJSSafeInteger(*wire.ExpectedRevision) {
		return nil
	}
	var until uint64
	if strings.HasSuffix(operation, ".clear") {
		if wire.UntilMs != nil {
			return nil
		}
	} else {
		if wire.UntilMs == nil || *wire.UntilMs == 0 || !core.ValidJSSafeInteger(*wire.UntilMs) {
			return nil
		}
		until = *wire.UntilMs
	}
	return func(ctx context.Context, store ports.DigestStore) (any, error) {
		view, err := store.WritePolicy(ctx, core.DigestPolicyWrite{
			IdentityID: wire.IdentityID, OwnerID: wire.OwnerID, SetterID: wire.SetterID,
			ExpectedRevision: *wire.ExpectedRevision, UntilMs: until, MaxHoldMs: wire.MaxHoldMs, NowMs: now,
		})
		return policyDocument(view), err
	}
}

func decodeChecklistQuery(input jsontext.Value, now uint64) (core.DigestChecklistQuery, bool) {
	wire := struct {
		IdentityID  core.IdentityID         `json:"identityId"`
		ChecklistID *core.DigestChecklistID `json:"checklistId"`
		After       uint64                  `json:"after"`
		Limit       uint64                  `json:"limit"`
	}{Limit: 32}
	if !decodeObject(input, &wire) || !core.ValidUUID(string(wire.IdentityID)) ||
		(wire.ChecklistID != nil && !core.ValidUUID(string(*wire.ChecklistID))) ||
		!core.ValidJSSafeInteger(wire.After) || wire.Limit == 0 || wire.Limit > 128 {
		return core.DigestChecklistQuery{}, false
	}
	return core.DigestChecklistQuery{
		IdentityID: wire.IdentityID, ChecklistID: wire.ChecklistID, After: wire.After, Limit: wire.Limit, NowMs: now,
	}, true
}

func decodeObject(raw jsontext.Value, destination any) bool {
	return raw.Kind() == '{' && json.Unmarshal(raw, destination, json.RejectUnknownMembers(true)) == nil
}

func validIdentities(ids []core.IdentityID, minimum, maximum int) bool {
	if len(ids) < minimum || len(ids) > maximum {
		return false
	}
	for _, id := range ids {
		if !core.ValidUUID(string(id)) {
			return false
		}
	}
	return true
}

func policyDocument(view core.DigestPolicyView) map[string]any {
	document := map[string]any{
		"identityId": nil, "revision": uint64(0), "active": false, "digestUntilMs": uint64(0), "remainingMs": uint64(0),
		"heldCount": view.HeldCount, "activeChecklist": checklistDocument(view.ActiveChecklist),
		"ownerIdentityId": nil, "setterIdentityId": nil, "maxHoldMs": nil,
	}
	if p := view.Policy; p != nil {
		document["identityId"], document["revision"] = p.IdentityID, p.Revision
		document["active"], document["digestUntilMs"] = p.UntilMs > view.ObservedAtMs, p.UntilMs
		document["remainingMs"] = p.UntilMs - min(p.UntilMs, view.ObservedAtMs)
		document["ownerIdentityId"], document["setterIdentityId"], document["maxHoldMs"] = p.OwnerID, p.SetterID, p.MaxHoldMs
	}
	return document
}

func checklistDocument(batch *core.DigestChecklist) any {
	if batch == nil {
		return nil
	}
	document := map[string]any{
		"checklistId": batch.ID, "identityId": batch.IdentityID, "attemptToken": batch.AttemptToken,
		"throughSequence": batch.ThroughSequence, "state": batch.State, "createdAtMs": batch.CreatedAtMs,
	}
	if counts := batch.Summary; counts != nil {
		document["projection"] = core.DigestProjectionIncomingSummary
		document["incomingCount"], document["urgentCount"] = counts.IncomingCount, counts.UrgentCount
	}
	return document
}

func historyDocument(id core.IdentityID, page core.DigestHistoryPage) any {
	records := make([]any, 0, len(page.Checklists))
	for _, record := range page.Checklists {
		items := make([]any, 0, len(record.Items))
		for _, item := range record.Items {
			items = append(items, map[string]any{
				"sequence": item.Sequence, "createdAtMs": item.CreatedAtMs, "contextTokensAtArrival": item.ContextTokensAtArrival,
				"contextObservedAtMs": item.ContextObservedAtMs, "phaseAtArrival": item.PhaseAtArrival,
			})
		}
		document := map[string]any{
			"checklistId": record.ChecklistID, "settlementSequence": record.SettlementSequence, "claimedAtMs": record.ClaimedAtMs,
			"settledAtMs": record.SettledAtMs, "outcome": record.Outcome, "opportunity": record.Opportunity,
			"sealedCount": record.SealedCount, "retainedCount": record.RetainedCount,
			"membershipComplete": record.SealedCount != nil && *record.SealedCount == record.RetainedCount,
			"nextItemAfter":      record.NextItemAfter, "items": items,
		}
		if counts := record.Summary; counts != nil {
			document["projection"] = map[string]any{
				"kind": core.DigestProjectionIncomingSummary, "incomingCount": counts.IncomingCount, "urgentCount": counts.UrgentCount,
			}
		}
		records = append(records, document)
	}
	return map[string]any{
		"identityId": id, "observedAtMs": page.ObservedAtMs, "throughSequence": page.ThroughSequence,
		"retainedFromSequence": page.RetainedFromSequence, "legacySettledCount": page.LegacySettledCount,
		"deliveredDigests": page.DeliveredDigests, "nextAfter": page.NextAfter, "checklists": records,
	}
}

func checklistPageDocument(q core.DigestChecklistQuery, page core.DigestChecklistPage) any {
	items := make([]any, 0, len(page.Items))
	if batch := page.SelectedChecklist; batch != nil && batch.Projection == core.DigestProjectionIncomingSummary && batch.Summary != nil {
		return map[string]any{
			"identityId": q.IdentityID, "checklistId": batch.ID, "projection": batch.Projection,
			"incomingCount": batch.Summary.IncomingCount, "urgentCount": batch.Summary.UrgentCount,
			"items": items, "total": batch.Summary.IncomingCount, "remaining": uint64(0), "nextAfter": nil,
		}
	}
	for _, item := range page.Items {
		items = append(items, digestItemDocument(item))
	}
	remaining := page.Total - min(page.Total, uint64(len(items)))
	var next *uint64
	if len(items) != 0 && remaining > 0 {
		next = &page.Items[len(items)-1].Sequence
	}
	return map[string]any{
		"identityId": q.IdentityID, "checklistId": q.ChecklistID, "activeChecklist": checklistDocument(page.ActiveChecklist),
		"items": items, "total": page.Total, "remaining": remaining, "nextAfter": next,
	}
}

func digestItemDocument(item core.DigestItem) map[string]any {
	id := string(item.RequestID)
	doc := map[string]any{
		"sequence": item.Sequence, "requestId": id, "kind": item.Kind, "source": item.Source, "createdAtMs": item.CreatedAtMs,
		"sender":   map[string]any{"identityId": item.SenderID, "name": item.SenderName},
		"fromUser": item.FromUser, "urgent": item.Urgent, "preview": digestPreview(item.Prompt),
	}
	if item.ContextTokensAtArrival != nil && item.ContextObservedAtMs != nil {
		doc["contextTokensAtArrival"], doc["contextObservedAtMs"] = item.ContextTokensAtArrival, item.ContextObservedAtMs
	}
	if suffix, ok := strings.CutPrefix(id, "req_"); ok && core.ValidUUID(suffix) {
		doc["inspectCommand"] = "tmt-go result " + id + " --json"
		if item.Source == core.DigestSourceIncoming && item.Reply != nil {
			doc["replyCommand"] = "tmt-go reply " + id + " --receipt " + string(item.Reply.Receipt) + " --message <text>"
		}
	}
	if item.Source == core.DigestSourceResult {
		doc["resultPreview"] = digestPreview(item.Final.Response)
	}
	return doc
}

func digestPreview(text *string) any {
	if text == nil {
		return nil
	}
	return digest.Preview(*text)
}
