package hostgrammar

import (
	"strings"
	"testing"
)

func TestLaunchTemplateWithWholeWordPlaceholdersIsAccepted(t *testing.T) {
	tmpl, err := NewLaunchTemplate([]string{
		"herdr", "tab", "create", "--label", "{session}", "--", "{command}",
	})
	if err != nil {
		t.Fatalf("NewLaunchTemplate failed: %v", err)
	}
	if got := tmpl.Argv()[4]; got != "{session}" {
		t.Errorf("Argv()[4] = %q, want %q", got, "{session}")
	}
	if !IsPlaceholder(Session) || !IsPlaceholder(Command) || IsPlaceholder("{other}") {
		t.Errorf("IsPlaceholder mismatch")
	}

	// The session may fill several words; the command exactly one.
	if _, err := NewLaunchTemplate([]string{"sh", "{session}", "{session}", "{command}"}); err != nil {
		t.Errorf("multiple {session} failed: %v", err)
	}

	// Other words are literal, braces included: a tmux format is not a placeholder.
	script := `tmux new-window -P -F '#{pane_id}' "$2"`
	if _, err := NewLaunchTemplate([]string{"sh", "-c", script, "x", "{session}", "{command}"}); err != nil {
		t.Errorf("tmux format script failed: %v", err)
	}
}

func TestUnsafeLaunchTemplateIsRefused(t *testing.T) {
	longWord := strings.Repeat("x", 1025)
	tooMany := make([]string, 17)
	for i := range tooMany {
		tooMany[i] = "x"
	}
	tooLarge := []string{"tmux", "{session}", "{command}"}
	for range 5 {
		tooLarge = append(tooLarge, strings.Repeat("x", 1000))
	}

	cases := []struct {
		label   string
		argv    []string
		wantErr string
	}{
		{"one word", []string{"tmux"}, "launch has 2 to 16 words"},
		{"too many words", tooMany, "launch has 2 to 16 words"},
		{"no command", []string{"tmux", "{session}"}, "launch has {session} at least once and {command} exactly once"},
		{"no session", []string{"tmux", "{command}"}, "launch has {session} at least once and {command} exactly once"},
		{"two commands", []string{"tmux", "{session}", "{command}", "{command}"}, "launch has {session} at least once and {command} exactly once"},
		{"embedded placeholder", []string{"tmux", "-t", "{session}:", "{command}"}, "launch word 3 may use {session} and {command} only as whole words"},
		{"embedded in a script", []string{"sh", "-c", "run {command}", "{session}"}, "launch word 3 may use {session} and {command} only as whole words"},
		{"unknown placeholder", []string{"tmux", "{session}", "{name}", "{command}"}, "launch word 3 may use {session} and {command} only as whole words"},
		{"placeholder program", []string{"{command}", "{session}"}, "launch starts with a literal program"},
		{"empty word", []string{"tmux", "", "{session}", "{command}"}, "launch word 2 must be 1 to 1024 bytes without control characters"},
		{"control character", []string{"tmux", "a\nb", "{session}", "{command}"}, "launch word 2 must be 1 to 1024 bytes without control characters"},
		{"long word", []string{"tmux", longWord, "{session}", "{command}"}, "launch word 2 must be 1 to 1024 bytes without control characters"},
		{"total size", tooLarge, "launch is at most 4096 bytes"},
	}

	for _, tc := range cases {
		_, err := NewLaunchTemplate(tc.argv)
		if err == nil {
			t.Errorf("%s: NewLaunchTemplate(%v) succeeded, want error %q", tc.label, tc.argv, tc.wantErr)
			continue
		}
		if err.Error() != tc.wantErr {
			t.Errorf("%s: error = %q, want %q", tc.label, err.Error(), tc.wantErr)
		}
	}
}
