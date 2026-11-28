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
	unique := make([]int, 0, len(pids))
	for _, pid := range pids {
		if !validPID(pid) {
			return nil, errors.New("invalid process ID")
		}
		if !requested[pid] {
			requested[pid] = true
			unique = append(unique, pid)
		}
	}
	starts := make(map[int]Incarnation, len(unique))
	if observations, ok := o.nativeStarts(ctx, unique); ok {
		for i, observed := range observations {
			if observed.State == Alive || observed.State == Suspended {
				starts[unique[i]] = observed.Incarnation
			}
		}
		return starts, nil
	}
	args := make([]string, 0, len(unique))
	for _, pid := range unique {
		args = append(args, strconv.Itoa(pid))
	}
	got, err := o.queryPS(ctx, len(pids)*probeLimit, "-p", strings.Join(args, ","), "-o", "pid=,lstart=,stat=")
	if err != nil {
		return nil, err
	}
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

// InProcessTree proves both ancestry segments from one process-table snapshot.
func (o Observer) InProcessTree(ctx context.Context, child, through, ancestor int) (bool, error) {
	if !validPID(child) || !validPID(through) || !validPID(ancestor) {
		return false, nil
	}
	got, err := o.queryPS(ctx, ancestryLimit, "-A", "-o", "pid=,ppid=,comm=")
	if err != nil || got.ExitCode != 0 {
		return false, err
	}
	rows := parseProcessRows(got.Stdout, false)
	return processDescends(rows, child, through) && processDescends(rows, through, ancestor), nil
}

func processDescends(rows map[int]processRow, child, ancestor int) bool {
	for pid, depth := child, 0; pid > 0 && depth < 128; depth++ {
		row := rows[pid]
		if row.command == "" {
			return false
		}
		if pid == ancestor {
			return true
		}
		pid = row.parent
	}
	return false
}

// IsProcessParent verifies the immediate parent in one bounded observation.
func (o Observer) IsProcessParent(ctx context.Context, child, parent int) (bool, error) {
	if !validPID(child) || !validPID(parent) || child == parent {
		return false, nil
	}
	got, err := o.queryPS(ctx, probeLimit, "-p", strconv.Itoa(child), "-o", "pid=,ppid=")
	if err != nil || got.ExitCode != 0 {
		return false, err
	}
	fields := strings.Fields(string(got.Stdout))
	return len(fields) == 2 && fields[0] == strconv.Itoa(child) && fields[1] == strconv.Itoa(parent), nil
}
