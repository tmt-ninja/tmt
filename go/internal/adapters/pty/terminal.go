//go:build darwin || linux

package pty

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/driverprotocol"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ptyprotocol"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

var ErrTerminalUnverified = errors.New("could not verify the built-in terminal binding")
var errTerminalProtocol = errors.New("unexpected built-in terminal frame")

const terminalBudget = 3 * time.Second

// TerminalConnection is a single authenticated supervisor connection.
type TerminalConnection struct {
	socket  *net.UnixConn
	decoder *ptyprotocol.Decoder
}

// OpenTerminal inspects the same connection that Attach will take over. It
// accepts only the exact member socket under the resolved Go root.
func OpenTerminal(ctx context.Context, root home.Root, identity core.Identity, binding core.Binding) (*TerminalConnection, error) {
	ctx, cancel := context.WithTimeout(ctx, terminalBudget)
	defer cancel()
	pane, server := binding.PaneID, binding.Server
	if !filepath.IsAbs(root.Dir) || server.Host != "pty" || !validMember(pane) ||
		identity.ID == "" || binding.ID == "" || server.ID == "" || server.PID == 0 || server.PID > (1<<31)-1 ||
		binding.PanePID == 0 || binding.PanePID > (1<<31)-1 {
		return nil, ErrTerminalUnverified
	}
	dir := filepath.Join(root.Dir, "pty")
	path := filepath.Join(dir, pane+".sock")
	if server.Socket != path || len(path) > 100 {
		return nil, ErrTerminalUnverified
	}
	if !privateTerminalPath(dir, os.ModeDir) || !privateTerminalPath(path, os.ModeSocket) {
		return nil, ErrTerminalUnverified
	}
	conn, err := (&net.Dialer{}).DialContext(ctx, "unix", path)
	if err != nil {
		return nil, ErrTerminalUnverified
	}
	socket := conn.(*net.UnixConn)
	client := &TerminalConnection{socket: socket, decoder: ptyprotocol.NewDecoder()}
	accepted := false
	defer func() {
		if !accepted {
			_ = client.Close()
		}
	}()
	uid, pid, err := sys.UnixPeer(socket)
	if err != nil || uid != uint32(os.Geteuid()) || uint64(pid) != server.PID {
		return nil, ErrTerminalUnverified
	}
	deadline, _ := ctx.Deadline()
	if err := socket.SetDeadline(deadline); err != nil {
		return nil, err
	}
	wake := context.AfterFunc(ctx, func() { _ = socket.SetDeadline(time.Now()) })
	defer wake()
	if err := client.send(ptyprotocol.ClientMessage{Tag: ptyprotocol.ClientHello, Version: ptyprotocol.Version}); err != nil {
		return nil, err
	}
	answer, err := client.receive()
	if err != nil || answer.Tag != ptyprotocol.ServerWelcome || answer.Version != ptyprotocol.Version {
		return nil, ErrTerminalUnverified
	}
	if err := client.send(ptyprotocol.ClientMessage{Tag: ptyprotocol.ClientControl, Control: &ptyprotocol.Control{Tag: ptyprotocol.ControlInspect}}); err != nil {
		return nil, err
	}
	for {
		answer, err = client.receive()
		if err != nil || ctx.Err() != nil {
			return nil, ErrTerminalUnverified
		}
		switch answer.Tag {
		case ptyprotocol.ServerOutput, ptyprotocol.ServerResized, ptyprotocol.ServerExited:
			continue
		case ptyprotocol.ServerControl:
			if answer.Control == nil || verifyTerminal(ctx, identity, binding, *answer.Control) != nil {
				return nil, ErrTerminalUnverified
			}
		default:
			return nil, ErrTerminalUnverified
		}
		break
	}
	if ctx.Err() != nil || socket.SetDeadline(time.Time{}) != nil {
		return nil, ErrTerminalUnverified
	}
	accepted = true
	return client, nil
}

func validMember(id string) bool {
	return id != "" && len(id) <= 40 && !strings.ContainsFunc(id, func(r rune) bool {
		return !('a' <= r && r <= 'z' || 'A' <= r && r <= 'Z' || '0' <= r && r <= '9' || r == '_')
	})
}

func privateTerminalPath(path string, kind os.FileMode) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode().Type() == kind && info.Mode().Perm()&0077 == 0 && sys.FileOwnedByEffectiveUser(info)
}

func verifyTerminal(ctx context.Context, identity core.Identity, binding core.Binding, state ptyprotocol.ControlReply) error {
	if state.Tag != ptyprotocol.ReplyState || state.Marker == nil || state.Relaunching ||
		uint64(state.SupervisorPID) != binding.Server.PID || uint64(state.PanePID) != binding.PanePID {
		return ErrTerminalUnverified
	}
	var wire driverprotocol.Marker
	if json.Unmarshal([]byte(*state.Marker), &wire) != nil {
		return ErrTerminalUnverified
	}
	marker := core.BindingMarker{Name: core.Name(wire.Name), CanonicalName: wire.CanonicalName, IdentityID: core.IdentityID(wire.IdentityID),
		BindingID: core.BindingID(wire.BindingID), ServerID: wire.ServerID, PanePID: wire.PanePID}
	pids := []int{int(state.SupervisorPID)}
	running := state.Ended == nil && !state.Shell
	observer := runtime.Observer{Process: process.Runner{}}
	if running {
		ok, err := observer.IsProcessParent(ctx, int(state.PanePID), int(state.SupervisorPID))
		if err != nil || !ok || binding.PaneIncarnation == nil {
			return ErrTerminalUnverified
		}
		pids = append(pids, int(state.PanePID))
	}
	starts, err := observer.ObserveStarts(ctx, pids)
	if err != nil || starts[pids[0]].Start == "" || starts[pids[0]].Start != binding.Server.StartTime {
		return ErrTerminalUnverified
	}
	var paneStart *string
	if running {
		start := starts[pids[1]].Start
		if start == "" {
			return ErrTerminalUnverified
		}
		paneStart = &start
	}
	probe := core.EndpointProbe{State: core.EndpointProbeLive, Server: binding.Server,
		Panes: []core.PaneObservation{{ID: binding.PaneID, PID: binding.PanePID, Incarnation: paneStart, Marker: &marker}}}
	if proof, _ := core.EvaluateBinding(identity, &binding, probe); proof != core.BindingActive {
		return ErrTerminalUnverified
	}
	return nil
}

func (c *TerminalConnection) receive() (ptyprotocol.ServerMessage, error) {
	for {
		frame, ready, err := c.decoder.NextServer()
		if ready || err != nil {
			return frame, err
		}
		if err := c.read(); err != nil {
			return ptyprotocol.ServerMessage{}, err
		}
	}
}

func (c *TerminalConnection) read() error {
	var buffer [ptyprotocol.MaxOutput]byte
	size, err := c.socket.Read(buffer[:])
	if size > 0 {
		return c.decoder.Push(buffer[:size])
	}
	return err
}

func (c *TerminalConnection) send(message ptyprotocol.ClientMessage) error {
	data := message.Encode()
	n, err := c.socket.Write(data)
	if err == nil && n != len(data) {
		return io.ErrShortWrite
	}
	return err
}

func (c *TerminalConnection) Close() error {
	if c.socket == nil {
		return nil
	}
	err := c.socket.Close()
	c.socket = nil
	return err
}
