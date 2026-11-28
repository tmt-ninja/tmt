package drivers

import (
	"regexp"
	"slices"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/ports"
)

var screenSGR = regexp.MustCompile("\x1b\\[[0-9;:]*m")

// ScreenRules describes visible provider markers, separate from runtime and
// permission evidence. The footer is considered only below the composer.
type ScreenRules struct {
	Prompts   []string
	Busy      *regexp.Regexp
	Questions []string
	Footer    func(string) bool
}

// ScreenState classifies the bottom of a plain or SGR-colored diagnostic capture.
// It cannot establish a provider's identity, approve a form or authorize input.
func ScreenState(screen ports.Screen, rules ScreenRules) ports.DriverState {
	lines := strings.Split(strings.TrimRight(screenSGR.ReplaceAllString(screen.Text, ""), " \t\r\n"), "\n")
	lines = lines[max(0, len(lines)-12):]
	for i, line := range lines {
		line = strings.Trim(strings.TrimSpace(line), "│")
		lines[i] = strings.Join(strings.Fields(line), " ")
	}
	for _, line := range lines {
		lower := strings.ToLower(line)
		for _, question := range rules.Questions {
			if strings.HasPrefix(lower, question) {
				return ports.DriverPrompt
			}
		}
	}
	for _, line := range lines {
		if rules.Busy.MatchString(line) {
			return ports.DriverBusy
		}
	}
	for i := len(lines) - 1; i >= 0; i-- {
		line := lines[i]
		if strings.Trim(line, "─━╭╮╰╯┌┐└┘┏┓┗┛") == "" || rules.Footer(line) {
			continue
		}
		if slices.Contains(rules.Prompts, line) {
			return ports.DriverIdle
		}
		break
	}
	return ports.DriverUnknown
}
