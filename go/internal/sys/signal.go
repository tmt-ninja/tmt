//go:build darwin || linux

package sys

import (
	"errors"
	"os"
	"syscall"
)

// ProcessGone reports only conclusive kernel evidence that a positive PID is absent.
func ProcessGone(pid int) bool {
	return pid > 0 && errors.Is(syscall.Kill(pid, 0), syscall.ESRCH)
}

// TerminateProcess sends one TERM to a single process using its handle when available.
func TerminateProcess(process *os.Process) error {
	return process.Signal(syscall.SIGTERM)
}
