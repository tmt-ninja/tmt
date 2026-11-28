//go:build darwin || linux

package runtime

import "testing"

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
