package tuicomponents

import (
	"strconv"
	"strings"

	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// specBarCells is the 24-cell bar width from Digest spec f21e67b7.
const specBarCells = 24

// GaugeProps configures Gauge.
type GaugeProps struct {
	Label       string  `json:"label"`
	LabelWidth  uint16  `json:"label_width"`
	Numerator   uint64  `json:"numerator"`
	Denominator uint64  `json:"denominator"`
	Total       *string `json:"total"`
	FilledRole  Token   `json:"filled_role"`
	RestRole    Token   `json:"rest_role"`
}

// Gauge renders a model share, its proportion and optional total, per Digest spec f21e67b7:
//
//	claude-opus-5.5   ███████████████████·····  78%   655M
//
// The bar shrinks before the label and values.
type Gauge struct{}

func (Gauge) Measure(props GaugeProps, constraints Constraints) Size {
	totalWidth := 0
	if props.Total != nil {
		totalWidth = 3 + uniseg.StringWidth(*props.Total)
	}
	// Label, separator, the spec's 24-cell bar, two spaces and a 4-cell percent.
	width := int(props.LabelWidth) + 1 + specBarCells + 2 + 4 + totalWidth
	return constraints.Clamp(Size{
		Width:  clampU16(width),
		Height: 1,
	})
}

func (Gauge) Render(props GaugeProps, area Rect, grid *CellGrid) []Hit {
	grid.Clear(area)
	if area.Height == 0 {
		return nil
	}
	var percent string
	if props.Denominator == 0 {
		percent = "—"
	} else {
		clamped := min(props.Numerator, props.Denominator)
		value := mulDivRoundHalfUpU64(clamped, 100, props.Denominator)
		percent = strconv.FormatUint(value, 10) + "%"
	}
	labelWidth := min(props.LabelWidth, area.Width)
	label := fit(props.Label, int(labelWidth))
	labelArea := area
	labelArea.Width = labelWidth
	grid.Text(labelArea, label, clistyle.RoleText, nil)

	totalWidth := 0
	if props.Total != nil {
		totalWidth = 3 + uniseg.StringWidth(*props.Total)
	}
	percentWidth := uniseg.StringWidth(percent)
	fixed := int(labelWidth) + 1 + 2 + percentWidth + totalWidth
	if fixed > int(area.Width) {
		return nil
	}
	barWidth := min(satSubInt(int(area.Width), fixed), specBarCells)
	start := satAddU16(satAddU16(area.X, labelWidth), 1)
	filled := 0
	if props.Denominator != 0 {
		clamped := min(props.Numerator, props.Denominator)
		filled = int(mulDivRoundHalfUpU64(uint64(barWidth), clamped, props.Denominator))
	}
	filledArea := area
	filledArea.X = start
	filledArea.Width = uint16(filled)
	grid.Text(filledArea, strings.Repeat("█", filled), props.FilledRole.Role(), nil)

	restArea := area
	restArea.X = satAddU16(start, uint16(filled))
	restArea.Width = uint16(barWidth - filled)
	grid.Text(restArea, strings.Repeat("·", barWidth-filled), props.RestRole.Role(), nil)

	valueX := satAddU16(satAddU16(start, uint16(barWidth)), 2)
	pctArea := area
	pctArea.X = valueX
	pctArea.Width = uint16(percentWidth)
	grid.Text(pctArea, percent, clistyle.RoleText, nil)

	if props.Total != nil {
		totArea := area
		totArea.X = satAddU16(satAddU16(valueX, uint16(percentWidth)), 3)
		totArea.Width = clampU16(uniseg.StringWidth(*props.Total))
		grid.Text(totArea, *props.Total, clistyle.RoleText, nil)
	}
	return nil
}
