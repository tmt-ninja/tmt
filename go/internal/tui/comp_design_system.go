package tui

import (
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/tuicomponents"
)

// PaintCellGrid copies a pure tuicomponents.CellGrid into buffer using theme and depth.
func PaintCellGrid(grid *tuicomponents.CellGrid, area Rect, buffer *Buffer, theme clistyle.Theme, depth clistyle.Depth) {
	size := grid.Size()
	maxH := min(size.Height, area.Height)
	maxW := min(size.Width, area.Width)
	for y := uint16(0); y < maxH; y++ {
		for x := uint16(0); x < maxW; x++ {
			cell := grid.Get(x, y)
			if cell == nil {
				continue
			}
			ax := uint16(min(uint32(area.X)+uint32(x), 0xffff))
			ay := uint16(min(uint32(area.Y)+uint32(y), 0xffff))
			if !buffer.Area.Contains(Position{X: ax, Y: ay}) {
				continue
			}
			roleStyle := func(r clistyle.Role) Style {
				return ScreenStyle(theme, r, depth)
			}
			var style Style
			if cell.HeatLevel != nil {
				style = ScreenNeutralRamp(theme, depth, uint8(*cell.HeatLevel))
			} else if cell.ChipSurface != nil {
				cs := ChipStateIdle
				switch *cell.ChipSurface {
				case tuicomponents.ChipSurfaceHot:
					cs = ChipStateHot
				case tuicomponents.ChipSurfaceDisabled:
					cs = ChipStateDisabled
				}
				style = ScreenChip(theme, ChipKindSecondary, cs, depth)
			} else {
				var base Style
				if cell.Underlay != nil {
					base = roleStyle(*cell.Underlay)
				}
				if cell.Fg != nil {
					base = base.Patch(roleStyle(*cell.Fg))
				}
				style = base
			}
			if cell.Underlay != nil && *cell.Underlay == clistyle.RoleSelection && !style.HasBg {
				style = style.WithModifier(ModifierReversed)
			}
			if cell.Bold {
				style = style.WithModifier(ModifierBold)
			}
			if cell.Bg != nil {
				bgRole := roleStyle(*cell.Bg)
				if bgRole.HasFg {
					style = style.WithBg(bgRole.Fg)
				} else {
					style = style.WithBg(ResetColor)
				}
			}
			target := buffer.At(ax, ay)
			target.Reset()
			if !cell.Continuation {
				if cell.HeatLevel != nil && style.HasBg {
					target.SetSymbol(" ")
				} else {
					target.SetSymbol(cell.Glyph)
				}
			}
			target.SetStyle(style)
		}
	}
}
