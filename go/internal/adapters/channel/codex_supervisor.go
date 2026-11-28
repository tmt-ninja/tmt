//go:build darwin || linux

package channel

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/framedstdio"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/invoke"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

const codexControlLimit = 64 * 1024

type codexSupervisorRequest struct {
	executable string
	binding    string
	generation string
	root       home.Root
	build      string
}

// CodexServeRequest is the validated internal supervisor dispatch request.
type CodexServeRequest struct{ inner codexSupervisorRequest }

func ParseCodexServeRequest(root home.Root, args []string, build string) (CodexServeRequest, error) {
	if len(args) != 4 || args[0] != "codex" || args[3] != ClaudeDirectory(root) ||
		!filepath.IsAbs(root.Dir) || !core.ValidUUID(args[1]) || !core.ValidUUID(args[2]) {
		return CodexServeRequest{}, ErrEnrollment
	}
	return CodexServeRequest{inner: codexSupervisorRequest{binding: args[1], generation: args[2], root: root, build: build}}, nil
}

type codexControlStart struct {
	Path   string   `json:"path"`
	Args   []string `json:"args"`
	CWD    string   `json:"cwd"`
	Resume string   `json:"resume"`
}

type codexControlReady struct {
	Generation string `json:"generation"`
}

type codexSupervisor struct {
	control net.Conn
	process *os.Process
	lease   *codexLease
}

// startCodexSupervisor returns a launcher-side view. The helper process
// alone owns the app-server child. No launcher descriptor reaches either
// the app-server or the foreground.
func startCodexSupervisor(ctx context.Context, runner ports.Process, req codexEnrollment, executable string) (*codexSupervisor, error) {
	if !validLaunchPath(executable) {
		return nil, ErrEnrollment
	}
	ctx, cancel := context.WithTimeout(ctx, codexStartupBudget)
	defer cancel()
	start := codexControlStart{Path: req.plan.selected.Path, Args: req.plan.selected.Args, CWD: req.plan.baseCWD, Resume: req.plan.resume}
	payload, err := json.Marshal(start)
	if err != nil || len(payload)+1 > codexControlLimit {
		return nil, ErrEnrollment
	}
	record, observer, err := beginCodexLaunch(ctx, runner, req)
	if err != nil {
		return nil, err
	}
	coords := codexSupervisorRequest{executable: executable, binding: record.BindingID, generation: record.Generation, root: req.root, build: req.build}
	supervisor, err := launchCodexSupervisor(ctx, coords, req.plan.selected.Env)
	if err != nil {
		cleanup, stop := context.WithTimeout(context.WithoutCancel(ctx), lockWait)
		defer stop()
		return nil, errors.Join(err, retireCodexRecord(cleanup, req.root, record))
	}
	if err := supervisor.initialize(ctx, req, record, observer, payload); err != nil {
		return nil, errors.Join(err, supervisor.stop(true))
	}
	return supervisor, nil
}

func launchCodexSupervisor(ctx context.Context, req codexSupervisorRequest, env []string) (*codexSupervisor, error) {
	launcher, child, err := sys.UnixSocketPair()
	if err != nil {
		return nil, err
	}
	defer launcher.Close()
	defer child.Close()
	control, err := net.FileConn(launcher)
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(req.executable, "__channel-server", "codex", req.binding, req.generation, ClaudeDirectory(req.root))
	if env == nil {
		env = os.Environ()
	}
	cmd.Env = invoke.OverlayEnv(withoutCodexCapability(env), []string{home.EnvHome + "=" + req.root.Dir})
	cmd.Stdin, cmd.Stdout, cmd.Stderr = child, child, os.Stderr
	sys.OwnProcessGroup(cmd)
	if err := ctx.Err(); err != nil {
		control.Close()
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		control.Close()
		return nil, err
	}
	return &codexSupervisor{control: control, process: cmd.Process}, nil
}

func (s *codexSupervisor) initialize(ctx context.Context, req codexEnrollment, record codexRecord, observer runtime.Observer, payload []byte) error {
	control := s.control
	deadline, _ := ctx.Deadline()
	beforeIO := func() bool { return ctx.Err() == nil && time.Now().Before(deadline) }
	stop := context.AfterFunc(ctx, func() { _ = control.SetDeadline(time.Now()) })
	defer stop()
	if err := control.SetDeadline(deadline); err != nil || !beforeIO() {
		return ErrEnrollment
	}
	frame := append(payload, '\n')
	n, err := control.Write(frame)
	if err != nil || n != len(frame) {
		return ErrEnrollment
	}
	raw, err := readSocketFrame(control, codexControlLimit)
	if err != nil || !beforeIO() {
		return ErrEnrollment
	}
	response, err := strictObject(raw, "generation")
	if err != nil || codexString(response["generation"]) != record.Generation {
		return ErrEnrollment
	}
	s.lease, err = codexLauncherLease(ctx, req, record, observer)
	return err
}

func codexLauncherLease(ctx context.Context, req codexEnrollment, record codexRecord, observer runtime.Observer) (*codexLease, error) {
	dir, err := openCodexDir(req.root, false)
	if err != nil {
		return nil, err
	}
	defer dir.close()
	stored, err := dir.readCodex(record.BindingID)
	if err != nil || stored == nil || !sameCodexLaunch(*stored, record) || stored.Foreground.Process != nil {
		return nil, ErrEnrollmentChanged
	}
	cwd, err := filepath.EvalSymlinks(req.plan.cwd)
	if err != nil {
		return nil, err
	}
	var endpoint processRecord
	var port uint16
	if req.plan.resume != "" {
		if stored.Ready == nil || stored.Ready.Thread != req.plan.resume {
			return nil, ErrEnrollmentChanged
		}
		endpoint, port = stored.Ready.Server, stored.Ready.Port
	} else {
		if stored.Fresh == nil || stored.Fresh.Thread != nil || stored.Ready != nil || stored.Fresh.CWD != cwd {
			return nil, ErrEnrollmentChanged
		}
		endpoint, port = stored.Fresh.Server, stored.Fresh.Port
	}
	if processState(ctx, observer, endpoint) != runtime.Alive || processState(ctx, observer, record.LaunchOwner) != runtime.Alive {
		return nil, ErrEnrollment
	}
	transport, err := readCodexEndpoint(dir, filepath.Join(ClaudeDirectory(req.root), codexDirectory), record.Generation, port)
	if err != nil {
		return nil, err
	}
	command, err := req.plan.remoteForeground(transport.address, transport.token)
	if err != nil {
		return nil, err
	}
	return &codexLease{
		root: req.root, record: record, endpoint: transport, endpointProcess: endpoint, observer: observer,
		cwd: cwd, command: command, build: req.build,
	}, nil
}

// stop closes the only launcher end. Withdrawal is explicit and may only be
// requested after no foreground was spawned or the exact child was reaped.
func (s *codexSupervisor) stop(withdraw bool) error {
	if s.control == nil {
		return nil
	}
	var requestErr error
	if withdraw {
		requestErr = s.control.SetWriteDeadline(time.Now().Add(time.Second))
		if requestErr == nil {
			_, requestErr = s.control.Write([]byte{'W'})
		}
	}
	_ = s.control.Close()
	s.control = nil
	ctx, cancel := context.WithTimeout(context.Background(), codexStartupBudget+5*time.Second)
	defer cancel()
	status, err := sys.WaitChild(ctx, s.process)
	if errors.Is(err, context.DeadlineExceeded) {
		// Never kill our supervisor to force a timeout: it must retain
		// ownership of its own app-server until it can reap it.
		go func() { _, _ = s.process.Wait() }()
	} else if err != nil {
		_ = s.process.Release()
	}
	if err != nil || status != 0 {
		return errors.Join(errCodexCleanup, requestErr, err)
	}
	return requestErr
}

// ServeCodexSupervisor is the hidden worker, launched with one private socket
// connected on stdin/stdout. The only command after Ready is withdrawal.
func ServeCodexSupervisor(ctx context.Context, req CodexServeRequest, runner ports.Process, input, output *os.File) error {
	if input == nil || output == nil {
		return ErrEnrollment
	}
	if err := framedstdio.RequireRedirected(input, output); err != nil {
		return err
	}
	observer := runtime.Observer{Process: runner}
	pending, err := pendingCodexSupervisor(ctx, req.inner, observer)
	if err != nil {
		return err
	}
	startup, cancel := context.WithTimeout(ctx, codexStartupBudget)
	lease, reader, err := prepareCodexSupervisor(startup, ctx, req.inner, *pending, observer, input, output)
	cancel()
	if err != nil {
		return err
	}
	// The complete Ready frame may have escaped. EOF now tears down only
	// the endpoint, leaving enrollment evidence across launcher death.
	b, err := reader.ReadByte()
	if errors.Is(err, io.EOF) {
		return lease.server.stop()
	}
	if err != nil || b != 'W' {
		return errors.Join(ErrEnrollment, err, lease.server.stop())
	}
	cleanup, stop := context.WithTimeout(context.WithoutCancel(ctx), lockWait+codexCleanupBudget)
	defer stop()
	return lease.withdraw(cleanup)
}

func pendingCodexSupervisor(ctx context.Context, req codexSupervisorRequest, observer runtime.Observer) (*codexRecord, error) {
	if !core.ValidUUID(req.binding) || !core.ValidUUID(req.generation) {
		return nil, ErrEnrollment
	}
	dir, err := openCodexDir(req.root, false)
	if err != nil {
		return nil, err
	}
	defer dir.close()
	record, err := dir.readCodex(req.binding)
	if err != nil || record == nil || record.Generation != req.generation || record.Attribution == nil ||
		record.Fresh != nil || record.Ready != nil || record.Foreground.Process != nil ||
		record.LaunchOwner.PID != uint64(os.Getppid()) || processState(ctx, observer, record.LaunchOwner) != runtime.Alive {
		return nil, ErrEnrollment
	}
	return record, nil
}

func prepareCodexSupervisor(ctx, lifetime context.Context, req codexSupervisorRequest, record codexRecord,
	observer runtime.Observer, input, output *os.File,
) (*codexLease, *bufio.Reader, error) {
	source := &serverInput{ctx: ctx, file: input}
	reader := bufio.NewReader(source)
	raw, err := readBoundedFrame(reader, codexControlLimit)
	if err != nil {
		return nil, nil, errors.Join(err, retireCodexAfterBadStart(ctx, req.root, record))
	}
	start, err := parseCodexControlStart(raw)
	if err != nil {
		return nil, nil, errors.Join(err, retireCodexAfterBadStart(ctx, req.root, record))
	}
	plan, err := PlanCodexLaunch(ports.ProcessSpec{Path: start.Path, Args: start.Args, Env: os.Environ()}, start.CWD, start.Resume)
	if err != nil {
		return nil, nil, errors.Join(err, retireCodexAfterBadStart(ctx, req.root, record))
	}
	lease, err := startCodexFromRecord(ctx, req.root, record, plan, req.build, observer)
	if err != nil {
		return nil, nil, err
	}
	payload, _ := json.Marshal(codexControlReady{Generation: req.generation})
	deadline, _ := ctx.Deadline()
	if err := framedstdio.PublishProgress(ctx, output, payload, codexControlLimit-1, deadline); err != nil {
		cleanup, stop := context.WithTimeout(context.WithoutCancel(ctx), lockWait+codexCleanupBudget)
		defer stop()
		return nil, nil, errors.Join(err, lease.withdraw(cleanup))
	}
	// The startup deadline must not end an active launch's control stream.
	source.ctx = lifetime
	source.deadline = time.Time{}
	return lease, reader, nil
}

func parseCodexControlStart(raw []byte) (codexControlStart, error) {
	if _, err := strictObject(raw, "path", "args", "cwd", "resume"); err != nil {
		return codexControlStart{}, ErrEnrollment
	}
	var start codexControlStart
	if err := json.Unmarshal(raw, &start); err != nil || !validLaunchPath(start.Path) || !validLaunchPath(start.CWD) {
		return codexControlStart{}, ErrEnrollment
	}
	return start, nil
}

func retireCodexAfterBadStart(ctx context.Context, root home.Root, record codexRecord) error {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), lockWait)
	defer cancel()
	return retireCodexRecord(cleanup, root, record)
}

func withoutCodexCapability(env []string) []string {
	return slices.DeleteFunc(slices.Clone(env), func(entry string) bool {
		return strings.HasPrefix(entry, codexTokenEnv+"=")
	})
}
