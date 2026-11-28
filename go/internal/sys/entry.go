//go:build darwin || linux

package sys

import (
	"errors"
	"os"
	"strings"

	"golang.org/x/sys/unix"
)

// OpenEntryNoFollow opens a single child relative to an already-open
// directory. It does not follow symlinks or wait on a substituted FIFO.
func OpenEntryNoFollow(dir *os.File, name string, flags int, perm os.FileMode) (*os.File, error) {
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\x00") {
		return nil, errors.New("invalid directory entry")
	}
	conn, err := dir.SyscallConn()
	if err != nil {
		return nil, err
	}
	var fd int
	var openErr error
	err = conn.Control(func(dirfd uintptr) {
		fd, openErr = unix.Openat(int(dirfd), name, flags|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC|unix.O_NOCTTY, uint32(perm.Perm()))
	})
	if err != nil {
		return nil, err
	}
	if openErr != nil {
		return nil, &os.PathError{Op: "openat", Path: name, Err: openErr}
	}
	return os.NewFile(uintptr(fd), name), nil
}

// SocketConnectionRefused distinguishes an explicit Unix connection refusal
// from errors that grant no evidence about the listener.
func SocketConnectionRefused(err error) bool {
	return errors.Is(err, unix.ECONNREFUSED)
}
