package sys

import "golang.org/x/sys/unix"

func unixPeer(fd int) (uint32, int, error) {
	peer, err := unix.GetsockoptUcred(fd, unix.SOL_SOCKET, unix.SO_PEERCRED)
	if err != nil {
		return 0, 0, err
	}
	return peer.Uid, int(peer.Pid), nil
}
