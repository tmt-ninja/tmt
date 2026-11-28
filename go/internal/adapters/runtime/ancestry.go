//go:build darwin || linux

package runtime

import (
	"context"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

const ancestryLimit = 4 * 1024 * 1024

// MainInPane finds a single provider between an invocation and its recorded
// pane using one process snapshot. An unknown, missing, nested or stopped
// process is no evidence. The caller verifies the pane against its binding.
func (o Observer) MainInPane(ctx context.Context, caller, pane int, provider string) (Incarnation, error) {
	if !validPID(caller) || !validPID(pane) || !runtimeName(provider) {
		return Incarnation{}, nil
	}
	got, err := o.queryPS(ctx, ancestryLimit, "-A", "-o", "pid=,ppid=,comm=")
	if err != nil || got.ExitCode != 0 {
		return Incarnation{}, err
	}
	pid := mainPID(got.Stdout, caller, pane, provider)
	if pid == 0 {
		return Incarnation{}, nil
	}
	observed, err := o.Observe(ctx, pid)
	if err != nil || observed.State != Alive {
		return Incarnation{}, err
	}
	return observed.Incarnation, nil
}

type processRow struct {
	parent     int
	command    string
	group      int
	foreground int
}

func mainPID(snapshot []byte, caller, pane int, provider string) int {
	return findMain(parseProcessRows(snapshot, false), caller, pane, provider)
}

func parseProcessRows(snapshot []byte, withGroups bool) map[int]processRow {
	if !utf8.Valid(snapshot) {
		return nil
	}
	rows := make(map[int]processRow)
	for line := range strings.SplitSeq(strings.TrimSpace(string(snapshot)), "\n") {
		pidText, rest := splitPSField(line)
		pid, err := strconv.Atoi(pidText)
		if err != nil || !validPID(pid) {
			return nil
		}
		parentText, tail := splitPSField(rest)
		parent, err := strconv.Atoi(parentText)
		if _, duplicate := rows[pid]; duplicate || err != nil || parent < 0 {
			rows[pid] = processRow{}
			continue
		}
		row := processRow{parent: parent}
		if withGroups {
			groupText, rest := splitPSField(tail)
			foregroundText, command := splitPSField(rest)
			group, groupErr := strconv.Atoi(groupText)
			foreground, foregroundErr := strconv.Atoi(foregroundText)
			if groupErr != nil || foregroundErr != nil {
				rows[pid] = processRow{}
				continue
			}
			row.group, row.foreground = group, foreground
			tail = command
		}
		if tail != "" {
			row.command = filepath.Base(tail)
		}
		rows[pid] = row
	}
	return rows
}

func findMain(rows map[int]processRow, caller, pane int, provider string) int {
	// Refuse a cyclic or excessively deep path, and require every observed
	// ancestor up to the exact pane to be present, even above the provider.
	const maxDepth = 128
	candidate := 0
	for pid, depth := caller, 0; pid > 0 && depth < maxDepth; depth++ {
		row := rows[pid]
		if row.command == "" {
			return 0
		}
		if runtimeName(row.command) {
			if candidate != 0 || row.command != provider {
				return 0
			}
			candidate = pid
		}
		if pid == pane {
			return candidate
		}
		pid = row.parent
	}
	return 0
}

func splitPSField(input string) (string, string) {
	input = strings.TrimSpace(input)
	i := strings.IndexFunc(input, unicode.IsSpace)
	if i < 0 {
		return input, ""
	}
	return input[:i], strings.TrimSpace(input[i:])
}

func runtimeName(command string) bool {
	switch command {
	case "claude", "codex", "gemini", "agy", "pi":
		return true
	default:
		return false
	}
}
