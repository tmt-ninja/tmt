package tui

// 1:1 mapping from rust/crates/tmt-tui/src/app/tests.rs (5 #[test] functions):
//
//  1. modal_captures_unknown_keys_and_outside_mouse_without_calling_base         -> TestModalCapturesUnknownKeysAndOutsideMouseWithoutCallingBase
//  2. close_and_replace_restore_original_base_without_replaying_close            -> TestCloseAndReplaceRestoreOriginalBaseWithoutReplayingClose
//  3. the_modal_gets_every_key_and_tab_moves_only_between_base_panes             -> TestTheModalGetsEveryKeyAndTabMovesOnlyBetweenBasePanes
//  4. ctrl_c_always_quits_but_release_does_not_trigger_actions                   -> TestCtrlCAlwaysQuitsButReleaseDoesNotTriggerActions
//  5. refresh_keeps_base_identity_or_nearest_surviving_position_under_modal      -> TestRefreshKeepsBaseIdentityOrNearestSurvivingPositionUnderModal

import (
	"reflect"
	"testing"
)

func cid(name string) ComponentID { return ComponentID{name} }
func plainKey(code KeyCode) Event { return KeyInputEvent(code, KeyModNone) }

func TestModalCapturesUnknownKeysAndOutsideMouseWithoutCallingBase(t *testing.T) {
	stack := NewFocusStack([]ComponentID{cid("base")})
	stack.Open(cid("help"))
	events := []Event{
		plainKey(KeyCode{Kind: KeyLeft}),
		plainKey(KeyCode{Kind: KeyEnter}),
		plainKey(CharKey('/')),
		MouseInputEvent(MouseEvent{Kind: MouseScrollDown, Column: 300, Row: 200}),
	}
	for _, ev := range events {
		var called []ComponentID
		got := Route(&stack, ev, func(target ComponentID, _ Event) (struct{}, bool) {
			called = append(called, target)
			return struct{}{}, false
		})
		if got.Kind != RoutedCaptured {
			t.Fatalf("event %+v got %v, want Captured", ev, got.Kind)
		}
		if !reflect.DeepEqual(called, []ComponentID{cid("help")}) {
			t.Fatalf("called = %v, want [[help]]", called)
		}
	}
}

func TestCloseAndReplaceRestoreOriginalBaseWithoutReplayingClose(t *testing.T) {
	stack := NewFocusStack([]ComponentID{cid("first"), cid("second")})
	if !stack.FocusBase(cid("second")) {
		t.Fatalf("FocusBase(second) = false")
	}
	stack.Open(cid("help"))
	stack.Open(cid("settings"))
	var called []ComponentID
	got := Route(&stack, plainKey(KeyCode{Kind: KeyEsc}), func(target ComponentID, _ Event) (string, bool) {
		called = append(called, target)
		return "close", true
	})
	if got.Kind != RoutedHandled || got.Effect != "close" {
		t.Fatalf("got = %+v, want Handled(close)", got)
	}
	if !reflect.DeepEqual(called, []ComponentID{cid("settings")}) {
		t.Fatalf("called = %v", called)
	}
	if !reflect.DeepEqual(stack.Close(), cid("settings")) {
		t.Fatalf("Close() mismatch")
	}
	if !reflect.DeepEqual(stack.Focused(), cid("second")) {
		t.Fatalf("restored focus = %v, want [second]", stack.Focused())
	}
	unhandled := Route(&stack, plainKey(KeyCode{Kind: KeyEnter}), func(ComponentID, Event) (struct{}, bool) {
		return struct{}{}, false
	})
	if unhandled.Kind != RoutedUnhandled {
		t.Fatalf("unhandled = %v, want Unhandled", unhandled.Kind)
	}
}

func TestTheModalGetsEveryKeyAndTabMovesOnlyBetweenBasePanes(t *testing.T) {
	stack := NewFocusStack([]ComponentID{cid("left"), cid("right")})
	stack.Open(cid("picker"))
	for _, ch := range []rune{'q', '?', 'j', 'k', 'g', 'G'} {
		got := Route(&stack, plainKey(CharKey(ch)), func(target ComponentID, _ Event) (string, bool) {
			if reflect.DeepEqual(target, cid("picker")) {
				return "text", true
			}
			return "", false
		})
		if got.Kind != RoutedHandled || got.Effect != "text" {
			t.Fatalf("char %q got %+v", ch, got)
		}
	}
	for _, tab := range []KeyCode{{Kind: KeyTab}, {Kind: KeyBackTab}} {
		got := Route(&stack, plainKey(tab), func(ComponentID, Event) (struct{}, bool) {
			return struct{}{}, false
		})
		if got.Kind != RoutedCaptured {
			t.Fatalf("tab %+v in modal got %v, want Captured", tab, got.Kind)
		}
	}
	if !reflect.DeepEqual(stack.Focused(), cid("picker")) || !reflect.DeepEqual(stack.BaseFocus(), cid("left")) {
		t.Fatalf("focus = %v / base = %v", stack.Focused(), stack.BaseFocus())
	}
	stack.Close()
	got := Route(&stack, plainKey(KeyCode{Kind: KeyTab}), func(ComponentID, Event) (struct{}, bool) {
		return struct{}{}, false
	})
	if got.Kind != RoutedCaptured || !reflect.DeepEqual(stack.Focused(), cid("right")) {
		t.Fatalf("base tab got %v, focused=%v", got.Kind, stack.Focused())
	}
}

func TestCtrlCAlwaysQuitsButReleaseDoesNotTriggerActions(t *testing.T) {
	stack := NewFocusStack([]ComponentID{cid("base")})
	stack.Open(cid("help"))
	ctrlC := KeyInputEvent(CharKey('c'), KeyModControl)
	got := Route(&stack, ctrlC, func(ComponentID, Event) (struct{}, bool) {
		t.Fatalf("quit must bypass handlers")
		return struct{}{}, false
	})
	if got.Kind != RoutedQuit {
		t.Fatalf("ctrl-c got %v, want Quit", got.Kind)
	}
	release := Event{
		Kind: EventKey,
		Key:  KeyEvent{Code: CharKey('c'), Modifiers: KeyModControl, Kind: KeyRelease},
	}
	gotRel := Route(&stack, release, func(ComponentID, Event) (struct{}, bool) {
		t.Fatalf("release must not dispatch")
		return struct{}{}, false
	})
	if gotRel.Kind != RoutedCaptured {
		t.Fatalf("release in modal got %v, want Captured", gotRel.Kind)
	}
}

func TestRefreshKeepsBaseIdentityOrNearestSurvivingPositionUnderModal(t *testing.T) {
	stack := NewFocusStack([]ComponentID{cid("a"), cid("b"), cid("c")})
	stack.FocusBase(cid("b"))
	stack.Open(cid("help"))
	stack.ReconcileBase([]ComponentID{cid("c"), cid("a"), cid("b")})
	if !reflect.DeepEqual(stack.BaseFocus(), cid("b")) {
		t.Fatalf("BaseFocus = %v, want [b]", stack.BaseFocus())
	}
	stack.ReconcileBase([]ComponentID{cid("c"), cid("a")})
	stack.Close()
	if !reflect.DeepEqual(stack.Focused(), cid("a")) {
		t.Fatalf("Focused = %v, want [a]", stack.Focused())
	}
	stack.ReconcileBase(nil)
	if stack.Focused() != nil {
		t.Fatalf("Focused = %v, want nil", stack.Focused())
	}
}

func TestDecodeInputEventCoversKeysMouseAndPaste(t *testing.T) {
	ev, n, ok := DecodeInputEvent([]byte("\x1b[1;5A"))
	if !ok || n != 6 || ev.Kind != EventKey || ev.Key.Code.Kind != KeyUp || !ev.Key.Modifiers.Contains(KeyModControl) {
		t.Fatalf("ctrl+up = (%+v, %d, %v)", ev, n, ok)
	}
	ev, n, ok = DecodeInputEvent([]byte("\x1b[<0;10;5M"))
	if !ok || n != 10 || ev.Kind != EventMouse || ev.Mouse.Kind != MouseDown || ev.Mouse.Column != 9 || ev.Mouse.Row != 4 {
		t.Fatalf("sgr mouse = (%+v, %d, %v)", ev, n, ok)
	}
	ev, n, ok = DecodeInputEvent([]byte("\x1b[200~hello\x1b[201~"))
	if !ok || ev.Kind != EventPaste || ev.Paste != "hello" {
		t.Fatalf("paste = (%+v, %d, %v)", ev, n, ok)
	}
}
