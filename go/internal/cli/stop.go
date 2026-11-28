//go:build darwin || linux

package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"reflect"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/adapters/verifiedstop"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type stopIdentity struct {
	ID   core.IdentityID `json:"id"`
	Name core.Name       `json:"name"`
}

type stopReport struct {
	Identity stopIdentity `json:"identity"`
	Outcome  string       `json:"outcome"`
	Pane     string       `json:"pane,omitempty"`
}

func (r stopReport) JSON() any                  { return r }
func (r stopReport) HumanStream() output.Stream { return output.Stdout }
func (r stopReport) ExitStatus() int            { return 0 }

func (r stopReport) Human(w io.Writer) error {
	switch r.Outcome {
	case "stopped":
		if r.Pane == "closed" {
			_, err := fmt.Fprintf(w, "✓ Stopped %s's agent and closed its pane; its binding and remembered session are kept\n", r.Identity.Name)
			return err
		}
		_, err := fmt.Fprintf(w, "✓ Stopped %s's agent; its binding and remembered session are kept\n", r.Identity.Name)
		return err
	case "already_ended":
		if r.Pane == "closed" {
			_, err := fmt.Fprintf(w, "✓ %s's agent had already ended; closed its pane, nothing was signalled\n", r.Identity.Name)
			return err
		}
		_, err := fmt.Fprintf(w, "✓ %s's agent had already ended; nothing was signalled\n", r.Identity.Name)
		return err
	default:
		_, err := fmt.Fprintf(w, "✓ %s has no running agent; nothing to stop\n", r.Identity.Name)
		return err
	}
}

func (app application) runStop(ctx context.Context, root home.Root, inv invocation) (report output.Report) {
	if app.store == nil {
		store, err := storage.Open(ctx, root)
		if err != nil {
			return bindingFailure("IDENTITY_ERROR", "Could not access member state.", 1)
		}
		app.store = store
		defer func() {
			if err := store.Close(); err != nil {
				if _, failed := report.(*output.Failure); !failed {
					report = bindingFailure("CLEANUP_ERROR", "Could not clean up command resources. Effects may already have occurred.", 1)
				}
			}
		}()
	}
	selector := inv.operands[0]
	var identity *core.Identity
	var binding *core.Binding
	err := app.store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		identity, err = core.ResolveIdentity(tx.Identities(), selector)
		if err != nil || identity == nil {
			return err
		}
		binding, err = tx.Bindings().FindByIdentity(identity.ID)
		return err
	})
	if err != nil {
		return bindingFailure("IDENTITY_ERROR", "Could not access member state.", 1)
	}
	if identity == nil {
		return identityMissing(selector)
	}
	stopped := stopReport{Identity: stopIdentity{ID: identity.ID, Name: identity.Name}, Outcome: "not_running"}
	if binding == nil || binding.Session.Runtime == nil {
		return app.finishStop(ctx, inv.has("close"), stopped, *identity, binding)
	}
	if binding.Session.RuntimeState == "ended" {
		stopped.Outcome = "already_ended"
		return app.finishStop(ctx, inv.has("close"), stopped, *identity, binding)
	}
	if binding.Server.Host != "tmux" || app.tmux == nil || binding.Session.LaunchOwner == nil ||
		binding.PanePID > math.MaxInt32 || binding.Session.Runtime.PID > math.MaxInt32 {
		return stopRefused()
	}
	client, err := app.tmux()
	if err != nil {
		return stopRefused()
	}
	observer := runtime.Observer{Process: client.Process}
	expected := runtime.Incarnation{PID: int(binding.Session.Runtime.PID), Start: binding.Session.Runtime.StartIdentity}
	visible, err := observer.Observe(ctx, expected.PID)
	if err != nil {
		return bindingFailure("PROCESS_ERROR", "Could not observe the recorded agent.", 1)
	}
	if visible.Match(expected) == runtime.Gone {
		if err := settleForeground(ctx, app.store, *binding); err != nil {
			return bindingFailure("IDENTITY_ERROR", "Could not mark the recorded agent ended.", 1)
		}
		stopped.Outcome = "already_ended"
		return app.finishStop(ctx, inv.has("close"), stopped, *identity, binding)
	}
	if visible.Match(expected) != runtime.Alive || expected.PID == int(binding.PanePID) {
		return stopRefused()
	}

	stopper := verifiedstop.Stopper{Observer: observer}
	ref := ports.PaneRef{Server: binding.Server.Socket, PaneID: binding.PaneID}
	prove := func(ctx context.Context) (runtime.Incarnation, error) {
		probe, err := client.ProbeBinding(ctx, ref)
		if err != nil {
			return runtime.Incarnation{}, err
		}
		provider, err := observer.ProveBoundMain(ctx, *identity, *binding, probe)
		return provider.Incarnation, err
	}
	if main, err := prove(ctx); err != nil || main != expected {
		return stopRefused()
	}

	// Serialize the final proof and one TERM with binding replacement.
	// Wait only after releasing SQLite's writer so the owner can settle.
	var pending verifiedstop.Pending
	err = app.store.Write(ctx, func(tx ports.StoreTx) error {
		fresh, err := tx.Bindings().FindByIdentity(identity.ID)
		if err != nil {
			return err
		}
		if !reflect.DeepEqual(fresh, binding) {
			return bindingFailure("IDENTITY_CONFLICT", "The agent's binding changed before stop.", 5)
		}
		all, err := tx.Bindings().List()
		if err != nil {
			return err
		}
		for _, other := range all {
			if other.ID != binding.ID && other.Session.Runtime != nil && *other.Session.Runtime == *binding.Session.Runtime {
				return stopRefused()
			}
		}
		pending, err = stopper.Request(ctx, expected, int(binding.PanePID), prove)
		return err
	})
	if err != nil {
		var failure *output.Failure
		if errors.As(err, &failure) {
			return failure
		}
		return stopTransportFailure(err)
	}
	if err := pending.Wait(ctx); err != nil {
		return stopTransportFailure(err)
	}
	if err := settleForeground(ctx, app.store, *binding); err != nil {
		return bindingFailure("IDENTITY_ERROR", "Could not mark the recorded agent ended; it may have already stopped.", 1)
	}
	stopped.Outcome = "already_ended"
	if pending.Signalled() {
		stopped.Outcome = "stopped"
	}
	return app.finishStop(ctx, inv.has("close"), stopped, *identity, binding)
}

func (app application) finishStop(ctx context.Context, closePane bool, stopped stopReport, identity core.Identity, binding *core.Binding) output.Report {
	if !closePane {
		return stopped
	}
	if binding == nil {
		stopped.Pane = "none"
		return stopped
	}
	if binding.Session.Runtime == nil || binding.Session.LaunchOwner == nil {
		return bindingFailure("RESUME_UNAVAILABLE", "The member has no recorded agent session, so its process cannot be proven; no agent was stopped.", 1)
	}
	kept := func(reason string) *output.Failure {
		return bindingFailure("PANE_NOT_CLOSED", fmt.Sprintf("%s's agent was stopped, but its pane was left open: %s. Close the pane yourself if you no longer need it.", identity.Name, reason), 1)
	}
	if app.tmux == nil || binding.Server.Host != "tmux" {
		return kept("its host cannot close a pane")
	}
	// EndLaunch changes these three fields. Use the exact settled projection
	// when the binding was originally read before stopping the agent.
	expected := *binding
	if expected.Session.RuntimeState == "running" {
		ended := "ended"
		expected.Session.RuntimeState = ended
		expected.Session.LastTransition = &ended
		expected.Session.PlainProgram = nil
	}
	var allowed bool
	err := app.store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		allowed, err = tx.Bindings().CanClosePane(expected, uint64(wallClock{}.NowMs()))
		return err
	})
	if err != nil || !allowed {
		return kept("the stopped binding could not be confirmed or has a pending launch")
	}
	client, err := app.tmux()
	if err != nil {
		return kept("the tmux host is not available")
	}
	// The store read has ended. The adapter rechecks the exact endpoint
	// and both Go ownership markers in tmux before targeting the pane.
	outcome, err := client.CloseOwnedPane(ctx, expected, identity)
	if err != nil {
		return kept("the tmux host could not close it safely")
	}
	switch outcome {
	case tmux.PaneClosed:
		stopped.Pane = "closed"
	case tmux.PaneGone:
		stopped.Pane = "gone"
	default:
		return kept("its host cannot say whether tmt-go opened that pane")
	}
	return stopped
}

func stopRefused() *output.Failure {
	return bindingFailure("RUNTIME_CONFLICT", "Could not verify a private main foreground for the recorded agent. Nothing was signalled.", 5)
}

func stopTransportFailure(err error) *output.Failure {
	switch {
	case errors.Is(err, verifiedstop.ErrUnverified):
		return bindingFailure("RUNTIME_CONFLICT", "Could not verify the recorded agent or confirm that it exited.", 5)
	case errors.Is(err, verifiedstop.ErrTimedOut):
		return bindingFailure("PROCESS_ERROR", "The agent did not conclusively exit within the stop allowance.", 1)
	default:
		return bindingFailure("PROCESS_ERROR", "Could not complete the verified stop.", 1)
	}
}
