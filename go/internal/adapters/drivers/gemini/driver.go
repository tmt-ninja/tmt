package gemini

import (
	"errors"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// Driver prepares Gemini's basic foreground launch.
type Driver struct {
	Executable string
}

var _ ports.Driver = Driver{}

func (Driver) Name() string { return "gemini" }

func (d Driver) LaunchCommand(launch ports.AgentLaunch) (ports.ProcessSpec, error) {
	if launch.Resume != "" || launch.Effort != "" {
		return ports.ProcessSpec{}, errors.New("the Gemini driver does not support managed resume or reasoning effort")
	}
	var args []string
	if launch.Model != "" {
		args = append(args, "--model", launch.Model)
	}
	// NOT PORTED (#6938): launch-only Gemini skill discovery has no
	// qualified adapter; the native basic driver uses a global skill root.
	return drivers.Command(d.Name(), d.Executable, launch, append(args, launch.Extra...))
}

func (Driver) Classify(screen ports.Screen) ports.DriverState {
	return drivers.ScreenState(screen, ">", []string{"esc to cancel"},
		[]string{"do you trust the files in this folder?", "allow execution of:"})
}

func (Driver) SubmitPlan(string) []ports.KeyStep { return drivers.Enter() }
