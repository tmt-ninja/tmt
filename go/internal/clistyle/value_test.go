package clistyle

import (
	"strings"
	"testing"
	"time"
)

func TestHumanValues(t *testing.T) {
	for _, tc := range []struct{ path, home, want string }{
		{"/Users/ada", "/Users/ada", "~"},
		{"/Users/ada/dev/tmt", "/Users/ada", "~/dev/tmt"},
		{"/Users/adam/dev", "/Users/ada", "/Users/adam/dev"},
		{"/tmp/x", "", "/tmp/x"},
	} {
		if got := HomePath(tc.path, tc.home); got != tc.want {
			t.Errorf("HomePath(%q, %q) = %q, want %q", tc.path, tc.home, got, tc.want)
		}
	}
	if got := ShortID("ééééééééé"); got != "éééééééé" {
		t.Errorf("ShortID = %q", got)
	}
	if got := Address("claude", "e1c9ab12-77aa"); got != "claude:e1c9ab12" {
		t.Errorf("Address = %q", got)
	}
	for _, tc := range []struct {
		elapsed time.Duration
		want    string
	}{
		{4999 * time.Millisecond, "just now"},
		{5 * time.Second, "5s ago"},
		{59999 * time.Millisecond, "59s ago"},
		{time.Minute, "1m ago"},
		{2 * time.Hour, "2h ago"},
		{5 * 24 * time.Hour, "5d ago"},
	} {
		if got := RelativeTime(tc.elapsed); got != tc.want {
			t.Errorf("RelativeTime(%v) = %q, want %q", tc.elapsed, got, tc.want)
		}
	}
}

func TestDetailKeepsFullValuesAtNarrowWidths(t *testing.T) {
	width := 20
	fields := []DetailField{
		{"lifetime", "saved"},
		{"cwd", "/Users/ada/dev/a/very/long/path"},
		{"note", "line\nbreak"},
	}
	renderGolden(t, `work\ter
  lifetime  saved
  cwd       /Users/ada/dev/a/very/long/path
  note      line\nbreak
`, func(b *strings.Builder) error {
		return WriteDetail(b, Terminal{Width: &width}, "work\ter", fields)
	})
}
