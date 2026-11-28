package core

type ConsumptionHistoryQuery struct {
	IdentityIDs       []IdentityID
	WindowsMs         []uint64
	MaxBuckets, NowMs uint64
	ThroughMs         *uint64
	IncludeRetired    bool
}

type ConsumptionHistoryPage struct {
	AsOfMs, ThroughMs, ResolutionMs, RetainedFromMs uint64
	Identities                                      []ConsumptionIdentity
}

type ConsumptionIdentity struct {
	ID                              IdentityID
	Found, Reporting, Retired       bool
	Cause                           *ConsumptionCause
	AvailableFromMs, LastSampleAtMs *uint64
	Latest                          *ConsumptionLatest
	Windows                         []ConsumptionWindow
}

type ConsumptionCause string

const (
	ConsumptionNoBinding  ConsumptionCause = "no_binding"
	ConsumptionNoAgent    ConsumptionCause = "no_agent"
	ConsumptionNoSampler  ConsumptionCause = "no_sampler"
	ConsumptionIdle       ConsumptionCause = "idle"
	ConsumptionNotSampled ConsumptionCause = "not_sampled"
)

type ConsumptionLatest struct {
	Driver      DriverName         `json:"driver"`
	Session     string             `json:"session"`
	Consumption ConsumptionReading `json:"consumption"`
}

type ConsumptionReading struct {
	UsageTokens
	CacheWriteTokens *uint64          `json:"cacheWriteTokens,omitempty"`
	ModelID          *string          `json:"modelId,omitempty"`
	DeltaByModel     []UsageModel     `json:"deltaByModel,omitempty"`
	RateLimits       *UsageRateLimits `json:"rateLimits,omitempty"`
	Credits          *UsageCredits    `json:"credits,omitempty"`
	ServiceTier      *string          `json:"serviceTier,omitempty"`
	Epoch            string           `json:"epoch"`
	Sequence         uint64           `json:"sequence"`
	ObservedAtMs     uint64           `json:"observedAtMs"`
	Complete         bool             `json:"complete"`
	Gap              bool             `json:"gap"`
	IncompleteReason *string          `json:"incompleteReason,omitempty"`
}

type ConsumptionWindow struct {
	WindowMs, FromMs, ToMs, BucketMs              uint64
	ResolutionMs, AvailableFromMs, RetainedFromMs *uint64
	Buckets                                       []ConsumptionBucket
}

type ConsumptionBucket struct {
	FromMs, ToMs, CoveredMs uint64
	UsageTokens
	Complete, Gap, Discontinuous bool
	CacheWriteTokens             *uint64
	ByModel                      []UsageModel
	ByDriver                     []UsageDriver
	RateLimits                   *UsageRateLimits
	Credits                      *UsageCredits
	ServiceTier                  *string
}

type UsageTokens struct {
	InputTokens       uint64 `json:"inputTokens"`
	OutputTokens      uint64 `json:"outputTokens"`
	CachedInputTokens uint64 `json:"cachedInputTokens"`
}

type UsageModel struct {
	ModelID string `json:"modelId"`
	UsageTokens
	CacheWriteTokens *uint64 `json:"cacheWriteTokens,omitempty"`
}

type UsageDriver struct {
	Driver DriverName `json:"driver"`
	UsageTokens
}

type UsageRateLimits struct {
	Provider     string            `json:"provider"`
	ObservedAtMs uint64            `json:"observedAtMs"`
	Windows      []UsageRateWindow `json:"windows"`
	Account      *UsageRateAccount `json:"account,omitempty"`
}

type UsageRateWindow struct {
	WindowMinutes uint64  `json:"windowMinutes"`
	UsedPercent   float64 `json:"usedPercent"`
	ResetsAtMs    uint64  `json:"resetsAtMs"`
	ObservedAtMs  *uint64 `json:"observedAtMs,omitempty"`
}

type UsageRateAccount struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

type UsageCredits struct {
	ObservedAtMs uint64 `json:"observedAtMs"`
	Balance      string `json:"balance"`
	HasCredits   bool   `json:"hasCredits"`
	Unlimited    bool   `json:"unlimited"`
}

type RetiredRollupQuery struct{ FromMs, NowMs, Limit uint64 }
type RetiredRollupPage struct {
	IdentityIDs []IdentityID
	More        bool
}
type WakeTurnQuery struct {
	IdentityIDs              []IdentityID
	FromMs, ThroughMs, Limit uint64
}
type WakeTurnPage struct {
	FromMs, ThroughMs uint64
	Turns             []WakeTurn
	More              bool
}
type WakeTurn struct {
	IdentityID             IdentityID
	StartedAtMs, EndedAtMs uint64
	RequestIDs             []RequestID
	Measured               bool
	Tokens                 *UsageTokens
	ByModel                []UsageModel
}
