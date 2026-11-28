package ports

import (
	"context"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

type HookQueue interface {
	// The returned status governs replay, including when err is set. Unknown
	// publication must never cause an automatic retry or synchronous fallback.
	Enqueue(context.Context, core.HookCaptureEvent) (core.HookPublication, error)
	Next(context.Context) (*core.HookQueueEntry, error)
	NextUncommitted(context.Context, *core.IdentityID) (*core.HookQueueEntry, error)
	MarkCommitted(context.Context, core.HookEventID) error
	Acknowledge(context.Context, core.HookEventID) error
	TryClaim(context.Context) (HookQueueClaim, bool, error)
	// FinishIfEmpty consumes the claim only on the empty path, under the
	// queue writer. Callers may defer Close even if the claim was consumed.
	FinishIfEmpty(context.Context, HookQueueClaim) (bool, error)
	Close() error
}

type HookQueueClaim interface {
	Close() error
}

type CaptureStore interface {
	CommitCapture(context.Context, core.HookCaptureEvent) (core.HookCaptureReceipt, error)
}
