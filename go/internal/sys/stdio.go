//go:build darwin || linux

package sys

import (
	"errors"
	"math"
	"os"
	"time"

	"golang.org/x/sys/unix"
)

// ErrStdioInterrupted means the caller may retry a readiness probe within its deadline.
const ErrStdioInterrupted = unix.EINTR

func controlFile(file *os.File, f func(int) error) error {
	conn, err := file.SyscallConn()
	if err != nil {
		return err
	}
	var actionErr error
	if err := conn.Control(func(fd uintptr) { actionErr = f(int(fd)) }); err != nil {
		return err
	}
	return actionErr
}

// StdioIsTerminal reports whether the descriptor is a terminal.
func StdioIsTerminal(file *os.File) bool {
	terminal, _ := StdioTerminal(file)
	return terminal
}

// StdioTerminal distinguishes a redirected descriptor from a failed probe.
func StdioTerminal(file *os.File) (bool, error) {
	var terminal bool
	err := controlFile(file, func(fd int) error {
		_, err := unix.IoctlGetTermios(fd, terminalRequest)
		switch err {
		case nil:
			terminal = true
			return nil
		case unix.ENOTTY:
			return nil
		case unix.EOPNOTSUPP:
			// Darwin can report this for redirected socket-backed stdin.
			var stat unix.Stat_t
			if statErr := unix.Fstat(fd, &stat); statErr != nil {
				return statErr
			}
			if stat.Mode&unix.S_IFMT == unix.S_IFSOCK {
				return nil
			}
		}
		return err
	})
	return terminal, err
}

// StdioReady polls for read or write readiness. A negative timeout waits
// indefinitely. EINTR is returned so the caller can recompute its deadline.
func StdioReady(file *os.File, write bool, timeout time.Duration) (bool, error) {
	events := int16(unix.POLLIN)
	if write {
		events = unix.POLLOUT
	}
	ms := -1
	if timeout >= 0 {
		n := timeout / time.Millisecond
		if timeout%time.Millisecond != 0 {
			n++
		}
		ms = int(min(n, math.MaxInt32))
	}

	var ready bool
	err := controlFile(file, func(fd int) error {
		poll := []unix.PollFd{{Fd: int32(fd), Events: events}}
		if _, err := unix.Poll(poll, ms); err != nil {
			return err
		}
		observed := poll[0].Revents
		if observed&(unix.POLLERR|unix.POLLNVAL) != 0 {
			return errors.New("stdio descriptor failed")
		}
		ready = observed&(events|unix.POLLHUP) != 0
		return nil
	})
	return ready, err
}

// StdioRead reads directly from a previously polled descriptor. The caller
// owns concurrent access and must retry EINTR/EAGAIN within its deadline.
func StdioRead(file *os.File, buf []byte) (n int, retry bool, err error) {
	return stdioTransfer(file, buf, unix.Read)
}

// StdioWrite writes directly to a previously polled descriptor. The caller
// owns concurrent access and must retry EINTR/EAGAIN within its deadline.
func StdioWrite(file *os.File, buf []byte) (n int, retry bool, err error) {
	return stdioTransfer(file, buf, unix.Write)
}

func stdioTransfer(file *os.File, buf []byte, transfer func(int, []byte) (int, error)) (int, bool, error) {
	var n int
	err := controlFile(file, func(fd int) error {
		var err error
		n, err = transfer(fd, buf)
		return err
	})
	if errors.Is(err, unix.EINTR) || errors.Is(err, unix.EAGAIN) || errors.Is(err, unix.EWOULDBLOCK) {
		return 0, true, nil
	}
	if err != nil {
		return 0, false, err
	}
	return n, false, nil
}

// OpenInput opens an explicit file without waiting for a writer on a FIFO.
// The caller must check the opened descriptor's type before reading it.
func OpenInput(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_RDONLY|unix.O_NONBLOCK|unix.O_NOCTTY, 0)
}
