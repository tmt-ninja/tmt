//go:build darwin || linux

package runtime

import (
	"context"
	"math"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

// ProbeLaunchCommand observes only the pinned launcher. The matcher consumes
// bounded process arguments immediately without sending them to output.
func (o Observer) ProbeLaunchCommand(ctx context.Context, launch Incarnation, match func(command, args string) bool) (bool, error) {
	if !launch.Valid() {
		return false, nil
	}
	live, err := o.Observe(ctx, launch.PID)
	if err != nil || live.Match(launch) != Alive {
		return false, err
	}
	got, err := o.queryPS(ctx, 32*1024, "-p", strconv.Itoa(launch.PID), "-o", "comm=,args=")
	if err != nil || got.ExitCode != 0 || !utf8.Valid(got.Stdout) {
		return false, err
	}
	line := strings.TrimSpace(string(got.Stdout))
	command, args := splitPSField(line)
	if strings.ContainsRune(line, '\n') || !match(command, args) {
		return false, nil
	}
	live, err = o.Observe(ctx, launch.PID)
	return err == nil && live.Match(launch) == Alive, err
}

// ProveCodexLauncherChild accepts only a unique immediate provider under the
// pinned launcher and owner. Drivers authenticate their own launcher before
// using this proof. Process control remains attached to the original child.
func (o Observer) ProveCodexLauncherChild(ctx context.Context, identity core.Identity, binding core.Binding,
	probe core.EndpointProbe, launcher, owner Incarnation,
) (BoundProvider, error) {
	if !launcher.Valid() || !owner.Valid() || binding.PanePID == 0 || binding.PanePID > math.MaxInt32 ||
		(binding.Session.RuntimeState != "unknown" && binding.Session.RuntimeState != "ended") {
		return BoundProvider{}, nil
	}
	owned, pane := core.EvaluateBinding(identity, &binding, probe)
	if owned != core.BindingActive || binding.PaneIncarnation == nil || pane.Incarnation == nil ||
		*pane.Incarnation != *binding.PaneIncarnation {
		return BoundProvider{}, nil
	}
	selectChain := func() ([]int, error) {
		ps, err := o.queryPS(ctx, ancestryLimit, "-A", "-o", "pid=,ppid=,pgid=,tpgid=,comm=")
		if err != nil || ps.ExitCode != 0 {
			return nil, err
		}
		rows := parseProcessRows(ps.Stdout, true)
		panePID := int(binding.PanePID)
		child := uniqueForegroundChild(rows, launcher.PID, owner.PID, panePID, "codex")
		// uniqueForegroundChild has already verified the bounded complete
		// path from this child to the exact pane.
		var path []int
		for pid := child; pid != 0; pid = rows[pid].parent {
			path = append(path, pid)
			if pid == panePID {
				break
			}
		}
		return path, nil
	}
	path, err := selectChain()
	if err != nil || !slices.Contains(path, launcher.PID) || !slices.Contains(path, owner.PID) {
		return BoundProvider{}, err
	}
	paneProcess := Incarnation{PID: int(binding.PanePID), Start: *binding.PaneIncarnation}
	expected := []Incarnation{launcher, owner, paneProcess}
	pinned := make([]Incarnation, 0, len(path))
	for _, pid := range path {
		live, err := o.Observe(ctx, pid)
		if err != nil || live.State != Alive || !live.Incarnation.Valid() {
			return BoundProvider{}, err
		}
		for _, prior := range expected {
			if prior.PID == pid && live.Match(prior) != Alive {
				return BoundProvider{}, nil
			}
		}
		pinned = append(pinned, live.Incarnation)
	}
	if verified, err := selectChain(); err != nil || !slices.Equal(verified, path) {
		return BoundProvider{}, err
	}
	for _, before := range pinned {
		current, err := o.Observe(ctx, before.PID)
		if err != nil || current.Match(before) != Alive {
			return BoundProvider{}, err
		}
	}
	if err := ctx.Err(); err != nil {
		return BoundProvider{}, err
	}
	return BoundProvider{Name: "codex", Incarnation: pinned[0]}, nil
}

func uniqueForegroundChild(rows map[int]processRow, launcher, owner, pane int, driver string) int {
	if rows[launcher].parent != owner || rows[owner].command == "" {
		return 0
	}
	var candidate int
	for pid, row := range rows {
		// An ambiguous or incomplete table could hide a second child.
		if row.command == "" {
			return 0
		}
		if row.parent != launcher || row.command != driver {
			continue
		}
		if candidate != 0 {
			return 0
		}
		candidate = pid
	}
	if candidate == 0 || foregroundProvider(rows, candidate, pane) != driver {
		return 0
	}
	return candidate
}
