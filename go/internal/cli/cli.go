// Package cli is the application layer, the Go port of rust/crates/tmt-cli:
// the grammar registry, typed invocations and use-case composition over ports.
// Owner: go-3. cmd/tmt-go calls Main only.
package cli

import (
	"fmt"
	"io"
	"os"

	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

// Version is injected at build time with -ldflags "-X .../cli.Version=...".
var Version = "0.0.0-go-dev"

// Main runs one invocation and returns the process exit status.
func Main(args []string, stdout, stderr io.Writer) int {
	userHome, err := os.UserHomeDir()
	if err != nil {
		output.WriteFailure(stderr, &output.Failure{Code: "HOME_UNKNOWN", Message: err.Error()}, false)
		return 1
	}
	root, err := home.Resolve(os.LookupEnv, userHome)
	if err != nil {
		output.WriteFailure(stderr, &output.Failure{Code: "NATIVE_ROOT_REFUSED", Message: err.Error()}, false)
		return 2
	}
	_ = root
	if len(args) > 0 && (args[0] == "--version" || args[0] == "-V") {
		fmt.Fprintf(stdout, "tmt-go %s\n", Version)
		return 0
	}
	fmt.Fprintln(stderr, "tmt-go: no commands are ported yet")
	return 2
}
