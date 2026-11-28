package sys

import "golang.org/x/sys/unix"

func unixPeer(fd int) (uint32, int, error) {
	owner, err := unix.GetsockoptXucred(fd, unix.SOL_LOCAL, unix.LOCAL_PEERCRED)
	if err != nil {
		return 0, 0, err
	}
	pid, err := unix.GetsockoptInt(fd, unix.SOL_LOCAL, unix.LOCAL_PEERPID)
	return owner.Uid, pid, err
}
