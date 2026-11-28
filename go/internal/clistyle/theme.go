package clistyle

import (
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"
)

// Role describes what a style communicates, independent of palette.
type Role uint8

const (
	RoleText Role = iota
	RoleMuted
	RoleDim
	RoleAccent
	RoleMatrixBatch
	RoleMatrixUrgent
	RoleWaiting
	RoleWorking
	RoleReview
	RoleBlocked
	RoleLink
	RoleSelection
	RoleTrack
	RoleUnread
	RoleKeycap
	RoleKeycapSelected
	RoleCode
	RoleAttachment
	RoleAttachmentInk
	RoleConversation
	roleCount
)

// Depth is the color capability chosen by the renderer for a stream.
type Depth uint8

const (
	NoColor Depth = iota
	ANSI16
	TrueColor
)

// ThemeBase is a built-in terminal palette.
type ThemeBase uint8

const (
	ThemeDark ThemeBase = iota
	ThemeLight
	ThemeTerminal
	ThemeMono
	ThemeAuto
)

var baseNames = [...]string{ThemeDark: "tmt", ThemeLight: "tmt-light", ThemeTerminal: "terminal", ThemeMono: "mono", ThemeAuto: "auto"}

// Theme combines a built-in palette with optional per-role overrides.
// Its zero value is the default dark palette.
type Theme struct {
	Base      ThemeBase
	overrides [roleCount]paint
}

// ThemeError identifies the setting that could not be parsed.
type ThemeError struct {
	Key     string
	Message string
}

func (err *ThemeError) Error() string {
	return "`" + err.Key + "` " + err.Message
}

// ParseTheme reads a base and role settings using the design token names.
func ParseTheme(place string, settings map[string]string) (Theme, error) {
	var theme Theme
	for _, key := range slices.Sorted(maps.Keys(settings)) {
		value := settings[key]
		fail := func(message string) (Theme, error) {
			return Theme{}, &ThemeError{Key: place + "." + key, Message: message}
		}
		if key == "base" {
			base := slices.Index(baseNames[:], value)
			if base < 0 {
				return fail("must be auto, tmt, tmt-light, terminal or mono.")
			}
			theme.Base = ThemeBase(base)
			continue
		}
		role, ok := ParseRole(key)
		if !ok {
			names := make([]string, len(roleStyles))
			for i, style := range roleStyles {
				names[i] = style.name
			}
			return fail("is not a theme setting; use base or a token: " + strings.Join(names, ", ") + ".")
		}
		override := parsePaint(value)
		if override.kind == paintUnset {
			return fail("must be #rrggbb, a color name such as blue or bright black, default, bold, dim or reverse.")
		}
		theme.overrides[role] = override
	}
	return theme, nil
}

// Resolve chooses the light or dark base only for an automatic request.
// Callers supply the detected background. False also serves as the fallback
// when there is no reliable measurement.
func (theme Theme) Resolve(light bool) Theme {
	if theme.Base == ThemeAuto {
		theme.Base = ThemeDark
		if light {
			theme.Base = ThemeLight
		}
	}
	return theme
}

// Values follow design/tokens/tokens.json. The terminal and mono columns
// hold SGR codes, including effects and background colors.
var roleStyles = [...]struct {
	name           string
	dark, light    uint32
	terminal, mono uint8
	background     bool
}{
	RoleText:           {"text", 0xd8d8d8, 0x171717, 0, 0, false},
	RoleMuted:          {"muted", 0xb0b0b0, 0x626262, 37, 2, false},
	RoleDim:            {"dim", 0x858585, 0x767676, 2, 2, false},
	RoleAccent:         {"accent", 0x7aa2f7, 0x1f5fbf, 34, 1, false},
	RoleMatrixBatch:    {"matrix-batch", 0x8db8ff, 0x2454a4, 94, 0, false},
	RoleMatrixUrgent:   {"matrix-urgent", 0xebcb68, 0x795b00, 93, 0, false},
	RoleWaiting:        {"waiting", 0xff9e64, 0x965027, 33, 1, false},
	RoleWorking:        {"working", 0x9ece6a, 0x4f6a33, 32, 0, false},
	RoleReview:         {"review", 0xbb9af7, 0x7847bd, 35, 1, false},
	RoleBlocked:        {"blocked", 0xf7768e, 0xb62c3b, 31, 1, false},
	RoleLink:           {"link", 0x7dcfff, 0x006b8f, 36, 0, false},
	RoleSelection:      {"selection", 0x4a4a4a, 0xc8c8c8, 7, 7, true},
	RoleTrack:          {"track", 0x383838, 0xe0e0e0, 2, 2, true},
	RoleUnread:         {"unread", 0x7aa2f7, 0x1f5fbf, 34, 1, false},
	RoleKeycap:         {"keycap", 0x555555, 0x555555, 40, 7, true},
	RoleKeycapSelected: {"keycap-selected", 0x707070, 0x707070, 100, 7, true},
	RoleCode:           {"code", 0xa9b1d6, 0x3b4261, 37, 0, false},
	RoleAttachment:     {"attachment", 0x2c3650, 0xdce7fc, 44, 7, true},
	RoleAttachmentInk:  {"attachment-ink", 0xc0d4ff, 0x1d3e73, 97, 1, false},
	RoleConversation:   {"conversation", 0x2b3550, 0xdce4f7, 7, 7, true},
}

// String is the design token's configuration name.
func (role Role) String() string {
	if int(role) >= len(roleStyles) {
		return ""
	}
	return roleStyles[role].name
}

// ParseRole recognizes an exact design token name.
func ParseRole(name string) (Role, bool) {
	for role, style := range roleStyles {
		if style.name == name {
			return Role(role), true
		}
	}
	return RoleText, false
}

// Paint applies a role to text. The caller escapes untrusted cell values
// before applying the style.
func (theme Theme) Paint(role Role, depth Depth, text string) string {
	if depth == NoColor || text == "" || int(role) >= len(roleStyles) {
		return text
	}
	style := roleStyles[role]
	if override := theme.overrides[role]; override.kind != paintUnset {
		return override.apply(style.background, depth, text)
	}
	switch {
	case theme.Base == ThemeMono:
		return paintSGR(style.mono, text)
	case theme.Base == ThemeTerminal || depth == ANSI16:
		return paintSGR(style.terminal, text)
	default:
		color := style.dark
		if theme.Base == ThemeLight {
			color = style.light
		}
		return paintRGB(color, style.background, text)
	}
}

type paintKind uint8

const (
	paintUnset paintKind = iota
	paintEffect
	paintANSI
	paintHex
)

type paint struct {
	kind  paintKind
	value uint32
}

var ansiNames = [...]string{
	"black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
	"bright black", "bright red", "bright green", "bright yellow",
	"bright blue", "bright magenta", "bright cyan", "bright white",
}

var ansiRGB = [...]uint32{
	0x000000, 0xcd3131, 0x0dbc79, 0xe5e510, 0x2472c8, 0xbc3fbc, 0x11a8cd, 0xe5e5e5,
	0x666666, 0xf14c4c, 0x23d18b, 0xf5f543, 0x3b8eea, 0xd670d6, 0x29b8db, 0xffffff,
}

func parsePaint(text string) paint {
	if hex, ok := strings.CutPrefix(text, "#"); ok && len(hex) == 6 {
		if value, err := strconv.ParseUint(hex, 16, 24); err == nil {
			return paint{paintHex, uint32(value)}
		}
	}
	switch text {
	case "default":
		return paint{paintEffect, 0}
	case "bold":
		return paint{paintEffect, 1}
	case "dim":
		return paint{paintEffect, 2}
	case "reverse":
		return paint{paintEffect, 7}
	}
	if color := slices.Index(ansiNames[:], text); color >= 0 {
		return paint{paintANSI, uint32(color)}
	}
	return paint{}
}

func (p paint) apply(background bool, depth Depth, text string) string {
	switch p.kind {
	case paintEffect:
		return paintSGR(uint8(p.value), text)
	case paintHex:
		if depth == TrueColor {
			return paintRGB(p.value, background, text)
		}
		return paintANSIColor(nearestANSI(p.value), background, text)
	case paintANSI:
		return paintANSIColor(int(p.value), background, text)
	default:
		return text
	}
}

func nearestANSI(color uint32) int {
	index, best := 0, 3*255*255+1
	for i, candidate := range ansiRGB {
		distance := 0
		for _, shift := range []int{0, 8, 16} {
			delta := int((color>>shift)&255) - int((candidate>>shift)&255)
			distance += delta * delta
		}
		if distance < best {
			index, best = i, distance
		}
	}
	return index
}

func paintANSIColor(index int, background bool, text string) string {
	code := 30 + index
	if index >= 8 {
		code = 90 + index - 8
	}
	if background {
		code += 10
	}
	return paintSGR(uint8(code), text)
}

func paintRGB(color uint32, background bool, text string) string {
	layer := 38
	if background {
		layer = 48
	}
	return fmt.Sprintf("\x1b[%d;2;%d;%d;%dm%s\x1b[0m", layer, color>>16, (color>>8)&255, color&255, text)
}

func paintSGR(code uint8, text string) string {
	if code == 0 || text == "" {
		return text
	}
	return "\x1b[" + strconv.Itoa(int(code)) + "m" + text + "\x1b[0m"
}
