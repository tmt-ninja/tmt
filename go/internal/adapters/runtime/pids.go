//go:build darwin || linux

package runtime

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"
)

// ProcessIDs returns one bounded process-table snapshot. A PID in this
// snapshot is evidence against pruning, even if the PID has been reused.
func (o Observer) ProcessIDs(ctx context.Context) (map[uint64]struct{}, error) {
	const limit = 4 * 1024 * 1024
	got, err := o.queryPS(ctx, limit, "-A", "-o", "pid=,ppid=")
	if err != nil {
		return nil, err
	}
	invalid := errors.New("invalid process-table snapshot")
	if got.ExitCode != 0 || !utf8.Valid(got.Stdout) {
		return nil, invalid
	}
	pids := make(map[uint64]struct{})
	for line := range strings.SplitSeq(string(got.Stdout), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if len(fields) != 2 {
			return nil, invalid
		}
		pid, pidErr := strconv.ParseUint(fields[0], 10, 31)
		_, parentErr := strconv.ParseUint(fields[1], 10, 31)
		if pidErr != nil || parentErr != nil {
			return nil, invalid
		}
		if _, duplicate := pids[pid]; duplicate {
			return nil, invalid
		}
		pids[pid] = struct{}{}
	}
	if len(pids) == 0 {
		return nil, invalid
	}
	return pids, nil
}
