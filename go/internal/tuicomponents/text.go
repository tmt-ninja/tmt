package tuicomponents

import (
	"strings"
	"unicode"
)

const (
	escRune = '\x1b'
	belRune = '\x07'
)

// hiddenFormat reports whether r is an invisible Unicode format character that
// can reorder or hide text: bidi embeddings, overrides and isolates,
// directional marks, and zero-width and word-joiner forms. Zero-width joiners
// (U+200C/U+200D) stay, because scripts and emoji sequences need them.
func hiddenFormat(r rune) bool {
	switch {
	case r == '\u061c' || r == '\u180e' || r == '\u200b' || r == '\ufeff':
		return true
	case r >= '\u200e' && r <= '\u200f':
		return true
	case r >= '\u202a' && r <= '\u202e':
		return true
	case r >= '\u2060' && r <= '\u2064':
		return true
	case r >= '\u2066' && r <= '\u206f':
		return true
	case r >= '\ufff9' && r <= '\ufffb':
		return true
	default:
		return false
	}
}

// Sanitize removes escape sequences (CSI, OSC, DCS, SOS, PM, APC and two-byte
// ESC forms, including their 8-bit C1 introducers), all other control
// characters, and hidden bidi/format characters. Newlines are kept; tabs
// become four spaces; CR is dropped.
func Sanitize(text string) string {
	var out strings.Builder
	out.Grow(len(text))
	runes := []rune(text)
	for i := 0; i < len(runes); {
		r := runes[i]
		i++
		var introducer rune
		switch r {
		case escRune:
			if i < len(runes) {
				next := runes[i]
				i++
				switch next {
				case '[', ']', 'P', 'X', '^', '_':
					introducer = next
				default:
					// Two-byte sequence (for example ESC 7): drop both.
					continue
				}
			} else {
				continue
			}
		case '\u009b':
			introducer = '['
		case '\u009d':
			introducer = ']'
		case '\u0090':
			introducer = 'P'
		case '\u0098':
			introducer = 'X'
		case '\u009e':
			introducer = '^'
		case '\u009f':
			introducer = '_'
		case '\n':
			out.WriteByte('\n')
			continue
		case '\t':
			out.WriteString("    ")
			continue
		default:
			if unicode.IsControl(r) || hiddenFormat(r) {
				continue
			}
			out.WriteRune(r)
			continue
		}

		if introducer == '[' {
			// CSI ends at a final byte in @..~.
			for i < len(runes) {
				next := runes[i]
				i++
				if next >= '@' && next <= '~' {
					break
				}
			}
		} else {
			// String sequences end at BEL (OSC) or ST (ESC \ or U+9C).
			for i < len(runes) {
				next := runes[i]
				i++
				if next == belRune || next == '\u009c' {
					break
				}
				if next == escRune {
					if i < len(runes) && runes[i] == '\\' {
						i++
					}
					break
				}
			}
		}
	}
	return out.String()
}

// SingleLine sanitizes a metadata label without admitting a second display row.
func SingleLine(text string) string {
	s := Sanitize(text)
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\u2028' || r == '\u2029' {
			return ' '
		}
		return r
	}, s)
}
