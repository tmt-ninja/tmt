// Package cli is the application layer, the Go port of rust/crates/tmt-cli:
// the grammar registry, typed invocations and use-case composition over ports.
// Owner: go-3. cmd/tmt-go calls Main only.
package cli

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

// Version is injected at build time with -ldflags "-X .../cli.Version=...".
var Version = "0.0.0-go-dev"

// Main runs one invocation and returns the process exit status.
func Main(args []string, stdout, stderr io.Writer) int {
	invocation, failure := parse(args)
	if failure != nil {
		return failure.Publish(stdout, stderr, invocation.json)
	}
	var err error
	switch {
	case invocation.help:
		err = renderHelp(stdout, invocation.path)
	case invocation.version:
		_, err = fmt.Fprintf(stdout, "tmt-go %s\n", Version)
	default:
		return execute(invocation, stdout, stderr)
	}
	if err != nil {
		fmt.Fprintf(stderr, "error: Could not write CLI output: %s\n", err)
		return 1
	}
	return 0
}

func execute(invocation invocation, stdout, stderr io.Writer) int {
	userHome, err := os.UserHomeDir()
	if err != nil {
		failure := &output.Failure{Code: "HOME_UNKNOWN", Message: err.Error(), Status: 1}
		return failure.Publish(stdout, stderr, invocation.json)
	}
	if _, err := home.Resolve(os.LookupEnv, userHome); err != nil {
		failure := &output.Failure{Code: "NATIVE_ROOT_REFUSED", Message: err.Error(), Status: 2}
		return failure.Publish(stdout, stderr, invocation.json)
	}
	// NOT PORTED (#6938): command execution over the storage and host ports.
	failure := &output.Failure{
		Code: "NOT_PORTED", Message: fmt.Sprintf("Command '%s' is not yet ported.", strings.Join(invocation.path, " ")), Status: 2,
	}
	return failure.Publish(stdout, stderr, invocation.json)
}
