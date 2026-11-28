//go:build darwin || linux

package sys

import (
	"errors"
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

type TerminalReady struct {
	Input, Socket, Wake bool
}

// PollTerminal waits for input, a supervisor socket or a wake pipe without
// changing any descriptor flags. A ready socket may contain EOF.
func PollTerminal(input, socket, wake syscall.Conn, immediate bool) (TerminalReady, error) {
	files := [...]syscall.Conn{input, socket, wake}
	var poll [3]unix.PollFd
	var wait func(int) error
	wait = func(index int) error {
		if index == len(files) {
			timeout := -1
			if immediate {
				timeout = 0
			}
			_, err := unix.Poll(poll[:], timeout)
			if errors.Is(err, unix.EINTR) {
				return nil
			}
			return err
		}
		raw, err := files[index].SyscallConn()
		if err != nil {
			return err
		}
		var result error
		if err := raw.Control(func(fd uintptr) {
			poll[index] = unix.PollFd{Fd: int32(fd), Events: unix.POLLIN}
			result = wait(index + 1)
		}); err != nil {
			return err
		}
		return result
	}
	if err := wait(0); err != nil {
		return TerminalReady{}, err
	}
	for _, file := range poll {
		if file.Revents&(unix.POLLERR|unix.POLLNVAL) != 0 {
			return TerminalReady{}, errors.New("terminal descriptor is unavailable")
		}
	}
	ready := func(file unix.PollFd) bool { return file.Revents&(unix.POLLIN|unix.POLLHUP) != 0 }
	return TerminalReady{Input: ready(poll[0]), Socket: ready(poll[1]), Wake: ready(poll[2])}, nil
}

func TerminalSignals() []os.Signal {
	return []os.Signal{unix.SIGWINCH, unix.SIGHUP, unix.SIGINT, unix.SIGQUIT, unix.SIGTERM}
}

func IsTerminalResize(signal os.Signal) bool { return signal == unix.SIGWINCH }

func TerminalSignalNumber(signal os.Signal) int {
	number, _ := signal.(syscall.Signal)
	return int(number)
}

// UnixPeer verifies kernel-reported credentials for an already connected socket.
func UnixPeer(socket syscall.Conn) (uid uint32, pid int, err error) {
	raw, err := socket.SyscallConn()
	if err != nil {
		return 0, 0, err
	}
	var peerErr error
	if err := raw.Control(func(fd uintptr) { uid, pid, peerErr = unixPeer(int(fd)) }); err != nil {
		return 0, 0, err
	}
	return uid, pid, peerErr
}
