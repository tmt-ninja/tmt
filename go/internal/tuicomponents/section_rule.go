package tuicomponents

import (
	"strings"

	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// SectionRuleProps configures SectionRule.
type SectionRuleProps struct {
	Title    string  `json:"title"`
	Note     *string `json:"note"`
	NoteRole *Token  `json:"note_role"`
	Focused  bool    `json:"focused"`
}

// SectionRule renders a title with an optional right-aligned note:
//
//	── Saved · 1d ───── 0.9% ──
//
// The note drops first; the title is then ellipsized.
type SectionRule struct{}

func fit(text string, width int) string {
	if uniseg.StringWidth(text) <= width {
		return text
	}
	if width == 0 {
		return ""
	}
	var out strings.Builder
	used := 0
	for rest, state := text, -1; rest != ""; {
		var grapheme string
		var gw int
		grapheme, rest, gw, state = uniseg.FirstGraphemeClusterInString(rest, state)
		if used+gw >= width {
			break
		}
		out.WriteString(grapheme)
		used += gw
	}
	out.WriteRune('…')
	return out.String()
}

func (SectionRule) Measure(props SectionRuleProps, constraints Constraints) Size {
	title := SingleLine(props.Title)
	width := 4 + uniseg.StringWidth(title)
	if props.Note != nil {
		width += uniseg.StringWidth(*props.Note) + 5
	}
	return constraints.Clamp(Size{
		Width:  clampU16(width),
		Height: 1,
	})
}

func (SectionRule) Render(props SectionRuleProps, area Rect, grid *CellGrid) []Hit {
	if area.Width == 0 || area.Height == 0 {
		return nil
	}
	width := int(area.Width)
	title := SingleLine(props.Title)
	if title == "" {
		grid.Text(area, strings.Repeat("─", width), clistyle.RoleDim, nil)
		return nil
	}
	titleWidth := uniseg.StringWidth(title)
	headingWidth := titleWidth + 4
	var note string
	hasNote := false
	if props.Note != nil && *props.Note != "" && headingWidth+uniseg.StringWidth(*props.Note)+5 <= width {
		note = *props.Note
		hasNote = true
	}
	prefixRunes := []rune("── ")
	prefix := string(prefixRunes[:min(width, 3)])
	prefixWidth := uniseg.StringWidth(prefix)
	grid.Text(area, prefix, clistyle.RoleDim, nil)

	var shown string
	if hasNote {
		shown = title + " "
	} else {
		available := min(satSubInt(width, prefixWidth), titleWidth+1)
		value := title + " "
		fitted := fit(value, available)
		shown = fitted + strings.Repeat(" ", satSubInt(available, uniseg.StringWidth(fitted)))
	}
	shownWidth := uniseg.StringWidth(shown)
	titleArea := area
	titleArea.X = satAddU16(area.X, uint16(prefixWidth))
	titleArea.Width = uint16(shownWidth)
	titleRole := clistyle.RoleMuted
	if props.Focused {
		titleRole = clistyle.RoleText
	}
	grid.Text(titleArea, shown, titleRole, nil)

	after := prefixWidth + shownWidth
	if hasNote {
		noteWidth := uniseg.StringWidth(note)
		fill := width - after - noteWidth - 4
		fillArea := area
		fillArea.X = satAddU16(area.X, uint16(after))
		fillArea.Width = uint16(fill)
		grid.Text(fillArea, strings.Repeat("─", fill), clistyle.RoleDim, nil)

		spaceArea := area
		spaceArea.X = satAddU16(area.X, uint16(after+fill))
		spaceArea.Width = 1
		grid.TextWith(spaceArea, " ", nil, nil, false)

		noteArea := area
		noteArea.X = satAddU16(area.X, uint16(after+fill+1))
		noteArea.Width = uint16(noteWidth)
		var noteFg *clistyle.Role
		if props.NoteRole != nil {
			r := props.NoteRole.Role()
			noteFg = &r
		}
		grid.TextWith(noteArea, note, noteFg, nil, false)

		tailArea := area
		tailArea.X = satAddU16(area.X, uint16(width-3))
		tailArea.Width = 3
		grid.Text(tailArea, " ──", clistyle.RoleDim, nil)
	} else {
		fill := satSubInt(width, after)
		fillArea := area
		fillArea.X = satAddU16(area.X, uint16(after))
		fillArea.Width = uint16(fill)
		grid.Text(fillArea, strings.Repeat("─", fill), clistyle.RoleDim, nil)
	}
	return nil
}
