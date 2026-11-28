package storage

import (
	"encoding/json/v2"
	"slices"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

type storedUsageBucket struct {
	core.ConsumptionBucket
	sampled           *uint64
	snapshot, credits []byte
}

type usageDetails struct {
	CacheWriteTokens *uint64            `json:"cacheWriteTokens"`
	ByModel          []core.UsageModel  `json:"byModel"`
	ByDriver         []core.UsageDriver `json:"byDriver"`
}

func readUsageBuckets(r records, id core.IdentityID, from, through uint64, rollup bool) ([]storedUsageBucket, error) {
	source := "latest,details,from_ms,NULL,NULL FROM consumption_buckets"
	if rollup {
		source = "limits,details,from_ms,credits,service_tier FROM consumption_tier5m"
	}
	return scanRows(r, `SELECT input_tokens,output_tokens,cached_input_tokens,covered_ms,complete,gap,discontinuous,sampled_at_ms,`+
		source+" WHERE identity_id=? AND from_ms>=? AND from_ms<? ORDER BY from_ms", decodeUsageBucket, id, from, through)
}

func decodeUsageBucket(row scanner) (storedUsageBucket, error) {
	var b storedUsageBucket
	var raw []byte
	if err := row.Scan(&b.InputTokens, &b.OutputTokens, &b.CachedInputTokens, &b.CoveredMs, &b.Complete, &b.Gap, &b.Discontinuous,
		&b.sampled, &b.snapshot, &raw, &b.FromMs, &b.credits, &b.ServiceTier); err != nil {
		return b, err
	}
	var details usageDetails
	if raw != nil {
		if err := decodeUsageJSON(raw, &details); err != nil {
			return b, err
		}
	}
	b.CacheWriteTokens, b.ByModel, b.ByDriver = details.CacheWriteTokens, details.ByModel, details.ByDriver
	if !core.ValidJSSafeInteger(b.FromMs) || !core.ValidJSSafeInteger(b.CoveredMs) ||
		b.sampled != nil && !core.ValidJSSafeInteger(*b.sampled) || !validUsageTokens(b.UsageTokens) ||
		!validCacheWrite(b.CacheWriteTokens, b.InputTokens) || !validUsageModels(b.ByModel, b.UsageTokens) ||
		!validUsageDrivers(b.ByDriver, b.UsageTokens) {
		return b, errUsageEvidence
	}
	return b, nil
}

func projectUsageWindow(rows []storedUsageBucket, window, through, width, maxBuckets uint64) (core.ConsumptionWindow, error) {
	from := subtractUsageMs(through, window)
	slotCount := window / width
	bucketWidth := ((slotCount + maxBuckets - 1) / maxBuckets) * width
	view := core.ConsumptionWindow{WindowMs: window, FromMs: from, ToMs: through, BucketMs: bucketWidth,
		Buckets: make([]core.ConsumptionBucket, 0, min(slotCount, maxBuckets))}
	for len(rows) > 0 && rows[0].FromMs < from {
		rows = rows[1:]
	}
	for start := from; start < through; {
		end := min(start+bucketWidth, through)
		bucket := core.ConsumptionBucket{FromMs: start, ToMs: end, Complete: true}
		for len(rows) > 0 && rows[0].FromMs < end {
			if err := mergeUsageBucket(&bucket, rows[0], width == usageRollupWidth); err != nil {
				return view, err
			}
			rows = rows[1:]
		}
		bucket.Gap = bucket.Gap || bucket.CoveredMs < end-start
		bucket.Complete = bucket.Complete && !bucket.Gap && bucket.CoveredMs == end-start
		view.Buckets = append(view.Buckets, bucket)
		start = end
	}
	return view, nil
}

func mergeUsageBucket(bucket *core.ConsumptionBucket, row storedUsageBucket, rollup bool) error {
	// A zero-token prefix contributes coverage, but the first token-bearing
	// row starts the attribution exactly as it does in native storage.
	if bucket.InputTokens == 0 && bucket.OutputTokens == 0 {
		bucket.CacheWriteTokens = row.CacheWriteTokens
		bucket.ByModel = slices.Clone(row.ByModel)
		bucket.ByDriver = slices.Clone(row.ByDriver)
	} else if row.InputTokens != 0 || row.OutputTokens != 0 {
		bucket.CacheWriteTokens = mergeCacheWrite(bucket.CacheWriteTokens, row.CacheWriteTokens)
		bucket.ByModel = mergeUsageModels(bucket.ByModel, row.ByModel)
		bucket.ByDriver = mergeUsageDrivers(bucket.ByDriver, row.ByDriver)
	}
	bucket.UsageTokens = addUsageTokens(bucket.UsageTokens, row.UsageTokens)
	if !validUsageTokens(bucket.UsageTokens) {
		return errUsageEvidence
	}
	bucket.CoveredMs += row.CoveredMs
	bucket.Complete = bucket.Complete && row.Complete
	bucket.Gap = bucket.Gap || row.Gap
	bucket.Discontinuous = bucket.Discontinuous || row.Discontinuous
	if rollup {
		return mergeUsageAccount(bucket, row)
	}
	return nil
}

func mergeUsageAccount(bucket *core.ConsumptionBucket, row storedUsageBucket) error {
	if row.snapshot != nil {
		var limits core.UsageRateLimits
		if err := decodeUsageJSON(row.snapshot, &limits); err != nil {
			return err
		}
		if !validUsageLimits(&limits) {
			return errUsageEvidence
		}
		if bucket.RateLimits == nil || limits.ObservedAtMs >= bucket.RateLimits.ObservedAtMs {
			bucket.RateLimits = &limits
		}
	}
	if row.credits != nil {
		var credits core.UsageCredits
		if err := decodeUsageJSON(row.credits, &credits); err != nil {
			return err
		}
		if !validUsageCredits(&credits) {
			return errUsageEvidence
		}
		if bucket.Credits == nil || credits.ObservedAtMs >= bucket.Credits.ObservedAtMs {
			bucket.Credits = &credits
		}
	}
	if row.ServiceTier != nil {
		if !validUsageTier(*row.ServiceTier) {
			return errUsageEvidence
		}
		bucket.ServiceTier = row.ServiceTier
	}
	return nil
}

func addUsageTokens(a, b core.UsageTokens) core.UsageTokens {
	return core.UsageTokens{InputTokens: a.InputTokens + b.InputTokens, OutputTokens: a.OutputTokens + b.OutputTokens,
		CachedInputTokens: a.CachedInputTokens + b.CachedInputTokens}
}

func mergeCacheWrite(a, b *uint64) *uint64 {
	if a == nil || b == nil {
		return nil
	}
	sum := *a + *b
	return &sum
}

func mergeUsageModels(rows, incoming []core.UsageModel) []core.UsageModel {
	for _, item := range incoming {
		index := slices.IndexFunc(rows, func(row core.UsageModel) bool { return row.ModelID == item.ModelID })
		switch {
		case index >= 0:
			old := &rows[index]
			old.UsageTokens = addUsageTokens(old.UsageTokens, item.UsageTokens)
			old.CacheWriteTokens = mergeCacheWrite(old.CacheWriteTokens, item.CacheWriteTokens)
		case len(rows) < 4:
			rows = append(rows, item)
		default:
			return nil
		}
	}
	return rows
}

func mergeUsageDrivers(rows, incoming []core.UsageDriver) []core.UsageDriver {
	for _, item := range incoming {
		index, found := slices.BinarySearchFunc(rows, item, func(a, b core.UsageDriver) int { return strings.Compare(string(a.Driver), string(b.Driver)) })
		switch {
		case found:
			rows[index].UsageTokens = addUsageTokens(rows[index].UsageTokens, item.UsageTokens)
		case len(rows) < 4:
			rows = slices.Insert(rows, index, item)
		default:
			return nil
		}
	}
	return rows
}

// Persisted limits written before the provider field were all from Codex.
var usageUnmarshalers = json.UnmarshalFunc(func(data []byte, value *core.UsageRateLimits) error {
	type limitsDocument core.UsageRateLimits
	parsed := limitsDocument{Provider: "codex"}
	if err := json.Unmarshal(data, &parsed, json.RejectUnknownMembers(true)); err != nil {
		return err
	}
	*value = core.UsageRateLimits(parsed)
	return nil
})

func decodeUsageJSON(data []byte, target any) error {
	if err := json.Unmarshal(data, target, json.WithUnmarshalers(usageUnmarshalers), json.RejectUnknownMembers(true)); err != nil {
		return errUsageEvidence
	}
	return nil
}
