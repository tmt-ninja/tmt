package digest

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// WakeStore is the durable half of a finite wake step.
type WakeStore interface {
	ports.DigestWakeStore
	Claim(context.Context, core.DigestClaim) (*core.DigestChecklist, error)
	Settle(context.Context, core.DigestSettlement) (bool, error)
}

// PrepareIdle returns a single-use send for the exact verified idle launch.
// A nil send leaves the candidate pending. The send rechecks the launch before
// transport and returns whether delivery also proved that a message started.
// Every return, including errors, carries authoritative transport evidence.
type PrepareIdle func(context.Context, core.IdentityID) (*PreparedDelivery, error)

type PreparedDelivery struct {
	Launch core.DigestLaunchFence
	Send   SendIdle
}

type SendIdle func(context.Context, string) (ports.DeliveryOutcome, bool, error)

type WakeResult struct {
	SchemaVersion uint64                `json:"schemaVersion"`
	State         string                `json:"state"`
	IdentityID    *core.IdentityID      `json:"identityId"`
	Projection    core.DigestProjection `json:"projection"`
	NextAtMs      *uint64               `json:"nextAtMs"`
	IncomingCount *uint64               `json:"incomingCount,omitempty"`
	UrgentCount   *uint64               `json:"urgentCount,omitempty"`
}

// WakeStep visits one bounded page and spends at most one durable admission.
func WakeStep(ctx context.Context, store WakeStore, prepare PrepareIdle, now func() uint64, budget time.Duration, limit uint64) (WakeResult, error) {
	result := WakeResult{SchemaVersion: 1, State: "nothing_due", Projection: core.DigestProjectionIncomingSummary}
	if budget < time.Millisecond || budget > time.Minute || limit == 0 || limit > 256 {
		return result, errors.New("invalid Digest wake bounds")
	}
	scan, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	page, err := store.WakeCandidates(scan, limit)
	if err != nil {
		return result, err
	}
	if now() < page.Clock.NextAdmissionMs {
		result.NextAtMs = &page.Clock.NextAdmissionMs
		return result, nil
	}
	if len(page.IdentityIDs) > 0 {
		result.State = "unavailable"
	}

	after := page.Clock.ScanAfterIdentityID
	visited := 0
	for _, id := range page.IdentityIDs {
		if scan.Err() != nil {
			break
		}
		batch, send, err := claimWake(scan, store, prepare, now, id)
		if errors.Is(scan.Err(), context.DeadlineExceeded) && errors.Is(err, context.DeadlineExceeded) {
			break
		}
		if err != nil {
			return result, err
		}
		if batch != nil {
			return deliverWake(ctx, scan, store, send, now, batch, result)
		}
		if scan.Err() != nil {
			break
		}
		after = &id
		visited++
	}
	if visited == len(page.IdentityIDs) && uint64(visited) < limit {
		after = nil
	}
	return result, store.AdvanceWakeScan(ctx, after)
}

func claimWake(ctx context.Context, store WakeStore, prepare PrepareIdle, now func() uint64, id core.IdentityID) (*core.DigestChecklist, SendIdle, error) {
	released, err := store.WakeReleased(ctx, core.DigestDueQuery{IdentityID: id, NowMs: now()})
	if err != nil || !released || ctx.Err() != nil {
		return nil, nil, err
	}
	idle, err := prepare(ctx, id)
	if err != nil || idle == nil || idle.Send == nil || ctx.Err() != nil {
		return nil, nil, err
	}
	batch, err := store.Claim(ctx, core.DigestClaim{
		IdentityID: id, ChecklistID: core.DigestChecklistID(wakeUUID()), AttemptToken: core.DigestAttemptToken(wakeUUID()),
		Kind: core.DigestProjectionIncomingSummary, Opportunity: core.DigestOpportunityIdle, Launch: &idle.Launch, NowMs: now(),
	})
	return batch, idle.Send, err
}

func deliverWake(ctx, scan context.Context, store WakeStore, send SendIdle, now func() uint64, batch *core.DigestChecklist, result WakeResult) (WakeResult, error) {
	settlement := core.DigestSettlement{
		IdentityID: batch.IdentityID, ChecklistID: batch.ID, AttemptToken: batch.AttemptToken,
		Outcome: core.DigestStateDefinitelyUnsent,
	}
	counts := batch.Summary
	var err error
	if batch.Projection != core.DigestProjectionIncomingSummary || counts == nil {
		err = errors.New("Digest wake did not return frozen summary counts")
	} else {
		next := batch.CreatedAtMs + 1000
		result.IdentityID, result.NextAtMs = &batch.IdentityID, &next
		result.IncomingCount, result.UrgentCount = &counts.IncomingCount, &counts.UrgentCount
		if scan.Err() == nil {
			line := summaryText(*counts)
			// The transport outcome also covers failed attempts and controls replay.
			outcome, started, _ := send(scan, line)
			switch outcome {
			case ports.DeliveryNotStarted:
			case ports.DeliveryDelivered:
				settlement.Outcome, settlement.MessageStarted = core.DigestStateDelivered, started
				result.State = "delivered"
			default:
				settlement.Outcome = core.DigestStateUncertain
				result.State = "uncertain"
			}
		}
	}
	settlement.NowMs = now()
	// Release or seal a spent claim even if its scan budget ended after admission.
	finish, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Second)
	defer cancel()
	_, settleErr := store.Settle(finish, settlement)
	return result, errors.Join(err, settleErr)
}

func wakeUUID() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
