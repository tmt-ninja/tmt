package tui

import "github.com/tmt-ninja/tmt/go/internal/clistyle"

// OutlineFrame selects the border glyph set for Outline and Modal.
type OutlineFrame uint8

const (
	OutlineSquare OutlineFrame = iota
	OutlineRounded
	OutlineThick
	OutlineFlat
)

type borderSet struct {
	topLeft, topRight               string
	bottomLeft, bottomRight         string
	verticalLeft, verticalRight     string
	horizontalTop, horizontalBottom string
}

func borderSetFor(frame OutlineFrame, ascii bool) borderSet {
	if ascii {
		switch frame {
		case OutlineThick:
			return borderSet{"+", "+", "+", "+", "#", "#", "=", "="}
		case OutlineFlat:
			return borderSet{"-", "-", "-", "-", " ", " ", "-", "-"}
		default:
			return borderSet{"+", "+", "+", "+", "|", "|", "-", "-"}
		}
	}
	switch frame {
	case OutlineRounded:
		return borderSet{"╭", "╮", "╰", "╯", "│", "│", "─", "─"}
	case OutlineThick:
		return borderSet{"┏", "┓", "┗", "┛", "┃", "┃", "━", "━"}
	case OutlineFlat:
		return borderSet{"─", "─", "─", "─", " ", " ", "─", "─"}
	default:
		return borderSet{"┌", "┐", "└", "┘", "│", "│", "─", "─"}
	}
}

func escapeLine(line Line) Line {
	spans := make([]Span, len(line.Spans))
	for i, sp := range line.Spans {
		spans[i] = Span{Content: clistyle.Escape(sp.Content), Style: sp.Style}
	}
	return Line{Spans: spans, Style: line.Style}
}

// paintBlockBorder renders a 1-cell border with optional left title and right note on the top edge.
func paintBlockBorder(area Rect, buffer *Buffer, frame OutlineFrame, borderStyle, titleStyle Style, title *Line, note *Line, ascii bool) {
	vis := area.Intersect(buffer.Area)
	if vis.IsEmpty() {
		return
	}
	bs := borderSetFor(frame, ascii)
	left, right := vis.X, vis.Right()-1
	top, bottom := vis.Y, vis.Bottom()-1

	// Top edge
	for x := left; x <= right; x++ {
		sym := bs.horizontalTop
		if x == left {
			sym = bs.topLeft
		} else if x == right {
			sym = bs.topRight
		}
		c := buffer.At(x, top)
		c.SetSymbol(sym)
		c.SetStyle(borderStyle)
	}
	// Bottom edge
	if bottom > top {
		for x := left; x <= right; x++ {
			sym := bs.horizontalBottom
			if x == left {
				sym = bs.bottomLeft
			} else if x == right {
				sym = bs.bottomRight
			}
			c := buffer.At(x, bottom)
			c.SetSymbol(sym)
			c.SetStyle(borderStyle)
		}
	}
	// Vertical sides
	for y := top + 1; y < bottom; y++ {
		cl := buffer.At(left, y)
		cl.SetSymbol(bs.verticalLeft)
		cl.SetStyle(borderStyle)
		if right > left {
			cr := buffer.At(right, y)
			cr.SetSymbol(bs.verticalRight)
			cr.SetStyle(borderStyle)
		}
	}

	// Title and optional right-aligned note on the top border (between corners).
	if vis.Width <= 2 {
		return
	}
	innerTop := NewRect(left+1, top, vis.Width-2, 1)
	if title != nil && len(title.Spans) > 0 {
		esc := escapeLine(*title)
		esc.Style = titleStyle.Patch(esc.Style)
		PaintLeft(buffer, innerTop, esc)
	}
	if note != nil && len(note.Spans) > 0 {
		esc := escapeLine(*note)
		esc.Style = titleStyle.Patch(esc.Style)
		PaintRight(buffer, innerTop, esc)
	}
}

// Outline paints a single-line frame with a styled title in its top edge without clearing inside.
type Outline struct {
	Title      Line
	Border     Style
	TitleStyle Style
}

func (Outline) Inner(area Rect) Rect {
	return area.Inner(1, 1)
}

func (o Outline) Paint(area Rect, buffer *Buffer) {
	o.paintFrame(area, buffer, OutlineSquare, nil, false)
}

func (o Outline) PaintRounded(area Rect, buffer *Buffer) {
	o.paintFrame(area, buffer, OutlineRounded, nil, false)
}

func (o Outline) PaintThick(area Rect, buffer *Buffer) {
	o.paintFrame(area, buffer, OutlineThick, nil, false)
}

func (o Outline) PaintFlat(area Rect, buffer *Buffer) {
	o.paintFrame(area, buffer, OutlineFlat, nil, false)
}

func (o Outline) PaintNoted(area Rect, buffer *Buffer, frame OutlineFrame, note *Line, ascii bool) {
	o.paintFrame(area, buffer, frame, note, ascii)
}

func (o Outline) paintFrame(area Rect, buffer *Buffer, frame OutlineFrame, note *Line, ascii bool) {
	var titlePtr *Line
	if len(o.Title.Spans) > 0 {
		t := o.Title
		titlePtr = &t
	}
	paintBlockBorder(area, buffer, frame, o.Border, o.TitleStyle, titlePtr, note, ascii)
}
