//go:build darwin || linux

package runtime

import "testing"

func TestSelectedLauncherMustHaveOneExactImmediateForegroundProvider(t *testing.T) {
	const base = "10 1 10 30 sh\n20 10 30 30 tmt\n30 20 30 30 node\n40 30 30 30 codex\n"
	for _, tc := range []struct {
		name, rows string
		want       int
	}{
		{"exact", base, 40},
		{"another named child", base + "41 30 60 30 codex\n", 0},
		{"other wrapper", base + "41 20 30 30 codex\n", 40},
		{"unknown row could hide a child", base + "40 bad row\n", 0},
		{"wrong owner", "10 1 10 30 sh\n20 10 30 30 tmt\n30 10 30 30 node\n40 30 30 30 codex\n", 0},
		{"provider is in background", "10 1 10 30 sh\n20 10 30 30 tmt\n30 20 30 30 node\n40 30 40 30 codex\n", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := uniqueForegroundChild(parseProcessRows([]byte(tc.rows), true), 30, 20, 10, "codex")
			if got != tc.want {
				t.Fatalf("selected foreground PID = %d, want %d", got, tc.want)
			}
		})
	}
}
