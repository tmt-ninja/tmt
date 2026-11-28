package tui

import (
	"math"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// DialogKind classifies the overlay dialog interaction model.
type DialogKind uint8

const (
	DialogConfirm DialogKind = iota
	DialogForm
	DialogList
	DialogReadOnly
)

// FieldKind distinguishes text fields from choice fields.
type FieldKind uint8

const (
	FieldText FieldKind = iota
	FieldChoice
)

// FocusKind distinguishes field focus from button-row focus.
type FocusKind uint8

const (
	FocusField FocusKind = iota
	FocusButtons
)

// Focus identifies the focused field or button index inside a DialogState.
type Focus struct {
	Kind  FocusKind
	Index int
}

// DialogInputKind classifies the result of DialogState.Key or Mouse.
type DialogInputKind uint8

const (
	DialogInputField DialogInputKind = iota
	DialogInputContent
	DialogInputChoose
	DialogInputCancel
	DialogInputMoved
	DialogInputIgnored
)

// DialogInput is returned by DialogState.Key and DialogState.Mouse.
type DialogInput struct {
	Kind  DialogInputKind
	Index int
	Key   KeyEvent
}

// DialogHits records painted dialog geometry for hit-testing.
type DialogHits struct {
	Outer   Rect
	Content Rect
	Buttons []*Rect
	Fields  []Rect
}

// DialogLook carries presentation parameters for Dialog.Paint.
type DialogLook struct {
	Theme   clistyle.Theme
	Depth   clistyle.Depth
	Active  bool
	Hovered *Rect
}

// Dialog describes one modal overlay dialog with optional buttons and hints.
type Dialog struct {
	Title     string
	Kind      DialogKind
	Placement Placement
	Buttons   []Button
	Hints     string
}

func (d Dialog) modal() Modal {
	return Modal{Title: d.Title, Placement: d.Placement}
}

func (d Dialog) FooterWidth() uint16 {
	buttons := 0
	for _, b := range d.Buttons {
		buttons += int(MeasureText(b.Label, ClipFlow(), MaxContentSpace())[0]) + 2
	}
	if len(d.Buttons) > 1 {
		buttons += len(d.Buttons) - 1
	}
	hints := len([]rune(d.Hints))
	total := buttons
	if hints > 0 {
		total += 2 + hints
	}
	if total > math.MaxUint16 {
		return math.MaxUint16
	}
	return uint16(total)
}

func (d Dialog) Areas(body Rect, demand [2]uint16, status bool) ModalAreas {
	return d.modal().Areas(body, demand, len(d.Buttons) > 0, status)
}

func (d Dialog) Paint(areas ModalAreas, state *DialogState, buffer *Buffer, look DialogLook) DialogHits {
	d.modal().Paint(areas, buffer, look.Theme, look.Depth)
	cursor, hasCursor := state.Button(d.Buttons)
	btns := make([]Button, len(d.Buttons))
	for i, b := range d.Buttons {
		btns[i] = b.WithFocused(hasCursor && i == cursor)
	}
	row := ButtonRow{
		Theme:   look.Theme,
		Depth:   look.Depth,
		Align:   clistyle.AlignLeft,
		Active:  look.Active,
		Hovered: look.Hovered,
	}
	painted := row.Paint(buffer, areas.Footer, btns)
	var maxRight uint16
	for _, r := range painted {
		if r != nil && r.Right() > maxRight {
			maxRight = r.Right()
		}
	}
	used := uint16(0)
	if maxRight > areas.Footer.X {
		used = maxRight - areas.Footer.X
	}
	hints := uint16(len([]rune(d.Hints)))
	if hints > 0 && uint32(used)+2+uint32(hints) <= uint32(areas.Footer.Width) {
		PaintRight(buffer, areas.Footer, StyledLine(d.Hints, ScreenStyle(look.Theme, clistyle.RoleDim, look.Depth)))
	}
	return DialogHits{
		Outer:   areas.Outer,
		Content: areas.Content,
		Buttons: painted,
	}
}

// DialogState holds focus and button cursor for an open dialog.
type DialogState struct {
	Focus Focus
}

func NewDialogState(fields []FieldKind, buttons []Button) DialogState {
	if len(fields) == 0 {
		idx, _ := primaryButton(buttons)
		return DialogState{Focus: Focus{Kind: FocusButtons, Index: idx}}
	}
	return DialogState{Focus: Focus{Kind: FocusField, Index: 0}}
}

func (s *DialogState) Button(buttons []Button) (int, bool) {
	if s.Focus.Kind == FocusButtons {
		if s.Focus.Index >= 0 && s.Focus.Index < len(buttons) {
			return s.Focus.Index, true
		}
		return 0, false
	}
	return primaryButton(buttons)
}

func (s *DialogState) Key(kind DialogKind, key KeyEvent, fields []FieldKind, buttons []Button) DialogInput {
	if key.Kind == KeyRelease || key.Modifiers.Intersects(KeyModControl|KeyModAlt) {
		return DialogInput{Kind: DialogInputIgnored}
	}
	isText := s.Focus.Kind == FocusField && s.Focus.Index >= 0 && s.Focus.Index < len(fields) && fields[s.Focus.Index] == FieldText
	switch {
	case key.Code.Kind == KeyTab || key.Code.Kind == KeyBackTab:
		return DialogInput{Kind: DialogInputIgnored}
	case key.Code.Kind == KeyEsc:
		return DialogInput{Kind: DialogInputCancel}
	case key.Code == CharKey('q') && !isText:
		return DialogInput{Kind: DialogInputCancel}
	case kind == DialogList || kind == DialogReadOnly:
		return s.contentKey(kind, key)
	case key.Code.Kind == KeyUp || key.Code.Kind == KeyDown:
		return s.step(key.Code.Kind == KeyUp, fields, buttons)
	case key.Code.Kind == KeyEnter:
		if idx, ok := s.Button(buttons); ok && buttons[idx].IsEnabled() {
			return DialogInput{Kind: DialogInputChoose, Index: idx}
		}
		return DialogInput{Kind: DialogInputIgnored}
	case key.Code.Kind == KeyLeft || key.Code.Kind == KeyRight:
		if s.Focus.Kind == FocusField {
			return DialogInput{Kind: DialogInputField, Index: s.Focus.Index, Key: key}
		}
		next := enabledButtonStep(buttons, s.Focus.Index, key.Code.Kind == KeyLeft)
		return s.moved(Focus{Kind: FocusButtons, Index: next})
	case isText:
		if s.Focus.Kind == FocusField {
			return DialogInput{Kind: DialogInputField, Index: s.Focus.Index, Key: key}
		}
		return DialogInput{Kind: DialogInputIgnored}
	default:
		return DialogInput{Kind: DialogInputIgnored}
	}
}

func (s *DialogState) contentKey(kind DialogKind, key KeyEvent) DialogInput {
	if key.Code.Kind == KeyEnter && kind == DialogReadOnly {
		return DialogInput{Kind: DialogInputIgnored}
	}
	switch key.Code.Kind {
	case KeyChar, KeyEnter, KeyUp, KeyDown, KeyLeft, KeyRight, KeyPageUp, KeyPageDown, KeyHome, KeyEnd:
		return DialogInput{Kind: DialogInputContent, Key: key}
	default:
		return DialogInput{Kind: DialogInputIgnored}
	}
}

func (s *DialogState) step(up bool, fields []FieldKind, buttons []Button) DialogInput {
	stops := len(fields)
	if len(buttons) > 0 {
		stops++
	}
	at := len(fields)
	if s.Focus.Kind == FocusField {
		at = s.Focus.Index
	}
	var next int
	if up {
		if at == 0 {
			return DialogInput{Kind: DialogInputIgnored}
		}
		next = at - 1
	} else {
		if at+1 >= stops {
			return DialogInput{Kind: DialogInputIgnored}
		}
		next = at + 1
	}
	if next < len(fields) {
		return s.moved(Focus{Kind: FocusField, Index: next})
	}
	idx, _ := primaryButton(buttons)
	return s.moved(Focus{Kind: FocusButtons, Index: idx})
}

func (s *DialogState) moved(focus Focus) DialogInput {
	if focus == s.Focus {
		return DialogInput{Kind: DialogInputIgnored}
	}
	s.Focus = focus
	return DialogInput{Kind: DialogInputMoved}
}

func (s *DialogState) Mouse(event MouseEvent, hits DialogHits, buttons []Button) DialogInput {
	if event.Kind != MouseDown || event.Button != MouseLeft {
		return DialogInput{Kind: DialogInputIgnored}
	}
	pt := Position{X: event.Column, Y: event.Row}
	if !hits.Outer.Contains(pt) {
		return DialogInput{Kind: DialogInputCancel}
	}
	for i, r := range hits.Buttons {
		if r != nil && r.Contains(pt) {
			if i < len(buttons) && buttons[i].IsEnabled() {
				s.Focus = Focus{Kind: FocusButtons, Index: i}
				return DialogInput{Kind: DialogInputChoose, Index: i}
			}
			return DialogInput{Kind: DialogInputIgnored}
		}
	}
	for i, r := range hits.Fields {
		if r.Contains(pt) {
			return s.moved(Focus{Kind: FocusField, Index: i})
		}
	}
	return DialogInput{Kind: DialogInputIgnored}
}

func primaryButton(buttons []Button) (int, bool) {
	for i, b := range buttons {
		if b.IsFocused() && b.IsEnabled() {
			return i, true
		}
	}
	return 0, false
}

func enabledButtonStep(buttons []Button, from int, left bool) int {
	if left {
		for i := from - 1; i >= 0; i-- {
			if buttons[i].IsEnabled() {
				return i
			}
		}
		return from
	}
	for i := from + 1; i < len(buttons); i++ {
		if buttons[i].IsEnabled() {
			return i
		}
	}
	return from
}
