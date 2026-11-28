package tui

import "github.com/tmt-ninja/tmt/go/internal/clistyle"

// Placement selects how a Modal is positioned inside the body area.
type Placement uint8

const (
	PlacementBody Placement = iota
	PlacementCenter
	PlacementDocked
)

// Modal describes overlay chrome and placement.
type Modal struct {
	Title     string
	Placement Placement
}

// ModalAreas holds the computed regions of a Modal.
type ModalAreas struct {
	Outer    Rect
	Content  Rect
	Footer   Rect
	Status   Rect
	Position Rect
}

func (m Modal) Areas(body Rect, demand [2]uint16, footer, status bool) ModalAreas {
	var fl, sl uint16
	if footer {
		fl = 1
	}
	if status {
		sl = 1
	}
	return m.areasWithLines(body, demand, fl, sl)
}

func (m Modal) areasWithLines(body Rect, demand [2]uint16, footerLines, statusLines uint16) ModalAreas {
	var outer Rect
	if m.Placement == PlacementBody {
		outer = body
	} else {
		var width uint16
		if body.Width < clistyle.MediumWidth {
			width = body.Width
		} else {
			width = min(demand[0], uint16(uint32(body.Width)*9/10))
		}
		height := min(demand[1], uint16(uint32(body.Height)*4/5))
		ox := body.X + (body.Width-min(body.Width, width))/2
		var oy uint16
		if m.Placement == PlacementDocked {
			oy = body.Y + (body.Height - min(body.Height, height))
		} else {
			oy = body.Y + (body.Height-min(body.Height, height))/2
		}
		outer = NewRect(ox, oy, width, height)
	}
	inner := outer.Inner(1, 1)
	insetX := inner.X
	if inner.Width > 0 && insetX < 0xffff {
		insetX++
	}
	insetW := uint16(0)
	if inner.Width > 2 {
		insetW = inner.Width - 2
	}
	inset := NewRect(insetX, inner.Y, insetW, inner.Height)
	footerH := min(footerLines, inset.Height)
	remAfterFooter := inset.Height - footerH
	statusH := min(statusLines, remAfterFooter)
	posH := uint16(0)
	if inset.Height > footerH+statusH {
		posH = 1
	}
	contentH := inset.Height - footerH - statusH - posH
	content := NewRect(inset.X, inset.Y, inset.Width, contentH)
	position := NewRect(inset.X, inset.Y+contentH, inset.Width, posH)
	status := NewRect(inset.X, position.Y+posH, inset.Width, statusH)
	footer := NewRect(inset.X, status.Y+statusH, inset.Width, footerH)
	return ModalAreas{
		Outer:    outer,
		Content:  content,
		Footer:   footer,
		Status:   status,
		Position: position,
	}
}

func (m Modal) Paint(areas ModalAreas, buffer *Buffer, theme clistyle.Theme, depth clistyle.Depth) {
	m.paintFrame(areas, buffer, theme, depth, OutlineSquare)
}

func (m Modal) PaintFlat(areas ModalAreas, buffer *Buffer, theme clistyle.Theme, depth clistyle.Depth) {
	m.paintFrame(areas, buffer, theme, depth, OutlineFlat)
}

func (m Modal) paintFrame(areas ModalAreas, buffer *Buffer, theme clistyle.Theme, depth clistyle.Depth, frame OutlineFrame) {
	area := areas.Outer.Intersect(buffer.Area)
	buffer.Clear(area)
	buffer.SetStyle(area, ScreenStyle(theme, clistyle.RoleText, depth))
	borderStyle := ScreenStyle(theme, clistyle.RoleDim, depth)
	var titleLine *Line
	if m.Title != "" {
		l := StyledLine(" "+clistyle.Escape(m.Title)+" ", ScreenStyle(theme, clistyle.RoleMuted, depth))
		titleLine = &l
	}
	paintBlockBorder(area, buffer, frame, borderStyle, NewStyle(), titleLine, nil, false)
}
