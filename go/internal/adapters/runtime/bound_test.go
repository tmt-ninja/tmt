//go:build darwin || linux

package runtime

import "testing"

func TestForegroundProviderRequiresExactMainPlacement(t *testing.T) {
	for _, tc := range []struct {
		name string
		rows string
		want string
	}{
		{"claude", "10 1 10 20 sh\n20 10 20 20 /bin/claude", "claude"},
		{"codex", "10 1 10 20 sh\n20 10 20 20 /bin/codex", "codex"},
		{"gemini", "10 1 10 20 sh\n20 10 20 20 /bin/gemini", "gemini"},
		{"generic wrapper", "10 1 10 20 sh\n20 10 20 20 /bin/node", ""},
		{"background", "10 1 10 10 sh\n20 10 20 10 /bin/claude", ""},
		{"no tty", "10 1 10 0 sh\n20 10 20 0 /bin/claude", ""},
		{"different tty group", "10 1 10 40 sh\n20 10 20 20 /bin/claude", ""},
		{"nested", "10 1 10 20 codex\n20 10 20 20 /bin/claude", ""},
		{"nested gemini", "10 1 10 20 gemini\n20 10 20 20 /bin/codex", ""},
		{"unrelated pane", "10 1 10 20 sh\n20 5 20 20 /bin/claude\n5 1 5 20 sh", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rows := parseProcessRows([]byte(tc.rows), true)
			if got := foregroundProvider(rows, 20, 10); got != tc.want {
				t.Fatalf("provider = %q, want %q", got, tc.want)
			}
		})
	}
}
