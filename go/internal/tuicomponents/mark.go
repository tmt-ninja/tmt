package tuicomponents

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// MarkState represents the board's observable member states.
type MarkState string

const (
	MarkStateWorking MarkState = "working"
	MarkStateWaiting MarkState = "waiting"
	MarkStateBlocked MarkState = "blocked"
	MarkStateReview  MarkState = "review"
	MarkStateIdle    MarkState = "idle"
	MarkStateOffline MarkState = "offline"
	MarkStateEnded   MarkState = "ended"
	MarkStateShell   MarkState = "shell"
)

func (s *MarkState) UnmarshalJSON(data []byte) error {
	var raw string
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	switch MarkState(raw) {
	case MarkStateWorking, MarkStateWaiting, MarkStateBlocked, MarkStateReview,
		MarkStateIdle, MarkStateOffline, MarkStateEnded, MarkStateShell:
		*s = MarkState(raw)
		return nil
	default:
		return errors.New("unknown mark state")
	}
}

func (s MarkState) glyph() string {
	switch s {
	case MarkStateWorking:
		return clistyle.MarkRunning.Symbol()
	case MarkStateWaiting:
		return clistyle.MarkDecision.Symbol()
	case MarkStateBlocked:
		return clistyle.MarkFailed.Symbol()
	case MarkStateReview:
		return "◐"
	case MarkStateIdle:
		return clistyle.MarkIdle.Symbol()
	case MarkStateOffline, MarkStateEnded:
		return clistyle.MarkOffline.Symbol()
	case MarkStateShell:
		return "▪"
	default:
		return clistyle.MarkOffline.Symbol()
	}
}

func (s MarkState) role() clistyle.Role {
	switch s {
	case MarkStateWaiting:
		return clistyle.RoleWaiting
	case MarkStateBlocked:
		return clistyle.RoleBlocked
	default:
		return clistyle.RoleMuted
	}
}

// MarkProps configures Mark.
type MarkProps struct {
	State    MarkState `json:"state"`
	Label    string    `json:"label"`
	Emphasis bool      `json:"emphasis"`
}

// Mark renders a board state glyph and its neutral word:
//
//	● working
//
// Only waiting and blocked glyphs accept emphasis. Text is ellipsized at the available width.
type Mark struct{}

func (Mark) Measure(props MarkProps, constraints Constraints) Size {
	text := props.State.glyph() + " " + props.Label
	return constraints.Clamp(Size{
		Width:  clampU16(uniseg.StringWidth(text)),
		Height: 1,
	})
}

func (Mark) Render(props MarkProps, area Rect, grid *CellGrid) []Hit {
	grid.Clear(area)
	glyph := props.State.glyph()
	text := fit(glyph+" "+props.Label, int(area.Width))
	if rest, ok := strings.CutPrefix(text, glyph); ok {
		glyphArea := area
		glyphArea.Width = 1
		bold := props.Emphasis && (props.State == MarkStateWaiting || props.State == MarkStateBlocked)
		grid.TextBold(glyphArea, glyph, props.State.role(), nil, bold)

		restArea := area
		restArea.X = satAddU16(area.X, 1)
		restArea.Width = satSubU16(area.Width, 1)
		grid.Text(restArea, rest, clistyle.RoleMuted, nil)
	} else {
		grid.Text(area, text, clistyle.RoleMuted, nil)
	}
	return nil
}
