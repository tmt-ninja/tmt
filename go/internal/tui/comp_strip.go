package tui

import (
	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// ChipSpec pairs a label and resolved Style for PaintChips.
type ChipSpec struct {
	Label string
	Style Style
}

// PaintLeft paints line from the left edge of area, clipping text beyond its width.
func PaintLeft(buffer *Buffer, area Rect, line Line) {
	paintFrom(buffer, area, area.X, line)
}

// PaintRight paints line flush with the right edge of area.
func PaintRight(buffer *Buffer, area Rect, line Line) {
	w := uint16(min(line.Width(), int(area.Width)))
	paintFrom(buffer, area, area.Right()-w, line)
}

// PaintChip paints one whole padded control; returns its Rect or nil if it did not fit.
func PaintChip(buffer *Buffer, area Rect, label string, style Style, align clistyle.Align) *Rect {
	res := PaintChips(buffer, area, []ChipSpec{{Label: label, Style: style}}, align)
	return res[0]
}

// PaintChips keeps a priority-ordered prefix of whole chips with one unpainted cell between them.
func PaintChips(buffer *Buffer, area Rect, chips []ChipSpec, align clistyle.Align) []*Rect {
	painted := make([]*Rect, len(chips))
	if area.IsEmpty() {
		return painted
	}
	rowArea := Rect{X: area.X, Y: area.Y, Width: area.Width, Height: 1}
	visible := rowArea.Intersect(buffer.Area)
	if visible.IsEmpty() {
		return painted
	}
	var widths []uint16
	var used uint32
	for _, ch := range chips {
		natural := MeasureText(ch.Label, ClipFlow(), MaxContentSpace())[0]
		if uint32(natural)+2 > 0xffff {
			break
		}
		width := natural + 2
		sep := uint32(0)
		if len(widths) > 0 {
			sep = 1
		}
		next := used + uint32(width) + sep
		if next > uint32(visible.Width) {
			break
		}
		used = next
		widths = append(widths, width)
	}
	spare := visible.Width - uint16(used)
	x := visible.X
	switch align {
	case clistyle.AlignRight:
		x += spare
	case clistyle.AlignCenter:
		x += spare / 2
	}
	for i, w := range widths {
		rect := NewRect(x, visible.Y, w, 1)
		paintSpan(buffer, rect, " "+chips[i].Label+" ", chips[i].Style)
		rCopy := rect
		painted[i] = &rCopy
		x = uint16(min(uint32(x)+uint32(w)+1, 0xffff))
	}
	return painted
}

func paintFrom(buffer *Buffer, area Rect, start uint16, line Line) {
	x := max(start, area.X)
	for _, sp := range line.Spans {
		rem := uint16(0)
		if area.Right() > x {
			rem = area.Right() - x
		}
		w := uint16(min(sp.Width(), int(rem)))
		if w == 0 {
			continue
		}
		paintSpan(buffer, NewRect(x, area.Y, w, area.Height), sp.Content, line.Style.Patch(sp.Style))
		x += w
	}
}

func paintSpan(buffer *Buffer, slot Rect, text string, style Style) {
	visible := slot.Intersect(buffer.Area)
	if visible.IsEmpty() {
		return
	}
	for y := visible.Y; y < visible.Bottom(); y++ {
		for x := visible.X; x < visible.Right(); x++ {
			cell := buffer.At(x, y)
			cell.Reset()
			cell.SetStyle(style)
		}
	}
	if slot.Y < visible.Y {
		return
	}
	fitted := FitLine(text, slot.Width, ClipFlow(), clistyle.AlignLeft)
	x := int(slot.X)
	for rest, state := fitted, -1; rest != ""; {
		var g string
		var gw int
		g, rest, gw, state = uniseg.FirstGraphemeClusterInString(rest, state)
		if gw > 0 && x >= int(visible.X) && x+gw <= int(visible.Right()) {
			buffer.At(uint16(x), slot.Y).SetSymbol(g)
		}
		x += gw
	}
}
