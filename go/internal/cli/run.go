package cli

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/claude"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/codex"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/gemini"
	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/invoke"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type foregroundLaunch func(context.Context, home.Root, ports.Store, bindingEntry, runPlan, io.Writer, io.Writer) int

type runPlan struct {
	binding  bindingSelection
	provider string
	command  ports.ProcessSpec
}

func prepareRun(root home.Root, inv invocation) (runPlan, *output.Failure) {
	if inv.has("resume") || inv.has("channel") {
		// NOT PORTED (#6938): remembered session resume and channel enrollment.
		return runPlan{}, bindingUnavailable("--resume/--channel")
	}
	if host := inv.options["host"]; host != "" && host != "tmux" {
		// NOT PORTED (#6938): built-in and external launch hosts.
		return runPlan{}, bindingFailure("HOST_NOT_AVAILABLE", "The requested launch host is not available in tmt-go.", 3)
	}
	if len(inv.operands) < 2 {
		// NOT PORTED (#6938): unnamed and remembered/configured launch selection.
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
		// NOT PORTED (#6938): arbitrary foreground programs and other managed drivers.
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
	coreExecutable, err := os.Executable()
	if err != nil {
		return runPlan{}, bindingFailure("RUN_LAUNCH_FAILED", "Could not resolve the tmt-go executable. No agent was launched.", 1)
	}
	command.Env = invoke.OverlayEnv(command.Env, []string{"TMT_EXECUTABLE=" + coreExecutable})
	return runPlan{
		binding: bindingSelection{name: name, save: inv.has("save")}, provider: driver.Name(), command: command,
	}, nil
}

func (app application) runProvider(ctx context.Context, root home.Root, inv invocation, stdout, stderr io.Writer) int {
	plan, failure := prepareRun(root, inv)
	if failure != nil {
		return output.Publish(stdout, stderr, failure, false)
	}
	if app.launch == nil {
		// NOT PORTED (#6938): foreground launch and runtime admission.
		return output.Publish(stdout, stderr, bindingUnavailable("foreground runtime admission"), false)
	}

	bindings := newBindingCLI(app.store, app.caller.lookup)
	claim, failure := bindings.callerClaim()
	if failure != nil {
		return output.Publish(stdout, stderr, failure, false)
	}
	store := app.store
	if store == nil {
		opened, err := storage.Open(ctx, root)
		if err != nil {
			failure := bindingFailure("IDENTITY_ERROR", "Could not access launch identity state.", 1)
			return output.Publish(stdout, stderr, failure, false)
		}
		defer func() {
			if err := opened.Close(); err != nil {
				fmt.Fprintln(stderr, "warning: could not close launch state cleanly; inspect identity status before retrying")
			}
		}()
		store = opened
	}
	bindings.store = store
	entry, failure := bindings.bind(ctx, claim.pane, claim.serverPID, plan.binding)
	if failure != nil {
		return output.Publish(stdout, stderr, failure, false)
	}
	return app.launch(ctx, root, store, entry, plan, stdout, stderr)
}
