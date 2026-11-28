//go:build darwin || linux

package runtime

import (
	"context"
	"errors"
	"strconv"
	"strings"
)

// ObserveStarts reads a bounded batch of exact process IDs. Missing or
// unverified IDs are absent from the returned map.
func (o Observer) ObserveStarts(ctx context.Context, pids []int) (map[int]Incarnation, error) {
	if len(pids) == 0 || len(pids) > 257 {
		return nil, errors.New("invalid process observation batch size")
	}
	requested := make(map[int]bool, len(pids))
	args := make([]string, 0, len(pids))
	for _, pid := range pids {
		if !validPID(pid) {
			return nil, errors.New("invalid process ID")
		}
		if !requested[pid] {
			requested[pid] = true
			args = append(args, strconv.Itoa(pid))
		}
	}
	got, err := o.queryPS(ctx, len(pids)*probeLimit, "-p", strings.Join(args, ","), "-o", "pid=,lstart=,stat=")
	if err != nil {
		return nil, err
	}
	starts := make(map[int]Incarnation, len(pids))
	if got.ExitCode != 0 {
		return starts, nil
	}
	reported := make(map[int]bool, len(pids))
	for line := range strings.SplitSeq(strings.TrimSpace(string(got.Stdout)), "\n") {
		rawPID, data := splitPSField(line)
		pid, err := strconv.Atoi(rawPID)
		if err != nil || !requested[pid] || reported[pid] {
			return nil, errors.New("invalid process observation batch")
		}
		reported[pid] = true
		observed := parse(pid, []byte(data))
		if observed.State == Alive || observed.State == Suspended {
			starts[pid] = observed.Incarnation
		}
	}
	return starts, nil
}

// InProcessTree reports a complete ancestry chain from child to ancestor.
func (o Observer) InProcessTree(ctx context.Context, child, ancestor int) (bool, error) {
	if !validPID(child) || !validPID(ancestor) {
		return false, nil
	}
	got, err := o.queryPS(ctx, ancestryLimit, "-A", "-o", "pid=,ppid=,comm=")
	if err != nil || got.ExitCode != 0 {
		return false, err
	}
	rows := parseProcessRows(got.Stdout, false)
	for pid, depth := child, 0; pid > 0 && depth < 128; depth++ {
		row := rows[pid]
		if row.command == "" {
			return false, nil
		}
		if pid == ancestor {
			return true, nil
		}
		pid = row.parent
	}
	return false, nil
}
