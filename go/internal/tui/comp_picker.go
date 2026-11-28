package tui

import (
	"errors"
	"math"

	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

const MaxQueryBytes = 4096

// PickerEventKind classifies neutral picker outcomes.
type PickerEventKind uint8

const (
	PickerQueryChanged PickerEventKind = iota
	PickerChanged
	PickerConfirm
	PickerCancel
)

// PickerEvent is an application-visible outcome from Picker.
type PickerEvent struct {
	Kind  PickerEventKind
	Value string
}

// PickerInputKind distinguishes an emitted PickerEvent vs a captured no-op key.
type PickerInputKind uint8

const (
	PickerInputEvent PickerInputKind = iota
	PickerInputCaptured
)

// PickerInput is the result of routing an Event to a Picker.
type PickerInput struct {
	Kind  PickerInputKind
	Event PickerEvent
}

// PickerField selects whether the query input or list currently has focus.
type PickerField uint8

const (
	PickerFieldQuery PickerField = iota
	PickerFieldList
)

// Picker combines an optional editable query Editor with a ListState.
type Picker struct {
	List  ListState
	query *Editor
}

// NewPicker creates a Picker; nil query creates a selection-only picker.
func NewPicker(query *string) (*Picker, error) {
	if query != nil && len(*query) > MaxQueryBytes {
		return nil, errors.New("picker query exceeds 4096 bytes")
	}
	var ed *Editor
	if query != nil {
		e := NewEditor(*query)
		ed = &e
	}
	return &Picker{query: ed}, nil
}

// Reconcile updates list rows and reports PickerChanged if selection changed.
func (p *Picker) Reconcile(rows []ListRow) (*PickerEvent, error) {
	prev, hadPrev := p.List.Selected()
	if err := p.List.Reconcile(rows); err != nil {
		return nil, err
	}
	cur, hasCur := p.List.Selected()
	if hasCur && (!hadPrev || cur != prev) {
		return &PickerEvent{Kind: PickerChanged, Value: cur}, nil
	}
	return nil, nil
}

func (p *Picker) Query() (string, bool) {
	if p.query == nil {
		return "", false
	}
	return p.query.String(), true
}

func (p *Picker) QueryDisplay() (string, bool) {
	if p.query == nil {
		return "", false
	}
	s := p.query.String()
	c := p.query.Cursor()
	return s[:c] + "▏" + s[c:], true
}

// QueryVisible returns a horizontal window keeping the cursor visible within width cells.
func (p *Picker) QueryVisible(width uint16) (string, bool) {
	if p.query == nil {
		return "", false
	}
	if width == 0 {
		return "", true
	}
	s := p.query.String()
	c := p.query.Cursor()
	budget := int(width) - 1

	// Collect graphemes before cursor in reverse.
	type gspan struct {
		idx  int
		part string
	}
	var before []gspan
	for rest, state := s[:c], -1; rest != ""; {
		idx := c - len(rest)
		var part string
		part, rest, _, state = uniseg.FirstGraphemeClusterInString(rest, state)
		before = append(before, gspan{idx: idx, part: part})
	}
	start := c
	for i := len(before) - 1; i >= 0; i-- {
		cells := uniseg.StringWidth(clistyle.Escape(before[i].part))
		if cells > budget {
			break
		}
		start = before[i].idx
		budget -= cells
	}
	end := c
	for rest, state := s[c:], -1; rest != ""; {
		var part string
		part, rest, _, state = uniseg.FirstGraphemeClusterInString(rest, state)
		cells := uniseg.StringWidth(clistyle.Escape(part))
		if cells > budget {
			break
		}
		end += len(part)
		budget -= cells
	}
	return s[start:c] + "▏" + s[c:end], true
}

func (p *Picker) Input(event Event, frame ListFrame) *PickerInput {
	field := PickerFieldList
	if p.query != nil {
		field = PickerFieldQuery
	}
	return p.InputField(event, frame, field)
}

func (p *Picker) InputField(event Event, frame ListFrame, field PickerField) *PickerInput {
	if field == PickerFieldQuery && p.query != nil && event.Kind == EventKey {
		switch event.Key.Code.Kind {
		case KeyEsc, KeyEnter, KeyTab, KeyBackTab, KeyUp, KeyDown, KeyPageUp, KeyPageDown:
		default:
			before := p.query.String()
			if p.query.Key(event.Key, math.MaxUint16, MaxQueryBytes) {
				if p.query.String() == before {
					return &PickerInput{Kind: PickerInputCaptured}
				}
				return &PickerInput{
					Kind:  PickerInputEvent,
					Event: PickerEvent{Kind: PickerQueryChanged, Value: p.query.String()},
				}
			}
			return nil
		}
	}

	nonShiftMods := KeyModControl | KeyModAlt | KeyModSuper | KeyModHyper | KeyModMeta
	accepted := false
	switch event.Kind {
	case EventKey:
		if event.Key.Kind != KeyRelease && !event.Key.Modifiers.Intersects(nonShiftMods) {
			switch event.Key.Code.Kind {
			case KeyEsc, KeyEnter, KeyUp, KeyDown, KeyPageUp, KeyPageDown, KeyHome, KeyEnd:
				accepted = true
			default:
				if p.query != nil && field == PickerFieldQuery {
					switch event.Key.Code.Kind {
					case KeyChar, KeyBackspace, KeyDelete, KeyLeft, KeyRight:
						accepted = true
					}
				} else if event.Key.Code.Kind == KeyChar {
					switch event.Key.Code.Char {
					case 'q', 'j', 'k', 'g', 'G':
						accepted = true
					}
				}
			}
		}
	case EventPaste:
		accepted = p.query != nil && field == PickerFieldQuery
	case EventMouse:
		if frame.Viewport.Contains(Position{X: event.Mouse.Column, Y: event.Mouse.Row}) {
			switch event.Mouse.Kind {
			case MouseDown:
				accepted = event.Mouse.Button == MouseLeft
			case MouseScrollUp, MouseScrollDown:
				accepted = true
			}
		}
	}
	if !accepted {
		return nil
	}
	if ev := p.eventField(event, frame, field); ev != nil {
		return &PickerInput{Kind: PickerInputEvent, Event: *ev}
	}
	return &PickerInput{Kind: PickerInputCaptured}
}

func (p *Picker) eventField(event Event, frame ListFrame, field PickerField) *PickerEvent {
	nonShiftMods := KeyModControl | KeyModAlt | KeyModSuper | KeyModHyper | KeyModMeta
	if event.Kind == EventKey {
		if event.Key.Kind == KeyRelease || event.Key.Modifiers.Intersects(nonShiftMods) {
			return nil
		}
		if event.Key.Code.Kind == KeyEsc || ((p.query == nil || field == PickerFieldList) && event.Key.Code == CharKey('q')) {
			return &PickerEvent{Kind: PickerCancel}
		}
	}
	if event.Kind == EventPaste {
		if field == PickerFieldQuery && p.query != nil && event.Paste != "" && p.query.Insert(event.Paste, MaxQueryBytes) {
			return &PickerEvent{Kind: PickerQueryChanged, Value: p.query.String()}
		}
		return nil
	}
	if lev := p.List.Input(event, frame); lev != nil {
		if lev.Kind == ListConfirm {
			return &PickerEvent{Kind: PickerConfirm, Value: lev.ID}
		}
		return &PickerEvent{Kind: PickerChanged, Value: lev.ID}
	}
	return nil
}
