//go:build darwin || linux

package tmux

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const openedOption = OptionNamespace + "opened"

// PaneClose is the result of the guarded close operation.
type PaneClose uint8

const (
	PaneKept PaneClose = iota
	PaneClosed
	PaneGone
)

var launchEvidence = fields("socket_path", "pid", "start_time", "pane_id", "pane_pid")

// LaunchOwned opens a window for an already selected identity and records the
// launch origin. Callers must inspect the returned valid pane when origin
// recording fails, since the program may have started.
func (c Client) LaunchOwned(ctx context.Context, spec ports.LaunchSpec, identity core.Identity) (ports.PaneRef, error) {
	if identity.ID == "" || len(identity.ID) > 128 {
		return ports.PaneRef{}, errors.New("invalid tmux launch identity")
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	text, err := c.launchWindow(ctx, spec, launchEvidence)
	if err != nil {
		return ports.PaneRef{}, err
	}
	row, ok := decodeRow(text, 5)
	if !ok || row[0] != spec.Server || !validPane(row[3]) ||
		!decimal(row[1]) || !decimal(row[2]) || !decimal(row[4]) {
		return ports.PaneRef{}, errors.New("tmux launch returned invalid pane evidence")
	}
	pane := ports.PaneRef{Server: spec.Server, PaneID: row[3]}
	pid, err := strconv.ParseInt(row[4], 10, 32)
	if err != nil || pid <= 0 {
		return pane, errors.New("tmux launch returned an invalid pane process")
	}
	observation, err := (runtime.Observer{Process: c.Process}).Observe(ctx, int(pid))
	if err != nil {
		return pane, err
	}
	if observation.State != runtime.Alive && observation.State != runtime.Suspended {
		return pane, errors.New("tmux launch pane process could not be verified")
	}
	origin, err := json.Marshal(launchOrigin(identity.ID, row, observation.Incarnation.Start))
	if err != nil {
		return pane, err
	}
	condition := andFormats(
		formatEqual("socket_path", row[0]),
		formatEqual("pid", row[1]),
		formatEqual("start_time", row[2]),
		formatEqual("pane_id", row[3]),
		formatEqual("pane_pid", row[4]),
		formatEqual("pane_dead", "0"),
		formatEqual(openedOption, ""),
	)
	const refused = "TMT_GO_ORIGIN_REFUSED"
	out, err := c.run(ctx, spec.Server, 128, nil, "if-shell", "-F", "-t", pane.PaneID, condition,
		"set-option -p -t "+pane.PaneID+" "+openedOption+" "+tmuxCommandWord(origin), "display-message -p "+refused)
	if err != nil {
		return pane, err
	}
	if strings.TrimSpace(out) == refused {
		return pane, errors.New("tmux launch origin could not be recorded")
	}
	return pane, nil
}

// Launch origin includes the identity, the server instance, and the pane's
// process incarnation. A marker copied to a different pane cannot match.
func launchOrigin(identity core.IdentityID, endpoint []string, start string) []string {
	return append(append([]string{string(identity)}, endpoint...), start)
}

// CloseOwnedPane closes only the verified pane opened for identity. Call it
// after verified stop has settled. A missing or changed origin keeps the
// pane. It issues at most one kill command.
func (c Client) CloseOwnedPane(ctx context.Context, binding core.Binding, identity core.Identity) (PaneClose, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	doc, raw, err := c.bindingDocument(ctx, binding, identity)
	if err != nil || doc == nil {
		// A failed targeted query is insufficient to prove a pane gone.
		if c.paneAbsent(ctx, binding) {
			return PaneGone, nil
		}
		return PaneKept, err
	}
	marker := bindingMarker(raw)
	if marker == nil {
		return PaneKept, nil
	}
	name, err := core.ValidateExistingName(string(marker.Name))
	if err != nil || name.CanonicalName() != marker.CanonicalName {
		return PaneKept, nil
	}
	pane := binding.PaneID
	origin, err := json.Marshal(launchOrigin(identity.ID, []string{
		binding.Server.Socket, strconv.FormatUint(binding.Server.PID, 10), binding.Server.StartTime,
		pane, strconv.FormatUint(binding.PanePID, 10),
	}, *binding.PaneIncarnation))
	if err != nil {
		return PaneKept, err
	}
	recorded, err := c.run(ctx, binding.Server.Socket, 1024, nil,
		"show-options", "-q", "-p", "-t", pane, "-v", openedOption)
	if err != nil || strings.TrimSuffix(recorded, "\n") != string(origin) {
		return PaneKept, err
	}
	// The single-pane window may disappear only when it is unlinked and
	// another window keeps its session alive. Multipane windows stay open.
	const keepsSession = "#{||:#{>:#{window_panes},1},#{&&:#{==:#{window_linked_sessions},1},#{>:#{session_windows},1}}}"
	const refused = "TMT_GO_CLOSE_REFUSED"
	condition := andFormats(bindingCondition(binding, raw),
		formatEqual("socket_path", binding.Server.Socket),
		formatEqual("pane_dead", "0"),
		formatEqual(openedOption, string(origin)),
		keepsSession,
	)
	out, err := c.run(ctx, binding.Server.Socket, 128, nil, "if-shell", "-F", "-t", pane, condition,
		"kill-pane -t "+pane, "display-message -p "+refused)
	if err != nil || strings.TrimSpace(out) == refused {
		return PaneKept, err
	}
	return PaneClosed, nil
}

func (c Client) paneAbsent(ctx context.Context, binding core.Binding) bool {
	if !validPane(binding.PaneID) || !serverID(binding.Server.ID) {
		return false
	}
	format := fields("socket_path", ServerIDOption, "pid", "start_time", "pane_id")
	text, err := c.run(ctx, binding.Server.Socket, evidenceMaxBytes, nil, "list-panes", "-a", "-F", format)
	if err != nil || text == "" {
		return false
	}
	for line := range strings.SplitSeq(strings.TrimSuffix(text, "\n"), "\n") {
		row, ok := decodeRow(line, 5)
		if !ok || row[0] != binding.Server.Socket || row[1] != binding.Server.ID ||
			row[2] != strconv.FormatUint(binding.Server.PID, 10) || row[3] != binding.Server.StartTime ||
			!validPane(row[4]) || row[4] == binding.PaneID {
			return false
		}
	}
	return true
}
