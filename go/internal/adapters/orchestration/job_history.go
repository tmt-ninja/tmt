package orchestration

import "github.com/tmt-ninja/tmt/go/internal/core"

type jobRecentRun struct {
	ID           uint64                      `json:"id"`
	SlotMs       int64                       `json:"slotMs"`
	RecordedAtMs uint64                      `json:"recordedAtMs"`
	Acceptance   core.OrchDispatchAcceptance `json:"acceptance"`
}

type jobLastRun struct {
	ID              uint64                      `json:"id"`
	Revision        uint64                      `json:"revision"`
	SlotMs          int64                       `json:"slotMs"`
	RecordedAtMs    uint64                      `json:"recordedAtMs"`
	OperationID     string                      `json:"operationId"`
	RequestID       core.RequestID              `json:"requestId"`
	Acceptance      core.OrchDispatchAcceptance `json:"acceptance"`
	Request         *jobRequest                 `json:"request"`
	ResultReference *jobResultReference         `json:"resultReference"`
}

type jobResultReference struct {
	RequestID core.RequestID `json:"requestId"`
}

type jobRequest struct {
	RequestID             core.RequestID     `json:"requestId"`
	ParentRequestID       *core.RequestID    `json:"parentRequestId"`
	RoomID                *core.RoomID       `json:"roomId"`
	RecipientID           *core.IdentityID   `json:"recipientId"`
	Sender                jobRequestSender   `json:"sender"`
	Kind                  core.RequestKind   `json:"kind"`
	Origin                core.RequestOrigin `json:"origin"`
	Urgent                bool               `json:"urgent"`
	DigestKind            string             `json:"digestKind"`
	Mode                  string             `json:"mode"`
	PreparedAtMs          uint64             `json:"preparedAtMs"`
	Delivery              core.AttemptStatus `json:"delivery"`
	MessageState          jobRequestDelivery `json:"messageState"`
	RecipientAcknowledged *bool              `json:"recipientAcknowledged"`
	Final                 jobRequestFinal    `json:"final"`
}

type jobRequestSender struct {
	Kind       core.OriginatorKind `json:"kind"`
	IdentityID *core.IdentityID    `json:"identityId"`
}

type jobDeliveryReason struct {
	Code string `json:"code"`
	Text string `json:"text"`
}

type jobRequestDelivery struct {
	State       string            `json:"state"`
	Reason      jobDeliveryReason `json:"reason"`
	LatestMs    *uint64           `json:"latestMs"`
	RemainingMs *uint64           `json:"remainingMs"`
	CanSendNow  bool              `json:"canSendNow"`
}

type jobRequestFinal struct {
	Status        core.FinalStatus `json:"status"`
	Reason        *string          `json:"reason,omitempty"`
	WithdrawnAtMs *uint64          `json:"withdrawnAtMs,omitempty"`
	SubmittedAtMs *uint64          `json:"submittedAtMs,omitempty"`
	BodyBytes     *uint64          `json:"bodyBytes,omitempty"`
	ExpiresAtMs   *uint64          `json:"expiresAtMs,omitempty"`
}

func projectLastJobRun(run core.OrchJobRun, item core.OrchDispatchItem) *jobLastRun {
	last := &jobLastRun{
		ID: run.ID, Revision: run.Revision, SlotMs: run.SlotMs, RecordedAtMs: run.RecordedMs,
		OperationID: run.Receipt.OperationID, RequestID: item.RequestID, Acceptance: item.Acceptance,
	}
	if evidence := run.Request; evidence != nil {
		attempt, delivery := evidence.Attempt, evidence.DeliveryView
		final := jobRequestFinal{Status: evidence.Final.Status}
		switch evidence.Final.Status {
		case core.FinalWithdrawn:
			if withdrawal := evidence.Final.Withdrawal; withdrawal != nil {
				final.Reason, final.WithdrawnAtMs = &withdrawal.Reason, &withdrawal.WithdrawnAtMs
			}
		case core.FinalRetained, core.FinalExpired, core.FinalUnavailable:
			final.SubmittedAtMs, final.ExpiresAtMs = evidence.Final.SubmittedAtMs, evidence.Final.ExpiresAtMs
			if evidence.Final.Status == core.FinalRetained {
				final.BodyBytes = evidence.Final.BodyBytes
				last.ResultReference = &jobResultReference{RequestID: attempt.RequestID}
			}
		}
		var acknowledged *bool
		if attempt.Route.Kind == core.RequestRouteInbox {
			acknowledged = &evidence.RecipientAcknowledged
		}
		last.Request = &jobRequest{
			RequestID: attempt.RequestID, ParentRequestID: evidence.ParentRequestID, RoomID: evidence.RoomID,
			RecipientID: attempt.Recipient,
			Sender:      jobRequestSender{Kind: attempt.Originator.Kind, IdentityID: attempt.Originator.IdentityID},
			Kind:        attempt.Kind, Origin: attempt.Origin, Urgent: evidence.Urgent, DigestKind: evidence.DigestKind, Mode: evidence.Mode,
			PreparedAtMs: attempt.PreparedAtMs, Delivery: attempt.Status, RecipientAcknowledged: acknowledged,
			MessageState: jobRequestDelivery{State: delivery.State, Reason: jobDeliveryReason{Code: delivery.Reason, Text: delivery.ReasonText},
				LatestMs: delivery.LatestMs, RemainingMs: delivery.RemainingMs, CanSendNow: delivery.CanSendNow},
			Final: final,
		}
	}
	return last
}
