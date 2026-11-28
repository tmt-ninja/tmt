package ptyprotocol

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

type escapeState uint8

const (
	escText escapeState = iota
	escIntroducer
	escIntermediate
	escCSI
	escString
	escStringEnd
)

// OutputSanitizer strips terminal escape sequences, C0/C1 controls, and hidden formatting.
// Keeps newline and joiners, and expands tabs to four spaces. Holds only an incomplete
// UTF-8 scalar and the escape parser state across chunks.
type OutputSanitizer struct {
	escape   escapeState
	utf8Tail []byte
}

// Push appends arbitrary bytes and returns the newly available display text.
func (s *OutputSanitizer) Push(data []byte) string {
	var input []byte
	if len(s.utf8Tail) == 0 {
		input = data
	} else {
		input = append(s.utf8Tail, data...)
		s.utf8Tail = nil
	}

	var display strings.Builder
	display.Grow(len(input))

	for len(input) > 0 {
		if !utf8.FullRune(input) {
			s.utf8Tail = append(s.utf8Tail[:0], input...)
			return display.String()
		}
		r, size := utf8.DecodeRune(input)
		if r == utf8.RuneError && size == 1 {
			b := input[0]
			// An isolated C1 byte is a terminal control. Recognize it before lossy decoding,
			// while preserving valid UTF-8 scalars containing that same continuation byte.
			if b >= 0x80 && b <= 0x9f {
				s.control(rune(b), &display)
			} else {
				s.control('\ufffd', &display)
			}
			input = input[1:]
			continue
		}
		s.control(r, &display)
		input = input[size:]
	}
	return display.String()
}

func (s *OutputSanitizer) control(ch rune, display *strings.Builder) {
	switch s.escape {
	case escText:
		switch ch {
		case '\x1b':
			s.escape = escIntroducer
		case '\u009b':
			s.escape = escCSI
		case '\u0090', '\u0098', '\u009d', '\u009e', '\u009f':
			s.escape = escString
		default:
			switch {
			case ch == '\t':
				display.WriteString("    ")
			case ch == '\n':
				display.WriteRune(ch)
			case !unicode.IsControl(ch) && !hiddenFormat(ch):
				display.WriteRune(ch)
			}
			s.escape = escText
		}
	case escIntroducer:
		switch {
		case ch == '[':
			s.escape = escCSI
		case ch == ']', ch == 'P', ch == 'X', ch == '^', ch == '_':
			s.escape = escString
		case ch >= ' ' && ch <= '/':
			s.escape = escIntermediate
		default:
			s.escape = escText
		}
	case escIntermediate:
		switch {
		case ch == '\x1b':
			s.escape = escIntroducer
		case ch >= '0' && ch <= '~':
			s.escape = escText
		default:
			s.escape = escIntermediate
		}
	case escCSI:
		if ch >= '@' && ch <= '~' {
			s.escape = escText
		}
	case escString, escStringEnd:
		switch {
		case ch == '\x07' || ch == '\u009c':
			s.escape = escText
		case ch == '\\' && s.escape == escStringEnd:
			s.escape = escText
		case ch == '\x1b':
			s.escape = escStringEnd
		default:
			s.escape = escString
		}
	}
}

// SanitizeOutput sanitizes a complete output buffer, flushing any incomplete final UTF-8 scalar.
func SanitizeOutput(data []byte) string {
	var sanitizer OutputSanitizer
	display := sanitizer.Push(data)
	if len(sanitizer.utf8Tail) > 0 {
		var b strings.Builder
		b.WriteString(display)
		sanitizer.control('\ufffd', &b)
		return b.String()
	}
	return display
}

func hiddenFormat(ch rune) bool {
	switch {
	case ch == '\u061c', ch == '\u180e', ch == '\u200b', ch == '\ufeff':
		return true
	case ch >= '\u200e' && ch <= '\u200f':
		return true
	case ch >= '\u202a' && ch <= '\u202e':
		return true
	case ch >= '\u2060' && ch <= '\u2064':
		return true
	case ch >= '\u2066' && ch <= '\u206f':
		return true
	case ch >= '\ufff9' && ch <= '\ufffb':
		return true
	default:
		return false
	}
}
