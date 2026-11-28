//go:build darwin || linux

package pty

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/signal"
	"sync/atomic"
	"time"

	"golang.org/x/term"

	"github.com/tmt-ninja/tmt/go/internal/ptyprotocol"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

type AttachKind uint8

const (
	AttachDetached AttachKind = iota
	AttachExited
	AttachEvicted
	AttachSignal
)

type AttachEnd struct {
	Kind     AttachKind
	Exit     ptyprotocol.Exit
	Eviction ptyprotocol.Eviction
	Signal   int
}

func (e AttachEnd) ExitStatus() int {
	switch e.Kind {
	case AttachExited:
		if e.Exit.Kind == ptyprotocol.ExitSignal {
			return min(255, max(0, 128+int(e.Exit.Value)))
		}
		return min(255, max(0, int(e.Exit.Value)))
	case AttachEvicted:
		if e.Eviction == ptyprotocol.EvictionTooSlow {
			return 1
		}
	case AttachSignal:
		return min(255, max(0, 128+e.Signal))
	}
	return 0
}

// Attach takes over this authenticated connection once. The member remains
// running on detach, client eviction or invocation cancellation.
func (c *TerminalConnection) Attach(ctx context.Context, input, output *os.File, detachOthers bool) (end AttachEnd, returned error) {
	if c.socket == nil || input == nil || output == nil || !sys.StdioIsTerminal(input) || !sys.StdioIsTerminal(output) {
		return AttachEnd{}, errors.New("attachment requires a verified connection and an interactive terminal")
	}
	defer c.Close()
	signals, err := startAttachSignals(ctx)
	if err != nil {
		return AttachEnd{}, err
	}
	defer signals.close()
	var state *term.State
	if err := withTerminal(input, func(fd int) error {
		var err error
		state, err = term.MakeRaw(fd)
		return err
	}); err != nil {
		return AttachEnd{}, err
	}
	defer func() {
		returned = errors.Join(returned, withTerminal(input, func(fd int) error { return term.Restore(fd, state) }))
	}()
	if err := fullWrite(output, []byte("\x1b[?1049h")); err != nil {
		return AttachEnd{}, err
	}
	defer func() { returned = errors.Join(returned, fullWrite(output, []byte("\x1b[0m\x1b[?1049l"))) }()
	return c.relay(ctx, input, output, signals, detachOthers)
}

func (c *TerminalConnection) relay(ctx context.Context, input, output *os.File, signals *attachSignals, detachOthers bool) (AttachEnd, error) {
	local, err := terminalSize(output)
	if err != nil {
		return AttachEnd{}, err
	}
	if err := c.attachSend(ptyprotocol.ClientMessage{Tag: ptyprotocol.ClientResize, Size: local}); err != nil {
		return AttachEnd{}, err
	}
	if detachOthers {
		if err := c.attachSend(ptyprotocol.ClientMessage{Tag: ptyprotocol.ClientTakeSole}); err != nil {
			return AttachEnd{}, err
		}
	}
	if err := c.attachSend(ptyprotocol.ClientMessage{Tag: ptyprotocol.ClientSnapshot}); err != nil {
		return AttachEnd{}, err
	}
	screen := attachScreen{local: local, outstanding: true}
	for {
		if stopped := int(signals.stopped.Load()); stopped != 0 {
			return AttachEnd{Kind: AttachSignal, Signal: stopped}, nil
		}
		if err := ctx.Err(); err != nil {
			return AttachEnd{}, err
		}
		if signals.resized.Swap(false) {
			screen.local, err = terminalSize(output)
			if err == nil {
				err = c.attachSend(ptyprotocol.ClientMessage{Tag: ptyprotocol.ClientResize, Size: screen.local})
			}
			if err != nil {
				return AttachEnd{}, err
			}
		}
		saturated := true
		for range 64 {
			frame, ready, err := c.decoder.NextServer()
			if err != nil {
				return AttachEnd{}, err
			}
			if !ready {
				saturated = false
				break
			}
			switch frame.Tag {
			case ptyprotocol.ServerExited:
				return AttachEnd{Kind: AttachExited, Exit: frame.Exit}, nil
			case ptyprotocol.ServerEvicted:
				return AttachEnd{Kind: AttachEvicted, Eviction: frame.Eviction}, nil
			default:
				if err := screen.frame(frame, output, c.attachSend); err != nil {
					return AttachEnd{}, err
				}
			}
		}
		ready, err := sys.PollTerminal(input, c.socket, signals.reader, saturated)
		if err != nil {
			return AttachEnd{}, err
		}
		if ready.Wake {
			var wake [1]byte
			if _, err := signals.reader.Read(wake[:]); err != nil {
				return AttachEnd{}, err
			}
			signals.queued.Store(false)
			continue
		}
		if ready.Input {
			detached, err := c.attachInput(input)
			if err != nil || detached {
				return AttachEnd{Kind: AttachDetached}, err
			}
		}
		if ready.Socket && !saturated {
			if err := c.socket.SetReadDeadline(time.Now().Add(terminalBudget)); err != nil {
				return AttachEnd{}, err
			}
			if err := c.read(); err != nil {
				return AttachEnd{}, err
			}
		}
	}
}

func (c *TerminalConnection) attachInput(input *os.File) (bool, error) {
	var buffer [4096]byte
	n, retry, err := sys.StdioRead(input, buffer[:])
	if retry || err != nil {
		return false, err
	}
	data := buffer[:n]
	detach := n == 0
	if i := bytes.IndexByte(data, 0x1c); i >= 0 {
		data, detach = data[:i], true
	}
	if len(data) > 0 {
		if err := c.attachSend(ptyprotocol.ClientMessage{Tag: ptyprotocol.ClientInput, Data: data}); err != nil {
			return false, err
		}
	}
	if detach {
		return true, c.attachSend(ptyprotocol.ClientMessage{Tag: ptyprotocol.ClientDetach})
	}
	return false, nil
}

func (c *TerminalConnection) attachSend(message ptyprotocol.ClientMessage) error {
	if err := c.socket.SetWriteDeadline(time.Now().Add(terminalBudget)); err != nil {
		return err
	}
	return c.send(message)
}

func terminalSize(file *os.File) (ptyprotocol.Size, error) {
	var cols, rows int
	err := withTerminal(file, func(fd int) error {
		var err error
		cols, rows, err = term.GetSize(fd)
		return err
	})
	if err != nil {
		return ptyprotocol.Size{}, err
	}
	return ptyprotocol.NewSize(uint16(max(1, min(cols, int(ptyprotocol.MaxDimension)))),
		uint16(max(1, min(rows, int(ptyprotocol.MaxDimension)))))
}

func withTerminal(file *os.File, action func(int) error) error {
	descriptor, err := file.SyscallConn()
	if err != nil {
		return err
	}
	var terminalErr error
	if err := descriptor.Control(func(fd uintptr) { terminalErr = action(int(fd)) }); err != nil {
		return err
	}
	return terminalErr
}

func fullWrite(output io.Writer, data []byte) error {
	n, err := output.Write(data)
	if err == nil && n != len(data) {
		return io.ErrShortWrite
	}
	return err
}

type attachSignals struct {
	reader, writer    *os.File
	events            chan os.Signal
	done, stoppedLoop chan struct{}
	stopContext       func() bool
	queued, resized   atomic.Bool
	stopped           atomic.Int32
}

func startAttachSignals(ctx context.Context) (*attachSignals, error) {
	reader, writer, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	s := &attachSignals{reader: reader, writer: writer, events: make(chan os.Signal, 16),
		done: make(chan struct{}), stoppedLoop: make(chan struct{})}
	signal.Notify(s.events, sys.TerminalSignals()...)
	s.stopContext = context.AfterFunc(ctx, s.wake)
	go func() {
		defer close(s.stoppedLoop)
		for {
			select {
			case <-s.done:
				return
			case sig := <-s.events:
				if sys.IsTerminalResize(sig) {
					s.resized.Store(true)
				} else {
					s.stopped.CompareAndSwap(0, int32(sys.TerminalSignalNumber(sig)))
				}
				s.wake()
			}
		}
	}()
	return s, nil
}

func (s *attachSignals) wake() {
	if s.queued.CompareAndSwap(false, true) {
		_, _ = s.writer.Write([]byte{1})
	}
}

func (s *attachSignals) close() {
	signal.Stop(s.events)
	s.stopContext()
	close(s.done)
	<-s.stoppedLoop
	_ = s.reader.Close()
	_ = s.writer.Close()
}
