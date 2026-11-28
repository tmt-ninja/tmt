package clistyle

import (
	"github.com/rivo/uniseg"
	"strconv"
	"strings"
	"unicode"
)

// Align places padding around text that fits within a cell.
type Align uint8

const (
	AlignLeft Align = iota
	AlignRight
	AlignCenter
)

// Truncate determines which text an ellipsis replaces.
type Truncate uint8

const (
	TruncateEnd Truncate = iota
	TruncateMiddle
)

// Escape renders terminal controls and Unicode line separators visibly.
func Escape(text string) string {
	if strings.IndexFunc(text, needsEscape) < 0 {
		return text
	}
	var out strings.Builder
	out.Grow(len(text))
	for _, char := range text {
		switch char {
		case '\t':
			out.WriteString(`\t`)
		case '\n':
			out.WriteString(`\n`)
		case '\r':
			out.WriteString(`\r`)
		default:
			if needsEscape(char) {
				out.WriteString(`\u{`)
				out.WriteString(strconv.FormatInt(int64(char), 16))
				out.WriteByte('}')
			} else {
				out.WriteRune(char)
			}
		}
	}
	return out.String()
}

func needsEscape(char rune) bool {
	return unicode.IsControl(char) || char == '\u2028' || char == '\u2029'
}

// DisplayWidth measures literal text in terminal cells, including grapheme
// sequences. Escape untrusted text before measuring a displayed cell.
func DisplayWidth(text string) int {
	return uniseg.StringWidth(text)
}

// Fit escapes, pads or cuts text to exactly cells display cells.
func Fit(text string, cells int, align Align, truncate Truncate) string {
	if cells <= 0 {
		return ""
	}
	text = Escape(text)
	used := DisplayWidth(text)
	if used <= cells {
		pad := cells - used
		before := 0
		switch align {
		case AlignRight:
			before = pad
		case AlignCenter:
			before = pad / 2
		}
		return strings.Repeat(" ", before) + text + strings.Repeat(" ", pad-before)
	}
	room := cells - 1
	if truncate == TruncateMiddle {
		front, frontCells := textHead(text, room-room/2)
		back := text
		backCells := used
		state := -1
		for backCells > room/2 && back != "" {
			var width int
			_, back, width, state = uniseg.FirstGraphemeClusterInString(back, state)
			backCells -= width
		}
		return front + strings.Repeat(" ", room-frontCells-backCells) + "…" + back
	}
	front, frontCells := textHead(text, room)
	return front + "…" + strings.Repeat(" ", room-frontCells)
}

// FitLines wraps at whitespace when possible and ellipsizes the final line.
// A maximum of zero selects ordinary single-line fitting.
func FitLines(text string, cells int, align Align, truncate Truncate, maxLines int) []string {
	if maxLines <= 0 || cells <= 0 {
		return []string{Fit(text, cells, align, truncate)}
	}
	remaining := Escape(text)
	lines := make([]string, 0)
	for len(lines) < maxLines {
		if len(lines)+1 == maxLines || DisplayWidth(remaining) <= cells {
			return append(lines, Fit(remaining, cells, align, TruncateEnd))
		}
		prefix, _ := textHead(remaining, cells)
		if prefix == "" {
			return append(lines, Fit(remaining, cells, align, TruncateEnd))
		}
		split := len(prefix)
		for rest, state := prefix, -1; rest != ""; {
			i := len(prefix) - len(rest)
			var cluster string
			cluster, rest, _, state = uniseg.FirstGraphemeClusterInString(rest, state)
			if i > 0 && strings.TrimSpace(cluster) == "" {
				split = i
			}
		}
		lines = append(lines, Fit(strings.TrimRightFunc(remaining[:split], unicode.IsSpace), cells, align, TruncateEnd))
		remaining = trimLeadingSpace(remaining[split:])
	}
	return lines
}

func trimLeadingSpace(text string) string {
	state := -1
	for text != "" {
		cluster, rest, _, next := uniseg.FirstGraphemeClusterInString(text, state)
		if strings.TrimSpace(cluster) != "" {
			break
		}
		text, state = rest, next
	}
	return text
}

func textHead(text string, cells int) (string, int) {
	used := 0
	for rest, state := text, -1; rest != ""; {
		i := len(text) - len(rest)
		var width int
		_, rest, width, state = uniseg.FirstGraphemeClusterInString(rest, state)
		if used+width > cells {
			return text[:i], used
		}
		used += width
	}
	return text, used
}
