package tuicomponents

import (
	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// Chip is a single selectable item in a ChipRow.
type Chip struct {
	ID      HitId  `json:"id"`
	Label   string `json:"label"`
	Gap     string `json:"gap"`
	Enabled bool   `json:"enabled"`
}

// ChipRowProps configures ChipRow.
type ChipRowProps struct {
	Label    string `json:"label"`
	Chips    []Chip `json:"chips"`
	Selected *int   `json:"selected"`
	Cursor   *int   `json:"cursor"`
	Active   bool   `json:"active"`
}

// ChipRow renders a caption and a row of caller-owned selectable chips:
//
//	Range  1d   7d   30d
//
// Only a prefix of completely visible chips is painted and receives hits.
type ChipRow struct{}

func (ChipRow) Measure(props ChipRowProps, constraints Constraints) Size {
	width := uniseg.StringWidth(props.Label)
	for _, chip := range props.Chips {
		width += uniseg.StringWidth(chip.Label) + 2 + uniseg.StringWidth(chip.Gap)
	}
	return constraints.Clamp(Size{
		Width:  clampU16(width),
		Height: 1,
	})
}

func (ChipRow) Render(props ChipRowProps, area Rect, grid *CellGrid) []Hit {
	size := grid.Size()
	if area.Height == 0 || area.Y >= size.Height || area.X >= size.Width {
		return nil
	}
	end := min(satAddU16(area.X, area.Width), size.Width)
	captionWidth := uint16(min(uniseg.StringWidth(props.Label), int(satSubU16(end, area.X))))
	captionArea := area
	captionArea.Width = captionWidth
	captionArea.Height = 1
	grid.Text(captionArea, props.Label, clistyle.RoleMuted, nil)

	x := satAddU16(area.X, captionWidth)
	var hits []Hit
	for index, chip := range props.Chips {
		label := " " + chip.Label + " "
		naturalWidth := uniseg.StringWidth(label)
		if naturalWidth > int(satSubU16(end, x)) {
			break
		}
		width := uint16(naturalWidth)
		rect := Rect{X: x, Y: area.Y, Width: width, Height: 1}
		var surface *ChipSurface
		if !chip.Enabled {
			s := ChipSurfaceDisabled
			surface = &s
		} else if (props.Selected != nil && *props.Selected == index) ||
			(props.Active && props.Cursor != nil && *props.Cursor == index) {
			s := ChipSurfaceHot
			surface = &s
		}
		if surface != nil {
			grid.Chip(rect, label, *surface)
		} else {
			grid.Text(rect, label, clistyle.RoleMuted, nil)
		}
		if chip.Enabled {
			hits = append(hits, Hit{Rect: rect, ID: chip.ID})
		}
		x = satAddU16(x, width)
		gapWidth := uint16(min(uniseg.StringWidth(chip.Gap), int(satSubU16(end, x))))
		grid.Text(Rect{X: x, Y: area.Y, Width: gapWidth, Height: 1}, chip.Gap, clistyle.RoleMuted, nil)
		x = satAddU16(x, gapWidth)
	}
	return hits
}
