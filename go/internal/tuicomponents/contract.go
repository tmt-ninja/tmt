package tuicomponents

import (
	"encoding/json"
	"errors"
	"math"
	"math/big"
	"math/bits"

	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// Token is a semantic color role serialized using its design-token name.
type Token clistyle.Role

// Role returns the underlying clistyle.Role.
func (t Token) Role() clistyle.Role {
	return clistyle.Role(t)
}

func (t Token) MarshalJSON() ([]byte, error) {
	return json.Marshal(clistyle.Role(t).String())
}

func (t *Token) UnmarshalJSON(data []byte) error {
	var name string
	if err := json.Unmarshal(data, &name); err != nil {
		return err
	}
	role, ok := clistyle.ParseRole(name)
	if !ok {
		return errors.New("unknown style role")
	}
	*t = Token(role)
	return nil
}

// Size is a width/height pair in terminal cells.
type Size struct {
	Width  uint16 `json:"width"`
	Height uint16 `json:"height"`
}

// Rect is a cell-space rectangle.
type Rect struct {
	X      uint16 `json:"x"`
	Y      uint16 `json:"y"`
	Width  uint16 `json:"width"`
	Height uint16 `json:"height"`
}

// Constraints bounds a component's measured Size.
type Constraints struct {
	Min Size
	Max Size
}

// Clamp bounds size within c.Min (clamped to c.Max) and c.Max.
func (c Constraints) Clamp(size Size) Size {
	minW := min(c.Min.Width, c.Max.Width)
	minH := min(c.Min.Height, c.Max.Height)
	return Size{
		Width:  min(max(size.Width, minW), c.Max.Width),
		Height: min(max(size.Height, minH), c.Max.Height),
	}
}

// ChipSurface identifies semantic secondary-chip surfaces resolved by the presentation adapter.
type ChipSurface string

const (
	ChipSurfaceIdle     ChipSurface = "idle"
	ChipSurfaceHot      ChipSurface = "hot"
	ChipSurfaceDisabled ChipSurface = "disabled"
)

func (s *ChipSurface) UnmarshalJSON(data []byte) error {
	var raw string
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	switch ChipSurface(raw) {
	case ChipSurfaceIdle, ChipSurfaceHot, ChipSurfaceDisabled:
		*s = ChipSurface(raw)
		return nil
	default:
		return errors.New("unknown chip surface")
	}
}

// HeatLevel is one of the six neutral activity-ramp steps (0..5), resolved by the presentation adapter.
type HeatLevel uint8

const (
	HeatLevelZero HeatLevel = iota
	HeatLevelOne
	HeatLevelTwo
	HeatLevelThree
	HeatLevelFour
	HeatLevelFive
)

func (h HeatLevel) MarshalJSON() ([]byte, error) {
	return json.Marshal(uint8(h))
}

func (h *HeatLevel) UnmarshalJSON(data []byte) error {
	var raw uint8
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if raw > uint8(HeatLevelFive) {
		return errors.New("invalid heat level")
	}
	*h = HeatLevel(raw)
	return nil
}

// Cell is a single terminal cell in a CellGrid.
// Continuations occupy the extra cells of a wide grapheme.
type Cell struct {
	Glyph        string
	Underlay     *clistyle.Role
	Fg           *clistyle.Role
	Bg           *clistyle.Role
	Bold         bool
	ChipSurface  *ChipSurface
	HeatLevel    *HeatLevel
	Continuation bool
}

// DefaultCell returns a blank space cell with no roles or flags set.
func DefaultCell() Cell {
	return Cell{Glyph: " "}
}

type cellWire struct {
	Glyph        string       `json:"glyph"`
	Underlay     *Token       `json:"underlay"`
	Fg           *Token       `json:"fg"`
	Bg           *Token       `json:"bg"`
	Bold         bool         `json:"bold"`
	ChipSurface  *ChipSurface `json:"chip_surface"`
	HeatLevel    *HeatLevel   `json:"heat_level,omitempty"`
	Continuation bool         `json:"continuation"`
}

func roleToTokenPtr(r *clistyle.Role) *Token {
	if r == nil {
		return nil
	}
	t := Token(*r)
	return &t
}

func tokenToRolePtr(t *Token) *clistyle.Role {
	if t == nil {
		return nil
	}
	r := clistyle.Role(*t)
	return &r
}

func rolePtr(r clistyle.Role) *clistyle.Role {
	return &r
}

func (c Cell) MarshalJSON() ([]byte, error) {
	return json.Marshal(cellWire{
		Glyph:        c.Glyph,
		Underlay:     roleToTokenPtr(c.Underlay),
		Fg:           roleToTokenPtr(c.Fg),
		Bg:           roleToTokenPtr(c.Bg),
		Bold:         c.Bold,
		ChipSurface:  c.ChipSurface,
		HeatLevel:    c.HeatLevel,
		Continuation: c.Continuation,
	})
}

func (c *Cell) UnmarshalJSON(data []byte) error {
	var w cellWire
	if err := json.Unmarshal(data, &w); err != nil {
		return err
	}
	*c = Cell{
		Glyph:        w.Glyph,
		Underlay:     tokenToRolePtr(w.Underlay),
		Fg:           tokenToRolePtr(w.Fg),
		Bg:           tokenToRolePtr(w.Bg),
		Bold:         w.Bold,
		ChipSurface:  w.ChipSurface,
		HeatLevel:    w.HeatLevel,
		Continuation: w.Continuation,
	}
	return nil
}

// CellGrid is a 2D buffer of role-styled cells.
type CellGrid struct {
	size  Size
	cells []Cell
}

// NewCellGrid allocates a CellGrid filled with DefaultCell().
func NewCellGrid(size Size) CellGrid {
	n := int(size.Width) * int(size.Height)
	cells := make([]Cell, n)
	for i := range cells {
		cells[i] = DefaultCell()
	}
	return CellGrid{size: size, cells: cells}
}

// Clone returns a deep copy of the CellGrid.
func (g *CellGrid) Clone() CellGrid {
	cells := make([]Cell, len(g.cells))
	for i, c := range g.cells {
		cells[i] = cloneCell(c)
	}
	return CellGrid{size: g.size, cells: cells}
}

func cloneCell(c Cell) Cell {
	out := c
	if c.Underlay != nil {
		v := *c.Underlay
		out.Underlay = &v
	}
	if c.Fg != nil {
		v := *c.Fg
		out.Fg = &v
	}
	if c.Bg != nil {
		v := *c.Bg
		out.Bg = &v
	}
	if c.ChipSurface != nil {
		v := *c.ChipSurface
		out.ChipSurface = &v
	}
	if c.HeatLevel != nil {
		v := *c.HeatLevel
		out.HeatLevel = &v
	}
	return out
}

// Size returns the grid dimensions.
func (g *CellGrid) Size() Size {
	return g.size
}

// Get returns a pointer to the cell at (x, y), or nil if out of bounds.
func (g *CellGrid) Get(x, y uint16) *Cell {
	if x < g.size.Width && y < g.size.Height {
		return &g.cells[int(y)*int(g.size.Width)+int(x)]
	}
	return nil
}

// Set replaces the cell at (x, y) if in bounds.
func (g *CellGrid) Set(x, y uint16, cell Cell) {
	if x < g.size.Width && y < g.size.Height {
		g.cells[int(y)*int(g.size.Width)+int(x)] = cell
	}
}

// Text writes complete graphemes only; it never emits a partial wide character.
func (g *CellGrid) Text(area Rect, text string, fg clistyle.Role, bg *clistyle.Role) {
	g.TextWith(area, text, &fg, bg, false)
}

// TextBold writes a line with explicit semantic emphasis.
func (g *CellGrid) TextBold(area Rect, text string, fg clistyle.Role, bg *clistyle.Role, bold bool) {
	g.TextWith(area, text, &fg, bg, bold)
}

// TextWith writes text with an optional inherited foreground role.
func (g *CellGrid) TextWith(area Rect, text string, fg *clistyle.Role, bg *clistyle.Role, bold bool) {
	x := area.X
	end := min(satAddU16(area.X, area.Width), g.size.Width)
	if area.Y >= g.size.Height || area.Height == 0 {
		return
	}
	for rest, state := text, -1; rest != ""; {
		var grapheme string
		var width int
		grapheme, rest, width, state = uniseg.FirstGraphemeClusterInString(rest, state)
		if width == 0 {
			continue
		}
		if int(satSubU16(end, x)) < width {
			break
		}
		g.Set(x, area.Y, Cell{
			Glyph:        grapheme,
			Fg:           copyRolePtr(fg),
			Bg:           copyRolePtr(bg),
			Bold:         bold,
			Continuation: false,
		})
		for dx := 1; dx < width; dx++ {
			g.Set(x+uint16(dx), area.Y, Cell{
				Glyph:        "",
				Fg:           copyRolePtr(fg),
				Bg:           copyRolePtr(bg),
				Bold:         bold,
				Continuation: true,
			})
		}
		x += uint16(width)
	}
}

// Chip paints a chip with its semantic surface; no palette is resolved here.
func (g *CellGrid) Chip(area Rect, text string, surface ChipSurface) {
	g.Text(area, text, clistyle.RoleText, nil)
	endY := min(satAddU16(area.Y, area.Height), g.size.Height)
	endX := min(satAddU16(area.X, area.Width), g.size.Width)
	for y := area.Y; y < endY; y++ {
		for x := area.X; x < endX; x++ {
			idx := int(y)*int(g.size.Width) + int(x)
			s := surface
			g.cells[idx].ChipSurface = &s
		}
	}
}

// Clear resets every cell in area to a space with RoleText foreground.
func (g *CellGrid) Clear(area Rect) {
	endY := min(satAddU16(area.Y, area.Height), g.size.Height)
	endX := min(satAddU16(area.X, area.Width), g.size.Width)
	for y := area.Y; y < endY; y++ {
		for x := area.X; x < endX; x++ {
			c := DefaultCell()
			c.Fg = rolePtr(clistyle.RoleText)
			g.Set(x, y, c)
		}
	}
}

// HitId is an opaque caller-supplied ID, never an application action.
type HitId = uint64

// Hit pairs a cell rectangle with its opaque HitId.
type Hit struct {
	Rect Rect
	ID   HitId
}

func copyRolePtr(r *clistyle.Role) *clistyle.Role {
	if r == nil {
		return nil
	}
	v := *r
	return &v
}

func satAddU16(a, b uint16) uint16 {
	sum := uint32(a) + uint32(b)
	if sum > math.MaxUint16 {
		return math.MaxUint16
	}
	return uint16(sum)
}

func satSubU16(a, b uint16) uint16 {
	if a <= b {
		return 0
	}
	return a - b
}

func satSubInt(a, b int) int {
	if a <= b {
		return 0
	}
	return a - b
}

func clampU16(v int) uint16 {
	if v <= 0 {
		return 0
	}
	if v > math.MaxUint16 {
		return math.MaxUint16
	}
	return uint16(v)
}

// mulDivCeilU64 returns ceil((a * b) / denom) using exact 128-bit arithmetic.
func mulDivCeilU64(a, b, denom uint64) uint64 {
	if denom == 0 || a == 0 || b == 0 {
		return 0
	}
	hi, lo := bits.Mul64(a, b)
	if hi == 0 {
		q := lo / denom
		if lo%denom != 0 {
			q++
		}
		return q
	}
	if hi < denom {
		q, rem := bits.Div64(hi, lo, denom)
		if rem != 0 {
			q++
		}
		return q
	}
	prod := new(big.Int).Mul(new(big.Int).SetUint64(a), new(big.Int).SetUint64(b))
	d := new(big.Int).SetUint64(denom)
	q, rem := new(big.Int).QuoRem(prod, d, new(big.Int))
	if rem.Sign() != 0 {
		q.Add(q, big.NewInt(1))
	}
	return q.Uint64()
}

// mulDivFloorU64 returns floor((a * b) / denom) using exact 128-bit arithmetic.
func mulDivFloorU64(a, b, denom uint64) uint64 {
	if denom == 0 || a == 0 || b == 0 {
		return 0
	}
	hi, lo := bits.Mul64(a, b)
	if hi == 0 {
		return lo / denom
	}
	if hi < denom {
		q, _ := bits.Div64(hi, lo, denom)
		return q
	}
	prod := new(big.Int).Mul(new(big.Int).SetUint64(a), new(big.Int).SetUint64(b))
	q := new(big.Int).Quo(prod, new(big.Int).SetUint64(denom))
	return q.Uint64()
}

// mulDivRoundHalfUpU64 returns floor((a * b + denom/2) / denom) using exact 128-bit arithmetic.
func mulDivRoundHalfUpU64(a, b, denom uint64) uint64 {
	if denom == 0 {
		return 0
	}
	hi, lo := bits.Mul64(a, b)
	lo, carry := bits.Add64(lo, denom/2, 0)
	hi += carry
	if hi == 0 {
		return lo / denom
	}
	if hi < denom {
		q, _ := bits.Div64(hi, lo, denom)
		return q
	}
	prod := new(big.Int).Mul(new(big.Int).SetUint64(a), new(big.Int).SetUint64(b))
	prod.Add(prod, new(big.Int).SetUint64(denom/2))
	q := new(big.Int).Quo(prod, new(big.Int).SetUint64(denom))
	return q.Uint64()
}
