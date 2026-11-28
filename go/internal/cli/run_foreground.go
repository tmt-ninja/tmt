//go:build darwin || linux

package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"time"

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
		return output.Publish(stdout, stderr, bindingUnverified(), false)
	}
	client, err := app.tmux()
	if err != nil {
		return output.Publish(stdout, stderr, bindingUnverified(), false)
	}
	pane := ports.PaneRef{Server: entry.binding.Server.Socket, PaneID: entry.binding.PaneID}
	probe, err := client.ProbeBinding(ctx, pane)
	if state, _ := core.EvaluateBinding(*entry.identity, entry.binding, probe); err != nil || state != core.BindingActive {
		return output.Publish(stdout, stderr, bindingUnverified(), false)
	}

	command, intent, err := app.prepareHookLaunch(ctx, root, *entry.binding, plan.provider, plan.command, true)
	if err != nil || intent == nil {
		failure := bindingFailure("RUN_LAUNCH_FAILED", "Could not prepare the provider launch intent. No agent was launched.", 1)
		return output.Publish(stdout, stderr, failure, false)
	}
	// Keep the child in the invoking shell's foreground process group. The
	// terminal delivers Ctrl-C to the group, and the CLI waits for the child
	// to provide the command's exit status. Ctrl-Z and fg keep shell control.
	interrupts := make(chan os.Signal, 1)
	signal.Notify(interrupts, os.Interrupt)
	defer signal.Stop(interrupts)
	if err := ctx.Err(); err != nil {
		return output.Publish(stdout, stderr, bindingFailure("INTERRUPTED", "Interrupted before launching the agent.", 1), false)
	}
	child := exec.Command(command.Path, command.Args...)
	child.Dir, child.Env = command.Dir, command.Env
	child.Stdin, child.Stdout, child.Stderr = app.stdin, stdout, stderr
	if err := child.Start(); err != nil {
		failure := bindingFailure("RUN_LAUNCH_FAILED", "Could not start the requested provider. No agent was launched.", 1)
		return output.Publish(stdout, stderr, failure, false)
	}
	exited := make(chan error, 1)
	go func() { exited <- child.Wait() }()
	observer := runtime.Observer{Process: client.Process}
	startup, cancel := context.WithTimeout(ctx, foregroundStartupBudget)
	tick := time.NewTicker(25 * time.Millisecond)
	defer tick.Stop()
	defer cancel()
	var admitted *core.Binding
	for startup.Err() == nil {
		select {
		case err := <-exited:
			return foregroundExit(err)
		default:
		}
		main := app.observeForeground(startup, observer, entry, pane, child.Process.Pid, intent.Driver)
		if main.PID != 0 {
			select {
			case err := <-exited:
				return foregroundExit(err)
			default:
			}
			admitted, _ = app.admitHookLaunch(startup, root, intent, main)
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
	if admitted == nil {
		fmt.Fprintln(stderr, "warning: command started, but runtime ownership could not be recorded; automatic delivery is not established")
	}
	waited := <-exited
	if admitted != nil && child.ProcessState != nil {
		if err := settleForeground(ctx, store, *admitted); err != nil {
			fmt.Fprintln(stderr, "warning: could not settle the exited runtime; inspect identity status before retrying")
		}
	}
	return foregroundExit(waited)
}

func settleForeground(ctx context.Context, store ports.Store, binding core.Binding) error {
	session := binding.Session
	if session.LaunchOwner == nil || session.Runtime == nil {
		return errors.New("admitted foreground lacks recorded incarnations")
	}
	finish, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	return store.Write(finish, func(tx ports.StoreTx) error {
		_, err := tx.Bindings().EndLaunch(ports.LaunchEnd{
			Expected: binding, Owner: *session.LaunchOwner, Runtime: *session.Runtime,
			ObservedAtMs: uint64(wallClock{}.NowMs()),
		})
		return err
	})
}

func (app application) observeForeground(ctx context.Context, observer runtime.Observer, entry bindingEntry,
	pane ports.PaneRef, child int, driver core.DriverName,
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
	main := core.ProcessIncarnation{PID: uint64(child), StartIdentity: observed.Incarnation.Start}
	proven, err := observer.ProveLaunchChild(ctx, *entry.identity, *entry.binding, probe, main, driver)
	if err != nil || !proven {
		return core.ProcessIncarnation{}
	}
	return main
}

func foregroundExit(err error) int {
	if err == nil {
		return 0
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() >= 0 {
		return exit.ExitCode()
	}
	// NOT PORTED (#6938): signal-specific foreground exit status.
	return 1
}
