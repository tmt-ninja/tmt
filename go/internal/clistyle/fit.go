package clistyle

import (
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/width"
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

func runeCells(char rune) int {
	if unicode.IsControl(char) || unicode.In(char, unicode.Mn, unicode.Me, unicode.Cf) {
		return 0
	}
	switch width.LookupRune(char).Kind() {
	case width.EastAsianWide, width.EastAsianFullwidth:
		return 2
	default:
		return 1
	}
}

// DisplayWidth measures literal text in terminal cells. Escape untrusted
// text first when measuring a cell that will display it visibly.
func DisplayWidth(text string) int {
	cells := 0
	for _, char := range text {
		cells += runeCells(char)
	}
	return cells
}

// Fit escapes, pads or cuts text to exactly cells display cells.
func Fit(text string, cells int, align Align, truncate Truncate) string {
	if cells <= 0 {
		return ""
	}
	text = Escape(text)
	if used := DisplayWidth(text); used <= cells {
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
		offset, backCells := len(text), 0
		for offset > 0 {
			char, size := utf8.DecodeLastRuneInString(text[:offset])
			if next := backCells + runeCells(char); next <= room/2 {
				backCells = next
				offset -= size
			} else {
				break
			}
		}
		return front + strings.Repeat(" ", room-frontCells-backCells) + "…" + text[offset:]
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
		for i, char := range prefix {
			if i > 0 && unicode.IsSpace(char) {
				split = i
			}
		}
		lines = append(lines, Fit(strings.TrimRightFunc(remaining[:split], unicode.IsSpace), cells, align, TruncateEnd))
		remaining = strings.TrimLeftFunc(remaining[split:], unicode.IsSpace)
	}
	return lines
}

func textHead(text string, cells int) (string, int) {
	used := 0
	for i, char := range text {
		next := used + runeCells(char)
		if next > cells {
			return text[:i], used
		}
		used = next
	}
	return text, used
}
