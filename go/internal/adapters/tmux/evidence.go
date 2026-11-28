package tmux

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const evidenceMaxBytes = 1024 * 1024
const captureMaxBytes = 4 * 1024 * 1024

// Panes reads pane evidence from the selected server without writing metadata.
func (c Client) Panes(ctx context.Context, server string) ([]ports.PaneEvidence, error) {
	format := fields(
		"socket_path", "pane_id", "session_name", "window_index", "pane_current_command",
		"pane_pid", "pane_current_path", "pane_active", "session_attached",
	)
	output, err := c.run(ctx, server, evidenceMaxBytes, nil, "list-panes", "-a", "-F", format)
	if err != nil {
		return nil, err
	}

	type linkedPane struct {
		index    int
		attached bool
	}
	byID := make(map[string]linkedPane)
	panes := make([]ports.PaneEvidence, 0)
	for row := range strings.SplitSeq(strings.TrimSuffix(output, "\n"), "\n") {
		values, ok := decodeRow(row, 9)
		if !ok || values[0] != server || !validPane(values[1]) || !decimal(values[3]) ||
			!decimal(values[5]) || !decimal(values[8]) {
			return nil, errors.New("invalid tmux pane evidence")
		}
		pid, err := strconv.ParseInt(values[5], 10, 32)
		if err != nil || pid < 1 || (values[7] != "0" && values[7] != "1") {
			return nil, errors.New("invalid tmux pane evidence")
		}
		pane := ports.PaneEvidence{
			Pane: ports.PaneRef{Server: server, PaneID: values[1]}, Session: values[2], Window: values[3],
			Command: values[4], PID: int(pid), CurrentDir: values[6], Active: values[7] == "1",
		}
		attached := strings.TrimLeft(values[8], "0") != ""
		if previous, found := byID[pane.Pane.PaneID]; found {
			if panes[previous.index].PID != pane.PID {
				return nil, errors.New("conflicting tmux pane evidence for a linked window")
			}
			if attached && !previous.attached {
				panes[previous.index] = pane
				byID[pane.Pane.PaneID] = linkedPane{index: previous.index, attached: true}
			}
			continue
		}
		byID[pane.Pane.PaneID] = linkedPane{index: len(panes), attached: attached}
		panes = append(panes, pane)
	}
	return panes, nil
}

// Capture reads text and the reported pane geometry. The text is diagnostic;
// it cannot prove delivery or request completion.
func (c Client) Capture(ctx context.Context, pane ports.PaneRef, opt ports.CaptureOpts) (ports.Screen, error) {
	if !validPane(pane.PaneID) {
		return ports.Screen{}, errors.New("invalid tmux pane ID")
	}
	if opt.Lines < 0 || opt.Lines > math.MaxInt32 {
		return ports.Screen{}, errors.New("invalid capture line count")
	}
	format := "#{pane_id}\t#{pane_height}\t#{pane_width}"
	geometry, err := c.run(ctx, pane.Server, 128, nil, "display-message", "-p", "-t", pane.PaneID, format)
	if err != nil {
		return ports.Screen{}, err
	}
	parts := strings.Split(strings.TrimSuffix(geometry, "\n"), "\t")
	if len(parts) != 3 || parts[0] != pane.PaneID || !decimal(parts[1]) || !decimal(parts[2]) {
		return ports.Screen{}, errors.New("invalid tmux pane geometry")
	}
	lines, linesErr := strconv.Atoi(parts[1])
	cols, colsErr := strconv.Atoi(parts[2])
	if linesErr != nil || colsErr != nil || lines == 0 || cols == 0 {
		return ports.Screen{}, errors.New("invalid tmux pane geometry")
	}

	args := []string{"capture-pane", "-p", "-t", pane.PaneID}
	if opt.Lines > 0 {
		args = append(args, "-S", "-"+strconv.Itoa(opt.Lines))
	}
	if opt.Escape {
		args = append(args, "-e")
	}
	output, err := c.run(ctx, pane.Server, captureMaxBytes, nil, args...)
	if err != nil {
		return ports.Screen{}, err
	}
	return ports.Screen{Pane: pane, Text: output, Lines: lines, Cols: cols}, nil
}

// Encode framing characters with tmux format substitutions, following the Rust
// discovery adapter. Names and paths are values, never interpreted as formats.
func fields(names ...string) string {
	encoded := make([]string, 0, len(names))
	for _, name := range names {
		value := fmt.Sprintf(`#{s|\\|\\\\|:#{%s}}`, name)
		value = fmt.Sprintf(`#{s|%s|\\n|:%s}`, "\n", value)
		value = fmt.Sprintf(`#{s|%s|\\t|:%s}`, "\t", value)
		value = fmt.Sprintf(`#{s|%s|\\r|:%s}`, "\r", value)
		encoded = append(encoded, value)
	}
	return strings.Join(encoded, "\t")
}

func decodeRow(row string, size int) ([]string, bool) {
	values := strings.Split(row, "\t")
	if len(values) != size {
		return nil, false
	}
	for i, value := range values {
		var decoded strings.Builder
		for j := 0; j < len(value); j++ {
			ch := value[j]
			if ch == '\\' {
				j++
				if j == len(value) {
					return nil, false
				}
				switch value[j] {
				case '\\':
					ch = '\\'
				case 'n':
					ch = '\n'
				case 't':
					ch = '\t'
				case 'r':
					ch = '\r'
				default:
					return nil, false
				}
			}
			decoded.WriteByte(ch)
		}
		values[i] = decoded.String()
	}
	return values, true
}
