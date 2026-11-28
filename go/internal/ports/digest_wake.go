package ports

import (
	"context"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

// DigestWakeStore owns the durable scan state and preflight eligibility.
// Transport permission still comes from the summary claim.
type DigestWakeStore interface {
	WakeCandidates(context.Context, uint64) (core.DigestWakeCandidates, error)
	WakePending(context.Context, core.IdentityID) (bool, error)
	WakeReleased(context.Context, core.DigestDueQuery) (bool, error)
	AdvanceWakeScan(context.Context, *core.IdentityID) error
}
