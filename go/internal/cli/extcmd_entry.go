package cli

import (
	"io"
	"os"
	"slices"

	"github.com/tmt-ninja/tmt/go/internal/adapters/extcmd"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

// NOT PORTED (CLI-43): External help-tail rewriting and root-prefix diagnostics.
func (app application) runAdapterCommand(args []string, stdout, stderr io.Writer) (int, bool) {
	if len(args) == 0 {
		return 0, false
	}
	if args[0] == "api" {
		return app.runAPI(args[1:], stdout, stderr), true
	}
	if slices.Equal(args, []string{"help", "api"}) {
		return app.runAPI([]string{"--help"}, stdout, stderr), true
	}
	if grammar.child(args[0]) != nil {
		return 0, false
	}
	path, err := extcmd.Resolve(args[0], os.Getenv("PATH"))
	if err == nil && path == "" {
		return 0, false
	}
	if err == nil {
		root, failure := adapterRoot()
		if failure != nil {
			return publish(stdout, stderr, failure, slices.Contains(args[1:], "--json")), true
		}
		err = extcmd.Execute(path, args[1:], root)
	}
	failure := &output.Failure{Code: "EXTENSION_EXEC_FAILED", Message: err.Error(), Status: 1}
	return publish(stdout, stderr, failure, slices.Contains(args[1:], "--json")), true
}
