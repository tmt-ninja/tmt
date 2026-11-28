package tuicomponents

import "github.com/tmt-ninja/tmt/go/internal/clistyle"

// PaneRuleProps configures PaneRule.
type PaneRuleProps struct {
	Title    string  `json:"title"`
	Note     *string `json:"note"`
	NoteRole *Token  `json:"note_role"`
	Focused  bool    `json:"focused"`
	ASCII    bool    `json:"ascii"`
}

// PaneRule renders an unboxed pane control rule with a bold focus marker:
//
//	▸━ Agents ━━━━━━━━━ / Search ━━
//
// The note drops first; the title is then ellipsized.
type PaneRule struct{}

func (PaneRule) Measure(props PaneRuleProps, constraints Constraints) Size {
	return (SectionRule{}).Measure(SectionRuleProps{
		Title:    props.Title,
		Note:     props.Note,
		NoteRole: props.NoteRole,
		Focused:  false,
	}, constraints)
}

func (PaneRule) Render(props PaneRuleProps, area Rect, grid *CellGrid) []Hit {
	(SectionRule{}).Render(SectionRuleProps{
		Title:    props.Title,
		Note:     props.Note,
		NoteRole: props.NoteRole,
		Focused:  false,
	}, area, grid)
	if !props.Focused || area.Width == 0 || area.Height == 0 {
		return nil
	}
	first := grid.Get(area.X, area.Y)
	if first == nil || first.Glyph != "─" {
		return nil
	}
	end := min(satAddU16(area.X, area.Width), grid.Size().Width)
	for x := area.X; x < end; x++ {
		cell := grid.Get(x, area.Y)
		if cell == nil {
			continue
		}
		c := cloneCell(*cell)
		if x == area.X {
			if props.ASCII {
				c.Glyph = ">"
			} else {
				c.Glyph = "▸"
			}
			c.Underlay = copyRolePtr(c.Fg)
			c.Fg = rolePtr(clistyle.RoleText)
			c.Bold = true
		} else if c.Glyph == "─" {
			c.Glyph = "━"
			c.Underlay = copyRolePtr(c.Fg)
			c.Fg = rolePtr(clistyle.RoleText)
		}
		grid.Set(x, area.Y, c)
	}
	return nil
}
