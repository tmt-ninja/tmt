//go:build darwin || linux

package sys

import (
	"errors"
	"os"
	"syscall"
)

// TryLockExclusive attempts an advisory flock on file without waiting.
// It returns false, nil when another open file description holds the lock.
// Closing file releases a successful lock, provided it has no duplicated descriptors.
func TryLockExclusive(file *os.File) (bool, error) {
	return tryLock(file, syscall.LOCK_EX)
}

// TryLockShared attempts a nonblocking shared flock on file. Contention
// with an exclusive holder returns false, nil. Closing the last descriptor
// for the open file description releases the lock.
func TryLockShared(file *os.File) (bool, error) {
	return tryLock(file, syscall.LOCK_SH)
}

func tryLock(file *os.File, mode int) (bool, error) {
	conn, err := file.SyscallConn()
	if err != nil {
		return false, err
	}
	var lockErr error
	if err := conn.Control(func(fd uintptr) {
		lockErr = syscall.Flock(int(fd), mode|syscall.LOCK_NB)
	}); err != nil {
		return false, err
	}
	if errors.Is(lockErr, syscall.EWOULDBLOCK) || errors.Is(lockErr, syscall.EAGAIN) {
		return false, nil
	}
	return lockErr == nil, lockErr
}
