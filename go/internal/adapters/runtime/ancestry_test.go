//go:build darwin || linux

package runtime

import (
	"context"
	"slices"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestMainPIDRequiresOneRuntimeOnTheExactPaneAncestry(t *testing.T) {
	const good = "10 1 /bin/sh\n20 10 /path/claude\n30 20 /bin/sh\n40 30 /path/tmt-go\n"
	for _, tc := range []struct {
		name string
		ps   string
		want int
	}{
		{"direct", good, 20},
		{"as pane", "10 1 claude\n40 10 tmt-go\n", 10},
		{"nested different", "10 1 /bin/sh\n20 10 codex\n30 20 claude\n40 30 tmt-go\n", 0},
		{"nested same", "10 1 claude\n20 10 claude\n40 20 tmt-go\n", 0},
		{"duplicate on path", good + "20 10 claude\n", 0},
		{"missing pane", "20 10 claude\n40 20 tmt-go\n", 0},
		{"broken unrelated row", good + "99 broken\n", 20},
		{"unframed row", good + "bad row\n", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := mainPID([]byte(tc.ps), 40, 10, "claude"); got != tc.want {
				t.Fatalf("provider PID = %d, want %d", got, tc.want)
			}
		})
	}
}

type ancestryRunner func(ports.ProcessSpec) ports.Bounded

func (r ancestryRunner) Run(_ context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
	return r(spec), nil
}

func TestProcessTreeProvesBothSegmentsFromOneSnapshot(t *testing.T) {
	for _, tc := range []struct {
		name, ps string
		want     bool
	}{
		{"matches", "40 30 cli\n30 20 shell\n20 10 tmux\n10 1 tmux\n", true},
		{"caller is in another pane", "40 20 cli\n30 20 shell\n20 10 tmux\n10 1 tmux\n", false},
		{"pane belongs to another server", "40 30 cli\n30 20 shell\n20 1 tmux\n10 1 tmux\n", false},
		{"ambiguous pane row", "40 30 cli\n30 10 shell\n30 20 shell\n10 1 tmux\n", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			o := Observer{Process: ancestryRunner(func(spec ports.ProcessSpec) ports.Bounded {
				calls++
				if !slices.Equal(spec.Args, []string{"-A", "-o", "pid=,ppid=,comm="}) {
					t.Fatalf("unexpected process query %q", spec.Args)
				}
				return ports.Bounded{Stdout: []byte(tc.ps)}
			})}
			proved, err := o.InProcessTree(t.Context(), 40, 30, 10)
			if calls != 1 || err != nil || proved != tc.want {
				t.Fatalf("ancestry = %t, %v after %d probes, want %t after one", proved, err, calls, tc.want)
			}
		})
	}
}
