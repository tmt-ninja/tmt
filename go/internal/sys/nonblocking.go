//go:build darwin || linux

package sys

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

// WithNonblockingFile mirrors the native handoff's temporary flag change.
// The invocation must have sole use of the file until the callback returns.
func WithNonblockingFile(file *os.File, action func() error) (returned error) {
	var flags int
	if err := controlFile(file, func(fd int) error {
		var err error
		flags, err = unix.FcntlInt(uintptr(fd), unix.F_GETFL, 0)
		if err != nil {
			return err
		}
		_, err = unix.FcntlInt(uintptr(fd), unix.F_SETFL, flags|unix.O_NONBLOCK)
		return err
	}); err != nil {
		return err
	}
	defer func() {
		returned = errors.Join(returned, controlFile(file, func(fd int) error {
			_, err := unix.FcntlInt(uintptr(fd), unix.F_SETFL, flags)
			return err
		}))
	}()
	return action()
}
