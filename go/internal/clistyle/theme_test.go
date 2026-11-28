package clistyle

import "testing"

func TestRolePaintGolden(t *testing.T) {
	for _, tc := range []struct {
		theme Theme
		depth Depth
		role  Role
		want  string
	}{
		{ThemeDark, TrueColor, RoleAccent, "\x1b[38;2;122;162;247mtext\x1b[0m"},
		{ThemeLight, TrueColor, RoleSelection, "\x1b[48;2;200;200;200mtext\x1b[0m"},
		{ThemeLight, ANSI16, RoleAccent, "\x1b[34mtext\x1b[0m"},
		{ThemeTerminal, TrueColor, RoleMatrixUrgent, "\x1b[93mtext\x1b[0m"},
		{ThemeTerminal, ANSI16, RoleAttachment, "\x1b[44mtext\x1b[0m"},
		{ThemeMono, ANSI16, RoleSelection, "\x1b[7mtext\x1b[0m"},
		{ThemeMono, ANSI16, RoleWorking, "text"},
		{ThemeDark, NoColor, RoleAccent, "text"},
	} {
		if got := tc.theme.Paint(tc.role, tc.depth, "text"); got != tc.want {
			t.Errorf("Paint(%s) = %q, want %q", tc.role, got, tc.want)
		}
	}
}

func TestParseRole(t *testing.T) {
	for role, style := range roleStyles {
		if parsed, ok := ParseRole(style.name); !ok || parsed != Role(role) || parsed.String() != style.name {
			t.Errorf("ParseRole(%q) = %v, %v", style.name, parsed, ok)
		}
	}
	if _, ok := ParseRole("yellow"); ok {
		t.Error("accepted literal color as a role")
	}
}
