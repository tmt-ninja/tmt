//go:build darwin || linux

package tmux

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const discoveryRows = 256

var errDiscovery = errors.New("tmux discovery evidence is incomplete or ambiguous")

var discoveryFormat = fields(
	"socket_path", "pid", ServerIDOption, "start_time", "pane_id", "pane_pid", AgentOption,
	"session_id", "session_name", "window_id", "window_index", "pane_index",
	"pane_title", "pane_current_command", "pane_current_path",
)

// PaneSnapshot keeps the process and location of an exact observed pane.
type PaneSnapshot struct {
	Pane                  ports.PaneRef
	Server                core.ServerEvidence
	ServerProcess         core.ProcessIncarnation
	Process               core.ProcessIncarnation
	Marker                *core.BindingMarker
	SessionID, Session    string
	WindowID, WindowIndex string
	PaneIndex             string
	Title, Command, CWD   string

	Linked        bool
	TextTruncated bool
	Reason        string
}

type DiscoveryObservation struct {
	Socket     string
	Candidates []PaneSnapshot
	Truncated  bool
}

// Discover observes bounded tmux topology. An explicit missing pane returns
// an empty observation. The adapter never creates a server ID for discovery.
func (c Client) Discover(ctx context.Context, socket, paneID string) (DiscoveryObservation, error) {
	if paneID != "" && !validPane(paneID) {
		return DiscoveryObservation{}, errDiscovery
	}
	var filter string
	if paneID != "" {
		filter = formatEqual("pane_id", paneID)
	}
	return c.discover(ctx, socket, filter, paneID != "")
}

// MarkedPane freezes the explicit marked pane and does not resolve the mark
// again during binding. An empty mark is a successful nil snapshot.
func (c Client) MarkedPane(ctx context.Context, socket string) (*PaneSnapshot, error) {
	observation, err := c.discover(ctx, socket, "#{pane_marked}", true)
	if err != nil {
		return nil, err
	}
	switch len(observation.Candidates) {
	case 0:
		return nil, nil
	case 1:
		pane := observation.Candidates[0]
		if observation.Truncated || pane.Linked || pane.Reason != "" {
			return nil, errDiscovery
		}
		return &pane, nil
	default:
		return nil, errDiscovery
	}
}

func (c Client) discover(ctx context.Context, socket, filter string, allowEmpty bool) (DiscoveryObservation, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	args := []string{"list-panes", "-a"}
	if filter != "" {
		args = append(args, "-f", filter)
	}
	text, err := c.run(ctx, socket, evidenceMaxBytes, nil, append(args, "-F", discoveryFormat)...)
	if err != nil {
		return DiscoveryObservation{}, err
	}
	result := DiscoveryObservation{Socket: socket, Candidates: []PaneSnapshot{}}
	if text == "" {
		if allowEmpty {
			return result, nil
		}
		return DiscoveryObservation{}, errDiscovery
	}
	rows := make(map[string]observedPane)
	var server core.ServerEvidence
	for line := range strings.SplitSeq(strings.TrimSuffix(text, "\n"), "\n") {
		row, err := decodeDiscoveryPane(line, socket)
		if err != nil {
			return DiscoveryObservation{}, err
		}
		if server.PID == 0 {
			server = row.Server
		}
		if row.Server != server {
			return DiscoveryObservation{}, errDiscovery
		}
		if old, duplicate := rows[row.Pane.PaneID]; duplicate {
			if old.Process != row.Process || old.rawMarker != row.rawMarker || old.Command != row.Command || old.CWD != row.CWD ||
				old.Title != row.Title || old.WindowID != row.WindowID {
				return DiscoveryObservation{}, errDiscovery
			}
			old.Linked = true
			rows[row.Pane.PaneID] = old
		} else if len(rows) < discoveryRows {
			rows[row.Pane.PaneID] = row
		} else {
			result.Truncated = true
		}
	}
	ids := make([]string, 0, len(rows))
	pids := []int{int(server.PID)}
	for id, item := range rows {
		ids = append(ids, id)
		pids = append(pids, int(item.Process.PID))
	}
	slices.Sort(ids)
	starts, err := (runtime.Observer{Process: c.Process}).ObserveStarts(ctx, pids)
	if err != nil {
		return DiscoveryObservation{}, err
	}
	result.Truncated = result.Truncated || ctx.Err() != nil
	for _, id := range ids {
		pane := rows[id].PaneSnapshot
		pane.ServerProcess = core.ProcessIncarnation{PID: server.PID, StartIdentity: starts[int(server.PID)].Start}
		pane.Process.StartIdentity = starts[int(pane.Process.PID)].Start
		switch {
		case result.Truncated:
			pane.Reason = "scan_truncated"
		case pane.ServerProcess.StartIdentity == "" || pane.Process.StartIdentity == "":
			pane.Reason = "native_incarnation_unknown"
		}
		for _, value := range []*string{&pane.Session, &pane.Title, &pane.Command, &pane.CWD} {
			if len(*value) > 1024 {
				cut := 1024
				for !utf8.RuneStart((*value)[cut]) {
					cut--
				}
				*value = (*value)[:cut]
				pane.TextTruncated = true
			}
		}
		result.Candidates = append(result.Candidates, pane)
	}
	return result, nil
}

type observedPane struct {
	PaneSnapshot
	rawMarker string
}

func decodeDiscoveryPane(line, socket string) (observedPane, error) {
	values, ok := decodeRow(line, 15)
	if !ok || !utf8.ValidString(line) || values[0] != socket || !validPane(values[4]) ||
		!prefixedNumber(values[7], '$') || !prefixedNumber(values[9], '@') ||
		!decimal(values[10]) || !decimal(values[11]) {
		return observedPane{}, errDiscovery
	}
	serverPID, serverErr := strconv.ParseUint(values[1], 10, 31)
	panePID, paneErr := strconv.ParseUint(values[5], 10, 31)
	start, startErr := strconv.ParseUint(values[3], 10, 64)
	if serverErr != nil || paneErr != nil || startErr != nil || serverPID == 0 || panePID == 0 || start == 0 {
		return observedPane{}, errDiscovery
	}
	row := observedPane{
		PaneSnapshot: PaneSnapshot{
			Pane:      ports.PaneRef{Server: socket, PaneID: values[4]},
			Server:    core.ServerEvidence{Host: "tmux", ID: values[2], Socket: socket, PID: serverPID, StartTime: values[3]},
			Process:   core.ProcessIncarnation{PID: panePID},
			Marker:    bindingMarker(values[6]),
			SessionID: values[7], Session: values[8], WindowID: values[9], WindowIndex: values[10],
			PaneIndex: values[11], Title: values[12], Command: values[13], CWD: values[14],
		},
		rawMarker: values[6],
	}
	if row.Server.ID != "" && !serverID(row.Server.ID) {
		row.Reason = "ownership_unknown"
	}
	if row.rawMarker != "" {
		doc := uniqueObject([]byte(row.rawMarker))
		var version uint64
		if json.Unmarshal(doc["version"], &version) != nil || version != 1 ||
			(doc["globalIdentity"] != nil && row.Marker == nil) {
			row.Reason = "ownership_unknown"
		}
	}
	return row, nil
}

func prefixedNumber(value string, prefix byte) bool {
	return len(value) > 1 && value[0] == prefix && decimal(value[1:])
}
