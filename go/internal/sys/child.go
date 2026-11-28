//go:build darwin || linux

package sys

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"syscall"
	"time"
)

// OwnProcessGroup gives a new child a process group rooted at its own PID.
func OwnProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// WaitChild waits for a child without reaping it on context failure. This must
// be the sole waiter so the caller can safely signal the group before reaping.
func WaitChild(ctx context.Context, child *os.Process) (int, error) {
	var status syscall.WaitStatus
	var retry *time.Ticker
	for {
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		pid, err := syscall.Wait4(child.Pid, &status, syscall.WNOHANG, nil)
		if err != nil && !errors.Is(err, syscall.EINTR) {
			return 0, err
		}
		if pid == child.Pid {
			// Wait4 has consumed the wait status. Release Go's process handle.
			_ = child.Release()
			return status.ExitStatus(), nil
		}
		if retry == nil {
			retry = time.NewTicker(time.Millisecond)
			defer retry.Stop()
		}
		select {
		case <-ctx.Done():
			return 0, ctx.Err()
		case <-retry.C:
		}
	}
}

// KillChildGroup signals the invocation-owned group while its leader is still
// unreaped, which pins the numeric group ID against reuse.
func KillChildGroup(pid int) error {
	err := syscall.Kill(-pid, syscall.SIGKILL)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}

// ChildGroupGone only inspects the numeric group. It is safe after reaping,
// when signaling the group would risk reaching a recycled ID.
func ChildGroupGone(pid int) bool {
	return errors.Is(syscall.Kill(-pid, 0), syscall.ESRCH)
}
