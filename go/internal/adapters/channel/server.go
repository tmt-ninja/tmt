//go:build darwin || linux

package channel

import (
	"bufio"
	"context"
	"errors"
	"io"
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/framedstdio"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

const (
	claudeMCPLimit     = 1024 * 1024
	claudeMCPSendLimit = claudeFrameLimit
	serverPoll         = 50 * time.Millisecond
)

type ClaudeServeRequest struct {
	Root       home.Root
	BindingID  string
	Generation string
	Build      string
}

// ParseClaudeServeRequest checks the coordinates carried in the per-launch
// MCP config against the root already resolved by tmt-go.
func ParseClaudeServeRequest(root home.Root, args []string, build string) (ClaudeServeRequest, error) {
	if len(args) != 4 || args[0] != "claude" || args[3] != ClaudeDirectory(root) ||
		!validClaudeDirectory(root) || !core.ValidUUID(args[1]) || !core.ValidUUID(args[2]) {
		return ClaudeServeRequest{}, ErrEnrollment
	}
	return ClaudeServeRequest{Root: root, BindingID: args[1], Generation: args[2], Build: build}, nil
}

func ClaudeDirectory(root home.Root) string {
	return filepath.Join(root.Dir, channelDirectory)
}

type serverEvent struct {
	line     []byte
	content  string
	written  chan struct{}
	deadline time.Time
	err      error
}

type claudeServer struct {
	req      ClaudeServeRequest
	dir      *channelDir
	record   claudeRecord
	listener *net.UnixListener
	socket   fs.FileInfo
	ready    atomic.Bool
}

// ServeClaude runs the dedicated channel MCP conversation. Its caller passes
// the guarded Go root and invocation stdio. Stdout carries protocol frames.
func ServeClaude(ctx context.Context, req ClaudeServeRequest, runner ports.Process, input, output *os.File) error {
	if input == nil || output == nil || !validClaudeDirectory(req.Root) ||
		!core.ValidUUID(req.BindingID) || !core.ValidUUID(req.Generation) {
		return ErrEnrollment
	}
	if err := framedstdio.RequireRedirected(input, output); err != nil {
		return err
	}
	server, err := bindClaudeServer(ctx, req)
	if err != nil {
		return err
	}
	defer server.dir.close()
	ctx, cancel := context.WithCancel(ctx)
	events := make(chan serverEvent)
	var workers sync.WaitGroup
	workers.Go(func() { readClaudeStdio(ctx, input, events) })
	workers.Go(func() { server.accept(ctx, events) })
	defer func() {
		cancel()
		_ = server.listener.Close()
		workers.Wait()
		server.cleanup(context.WithoutCancel(ctx))
	}()
	initialized := false
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case event := <-events:
			if errors.Is(event.err, io.EOF) {
				return nil
			}
			if event.err != nil {
				return event.err
			}
			if event.written != nil {
				if !time.Now().Before(event.deadline) {
					continue
				}
				notification := claudeMCPNotification(event.content)
				if err := framedstdio.PublishProgress(ctx, output, notification, claudeMCPSendLimit, event.deadline); err != nil {
					return err
				}
				event.written <- struct{}{}
				continue
			}
			response, ready := claudeMCPResponse(event.line, req.Build)
			if response != nil {
				if err := framedstdio.PublishProgress(ctx, output, response, claudeMCPLimit, time.Now().Add(5*time.Second)); err != nil {
					return err
				}
				initialized = initialized || isInitializeRequest(event.line)
			}
			if ready && initialized && !server.ready.Load() {
				if err := server.publishReady(ctx, runtime.Observer{Process: runner}); err != nil {
					return err
				}
			}
		}
	}
}

func bindClaudeServer(ctx context.Context, req ClaudeServeRequest) (*claudeServer, error) {
	dir, err := openChannelDir(req.Root, false)
	if err != nil {
		return nil, err
	}
	server, err := dir.bindPending(ctx, req)
	if err != nil {
		dir.close()
	}
	return server, err
}

func (dir *channelDir) bindPending(ctx context.Context, req ClaudeServeRequest) (*claudeServer, error) {
	lock, err := dir.lock(ctx)
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	record, err := dir.readClaude(req.BindingID)
	if err != nil {
		return nil, err
	}
	if record == nil || record.Generation != req.Generation || record.Claude != nil {
		return nil, errors.New("no pending channel enrollment for this launch")
	}
	if err := checkChannelPath(dir, req.Root); err != nil {
		return nil, err
	}
	name := req.BindingID + ".sock"
	path := socketPath(req.Root, req.BindingID)
	if err := checkSocket(dir, req.BindingID); err == nil {
		probe, cancel := context.WithTimeout(ctx, claudeConnectionBudget)
		conn, err := (&net.Dialer{}).DialContext(probe, "unix", path)
		cancel()
		if err == nil {
			conn.Close()
			return nil, ErrOccupied
		}
		if !errors.Is(err, fs.ErrNotExist) && !sys.SocketConnectionRefused(err) {
			return nil, err
		}
		if err := dir.root.Remove(name); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return nil, err
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := checkChannelPath(dir, req.Root); err != nil {
		return nil, err
	}
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		return nil, err
	}
	// Closing the listener must not remove a later generation's pathname.
	listener.SetUnlinkOnClose(false)
	info, err := dir.root.Lstat(name)
	if err != nil {
		listener.Close()
		return nil, err
	}
	if err := dir.root.Chmod(name, 0600); err != nil {
		listener.Close()
		removeMatchingSocket(dir, name, info)
		return nil, err
	}
	return &claudeServer{req: req, dir: dir, record: *record, listener: listener, socket: info}, nil
}

func (s *claudeServer) publishReady(ctx context.Context, observer runtime.Observer) error {
	parent := os.Getppid()
	observed, err := observer.Observe(ctx, parent)
	if err != nil || observed.State != runtime.Alive || !observed.Incarnation.Valid() || parent != os.Getppid() {
		return nil
	}
	lock, err := s.dir.lock(ctx)
	if err != nil {
		return err
	}
	defer lock.Close()
	record, err := s.dir.readClaude(s.req.BindingID)
	if err != nil {
		return err
	}
	if record == nil || !sameClaudeEnrollment(s.record, *record) || record.Claude != nil {
		return ErrOccupied
	}
	provider := processRecord{PID: uint64(parent), Start: observed.Incarnation.Start}
	if record.Foreground != nil && *record.Foreground != provider {
		return ErrOccupied
	}
	record.Claude = &provider
	s.ready.Store(true)
	// Readers can see the rename before directory sync returns. On failure
	// shut down the conversation, leaving the enrollment for recovery.
	return s.dir.writeClaude(*record)
}

func (s *claudeServer) cleanup(ctx context.Context) {
	lock, err := s.dir.lock(ctx)
	if err != nil {
		return
	}
	defer lock.Close()
	record, err := s.dir.readClaude(s.req.BindingID)
	if err == nil && record != nil && sameClaudeEnrollment(*record, s.record) {
		removeMatchingSocket(s.dir, s.req.BindingID+".sock", s.socket)
	}
}

func removeMatchingSocket(dir *channelDir, name string, expected fs.FileInfo) {
	info, err := dir.root.Lstat(name)
	if err == nil && info.Mode()&fs.ModeSocket != 0 && os.SameFile(info, expected) {
		_ = dir.root.Remove(name)
	}
}

func (s *claudeServer) accept(ctx context.Context, events chan<- serverEvent) {
	for ctx.Err() == nil {
		conn, err := s.listener.AcceptUnix()
		if err != nil {
			if ctx.Err() == nil {
				queueServerEvent(ctx, events, serverEvent{err: err})
			}
			return
		}
		s.handle(ctx, conn, events)
		_ = conn.Close()
	}
}

func (s *claudeServer) handle(ctx context.Context, conn net.Conn, events chan<- serverEvent) {
	ctx, cancel := context.WithTimeout(ctx, claudeConnectionBudget)
	defer cancel()
	deadline, _ := ctx.Deadline()
	stop := context.AfterFunc(ctx, func() { _ = conn.SetDeadline(time.Now()) })
	defer stop()
	if conn.SetDeadline(deadline) != nil || ctx.Err() != nil {
		return
	}
	line, err := readSocketFrame(conn, claudeFrameLimit)
	if err != nil || ctx.Err() != nil {
		return
	}
	content, reason := frameContent(line, s.req.Generation, s.ready.Load())
	if reason != "" {
		_ = writeSocketFrame(conn, claudeReply{Refused: &reason})
		return
	}
	done := make(chan struct{}, 1)
	if !queueServerEvent(ctx, events, serverEvent{content: content, written: done, deadline: deadline}) {
		return
	}
	select {
	case <-ctx.Done():
	case <-done:
		if ctx.Err() == nil {
			_ = writeSocketFrame(conn, claudeReply{Written: true})
		}
	}
}

func queueServerEvent(ctx context.Context, events chan<- serverEvent, event serverEvent) bool {
	select {
	case <-ctx.Done():
		return false
	case events <- event:
		return true
	}
}

type serverInput struct {
	ctx      context.Context
	file     *os.File
	deadline time.Time
}

func readClaudeStdio(ctx context.Context, file *os.File, events chan<- serverEvent) {
	input := &serverInput{ctx: ctx, file: file}
	reader := bufio.NewReader(input)
	for ctx.Err() == nil {
		input.deadline = time.Time{}
		if reader.Buffered() > 0 {
			input.deadline = time.Now().Add(5 * time.Second)
		}
		line, err := readBoundedFrame(reader, claudeMCPLimit)
		if err != nil {
			queueServerEvent(ctx, events, serverEvent{err: err})
			return
		}
		if !queueServerEvent(ctx, events, serverEvent{line: line}) {
			return
		}
	}
}

// The shared framedstdio reader blocks indefinitely before the first byte.
// Poll here so cancellation can stop both server workers before socket cleanup,
// without changing descriptor flags or closing the caller's streams.
func (r *serverInput) Read(p []byte) (int, error) {
	for r.ctx.Err() == nil {
		wait := serverPoll
		if !r.deadline.IsZero() {
			wait = min(wait, time.Until(r.deadline))
			if wait <= 0 {
				return 0, framedstdio.ErrDeadline
			}
		}
		ready, err := sys.StdioReady(r.file, false, wait)
		if errors.Is(err, sys.ErrStdioInterrupted) {
			continue
		}
		if err != nil {
			return 0, err
		}
		if !ready {
			continue
		}
		if !r.deadline.IsZero() && !time.Now().Before(r.deadline) {
			return 0, framedstdio.ErrDeadline
		}
		n, retry, err := sys.StdioRead(r.file, p)
		if retry {
			continue
		}
		if err != nil {
			return 0, err
		}
		if n == 0 {
			return 0, io.EOF
		}
		if !r.deadline.IsZero() && !time.Now().Before(r.deadline) {
			return 0, framedstdio.ErrDeadline
		}
		if r.deadline.IsZero() {
			r.deadline = time.Now().Add(5 * time.Second)
		}
		return n, nil
	}
	return 0, r.ctx.Err()
}
