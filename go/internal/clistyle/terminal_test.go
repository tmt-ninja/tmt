package clistyle

import (
	"os"
	"testing"
)

func TestTerminalWidthFallback(t *testing.T) {
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = read.Close()
		_ = write.Close()
	})
	for _, stream := range []*os.File{nil, write} {
		if cols, known := ProbeWidth(stream); cols != 0 || known {
			t.Errorf("ProbeWidth = %d, %t", cols, known)
		}
		if cols := TerminalWidth(stream); cols != 80 {
			t.Errorf("TerminalWidth = %d, want 80", cols)
		}
	}
}

func TestStreamColorPolicy(t *testing.T) {
	for _, tc := range []struct {
		tty  bool
		env  map[string]string
		want Depth
	}{
		{true, map[string]string{"TERM": "xterm", "COLORTERM": "truecolor"}, TrueColor},
		{false, map[string]string{"TERM": "xterm"}, NoColor},
		{false, map[string]string{"CLICOLOR_FORCE": "1"}, ANSI16},
		{false, map[string]string{"CLICOLOR_FORCE": "1", "NO_COLOR": "1"}, NoColor},
		{true, map[string]string{"CLICOLOR": "0", "TERM": "xterm"}, NoColor},
		{true, map[string]string{"TERM": "dumb"}, NoColor},
		{true, map[string]string{"TERM": "dumb", "CLICOLOR": "1"}, ANSI16},
		{true, map[string]string{"CI": "true"}, ANSI16},
		{true, nil, NoColor},
	} {
		lookup := func(key string) (string, bool) {
			value, ok := tc.env[key]
			return value, ok
		}
		if got := streamDepth(tc.tty, lookup); got != tc.want {
			t.Errorf("depth (tty=%t, env=%v) = %d, want %d", tc.tty, tc.env, got, tc.want)
		}
	}
}
