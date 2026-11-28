package tui

import (
	"strconv"
	"strings"

	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// ColorKind identifies a terminal color representation.
type ColorKind uint8

const (
	ColorReset ColorKind = iota
	ColorBlack
	ColorRed
	ColorGreen
	ColorYellow
	ColorBlue
	ColorMagenta
	ColorCyan
	ColorGray
	ColorDarkGray
	ColorLightRed
	ColorLightGreen
	ColorLightYellow
	ColorLightBlue
	ColorLightMagenta
	ColorLightCyan
	ColorWhite
	ColorIndexed
	ColorRGB
)

// Color is a terminal foreground or background color.
type Color struct {
	Kind  ColorKind
	R     uint8
	G     uint8
	B     uint8
	Index uint8
}

var (
	ResetColor        = Color{Kind: ColorReset}
	BlackColor        = Color{Kind: ColorBlack}
	RedColor          = Color{Kind: ColorRed}
	GreenColor        = Color{Kind: ColorGreen}
	YellowColor       = Color{Kind: ColorYellow}
	BlueColor         = Color{Kind: ColorBlue}
	MagentaColor      = Color{Kind: ColorMagenta}
	CyanColor         = Color{Kind: ColorCyan}
	GrayColor         = Color{Kind: ColorGray}
	DarkGrayColor     = Color{Kind: ColorDarkGray}
	LightRedColor     = Color{Kind: ColorLightRed}
	LightGreenColor   = Color{Kind: ColorLightGreen}
	LightYellowColor  = Color{Kind: ColorLightYellow}
	LightBlueColor    = Color{Kind: ColorLightBlue}
	LightMagentaColor = Color{Kind: ColorLightMagenta}
	LightCyanColor    = Color{Kind: ColorLightCyan}
	WhiteColor        = Color{Kind: ColorWhite}
)

func RGBColor(r, g, b uint8) Color { return Color{Kind: ColorRGB, R: r, G: g, B: b} }
func IndexedColor(i uint8) Color   { return Color{Kind: ColorIndexed, Index: i} }

// Modifier is a bitmask of terminal SGR text attributes.
type Modifier uint16

const (
	ModifierEmpty      Modifier = 0
	ModifierBold       Modifier = 1 << 0
	ModifierDim        Modifier = 1 << 1
	ModifierItalic     Modifier = 1 << 2
	ModifierUnderlined Modifier = 1 << 3
	ModifierSlowBlink  Modifier = 1 << 4
	ModifierRapidBlink Modifier = 1 << 5
	ModifierReversed   Modifier = 1 << 6
	ModifierHidden     Modifier = 1 << 7
	ModifierCrossedOut Modifier = 1 << 8
)

func (m Modifier) Contains(other Modifier) bool { return m&other == other }

// Style describes foreground, background, and modifier deltas for a cell.
type Style struct {
	Fg          Color
	Bg          Color
	AddModifier Modifier
	SubModifier Modifier
	HasFg       bool
	HasBg       bool
}

func NewStyle() Style { return Style{} }

func (s Style) WithFg(c Color) Style {
	s.Fg = c
	s.HasFg = true
	return s
}

func (s Style) WithBg(c Color) Style {
	s.Bg = c
	s.HasBg = true
	return s
}

func (s Style) WithModifier(m Modifier) Style {
	s.AddModifier |= m
	s.SubModifier &^= m
	return s
}

func (s Style) WithoutModifier(m Modifier) Style {
	s.AddModifier &^= m
	s.SubModifier |= m
	return s
}

func (s Style) Patch(other Style) Style {
	if other.HasFg {
		s.Fg = other.Fg
		s.HasFg = true
	}
	if other.HasBg {
		s.Bg = other.Bg
		s.HasBg = true
	}
	s.AddModifier &^= other.SubModifier
	s.AddModifier |= other.AddModifier
	s.SubModifier &^= other.AddModifier
	s.SubModifier |= other.SubModifier
	return s
}

// Position is a 2D cell coordinate.
type Position struct {
	X uint16
	Y uint16
}

// Rect is an unsigned cell-space rectangle (terminal buffer coordinates).
type Rect struct {
	X      uint16
	Y      uint16
	Width  uint16
	Height uint16
}

func NewRect(x, y, w, h uint16) Rect { return Rect{X: x, Y: y, Width: w, Height: h} }

func (r Rect) Right() uint16 {
	sum := uint32(r.X) + uint32(r.Width)
	if sum > 0xffff {
		return 0xffff
	}
	return uint16(sum)
}

func (r Rect) Bottom() uint16 {
	sum := uint32(r.Y) + uint32(r.Height)
	if sum > 0xffff {
		return 0xffff
	}
	return uint16(sum)
}

func (r Rect) IsEmpty() bool { return r.Width == 0 || r.Height == 0 }

func (r Rect) Contains(pos Position) bool {
	return pos.X >= r.X && pos.X < r.Right() && pos.Y >= r.Y && pos.Y < r.Bottom()
}

func (r Rect) Intersect(other Rect) Rect {
	x1 := max(r.X, other.X)
	y1 := max(r.Y, other.Y)
	x2 := min(r.Right(), other.Right())
	y2 := min(r.Bottom(), other.Bottom())
	if x2 <= x1 || y2 <= y1 {
		return Rect{X: x1, Y: y1}
	}
	return Rect{X: x1, Y: y1, Width: x2 - x1, Height: y2 - y1}
}

// BufferCell is one rendered cell in a terminal Buffer.
type BufferCell struct {
	Symbol   string
	Fg       Color
	Bg       Color
	Modifier Modifier
	Skip     bool
}

func (c *BufferCell) Reset() {
	c.Symbol = " "
	c.Fg = ResetColor
	c.Bg = ResetColor
	c.Modifier = ModifierEmpty
	c.Skip = false
}

func (c *BufferCell) SetSymbol(sym string) {
	c.Symbol = sym
}

func (c *BufferCell) SetStyle(style Style) {
	if style.HasFg {
		c.Fg = style.Fg
	}
	if style.HasBg {
		c.Bg = style.Bg
	}
	c.Modifier &^= style.SubModifier
	c.Modifier |= style.AddModifier
}

// Buffer is a 2D array of terminal BufferCells covering Area.
type Buffer struct {
	Area    Rect
	Content []BufferCell
}

// EmptyBuffer allocates a Buffer covering area filled with blank space cells.
func EmptyBuffer(area Rect) *Buffer {
	n := int(area.Width) * int(area.Height)
	content := make([]BufferCell, n)
	for i := range content {
		content[i] = BufferCell{Symbol: " ", Fg: ResetColor, Bg: ResetColor}
	}
	return &Buffer{Area: area, Content: content}
}

func (b *Buffer) IndexOf(x, y uint16) (int, bool) {
	if x < b.Area.X || x >= b.Area.Right() || y < b.Area.Y || y >= b.Area.Bottom() {
		return 0, false
	}
	return int(y-b.Area.Y)*int(b.Area.Width) + int(x-b.Area.X), true
}

func (b *Buffer) At(x, y uint16) *BufferCell {
	idx, ok := b.IndexOf(x, y)
	if !ok {
		return nil
	}
	return &b.Content[idx]
}

// SetString writes graphemes starting at (x, y) clipped to b.Area.
func (b *Buffer) SetString(x, y uint16, s string, style Style) {
	if y < b.Area.Y || y >= b.Area.Bottom() {
		return
	}
	cx := int(x)
	right := int(b.Area.Right())
	for rest, state := s, -1; rest != ""; {
		var g string
		var gw int
		g, rest, gw, state = uniseg.FirstGraphemeClusterInString(rest, state)
		if gw == 0 {
			continue
		}
		if cx >= right {
			break
		}
		if cx >= int(b.Area.X) && cx+gw <= right {
			cell := b.At(uint16(cx), y)
			cell.SetSymbol(g)
			cell.SetStyle(style)
			for dx := 1; dx < gw; dx++ {
				if cont := b.At(uint16(cx+dx), y); cont != nil {
					cont.SetSymbol("")
					cont.SetStyle(style)
				}
			}
		}
		cx += gw
	}
}

// ScreenStyle resolves a clistyle.Role through theme and depth into a Style.
func ScreenStyle(theme clistyle.Theme, role clistyle.Role, depth clistyle.Depth) Style {
	painted := theme.Paint(role, depth, "x")
	if painted == "x" || !strings.HasPrefix(painted, "\x1b[") {
		return NewStyle()
	}
	end := strings.IndexByte(painted, 'm')
	if end < 0 {
		return NewStyle()
	}
	params := strings.Split(painted[2:end], ";")
	nums := make([]int, 0, len(params))
	for _, p := range params {
		n, err := strconv.Atoi(p)
		if err != nil {
			return NewStyle()
		}
		nums = append(nums, n)
	}
	st := NewStyle()
	for i := 0; i < len(nums); i++ {
		code := nums[i]
		switch {
		case code == 1:
			st = st.WithModifier(ModifierBold)
		case code == 2:
			st = st.WithModifier(ModifierDim)
		case code == 7:
			st = st.WithModifier(ModifierReversed)
		case code >= 30 && code <= 37:
			st = st.WithFg(ansiColor(code - 30))
		case code >= 90 && code <= 97:
			st = st.WithFg(ansiColor(code - 90 + 8))
		case code >= 40 && code <= 47:
			st = st.WithBg(ansiColor(code - 40))
		case code >= 100 && code <= 107:
			st = st.WithBg(ansiColor(code - 100 + 8))
		case code == 38 && i+4 < len(nums) && nums[i+1] == 2:
			st = st.WithFg(RGBColor(uint8(nums[i+2]), uint8(nums[i+3]), uint8(nums[i+4])))
			i += 4
		case code == 48 && i+4 < len(nums) && nums[i+1] == 2:
			st = st.WithBg(RGBColor(uint8(nums[i+2]), uint8(nums[i+3]), uint8(nums[i+4])))
			i += 4
		}
	}
	return st
}

func ansiColor(idx int) Color {
	switch idx {
	case 0:
		return BlackColor
	case 1:
		return RedColor
	case 2:
		return GreenColor
	case 3:
		return YellowColor
	case 4:
		return BlueColor
	case 5:
		return MagentaColor
	case 6:
		return CyanColor
	case 7:
		return GrayColor
	case 8:
		return DarkGrayColor
	case 9:
		return LightRedColor
	case 10:
		return LightGreenColor
	case 11:
		return LightYellowColor
	case 12:
		return LightBlueColor
	case 13:
		return LightMagentaColor
	case 14:
		return LightCyanColor
	case 15:
		return WhiteColor
	default:
		return ResetColor
	}
}
