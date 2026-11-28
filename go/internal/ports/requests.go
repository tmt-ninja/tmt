package ports

import (
	"context"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

// RequestService is the durable request boundary for CLI. Each mutation owns
// its transaction; host delivery and observer waits happen between calls.
type RequestService interface {
	Prepare(context.Context, core.PrepareRequest) (core.PreparedRequest, error)
	Enqueue(context.Context, core.PrepareRequest) (core.PreparedRequest, error)
	BeginSend(context.Context, core.AttemptID) error
	Settle(context.Context, core.AttemptID, core.Settlement) error
	ReleaseWait(context.Context, core.AttemptID) error

	// Send-now delivery uses one invocation-local generation and keeps host I/O
	// between the final claim read and the terminal settlement.
	ReleaseSendNow(context.Context, core.RequestRef, core.IdentityID) (core.SendNowRelease, error)
	ClaimReleasedWake(context.Context, core.ReleasedWakeQuery) (core.ReleasedWakeClaim, error)
	ReadClaimedWake(context.Context, core.ReleasedWakeProof) (*core.ReleasedWakePayload, error)
	SettleReleasedWake(context.Context, core.ReleasedWakeSettlement) error

	SubmitResponse(context.Context, core.SubmitResponse) (core.FinalResponse, error)
	Answer(context.Context, core.AnswerRequest) (core.AnswerResult, error)
	Result(context.Context, core.RequestID) (core.ResponseLookup, error)
	ResultByPrefix(context.Context, string) (core.RequestID, core.ResponseLookup, error)
	Inbox(context.Context, core.InboxQuery) (core.InboxPage, error)

	ListX(context.Context, core.XQuery) (core.XPage, error)
	ShowX(context.Context, core.IdentityID, core.XDirection, core.RequestID) (core.XDetail, error)
	AckX(context.Context, core.IdentityID, core.XDirection, core.RequestID, uint64) (core.AckResult, error)
	AckAllX(context.Context, core.IdentityID, core.XDirection) (uint64, error)
	Withdraw(context.Context, core.IdentityID, core.RequestID, string) (core.WithdrawResult, error)
}
