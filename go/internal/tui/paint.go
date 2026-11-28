package tui

import (
	"math"

	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// PaintHit records a painted hit rectangle with its inherited semantic identity.
type PaintHit struct {
	Rect  LayoutRect
	ID    []string
	RowID *string
}

// HitAt returns the last (topmost) PaintHit containing (x, y), or nil.
func HitAt(hits []PaintHit, x, y int32) *PaintHit {
	for i := len(hits) - 1; i >= 0; i-- {
		h := &hits[i]
		if x >= h.Rect.X && y >= h.Rect.Y &&
			int64(x) < int64(h.Rect.X)+int64(h.Rect.Width) &&
			int64(y) < int64(h.Rect.Y)+int64(h.Rect.Height) {
			return h
		}
	}
	return nil
}

// Paint renders resolved geometry cells into buffer using theme/depth for
// unselected cells and selectedStyle for selected cells.
func Paint(
	cells []LayoutCell,
	buffer *Buffer,
	theme clistyle.Theme,
	depth clistyle.Depth,
	selectedStyle func(clistyle.Role) Style,
) []PaintHit {
	return PaintWith(cells, buffer, func(_ int, role clistyle.Role, selected bool) (Style, clistyle.Align) {
		if selected {
			return selectedStyle(role), clistyle.AlignLeft
		}
		return ScreenStyle(theme, role, depth), clistyle.AlignLeft
	})
}

// PaintWith renders resolved geometry cells with caller-owned decoration and alignment.
func PaintWith(
	cells []LayoutCell,
	buffer *Buffer,
	decorate func(index int, role clistyle.Role, selected bool) (Style, clistyle.Align),
) []PaintHit {
	area := buffer.Area
	bounds := LayoutRect{
		X:      int32(area.X),
		Y:      int32(area.Y),
		Width:  uint32(area.Width),
		Height: uint32(area.Height),
	}
	type inheritedState struct {
		role     clistyle.Role
		selected bool
		id       []string
		rowID    *string
		cut      bool
	}
	inherited := make([]inheritedState, len(cells))
	var hits []PaintHit

	for index, cell := range cells {
		st := inheritedState{role: clistyle.RoleText}
		if cell.Parent != nil {
			st = inherited[*cell.Parent]
		}
		if cell.Node.Style.Token != nil {
			st.role = *cell.Node.Style.Token
		}
		st.selected = st.selected || cell.Node.Selected
		if len(cell.Node.ID) > 0 {
			st.id = cell.Node.ID
		}
		if cell.Node.RowID != nil {
			st.rowID = cell.Node.RowID
		}
		st.cut = st.cut || cell.Cut
		inherited[index] = st

		visible := cell.Clip.Intersect(bounds)
		if visible.Width == 0 || visible.Height == 0 {
			continue
		}
		style, align := decorate(index, st.role, st.selected)
		if cell.Node.Style.Bold {
			style = style.WithModifier(ModifierBold)
		}
		for y := visible.Y; y < visible.Y+int32(visible.Height); y++ {
			for x := visible.X; x < visible.X+int32(visible.Width); x++ {
				target := buffer.At(uint16(x), uint16(y))
				target.Reset()
				target.SetStyle(style)
			}
		}
		if len(st.id) > 0 || st.rowID != nil {
			hits = append(hits, PaintHit{
				Rect:  visible,
				ID:    st.id,
				RowID: st.rowID,
			})
		}
		if cell.Node.Text == nil {
			continue
		}
		value := *cell.Node.Text
		clip := cell.Content.Intersect(visible)
		width := cell.TextWidth
		if st.cut {
			cw := uint16(min(clip.Width, math.MaxUint16))
			if cw < width {
				width = cw
			}
		}
		logicalLines := FitLines(value, cell.TextWidth, cell.Node.Style.TextFlow, align)
		for lineIdx, logical := range logicalLines {
			y := int64(cell.Content.Y) + int64(lineIdx)
			if y < int64(clip.Y) || y >= int64(clip.Y)+int64(clip.Height) {
				continue
			}
			visual := logical
			if st.cut {
				cutFlow := TruncateFlow()
				if cell.Node.Style.TextFlow.Kind == TextFlowMiddle {
					cutFlow = MiddleFlow()
				}
				visual = FitLine(logical, width, cutFlow, align)
			}
			x := int64(cell.Content.X)
			for rest, state := visual, -1; rest != ""; {
				var g string
				var gw int
				g, rest, gw, state = uniseg.FirstGraphemeClusterInString(rest, state)
				size := int64(gw)
				if size > 0 && x >= int64(clip.X) && x+size <= int64(clip.X)+int64(clip.Width) {
					buffer.At(uint16(x), uint16(y)).SetSymbol(g)
				}
				x += size
			}
		}
	}
	return hits
}
