package cli

import (
	"fmt"
	"io"
	"os"
	"slices"

	"github.com/tmt-ninja/tmt/go/internal/adapters/api"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

func (app application) runAPI(args []string, stdout, stderr io.Writer) int {
	var session, help, jsonOutput bool
	for _, arg := range args {
		switch arg {
		case "--session":
			if !session {
				session = true
				continue
			}
		case "--help", "-h":
			help = true
			continue
		case "--json":
			if !jsonOutput {
				jsonOutput = true
				continue
			}
		}
		return publish(stdout, stderr, &output.Failure{
			Code: "USAGE_ERROR", Message: fmt.Sprintf("Unexpected argument '%s' for 'api'.", arg), Status: 1,
		}, slices.Contains(args, "--json"))
	}
	if help {
		if err := renderHelp(stdout, []string{"api"}); err != nil {
			fmt.Fprintf(stderr, "error: %s\n", err)
			return 1
		}
		return 0
	}
	root, failure := adapterRoot()
	if failure != nil {
		return publish(stdout, stderr, failure, true)
	}
	server := api.Server{Root: root}
	if app.stdin == nil {
		fmt.Fprintln(stderr, "error: api requires stdin")
		return 1
	}
	var status int
	var err error
	if session {
		file, ok := stdout.(*os.File)
		if !ok {
			fmt.Fprintln(stderr, "error: api --session requires redirected stdout")
			return 1
		}
		status, err = server.ServeSession(app.stdin, file)
	} else {
		status, err = server.ServeOnce(app.stdin, stdout)
	}
	if err != nil {
		fmt.Fprintf(stderr, "error: %s\n", err)
		return 1
	}
	return status
}

func adapterRoot() (home.Root, *output.Failure) {
	userHome, err := os.UserHomeDir()
	if err != nil {
		return home.Root{}, &output.Failure{Code: "HOME_UNKNOWN", Message: err.Error(), Status: 1}
	}
	root, err := home.Resolve(os.LookupEnv, userHome)
	if err != nil {
		return home.Root{}, &output.Failure{Code: "NATIVE_ROOT_REFUSED", Message: err.Error(), Status: 2}
	}
	return root, nil
}
