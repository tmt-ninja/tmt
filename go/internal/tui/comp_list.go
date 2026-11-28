package tui

import (
	"errors"
	"slices"
)

// ListRow identifies one row in a ListState.
type ListRow struct {
	ID       string
	Disabled bool
}

// ListEventKind distinguishes selection change vs activation confirmation.
type ListEventKind uint8

const (
	ListChanged ListEventKind = iota
	ListConfirm
)

// ListEvent is emitted by ListState on selection change or Enter confirmation.
type ListEvent struct {
	Kind ListEventKind
	ID   string
}

// RowGeometry records a painted row's visual line range and visible hit rectangle.
type RowGeometry struct {
	ID      string
	Lines   LineRange
	Visible Rect
}

// ListFrame snapshots the rows and viewport used for painting.
type ListFrame struct {
	Rows     []ListRow
	Geometry []RowGeometry
	Viewport Rect
	Offset   int
}

// ListState manages stable row selection and scrolling.
type ListState struct {
	rows     []ListRow
	selected *string
	Scroll   ScrollState
}

func (l *ListState) Rows() []ListRow { return l.rows }
func (l *ListState) Selected() (string, bool) {
	if l.selected == nil {
		return "", false
	}
	return *l.selected, true
}

func absDiff(a, b int) int {
	if a >= b {
		return a - b
	}
	return b - a
}

// Reconcile validates unique stable IDs and updates rows while preserving selection identity
// or falling back to the nearest enabled survivor.
func (l *ListState) Reconcile(rows []ListRow) error {
	seen := make(map[string]struct{}, len(rows))
	for _, r := range rows {
		if !isStableID(r.ID) {
			return errors.New("list rows require unique stable IDs")
		}
		if _, dup := seen[r.ID]; dup {
			return errors.New("list rows require unique stable IDs")
		}
		seen[r.ID] = struct{}{}
	}
	enabled := make(map[string]struct{}, len(rows))
	for _, r := range rows {
		if !r.Disabled {
			enabled[r.ID] = struct{}{}
		}
	}
	oldPos := -1
	if l.selected != nil {
		for i, r := range l.rows {
			if r.ID == *l.selected {
				oldPos = i
				break
			}
		}
	}
	survives := false
	if l.selected != nil {
		_, survives = enabled[*l.selected]
	}
	if !survives {
		var next *string
		if oldPos >= 0 {
			bestDist := int(^uint(0) >> 1)
			bestIdx := -1
			for i, old := range l.rows {
				if _, ok := enabled[old.ID]; !ok {
					continue
				}
				d := absDiff(i, oldPos)
				if d < bestDist || (d == bestDist && i < bestIdx) {
					bestDist = d
					bestIdx = i
				}
			}
			if bestIdx >= 0 {
				id := l.rows[bestIdx].ID
				next = &id
			}
		}
		if next == nil {
			target := max(oldPos, 0)
			bestDist := int(^uint(0) >> 1)
			bestIdx := -1
			for i, r := range rows {
				if r.Disabled {
					continue
				}
				d := absDiff(i, target)
				if d < bestDist {
					bestDist = d
					bestIdx = i
				}
			}
			if bestIdx >= 0 {
				id := rows[bestIdx].ID
				next = &id
			}
		}
		l.selected = next
	}
	l.rows = rows
	return nil
}

// Select selects id if it is enabled and not already selected.
func (l *ListState) Select(id string) *ListEvent {
	if l.selected != nil && *l.selected == id {
		return nil
	}
	found := false
	for _, r := range l.rows {
		if r.ID == id && !r.Disabled {
			found = true
			break
		}
	}
	if !found {
		return nil
	}
	s := id
	l.selected = &s
	return &ListEvent{Kind: ListChanged, ID: id}
}

// Confirm returns a ListConfirm event for the currently selected enabled row.
func (l *ListState) Confirm() *ListEvent {
	if l.selected == nil {
		return nil
	}
	for _, r := range l.rows {
		if r.ID == *l.selected && !r.Disabled {
			return &ListEvent{Kind: ListConfirm, ID: *l.selected}
		}
	}
	return nil
}

// Input handles keyboard and mouse navigation against a matching ListFrame.
func (l *ListState) Input(event Event, frame ListFrame) *ListEvent {
	if !slices.Equal(frame.Rows, l.rows) || frame.Viewport != l.Scroll.Viewport() {
		return nil
	}
	var step Step
	switch event.Kind {
	case EventKey:
		if event.Key.Kind == KeyRelease || event.Key.Modifiers.Intersects(KeyModControl|KeyModAlt) {
			return nil
		}
		switch event.Key.Code {
		case KeyCode{Kind: KeyEnter}:
			return l.Confirm()
		case KeyCode{Kind: KeyUp}, CharKey('k'):
			step = LinesStep(-1)
		case KeyCode{Kind: KeyDown}, CharKey('j'):
			step = LinesStep(1)
		case KeyCode{Kind: KeyPageUp}:
			step = PagesStep(-1)
		case KeyCode{Kind: KeyPageDown}:
			step = PagesStep(1)
		case KeyCode{Kind: KeyHome}, CharKey('g'):
			step = TopStep()
		case KeyCode{Kind: KeyEnd}, CharKey('G'):
			step = BottomStep()
		default:
			return nil
		}
	case EventMouse:
		if frame.Offset != l.Scroll.Offset() || !frame.Viewport.Contains(Position{X: event.Mouse.Column, Y: event.Mouse.Row}) {
			return nil
		}
		if event.Mouse.Kind == MouseScrollUp || event.Mouse.Kind == MouseScrollDown {
			if sel, ok := l.Selected(); ok {
				for _, g := range frame.Geometry {
					if g.ID == sel && g.Lines.Len() > int(frame.Viewport.Height) {
						l.Scroll.Input(event)
						return nil
					}
				}
			}
		}
		switch event.Mouse.Kind {
		case MouseDown:
			if event.Mouse.Button != MouseLeft {
				return nil
			}
			for i := len(frame.Geometry) - 1; i >= 0; i-- {
				if frame.Geometry[i].Visible.Contains(Position{X: event.Mouse.Column, Y: event.Mouse.Row}) {
					return l.Select(frame.Geometry[i].ID)
				}
			}
			return nil
		case MouseScrollUp:
			step = LinesStep(-WheelLines)
		case MouseScrollDown:
			step = LinesStep(WheelLines)
		default:
			return nil
		}
	default:
		return nil
	}

	var enabled []ListRow
	for _, r := range l.rows {
		if !r.Disabled {
			enabled = append(enabled, r)
		}
	}
	if len(enabled) == 0 {
		return nil
	}
	current := 0
	if l.selected != nil {
		for i, r := range enabled {
			if r.ID == *l.selected {
				current = i
				break
			}
		}
	}

	var index int
	switch step.Kind {
	case StepLines:
		index = min(max(current+step.Delta, 0), len(enabled)-1)
	case StepTop:
		index = 0
	case StepBottom:
		index = len(enabled) - 1
	case StepPages:
		start := 0
		if l.selected != nil {
			for _, g := range frame.Geometry {
				if g.ID == *l.selected {
					start = g.Lines.Start
					break
				}
			}
		}
		page := max(int(frame.Viewport.Height)-1, 1)
		target := max(start+step.Delta*page, 0)
		ranges := make(map[string]int, len(frame.Geometry))
		for _, g := range frame.Geometry {
			ranges[g.ID] = g.Lines.Start
		}
		nearest := current
		bestDist := int(^uint(0) >> 1)
		for i, r := range enabled {
			if lineStart, ok := ranges[r.ID]; ok {
				d := absDiff(lineStart, target)
				if d < bestDist {
					bestDist = d
					nearest = i
				}
			}
		}
		if nearest == current {
			sign := 0
			if step.Delta > 0 {
				sign = 1
			} else if step.Delta < 0 {
				sign = -1
			}
			index = min(max(current+sign, 0), len(enabled)-1)
		} else {
			index = nearest
		}
	}

	id := enabled[index].ID
	effect := l.Select(id)
	for _, g := range frame.Geometry {
		if g.ID == id {
			l.Scroll.Reveal(g.Lines)
			break
		}
	}
	return effect
}
