package core

type AttemptID string

type RequestKind string

const (
	RequestKindRequest      RequestKind = "request"
	RequestKindAnnouncement RequestKind = "announcement"
)

type RequestOrigin string

const (
	RequestOriginPerson     RequestOrigin = "person"
	RequestOriginAutomation RequestOrigin = "automation"
	RequestOriginUnknown    RequestOrigin = "unknown"
)

type OriginatorKind string

const (
	OriginatorUnknown  OriginatorKind = "unknown"
	OriginatorExplicit OriginatorKind = "explicit"
	OriginatorVerified OriginatorKind = "verified"
)

type Originator struct {
	Kind       OriginatorKind
	IdentityID *IdentityID
}

type RequestRouteKind string

const (
	RequestRoutePane  RequestRouteKind = "pane"
	RequestRouteInbox RequestRouteKind = "inbox"
)

type RequestEndpoint struct {
	Server  ServerEvidence
	PaneID  string
	PanePID uint64
}

// RequestRoute carries recorded pane evidence or the inbox recipient.
type RequestRoute struct {
	Kind      RequestRouteKind
	Pane      *RequestEndpoint
	Recipient *IdentityID
}

type AttemptStatus string

const (
	AttemptPrepared         AttemptStatus = "prepared"
	AttemptSending          AttemptStatus = "sending"
	AttemptSent             AttemptStatus = "sent"
	AttemptQueued           AttemptStatus = "queued"
	AttemptUncertain        AttemptStatus = "uncertain"
	AttemptDefinitelyFailed AttemptStatus = "definitely_failed"
)

type Settlement uint8

const (
	SettlementSent Settlement = iota + 1
	SettlementUncertain
	SettlementDefinitelyFailed
)

type PrepareRequest struct {
	RequestID     RequestID
	AttemptID     AttemptID
	Kind          RequestKind
	Origin        RequestOrigin
	Route         RequestRoute
	Originator    Originator
	Recipient     *IdentityID
	Message       string
	Wait          bool
	ExpiresAtMs   uint64
	RetentionDays uint64
}

type PreparedRequest struct {
	RequestID RequestID
	AttemptID AttemptID
	Receipt   Receipt
}

type RequestAttempt struct {
	RequestID             RequestID
	AttemptID             AttemptID
	Kind                  RequestKind
	Origin                RequestOrigin
	Route                 RequestRoute
	Originator            Originator
	Recipient             *IdentityID
	WaitActive            bool
	Status                AttemptStatus
	CadenceReserved       bool
	PreparedAtMs          uint64
	SendingAtMs           *uint64
	SettledAtMs           *uint64
	WaitReleasedAtMs      *uint64
	ResponseSubmittedAtMs *uint64
	Withdrawal            *Withdrawal
	ExpiresAtMs           uint64
	RetentionDays         uint64
	RetentionExpiresAtMs  uint64
}

type SubmitResponse struct {
	RequestID RequestID
	Receipt   Receipt
	Body      string
}

type AnswerRequest struct {
	Recipient  IdentityID
	Originator *IdentityID
	RequestID  *RequestID
	Body       string
}

type AnswerResult struct {
	Final      FinalResponse
	Originator Originator
}

type FinalResponse struct {
	RequestID           RequestID
	AttemptID           AttemptID
	Route               RequestRoute
	Body                string
	BodyBytes           uint64
	SubmittedAtMs       uint64
	ResponseExpiresAtMs uint64
}

type ResponseLookupStatus string

const (
	ResponseAvailable   ResponseLookupStatus = "available"
	ResponseWithdrawn   ResponseLookupStatus = "withdrawn"
	ResponseUnavailable ResponseLookupStatus = "unavailable"
	ResponseNotRequired ResponseLookupStatus = "not_required"
)

type ResponseLookup struct {
	Status     ResponseLookupStatus
	Final      *FinalResponse
	Withdrawal *Withdrawal
}

type Withdrawal struct {
	Reason        string
	WithdrawnAtMs uint64
}

type WithdrawResult struct {
	RequestID  RequestID
	Withdrawal Withdrawal
	Changed    bool
}
