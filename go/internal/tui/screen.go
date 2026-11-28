package tui

import (
	"math"

	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// Span is a single styled text run in a Line.
type Span struct {
	Content string
	Style   Style
}

func RawSpan(content string) Span             { return Span{Content: content} }
func StyledSpan(content string, s Style) Span { return Span{Content: content, Style: s} }
func (s Span) Width() int                     { return uniseg.StringWidth(s.Content) }

// Line is a single horizontal line of styled Spans.
type Line struct {
	Spans []Span
	Style Style
}

func RawLine(content string) Line {
	if content == "" {
		return Line{}
	}
	return Line{Spans: []Span{RawSpan(content)}}
}

func StyledLine(content string, s Style) Line {
	if content == "" {
		return Line{Style: s}
	}
	return Line{Spans: []Span{StyledSpan(content, s)}}
}

func LineFromSpans(spans ...Span) Line {
	return Line{Spans: spans}
}

func (l Line) WithStyle(s Style) Line {
	l.Style = s
	return l
}

func (l Line) Width() int {
	w := 0
	for _, s := range l.Spans {
		w += s.Width()
	}
	return w
}

// Clear resets every cell in area (clipped to b.Area) to a blank space.
func (b *Buffer) Clear(area Rect) {
	vis := area.Intersect(b.Area)
	for y := vis.Y; y < vis.Bottom(); y++ {
		for x := vis.X; x < vis.Right(); x++ {
			b.At(x, y).Reset()
		}
	}
}

// SetStyle applies style to every cell in area (clipped to b.Area).
func (b *Buffer) SetStyle(area Rect, style Style) {
	vis := area.Intersect(b.Area)
	for y := vis.Y; y < vis.Bottom(); y++ {
		for x := vis.X; x < vis.Right(); x++ {
			b.At(x, y).SetStyle(style)
		}
	}
}

// Inner shrinks r by (mx, my) on all sides without underflow.
func (r Rect) Inner(mx, my uint16) Rect {
	w := uint16(0)
	if r.Width > 2*mx {
		w = r.Width - 2*mx
	}
	h := uint16(0)
	if r.Height > 2*my {
		h = r.Height - 2*my
	}
	return Rect{
		X:      r.X + min(mx, r.Width),
		Y:      r.Y + min(my, r.Height),
		Width:  w,
		Height: h,
	}
}

// Fill selects solid vs lightened surface fills.
type Fill uint8

const (
	FillSolid Fill = iota
	FillLighter
)

// ChipKind selects secondary (neutral) vs primary (accent) chip surfaces.
type ChipKind uint8

const (
	ChipKindSecondary ChipKind = iota
	ChipKindPrimary
)

// ChipState selects idle, hot, or disabled chip presentation.
type ChipState uint8

const (
	ChipStateIdle ChipState = iota
	ChipStateHot
	ChipStateDisabled
)

const lighterPercent = 18

func rgbFillStyle(r, g, b uint8) Style {
	linear := func(v uint8) float64 {
		x := float64(v) / 255.0
		if x <= 0.04045 {
			return x / 12.92
		}
		return math.Pow((x+0.055)/1.055, 2.4)
	}
	lum := 0.2126*linear(r) + 0.7152*linear(g) + 0.0722*linear(b)
	fg := WhiteColor
	if (lum+0.05)/0.05 >= 1.05/(lum+0.05) {
		fg = BlackColor
	}
	return NewStyle().WithBg(RGBColor(r, g, b)).WithFg(fg)
}

func roleColor(theme clistyle.Theme, role clistyle.Role, depth clistyle.Depth) (Color, bool) {
	st := ScreenStyle(theme, role, depth)
	if st.HasFg {
		return st.Fg, true
	}
	if st.HasBg {
		return st.Bg, true
	}
	return ResetColor, false
}

// ScreenNeutralRamp resolves one of six neutral fills (0..5) between Track and Text.
func ScreenNeutralRamp(theme clistyle.Theme, depth clistyle.Depth, step uint8) Style {
	if depth == clistyle.NoColor || theme.Base == clistyle.ThemeMono {
		return NewStyle()
	}
	if step > 5 {
		step = 5
	}
	grey := func(role clistyle.Role) (uint16, bool) {
		c, ok := roleColor(theme, role, clistyle.TrueColor)
		if !ok || c.Kind != ColorRGB {
			return 0, false
		}
		return (uint16(c.R) + uint16(c.G) + uint16(c.B)) / 3, true
	}
	if depth == clistyle.TrueColor {
		if start, ok1 := grey(clistyle.RoleTrack); ok1 {
			if end, ok2 := grey(clistyle.RoleText); ok2 {
				v := uint8((start*uint16(5-step) + end*uint16(step)) / 5)
				return rgbFillStyle(v, v, v)
			}
		}
	}
	bgs := [6]Color{BlackColor, DarkGrayColor, DarkGrayColor, GrayColor, GrayColor, WhiteColor}
	fg := BlackColor
	if step < 3 {
		fg = WhiteColor
	}
	return NewStyle().WithBg(bgs[step]).WithFg(fg)
}

// ScreenFill resolves a bar segment fill in the role's color with readable foreground.
func ScreenFill(theme clistyle.Theme, role clistyle.Role, depth clistyle.Depth, fill Fill) Style {
	c, ok := roleColor(theme, role, depth)
	if !ok {
		return ScreenStyle(theme, role, depth)
	}
	if c.Kind == ColorRGB {
		lighten := func(ch uint8) uint8 {
			if depth == clistyle.TrueColor && fill == FillLighter {
				return ch + uint8(uint16(255-ch)*lighterPercent/100)
			}
			return ch
		}
		return rgbFillStyle(lighten(c.R), lighten(c.G), lighten(c.B))
	}
	return NewStyle().WithBg(c)
}

// ScreenChip resolves a padded control's surface using theme roles and overrides.
func ScreenChip(theme clistyle.Theme, kind ChipKind, state ChipState, depth clistyle.Depth) Style {
	if depth == clistyle.NoColor {
		if state == ChipStateDisabled {
			return NewStyle().WithModifier(ModifierDim)
		}
		switch {
		case kind == ChipKindSecondary && state == ChipStateIdle:
			return NewStyle().WithModifier(ModifierReversed)
		case kind == ChipKindSecondary && state == ChipStateHot:
			return NewStyle().WithModifier(ModifierReversed | ModifierBold)
		case kind == ChipKindPrimary && state == ChipStateIdle:
			return NewStyle().WithModifier(ModifierReversed | ModifierBold)
		default:
			return NewStyle().WithModifier(ModifierReversed | ModifierBold | ModifierUnderlined)
		}
	}
	if state == ChipStateDisabled {
		return ScreenFill(theme, clistyle.RoleTrack, depth, FillSolid).WithModifier(ModifierDim)
	}
	idleRole := clistyle.RoleTrack
	if kind == ChipKindPrimary {
		idleRole = clistyle.RoleAccent
	}
	idle := ScreenFill(theme, idleRole, depth, FillSolid)
	if state == ChipStateIdle {
		return idle
	}
	var hot Style
	if kind == ChipKindSecondary {
		hot = ScreenFill(theme, clistyle.RoleSelection, depth, FillSolid)
	} else {
		hot = ScreenFill(theme, clistyle.RoleAccent, depth, FillLighter)
	}
	if depth == clistyle.ANSI16 {
		hot = hot.WithModifier(ModifierBold)
	}
	if hot != idle {
		return hot
	}
	emphasized := hot.WithModifier(ModifierBold)
	if emphasized == idle {
		return emphasized.WithModifier(ModifierUnderlined)
	}
	return emphasized
}
