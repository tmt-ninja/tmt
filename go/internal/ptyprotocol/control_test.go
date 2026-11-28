package ptyprotocol

import (
	"bytes"
	"encoding/binary"
	"math"
	"strings"
	"testing"
	"unicode/utf8"
)

func strPtr(s string) *string { return &s }
func u64Ptr(v uint64) *uint64 { return &v }
func exitPtr(e Exit) *Exit    { return &e }

func TestCoreControlsRoundTripSeparatelyFromAttachFrames(t *testing.T) {
	controls := []Control{
		{Tag: ControlInspect},
		{Tag: ControlCapabilities},
		{Tag: ControlTerminal},
		{Tag: ControlTerminalDetail},
		{
			Tag:         ControlTerminalRun,
			Owner:       "11111111-1111-4111-8111-111111111111",
			MemberPID:   123,
			MemberStart: "start-token",
			Command:     "printf '%s' 'hello world'",
		},
		{Tag: ControlAwaitLaunch},
		{Tag: ControlWaitLauncher},
		{Tag: ControlLaunchReady, PanePID: 123},
		{Tag: ControlCapture},
		{Tag: ControlPublish, PanePID: 123, Key: "binding", Marker: "marker"},
		{Tag: ControlPublishIf, PanePID: 123, Key: "binding", ExpectedKey: nil, Marker: "marker"},
		{Tag: ControlClear, Key: "binding"},
		{Tag: ControlPaste, Data: []byte("two lines\nkept together")},
		{Tag: ControlEnter},
		{Tag: ControlResume},
		{Tag: ControlRelaunch, RelaunchKind: RelaunchResume, Program: []string{"/bin/tmt", "resume", ""}},
		{Tag: ControlRelaunch, RelaunchKind: RelaunchShell, Program: []string{"/bin/sh"}},
		{Tag: ControlClose},
	}
	for _, ctrl := range controls {
		c := ctrl
		frame := ClientMessage{Tag: ClientControl, Control: &c}
		if k := frame.Kind(); k < 0x20 || k > 0x30 {
			t.Errorf("control kind %#02x outside 0x20..=0x30", k)
		}
		roundTripClient(t, frame)
	}

	replies := []ControlReply{
		{Tag: ReplyState, SupervisorPID: 12, PanePID: 123},
		{
			Tag: ReplyState, SupervisorPID: 12, PanePID: 123,
			KeyIdleMs: u64Ptr(0), Marker: strPtr("marker"), Paused: true,
			Ended: exitPtr(Exit{Kind: ExitSignal, Value: 2}), Shell: true, Relaunching: true,
		},
		{
			Tag: ReplyState, SupervisorPID: 12, PanePID: 123,
			Ended: exitPtr(Exit{Kind: ExitCode, Value: -1}),
		},
		{Tag: ReplyLaunched, Text: "committed-marker"},
		{Tag: ReplyTerminalRan, TerminalRan: TerminalRunSubmitted},
		{Tag: ReplyTerminalRan, TerminalRan: TerminalRunStale},
		{Tag: ReplyTerminalRan, TerminalRan: TerminalRunBusy},
		{Tag: ReplyTerminalRan, TerminalRan: TerminalRunEnded},
		{Tag: ReplyApplied, Applied: true},
		{Tag: ReplyApplied, Applied: false},
		{Tag: ReplyCapabilities, CapResume: true, CapRelaunch: true, CapClose: true},
		{Tag: ReplyCapabilities},
		{Tag: ReplyCapabilities, CapResume: true, CapClose: true},
		{Tag: ReplyCapabilities, CapClose: true, CapTerminal: true},
		{Tag: ReplyTerminal, Owner: "11111111-1111-4111-8111-111111111111", CreatedMs: 1_762_300_000_000, Busy: true},
		{Tag: ReplyTerminal, Owner: "11111111-1111-4111-8111-111111111111", CreatedMs: 0, Busy: false},
		{Tag: ReplyTerminalDetail, Owner: "11111111-1111-4111-8111-111111111111", CreatedMs: 7, Busy: true, ShellName: strPtr("zsh"), ProgramName: strPtr("cargo")},
		{Tag: ReplyTerminalDetail, Owner: "11111111-1111-4111-8111-111111111111", CreatedMs: 7, Busy: false},
		{Tag: ReplyScreen, Text: ""},
		{Tag: ReplyScreen, Text: "visible"},
		{Tag: ReplyError, Text: "screen exceeds capture bound"},
	}
	for _, rep := range replies {
		r := rep
		roundTripServer(t, ServerMessage{Tag: ServerControl, Control: &r})
	}
}

func TestLegacyPublishAndResumeAndPasteAndDimensions(t *testing.T) {
	pub := ClientMessage{
		Tag:     ClientControl,
		Control: &Control{Tag: ControlPublish, PanePID: 123, Key: "b", Marker: "m"},
	}
	wantPub := []byte{0x21, 0, 0, 0, 10, 0, 0, 0, 123, 0, 1, 'b', 0, 1, 'm'}
	if !bytes.Equal(pub.Encode(), wantPub) {
		t.Errorf("legacy publish bytes = %x, want %x", pub.Encode(), wantPub)
	}
	res := ClientMessage{Tag: ClientControl, Control: &Control{Tag: ControlResume}}
	if !bytes.Equal(res.Encode(), []byte{0x2b, 0, 0, 0, 0}) {
		t.Errorf("resume bytes = %x", res.Encode())
	}
	if _, err := ReadClientMessage(0x2b, []byte{0}); err == nil {
		t.Errorf("non-empty resume accepted")
	}

	paste := bytes.Repeat([]byte{'x'}, MaxPayload)
	roundTripClient(t, ClientMessage{Tag: ClientControl, Control: &Control{Tag: ControlPaste, Data: paste}})
	if _, err := ReadControl(0x24, make([]byte, MaxPayload+1)); err == nil {
		t.Errorf("oversized paste accepted")
	}

	if _, err := NewSize(1000, 1000); err != nil {
		t.Errorf("Size(1000,1000) failed: %v", err)
	}
	if _, err := NewSize(1001, 1); err == nil {
		t.Errorf("Size(1001,1) accepted")
	}
	if _, err := NewSize(1, 1001); err == nil {
		t.Errorf("Size(1,1001) accepted")
	}
}

func TestStateBackwardCompatibilityAndCapabilityFlags(t *testing.T) {
	var legacy []byte
	legacy = binary.BigEndian.AppendUint32(legacy, 12)
	legacy = binary.BigEndian.AppendUint32(legacy, 123)
	legacy = binary.BigEndian.AppendUint64(legacy, math.MaxUint64)
	legacy = append(legacy, 0, 1, 'm')

	msg, err := ReadServerMessage(0xa0, legacy)
	if err != nil || msg.Control.SupervisorPID != 12 || msg.Control.PanePID != 123 ||
		msg.Control.KeyIdleMs != nil || msg.Control.Marker == nil || *msg.Control.Marker != "m" ||
		msg.Control.Paused || msg.Control.Ended != nil || msg.Control.Shell || msg.Control.Relaunching {
		t.Fatalf("legacy state decode mismatch: %+v err=%v", msg.Control, err)
	}

	for _, pausedByte := range []byte{0, 1} {
		cur := append(bytes.Clone(legacy), pausedByte)
		m, err := ReadServerMessage(0xa0, cur)
		if err != nil || m.Control.Paused != (pausedByte == 1) {
			t.Errorf("paused=%d decode failed: %+v err=%v", pausedByte, m.Control, err)
		}
	}

	full := append(bytes.Clone(legacy), 0, 1, 0, 0, 0, 3, 1, 1)
	m, err := ReadServerMessage(0xa0, full)
	if err != nil || m.Control.Ended == nil || m.Control.Ended.Kind != ExitCode || m.Control.Ended.Value != 3 ||
		!m.Control.Shell || !m.Control.Relaunching {
		t.Fatalf("full state decode mismatch: %+v err=%v", m.Control, err)
	}

	for _, trailing := range [][]byte{
		{2}, {0xff}, {0, 0}, {1, 0}, {0, 0, 0, 0, 0, 0, 0},
		{0, 0, 0, 0, 0, 0, 0, 2}, {0, 0, 0, 0, 0, 0, 2, 0},
		{0, 3, 0, 0, 0, 0, 0, 0}, {0, 0, 0, 0, 0, 1, 0, 0},
		{0, 1, 0, 0, 0, 0, 0, 0, 0},
	} {
		if _, err := ReadServerMessage(0xa0, append(bytes.Clone(legacy), trailing...)); err == nil {
			t.Errorf("invalid state trailing %v accepted", trailing)
		}
	}

	// Capability flags ignore unknown bits and require exactly one byte.
	allCaps, err := ReadServerMessage(0xa5, []byte{0xff})
	if err != nil || !allCaps.Control.CapResume || !allCaps.Control.CapRelaunch || !allCaps.Control.CapClose ||
		!allCaps.Control.CapTerminal || !allCaps.Control.CapTermDetail || !allCaps.Control.CapTermRun {
		t.Errorf("0xff capability flags: %+v err=%v", allCaps.Control, err)
	}
	unknownOnly, err := ReadServerMessage(0xa5, []byte{0xc0})
	if err != nil || unknownOnly.Control.CapResume || unknownOnly.Control.CapTermRun {
		t.Errorf("0xc0 capability flags: %+v err=%v", unknownOnly.Control, err)
	}
	if _, err := ReadServerMessage(0xa5, nil); err == nil {
		t.Errorf("empty capability flags accepted")
	}
	if _, err := ReadServerMessage(0xa5, []byte{1, 0}); err == nil {
		t.Errorf("2-byte capability flags accepted")
	}
}

func TestRelaunchCloseTerminalDetailAndTerminalRunStrictness(t *testing.T) {
	relaunch := ClientMessage{
		Tag:     ClientControl,
		Control: &Control{Tag: ControlRelaunch, RelaunchKind: RelaunchNew, Program: []string{"a"}},
	}
	wantRelaunch := []byte{0x2c, 0, 0, 0, 6, 1, 0, 1, 0, 1, 'a'}
	if !bytes.Equal(relaunch.Encode(), wantRelaunch) {
		t.Errorf("relaunch bytes = %x, want %x", relaunch.Encode(), wantRelaunch)
	}
	tooManyWords := append([]byte{0, 1, 1}, bytes.Repeat([]byte{0, 1, 'a'}, 257)...)
	for _, bad := range [][]byte{
		{0, 0, 0}, {3, 0, 1, 0, 1, 'a'}, {0, 0, 1, 0, 0},
		{0, 0, 2, 0, 1, 'a'}, {0, 0, 1, 0, 1, 'a', 0}, tooManyWords,
	} {
		if _, err := ReadClientMessage(0x2c, bad); err == nil {
			t.Errorf("malformed relaunch %x accepted", bad[:min(len(bad), 16)])
		}
	}

	detailPayload := func(busy byte, shell, prog []byte) []byte {
		var p []byte
		p = binary.BigEndian.AppendUint16(p, 1)
		p = append(p, 'x')
		p = binary.BigEndian.AppendUint64(p, 7)
		p = append(p, busy)
		for _, s := range [][]byte{shell, prog} {
			p = binary.BigEndian.AppendUint16(p, uint16(len(s)))
			p = append(p, s...)
		}
		return p
	}

	// Released Terminal reply refuses trailing detail names.
	if _, err := ReadServerMessage(0xa6, detailPayload(1, []byte("zsh"), []byte("cargo"))); err == nil {
		t.Errorf("0xa6 accepted trailing detail names")
	}

	// TerminalDetail cleans escape sequences on write and read, and drops program when not busy.
	m, err := ReadServerMessage(0xa7, detailPayload(1, []byte("zsh"), []byte("\x1b[31mcargo\x1b]0;x\x07")))
	if err != nil || m.Control.ShellName == nil || *m.Control.ShellName != "zsh" ||
		m.Control.ProgramName == nil || *m.Control.ProgramName != "[31mcargo]0;x" {
		t.Errorf("detail escape cleaning: %+v err=%v", m.Control, err)
	}
	long := strings.Repeat("編譯", 20)
	cut, ok := DisplayName(long)
	if !ok || len(cut) > NameLimit || !strings.HasPrefix(long, cut) || utf8.RuneCountInString(cut) != NameLimit/3 {
		t.Errorf("DisplayName multibyte truncation: %q ok=%v len=%d", cut, ok, len(cut))
	}
	if _, ok := DisplayName(" \u202e\t "); ok {
		t.Errorf("blank+bidi DisplayName should be empty")
	}
	if got, ok := DisplayName("  vim\x1b "); !ok || got != "vim" {
		t.Errorf("DisplayName(vim) = (%q, %v)", got, ok)
	}

	m2, err := ReadServerMessage(0xa7, detailPayload(0, nil, []byte("sleep")))
	if err != nil || m2.Control.ShellName != nil || m2.Control.ProgramName != nil {
		t.Errorf("not-busy detail should drop program: %+v err=%v", m2.Control, err)
	}
	if _, err := ReadServerMessage(0xa7, detailPayload(1, bytes.Repeat([]byte{'a'}, NameLimit+1), nil)); err == nil {
		t.Errorf("oversized detail name accepted")
	}
	if _, err := ReadServerMessage(0xa7, detailPayload(1, []byte{0xff}, nil)); err == nil {
		t.Errorf("non-UTF8 detail name accepted")
	}

	// TerminalRun validation.
	for _, cmd := range []string{"", "   ", "echo a\necho b", "echo a\r", "echo \x1b[0m", "echo \u202ehidden"} {
		if ValidCommand(cmd) {
			t.Errorf("ValidCommand(%q) = true, want false", cmd)
		}
		ctrl := Control{Tag: ControlTerminalRun, Owner: "owner", MemberPID: 1, MemberStart: "start", Command: cmd}
		if _, err := ReadClientMessage(ctrl.Kind(), ctrl.Encode()[5:]); err == nil {
			t.Errorf("TerminalRun accepted invalid command %q", cmd)
		}
	}
	if ValidCommand(strings.Repeat("x", CommandLimit+1)) || !ValidCommand(strings.Repeat("x", CommandLimit)) {
		t.Errorf("ValidCommand length boundary mismatch")
	}
	if _, err := ReadControlReply(0xa8, []byte{4}); err == nil {
		t.Errorf("TerminalRan(4) accepted")
	}
	if _, err := ReadControlReply(0xa8, []byte{0, 0}); err == nil {
		t.Errorf("2-byte TerminalRan accepted")
	}
}
