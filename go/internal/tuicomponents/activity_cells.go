package tuicomponents

import "github.com/tmt-ninja/tmt/go/internal/clistyle"

// ActivityCellsProps configures ActivityCells.
type ActivityCellsProps struct {
	Values   []*uint64 `json:"values"`
	Selected bool      `json:"selected"`
}

// ActivityCells renders activity observations: a dim gap or zero and six
// foreground glyph levels. Visible cells share the selection underlay when selected.
type ActivityCells struct{}

var activityGlyphs = [6]string{"▂", "▃", "▄", "▅", "▆", "█"}

func (ActivityCells) Measure(props ActivityCellsProps, constraints Constraints) Size {
	return constraints.Clamp(Size{
		Width:  clampU16(len(props.Values)),
		Height: 1,
	})
}

func (ActivityCells) Render(props ActivityCellsProps, area Rect, grid *CellGrid) []Hit {
	grid.Clear(area)
	if area.Height == 0 {
		return nil
	}
	var maximum uint64
	for _, v := range props.Values {
		if v != nil && *v > maximum {
			maximum = *v
		}
	}
	// The selection surface needs the higher-contrast secondary foreground.
	quiet := clistyle.RoleDim
	if props.Selected {
		quiet = clistyle.RoleMuted
	}
	limit := min(len(props.Values), int(area.Width))
	for i := 0; i < limit; i++ {
		value := props.Values[i]
		x := satAddU16(area.X, uint16(i))
		rect := Rect{
			X:      x,
			Y:      area.Y,
			Width:  1,
			Height: min(area.Height, 1),
		}
		var glyph string
		var role clistyle.Role
		switch {
		case value == nil:
			glyph, role = "·", quiet
		case *value == 0:
			glyph, role = "▁", quiet
		default:
			level := mulDivCeilU64(*value, 6, maximum)
			if level < 1 {
				level = 1
			} else if level > 6 {
				level = 6
			}
			glyph, role = activityGlyphs[level-1], clistyle.RoleText
		}
		grid.Text(rect, glyph, role, nil)
		if props.Selected {
			if cell := grid.Get(x, area.Y); cell != nil {
				c := cloneCell(*cell)
				c.Underlay = rolePtr(clistyle.RoleSelection)
				grid.Set(x, area.Y, c)
			}
		}
	}
	return nil
}
