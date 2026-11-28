package sys

import (
	"context"

	"golang.org/x/sys/unix"
)

func readProcessStarts(ctx context.Context, pids []int) ([]ProcessStart, bool) {
	return collectProcessStarts(ctx, pids, readProcessStart)
}

func readProcessStart(pid int) (ProcessStart, bool) {
	info, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
	if err != nil || int(info.Proc.P_pid) != pid || info.Proc.P_starttime.Sec <= 0 {
		return ProcessStart{}, false
	}
	var state byte
	switch info.Proc.P_stat {
	case 2: // SRUN
		state = 'R'
	case 3: // SSLEEP
		state = 'S'
	case 4: // SSTOP
		state = 'T'
	case 5: // SZOMB
		state = 'Z'
	default:
		return ProcessStart{}, false
	}
	return ProcessStart{Seconds: uint64(info.Proc.P_starttime.Sec), State: state}, true
}
