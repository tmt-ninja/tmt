package tui

import "fmt"

const WheelLines = 3

// LineRange is a half-open range [Start, End) of visual line indices.
type LineRange struct {
	Start int
	End   int
}

func (r LineRange) Len() int {
	if r.End <= r.Start {
		return 0
	}
	return r.End - r.Start
}

func (r LineRange) IsEmpty() bool { return r.End <= r.Start }

// StepKind classifies a scroll movement.
type StepKind uint8

const (
	StepLines StepKind = iota
	StepPages
	StepTop
	StepBottom
)

// Step describes a scroll delta.
type Step struct {
	Kind  StepKind
	Delta int
}

func LinesStep(n int) Step { return Step{Kind: StepLines, Delta: n} }
func PagesStep(n int) Step { return Step{Kind: StepPages, Delta: n} }
func TopStep() Step        { return Step{Kind: StepTop} }
func BottomStep() Step     { return Step{Kind: StepBottom} }

// ScrollState manages visual-line scrolling for a viewport.
type ScrollState struct {
	offset  int
	content int
	area    Rect
}

func (s *ScrollState) Offset() int    { return s.offset }
func (s *ScrollState) Content() int   { return s.content }
func (s *ScrollState) Viewport() Rect { return s.area }
func (s *ScrollState) Limit() int {
	h := int(s.area.Height)
	if s.content <= h {
		return 0
	}
	return s.content - h
}

// Update records current geometry and content height, clamping offset and revealing selected.
func (s *ScrollState) Update(area Rect, content int, selected *LineRange) {
	s.area = area
	s.content = content
	if s.offset > s.Limit() {
		s.offset = s.Limit()
	}
	if selected != nil {
		s.Reveal(*selected)
	}
}

// Reveal adjusts offset minimally so range is visible (keeping an existing window inside oversized rows).
func (s *ScrollState) Reveal(r LineRange) {
	height := int(s.area.Height)
	if height == 0 || r.IsEmpty() {
		return
	}
	if r.Len() > height {
		maxOff := r.End - height
		if s.offset < r.Start {
			s.offset = r.Start
		}
		if s.offset > maxOff {
			s.offset = maxOff
		}
	} else if r.Start < s.offset {
		s.offset = r.Start
	} else if r.End > s.offset+height {
		s.offset = r.End - height
	}
	if s.offset > s.Limit() {
		s.offset = s.Limit()
	}
	if s.offset < 0 {
		s.offset = 0
	}
}

// Step applies a scroll step clamped to [0, Limit()].
func (s *ScrollState) Step(st Step) {
	page := max(int(s.area.Height)-1, 1)
	switch st.Kind {
	case StepLines:
		s.offset = max(0, s.offset+st.Delta)
	case StepPages:
		s.offset = max(0, s.offset+st.Delta*page)
	case StepTop:
		s.offset = 0
	case StepBottom:
		s.offset = s.Limit()
	}
	if s.offset > s.Limit() {
		s.offset = s.Limit()
	}
}

// Input handles scroll keys and mouse wheel events inside the viewport.
func (s *ScrollState) Input(event Event) bool {
	var st Step
	switch event.Kind {
	case EventKey:
		if event.Key.Kind == KeyRelease || event.Key.Modifiers.Intersects(KeyModControl|KeyModAlt) {
			return false
		}
		switch event.Key.Code {
		case KeyCode{Kind: KeyUp}, CharKey('k'):
			st = LinesStep(-1)
		case KeyCode{Kind: KeyDown}, CharKey('j'):
			st = LinesStep(1)
		case KeyCode{Kind: KeyPageUp}:
			st = PagesStep(-1)
		case KeyCode{Kind: KeyPageDown}:
			st = PagesStep(1)
		case KeyCode{Kind: KeyHome}, CharKey('g'):
			st = TopStep()
		case KeyCode{Kind: KeyEnd}, CharKey('G'):
			st = BottomStep()
		default:
			return false
		}
	case EventMouse:
		if !s.area.Contains(Position{X: event.Mouse.Column, Y: event.Mouse.Row}) {
			return false
		}
		switch event.Mouse.Kind {
		case MouseScrollUp:
			st = LinesStep(-WheelLines)
		case MouseScrollDown:
			st = LinesStep(WheelLines)
		default:
			return false
		}
	default:
		return false
	}
	s.Step(st)
	return true
}

// OverflowPosition returns Position() only when the content overflows the viewport.
func (s *ScrollState) OverflowPosition() (string, bool) {
	if s.Limit() <= 0 {
		return "", false
	}
	pos := s.Position()
	if pos == "" {
		return "", false
	}
	return pos, true
}

// Position formats the visible line window and remaining line count.
func (s *ScrollState) Position() string {
	if s.content == 0 || s.area.Height == 0 {
		return ""
	}
	end := min(s.offset+int(s.area.Height), s.content)
	below := s.content - end
	if below > 0 {
		return fmt.Sprintf("%d–%d of %d · %d more ↓", s.offset+1, end, s.content, below)
	}
	return fmt.Sprintf("%d–%d of %d", s.offset+1, end, s.content)
}
