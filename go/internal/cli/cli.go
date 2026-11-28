// Package cli is the application layer, the Go port of rust/crates/tmt-cli:
// the grammar registry, typed invocations and use-case composition over ports.
// Owner: go-3. cmd/tmt-go calls Main only.
package cli

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"

	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// Version is injected at build time with -ldflags "-X .../cli.Version=...".
var Version = "0.0.0-go-dev"

// Main runs one invocation and returns the process exit status.
func Main(args []string, stdout, stderr io.Writer) int {
	return systemApplication().run(context.Background(), args, stdout, stderr)
}

func systemApplication() application {
	client := sync.OnceValues(newTmuxClient)
	app := application{
		stdin:  os.Stdin,
		caller: systemCaller(client),
		tmux:   client,
		live:   systemLiveTalkHost(client),
	}
	app.launch = app.launchForeground
	return app
}

type application struct {
	stdin    *os.File
	requests ports.RequestService
	store    ports.Store
	caller   callerSelector
	live     liveTalkHost
	tmux     func() (tmux.Client, error)
	launch   foregroundLaunch
}

func (app application) run(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if status, handled := app.runAdapterCommand(args, stdout, stderr); handled {
		return status
	}
	invocation, failure := parse(args)
	if failure != nil {
		return publish(stdout, stderr, failure, invocation.json)
	}
	var err error
	switch {
	case invocation.help:
		err = renderHelp(stdout, invocation.path)
	case invocation.version:
		_, err = fmt.Fprintf(stdout, flavor.Binary+" %s\n", Version)
	case invocation.path[0] == "learn":
		err = writeLearn(stdout, invocation)
	case invocation.path[0] == "__completion-script":
		err = writeCompletionScript(stdout, invocation.operands[0])
	case invocation.path[0] == "__complete":
		err = writeCompletionCandidates(stdout, invocation.operands)
	default:
		return app.execute(ctx, invocation, stdout, stderr)
	}
	if err != nil {
		fmt.Fprintf(stderr, "error: Could not write CLI output: %s\n", err)
		return 1
	}
	return 0
}

func (app application) execute(ctx context.Context, invocation invocation, stdout, stderr io.Writer) int {
	userHome, err := os.UserHomeDir()
	if err != nil {
		failure := &output.Failure{Code: "HOME_UNKNOWN", Message: err.Error(), Status: 1}
		return publish(stdout, stderr, failure, invocation.json)
	}
	root, err := home.Resolve(os.LookupEnv, userHome)
	if err != nil {
		failure := &output.Failure{Code: "NATIVE_ROOT_REFUSED", Message: err.Error(), Status: 2}
		return publish(stdout, stderr, failure, invocation.json)
	}
	switch invocation.path[0] {
	case "orch":
		return publish(stdout, stderr, runOrch(ctx, root, invocation), invocation.json)
	case "storage":
		return publish(stdout, stderr, runStorage(ctx, root), invocation.json)
	case "extension":
		if len(invocation.path) == 2 && invocation.path[1] == "ls" {
			return publish(stdout, stderr, listExtensions(invocation, os.Getenv("PATH")), invocation.json)
		}
	case "driver":
		if len(invocation.path) == 2 && invocation.path[1] == "ls" {
			return publish(stdout, stderr, listDrivers(root), invocation.json)
		}
	case "host":
		if len(invocation.path) == 2 && invocation.path[1] == "templates" {
			return publish(stdout, stderr, listHostTemplates(root, os.LookupEnv), invocation.json)
		}
	case "completion":
		return publish(stdout, stderr, inspectCompletion(invocation, os.LookupEnv), invocation.json)
	case "init":
		return publish(stdout, stderr, initializeWorkspace(root), invocation.json)
	case "config":
		return publish(stdout, stderr, runConfig(ctx, root, invocation), invocation.json)
	case "identity":
		return publish(stdout, stderr, app.runIdentity(ctx, root, invocation), invocation.json)
	case "notes":
		return publish(stdout, stderr, app.runNotes(ctx, root, invocation), invocation.json)
	case "role", "preamble":
		return publish(stdout, stderr, app.runProfile(ctx, root, invocation), invocation.json)
	case "reply", "result", "inbox", "answer", "x", "talk", "send-now":
		return publish(stdout, stderr, app.runRequest(ctx, root, invocation), invocation.json)
	case "check":
		return publish(stdout, stderr, app.check(ctx, root, invocation), invocation.json)
	case "focus":
		return publish(stdout, stderr, app.runFocus(ctx, root, invocation), invocation.json)
	case "stop":
		return publish(stdout, stderr, app.runStop(ctx, root, invocation), invocation.json)
	case "unbind":
		return publish(stdout, stderr, app.runUnbind(ctx, root), invocation.json)
	case "discover":
		return publish(stdout, stderr, app.runDiscover(ctx, root, invocation), invocation.json)
	case "marked":
		return publish(stdout, stderr, app.runMarked(ctx, root, invocation), invocation.json)
	case "add", "name", "rm", "mv", "whoami", "ls":
		return publish(stdout, stderr, app.runBinding(ctx, root, invocation), invocation.json)
	case "resume":
		return app.runResume(ctx, root, invocation, stdout, stderr)
	case "run":
		return app.runProvider(ctx, root, invocation, stdout, stderr)
	case "__hook":
		return publish(stdout, stderr, app.runHook(ctx, root, invocation), invocation.json)
	}
	// NOT PORTED (CLI-07, CLI-24,
	// CLI-30, CLI-31, CLI-32, CLI-33, CLI-34, CLI-35, CLI-36, CLI-37, CLI-38,
	// CLI-39, CLI-41, CLI-42, CLI-47, CLI-48, CLI-49):
	// Remaining public commands and internal entry points.
	failure := &output.Failure{
		Code: "NOT_PORTED", Message: fmt.Sprintf("Command '%s' is not yet ported.", strings.Join(invocation.path, " ")), Status: 2,
	}
	return publish(stdout, stderr, failure, invocation.json)
}
