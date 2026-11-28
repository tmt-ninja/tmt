package codex

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// Driver prepares interactive Codex launches with an embedded runtime by default.
type Driver struct {
	Executable string
}

var _ ports.Driver = Driver{}

func (Driver) Name() string { return "codex" }

func (d Driver) LaunchCommand(launch ports.AgentLaunch) (ports.ProcessSpec, error) {
	var args []string
	if launch.Resume != "" {
		if !drivers.ExactSession(launch.Resume) {
			return ports.ProcessSpec{}, errors.New("Codex resume requires an exact thread UUID")
		}
		args = append(args, "resume")
	}
	if launch.Model != "" {
		args = append(args, "-m", launch.Model)
	}
	if launch.Effort != "" {
		// Encode the value as a quoted TOML basic string rather than inserting
		// caller text into the provider configuration expression.
		effort, err := json.Marshal(launch.Effort)
		if err != nil {
			return ports.ProcessSpec{}, err
		}
		args = append(args, "-c", "model_reasoning_effort="+string(effort))
	}
	if launch.Resume != "" {
		args = append(args, launch.Resume)
	}
	if embeddedByDefault(launch.Extra) {
		args = append(args, "--no-daemon")
	}
	// NOT PORTED (#6938): the managed write grant and settings-derived scope,
	// invocation-only hook/skill files and qualified channel startup.
	return drivers.Command(d.Name(), d.Executable, launch, append(args, launch.Extra...))
}

func embeddedByDefault(extra []string) bool {
	for i := 0; i < len(extra); i++ {
		arg := extra[i]
		if arg == "--" {
			break
		}
		flag, _, inline := strings.Cut(arg, "=")
		switch flag {
		case "--remote", "--no-daemon":
			return false
		case "-c", "--config", "--enable", "--disable", "-m", "--model",
			"-s", "--sandbox", "-a", "--ask-for-approval", "-C", "--cd",
			"-p", "--profile", "--local-provider", "--remote-auth-token-env",
			"-i", "--image", "--add-dir":
			if !inline {
				i++
			}
		case "app-server", "agents", "exec", "e", "review", "login", "logout",
			"mcp", "plugin", "remote-control", "app", "completion", "update",
			"doctor", "sandbox", "debug", "apply", "a", "queue", "archive",
			"delete", "migrate-rollouts", "unarchive", "cloud", "exec-server",
			"features", "help":
			return false
		default:
			if !strings.HasPrefix(arg, "-") {
				return true // First positional prompt; further words are not options.
			}
		}
	}
	return true
}

func (Driver) Classify(screen ports.Screen) ports.DriverState {
	return drivers.ScreenState(screen, "›", []string{"esc to interrupt"},
		[]string{"do you trust the contents of this directory?", "would you like to run the following command?"})
}

func (Driver) SubmitPlan(string) []ports.KeyStep { return drivers.Enter() }
