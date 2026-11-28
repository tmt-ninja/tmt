package cli

import (
	"context"
	"io"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/digest"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type claudeDigestFixture struct {
	ports.DigestStore
	policy  core.DigestPolicyView
	settled []core.DigestSettlement
}

func (f *claudeDigestFixture) ReadPolicies(context.Context, core.DigestIdentityQuery) ([]core.DigestPolicyView, error) {
	return []core.DigestPolicyView{f.policy}, nil
}

func (f *claudeDigestFixture) Settle(_ context.Context, settlement core.DigestSettlement) (bool, error) {
	f.settled = append(f.settled, settlement)
	return true, nil
}

func TestClaudeDigestOnlyCompletePublicationIsDelivered(t *testing.T) {
	batch := core.DigestChecklist{ID: "batch", IdentityID: "identity", AttemptToken: "attempt", State: core.DigestStateClaimed}
	for _, tc := range []struct {
		name          string
		proof, active bool
		size          int
		write         bool
		want          core.DigestState
	}{
		{"complete", true, true, -1, true, core.DigestStateDelivered},
		{"zero bytes", true, true, 0, true, core.DigestStateDefinitelyUnsent},
		{"partial", true, true, 1, true, core.DigestStateUncertain},
		{"launch replaced", false, true, 0, false, core.DigestStateDefinitelyUnsent},
		{"attempt replaced", true, false, 0, false, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &claudeDigestFixture{policy: core.DigestPolicyView{IdentityID: batch.IdentityID}}
			if tc.active {
				store.policy.ActiveChecklist = &batch
			}
			writes := 0
			err := publishClaudeDigest(t.Context(), store, digest.ClaimedChecklist{Batch: batch, Text: "digest"},
				func(context.Context) bool { return tc.proof },
				func(_ context.Context, payload []byte) (int, error) {
					writes++
					if string(payload) != `{"decision":"block","reason":"digest"}` {
						t.Fatalf("provider payload = %q", payload)
					}
					if tc.size < 0 {
						return len(payload), nil
					}
					return tc.size, io.ErrShortWrite
				}, func() uint64 { return 10 })
			if err != nil || (writes == 1) != tc.write || writes > 1 {
				t.Fatalf("publication writes = %d, %v", writes, err)
			}
			if tc.want == "" {
				if len(store.settled) != 0 {
					t.Fatal("replacement attempt was settled")
				}
			} else if len(store.settled) != 1 || store.settled[0] != (core.DigestSettlement{
				IdentityID: batch.IdentityID, ChecklistID: batch.ID, AttemptToken: batch.AttemptToken, Outcome: tc.want, NowMs: 10,
			}) {
				t.Fatalf("settlements = %+v, want exact %s", store.settled, tc.want)
			}
		})
	}
}
