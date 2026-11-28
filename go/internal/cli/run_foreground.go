//go:build darwin || linux

package cli

import (
	"context"
	"errors"
	"io"
	"math"
	"os"
	"os/exec"
	"os/signal"
	"reflect"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/codex"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const foregroundStartupBudget = 3 * time.Second

func (app application) launchForeground(ctx context.Context, root home.Root, store ports.Store,
	entry bindingEntry, plan runPlan, stdout, stderr io.Writer,
) int {
	app.store = store
	if entry.binding == nil || entry.identity == nil || app.tmux == nil {
		return publish(stdout, stderr, bindingUnverified(), false)
	}
	client, err := app.tmux()
	if err != nil {
		return publish(stdout, stderr, bindingUnverified(), false)
	}
	pane := ports.PaneRef{Server: entry.binding.Server.Socket, PaneID: entry.binding.PaneID}
	probe, err := client.ProbeBinding(ctx, pane)
	if state, _ := core.EvaluateBinding(*entry.identity, entry.binding, probe); err != nil || state != core.BindingActive {
		return publish(stdout, stderr, bindingUnverified(), false)
	}

	command, intent, err := app.prepareHookLaunchWithResume(ctx, root, *entry.binding, plan.provider, plan.command, true, plan.resume)
	if err != nil || intent == nil {
		var typed *core.RequestFailure
		if errors.As(err, &typed) && typed != nil {
			return publish(stdout, stderr, resumeOutputFailure(typed), false)
		}
		if plan.resume != nil && (err == nil || errors.Is(err, errHookLaunchChanged)) {
			return publish(stdout, stderr, resumeConflict(), false)
		}
		failure := bindingFailure("RUN_LAUNCH_FAILED", "Could not prepare the provider launch intent. No agent was launched.", 1)
		return publish(stdout, stderr, failure, false)
	}
	var npmLauncher *codex.NpmLauncher
	var inspectionErr error
	if intent.Driver == core.DriverCodex {
		npmLauncher, inspectionErr = codex.InspectNpmLauncher(command)
	}
	// Keep the child in the invoking shell's foreground process group. The
	// terminal delivers Ctrl-C to the group, and the CLI waits for the child
	// to provide the command's exit status. Ctrl-Z and fg keep shell control.
	interrupts := make(chan os.Signal, 1)
	signal.Notify(interrupts, os.Interrupt)
	defer signal.Stop(interrupts)
	if err := ctx.Err(); err != nil {
		return publish(stdout, stderr, bindingFailure("INTERRUPTED", "Interrupted before launching the agent.", 1), false)
	}
	child := exec.Command(command.Path, command.Args...)
	child.Dir, child.Env = command.Dir, command.Env
	child.Stdin, child.Stdout, child.Stderr = app.stdin, stdout, stderr
	if err := child.Start(); err != nil {
		failure := bindingFailure("RUN_LAUNCH_FAILED", "Could not start the requested provider. No agent was launched.", 1)
		return publish(stdout, stderr, failure, false)
	}
	exited := make(chan error, 1)
	go func() { exited <- child.Wait() }()
	observer := runtime.Observer{Process: client.Process}
	startup, cancel := context.WithTimeout(ctx, foregroundStartupBudget)
	tick := time.NewTicker(25 * time.Millisecond)
	defer tick.Stop()
	defer cancel()
	var admitted *core.Binding
	var admissionFailure *output.Failure
	// An invalid npm shim still runs, without any path to direct admission.
	for inspectionErr == nil && startup.Err() == nil {
		select {
		case err := <-exited:
			return foregroundExit(err)
		default:
		}
		main := app.observeForeground(startup, observer, entry, pane, child.Process.Pid, intent, npmLauncher)
		if main.PID != 0 {
			select {
			case err := <-exited:
				return foregroundExit(err)
			default:
			}
			var err error
			admitted, err = app.admitHookLaunch(startup, root, intent, main)
			if plan.resume != nil && admitted == nil {
				admissionFailure = resumeAdmissionFailure(err)
			}
			break
		}
		select {
		case err := <-exited:
			return foregroundExit(err)
		case <-startup.Done():
		case <-tick.C:
		}
	}
	cancel()
	tick.Stop()
	if admitted == nil && admissionFailure == nil {
		_ = warn(stderr, "command started, but runtime ownership could not be recorded; automatic delivery is not established")
	}
	waited := <-exited
	if admissionFailure != nil {
		return publish(stdout, stderr, admissionFailure, false)
	}
	if admitted != nil && child.ProcessState != nil {
		if err := settleReapedForeground(ctx, store, *admitted, child.Process.Pid, observer.Observe); err != nil {
			_ = warn(stderr, "could not settle the exited runtime; inspect identity status before retrying")
		}
	}
	return foregroundExit(waited)
}

// Wait proves only the process we started exited. A distinct provider needs
// its own Gone observation before attempting the binding write.
func settleReapedForeground(ctx context.Context, store ports.Store, binding core.Binding, launchedPID int,
	observe func(context.Context, int) (runtime.Observation, error),
) error {
	recorded := binding.Session.Runtime
	if recorded != nil && recorded.PID != uint64(launchedPID) {
		if recorded.PID > math.MaxInt32 {
			return nil
		}
		expected := runtime.Incarnation{PID: int(recorded.PID), Start: recorded.StartIdentity}
		proof, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Second)
		defer cancel()
		state, err := observe(proof, expected.PID)
		if err != nil || proof.Err() != nil || state.Match(expected) != runtime.Gone {
			return nil
		}
	}
	return settleForeground(ctx, store, binding)
}

func settleForeground(ctx context.Context, store ports.Store, binding core.Binding) error {
	session := binding.Session
	if session.LaunchOwner == nil || session.Runtime == nil {
		return errors.New("admitted foreground lacks recorded incarnations")
	}
	finish, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	return store.Write(finish, func(tx ports.StoreTx) error {
		repo := tx.Bindings()
		expected := binding
		if session.ProviderSessionID == nil && session.PlainProgram == nil {
			current, err := repo.FindByIdentity(binding.IdentityID)
			if err != nil {
				return err
			}
			// Accept exactly the enrichment from late provider admission.
			if current != nil && current.Session.ProviderSessionID != nil && current.Session.LastTransition != nil &&
				(*current.Session.LastTransition == "started" || *current.Session.LastTransition == "resumed") {
				enriched := binding
				enriched.Session.ProviderSessionID = current.Session.ProviderSessionID
				enriched.Session.LastTransition = current.Session.LastTransition
				if reflect.DeepEqual(enriched, *current) {
					expected = enriched
				}
			}
		}
		_, err := repo.EndLaunch(ports.LaunchEnd{
			Expected: expected, Owner: *session.LaunchOwner, Runtime: *session.Runtime,
			ObservedAtMs: uint64(wallClock{}.NowMs()),
		})
		return err
	})
}

func (app application) observeForeground(ctx context.Context, observer runtime.Observer, entry bindingEntry,
	pane ports.PaneRef, child int, intent *hookLaunchIntent, npmLauncher *codex.NpmLauncher,
) core.ProcessIncarnation {
	if app.caller.probe == nil {
		return core.ProcessIncarnation{}
	}
	observed, err := observer.Observe(ctx, child)
	if err != nil || observed.State != runtime.Alive || observed.Incarnation.PID != child || !observed.Incarnation.Valid() {
		return core.ProcessIncarnation{}
	}
	probe, err := app.caller.probe(ctx, pane)
	if err != nil {
		return core.ProcessIncarnation{}
	}
	launcher := core.ProcessIncarnation{PID: uint64(child), StartIdentity: observed.Incarnation.Start}
	if npmLauncher != nil {
		provider, err := npmLauncher.ProveForeground(ctx, observer, *entry.identity, *entry.binding, probe, intent.Owner, launcher)
		if err != nil || provider.Name != string(intent.Driver) || !provider.Incarnation.Valid() {
			return core.ProcessIncarnation{}
		}
		return core.ProcessIncarnation{PID: uint64(provider.Incarnation.PID), StartIdentity: provider.Incarnation.Start}
	}
	proven, err := observer.ProveLaunchChild(ctx, *entry.identity, *entry.binding, probe, launcher, intent.Driver)
	if err != nil || !proven {
		return core.ProcessIncarnation{}
	}
	return launcher
}

func foregroundExit(err error) int {
	if err == nil {
		return 0
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() >= 0 {
		return exit.ExitCode()
	}
	// NOT PORTED (CLI-28): Signal-specific foreground exit status.
	return 1
}
