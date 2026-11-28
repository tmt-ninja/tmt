package claude

import (
	"errors"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// Driver prepares interactive Claude Code launches.
type Driver struct {
	Executable string // explicit CLI path, or search PATH when empty
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
	// NOT PORTED (#6938): invocation-scoped hooks and managed skill injection
	// require hook callbacks and a qualified invocation plan. Native channel
	// enrollment additionally needs a verified binding and launch owner.
	return drivers.Command(d.Name(), d.Executable, launch, append(args, launch.Extra...))
}

func (Driver) Classify(screen ports.Screen) ports.DriverState {
	return drivers.ScreenState(screen, "❯", []string{"esc to interrupt"},
		[]string{"do you want to proceed?", "would you like to proceed?", "do you want to make this edit"})
}

func (Driver) SubmitPlan(string) []ports.KeyStep { return drivers.Enter() }
