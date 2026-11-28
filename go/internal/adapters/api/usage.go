package api

import (
	"context"
	"encoding/json/jsontext"
	json "encoding/json/v2"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const (
	fineBucketMs       = 5_000
	rollupBucketMs     = 300_000
	fineMaxWindowMs    = 3_600_000
	maxResponseBuckets = 23_040
)

var usageOperations = []string{"consumption.history", "consumption.retired", "digest.wakeTurns"}

type usageAction func(context.Context, ports.UsageStore) (any, error)

func decodeUsage(operation string, input jsontext.Value, now uint64) usageAction {
	switch operation {
	case "consumption.history":
		query, ok := decodeConsumptionHistory(input, now)
		if !ok {
			return nil
		}
		return func(ctx context.Context, store ports.UsageStore) (any, error) {
			page, err := store.ConsumptionHistory(ctx, query)
			return consumptionDocument(page), err
		}
	case "consumption.retired":
		var wire struct {
			FromMs *uint64 `json:"fromMs"`
		}
		if !decodeObject(input, &wire) || wire.FromMs == nil || !core.ValidJSSafeInteger(*wire.FromMs) || *wire.FromMs > now {
			return nil
		}
		return func(ctx context.Context, store ports.UsageStore) (any, error) {
			page, err := store.RetiredWithRollup(ctx, core.RetiredRollupQuery{FromMs: *wire.FromMs, NowMs: now, Limit: 256})
			return map[string]any{"fromMs": *wire.FromMs, "identityIds": page.IdentityIDs, "truncated": page.More}, err
		}
	case "digest.wakeTurns":
		wire := struct {
			IdentityIDs jsontext.Value `json:"identityIds"`
			FromMs      *uint64        `json:"fromMs"`
			ThroughMs   *uint64        `json:"throughMs"`
			Limit       uint64         `json:"limit"`
		}{Limit: 1000}
		if !decodeObject(input, &wire) ||
			wire.FromMs == nil || wire.ThroughMs == nil || *wire.FromMs > *wire.ThroughMs ||
			!core.ValidJSSafeInteger(*wire.ThroughMs) || wire.Limit < 1 || wire.Limit > 1000 {
			return nil
		}
		var identities []core.IdentityID
		if wire.IdentityIDs != nil && (wire.IdentityIDs.Kind() != '[' ||
			json.Unmarshal(wire.IdentityIDs, &identities) != nil || !validIdentities(identities, 0, 256)) {
			return nil
		}
		query := core.WakeTurnQuery{IdentityIDs: identities, FromMs: *wire.FromMs, ThroughMs: *wire.ThroughMs, Limit: wire.Limit}
		return func(ctx context.Context, store ports.UsageStore) (any, error) {
			page, err := store.WakeTurns(ctx, query)
			return wakeTurnsDocument(page), err
		}
	default:
		return nil
	}
}

func decodeConsumptionHistory(input jsontext.Value, now uint64) (core.ConsumptionHistoryQuery, bool) {
	wire := struct {
		IdentityIDs    []core.IdentityID `json:"identityIds"`
		WindowsMs      []uint64          `json:"windowsMs"`
		MaxBuckets     uint64            `json:"maxBuckets"`
		IncludeRetired jsontext.Value    `json:"includeRetired"`
		ThroughMs      jsontext.Value    `json:"throughMs"`
	}{MaxBuckets: 120}
	if !decodeObject(input, &wire) || !validIdentities(wire.IdentityIDs, 1, 32) || !distinct(wire.IdentityIDs) ||
		len(wire.WindowsMs) < 1 || len(wire.WindowsMs) > 3 || !distinct(wire.WindowsMs) ||
		wire.MaxBuckets < 1 || wire.MaxBuckets > 720 {
		return core.ConsumptionHistoryQuery{}, false
	}

	query := core.ConsumptionHistoryQuery{IdentityIDs: wire.IdentityIDs, WindowsMs: wire.WindowsMs, MaxBuckets: wire.MaxBuckets, NowMs: now}
	if wire.IncludeRetired != nil {
		if wire.IncludeRetired.Kind() == 'n' || json.Unmarshal(wire.IncludeRetired, &query.IncludeRetired) != nil {
			return core.ConsumptionHistoryQuery{}, false
		}
	}
	if wire.ThroughMs != nil {
		var cut uint64
		if wire.ThroughMs.Kind() != '0' || json.Unmarshal(wire.ThroughMs, &cut) != nil ||
			cut%fineBucketMs != 0 || cut > now || now-cut > 60_000 {
			return core.ConsumptionHistoryQuery{}, false
		}
		query.ThroughMs = &cut
	}

	var buckets uint64
	for _, window := range wire.WindowsMs {
		resolution := uint64(fineBucketMs)
		if window > fineMaxWindowMs {
			resolution = rollupBucketMs
		}
		if window == 0 || window > 32*core.RetentionDayMs || window%resolution != 0 {
			return core.ConsumptionHistoryQuery{}, false
		}
		buckets += min(window/resolution, wire.MaxBuckets)
	}
	return query, buckets*uint64(len(wire.IdentityIDs)) <= maxResponseBuckets
}

func distinct[T comparable](items []T) bool {
	seen := make(map[T]struct{}, len(items))
	for _, item := range items {
		if _, exists := seen[item]; exists {
			return false
		}
		seen[item] = struct{}{}
	}
	return true
}

func consumptionDocument(page core.ConsumptionHistoryPage) any {
	identities := make([]any, 0, len(page.Identities))
	for _, identity := range page.Identities {
		row := map[string]any{"id": identity.ID, "found": identity.Found}
		if identity.Found {
			row["reporting"] = identity.Reporting
			row["availableFromMs"], row["lastSampleAtMs"] = identity.AvailableFromMs, identity.LastSampleAtMs
			row["latest"] = identity.Latest
			if !identity.Reporting && identity.Cause != nil {
				row["cause"] = identity.Cause
			}
			if identity.Retired {
				row["retired"] = true
			}
			windows := make([]any, 0, len(identity.Windows))
			for _, window := range identity.Windows {
				windows = append(windows, consumptionWindow(window))
			}
			row["windows"] = windows
		}
		identities = append(identities, row)
	}
	return map[string]any{
		"asOfMs": page.AsOfMs, "throughMs": page.ThroughMs, "resolutionMs": page.ResolutionMs,
		"retainedFromMs": page.RetainedFromMs, "identities": identities,
	}
}

func consumptionWindow(window core.ConsumptionWindow) any {
	buckets := make([]any, 0, len(window.Buckets))
	for _, bucket := range window.Buckets {
		row := map[string]any{
			"fromMs": bucket.FromMs, "toMs": bucket.ToMs, "coveredMs": bucket.CoveredMs,
			"inputTokens": bucket.InputTokens, "outputTokens": bucket.OutputTokens, "cachedInputTokens": bucket.CachedInputTokens,
			"complete": bucket.Complete, "gap": bucket.Gap, "discontinuous": bucket.Discontinuous,
		}
		if bucket.CacheWriteTokens != nil {
			row["cacheWriteTokens"] = bucket.CacheWriteTokens
		}
		if bucket.ByModel != nil {
			row["byModel"] = bucket.ByModel
		}
		if bucket.ByDriver != nil {
			row["byDriver"] = bucket.ByDriver
		}
		if bucket.RateLimits != nil {
			row["rateLimits"] = bucket.RateLimits
		}
		if bucket.Credits != nil {
			row["credits"] = bucket.Credits
		}
		if bucket.ServiceTier != nil {
			row["serviceTier"] = bucket.ServiceTier
		}
		buckets = append(buckets, row)
	}
	document := map[string]any{
		"windowMs": window.WindowMs, "fromMs": window.FromMs, "toMs": window.ToMs, "bucketMs": window.BucketMs, "buckets": buckets,
	}
	if window.ResolutionMs != nil {
		document["resolutionMs"], document["availableFromMs"], document["retainedFromMs"] = window.ResolutionMs, window.AvailableFromMs, window.RetainedFromMs
	}
	return document
}

func wakeTurnsDocument(page core.WakeTurnPage) any {
	turns := make([]any, 0, len(page.Turns))
	for _, turn := range page.Turns {
		var models any
		if turn.ByModel != nil {
			models = turn.ByModel
		}
		turns = append(turns, map[string]any{
			"identityId": turn.IdentityID, "startedAtMs": turn.StartedAtMs, "endedAtMs": turn.EndedAtMs,
			"requestIds": turn.RequestIDs, "measured": turn.Measured, "tokens": turn.Tokens, "byModel": models,
		})
	}
	return map[string]any{"fromMs": page.FromMs, "throughMs": page.ThroughMs, "turns": turns, "more": page.More}
}
