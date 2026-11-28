package storage

import (
	"math"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

func validUsageTokens(t core.UsageTokens) bool {
	return core.ValidJSSafeInteger(t.InputTokens) && t.OutputTokens <= core.MaxJSSafeInteger-t.InputTokens &&
		t.CachedInputTokens <= t.InputTokens
}

func validCacheWrite(value *uint64, input uint64) bool { return value == nil || *value <= input }

func withinUsageTokens(value, limit core.UsageTokens) bool {
	return value.InputTokens <= limit.InputTokens && value.OutputTokens <= limit.OutputTokens && value.CachedInputTokens <= limit.CachedInputTokens
}

func validUsageModels(rows []core.UsageModel, total core.UsageTokens) bool {
	if len(rows) > 4 {
		return false
	}
	var sum core.UsageTokens
	for i, row := range rows {
		if !validHookModel(row.ModelID) || !validUsageTokens(row.UsageTokens) || !validCacheWrite(row.CacheWriteTokens, row.InputTokens) {
			return false
		}
		for _, other := range rows[:i] {
			if other.ModelID == row.ModelID {
				return false
			}
		}
		sum = addUsageTokens(sum, row.UsageTokens)
	}
	return withinUsageTokens(sum, total)
}

func validUsageDrivers(rows []core.UsageDriver, total core.UsageTokens) bool {
	if len(rows) > 4 || rows != nil && len(rows) == 0 {
		return false
	}
	var sum core.UsageTokens
	for i, row := range rows {
		if !validStoredDriver(string(row.Driver)) || !validUsageTokens(row.UsageTokens) || i > 0 && rows[i-1].Driver >= row.Driver {
			return false
		}
		sum = addUsageTokens(sum, row.UsageTokens)
	}
	return withinUsageTokens(sum, total)
}

func validStoredDriver(name string) bool {
	if len(name) == 0 || len(name) > 64 || name[0] < 'a' || name[0] > 'z' {
		return false
	}
	for _, c := range name {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

func validConsumptionReading(latest *core.ConsumptionLatest) bool {
	r := latest.Consumption
	return validUsageTokens(r.UsageTokens) && validCacheWrite(r.CacheWriteTokens, r.InputTokens) &&
		(r.ModelID == nil || validHookModel(*r.ModelID)) && validUsageModels(r.DeltaByModel, r.UsageTokens) &&
		(r.RateLimits == nil || validUsageLimits(r.RateLimits)) && (r.Credits == nil || validUsageCredits(r.Credits)) &&
		(r.ServiceTier == nil || validUsageTier(*r.ServiceTier)) && core.ValidUUID(strings.ToLower(r.Epoch)) &&
		safeTime(r.Sequence) && safeTime(r.ObservedAtMs) && !(r.Complete && r.Gap) &&
		(r.IncompleteReason == nil || !r.Complete && validIncompleteReason(*r.IncompleteReason))
}

func validIncompleteReason(reason string) bool {
	switch reason {
	case "partial-line", "child-usage-unreadable", "child-unreadable", "child-backlog", "family-budget",
		"family-scan", "family-members", "family", "no-token-source":
		return true
	default:
		return false
	}
}

func validUsageLimits(limits *core.UsageRateLimits) bool {
	if !validStoredDriver(limits.Provider) || !safeTime(limits.ObservedAtMs) || len(limits.Windows) == 0 || len(limits.Windows) > 2 {
		return false
	}
	for i, w := range limits.Windows {
		if !safeTime(w.WindowMinutes) || !safeTime(w.ResetsAtMs) || math.IsNaN(w.UsedPercent) ||
			w.UsedPercent < 0 || w.UsedPercent > 100 ||
			w.ObservedAtMs != nil && (!safeTime(*w.ObservedAtMs) || *w.ObservedAtMs > limits.ObservedAtMs) ||
			i > 0 && limits.Windows[i-1].WindowMinutes >= w.WindowMinutes {
			return false
		}
	}
	a := limits.Account
	if a == nil {
		return true
	}
	return len(a.Key) == 12 && charactersIn(a.Key, "0123456789abcdef") &&
		len(a.Label) > 0 && len(a.Label) <= 32 && charactersIn(a.Label, "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ._-")
}

func validUsageCredits(credits *core.UsageCredits) bool {
	whole, fraction, fractional := strings.Cut(credits.Balance, ".")
	return safeTime(credits.ObservedAtMs) && len(whole) > 0 && len(whole) <= 15 && charactersIn(whole, "0123456789") &&
		(!fractional || len(fraction) > 0 && len(fraction) <= 12 && charactersIn(fraction, "0123456789"))
}

func validUsageTier(tier string) bool {
	return len(tier) > 0 && len(tier) <= 24 && tier[0] != '_' && charactersIn(tier, "abcdefghijklmnopqrstuvwxyz_")
}

func charactersIn(value, allowed string) bool {
	return !strings.ContainsFunc(value, func(c rune) bool { return !strings.ContainsRune(allowed, c) })
}
