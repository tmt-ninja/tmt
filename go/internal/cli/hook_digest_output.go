package cli

import (
	"context"

	"github.com/tmt-ninja/tmt/go/internal/adapters/digest"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/claude"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// publishClaudeDigest spends the sealed checklist's one permission to write
// provider output. A partial write settles uncertain and never publishes again.
func publishClaudeDigest(ctx context.Context, store ports.DigestStore, claim digest.ClaimedChecklist,
	recheck func(context.Context) bool, write func(context.Context, []byte) (int, error), now func() uint64,
) error {
	batch := claim.Batch
	settle := func(outcome core.DigestState) error {
		_, err := store.Settle(ctx, core.DigestSettlement{
			IdentityID: batch.IdentityID, ChecklistID: batch.ID, AttemptToken: batch.AttemptToken,
			Outcome: outcome, NowMs: now(),
		})
		return err
	}
	payload := claude.EncodeStopContinuation(claim.Text)
	if len(payload) == 0 || !recheck(ctx) {
		return settle(core.DigestStateDefinitelyUnsent)
	}
	policies, err := store.ReadPolicies(ctx, core.DigestIdentityQuery{
		IdentityIDs: []core.IdentityID{batch.IdentityID}, NowMs: now(),
	})
	if err != nil {
		return err
	}
	if len(policies) != 1 || policies[0].IdentityID != batch.IdentityID ||
		!sameClaudeDigestClaim(policies[0].ActiveChecklist, batch) {
		return nil
	}
	outcome := core.DigestStateDefinitelyUnsent
	if ctx.Err() == nil {
		written, _ := write(ctx, payload)
		switch {
		case written == len(payload):
			outcome = core.DigestStateDelivered
		case written != 0:
			outcome = core.DigestStateUncertain
		}
	}
	return settle(outcome)
}

func sameClaudeDigestClaim(current *core.DigestChecklist, batch core.DigestChecklist) bool {
	return current != nil && current.IdentityID == batch.IdentityID && current.ID == batch.ID &&
		current.AttemptToken == batch.AttemptToken && current.State == core.DigestStateClaimed
}
