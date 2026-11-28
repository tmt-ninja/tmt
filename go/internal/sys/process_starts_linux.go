package sys

import (
	"bytes"
	"context"
	"io"
	"math"
	"os"
	"strconv"

	"golang.org/x/sys/unix"
)

// AT_CLKTCK is the process clock rate in the Linux ELF auxiliary vector.
const clockTickKey = 17

func readProcessStarts(ctx context.Context, pids []int) ([]ProcessStart, bool) {
	proc, err := os.Open("/proc")
	if err != nil {
		return nil, false
	}
	defer proc.Close()

	aux, err := unix.Auxv()
	if err != nil {
		return nil, false
	}
	var hz uint64
	for _, entry := range aux {
		if entry[0] == clockTickKey {
			hz = uint64(entry[1])
			break
		}
	}
	boot, ok := procBootSeconds(readProcEntry(proc, "stat", 1<<20))
	if hz == 0 || !ok {
		return nil, false
	}

	return collectProcessStarts(ctx, pids, func(pid int) (ProcessStart, bool) {
		dir, err := OpenEntryNoFollow(proc, strconv.Itoa(pid), unix.O_RDONLY|unix.O_DIRECTORY, 0)
		if err != nil {
			return ProcessStart{}, false
		}
		defer dir.Close()

		state, ticks, ok := parseProcPIDStat(pid, readProcEntry(dir, "stat", 8192))
		if !ok || ticks/hz > math.MaxUint64-boot {
			return ProcessStart{}, false
		}
		return ProcessStart{Seconds: boot + ticks/hz, State: state}, true
	})
}

func readProcEntry(dir *os.File, name string, limit int64) []byte {
	file, err := OpenEntryNoFollow(dir, name, unix.O_RDONLY, 0)
	if err != nil {
		return nil
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return nil
	}
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(data)) > limit {
		return nil
	}
	return data
}

func procBootSeconds(data []byte) (uint64, bool) {
	for line := range bytes.SplitSeq(data, []byte("\n")) {
		if value, ok := bytes.CutPrefix(line, []byte("btime ")); ok {
			seconds, err := strconv.ParseUint(string(bytes.TrimSpace(value)), 10, 64)
			return seconds, err == nil
		}
	}
	return 0, false
}

func parseProcPIDStat(pid int, data []byte) (byte, uint64, bool) {
	// The command can contain whitespace and parentheses. Only the final
	// closing parenthesis is the delimiter for the remaining numeric fields.
	open := bytes.IndexByte(data, '(')
	close := bytes.LastIndexByte(data, ')')
	if open < 0 || close <= open {
		return 0, 0, false
	}
	recovered, err := strconv.Atoi(string(bytes.TrimSpace(data[:open])))
	if err != nil || recovered != pid {
		return 0, 0, false
	}
	fields := bytes.Fields(data[close+1:])
	// The suffix begins at stat field 3 (state); starttime is field 22.
	if len(fields) < 20 || len(fields[0]) != 1 {
		return 0, 0, false
	}
	ticks, err := strconv.ParseUint(string(fields[19]), 10, 64)
	return fields[0][0], ticks, err == nil
}
