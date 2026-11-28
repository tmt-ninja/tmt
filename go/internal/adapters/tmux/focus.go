//go:build darwin || linux

package tmux

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

var ErrInvokerClient = errors.New("could not prove one invoking tmux client")
var ErrFocusChanged = errors.New("the tmux client or pane changed before focus")

// TmuxCaller is the CLI's invocation claim, independently verified by the adapter.
type TmuxCaller struct {
	Socket    string
	ServerPID uint64
	PaneID    string
	// SessionID is the exact $ID parsed from TMUX. It serves key jobs
	// whose invocation has no TMUX_PANE.
	SessionID string
}

// ClientView pins one attached client incarnation and its selected location.
type ClientView struct {
	Name, TTY, Socket string
	Process           core.ProcessIncarnation
	PaneID, SessionID string
	WindowID          string
}

func (c Client) InvokerClient(ctx context.Context, claim TmuxCaller) (ClientView, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if claim.ServerPID == 0 {
		return ClientView{}, ErrInvokerClient
	}
	if claim.PaneID == "" {
		if !prefixedNumber(claim.SessionID, '$') {
			return ClientView{}, ErrInvokerClient
		}
		return c.readClient(ctx, claim.Socket, claim.ServerPID, func(view ClientView) bool {
			return view.SessionID == claim.SessionID
		})
	}
	pane, err := c.invokerPane(ctx, claim)
	if err != nil {
		return ClientView{}, err
	}
	view, err := c.readClient(ctx, claim.Socket, claim.ServerPID, func(view ClientView) bool {
		return view.SessionID == pane.SessionID
	})
	if err != nil || view.PaneID != pane.Pane.PaneID || view.WindowID != pane.WindowID {
		return ClientView{}, ErrInvokerClient
	}
	return view, nil
}

func (c Client) invokerPane(ctx context.Context, claim TmuxCaller) (PaneSnapshot, error) {
	if !validPane(claim.PaneID) || claim.ServerPID == 0 {
		return PaneSnapshot{}, ErrInvokerClient
	}
	pane, err := c.paneSnapshot(ctx, ports.PaneRef{Server: claim.Socket, PaneID: claim.PaneID})
	if err != nil || pane.Server.PID != claim.ServerPID {
		return PaneSnapshot{}, ErrInvokerClient
	}
	observer := runtime.Observer{Process: c.Process}
	if inside, err := observer.InProcessTree(ctx, os.Getpid(), int(pane.Process.PID)); err != nil || !inside {
		return PaneSnapshot{}, ErrInvokerClient
	}
	if inside, err := observer.InProcessTree(ctx, int(pane.Process.PID), int(pane.Server.PID)); err != nil || !inside {
		return PaneSnapshot{}, ErrInvokerClient
	}
	return pane, nil
}

func (c Client) paneSnapshot(ctx context.Context, pane ports.PaneRef) (PaneSnapshot, error) {
	if !validPane(pane.PaneID) {
		return PaneSnapshot{}, ErrFocusChanged
	}
	observation, err := c.Discover(ctx, pane.Server, pane.PaneID)
	if err != nil {
		return PaneSnapshot{}, err
	}
	if len(observation.Candidates) != 1 || observation.Truncated ||
		observation.Candidates[0].Linked || observation.Candidates[0].Reason != "" {
		return PaneSnapshot{}, ErrFocusChanged
	}
	return observation.Candidates[0], nil
}

func (c Client) readClient(ctx context.Context, socket string, serverPID uint64, pick func(ClientView) bool) (ClientView, error) {
	format := fields("client_name", "client_tty", "client_pid", "session_id", "window_id", "pane_id", "socket_path", "pid")
	found, err := c.run(ctx, socket, evidenceMaxBytes, nil, "list-clients", "-F", format)
	if err != nil {
		return ClientView{}, err
	}
	view := ClientView{}
	for line := range strings.SplitSeq(strings.TrimSuffix(found, "\n"), "\n") {
		if line == "" {
			continue
		}
		row, valid := decodeRow(line, 8)
		if !valid || row[6] != socket || serverPID != 0 && row[7] != strconv.FormatUint(serverPID, 10) {
			return ClientView{}, ErrInvokerClient
		}
		pid, pidErr := strconv.ParseUint(row[2], 10, 31)
		item := ClientView{Name: row[0], TTY: row[1], Socket: socket, SessionID: row[3], WindowID: row[4], PaneID: row[5],
			Process: core.ProcessIncarnation{PID: pid}}
		if !pick(item) {
			continue
		}
		// More than one match, including a control client, is ambiguous.
		if view.Name != "" || item.Name == "" || !filepath.IsAbs(item.TTY) ||
			strings.ContainsFunc(item.Name, unicode.IsControl) || strings.ContainsFunc(item.TTY, unicode.IsControl) ||
			!prefixedNumber(item.SessionID, '$') || !prefixedNumber(item.WindowID, '@') || !validPane(item.PaneID) || pidErr != nil || pid == 0 {
			return ClientView{}, ErrInvokerClient
		}
		view = item
	}
	if view.Name == "" {
		return ClientView{}, ErrInvokerClient
	}
	seen, err := (runtime.Observer{Process: c.Process}).Observe(ctx, int(view.Process.PID))
	if err != nil || seen.State != runtime.Alive {
		return ClientView{}, ErrInvokerClient
	}
	view.Process.StartIdentity = seen.Incarnation.Start
	return view, nil
}

func (c Client) checkFocus(ctx context.Context, claim TmuxCaller, expected ClientView, target PaneSnapshot) (PaneSnapshot, error) {
	if target.Pane.Server != claim.Socket {
		return PaneSnapshot{}, ErrFocusChanged
	}
	before, err := c.InvokerClient(ctx, claim)
	if err != nil {
		return PaneSnapshot{}, err
	}
	if before != expected {
		return PaneSnapshot{}, ErrFocusChanged
	}
	current, err := c.paneSnapshot(ctx, target.Pane)
	if err != nil {
		return PaneSnapshot{}, err
	}
	if !samePaneSnapshot(current, target) || current.Server.PID != claim.ServerPID {
		return PaneSnapshot{}, ErrFocusChanged
	}
	return current, nil
}

func samePaneSnapshot(a, b PaneSnapshot) bool {
	return a.Pane == b.Pane && a.Server == b.Server && a.ServerProcess == b.ServerProcess &&
		a.Process == b.Process && a.SessionID == b.SessionID && a.WindowID == b.WindowID &&
		reflect.DeepEqual(a.Marker, b.Marker)
}

// FocusPane revalidates the pinned caller client and the exact target, then
// checks the selected view on that same client. An error after a switch is
// never a reason to select a different client or repeat the action blindly.
func (c Client) FocusPane(ctx context.Context, claim TmuxCaller, expected ClientView, target PaneSnapshot) (ClientView, error) {
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	current, err := c.checkFocus(ctx, claim, expected, target)
	if err != nil {
		return ClientView{}, err
	}
	if err := c.verifyUnsharedFocus(ctx, expected, current.SessionID); err != nil {
		return ClientView{}, err
	}
	id := current.Pane.PaneID
	command := "switch-client -c " + tmuxCommandWord([]byte(expected.Name)) + " -t " + id +
		" ; select-window -t " + id + " ; select-pane -t " + id
	if err := c.runPaneAction(ctx, current, command); err != nil {
		return ClientView{}, err
	}
	after, err := c.clientAfter(ctx, expected)
	if err != nil || after.PaneID != id || after.WindowID != current.WindowID || after.SessionID != current.SessionID {
		return ClientView{}, ErrFocusChanged
	}
	return after, nil
}

// select-window and select-pane change shared session state. Recheck that
// no other client can see those changes before issuing the command sequence.
func (c Client) verifyUnsharedFocus(ctx context.Context, expected ClientView, targetSession string) error {
	format := fields("session_id", "client_name", "client_pid")
	text, err := c.run(ctx, expected.Socket, evidenceMaxBytes, nil, "list-clients", "-F", format)
	if err != nil {
		return err
	}
	found := false
	for line := range strings.SplitSeq(strings.TrimSuffix(text, "\n"), "\n") {
		row, valid := decodeRow(line, 3)
		if !valid {
			return ErrInvokerClient
		}
		if row[0] != expected.SessionID && row[0] != targetSession {
			continue
		}
		if found || row[0] != expected.SessionID || row[1] != expected.Name ||
			row[2] != strconv.FormatUint(expected.Process.PID, 10) {
			return ErrInvokerClient
		}
		found = true
	}
	if !found {
		return ErrInvokerClient
	}
	return nil
}

func (c Client) clientAfter(ctx context.Context, expected ClientView) (ClientView, error) {
	after, err := c.readClient(ctx, expected.Socket, 0, func(view ClientView) bool {
		return view.Name == expected.Name && view.TTY == expected.TTY && view.Process.PID == expected.Process.PID
	})
	if err != nil || after.Process != expected.Process {
		return ClientView{}, ErrFocusChanged
	}
	return after, nil
}

func (c Client) runPaneAction(ctx context.Context, pane PaneSnapshot, command string) error {
	const refused = "TMT_GO_FOCUS_CHANGED"
	condition := andFormats(
		formatEqual("pane_id", pane.Pane.PaneID),
		formatEqual("pane_pid", strconv.FormatUint(pane.Process.PID, 10)),
		formatEqual("pid", strconv.FormatUint(pane.Server.PID, 10)),
		formatEqual("start_time", pane.Server.StartTime),
		formatEqual("session_id", pane.SessionID),
		formatEqual("window_id", pane.WindowID),
	)
	out, err := c.run(ctx, pane.Pane.Server, 1024, nil, "if-shell", "-F", "-t", pane.Pane.PaneID,
		condition, command, "display-message -p "+refused)
	if err == nil && strings.TrimSpace(out) == refused {
		return ErrFocusChanged
	}
	return err
}

type SwapDirection string

const (
	SwapLeft  SwapDirection = "left"
	SwapRight SwapDirection = "right"
	SwapUp    SwapDirection = "up"
	SwapDown  SwapDirection = "down"
)

var ErrNoNeighbour = errors.New("no visible tmux neighbour in that direction")

// SwapResult reports the exact pane selected by the pre-swap geometry.
type SwapResult struct {
	View              ClientView
	Target, Neighbour string
	Already           bool
}

// SwapInto swaps the target with the visible neighbour of the invoking pane.
// It keeps the exact invoker client, even if tmux changes that client's view.
func (c Client) SwapInto(ctx context.Context, claim TmuxCaller, expected ClientView, target PaneSnapshot, direction SwapDirection) (SwapResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	if !validPane(claim.PaneID) {
		return SwapResult{}, ErrInvokerClient
	}
	if claim.PaneID == target.Pane.PaneID {
		return SwapResult{}, ErrNoNeighbour
	}
	current, err := c.checkFocus(ctx, claim, expected, target)
	if err != nil {
		return SwapResult{}, err
	}
	read := func() (string, error) {
		format := fields("pane_id", "pane_left", "pane_top", "pane_width", "pane_height", "window_zoomed_flag")
		return c.run(ctx, claim.Socket, evidenceMaxBytes, nil, "list-panes", "-t", claim.PaneID, "-F", format)
	}
	text, err := read()
	if err != nil {
		return SwapResult{}, err
	}
	next, err := swapNeighbour(text, claim.PaneID, direction)
	if err != nil {
		return SwapResult{}, err
	}
	result := SwapResult{Target: current.Pane.PaneID, Neighbour: next, Already: next == current.Pane.PaneID}
	if !result.Already {
		neighbour, err := c.paneSnapshot(ctx, ports.PaneRef{Server: claim.Socket, PaneID: next})
		if err != nil || neighbour.Server != current.Server || neighbour.WindowID != expected.WindowID ||
			neighbour.SessionID != expected.SessionID {
			return SwapResult{}, ErrFocusChanged
		}
		if again, err := read(); err != nil || again != text {
			return SwapResult{}, ErrFocusChanged
		}
		if _, err := c.checkFocus(ctx, claim, expected, current); err != nil {
			return SwapResult{}, err
		}
		if err := c.verifyUnsharedFocus(ctx, expected, current.SessionID); err != nil {
			return SwapResult{}, err
		}
		if err := c.runPaneAction(ctx, neighbour, "swap-pane -d -s "+current.Pane.PaneID+" -t "+next); err != nil {
			return SwapResult{}, err
		}
		moved, err := c.paneSnapshot(ctx, current.Pane)
		if err != nil || moved.Process != current.Process || moved.ServerProcess != current.ServerProcess ||
			moved.WindowID != neighbour.WindowID || moved.SessionID != neighbour.SessionID {
			return SwapResult{}, ErrFocusChanged
		}
	}
	result.View, err = c.clientAfter(ctx, expected)
	if err != nil {
		return SwapResult{}, err
	}
	return result, nil
}

type paneGeometry struct {
	id                       string
	left, top, width, height uint64
	zoomed                   bool
}

func swapNeighbour(text, callerID string, direction SwapDirection) (string, error) {
	panes := make(map[string]paneGeometry)
	for line := range strings.SplitSeq(strings.TrimSuffix(text, "\n"), "\n") {
		row, ok := decodeRow(line, 6)
		if !ok || !validPane(row[0]) || (row[5] != "0" && row[5] != "1") {
			return "", ErrFocusChanged
		}
		if _, duplicate := panes[row[0]]; duplicate {
			return "", ErrFocusChanged
		}
		var coords [4]uint64
		for i := range coords {
			var err error
			coords[i], err = strconv.ParseUint(row[i+1], 10, 30)
			if err != nil {
				return "", ErrFocusChanged
			}
		}
		if coords[2] == 0 || coords[3] == 0 {
			return "", ErrFocusChanged
		}
		panes[row[0]] = paneGeometry{row[0], coords[0], coords[1], coords[2], coords[3], row[5] == "1"}
	}
	caller, present := panes[callerID]
	if !present || caller.zoomed {
		return "", ErrNoNeighbour
	}
	horizontal := direction == SwapLeft || direction == SwapRight
	start, length := caller.left, caller.width
	if horizontal {
		start, length = caller.top, caller.height
	}
	mid := 2*start + length
	var best paneGeometry
	var bestOverlap uint64
	bestContains := false
	for _, other := range panes {
		if other.id == callerID {
			continue
		}
		var touches bool
		switch direction {
		case SwapLeft:
			touches = other.left+other.width+1 == caller.left
		case SwapRight:
			touches = caller.left+caller.width+1 == other.left
		case SwapUp:
			touches = other.top+other.height+1 == caller.top
		case SwapDown:
			touches = caller.top+caller.height+1 == other.top
		}
		if !touches {
			continue
		}
		otherStart, otherLength := other.left, other.width
		if horizontal {
			otherStart, otherLength = other.top, other.height
		}
		begin, end := max(start, otherStart), min(start+length, otherStart+otherLength)
		if end <= begin {
			continue
		}
		overlap := end - begin
		contains := mid >= 2*otherStart && mid < 2*(otherStart+otherLength)
		if best.id == "" || contains && !bestContains || contains == bestContains &&
			(overlap > bestOverlap || overlap == bestOverlap && geometryBefore(other, best)) {
			best, bestOverlap, bestContains = other, overlap, contains
		}
	}
	if best.id == "" {
		return "", ErrNoNeighbour
	}
	return best.id, nil
}

func geometryBefore(a, b paneGeometry) bool {
	return a.left < b.left || a.left == b.left &&
		(a.top < b.top || a.top == b.top && a.id < b.id)
}
