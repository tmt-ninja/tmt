package tuicomponents

import (
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// SparklineProps configures Sparkline.
type SparklineProps struct {
	Points      []*uint64 `json:"points"`
	Scale       uint64    `json:"scale"`
	Unavailable bool      `json:"unavailable"`
}

// Sparkline renders one neutral spark glyph per exact bucket, distributed across the track:
//
//	▁▄█·
//
// A track narrower than the bucket count is not painted; callers choose a suitable range.
type Sparkline struct{}

var sparkBlocks = [9]string{" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"}

func (Sparkline) Measure(props SparklineProps, constraints Constraints) Size {
	return constraints.Clamp(Size{
		Width:  clampU16(len(props.Points)),
		Height: 1,
	})
}

func (Sparkline) Render(props SparklineProps, area Rect, grid *CellGrid) []Hit {
	if area.Height == 0 || len(props.Points) == 0 || int(area.Width) < len(props.Points) {
		return nil
	}
	width := int(area.Width)
	count := len(props.Points)
	denom := max(props.Scale, 1)
	for index, point := range props.Points {
		var glyph string
		if props.Unavailable {
			glyph = " "
		} else if point == nil {
			glyph = "·"
		} else if *point == 0 {
			glyph = " "
		} else {
			level := mulDivCeilU64(*point, 8, denom)
			if level < 1 {
				level = 1
			} else if level > 8 {
				level = 8
			}
			glyph = sparkBlocks[level]
		}
		start := width * index / count
		end := width * (index + 1) / count
		grid.Text(Rect{
			X:      satAddU16(area.X, uint16(start)),
			Y:      area.Y,
			Width:  uint16(end - start),
			Height: 1,
		}, strings.Repeat(glyph, end-start), clistyle.RoleMuted, nil)
	}
	return nil
}
