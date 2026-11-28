//go:build darwin || linux

package sys

import (
	"context"
	"math"
)

// ProcessStart is one native start-time and state observation.
type ProcessStart struct {
	Seconds uint64
	State   byte
}

// ReadProcessStarts observes only the requested PIDs. A missing or unreadable
// native source returns false so the caller can try a single bounded ps query.
func ReadProcessStarts(ctx context.Context, pids []int) ([]ProcessStart, bool) {
	if len(pids) == 0 || len(pids) > 257 || ctx.Err() != nil {
		return nil, false
	}
	for _, pid := range pids {
		if pid <= 0 || pid > math.MaxInt32 {
			return nil, false
		}
	}
	return readProcessStarts(ctx, pids)
}

func collectProcessStarts(ctx context.Context, pids []int, read func(int) (ProcessStart, bool)) ([]ProcessStart, bool) {
	starts := make([]ProcessStart, 0, len(pids))
	for _, pid := range pids {
		if ctx.Err() != nil {
			return nil, false
		}
		start, ok := read(pid)
		if !ok {
			if !ProcessGone(pid) {
				return nil, false
			}
			start.State = 'X'
		}
		starts = append(starts, start)
	}
	return starts, ctx.Err() == nil
}
