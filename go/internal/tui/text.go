package tui

import (
	"math"
	"strings"
	"unicode"

	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// IsSingleCellOrWideGrapheme reports whether text is one visible grapheme of
// one or two cells without joined sequences.
func IsSingleCellOrWideGrapheme(text string) bool {
	if text == "" {
		return false
	}
	_, rest, w, _ := uniseg.FirstGraphemeClusterInString(text, -1)
	if rest != "" {
		return false
	}
	for _, r := range text {
		if unicode.IsControl(r) || unicode.IsSpace(r) || r == '\u200d' {
			return false
		}
	}
	return w == 1 || w == 2
}

func graphemePrefix(text string, width int) string {
	used := 0
	for rest, state := text, -1; rest != ""; {
		at := len(text) - len(rest)
		var gw int
		_, rest, gw, state = uniseg.FirstGraphemeClusterInString(rest, state)
		used += gw
		if used > width {
			return text[:at]
		}
	}
	return text
}

func graphemeSuffix(text string, width int) string {
	type cluster struct {
		start int
		end   int
		w     int
	}
	var clusters []cluster
	for rest, state := text, -1; rest != ""; {
		at := len(text) - len(rest)
		var g string
		var gw int
		g, rest, gw, state = uniseg.FirstGraphemeClusterInString(rest, state)
		clusters = append(clusters, cluster{start: at, end: at + len(g), w: gw})
	}
	used := 0
	for i := len(clusters) - 1; i >= 0; i-- {
		used += clusters[i].w
		if used > width {
			return text[clusters[i].end:]
		}
	}
	return text
}

func fitEscaped(text string, width int, middle, ellipsis bool, align clistyle.Align) string {
	tw := uniseg.StringWidth(text)
	if tw <= width {
		padding := width - tw
		before := 0
		switch align {
		case clistyle.AlignRight:
			before = padding
		case clistyle.AlignCenter:
			before = padding / 2
		}
		return strings.Repeat(" ", before) + text + strings.Repeat(" ", padding-before)
	}
	var fitted string
	if !ellipsis || width == 0 {
		fitted = graphemePrefix(text, width)
	} else if middle {
		room := width - 1
		front := graphemePrefix(text, room-room/2)
		back := graphemeSuffix(text, room/2)
		gap := room - uniseg.StringWidth(front) - uniseg.StringWidth(back)
		if gap < 0 {
			gap = 0
		}
		fitted = front + strings.Repeat(" ", gap) + "…" + back
	} else {
		fitted = graphemePrefix(text, width-1) + "…"
	}
	pad := width - uniseg.StringWidth(fitted)
	if pad < 0 {
		pad = 0
	}
	return fitted + strings.Repeat(" ", pad)
}

// FitLine returns one escaped visual line aligned within the recorded text budget.
func FitLine(text string, width uint16, flow TextFlow, align clistyle.Align) string {
	return fitEscaped(
		clistyle.Escape(text),
		int(width),
		flow.Kind == TextFlowMiddle,
		flow.Kind != TextFlowClip,
		align,
	)
}

// TextLines returns logical visual lines using geometry's recorded budget, before viewport cuts.
func TextLines(text string, width uint16, flow TextFlow) []string {
	return FitLines(text, width, flow, clistyle.AlignLeft)
}

// FitLines returns bounded logical lines aligned within width.
func FitLines(text string, width uint16, flow TextFlow, align clistyle.Align) []string {
	if width == 0 {
		return nil
	}
	escaped := clistyle.Escape(text)
	w := int(width)
	limit := 1
	wrapping := false
	switch flow.Kind {
	case TextFlowWrap:
		limit = math.MaxUint16
		wrapping = true
	case TextFlowClamp:
		limit = int(flow.Lines)
		wrapping = true
	}

	remaining := escaped
	var result []string
	for index := 0; index < limit; index++ {
		head := graphemePrefix(remaining, w)
		if !wrapping || len(head) == len(remaining) || index+1 == limit {
			result = append(result, fitEscaped(
				remaining,
				w,
				flow.Kind == TextFlowMiddle,
				flow.Kind != TextFlowClip,
				align,
			))
			break
		}
		if head == "" {
			result = append(result, fitEscaped(remaining, w, false, true, align))
			break
		}
		split := len(head)
		for rest, state := head, -1; rest != ""; {
			at := len(head) - len(rest)
			var g string
			g, rest, _, state = uniseg.FirstGraphemeClusterInString(rest, state)
			if at > 0 && isAllWhitespace(g) {
				split = at
			}
		}
		result = append(result, fitEscaped(
			strings.TrimRightFunc(remaining[:split], unicode.IsSpace),
			w,
			false,
			false,
			align,
		))
		remaining = strings.TrimLeftFunc(remaining[split:], unicode.IsSpace)
	}
	return result
}

func isAllWhitespace(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !unicode.IsSpace(r) {
			return false
		}
	}
	return true
}

// MeasureText returns [width, height] using the same escaping, widths, and bounded wrapping as TextLines.
func MeasureText(text string, flow TextFlow, space Space) [2]uint16 {
	escaped := clistyle.Escape(text)
	nat := uniseg.StringWidth(escaped)
	if nat > math.MaxUint16 {
		nat = math.MaxUint16
	}
	natural := uint16(nat)
	var width uint16
	switch space.Kind {
	case SpaceCells:
		width = space.Cells
	case SpaceMaxContent:
		width = natural
	case SpaceMinContent:
		maxWord := 0
		for _, word := range strings.Fields(escaped) {
			if ww := uniseg.StringWidth(word); ww > maxWord {
				maxWord = ww
			}
		}
		if maxWord > math.MaxUint16 {
			maxWord = math.MaxUint16
		}
		width = uint16(maxWord)
	}
	outW := min(natural, width)
	outH := uint16(min(len(TextLines(text, width, flow)), math.MaxUint16))
	return [2]uint16{outW, outH}
}
