package tui

import (
	"fmt"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

var spinnerFrames = [10]string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}

// StatusLabelKind selects literal text vs elapsed age formatting.
type StatusLabelKind uint8

const (
	StatusLabelText StatusLabelKind = iota
	StatusLabelAge
)

// StatusLabel carries either complete text or a prefix + elapsed duration.
type StatusLabel struct {
	Kind   StatusLabelKind
	Text   string
	Prefix string
	Age    time.Duration
}

func TextStatus(text string) StatusLabel {
	return StatusLabel{Kind: StatusLabelText, Text: text}
}

func AgeStatus(prefix string, age time.Duration) StatusLabel {
	return StatusLabel{Kind: StatusLabelAge, Prefix: prefix, Age: age}
}

// StatusSlot paints a single fixed status line with optional busy spinner.
type StatusSlot struct {
	Label StatusLabel
	Frame *int
}

func formatAgeLabel(prefix string, age time.Duration) string {
	secs := uint64(0)
	if age > 0 {
		secs = uint64(age / time.Second)
	}
	return formatAgeSeconds(prefix, secs)
}

func formatAgeSeconds(prefix string, secs uint64) string {
	var val uint64
	var unit string
	switch {
	case secs < 60:
		val, unit = secs, "s"
	case secs < 3600:
		val, unit = secs/60, "m"
	case secs < 86400:
		val, unit = secs/3600, "h"
	default:
		val, unit = secs/86400, "d"
	}
	if prefix == "" {
		return fmt.Sprintf("%d%s ago", val, unit)
	}
	return fmt.Sprintf("%s %d%s ago", prefix, val, unit)
}

// Paint replaces the first row of area (including trailing blanks).
func (s StatusSlot) Paint(buffer *Buffer, area Rect, theme clistyle.Theme, depth clistyle.Depth) {
	if area.IsEmpty() {
		return
	}
	row := NewRect(area.X, area.Y, area.Width, 1)
	visible := row.Intersect(buffer.Area)
	if visible.IsEmpty() {
		return
	}
	style := ScreenStyle(theme, clistyle.RoleDim, depth)
	for x := visible.X; x < visible.Right(); x++ {
		cell := buffer.At(x, visible.Y)
		cell.Reset()
		cell.SetStyle(style)
	}
	var label string
	if s.Label.Kind == StatusLabelAge {
		label = formatAgeLabel(s.Label.Prefix, s.Label.Age)
	} else {
		label = s.Label.Text
	}
	labelArea := row
	if s.Frame != nil {
		marker := spinnerFrames[(*s.Frame%len(spinnerFrames)+len(spinnerFrames))%len(spinnerFrames)]
		width := uint16(1)
		if depth == clistyle.NoColor {
			marker = "[busy]"
			width = 6
		}
		reserved := width
		if label != "" {
			reserved++
		}
		markerArea := NewRect(row.X, row.Y, width, 1)
		if reserved <= row.Width && markerArea.Intersect(buffer.Area) == markerArea {
			PaintLeft(buffer, markerArea, RawLine(marker).WithStyle(style))
			labelArea.X += reserved
			labelArea.Width -= reserved
		}
	}
	fitted := FitLine(label, labelArea.Width, ClipFlow(), clistyle.AlignLeft)
	PaintLeft(buffer, labelArea, RawLine(fitted).WithStyle(style))
}
