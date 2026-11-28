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
	return application{
		stdin:  os.Stdin,
		caller: systemCaller(client),
		tmux:   client,
		live:   systemLiveTalkHost(client),
	}
}

type application struct {
	stdin    *os.File
	requests ports.RequestService
	store    ports.Store
	caller   callerSelector
	live     liveTalkHost
	tmux     func() (tmux.Client, error)
}

func (app application) run(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	invocation, failure := parse(args)
	if failure != nil {
		return output.Publish(stdout, stderr, failure, invocation.json)
	}
	var err error
	switch {
	case invocation.help:
		err = renderHelp(stdout, invocation.path)
	case invocation.version:
		_, err = fmt.Fprintf(stdout, "tmt-go %s\n", Version)
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
		return output.Publish(stdout, stderr, failure, invocation.json)
	}
	root, err := home.Resolve(os.LookupEnv, userHome)
	if err != nil {
		failure := &output.Failure{Code: "NATIVE_ROOT_REFUSED", Message: err.Error(), Status: 2}
		return output.Publish(stdout, stderr, failure, invocation.json)
	}
	switch invocation.path[0] {
	case "reply", "result", "inbox", "answer", "x", "talk":
		return output.Publish(stdout, stderr, app.runRequest(ctx, root, invocation), invocation.json)
	case "check":
		return output.Publish(stdout, stderr, app.check(ctx, root, invocation), invocation.json)
	case "__hook":
		return output.Publish(stdout, stderr, app.runHook(ctx, root, invocation), invocation.json)
	}
	// NOT PORTED (#6938): compose the remaining commands over storage and host ports.
	failure := &output.Failure{
		Code: "NOT_PORTED", Message: fmt.Sprintf("Command '%s' is not yet ported.", strings.Join(invocation.path, " ")), Status: 2,
	}
	return output.Publish(stdout, stderr, failure, invocation.json)
}
