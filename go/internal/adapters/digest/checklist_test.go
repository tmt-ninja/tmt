package digest

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type checklistFixture struct {
	ports.DigestStore
	items    []core.DigestItem
	claim    core.DigestClaim
	settled  []core.DigestSettlement
	readErr  error
	readSize int
}

func (f *checklistFixture) ClaimableItems(context.Context, core.DigestClaimableQuery) (core.DigestChecklistPage, error) {
	return core.DigestChecklistPage{Items: f.items}, nil
}

func (f *checklistFixture) Claim(_ context.Context, q core.DigestClaim) (*core.DigestChecklist, error) {
	if q.Kind == core.DigestProjectionIncomingSummary {
		return nil, nil
	}
	f.claim = q
	return &core.DigestChecklist{ID: q.ChecklistID, AttemptToken: q.AttemptToken, IdentityID: q.IdentityID, ThroughSequence: *q.ThroughLimit, Projection: q.Kind}, nil
}

func (f *checklistFixture) ReadChecklist(_ context.Context, q core.DigestChecklistQuery) (core.DigestChecklistPage, error) {
	if q.ChecklistID == nil || *q.ChecklistID != f.claim.ChecklistID {
		return core.DigestChecklistPage{}, errors.New("read did not pin exact claim")
	}
	return core.DigestChecklistPage{Items: f.items[:f.readSize], Total: uint64(f.readSize)}, f.readErr
}

func (f *checklistFixture) Settle(_ context.Context, q core.DigestSettlement) (bool, error) {
	f.settled = append(f.settled, q)
	return true, nil
}

func TestClaimMeasuresPrefixAndReleasesFailedExactRead(t *testing.T) {
	msg := strings.Repeat("x", checklistLimit/2)
	id := core.RequestID("req_09175482-a733-409c-b94e-05f93de8e1a8")
	first := core.DigestItem{DigestItemEvidence: core.DigestItemEvidence{Sequence: 5}, RequestID: id,
		Source: core.DigestSourceIncoming, Kind: core.DigestKindFyi, Prompt: &msg, Reply: &core.DigestReplyProof{Receipt: "v2_fixture"}}
	second := first
	second.Sequence++
	fixture := &checklistFixture{items: []core.DigestItem{first, second}, readSize: 1}
	input := ClaimInput{IdentityID: "worker", Opportunity: core.DigestOpportunityTurnBoundary, AllowSummary: true, NowMs: 5000}
	claim, err := ClaimChecklist(t.Context(), fixture, input)
	if err != nil || claim == nil || fixture.claim.ThroughLimit == nil || *fixture.claim.ThroughLimit != first.Sequence ||
		claim.Batch.ThroughSequence != first.Sequence || len(claim.Page.Items) != 1 || len(fixture.settled) != 0 ||
		!strings.HasPrefix(claim.Text, checklistHeader+"▚ fyi · unknown\n"+msg+"\n\n<tmt-reply from=\"unknown\">") ||
		!strings.Contains(claim.Text, flavor.Binary+" reply "+string(id)+" --receipt v2_fixture --message <text>") {
		t.Fatalf("claim = %v, through %v, err %v, settled %d", claim != nil, fixture.claim.ThroughLimit, err, len(fixture.settled))
	}
	fixture.readErr = errors.New("read failed")
	if claim, err := ClaimChecklist(t.Context(), fixture, input); claim != nil || !errors.Is(err, fixture.readErr) {
		t.Fatalf("failed render = %v, %v", claim, err)
	}
	if len(fixture.settled) != 1 || fixture.settled[0].ChecklistID != fixture.claim.ChecklistID ||
		fixture.settled[0].AttemptToken != fixture.claim.AttemptToken || fixture.settled[0].Outcome != core.DigestStateDefinitelyUnsent {
		t.Fatalf("failed read settlement = %+v", fixture.settled)
	}
}

func TestClaimMeasuresThreadRootAndRefusesOversizeFirstItemForStop(t *testing.T) {
	id := core.RequestID("req_09175482-a733-409c-b94e-05f93de8e1a8")
	rootID := core.RequestID("req_22336688-a733-409c-b94e-05f93de8e1a8")
	message := "Held request"
	item := core.DigestItem{
		DigestItemEvidence: core.DigestItemEvidence{Sequence: 1}, RequestID: id,
		Source: core.DigestSourceIncoming, Kind: core.DigestKindFyi,
		Prompt: &message, Reply: &core.DigestReplyProof{Receipt: "v2_fixture"},
	}
	// A complete unthreaded item is exactly at the native byte limit.
	message += strings.Repeat("x", checklistLimit-len(checklistHeader)-len(checklistBlock(item)))
	rootText := "Thread root"
	for _, tc := range []struct {
		name string
		root *core.RequestThreadRoot
		line string
	}{
		{"unthreaded", nil, ""},
		{"retained root", &core.RequestThreadRoot{RequestID: rootID, Text: &rootText}, "Thread: " + string(rootID) + " · \"Thread root\"\n"},
		{"expired root", &core.RequestThreadRoot{RequestID: rootID}, "Thread: " + string(rootID) + "\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			item.ThreadRoot = tc.root
			fixture := &checklistFixture{items: []core.DigestItem{item}, readSize: 1}
			input := ClaimInput{IdentityID: "worker", Opportunity: core.DigestOpportunityTurnBoundary, RequireFirstFit: true, NowMs: 5000}
			claim, err := ClaimChecklist(t.Context(), fixture, input)
			if tc.root != nil {
				if err != nil || claim != nil || fixture.claim.ThroughLimit != nil || len(fixture.settled) != 0 {
					t.Fatalf("oversized Stop item attempted a claim: claim=%v err=%v", claim != nil, err)
				}
				input.RequireFirstFit = false
				claim, err = ClaimChecklist(t.Context(), fixture, input)
			}
			if err != nil || claim == nil || fixture.claim.ThroughLimit == nil ||
				*fixture.claim.ThroughLimit != 1 || len(claim.Text) != checklistLimit+len(tc.line) ||
				!strings.HasPrefix(claim.Text, checklistHeader+"▚ fyi · unknown\n"+tc.line+message+"\n\n") ||
				strings.Count(claim.Text, flavor.Binary+" reply "+string(id)+" --receipt v2_fixture") != 1 {
				t.Fatalf("claim=%v sequence=%v err=%v", claim != nil, fixture.claim.ThroughLimit, err)
			}
		})
	}
}
