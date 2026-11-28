package tuicomponents

import "github.com/tmt-ninja/tmt/go/internal/clistyle"

// StackedPoint holds one aligned used/saved observation pair.
type StackedPoint struct {
	Used  *uint64 `json:"used"`
	Saved *uint64 `json:"saved"`
}

// StackedBarsProps configures StackedBars.
type StackedBarsProps struct {
	Points      []StackedPoint `json:"points"`
	UsedRole    Token          `json:"used_role"`
	SavedRole   Token          `json:"saved_role"`
	MissingRole Token          `json:"missing_role"`
}

// StackedBars renders two rows of used values, with saved as the bottom portion of each bar.
type StackedBars struct{}

func (StackedBars) Measure(props StackedBarsProps, constraints Constraints) Size {
	return constraints.Clamp(Size{
		Width:  clampU16(len(props.Points)),
		Height: 2,
	})
}

func (StackedBars) Render(props StackedBarsProps, area Rect, grid *CellGrid) []Hit {
	grid.Clear(area)
	if area.Width == 0 || area.Height == 0 {
		return nil
	}
	if len(props.Points) == 0 {
		grid.Text(area, "No aligned used/saved observations yet", props.MissingRole.Role(), nil)
		return nil
	}
	var maximum uint64 = 1
	for _, item := range props.Points {
		if item.Used != nil && item.Saved != nil && *item.Saved <= *item.Used {
			if *item.Used > maximum {
				maximum = *item.Used
			}
		}
	}
	rows := min(area.Height, 2)
	for y := uint16(0); y < rows; y++ {
		for x := uint16(0); x < area.Width; x++ {
			point := props.Points[int(x)*len(props.Points)/int(area.Width)]
			rect := Rect{
				X:      satAddU16(area.X, x),
				Y:      satAddU16(area.Y, y),
				Width:  1,
				Height: 1,
			}
			if point.Used == nil || point.Saved == nil || *point.Saved > *point.Used {
				grid.Text(rect, "·", props.MissingRole.Role(), nil)
				continue
			}
			base := uint64(1-y) * 8
			totalH := mulDivCeilU64(*point.Used, 16, maximum)
			var height uint64
			if totalH > base {
				height = min(totalH-base, 8)
			}
			savedTotal := mulDivFloorU64(*point.Saved, 16, maximum)
			var savedHeight uint64
			if savedTotal > base {
				savedHeight = min(savedTotal-base, 8)
			}
			var glyph string
			var fg clistyle.Role
			var bg *clistyle.Role
			if savedHeight > 0 && savedHeight < height {
				glyph = sparkBlocks[savedHeight]
				fg = props.SavedRole.Role()
				bg = rolePtr(props.UsedRole.Role())
			} else {
				glyph = sparkBlocks[height]
				if savedHeight > 0 {
					fg = props.SavedRole.Role()
				} else {
					fg = props.UsedRole.Role()
				}
			}
			grid.Text(rect, glyph, fg, bg)
		}
	}
	return nil
}
