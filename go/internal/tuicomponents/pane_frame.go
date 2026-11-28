package tuicomponents

import (
	"strings"

	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// PaneFrameProps configures PaneFrame.
type PaneFrameProps struct {
	Title    string `json:"title"`
	Focused  bool   `json:"focused"`
	ASCII    bool   `json:"ascii"`
	BackHint bool   `json:"back_hint"`
}

// PaneFrame renders a focus-aware pane frame:
//
//	┏━ ▸ Agents ━━━━━━━━━━━━━━┓
//
// The hint is reserved before the title is ellipsized.
type PaneFrame struct{}

func (PaneFrame) Measure(props PaneFrameProps, constraints Constraints) Size {
	marker := 0
	if props.Focused {
		marker = 2
	}
	hint := 0
	if props.Focused && props.BackHint {
		hint = 11
	}
	return constraints.Clamp(Size{
		Width:  clampU16(5 + marker + hint + uniseg.StringWidth(props.Title)),
		Height: 6,
	})
}

func (PaneFrame) Render(props PaneFrameProps, area Rect, grid *CellGrid) []Hit {
	if area.Height < 3 || area.Width < 3 {
		return nil
	}
	var line, cornerLeft, cornerRight string
	switch {
	case props.Focused && !props.ASCII:
		line, cornerLeft, cornerRight = "━", "┏", "┓"
	case !props.Focused && !props.ASCII:
		line, cornerLeft, cornerRight = "─", "┌", "┐"
	case props.Focused && props.ASCII:
		line, cornerLeft, cornerRight = "=", "+", "+"
	default:
		line, cornerLeft, cornerRight = "-", "+", "+"
	}
	marker := ""
	if props.Focused {
		if props.ASCII {
			marker = "> "
		} else {
			marker = "▸ "
		}
	}
	hint := ""
	if props.Focused && props.BackHint {
		hint = " · Esc back"
	}
	title := clistyle.Escape(Sanitize(props.Title))
	width := int(area.Width)
	titleBudget := min(
		uniseg.StringWidth(title),
		satSubInt(width, 5+uniseg.StringWidth(marker)+uniseg.StringWidth(hint)),
	)
	title = fit(title, titleBudget)
	padding := satSubInt(titleBudget, uniseg.StringWidth(title))
	head := " " + marker + title + strings.Repeat(" ", padding) + hint + " "
	headWidth := uniseg.StringWidth(head)
	boxed := area.Height >= 6
	openGlyph, closeGlyph := line, line
	if boxed {
		openGlyph, closeGlyph = cornerLeft, cornerRight
	}
	fill := satSubInt(width, 3+headWidth)
	ruleRole := clistyle.RoleDim
	headRole := clistyle.RoleMuted
	if props.Focused {
		ruleRole = clistyle.RoleText
		headRole = clistyle.RoleText
	}
	leadArea := area
	leadArea.Width = 2
	grid.Text(leadArea, openGlyph+line, ruleRole, nil)

	headArea := area
	headArea.X = satAddU16(area.X, 2)
	headArea.Width = uint16(headWidth)
	grid.TextBold(headArea, head, headRole, nil, props.Focused)

	tail := strings.Repeat(line, fill) + closeGlyph
	tailArea := area
	tailArea.X = satAddU16(area.X, uint16(2+headWidth))
	tailArea.Width = clampU16(uniseg.StringWidth(tail))
	grid.Text(tailArea, tail, ruleRole, nil)

	if boxed {
		var vertical, bottomLeft, bottomRight string
		switch {
		case props.Focused && !props.ASCII:
			vertical, bottomLeft, bottomRight = "┃", "┗", "┛"
		case !props.Focused && !props.ASCII:
			vertical, bottomLeft, bottomRight = "│", "└", "┘"
		case props.Focused && props.ASCII:
			vertical, bottomLeft, bottomRight = "#", "+", "+"
		default:
			vertical, bottomLeft, bottomRight = "|", "+", "+"
		}
		for y := satAddU16(area.Y, 1); y < satAddU16(area.Y, area.Height-1); y++ {
			for _, x := range [2]uint16{area.X, satAddU16(area.X, area.Width-1)} {
				grid.Text(Rect{X: x, Y: y, Width: 1, Height: 1}, vertical, ruleRole, nil)
			}
		}
		bottom := bottomLeft + strings.Repeat(line, width-2) + bottomRight
		grid.Text(Rect{
			X:      area.X,
			Y:      satAddU16(area.Y, area.Height-1),
			Width:  area.Width,
			Height: 1,
		}, bottom, ruleRole, nil)
	}
	return nil
}
