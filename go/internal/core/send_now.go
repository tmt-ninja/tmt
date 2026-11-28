package core

// RequestRef is an exact ID or a user-supplied prefix to resolve uniquely.
type RequestRef string

type SendNowAlready string

const (
	SendNowAlreadyDelivered SendNowAlready = "delivered"
	SendNowAlreadyWorking   SendNowAlready = "working"
)

type WakeState string

const (
	WakeNotAttempted WakeState = "not_attempted"
	WakeClaimed      WakeState = "claimed"
	WakeSent         WakeState = "sent"
	WakeUnavailable  WakeState = "unavailable"
	WakeUncertain    WakeState = "uncertain"
)

func (s WakeState) Valid() bool {
	return s == WakeNotAttempted || s == WakeClaimed || s == WakeSent || s == WakeUnavailable || s == WakeUncertain
}

func (s WakeState) IsSettlement() bool {
	return s == WakeSent || s == WakeUnavailable || s == WakeUncertain
}

// WakeClaimGeneration is issued by the service that owns the committed claim.
type WakeClaimGeneration [16]byte

type SendNowRelease struct {
	RequestID   RequestID
	RecipientID IdentityID
	Already     *SendNowAlready
}

type ReleasedWakeQuery struct {
	RequestID         RequestID
	RecipientID       IdentityID
	ReceiptDeadlineMs *uint64
}

type ReleasedWakeClaim struct {
	Claimed       bool
	State         WakeState
	DigestUntilMs *uint64
	Generation    *WakeClaimGeneration
}

type ReleasedWakeProof struct {
	RequestID   RequestID
	RecipientID IdentityID
	Generation  WakeClaimGeneration
}

type RequestThreadRoot struct {
	RequestID RequestID
	Text      *string
}

type ReleasedWakePayload struct {
	Attempt    RequestAttempt
	Message    string
	SenderName string
	ThreadRoot *RequestThreadRoot
}

type ReleasedWakeSettlement struct {
	Proof   ReleasedWakeProof
	Outcome WakeState
}
