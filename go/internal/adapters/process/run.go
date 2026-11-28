//go:build darwin || linux

package process

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

// Runner executes bounded foreground captures in invocation-owned groups.
type Runner struct {
	underSupervisor bool
}

// SupervisedProbes keeps bounded leaf probes inside a worker's outer owned
// group. A local timeout signals the exact leaf while the outer parent can
// still clean up the entire group if it loses the worker.
func SupervisedProbes() (Runner, error) {
	if !sys.OwnsProcessGroup() {
		return Runner{}, errors.New("probe worker does not own its process group")
	}
	return Runner{underSupervisor: true}, nil
}

var _ ports.Process = Runner{}

// NativeProcessStarts provides the local runtime observer with kernel evidence.
func (Runner) NativeProcessStarts(ctx context.Context, pids []int) ([]sys.ProcessStart, bool) {
	return sys.ReadProcessStarts(ctx, pids)
}

// ErrOutputLimit means the child exceeded its byte budget on one stream.
var ErrOutputLimit = errors.New("child output limit exceeded")

func (r Runner) Run(ctx context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
	if !filepath.IsAbs(spec.Path) {
		return ports.Bounded{}, errors.New("child executable must be absolute")
	}
	if spec.Dir != "" && !filepath.IsAbs(spec.Dir) {
		return ports.Bounded{}, errors.New("child working directory must be absolute")
	}
	if spec.Timeout <= 0 || spec.MaxOut < 0 {
		return ports.Bounded{}, errors.New("child requires a positive timeout and a nonnegative output limit")
	}
	ctx, cancel := context.WithTimeout(ctx, spec.Timeout)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return ports.Bounded{}, err
	}

	cmd := exec.Command(spec.Path, spec.Args...)
	cmd.Dir = spec.Dir
	cmd.Env = spec.Env
	if cmd.Env == nil {
		cmd.Env = []string{}
	}
	if !r.underSupervisor {
		sys.OwnProcessGroup(cmd)
	}

	// With direct descriptors, Go does not create internal copy workers or
	// own the pipes. Keep the child unreaped until all pipe observations end.
	stdin, input, err := os.Pipe()
	if err != nil {
		return ports.Bounded{}, err
	}
	defer input.Close()
	defer stdin.Close()
	stdout, childOut, err := os.Pipe()
	if err != nil {
		return ports.Bounded{}, err
	}
	defer stdout.Close()
	defer childOut.Close()
	stderr, childErr, err := os.Pipe()
	if err != nil {
		return ports.Bounded{}, err
	}
	defer stderr.Close()
	defer childErr.Close()

	cmd.Stdin, cmd.Stdout, cmd.Stderr = stdin, childOut, childErr
	if err := ctx.Err(); err != nil {
		return ports.Bounded{}, err
	}
	if err := cmd.Start(); err != nil {
		return ports.Bounded{}, fmt.Errorf("start child: %w", err)
	}
	_ = stdin.Close()
	_ = childOut.Close()
	_ = childErr.Close()

	var inputDone <-chan struct{}
	if len(spec.Stdin) == 0 {
		_ = input.Close()
	} else {
		done := make(chan struct{})
		inputDone = done
		go func() {
			defer close(done)
			defer input.Close()
			// A child may finish without reading all of its input.
			_, _ = io.Copy(input, bytes.NewReader(spec.Stdin))
		}()
	}
	out := readStream(stdout, "stdout", spec.MaxOut)
	diagnostics := readStream(stderr, "stderr", spec.MaxOut)
	var result ports.Bounded
	for out != nil || diagnostics != nil || inputDone != nil {
		select {
		case <-inputDone:
			inputDone = nil
		case <-ctx.Done():
			return ports.Bounded{}, r.stop(cmd.Process, ctx.Err())
		case stream := <-out:
			if stream.err != nil {
				return ports.Bounded{Truncated: errors.Is(stream.err, ErrOutputLimit)}, r.stop(cmd.Process, stream.err)
			}
			result.Stdout = stream.data
			out = nil
		case stream := <-diagnostics:
			if stream.err != nil {
				return ports.Bounded{Truncated: errors.Is(stream.err, ErrOutputLimit)}, r.stop(cmd.Process, stream.err)
			}
			result.Stderr = stream.data
			diagnostics = nil
		}
	}

	result.ExitCode, err = sys.WaitChild(ctx, cmd.Process)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return ports.Bounded{}, r.stop(cmd.Process, err)
		}
		// A failed wait no longer proves ownership of the numeric group ID.
		_ = cmd.Process.Release()
		return ports.Bounded{}, fmt.Errorf("wait for child: %w", err)
	}
	return result, nil
}

type streamResult struct {
	data []byte
	err  error
}

func readStream(reader *os.File, name string, limit int) <-chan streamResult {
	done := make(chan streamResult, 1)
	go func() {
		capped := &io.LimitedReader{R: reader, N: int64(limit)}
		data, err := io.ReadAll(capped)
		if err == nil && capped.N == 0 {
			var extra [1]byte
			n, readErr := reader.Read(extra[:])
			if n != 0 {
				err = ErrOutputLimit
			} else if readErr != io.EOF {
				err = readErr
			}
		}
		if err != nil {
			done <- streamResult{err: fmt.Errorf("%s: %w", name, err)}
			return
		}
		done <- streamResult{data: data}
	}()
	return done
}

func (r Runner) stop(child *os.Process, cause error) error {
	pid := child.Pid
	var signalErr error
	if r.underSupervisor {
		signalErr = child.Kill()
		if errors.Is(signalErr, os.ErrProcessDone) {
			signalErr = nil
		}
	} else {
		signalErr = sys.KillChildGroup(pid)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, waitErr := sys.WaitChild(ctx, child)
	if errors.Is(waitErr, context.DeadlineExceeded) {
		// Keep a single reaper even if the exited child is not yet waitable.
		go func() { _, _ = child.Wait() }()
	} else if waitErr != nil {
		_ = child.Release()
	}
	// Darwin can deny a signal to a group containing only zombies.
	if !r.underSupervisor && waitErr == nil && errors.Is(signalErr, os.ErrPermission) && sys.ChildGroupGone(pid) {
		signalErr = nil
	}
	if cleanupErr := errors.Join(signalErr, waitErr); cleanupErr != nil {
		return errors.Join(cause, fmt.Errorf("child cleanup unconfirmed: %w", cleanupErr))
	}
	return cause
}
