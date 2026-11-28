package claude

import (
	"errors"
	"regexp"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// Driver prepares interactive Claude Code launches.
type Driver struct {
	Executable string // explicit CLI path, or search PATH when empty
	// HookExecutable opts in to per-launch lifecycle hooks once the caller
	// has a tmt-go executable with the callback wired.
	HookExecutable string
}

var _ ports.Driver = Driver{}

func (Driver) Name() string { return "claude" }

func (d Driver) LaunchCommand(launch ports.AgentLaunch) (ports.ProcessSpec, error) {
	var args []string
	if launch.Resume != "" {
		if !drivers.ExactSession(launch.Resume) {
			return ports.ProcessSpec{}, errors.New("Claude resume requires an exact session UUID")
		}
		args = append(args, "--resume", launch.Resume)
	}
	if launch.Model != "" {
		args = append(args, "--model", launch.Model)
	}
	if launch.Effort != "" {
		args = append(args, "--effort", launch.Effort)
	}
	args = append(args, launch.Extra...)
	if d.HookExecutable != "" {
		var err error
		args, err = withHooks(args, d.HookExecutable)
		if err != nil {
			return ports.ProcessSpec{}, err
		}
	}
	// NOT PORTED (GO2-04, GO2-06): Digest continuation and native channel
	// enrollment with a verified binding and launch owner.
	return drivers.Command(d.Name(), d.Executable, launch, args)
}

var screenRules = drivers.ScreenRules{
	Prompts:   []string{"❯"},
	Busy:      regexp.MustCompile(`(?i)(?:^|[ (·•])esc to interrupt(?:[,·•].*)?\)?$`),
	Questions: []string{"do you want to proceed?", "would you like to proceed?", "do you want to make this edit"},
	Footer: func(line string) bool {
		return line == "? for shortcuts" || strings.HasPrefix(line, "⏵⏵ ")
	},
}

func (Driver) Classify(screen ports.Screen) ports.DriverState {
	return drivers.ScreenState(screen, screenRules)
}

func (Driver) SubmitPlan(string) []ports.KeyStep { return drivers.Enter() }
