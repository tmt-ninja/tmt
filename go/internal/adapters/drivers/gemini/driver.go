package gemini

import (
	"errors"
	"regexp"
	"strings"

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
	// NOT PORTED (GO2-03): launch-only Gemini skill discovery has no
	// qualified adapter; the native basic driver uses a global skill root.
	return drivers.Command(d.Name(), d.Executable, launch, append(args, launch.Extra...))
}

var screenRules = drivers.ScreenRules{
	Prompts:   []string{">", "> Type your message or @path/to/file", "* Type your message or @path/to/file"},
	Busy:      regexp.MustCompile(`(?i)(?:^|[ (·•])esc to cancel(?:, [0-9][0-9hms ]*)?\)?$`),
	Questions: []string{"do you trust the files in this folder?", "allow execution of:"},
	Footer: func(line string) bool {
		return line == "? for shortcuts" || strings.Contains(line, "/model ") ||
			(strings.Contains(line, "gemini-") && strings.HasSuffix(line, "% context left)"))
	},
}

func (Driver) Classify(screen ports.Screen) ports.DriverState {
	return drivers.ScreenState(screen, screenRules)
}

func (Driver) SubmitPlan(string) []ports.KeyStep { return drivers.Enter() }
