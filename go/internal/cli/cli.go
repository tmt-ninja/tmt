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

	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// Version is injected at build time with -ldflags "-X .../cli.Version=...".
var Version = "0.0.0-go-dev"

// Main runs one invocation and returns the process exit status.
func Main(args []string, stdout, stderr io.Writer) int {
	return application{stdin: os.Stdin}.run(context.Background(), args, stdout, stderr)
}

type application struct {
	stdin    *os.File
	requests ports.RequestService
	store    ports.Store
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
	if _, err := home.Resolve(os.LookupEnv, userHome); err != nil {
		failure := &output.Failure{Code: "NATIVE_ROOT_REFUSED", Message: err.Error(), Status: 2}
		return output.Publish(stdout, stderr, failure, invocation.json)
	}
	if app.requests != nil {
		switch invocation.path[0] {
		case "reply", "result":
			return output.Publish(stdout, stderr, app.response(ctx, invocation), invocation.json)
		case "inbox", "answer":
			if app.store != nil {
				return output.Publish(stdout, stderr, app.incoming(ctx, invocation), invocation.json)
			}
		}
	}
	// NOT PORTED (#6938): open the real request store after its adapter lands,
	// and compose the remaining commands over the storage and host ports.
	failure := &output.Failure{
		Code: "NOT_PORTED", Message: fmt.Sprintf("Command '%s' is not yet ported.", strings.Join(invocation.path, " ")), Status: 2,
	}
	return output.Publish(stdout, stderr, failure, invocation.json)
}
