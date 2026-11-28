package tuicomponents

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// MoreDirection indicates whether additional content can be reached by scrolling or is truncated.
type MoreDirection string

const (
	MoreDirectionDown      MoreDirection = "down"
	MoreDirectionUp        MoreDirection = "up"
	MoreDirectionRight     MoreDirection = "right"
	MoreDirectionTruncated MoreDirection = "truncated"
)

func (d *MoreDirection) UnmarshalJSON(data []byte) error {
	var raw string
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	switch MoreDirection(raw) {
	case MoreDirectionDown, MoreDirectionUp, MoreDirectionRight, MoreDirectionTruncated:
		*d = MoreDirection(raw)
		return nil
	default:
		return errors.New("unknown more direction")
	}
}

// MoreHintProps configures MoreHint.
type MoreHintProps struct {
	Count     uint64        `json:"count"`
	Direction MoreDirection `json:"direction"`
	ASCII     bool          `json:"ascii"`
}

func (p *MoreHintProps) UnmarshalJSON(data []byte) error {
	type alias MoreHintProps
	aux := alias{Direction: MoreDirectionDown}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	*p = MoreHintProps(aux)
	return nil
}

// MoreHint renders additional content hints: `2 more ↓`, `2 more ↑`, `2 more →`, or `+2 more`.
type MoreHint struct{}

// Label formats the semantic hint label for use inside existing styled lines.
func (MoreHint) Label(count uint64, direction MoreDirection, ascii bool) string {
	n := strconv.FormatUint(count, 10)
	if direction == "" {
		direction = MoreDirectionDown
	}
	switch direction {
	case MoreDirectionTruncated:
		return "+" + n + " more"
	case MoreDirectionDown:
		if ascii {
			return n + " more v"
		}
		return n + " more ↓"
	case MoreDirectionUp:
		if ascii {
			return n + " more ^"
		}
		return n + " more ↑"
	case MoreDirectionRight:
		if ascii {
			return n + " more >"
		}
		return n + " more →"
	default:
		return n + " more ↓"
	}
}

func (h MoreHint) Measure(props MoreHintProps, constraints Constraints) Size {
	text := h.Label(props.Count, props.Direction, props.ASCII)
	return constraints.Clamp(Size{
		Width:  clampU16(uniseg.StringWidth(text)),
		Height: 1,
	})
}

func (h MoreHint) Render(props MoreHintProps, area Rect, grid *CellGrid) []Hit {
	if area.Height == 0 {
		return nil
	}
	label := h.Label(props.Count, props.Direction, props.ASCII)
	text := fit(label, int(area.Width))
	padding := satSubInt(int(area.Width), uniseg.StringWidth(text))
	grid.Text(area, text+strings.Repeat(" ", padding), clistyle.RoleDim, nil)
	return nil
}
