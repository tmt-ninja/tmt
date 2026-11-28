package tui

import "github.com/tmt-ninja/tmt/go/internal/clistyle"

// Button describes one padded button chip in a ButtonRow.
type Button struct {
	Label       string
	focused     bool
	selected    bool
	enabled     bool
	destructive bool
	idle        *Style
}

func SecondaryButton(label string) Button {
	return Button{Label: label, enabled: true}
}

func PrimaryButton(label string) Button {
	return SecondaryButton(label).WithFocused(true)
}

func (b Button) WithFocused(focused bool) Button         { b.focused = focused; return b }
func (b Button) WithSelected(selected bool) Button       { b.selected = selected; return b }
func (b Button) WithEnabled(enabled bool) Button         { b.enabled = enabled; return b }
func (b Button) WithDestructive(destructive bool) Button { b.destructive = destructive; return b }
func (b Button) WithIdle(style Style) Button             { b.idle = &style; return b }
func (b Button) IsEnabled() bool                         { return b.enabled }
func (b Button) IsFocused() bool                         { return b.focused }

// ButtonRow paints a horizontal strip of Buttons.
type ButtonRow struct {
	Theme   clistyle.Theme
	Depth   clistyle.Depth
	Align   clistyle.Align
	Active  bool
	Hovered *Rect
}

func (r ButtonRow) styleFor(btn Button, hovered bool) Style {
	state := ChipStateIdle
	if !btn.enabled {
		state = ChipStateDisabled
	} else if btn.selected || (r.Active && (btn.focused || hovered)) {
		state = ChipStateHot
	}
	if state == ChipStateIdle && btn.idle != nil {
		return *btn.idle
	}
	chip := ScreenChip(r.Theme, ChipKindSecondary, state, r.Depth)
	if btn.destructive && state != ChipStateDisabled {
		blockedStyle := ScreenStyle(r.Theme, clistyle.RoleBlocked, r.Depth)
		if blockedStyle.HasFg {
			if state == ChipStateHot {
				fill := ScreenFill(r.Theme, clistyle.RoleBlocked, r.Depth, FillSolid)
				if fill.HasFg {
					return fill
				}
			}
			return chip.WithFg(blockedStyle.Fg)
		}
	}
	return chip
}

// Paint fits a priority-ordered prefix of whole buttons; clipped buttons return nil.
func (r ButtonRow) Paint(buffer *Buffer, area Rect, buttons []Button) []*Rect {
	specs := make([]ChipSpec, len(buttons))
	for i, btn := range buttons {
		specs[i] = ChipSpec{Label: btn.Label, Style: r.styleFor(btn, false)}
	}
	painted := PaintChips(buffer, area, specs, r.Align)
	for i, btn := range buttons {
		rect := painted[i]
		if rect != nil && r.Active && btn.enabled && r.Hovered != nil && *r.Hovered == *rect {
			PaintChip(buffer, *rect, btn.Label, r.styleFor(btn, true), clistyle.AlignLeft)
		}
	}
	return painted
}
