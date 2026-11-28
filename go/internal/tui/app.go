package tui

import "slices"

// ComponentID identifies a focusable component in reading order.
type ComponentID = []string

// FocusStack tracks one base focus and one active modal overlay.
type FocusStack struct {
	base    []ComponentID
	focused int
	overlay ComponentID
	hasOvl  bool
}

// NewFocusStack creates a FocusStack with the given base pane order.
func NewFocusStack(base []ComponentID) FocusStack {
	return FocusStack{base: base}
}

// Focused returns the currently focused ComponentID (overlay if open, else base).
func (s *FocusStack) Focused() ComponentID {
	if s.hasOvl {
		return s.overlay
	}
	if s.focused >= 0 && s.focused < len(s.base) {
		return s.base[s.focused]
	}
	return nil
}

// BaseFocus returns the focused base pane even while a modal overlay is open.
func (s *FocusStack) BaseFocus() ComponentID {
	if s.focused >= 0 && s.focused < len(s.base) {
		return s.base[s.focused]
	}
	return nil
}

// FocusBase moves base focus to id if present.
func (s *FocusStack) FocusBase(id ComponentID) bool {
	for i, candidate := range s.base {
		if slices.Equal(candidate, id) {
			s.focused = i
			return true
		}
	}
	return false
}

// ReconcileBase updates base reading order, preserving identity or nearest surviving position.
func (s *FocusStack) ReconcileBase(base []ComponentID) {
	cur := s.BaseFocus()
	nextIdx := -1
	if cur != nil {
		for i, candidate := range base {
			if slices.Equal(candidate, cur) {
				nextIdx = i
				break
			}
		}
	}
	if nextIdx >= 0 {
		s.focused = nextIdx
	} else if len(base) > 0 {
		s.focused = min(s.focused, len(base)-1)
	} else {
		s.focused = 0
	}
	s.base = base
}

// Open activates a modal overlay, preserving the base return target.
func (s *FocusStack) Open(id ComponentID) {
	s.overlay = id
	s.hasOvl = true
}

// Close dismisses the active modal overlay and returns its ID (or nil).
func (s *FocusStack) Close() ComponentID {
	if !s.hasOvl {
		return nil
	}
	id := s.overlay
	s.overlay = nil
	s.hasOvl = false
	return id
}

// Overlay returns the active modal overlay ID, or nil.
func (s *FocusStack) Overlay() ComponentID {
	if !s.hasOvl {
		return nil
	}
	return s.overlay
}

func (s *FocusStack) advance(backwards bool) {
	count := len(s.base)
	if count == 0 {
		return
	}
	if backwards {
		s.focused = (s.focused + count - 1) % count
	} else {
		s.focused = (s.focused + 1) % count
	}
}

// RoutedKind classifies the outcome of Route.
type RoutedKind uint8

const (
	RoutedHandled RoutedKind = iota
	RoutedCaptured
	RoutedUnhandled
	RoutedQuit
)

// Routed holds the result of routing an Event through a FocusStack.
type Routed[E any] struct {
	Kind   RoutedKind
	Effect E
}

// Route delivers event to the focused layer. Ctrl-C always returns RoutedQuit.
// An open modal captures all unhandled events; without a modal, Tab/Shift-Tab
// cycle base panes.
func Route[E any](stack *FocusStack, event Event, handler func(ComponentID, Event) (E, bool)) Routed[E] {
	if event.Kind == EventKey {
		if event.Key.Kind == KeyRelease {
			if stack.hasOvl {
				return Routed[E]{Kind: RoutedCaptured}
			}
			return Routed[E]{Kind: RoutedUnhandled}
		}
		if event.Key.Code == CharKey('c') && event.Key.Modifiers.Contains(KeyModControl) {
			return Routed[E]{Kind: RoutedQuit}
		}
	}
	if id := stack.Focused(); id != nil {
		if effect, ok := handler(id, event); ok {
			return Routed[E]{Kind: RoutedHandled, Effect: effect}
		}
	}
	if stack.hasOvl {
		return Routed[E]{Kind: RoutedCaptured}
	}
	if event.Kind == EventKey &&
		(event.Key.Code.Kind == KeyTab || event.Key.Code.Kind == KeyBackTab) &&
		!event.Key.Modifiers.Intersects(KeyModControl|KeyModAlt) {
		stack.advance(event.Key.Code.Kind == KeyBackTab || event.Key.Modifiers.Contains(KeyModShift))
		return Routed[E]{Kind: RoutedCaptured}
	}
	return Routed[E]{Kind: RoutedUnhandled}
}
