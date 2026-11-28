package ports

import (
	"context"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

// DigestStore owns canonical checklist reads and transaction-scoped admission.
// Host readiness, rendering and delivery belong to callers.
type DigestStore interface {
	ReadPolicies(context.Context, core.DigestIdentityQuery) ([]core.DigestPolicyView, error)
	WritePolicy(context.Context, core.DigestPolicyWrite) (core.DigestPolicyView, error)
	ReadStats(context.Context, core.DigestIdentityQuery) ([]core.DigestStats, error)
	MarkDue(context.Context, core.DigestDueQuery) (core.DigestDue, error)
	ReadChecklist(context.Context, core.DigestChecklistQuery) (core.DigestChecklistPage, error)
	ClaimableItems(context.Context, core.DigestClaimableQuery) (core.DigestChecklistPage, error)
	ReadHistory(context.Context, core.DigestChecklistQuery) (core.DigestHistoryPage, error)
	// DigestIdleBinding reports saved eligibility and leaves host verification to the caller.
	DigestIdleBinding(context.Context, core.IdentityID) (*core.DigestLaunchFence, error)
	Claim(context.Context, core.DigestClaim) (*core.DigestChecklist, error)
	Settle(context.Context, core.DigestSettlement) (bool, error)
	SyncReceiving(context.Context, core.DigestReceivingWrite) (uint64, error)
}
