package core

type DigestChecklistID string
type DigestAttemptToken string

type DigestIdentityQuery struct {
	IdentityIDs []IdentityID
	NowMs       uint64
}
type DigestPolicy struct {
	IdentityID, OwnerID, SetterID IdentityID
	Revision, UntilMs             uint64
	MaxHoldMs                     *uint64
}
type DigestPolicyWrite struct {
	IdentityID, OwnerID, SetterID    IdentityID
	ExpectedRevision, UntilMs, NowMs uint64
	MaxHoldMs                        *uint64
}
type DigestPolicyView struct {
	IdentityID              IdentityID
	Policy                  *DigestPolicy
	ActiveChecklist         *DigestChecklist
	HeldCount, ObservedAtMs uint64
}
type DigestStats struct {
	IdentityID                                          IdentityID
	HeldCount, DeliveredDigests, DueCount, ObservedAtMs uint64
	OldestHeldAgeMs, NextEligibleAtMs                   *uint64
}
type DigestDueQuery struct {
	IdentityID IdentityID
	NowMs      uint64
}
type DigestDue struct{ HeldCount, ThroughSequence uint64 }
type DigestChecklistQuery struct {
	IdentityID          IdentityID
	ChecklistID         *DigestChecklistID
	After, Limit, NowMs uint64
}
type DigestClaimableQuery struct {
	IdentityID   IdentityID
	Opportunity  DigestOpportunity
	Limit, NowMs uint64
}
type DigestChecklistPage struct {
	ActiveChecklist   *DigestChecklist
	SelectedChecklist *DigestChecklist
	Total             uint64
	Items             []DigestItem
}
type DigestItem struct {
	DigestItemEvidence
	RequestID         RequestID
	Kind              DigestKind
	Source            DigestSource
	Originator        Originator
	SenderID          *IdentityID
	SenderName        *Name
	FromUser, Urgent  bool
	Prompt            *string
	PromptExpiresAtMs *uint64
	Final             XFinal
	Reply             *DigestReplyProof
	ThreadRoot        *RequestThreadRoot
}
type DigestReplyProof struct {
	Route   RequestRoute
	Receipt Receipt
}
type DigestItemEvidence struct {
	Sequence, CreatedAtMs                       uint64
	ContextTokensAtArrival, ContextObservedAtMs *uint64
	PhaseAtArrival                              *DigestPhase
}
type DigestHistoryPage struct {
	ObservedAtMs, ThroughSequence, LegacySettledCount, DeliveredDigests uint64
	RetainedFromSequence, NextAfter                                     *uint64
	Checklists                                                          []DigestHistoryRecord
}
type DigestHistoryRecord struct {
	ChecklistID                                    DigestChecklistID
	SettlementSequence, ClaimedAtMs, RetainedCount uint64
	SettledAtMs, SealedCount, NextItemAfter        *uint64
	Opportunity                                    *DigestOpportunity
	Outcome                                        DigestState
	Summary                                        *DigestSummaryCounts
	Items                                          []DigestItemEvidence
}
type DigestChecklist struct {
	ID                           DigestChecklistID
	AttemptToken                 DigestAttemptToken
	IdentityID                   IdentityID
	ThroughSequence, CreatedAtMs uint64
	State                        DigestState
	Projection                   DigestProjection
	Summary                      *DigestSummaryCounts
}
type DigestSummaryCounts struct{ IncomingCount, UrgentCount uint64 }
type DigestClaim struct {
	IdentityID   IdentityID
	ChecklistID  DigestChecklistID
	AttemptToken DigestAttemptToken
	Opportunity  DigestOpportunity
	Kind         DigestProjection
	ThroughLimit *uint64
	Launch       *DigestLaunchFence
	NowMs        uint64
}
type DigestLaunchFence struct {
	Expected        Binding
	Driver          DriverName
	ProviderSession string
}
type DigestSettlement struct {
	IdentityID     IdentityID
	ChecklistID    DigestChecklistID
	AttemptToken   DigestAttemptToken
	Outcome        DigestState
	MessageStarted bool
	NowMs          uint64
}
type DigestReceivingWrite struct {
	ExpectedRevision uint64
	Enabled          bool
	Default          OrchReceiving
	Members          []DigestReceivingMember
}
type DigestReceivingMember struct {
	IdentityID IdentityID    `json:"identityId"`
	Receiving  OrchReceiving `json:"receiving"`
}

type DigestKind string

const (
	DigestKindDecision DigestKind = "decision"
	DigestKindReview   DigestKind = "review"
	DigestKindFyi      DigestKind = "fyi"
	DigestKindResult   DigestKind = "result"
)

func (v DigestKind) Valid() bool {
	switch v {
	case DigestKindDecision, DigestKindReview, DigestKindFyi, DigestKindResult:
		return true
	default:
		return false
	}
}

type DigestSource string

const (
	DigestSourceIncoming DigestSource = "incoming"
	DigestSourceResult   DigestSource = "result"
	DigestSourceTimeout  DigestSource = "timeout"
)

func (v DigestSource) Valid() bool {
	switch v {
	case DigestSourceIncoming, DigestSourceResult, DigestSourceTimeout:
		return true
	default:
		return false
	}
}

type DigestPhase string

const (
	DigestPhaseWorking DigestPhase = "working"
	DigestPhaseWaiting DigestPhase = "waiting"
	DigestPhaseIdle    DigestPhase = "idle"
)

func (v DigestPhase) Valid() bool {
	switch v {
	case DigestPhaseWorking, DigestPhaseWaiting, DigestPhaseIdle:
		return true
	default:
		return false
	}
}

type DigestOpportunity string

const (
	DigestOpportunityIdle         DigestOpportunity = "idle"
	DigestOpportunityTurnBoundary DigestOpportunity = "turn_boundary"
)

func (v DigestOpportunity) Valid() bool {
	switch v {
	case DigestOpportunityIdle, DigestOpportunityTurnBoundary:
		return true
	default:
		return false
	}
}

type DigestProjection string

const (
	DigestProjectionFull            DigestProjection = "full"
	DigestProjectionIncomingSummary DigestProjection = "incoming_summary"
)

func (v DigestProjection) Valid() bool {
	switch v {
	case DigestProjectionFull, DigestProjectionIncomingSummary:
		return true
	default:
		return false
	}
}

type DigestState string

const (
	DigestStateClaimed          DigestState = "claimed"
	DigestStateDelivered        DigestState = "delivered"
	DigestStateDefinitelyUnsent DigestState = "definitely_unsent"
	DigestStateUncertain        DigestState = "uncertain"
)

func (v DigestState) Valid() bool {
	switch v {
	case DigestStateClaimed, DigestStateDelivered, DigestStateDefinitelyUnsent, DigestStateUncertain:
		return true
	default:
		return false
	}
}

type DigestWakeClock struct {
	NextAdmissionMs     uint64
	ScanAfterIdentityID *IdentityID
}

type DigestWakeCandidates struct {
	IdentityIDs []IdentityID
	Clock       DigestWakeClock
}
