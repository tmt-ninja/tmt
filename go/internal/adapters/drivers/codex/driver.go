package codex

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// Driver prepares interactive Codex launches with an embedded runtime by default.
type Driver struct {
	Executable string
	// HookExecutable opts in after the caller has wired the Codex callbacks.
	HookExecutable string
}

var _ ports.Driver = Driver{}

func (Driver) Name() string { return "codex" }

func (d Driver) LaunchCommand(launch ports.AgentLaunch) (ports.ProcessSpec, error) {
	return d.launchCommand(launch, true)
}

// ChannelLaunchCommand prepares the same invocation settings for enrollment.
// The owned endpoint selects remote mode later, after it proves its identity.
func (d Driver) ChannelLaunchCommand(launch ports.AgentLaunch) (ports.ProcessSpec, error) {
	return d.launchCommand(launch, false)
}

func (d Driver) launchCommand(launch ports.AgentLaunch, embedded bool) (ports.ProcessSpec, error) {
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
	if embedded && embeddedByDefault(launch.Extra) {
		args = append(args, "--no-daemon")
	}
	// NOT PORTED (GO2-07, GO2-08, GO2-09, GO2-10): managed launch scope,
	// managed skills, callback wiring and qualified channel startup.
	command, err := drivers.Command(d.Name(), d.Executable, launch, append(args, launch.Extra...))
	if err == nil && d.HookExecutable != "" {
		// An unsupported provider config layer leaves the original launch intact.
		if composed, hookErr := AddLaunchHooks(command, d.HookExecutable); hookErr == nil {
			command = composed
		}
	}
	return command, err
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

var screenRules = drivers.ScreenRules{
	Prompts:   []string{"›", "› Ask Codex to do anything"},
	Busy:      regexp.MustCompile(`(?i)(?:^|[ (·•])esc to interrupt\)?$`),
	Questions: []string{"do you trust the contents of this directory?", "would you like to run the following command?"},
	Footer: func(line string) bool {
		return line == "? for shortcuts" || line == "← for agents · ? for shortcuts" ||
			(strings.Count(line, " · ") >= 2 && strings.Contains(line, " · Context "))
	},
}

func (Driver) Classify(screen ports.Screen) ports.DriverState {
	return drivers.ScreenState(screen, screenRules)
}

func (Driver) SubmitPlan(string) []ports.KeyStep { return drivers.Enter() }
