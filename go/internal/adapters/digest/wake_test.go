package digest

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type wakeFixture struct {
	ports.DigestWakeStore
	page       core.DigestWakeCandidates
	released   []core.IdentityID
	claims     []core.DigestClaim
	settled    []core.DigestSettlement
	advanced   []*core.IdentityID
	claimBatch bool
	afterClaim func()
}

func (f *wakeFixture) WakeCandidates(context.Context, uint64) (core.DigestWakeCandidates, error) {
	return f.page, nil
}

func (f *wakeFixture) WakeReleased(_ context.Context, q core.DigestDueQuery) (bool, error) {
	f.released = append(f.released, q.IdentityID)
	return true, nil
}

func (f *wakeFixture) AdvanceWakeScan(_ context.Context, after *core.IdentityID) error {
	f.advanced = append(f.advanced, after)
	return nil
}

func (f *wakeFixture) Claim(_ context.Context, q core.DigestClaim) (*core.DigestChecklist, error) {
	f.claims = append(f.claims, q)
	if !f.claimBatch {
		return nil, nil
	}
	if f.afterClaim != nil {
		f.afterClaim()
	}
	return &core.DigestChecklist{IdentityID: q.IdentityID, ID: q.ChecklistID, AttemptToken: q.AttemptToken,
		CreatedAtMs: q.NowMs, Projection: q.Kind, Summary: &core.DigestSummaryCounts{IncomingCount: 8, UrgentCount: 2}}, nil
}

func (f *wakeFixture) Settle(ctx context.Context, q core.DigestSettlement) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	f.settled = append(f.settled, q)
	return true, nil
}

func TestWakeSpendsOneAdmissionAndSettlesExactClaim(t *testing.T) {
	for _, test := range []struct {
		state   string
		outcome ports.DeliveryOutcome
		settled core.DigestState
	}{
		{"delivered", ports.DeliveryDelivered, core.DigestStateDelivered},
		{"uncertain", ports.DeliveryUncertain, core.DigestStateUncertain},
		{"unavailable", ports.DeliveryNotStarted, core.DigestStateDefinitelyUnsent},
	} {
		t.Run(test.state, func(t *testing.T) {
			fixture := wakeFixture{claimBatch: true, page: core.DigestWakeCandidates{IdentityIDs: []core.IdentityID{"busy", "ready", "later"}}}
			var sent int
			prepare := func(_ context.Context, id core.IdentityID) (*PreparedDelivery, error) {
				if id == "busy" {
					return nil, nil
				}
				if id != "ready" {
					t.Fatalf("unexpected candidate %s", id)
				}
				return &PreparedDelivery{Send: func(_ context.Context, text string) (ports.DeliveryOutcome, bool, error) {
					sent++
					if text != "you have 8 messages, 2 urgent: tmt-go inbox" {
						t.Fatalf("notification = %q", text)
					}
					if test.outcome == ports.DeliveryDelivered {
						return test.outcome, true, nil
					}
					return test.outcome, false, errors.New("transport did not confirm delivery")
				}}, nil
			}
			result, err := WakeStep(t.Context(), &fixture, prepare, func() uint64 { return 5000 }, time.Second, 3)
			if err != nil || result.State != test.state || result.IdentityID == nil || *result.IdentityID != "ready" ||
				result.NextAtMs == nil || *result.NextAtMs != 6000 || *result.IncomingCount != 8 || *result.UrgentCount != 2 {
				t.Fatalf("wake = %+v, %v", result, err)
			}
			if sent != 1 || len(fixture.claims) != 1 || len(fixture.settled) != 1 || len(fixture.advanced) != 0 ||
				!slices.Equal(fixture.released, []core.IdentityID{"busy", "ready"}) {
				t.Fatalf("unexpected attempts: sent=%d fixture=%+v", sent, fixture)
			}
			claim, settle := fixture.claims[0], fixture.settled[0]
			if claim.Kind != core.DigestProjectionIncomingSummary || claim.Opportunity != core.DigestOpportunityIdle || claim.Launch == nil ||
				!core.ValidUUID(string(claim.ChecklistID)) || !core.ValidUUID(string(claim.AttemptToken)) ||
				settle.IdentityID != claim.IdentityID || settle.ChecklistID != claim.ChecklistID || settle.AttemptToken != claim.AttemptToken ||
				settle.Outcome != test.settled || settle.MessageStarted != (test.outcome == ports.DeliveryDelivered) {
				t.Fatalf("claim %+v settlement %+v", claim, settle)
			}
		})
	}
}

func TestWakeClockAndNilClaimNeverSend(t *testing.T) {
	fixture := wakeFixture{page: core.DigestWakeCandidates{IdentityIDs: []core.IdentityID{"first"}, Clock: core.DigestWakeClock{NextAdmissionMs: 6000}}}
	prepare := func(context.Context, core.IdentityID) (*PreparedDelivery, error) {
		return &PreparedDelivery{Send: func(context.Context, string) (ports.DeliveryOutcome, bool, error) {
			t.Fatal("wake sent without fresh admission")
			return ports.DeliveryNotStarted, false, nil
		}}, nil
	}
	now := func() uint64 { return 5000 }
	result, err := WakeStep(t.Context(), &fixture, prepare, now, time.Second, 1)
	wire, encodeErr := json.Marshal(result)
	if err != nil || encodeErr != nil || string(wire) != `{"schemaVersion":1,"state":"nothing_due","identityId":null,"projection":"incoming_summary","nextAtMs":6000}` ||
		len(fixture.released)+len(fixture.claims)+len(fixture.advanced) != 0 {
		t.Fatalf("blocked wake = %s, %v, %v, %+v", wire, err, encodeErr, fixture)
	}
	fixture.page.Clock.NextAdmissionMs = 5000
	result, err = WakeStep(t.Context(), &fixture, prepare, now, time.Second, 1)
	if err != nil || result.State != "unavailable" || result.IdentityID != nil || len(fixture.claims) != 1 ||
		len(fixture.settled) != 0 || len(fixture.advanced) != 1 || fixture.advanced[0] == nil || *fixture.advanced[0] != "first" {
		t.Fatalf("unclaimed wake = %+v, %v, %+v", result, err, fixture)
	}
	fixture.page.Clock.ScanAfterIdentityID = fixture.advanced[0]
	fixture.page.IdentityIDs = nil
	result, err = WakeStep(t.Context(), &fixture, prepare, now, time.Second, 1)
	if err != nil || result.State != "nothing_due" || len(fixture.advanced) != 2 || fixture.advanced[1] != nil {
		t.Fatalf("wrapped scan = %+v, %v, %+v", result, err, fixture)
	}
}

func TestWakeCanceledAfterClaimReleasesWithoutTransport(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	fixture := wakeFixture{claimBatch: true, afterClaim: cancel, page: core.DigestWakeCandidates{IdentityIDs: []core.IdentityID{"ready"}}}
	prepare := func(context.Context, core.IdentityID) (*PreparedDelivery, error) {
		return &PreparedDelivery{Send: func(context.Context, string) (ports.DeliveryOutcome, bool, error) {
			t.Fatal("transport reached after cancellation")
			return ports.DeliveryUncertain, false, nil
		}}, nil
	}
	result, err := WakeStep(ctx, &fixture, prepare, func() uint64 { return 5000 }, time.Second, 1)
	if err != nil || result.State != "unavailable" || len(fixture.settled) != 1 || fixture.settled[0].Outcome != core.DigestStateDefinitelyUnsent {
		t.Fatalf("cancelled wake = %+v, %v, %+v", result, err, fixture.settled)
	}
}
