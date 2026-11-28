package clistyle

import (
	"fmt"
	"strconv"
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
)

// Depth is the color capability chosen by the renderer for a stream.
type Depth uint8

const (
	NoColor Depth = iota
	ANSI16
	TrueColor
)

// Theme is one of the built-in terminal palettes.
type Theme uint8

const (
	ThemeDark Theme = iota
	ThemeLight
	ThemeTerminal
	ThemeMono
)

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
	switch {
	case theme == ThemeMono:
		return paintSGR(style.mono, text)
	case theme == ThemeTerminal || depth == ANSI16:
		return paintSGR(style.terminal, text)
	default:
		color := style.dark
		if theme == ThemeLight {
			color = style.light
		}
		layer := 38
		if style.background {
			layer = 48
		}
		return fmt.Sprintf("\x1b[%d;2;%d;%d;%dm%s\x1b[0m", layer, color>>16, (color>>8)&255, color&255, text)
	}
}

func paintSGR(code uint8, text string) string {
	if code == 0 || text == "" {
		return text
	}
	return "\x1b[" + strconv.Itoa(int(code)) + "m" + text + "\x1b[0m"
}
