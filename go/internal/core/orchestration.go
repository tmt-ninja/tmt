package core

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
