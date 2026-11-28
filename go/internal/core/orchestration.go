package core

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

type OrchSnapshotQuery struct {
	MemberQuery *string
}

type OrchSnapshotPage struct {
	Policy OrchPolicySnapshot
	// IdentityIDs keeps the selection order for projections over Policy.Identities.
	IdentityIDs []IdentityID
}

type OrchJobQuery struct {
	RoomID      *string
	OwnerID     *IdentityID
	JobID       *string
	AfterNumber uint64
	Limit       uint16
	NowMs       uint64
	FullMessage bool
}

type OrchJobReadPage struct {
	Items       []OrchJob
	NextAfter   *uint64
	Policy      OrchPolicySnapshot
	RecentRuns  map[string][]OrchJobRun
	FullMessage *string
}

type OrchJob struct {
	ID             string
	Number         uint64
	Revision       uint64
	OwnerID        *IdentityID
	OwnerName      *Name
	RoomID         *string
	Title          *string
	MessagePreview string
	Schedule       OrchJobSchedule
	Pause          *OrchJobPause
	Pending        *OrchJobPending
	Legacy         *OrchJobLegacy
	OwnerRetired   bool
	OwnerAvailable bool
}

type OrchJobScheduleKind string

const (
	OrchJobEvery OrchJobScheduleKind = "every"
	OrchJobAt    OrchJobScheduleKind = "at"
	OrchJobCron  OrchJobScheduleKind = "cron"
)

type OrchJobSchedule struct {
	Kind       OrchJobScheduleKind `json:"kind"`
	Zone       string              `json:"zone"`
	Seconds    int64               `json:"seconds,omitempty"`
	AnchorMs   int64               `json:"anchorMs,omitempty"`
	From       *string             `json:"from,omitempty"`
	At         string              `json:"at,omitempty"`
	On         *string             `json:"on,omitempty"`
	Expression string              `json:"expression,omitempty"`
}

type OrchJobPause struct {
	By   string
	AtMs int64
}

type OrchJobPending struct {
	Revision uint64
	SlotMs   int64
}

type OrchJobLegacy struct {
	RoomID string
	CronID uint64
}

type OrchJobRun struct {
	ID         uint64
	Revision   uint64
	SlotMs     int64
	RecordedMs uint64
	Receipt    OrchDispatchReceipt
	Request    *OrchJobRequest
}

type OrchDispatchReceipt struct {
	OperationID string             `json:"operationId"`
	CreatedAtMs uint64             `json:"createdAtMs"`
	Items       []OrchDispatchItem `json:"items"`
}

type OrchDispatchItem struct {
	RecipientID IdentityID             `json:"recipientId"`
	RequestID   RequestID              `json:"requestId"`
	Acceptance  OrchDispatchAcceptance `json:"acceptance"`
}

type OrchDispatchAcceptance string

const (
	OrchDispatchQueued      OrchDispatchAcceptance = "queued"
	OrchDispatchUnavailable OrchDispatchAcceptance = "recipientUnavailable"
	OrchDispatchRestricted  OrchDispatchAcceptance = "routeRestricted"
	OrchDispatchHeld        OrchDispatchAcceptance = "heldForPerson"
)

type OrchJobRequest struct {
	Attempt      RequestAttempt
	Final        XFinal
	DeliveryView DeliveryView
	Urgent       bool
	DigestKind   string
	Mode         string
}

type OrchPolicySnapshot struct {
	Revision       uint64
	TimeZone       *string
	Identities     map[IdentityID]Name
	Plans          []OrchPlan
	Focus          []OrchFocus
	DigestEnabled  bool
	DigestRevision uint64
	BaseReceiving  map[IdentityID]OrchReceiving
	Leads          []IdentityID
	RouteGrants    []OrchRouteGrant
}

type OrchPlan struct {
	ID       string
	Name     string
	Revision uint64
	Priority int32
	Enabled  bool
	Schedule OrchPlanSchedule
	Fields   OrchPolicyFields
	Targets  []OrchTarget
	Members  map[IdentityID]OrchPolicyFields
}

type OrchPlanSchedule struct {
	Kind          string `json:"kind"`
	StartMs       uint64 `json:"startMs,omitempty"`
	EndMs         uint64 `json:"endMs,omitempty"`
	Start         string `json:"start,omitempty"`
	End           string `json:"end,omitempty"`
	AllDay        bool   `json:"allDay,omitempty"`
	AnchorDate    string `json:"anchorDate,omitempty"`
	IntervalWeeks uint8  `json:"intervalWeeks,omitempty"`
	Weekdays      []int  `json:"weekdays,omitempty"`
}

type OrchTarget struct {
	Kind    string     `json:"kind"`
	ID      IdentityID `json:"id,omitempty"`
	Pattern string     `json:"pattern,omitempty"`
}

type OrchPolicyFields struct {
	State            *OrchState
	Receiving        *OrchReceiving
	Sending          *OrchSending
	Routine          *OrchRoutine
	TalkLimitPresent bool
	TalkLimit        *uint32
}

type OrchState string
type OrchSending string
type OrchRoutine string
type OrchReceivingMode string

const (
	OrchRoutineRun      OrchRoutine       = "run"
	OrchRoutineHold     OrchRoutine       = "hold"
	OrchReceivingDirect OrchReceivingMode = "direct"
	OrchReceivingAuto   OrchReceivingMode = "auto"
	OrchReceivingUrgent OrchReceivingMode = "urgent"
	OrchReceivingHold   OrchReceivingMode = "hold"
	OrchReceivingBatch  OrchReceivingMode = "batch"
)

type OrchReceiving struct {
	Mode       OrchReceivingMode `json:"mode"`
	IntervalMs uint64            `json:"intervalMs,omitempty"`
}

type OrchFocus struct {
	IdentityID IdentityID
	Revision   uint64
	StartMs    uint64
	EndMs      uint64
}

type OrchRouteGrant struct {
	FromID    IdentityID
	ToID      IdentityID
	UntilMs   uint64
	GrantedBy *IdentityID
}

type OrchJournalQuery struct {
	Subject OrchJournalSubject
	Before  *uint64
	Limit   uint16
	NowMs   uint64
}

type OrchJournalSubject struct {
	Kind OrchSubjectKind
	ID   string
}

func (s OrchJournalSubject) Valid() bool {
	switch s.Kind {
	case OrchSubjectRequest:
		id, ok := strings.CutPrefix(s.ID, "req_")
		return ok && validOrchJournalUUID(id)
	case OrchSubjectIdentity:
		return validOrchJournalUUID(s.ID)
	case OrchSubjectJob:
		return s.ID != "" && len(s.ID) <= 128 && utf8.ValidString(s.ID) && !strings.ContainsFunc(s.ID, unicode.IsControl)
	default:
		return false
	}
}

func validOrchJournalUUID(id string) bool {
	return ValidUUID(id) && id != "00000000-0000-0000-0000-000000000000"
}

type OrchJournalPage struct {
	Items           []OrchJournalEntry
	NextBefore      *uint64
	RetainedAfterMs uint64
}
type OrchJournalEntry struct {
	ID, RecordedAtMs      uint64
	Subject               OrchJournalSubject
	ActorID, RecipientID  *IdentityID
	Action                OrchDecisionAction
	Outcome               OrchDecisionOutcome
	Reason                string
	ConfigurationRevision uint64
	TimeZone              string
	Sources               []OrchDecisionSource
}
type OrchDecisionSource struct {
	Field  OrchPolicyField `json:"field"`
	Source OrchSource      `json:"source"`
}
type OrchSource struct {
	Kind       OrchSourceKind `json:"kind"`
	PlanID     *string        `json:"planId"`
	IdentityID *IdentityID    `json:"identityId"`
	Revision   uint64         `json:"revision"`
	Slot       *OrchTimeSlot  `json:"slot"`
	Defaulted  bool           `json:"defaulted"`
}
type OrchTimeSlot struct {
	StartMs uint64 `json:"startMs"`
	EndMs   uint64 `json:"endMs"`
}

func (s OrchSource) Valid() bool {
	if !ValidJSSafeInteger(s.Revision) || s.PlanID != nil && !validOrchJournalUUID(*s.PlanID) ||
		s.IdentityID != nil && !validOrchJournalUUID(string(*s.IdentityID)) ||
		s.Slot != nil && (s.Slot.StartMs == 0 || s.Slot.StartMs >= s.Slot.EndMs || !ValidJSSafeInteger(s.Slot.EndMs)) {
		return false
	}
	switch s.Kind {
	case OrchSourceBase:
		return s.PlanID == nil && s.Slot == nil && !s.Defaulted && (s.Revision > 0 || s.IdentityID == nil)
	case OrchSourcePlan:
		return s.PlanID != nil && s.IdentityID == nil && s.Revision > 0
	case OrchSourceMember:
		return s.PlanID != nil && s.IdentityID != nil && s.Revision > 0
	case OrchSourceFocus:
		return s.PlanID == nil && s.IdentityID != nil && s.Revision > 0
	default:
		return false
	}
}

type OrchSubjectKind string

const (
	OrchSubjectRequest  OrchSubjectKind = "request"
	OrchSubjectIdentity OrchSubjectKind = "identity"
	OrchSubjectJob      OrchSubjectKind = "job"
)

func (v OrchSubjectKind) Valid() bool {
	switch v {
	case OrchSubjectRequest, OrchSubjectIdentity, OrchSubjectJob:
		return true
	default:
		return false
	}
}

type OrchDecisionAction string

const (
	OrchActionBlock  OrchDecisionAction = "block"
	OrchActionDelay  OrchDecisionAction = "delay"
	OrchActionSend   OrchDecisionAction = "send"
	OrchActionJobRun OrchDecisionAction = "jobRun"
)

func (v OrchDecisionAction) Valid() bool {
	switch v {
	case OrchActionBlock, OrchActionDelay, OrchActionSend, OrchActionJobRun:
		return true
	default:
		return false
	}
}

type OrchDecisionOutcome string

const (
	OrchOutcomeAllowed   OrchDecisionOutcome = "allowed"
	OrchOutcomeHeld      OrchDecisionOutcome = "held"
	OrchOutcomeSent      OrchDecisionOutcome = "sent"
	OrchOutcomeUncertain OrchDecisionOutcome = "uncertain"
	OrchOutcomeFailed    OrchDecisionOutcome = "failed"
	OrchOutcomeCompleted OrchDecisionOutcome = "completed"
)

func (v OrchDecisionOutcome) Valid() bool {
	switch v {
	case OrchOutcomeAllowed, OrchOutcomeHeld, OrchOutcomeSent, OrchOutcomeUncertain, OrchOutcomeFailed, OrchOutcomeCompleted:
		return true
	default:
		return false
	}
}

type OrchPolicyField string

const (
	OrchFieldState     OrchPolicyField = "state"
	OrchFieldReceiving OrchPolicyField = "receiving"
	OrchFieldSending   OrchPolicyField = "sending"
	OrchFieldRoutine   OrchPolicyField = "routine"
	OrchFieldTalkLimit OrchPolicyField = "talkLimit"
)

func (v OrchPolicyField) Valid() bool {
	switch v {
	case OrchFieldState, OrchFieldReceiving, OrchFieldSending, OrchFieldRoutine, OrchFieldTalkLimit:
		return true
	default:
		return false
	}
}

type OrchSourceKind string

const (
	OrchSourceBase   OrchSourceKind = "base"
	OrchSourcePlan   OrchSourceKind = "plan"
	OrchSourceMember OrchSourceKind = "member"
	OrchSourceFocus  OrchSourceKind = "focus"
)

func (v OrchSourceKind) Valid() bool {
	switch v {
	case OrchSourceBase, OrchSourcePlan, OrchSourceMember, OrchSourceFocus:
		return true
	default:
		return false
	}
}
