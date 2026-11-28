package tui

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

const MaxCells uint16 = 4096

// Direction is the flex main axis.
type Direction uint8

const (
	DirectionRow Direction = iota
	DirectionColumn
)

// ExtentKind distinguishes Auto, Cells, Full, and Percent extents.
type ExtentKind uint8

const (
	ExtentAuto ExtentKind = iota
	ExtentCells
	ExtentFull
	ExtentPercent
)

// Extent represents a static cell or percentage length.
type Extent struct {
	Kind    ExtentKind
	Cells   uint16
	Percent uint8
}

func AutoExtent() Extent           { return Extent{Kind: ExtentAuto} }
func CellsExtent(n uint16) Extent  { return Extent{Kind: ExtentCells, Cells: n} }
func FullExtent() Extent           { return Extent{Kind: ExtentFull} }
func PercentExtent(p uint8) Extent { return Extent{Kind: ExtentPercent, Percent: p} }

// TextFlowKind distinguishes Clip, Wrap, Truncate, Middle, and Clamp text flows.
type TextFlowKind uint8

const (
	TextFlowClip TextFlowKind = iota
	TextFlowWrap
	TextFlowTruncate
	TextFlowMiddle
	TextFlowClamp
)

// TextFlow controls line wrapping and truncation.
type TextFlow struct {
	Kind  TextFlowKind
	Lines uint16
}

func ClipFlow() TextFlow          { return TextFlow{Kind: TextFlowClip} }
func WrapFlow() TextFlow          { return TextFlow{Kind: TextFlowWrap} }
func TruncateFlow() TextFlow      { return TextFlow{Kind: TextFlowTruncate} }
func MiddleFlow() TextFlow        { return TextFlow{Kind: TextFlowMiddle} }
func ClampFlow(n uint16) TextFlow { return TextFlow{Kind: TextFlowClamp, Lines: n} }

// Display distinguishes Flex and Grid containers.
type Display uint8

const (
	DisplayFlex Display = iota
	DisplayGrid
)

// BreadthKind distinguishes Auto, Cells, Percent, and Fraction grid track breadths.
type BreadthKind uint8

const (
	BreadthAuto BreadthKind = iota
	BreadthCells
	BreadthPercent
	BreadthFraction
)

// Breadth is one endpoint of a GridTrack.
type Breadth struct {
	Kind     BreadthKind
	Cells    uint16
	Percent  uint8
	Fraction uint16
}

func AutoBreadth() Breadth             { return Breadth{Kind: BreadthAuto} }
func CellsBreadth(n uint16) Breadth    { return Breadth{Kind: BreadthCells, Cells: n} }
func PercentBreadth(p uint8) Breadth   { return Breadth{Kind: BreadthPercent, Percent: p} }
func FractionBreadth(n uint16) Breadth { return Breadth{Kind: BreadthFraction, Fraction: n} }

// GridTrack is a single column track with min and max breadths.
type GridTrack struct {
	Min Breadth
	Max Breadth
}

// CellStyle holds static layout and text styling compiled from markup attributes.
type CellStyle struct {
	Display   Display
	Direction Direction
	Basis     Extent
	MinWidth  *uint16
	MaxWidth  *uint16
	Columns   []GridTrack
	ColSpan   uint16
	Width     Extent
	Height    Extent
	Gap       [2]uint16
	Padding   [2]uint16
	Grow      uint16
	Shrink    uint16
	TextFlow  TextFlow
	Token     *clistyle.Role
	Bold      bool
}

var allRoles = []clistyle.Role{
	clistyle.RoleText,
	clistyle.RoleMuted,
	clistyle.RoleDim,
	clistyle.RoleAccent,
	clistyle.RoleMatrixBatch,
	clistyle.RoleMatrixUrgent,
	clistyle.RoleWaiting,
	clistyle.RoleWorking,
	clistyle.RoleReview,
	clistyle.RoleBlocked,
	clistyle.RoleLink,
	clistyle.RoleSelection,
	clistyle.RoleTrack,
	clistyle.RoleUnread,
	clistyle.RoleKeycap,
	clistyle.RoleKeycapSelected,
	clistyle.RoleCode,
	clistyle.RoleAttachment,
	clistyle.RoleAttachmentInk,
	clistyle.RoleConversation,
}

func allRoleNames() string {
	names := make([]string, len(allRoles))
	for i, r := range allRoles {
		names[i] = r.String()
	}
	return strings.Join(names, ", ")
}

func parseCells(value string) (uint16, error) {
	if value == "" {
		return 0, fmt.Errorf("requires an integer from 0 to %d", MaxCells)
	}
	for i := 0; i < len(value); i++ {
		if value[i] < '0' || value[i] > '9' {
			return 0, fmt.Errorf("requires an integer from 0 to %d", MaxCells)
		}
	}
	n, err := strconv.ParseUint(value, 10, 16)
	if err != nil || uint16(n) > MaxCells {
		return 0, fmt.Errorf("requires an integer from 0 to %d", MaxCells)
	}
	return uint16(n), nil
}

func parsePercent(raw string) (uint8, error) {
	trimmed := strings.TrimSuffix(raw, "%")
	n, err := parseCells(trimmed)
	if err != nil {
		return 0, err
	}
	if n > 100 {
		return 0, fmt.Errorf("requires an integer percentage from 0 to 100")
	}
	return uint8(n), nil
}

func parseBreadth(raw string) (Breadth, error) {
	if raw == "auto" {
		return AutoBreadth(), nil
	}
	if strings.HasSuffix(raw, "%") {
		p, err := parsePercent(raw)
		if err != nil {
			return Breadth{}, err
		}
		return PercentBreadth(p), nil
	}
	if nStr, ok := strings.CutSuffix(raw, "fr"); ok {
		n, err := parseCells(nStr)
		if err != nil {
			return Breadth{}, err
		}
		return FractionBreadth(n), nil
	}
	n, err := parseCells(raw)
	if err != nil {
		return Breadth{}, err
	}
	return CellsBreadth(n), nil
}

func parseTracks(raw string) ([]GridTrack, error) {
	parts := strings.Split(raw, "_")
	out := make([]GridTrack, 0, len(parts))
	for _, part := range parts {
		if inner, ok := strings.CutPrefix(part, "minmax("); ok {
			inner, ok = strings.CutSuffix(inner, ")")
			if !ok {
				return nil, fmt.Errorf("minmax requires two endpoints")
			}
			a, b, ok := strings.Cut(inner, ",")
			if !ok {
				return nil, fmt.Errorf("minmax requires two endpoints")
			}
			mn, err := parseBreadth(a)
			if err != nil {
				return nil, err
			}
			mx, err := parseBreadth(b)
			if err != nil {
				return nil, err
			}
			if mx.Kind == BreadthAuto {
				return nil, fmt.Errorf("auto is a bare track or a minmax minimum; use auto or minmax(auto,N)")
			}
			if mn.Kind == BreadthFraction {
				return nil, fmt.Errorf("minmax minimum cannot be fr")
			}
			out = append(out, GridTrack{Min: mn, Max: mx})
		} else {
			mx, err := parseBreadth(part)
			if err != nil {
				return nil, err
			}
			mn := mx
			if mx.Kind == BreadthFraction {
				mn = AutoBreadth()
			}
			out = append(out, GridTrack{Min: mn, Max: mx})
		}
	}
	return out, nil
}

var utilityKeys = []string{
	"min-w",
	"max-w",
	"col-span",
	"line-clamp",
	"gap-x",
	"gap-y",
	"basis",
	"grow",
	"shrink",
	"gap",
	"px",
	"py",
	"p",
	"w",
	"h",
}

func admitStyle(kind Kind, attrs map[string]string) (CellStyle, error) {
	dir := DirectionRow
	switch kind {
	case KindView, KindCol, KindModal, KindScroll, KindKeyHelp, KindList, KindTable, KindPicker:
		dir = DirectionColumn
	}
	style := CellStyle{
		Display:   DisplayFlex,
		Direction: dir,
		Basis:     AutoExtent(),
		ColSpan:   1,
		Width:     AutoExtent(),
		Height:    AutoExtent(),
		Shrink:    1,
		TextFlow:  ClipFlow(),
	}

	seen := make(map[string]string)
	claim := func(properties []string, value string) error {
		for _, prop := range properties {
			if prev, exists := seen[prop]; exists {
				return fmt.Errorf("%s conflicts with %s for %s", value, prev, prop)
			}
			seen[prop] = value
		}
		return nil
	}

	for _, class := range strings.Fields(attrs["class"]) {
		label := fmt.Sprintf("class=%q", class)
		var key string
		var value *uint16
		var percentage *uint8

		switch {
		case class == "flex" || class == "grid":
			key = "display"
		case class == "flex-row" || class == "flex-col":
			key = "direction"
		case class == "truncate" || class == "truncate-middle":
			key = "text-flow"
		case class == "text-ellipsis-middle":
			return CellStyle{}, fmt.Errorf("unsupported %s; hint: use truncate-middle", label)
		case strings.HasPrefix(class, "grid-cols-["):
			key = "columns"
		case class == "w-full":
			key = "w"
		case class == "h-full":
			key = "h"
		case class == "grow":
			key = "grow"
			v := uint16(1)
			value = &v
		case class == "shrink":
			key = "shrink"
			v := uint16(1)
			value = &v
		default:
			var raw string
			found := false
			for _, candidate := range utilityKeys {
				if rest, ok := strings.CutPrefix(class, candidate+"-"); ok {
					key = candidate
					raw = rest
					found = true
					break
				}
			}
			if !found {
				return CellStyle{}, fmt.Errorf("unsupported %s; hint: use cell utilities or grid-cols-[tracks]", label)
			}
			bracketed := strings.HasPrefix(raw, "[")
			if bracketed {
				inner, ok := strings.CutPrefix(raw, "[")
				if ok {
					inner, ok = strings.CutSuffix(inner, "]")
				}
				if !ok {
					return CellStyle{}, fmt.Errorf("malformed %s", label)
				}
				raw = inner
			}
			isPercent := strings.HasSuffix(raw, "%")
			percentKey := key == "w" || key == "h" || key == "basis"
			if bracketed != isPercent || (isPercent && !percentKey) {
				hint := fmt.Sprintf("%s-N (cells or counts)", key)
				if isPercent && percentKey {
					hint = fmt.Sprintf("%s-[n%%]", key)
				}
				return CellStyle{}, fmt.Errorf("unsupported %s; hint: use %s", label, hint)
			}
			if isPercent {
				n, err := parsePercent(raw)
				if err != nil {
					return CellStyle{}, fmt.Errorf("%s %s", label, err.Error())
				}
				percentage = &n
			} else {
				n, err := parseCells(raw)
				if err != nil {
					return CellStyle{}, fmt.Errorf("%s %s", label, err.Error())
				}
				value = &n
			}
		}

		var props []string
		switch key {
		case "gap":
			props = []string{"gap-x", "gap-y"}
		case "line-clamp":
			props = []string{"text-flow"}
		case "p":
			props = []string{"px", "py"}
		default:
			props = []string{key}
		}
		if err := claim(props, label); err != nil {
			return CellStyle{}, err
		}
		if percentage != nil {
			switch key {
			case "w":
				style.Width = PercentExtent(*percentage)
			case "h":
				style.Height = PercentExtent(*percentage)
			default:
				style.Basis = PercentExtent(*percentage)
			}
			continue
		}

		switch key {
		case "display":
			if class == "grid" {
				style.Display = DisplayGrid
			} else {
				style.Display = DisplayFlex
			}
		case "columns":
			inner, ok := strings.CutPrefix(class, "grid-cols-[")
			if ok {
				inner, ok = strings.CutSuffix(inner, "]")
			}
			if !ok {
				return CellStyle{}, fmt.Errorf("malformed %s", label)
			}
			cols, err := parseTracks(inner)
			if err != nil {
				return CellStyle{}, fmt.Errorf("%s %s", label, err.Error())
			}
			style.Columns = cols
		case "basis":
			style.Basis = CellsExtent(*value)
		case "min-w":
			v := *value
			style.MinWidth = &v
		case "max-w":
			v := *value
			style.MaxWidth = &v
		case "col-span":
			if *value == 0 {
				return CellStyle{}, fmt.Errorf("%s requires a positive integer", label)
			}
			style.ColSpan = *value
		case "line-clamp":
			if *value == 0 {
				return CellStyle{}, fmt.Errorf("%s requires a positive integer", label)
			}
			style.TextFlow = ClampFlow(*value)
		case "direction":
			if class == "flex-row" {
				style.Direction = DirectionRow
			} else {
				style.Direction = DirectionColumn
			}
		case "w":
			if value != nil {
				style.Width = CellsExtent(*value)
			} else {
				style.Width = FullExtent()
			}
		case "h":
			if value != nil {
				style.Height = CellsExtent(*value)
			} else {
				style.Height = FullExtent()
			}
		case "gap":
			style.Gap = [2]uint16{*value, *value}
		case "gap-x":
			style.Gap[0] = *value
		case "gap-y":
			style.Gap[1] = *value
		case "p":
			style.Padding = [2]uint16{*value, *value}
		case "px":
			style.Padding[0] = *value
		case "py":
			style.Padding[1] = *value
		case "grow":
			style.Grow = *value
		case "shrink":
			style.Shrink = *value
		case "text-flow":
			if class == "truncate" {
				style.TextFlow = TruncateFlow()
			} else {
				style.TextFlow = MiddleFlow()
			}
		}
	}

	if value, ok := attrs["wrap"]; ok {
		label := fmt.Sprintf("wrap=%q", value)
		if err := claim([]string{"text-flow"}, label); err != nil {
			return CellStyle{}, err
		}
		switch value {
		case "true":
			style.TextFlow = WrapFlow()
		case "false":
			style.TextFlow = ClipFlow()
		default:
			return CellStyle{}, fmt.Errorf("%s must be true or false", label)
		}
	}

	if value, ok := attrs["token"]; ok {
		role, valid := clistyle.ParseRole(value)
		if !valid {
			return CellStyle{}, fmt.Errorf("unknown token=%q; expected %s", value, allRoleNames())
		}
		style.Token = &role
	}

	if len(style.Columns) > 0 && style.Display != DisplayGrid {
		return CellStyle{}, fmt.Errorf("%s requires grid", seen["columns"])
	}
	if style.Display == DisplayGrid {
		if dirClass, ok := seen["direction"]; ok {
			return CellStyle{}, fmt.Errorf("%s conflicts with grid", dirClass)
		}
	}
	return style, nil
}
