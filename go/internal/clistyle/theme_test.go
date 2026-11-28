package clistyle

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestRolePaintGolden(t *testing.T) {
	for _, tc := range []struct {
		theme ThemeBase
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
		if got := (Theme{Base: tc.theme}).Paint(tc.role, tc.depth, "text"); got != tc.want {
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

func TestThemeOverridesRespectBaseAndDepth(t *testing.T) {
	theme, err := ParseTheme("theme", map[string]string{
		"base": "terminal", "waiting": "#e0a458", "accent": "bright blue", "selection": "bright black",
		"dim": "default", "working": "reverse",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		role  Role
		depth Depth
		want  string
	}{
		{RoleWaiting, TrueColor, "\x1b[38;2;224;164;88mtext\x1b[0m"},
		{RoleWaiting, ANSI16, "\x1b[93mtext\x1b[0m"},
		{RoleAccent, TrueColor, "\x1b[94mtext\x1b[0m"},
		{RoleSelection, TrueColor, "\x1b[100mtext\x1b[0m"},
		{RoleBlocked, TrueColor, "\x1b[31mtext\x1b[0m"},
		{RoleWorking, TrueColor, "\x1b[7mtext\x1b[0m"},
		{RoleDim, TrueColor, "text"},
		{RoleWaiting, NoColor, "text"},
	} {
		if got := theme.Paint(tc.role, tc.depth, "text"); got != tc.want {
			t.Errorf("paint %s at %d = %q, want %q", tc.role, tc.depth, got, tc.want)
		}
	}
	auto, err := ParseTheme("board.theme", map[string]string{"base": "auto", "blocked": "bold"})
	if err != nil {
		t.Fatal(err)
	}
	if light := auto.Resolve(true); light.Base != ThemeLight || light.Paint(RoleBlocked, TrueColor, "x") != "\x1b[1mx\x1b[0m" {
		t.Errorf("light resolution discarded the override: %+v", light)
	}
	if auto.Resolve(false).Base != ThemeDark || theme.Resolve(true).Base != ThemeTerminal {
		t.Error("automatic or explicit base resolved incorrectly")
	}
}

func TestThemeErrorsIdentifyTheSetting(t *testing.T) {
	for _, tc := range []struct{ key, value, want string }{
		{"base", "dark", "`squad.product.theme.base` must be auto, tmt, tmt-light, terminal or mono."},
		{"error", "red", "`squad.product.theme.error` is not a theme setting; use base or a token: text, muted,"},
		{"waiting", "orange", "`squad.product.theme.waiting` must be #rrggbb"},
		{"dim", "#123xyz", "`squad.product.theme.dim` must be #rrggbb"},
	} {
		_, err := ParseTheme("squad.product.theme", map[string]string{tc.key: tc.value})
		if err == nil || !strings.HasPrefix(err.Error(), tc.want) {
			t.Errorf("error for %q = %v, want prefix %q", tc.key, err, tc.want)
		}
	}
}

func TestThemeAndMarkRegistryMatchDesignTokens(t *testing.T) {
	raw, err := os.ReadFile("../../../design/tokens/tokens.json")
	if err != nil {
		t.Fatal(err)
	}
	var tokens struct {
		Color map[string]struct{ Dark, Light, Terminal string }
		Mark  map[string]string
	}
	if err := json.Unmarshal(raw, &tokens); err != nil {
		t.Fatal(err)
	}
	if len(tokens.Color) != len(roleStyles) {
		t.Fatalf("%d design colors, %d built-in roles", len(tokens.Color), len(roleStyles))
	}
	for id, style := range roleStyles {
		token := tokens.Color[style.name]
		if parsePaint(token.Dark) != (paint{paintHex, style.dark}) || parsePaint(token.Light) != (paint{paintHex, style.light}) {
			t.Errorf("RGB role %s differs from the design", style.name)
		}
		terminal := parsePaint(token.Terminal).apply(style.background, ANSI16, "x")
		if terminal != (Theme{Base: ThemeTerminal}).Paint(Role(id), ANSI16, "x") {
			t.Errorf("terminal role %s differs from the design", style.name)
		}
	}
	for _, mark := range marks {
		if tokens.Mark[mark.symbol] != mark.description {
			t.Errorf("mark %q differs from the design", mark.symbol)
		}
		delete(tokens.Mark, mark.symbol)
	}
	for symbol, note := range tokens.Mark {
		if !strings.Contains(note, "board only") && !strings.Contains(note, "board meter only") {
			t.Errorf("unregistered shared mark %q", symbol)
		}
	}
}
