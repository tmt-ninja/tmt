package cli

import (
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/claude"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/codex"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/gemini"
	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type foregroundLaunch func(context.Context, home.Root, ports.Store, bindingEntry, runPlan, io.Writer, io.Writer) int

type runPlan struct {
	binding  bindingSelection
	provider string
	command  ports.ProcessSpec
	resume   *core.ResumeExpectation
}

func prepareRun(root home.Root, inv invocation) (runPlan, *output.Failure) {
	if inv.has("channel") {
		// NOT PORTED (CLI-23): Channel enrollment.
		return runPlan{}, bindingUnavailable("--channel")
	}
	if host := inv.options["host"]; host != "" && host != "tmux" {
		// NOT PORTED (CLI-25): Built-in and external launch hosts.
		return runPlan{}, bindingFailure("HOST_NOT_AVAILABLE", "The requested launch host is not available in "+flavor.Binary+".", 3)
	}
	if len(inv.operands) < 2 {
		// NOT PORTED (CLI-26): Bare provider and remembered launch selection.
		return runPlan{}, bindingUnavailable("run without an explicit agent command")
	}
	name, err := core.ValidateName(inv.operands[0])
	if err != nil {
		return runPlan{}, bindingRejected(err)
	}
	executable, err := exec.LookPath(inv.operands[1])
	if err != nil {
		return runPlan{}, bindingFailure("RUN_LAUNCH_FAILED", "Could not find the requested executable. No agent was launched.", 1)
	}
	var driver ports.Driver
	switch filepath.Base(inv.operands[1]) {
	case "claude":
		driver = claude.Driver{Executable: executable}
	case "codex":
		driver = codex.Driver{Executable: executable}
	case "gemini":
		driver = gemini.Driver{Executable: executable}
	default:
		// NOT PORTED (CLI-27): Arbitrary foreground programs and other managed drivers.
		return runPlan{}, bindingUnavailable("run with an unported agent or plain program")
	}
	dir, err := os.Getwd()
	if err != nil {
		return runPlan{}, bindingFailure("RUN_LAUNCH_FAILED", "Could not resolve the working directory. No agent was launched.", 1)
	}
	command, err := driver.LaunchCommand(ports.AgentLaunch{
		Name: name.DisplayName(), Dir: dir, HomeDir: root.Dir,
		Model: inv.options["model"], Effort: inv.options["effort"], Extra: inv.operands[2:],
	})
	if err != nil {
		return runPlan{}, bindingFailure("RUN_LAUNCH_FAILED", "Could not prepare the requested agent launch. No agent was launched.", 1)
	}

	return runPlan{
		binding: bindingSelection{name: name, save: inv.has("save")}, provider: driver.Name(), command: command,
	}, nil
}

func (app application) runProvider(ctx context.Context, root home.Root, inv invocation, stdout, stderr io.Writer) int {
	if inv.has("resume") {
		return app.runResume(ctx, root, inv, stdout, stderr)
	}
	plan, failure := prepareRun(root, inv)
	if failure != nil {
		return publish(stdout, stderr, failure, false)
	}
	if app.launch == nil {
		// Production supplies the foreground launcher at startup.
		return publish(stdout, stderr, bindingUnavailable("foreground runtime admission"), false)
	}

	bindings := newBindingCLI(app.store, app.caller.lookup)
	claim, failure := bindings.callerClaim()
	if failure != nil {
		return publish(stdout, stderr, failure, false)
	}
	store := app.store
	if store == nil {
		opened, err := storage.Open(ctx, root)
		if err != nil {
			failure := bindingFailure("IDENTITY_ERROR", "Could not access launch identity state.", 1)
			return publish(stdout, stderr, failure, false)
		}
		defer func() {
			if err := opened.Close(); err != nil {
				_ = warn(stderr, "could not close launch state cleanly; inspect identity status before retrying")
			}
		}()
		store = opened
	}
	bindings.store = store
	entry, failure := bindings.bind(ctx, claim.pane, claim.serverPID, plan.binding)
	if failure != nil {
		return publish(stdout, stderr, failure, false)
	}
	return app.launch(ctx, root, store, entry, plan, stdout, stderr)
}
