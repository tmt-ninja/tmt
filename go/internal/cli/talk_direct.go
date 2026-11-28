package cli

import (
	"context"
	"errors"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type directTalkPane struct {
	snapshot  tmux.PaneSnapshot
	recipient *core.Identity
	binding   *core.Binding
}

func (app application) resolveDirectTalkPane(ctx context.Context, selector string) (directTalkPane, *output.Failure) {
	var result directTalkPane
	if strings.HasPrefix(core.TargetText(selector), "pty_") {
		// NOT PORTED (CLI-14): Durable direct-pane requests on the built-in terminal host.
		return result, bindingFailure("NOT_PORTED", "Talk to a built-in pane is not yet ported.", 2)
	}
	if app.caller.lookup == nil || app.tmux == nil {
		return result, bindingPaneMissing(selector)
	}
	tmuxEnv, _ := app.caller.lookup("TMUX")
	socket, pid, _, valid := parseTmuxClaim(tmuxEnv)
	if !valid {
		return result, bindingPaneMissing(selector)
	}
	client, err := app.tmux()
	if err != nil {
		return result, directTalkEvidenceFailure()
	}
	pane, err := client.ResolvePane(ctx, socket, selector)
	if errors.Is(err, tmux.ErrPaneNotFound) {
		return result, bindingPaneMissing(selector)
	}
	if err != nil {
		return result, directTalkEvidenceFailure()
	}
	current, err := client.Discover(ctx, socket, pane.PaneID)
	if err != nil || current.Truncated || len(current.Candidates) > 1 {
		return result, directTalkEvidenceFailure()
	}
	if len(current.Candidates) == 0 {
		return result, bindingPaneMissing(selector)
	}
	first := current.Candidates[0]
	if first.Pane != pane || first.Linked || first.Reason != "" || first.Server.PID != pid {
		return result, directTalkEvidenceFailure()
	}

	if first.Server.ID == "" {
		if first.Marker != nil {
			return result, directTalkEvidenceFailure()
		}
		id, err := client.EnsureServerID(ctx, socket)
		if err != nil {
			return result, directTalkEvidenceFailure()
		}
		observed, err := client.Discover(ctx, socket, pane.PaneID)
		if err != nil || observed.Truncated || len(observed.Candidates) != 1 {
			return result, directTalkEvidenceFailure()
		}
		first.Server.ID = id
		fresh := observed.Candidates[0]
		if fresh.Pane != pane || fresh.Linked || fresh.Reason != "" || fresh.Marker != nil || fresh.Server != first.Server ||
			fresh.ServerProcess != first.ServerProcess || fresh.Process != first.Process {
			return result, directTalkEvidenceFailure()
		}
		first = fresh
	}
	result.snapshot = first
	err = app.store.Read(ctx, func(tx ports.StoreTx) error {
		binding, err := tx.Bindings().FindByEndpoint(core.EndpointKey{
			Host: first.Server.Host, ServerID: first.Server.ID, PaneID: pane.PaneID,
		})
		if err != nil || binding == nil {
			return err
		}
		result.binding = binding
		result.recipient, err = tx.Identities().FindByID(binding.IdentityID)
		return err
	})
	if err != nil {
		return directTalkPane{}, talkFailure(err)
	}
	if result.binding == nil && first.Marker == nil {
		return result, nil
	}
	if result.binding == nil || result.recipient == nil {
		return directTalkPane{}, directTalkEvidenceFailure()
	}
	probe := core.EndpointProbe{State: core.EndpointProbeLive, Server: first.Server, Panes: []core.PaneObservation{{
		ID: pane.PaneID, PID: first.Process.PID, Incarnation: &first.Process.StartIdentity, Marker: first.Marker,
	}}}
	if state, _ := core.EvaluateBinding(*result.recipient, result.binding, probe); state != core.BindingActive {
		return directTalkPane{}, directTalkEvidenceFailure()
	}
	return result, nil
}

func directTalkEvidenceFailure() *output.Failure {
	return bindingFailure("RECONCILIATION_FAILED", "Could not verify the recipient's tmux endpoint.", 1)
}
