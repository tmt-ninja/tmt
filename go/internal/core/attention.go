package core

// DeliveryView is the display state derived by the service from stored facts.
type DeliveryView struct {
	State       string
	Reason      string
	ReasonText  string
	LatestMs    *uint64
	RemainingMs *uint64
	CanSendNow  bool
}

type InboxQuery struct {
	Recipient  IdentityID
	Originator *IdentityID
	Limit      uint64 // zero selects the default
}

type InboxItem struct {
	RequestID    RequestID
	Originator   Originator
	PreparedAtMs uint64
	Delivery     AttemptStatus
	MessageState DeliveryView
	Preview      *string
}

type InboxPage struct {
	Items []InboxItem
	More  bool
}

type XDirection uint8

const (
	XOutgoing XDirection = iota
	XIncoming
)

type XQuery struct {
	RoomID    *RoomID // nonnil scopes incoming attention to that room
	Identity  IdentityID
	Direction XDirection
	After     uint64
	Limit     uint64 // zero selects the default
}

type XKind string

const (
	XRequest      XKind = "request"
	XAnnouncement XKind = "announcement"
	XResponse     XKind = "response"
)

type FinalStatus string

const (
	FinalWithdrawn    FinalStatus = "withdrawn"
	FinalNotRequired  FinalStatus = "not_required"
	FinalNotSubmitted FinalStatus = "not_submitted"
	FinalRetained     FinalStatus = "retained"
	FinalExpired      FinalStatus = "expired"
	FinalUnavailable  FinalStatus = "unavailable"
)

// XFinal carries the fields available for its final state. Only a detailed
// result can include the exact response.
type XFinal struct {
	Status        FinalStatus
	Withdrawal    *Withdrawal
	SubmittedAtMs *uint64
	ExpiresAtMs   *uint64
	BodyBytes     *uint64
	Response      *string
}

type XItem struct {
	RoomID               *RoomID
	Urgent               bool
	DigestKind           string
	Mode                 string
	RequestID            RequestID
	Kind                 XKind
	Sender               *IdentityID
	Recipient            *IdentityID
	PreparedAtMs         uint64
	Delivery             AttemptStatus
	MessageState         DeliveryView
	Final                XFinal
	Revision             uint64
	Acknowledged         bool
	Settled              bool
	RetentionExpiresAtMs uint64
}

type XPage struct {
	Items     []XItem
	NextAfter *uint64
}

type XDetail struct {
	Exchange          XItem
	Prompt            *string
	PromptExpiresAtMs *uint64
	Receipt           *Receipt
}

type AckResult struct {
	RequestID RequestID
	Revision  uint64
	Changed   bool
}
