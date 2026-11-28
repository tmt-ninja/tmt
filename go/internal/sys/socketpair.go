//go:build darwin || linux

package sys

import (
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

// UnixSocketPair returns private connected endpoints. Only an explicitly
// passed child descriptor may survive exec.
func UnixSocketPair() (*os.File, *os.File, error) {
	syscall.ForkLock.RLock()
	fds, err := unix.Socketpair(unix.AF_UNIX, unix.SOCK_STREAM, 0)
	if err == nil {
		unix.CloseOnExec(fds[0])
		unix.CloseOnExec(fds[1])
	}
	syscall.ForkLock.RUnlock()
	if err != nil {
		return nil, nil, err
	}
	return os.NewFile(uintptr(fds[0]), "codex-launcher"), os.NewFile(uintptr(fds[1]), "codex-supervisor"), nil
}
