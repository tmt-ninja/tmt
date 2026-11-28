package api

import (
	"context"
	"encoding/json/jsontext"
	"errors"
	"os/exec"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/digest"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/gemini"
	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type claimInput struct {
	IdentityID  core.IdentityID        `json:"identityId"`
	Opportunity core.DigestOpportunity `json:"opportunity"`
}

type flushInput struct {
	IdentityID core.IdentityID `json:"identityId"`
	WhenBusy   bool            `json:"whenBusy"`
}

func decodeClaim(input jsontext.Value) (claimInput, bool) {
	var wire claimInput
	ok := decodeObject(input, &wire) && core.ValidUUID(string(wire.IdentityID)) && wire.Opportunity.Valid()
	return wire, ok
}

func decodeFlush(input jsontext.Value) (flushInput, bool) {
	var wire struct {
		IdentityID core.IdentityID `json:"identityId"`
		WhenBusy   jsontext.Value  `json:"whenBusy"`
	}
	if !decodeObject(input, &wire) || !core.ValidUUID(string(wire.IdentityID)) {
		return flushInput{}, false
	}
	switch string(wire.WhenBusy) {
	case "", "false", "true":
		return flushInput{IdentityID: wire.IdentityID, WhenBusy: string(wire.WhenBusy) == "true"}, true
	default:
		return flushInput{}, false
	}
}

func (s *requestSession) claimChecklist(ctx context.Context, in claimInput, now uint64) (any, error) {
	query := digest.ClaimInput{IdentityID: in.IdentityID, Opportunity: in.Opportunity, AllowSummary: true, NowMs: now}
	if in.Opportunity == core.DigestOpportunityIdle {
		idle, err := s.prepareIdle(ctx, in.IdentityID)
		if idle == nil || err != nil {
			return map[string]any{"claimed": false}, err
		}
		query.Launch = &idle.Launch
	}
	claim, err := digest.ClaimChecklist(ctx, s.store, query)
	if claim == nil || err != nil {
		return map[string]any{"claimed": false}, err
	}
	return map[string]any{
		"claimed": true, "checklist": checklistDocument(&claim.Batch), "text": claim.Text,
		"page": checklistPageDocument(core.DigestChecklistQuery{IdentityID: in.IdentityID, ChecklistID: &claim.Batch.ID}, claim.Page),
	}, nil
}

func (s *requestSession) flushChecklist(ctx context.Context, in flushInput, now uint64) (any, error) {
	doc := map[string]any{"identityId": in.IdentityID, "state": "nothing_due"}
	stats, err := s.store.ReadStats(ctx, core.DigestIdentityQuery{IdentityIDs: []core.IdentityID{in.IdentityID}, NowMs: now})
	if err != nil {
		return nil, err
	}
	pending, err := s.store.WakePending(ctx, in.IdentityID)
	if err != nil || (stats[0].DueCount == 0 && !pending) {
		return doc, err
	}
	doc["state"] = "not_idle"
	target, err := s.prepareIdle(ctx, in.IdentityID)
	if err != nil {
		return nil, err
	}
	allowSummary := target != nil
	if target == nil {
		target, err = s.prepareLive(ctx, in)
		if err != nil || target == nil {
			return doc, err
		}
	}
	claim, err := digest.ClaimChecklist(ctx, s.store, digest.ClaimInput{
		IdentityID: in.IdentityID, Opportunity: core.DigestOpportunityIdle, AllowSummary: allowSummary,
		Launch: &target.Launch, NowMs: now,
	})
	if err != nil || claim == nil {
		return doc, err
	}
	outcome, started, _ := target.Send(ctx, claim.Text)
	switch outcome {
	case ports.DeliveryNotStarted:
		doc["state"] = "unavailable"
	case ports.DeliveryDelivered:
		doc["state"] = "delivered"
	default:
		doc["state"] = "uncertain"
	}
	return doc, digest.SettleClaim(ctx, s.store, claim.Batch, outcome, started, uint64(time.Now().UnixMilli()))
}

func (s *requestSession) prepareIdle(ctx context.Context, id core.IdentityID) (*digest.PreparedDelivery, error) {
	client, err := digestTmuxClient()
	if err != nil || client == nil {
		return nil, err
	}
	return digest.TmuxLaunchGuard(s.root, *client, s.store.DigestIdleBinding).Prepare(ctx, id)
}

func (s *requestSession) prepareLive(ctx context.Context, in flushInput) (*digest.PreparedDelivery, error) {
	client, err := digestTmuxClient()
	if err != nil || client == nil {
		return nil, err
	}
	read := func(ctx context.Context, id core.IdentityID) (*core.DigestLaunchFence, error) {
		var snapshot *core.ResumeSnapshot
		err := s.store.Read(ctx, func(tx ports.StoreTx) error {
			var err error
			snapshot, err = tx.Bindings().ReadResume(id)
			return err
		})
		if err != nil || snapshot == nil || snapshot.PriorBinding == nil || snapshot.Selected == nil {
			return nil, err
		}
		remembered := snapshot.Selected
		if remembered.StaleAtMs != nil || remembered.PendingAtMs != nil {
			return nil, nil
		}
		if remembered.Driver == core.DriverGemini {
			b := snapshot.PriorBinding
			if b.Server.Host != "tmux" {
				return nil, nil
			}
			screen, err := client.Capture(ctx, ports.PaneRef{Server: b.Server.Socket, PaneID: b.PaneID}, ports.CaptureOpts{})
			if err != nil || (gemini.Driver{}).Classify(screen) != ports.DriverIdle {
				return nil, err
			}
		} else if !in.WhenBusy {
			return nil, nil
		}
		return &core.DigestLaunchFence{Expected: *snapshot.PriorBinding, Driver: remembered.Driver, ProviderSession: remembered.ProviderSession}, nil
	}
	return digest.TmuxLaunchGuard(s.root, *client, read).Prepare(ctx, in.IdentityID)
}

func digestTmuxClient() (*tmux.Client, error) {
	path, err := exec.LookPath("tmux")
	if errors.Is(err, exec.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &tmux.Client{Path: path, Process: process.Runner{}}, nil
}
