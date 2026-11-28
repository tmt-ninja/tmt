package delivery

import (
	"context"
	"errors"
	"fmt"

	"github.com/tmt-ninja/tmt/go/internal/adapters/channel"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// PasteHost supplies the exact tmux probe and the terminal transport.
type PasteHost interface {
	ProbeBinding(context.Context, ports.PaneRef) (core.EndpointProbe, error)
	Deliver(context.Context, ports.PaneRef, ports.DeliveryInput) (ports.DeliveryOutcome, error)
}

// PasteTarget optionally pins the durable binding the caller resolved. An
// identity-less route still checks channel records attributed to the pane.
type PasteTarget struct {
	Pane     ports.PaneRef
	Binding  *core.Binding
	Identity core.Identity
}

// GuardedPaste is the last boundary before tmux input. Allow only a fresh
// pane that is free of channel evidence. Skipped unattributable records are
// returned for diagnostics on both permitted and refused routes.
func GuardedPaste(ctx context.Context, host PasteHost, runner ports.Process, root home.Root,
	target PasteTarget, input ports.DeliveryInput,
) (ports.DeliveryOutcome, []string, error) {
	probe, err := host.ProbeBinding(ctx, target.Pane)
	if err != nil {
		return ports.DeliveryNotStarted, nil, err
	}
	if probe.State != core.EndpointProbeLive || probe.Server.Socket != target.Pane.Server ||
		len(probe.Panes) != 1 || probe.Panes[0].ID != target.Pane.PaneID ||
		probe.Panes[0].PID == 0 || probe.Panes[0].Incarnation == nil {
		return ports.DeliveryNotStarted, nil, errors.New("could not verify the exact pane before paste")
	}
	pane := probe.Panes[0]
	var bindingID core.BindingID
	if target.Binding != nil {
		state, _ := core.EvaluateBinding(target.Identity, target.Binding, probe)
		if state != core.BindingActive || target.Binding.PaneIncarnation == nil {
			return ports.DeliveryNotStarted, nil, errors.New("binding changed before paste")
		}
		bindingID = target.Binding.ID
	} else if pane.Marker != nil {
		// Direct paste must not bypass a newly attached binding's channel.
		return ports.DeliveryNotStarted, nil, errors.New("the pane has a binding and must use bound delivery")
	}
	evidence, err := channel.CheckPaneEvidence(ctx, runner, root, channel.PaneAddress{
		Server: probe.Server, PaneID: pane.ID, PanePID: pane.PID,
	}, bindingID)
	if err != nil {
		return ports.DeliveryNotStarted, evidence.Skipped, err
	}
	if evidence.Enrolled {
		err := fmt.Errorf("pane %s has a channel enrollment at %q", pane.ID, evidence.Record)
		return ports.DeliveryNotStarted, evidence.Skipped, err
	}
	if err := ctx.Err(); err != nil {
		return ports.DeliveryNotStarted, evidence.Skipped, err
	}
	outcome, err := host.Deliver(ctx, target.Pane, input)
	return outcome, evidence.Skipped, err
}
