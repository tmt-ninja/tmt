package tui

import (
	"bytes"
	"strconv"
	"strings"
	"unicode/utf8"
)

// EventKind identifies a terminal input event category.
type EventKind uint8

const (
	EventKey EventKind = iota
	EventMouse
	EventResize
	EventPaste
	EventFocusGained
	EventFocusLost
)

// KeyCodeKind identifies a logical keyboard key.
type KeyCodeKind uint8

const (
	KeyChar KeyCodeKind = iota
	KeyEnter
	KeyEsc
	KeyBackspace
	KeyTab
	KeyBackTab
	KeyDelete
	KeyInsert
	KeyLeft
	KeyRight
	KeyUp
	KeyDown
	KeyHome
	KeyEnd
	KeyPageUp
	KeyPageDown
	KeyF
)

// KeyCode is a logical key pressed on the keyboard.
type KeyCode struct {
	Kind KeyCodeKind
	Char rune
	F    uint8
}

func CharKey(r rune) KeyCode { return KeyCode{Kind: KeyChar, Char: r} }
func FKey(n uint8) KeyCode   { return KeyCode{Kind: KeyF, F: n} }

// KeyModifiers is a bitmask of modifier keys.
type KeyModifiers uint8

const (
	KeyModNone    KeyModifiers = 0
	KeyModShift   KeyModifiers = 1 << 0
	KeyModControl KeyModifiers = 1 << 1
	KeyModAlt     KeyModifiers = 1 << 2
)

func (m KeyModifiers) Contains(other KeyModifiers) bool   { return m&other == other }
func (m KeyModifiers) Intersects(other KeyModifiers) bool { return m&other != 0 }

// KeyEventKind distinguishes key press, repeat, and release events.
type KeyEventKind uint8

const (
	KeyPress KeyEventKind = iota
	KeyRepeat
	KeyRelease
)

// KeyEvent represents a keyboard event.
type KeyEvent struct {
	Code      KeyCode
	Modifiers KeyModifiers
	Kind      KeyEventKind
}

func NewKeyEvent(code KeyCode, mods KeyModifiers) KeyEvent {
	return KeyEvent{Code: code, Modifiers: mods, Kind: KeyPress}
}

// MouseButton identifies which mouse button triggered an event.
type MouseButton uint8

const (
	MouseLeft MouseButton = iota
	MouseRight
	MouseMiddle
)

// MouseEventKind identifies the type of mouse event.
type MouseEventKind uint8

const (
	MouseDown MouseEventKind = iota
	MouseUp
	MouseDrag
	MouseMoved
	MouseScrollDown
	MouseScrollUp
	MouseScrollLeft
	MouseScrollRight
)

// MouseEvent represents a terminal mouse event.
type MouseEvent struct {
	Kind      MouseEventKind
	Button    MouseButton
	Column    uint16
	Row       uint16
	Modifiers KeyModifiers
}

// Event is a decoded terminal input event.
type Event struct {
	Kind   EventKind
	Key    KeyEvent
	Mouse  MouseEvent
	Resize [2]uint16
	Paste  string
}

func KeyInputEvent(code KeyCode, mods KeyModifiers) Event {
	return Event{Kind: EventKey, Key: NewKeyEvent(code, mods)}
}

func MouseInputEvent(m MouseEvent) Event {
	return Event{Kind: EventMouse, Mouse: m}
}

func PasteInputEvent(s string) Event {
	return Event{Kind: EventPaste, Paste: s}
}

func ResizeInputEvent(w, h uint16) Event {
	return Event{Kind: EventResize, Resize: [2]uint16{w, h}}
}

// DecodeInputEvent decodes one terminal input event from raw-mode bytes.
// It returns (event, bytesConsumed, ok).
func DecodeInputEvent(buf []byte) (Event, int, bool) {
	if len(buf) == 0 {
		return Event{}, 0, false
	}
	b := buf[0]
	if b == 0x1b {
		if len(buf) == 1 {
			return KeyInputEvent(KeyCode{Kind: KeyEsc}, KeyModNone), 1, true
		}
		switch buf[1] {
		case '[':
			return decodeCSI(buf)
		case 'O':
			if len(buf) >= 3 {
				if code, ok := decodeSS3(buf[2]); ok {
					return KeyInputEvent(code, KeyModNone), 3, true
				}
			}
			return KeyInputEvent(KeyCode{Kind: KeyEsc}, KeyModNone), 1, true
		default:
			r, sz := utf8.DecodeRune(buf[1:])
			if r == utf8.RuneError && sz == 1 {
				return KeyInputEvent(KeyCode{Kind: KeyEsc}, KeyModNone), 1, true
			}
			return KeyInputEvent(CharKey(r), KeyModAlt), 1 + sz, true
		}
	}
	switch b {
	case '\r', '\n':
		return KeyInputEvent(KeyCode{Kind: KeyEnter}, KeyModNone), 1, true
	case '\t':
		return KeyInputEvent(KeyCode{Kind: KeyTab}, KeyModNone), 1, true
	case 0x7f, 0x08:
		return KeyInputEvent(KeyCode{Kind: KeyBackspace}, KeyModNone), 1, true
	}
	if b >= 1 && b <= 26 {
		return KeyInputEvent(CharKey(rune('a'+b-1)), KeyModControl), 1, true
	}
	r, sz := utf8.DecodeRune(buf)
	if r == utf8.RuneError && sz == 1 {
		return Event{}, 1, false
	}
	return KeyInputEvent(CharKey(r), KeyModNone), sz, true
}

func decodeSS3(b byte) (KeyCode, bool) {
	switch b {
	case 'A':
		return KeyCode{Kind: KeyUp}, true
	case 'B':
		return KeyCode{Kind: KeyDown}, true
	case 'C':
		return KeyCode{Kind: KeyRight}, true
	case 'D':
		return KeyCode{Kind: KeyLeft}, true
	case 'H':
		return KeyCode{Kind: KeyHome}, true
	case 'F':
		return KeyCode{Kind: KeyEnd}, true
	case 'P':
		return FKey(1), true
	case 'Q':
		return FKey(2), true
	case 'R':
		return FKey(3), true
	case 'S':
		return FKey(4), true
	default:
		return KeyCode{}, false
	}
}

func decodeCSI(buf []byte) (Event, int, bool) {
	// Bracketed paste: ESC [ 200 ~ ... ESC [ 201 ~
	if bytes.HasPrefix(buf, []byte("\x1b[200~")) {
		end := bytes.Index(buf[6:], []byte("\x1b[201~"))
		if end < 0 {
			return Event{}, 0, false
		}
		return PasteInputEvent(string(buf[6 : 6+end])), 6 + end + 6, true
	}
	// Find CSI final byte in 0x40..=0x7e.
	end := -1
	for i := 2; i < len(buf); i++ {
		if buf[i] >= 0x40 && buf[i] <= 0x7e {
			end = i
			break
		}
	}
	if end < 0 {
		return Event{}, 0, false
	}
	params := string(buf[2:end])
	final := buf[end]
	consumed := end + 1

	// SGR mouse: ESC [ < b ; x ; y M/m
	if strings.HasPrefix(params, "<") && (final == 'M' || final == 'm') {
		if ev, ok := decodeSGRMouse(params[1:], final == 'm'); ok {
			return ev, consumed, true
		}
		return Event{}, consumed, false
	}

	// Focus events.
	if params == "" && final == 'I' {
		return Event{Kind: EventFocusGained}, consumed, true
	}
	if params == "" && final == 'O' {
		return Event{Kind: EventFocusLost}, consumed, true
	}

	mods := parseCSIMods(params)
	switch final {
	case 'A':
		return KeyInputEvent(KeyCode{Kind: KeyUp}, mods), consumed, true
	case 'B':
		return KeyInputEvent(KeyCode{Kind: KeyDown}, mods), consumed, true
	case 'C':
		return KeyInputEvent(KeyCode{Kind: KeyRight}, mods), consumed, true
	case 'D':
		return KeyInputEvent(KeyCode{Kind: KeyLeft}, mods), consumed, true
	case 'H':
		return KeyInputEvent(KeyCode{Kind: KeyHome}, mods), consumed, true
	case 'F':
		return KeyInputEvent(KeyCode{Kind: KeyEnd}, mods), consumed, true
	case 'Z':
		return KeyInputEvent(KeyCode{Kind: KeyBackTab}, mods|KeyModShift), consumed, true
	case '~':
		first := params
		if idx := strings.IndexByte(params, ';'); idx >= 0 {
			first = params[:idx]
		}
		switch first {
		case "1", "7":
			return KeyInputEvent(KeyCode{Kind: KeyHome}, mods), consumed, true
		case "2":
			return KeyInputEvent(KeyCode{Kind: KeyInsert}, mods), consumed, true
		case "3":
			return KeyInputEvent(KeyCode{Kind: KeyDelete}, mods), consumed, true
		case "4", "8":
			return KeyInputEvent(KeyCode{Kind: KeyEnd}, mods), consumed, true
		case "5":
			return KeyInputEvent(KeyCode{Kind: KeyPageUp}, mods), consumed, true
		case "6":
			return KeyInputEvent(KeyCode{Kind: KeyPageDown}, mods), consumed, true
		case "15":
			return KeyInputEvent(FKey(5), mods), consumed, true
		case "17":
			return KeyInputEvent(FKey(6), mods), consumed, true
		case "18":
			return KeyInputEvent(FKey(7), mods), consumed, true
		case "19":
			return KeyInputEvent(FKey(8), mods), consumed, true
		case "20":
			return KeyInputEvent(FKey(9), mods), consumed, true
		case "21":
			return KeyInputEvent(FKey(10), mods), consumed, true
		case "23":
			return KeyInputEvent(FKey(11), mods), consumed, true
		case "24":
			return KeyInputEvent(FKey(12), mods), consumed, true
		}
	}
	return Event{}, consumed, false
}

func parseCSIMods(params string) KeyModifiers {
	idx := strings.IndexByte(params, ';')
	if idx < 0 {
		return KeyModNone
	}
	n, err := strconv.Atoi(params[idx+1:])
	if err != nil || n < 1 {
		return KeyModNone
	}
	bits := n - 1
	var m KeyModifiers
	if bits&1 != 0 {
		m |= KeyModShift
	}
	if bits&2 != 0 {
		m |= KeyModAlt
	}
	if bits&4 != 0 {
		m |= KeyModControl
	}
	return m
}

func decodeSGRMouse(params string, release bool) (Event, bool) {
	parts := strings.Split(params, ";")
	if len(parts) != 3 {
		return Event{}, false
	}
	cb, err1 := strconv.Atoi(parts[0])
	cx, err2 := strconv.Atoi(parts[1])
	cy, err3 := strconv.Atoi(parts[2])
	if err1 != nil || err2 != nil || err3 != nil || cx < 1 || cy < 1 {
		return Event{}, false
	}
	var mods KeyModifiers
	if cb&4 != 0 {
		mods |= KeyModShift
	}
	if cb&8 != 0 {
		mods |= KeyModAlt
	}
	if cb&16 != 0 {
		mods |= KeyModControl
	}
	col := uint16(cx - 1)
	row := uint16(cy - 1)
	btnBits := cb & 3
	btn := MouseLeft
	switch btnBits {
	case 1:
		btn = MouseMiddle
	case 2:
		btn = MouseRight
	}
	var kind MouseEventKind
	switch {
	case cb&64 != 0:
		switch btnBits {
		case 0:
			kind = MouseScrollUp
		case 1:
			kind = MouseScrollDown
		case 2:
			kind = MouseScrollLeft
		case 3:
			kind = MouseScrollRight
		}
	case cb&32 != 0:
		if btnBits == 3 {
			kind = MouseMoved
		} else {
			kind = MouseDrag
		}
	case release:
		kind = MouseUp
	default:
		kind = MouseDown
	}
	return MouseInputEvent(MouseEvent{
		Kind:      kind,
		Button:    btn,
		Column:    col,
		Row:       row,
		Modifiers: mods,
	}), true
}
