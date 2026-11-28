package drivers

import (
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// ScreenState classifies the bottom of a plain diagnostic capture. It cannot
// establish a provider's identity, approve a form or authorize delivery.
func ScreenState(screen ports.Screen, prompt string, busy, questions []string) ports.DriverState {
	lines := strings.Split(strings.TrimRight(screen.Text, " \t\r\n"), "\n")
	lines = lines[max(0, len(lines)-8):]
	last := strings.TrimSpace(lines[len(lines)-1])
	for _, line := range lines {
		line = strings.ToLower(strings.TrimSpace(line))
		for _, marker := range questions {
			if strings.HasPrefix(line, marker) {
				return ports.DriverPrompt
			}
		}
	}
	for _, line := range lines {
		line = strings.ToLower(strings.TrimSpace(line))
		for _, marker := range busy {
			if strings.HasSuffix(line, marker) {
				return ports.DriverBusy
			}
		}
	}
	if last == prompt {
		return ports.DriverIdle
	}
	return ports.DriverUnknown
}
