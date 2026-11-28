// Rust-to-Go test mapping (23 Rust #[test] functions in rust/crates/tmt-pty-protocol/src/):
//
//	lib.rs:
//	  every_frame_round_trips                                                    -> TestEveryFrameRoundTrips
//	  frames_arrive_in_pieces_and_in_batches                                     -> TestFramesArriveInPiecesAndBatches
//	  an_invalid_frame_is_an_error_not_a_guess                                   -> TestInvalidFramesAndBoundsAndClosedSets
//	  the_length_is_bounded_before_anything_is_buffered_for_it                   -> TestInvalidFramesAndBoundsAndClosedSets
//	  exit_and_reason_bytes_are_closed_sets                                      -> TestInvalidFramesAndBoundsAndClosedSets
//	  a_snapshot_frame_is_strict                                                 -> TestInvalidFramesAndBoundsAndClosedSets
//	control_tests.rs:
//	  core_controls_round_trip_separately_from_attach_frames                     -> TestCoreControlsRoundTripSeparatelyFromAttachFrames
//	  malformed_controls_never_become_input                                      -> TestLegacyPublishAndResumeAndPasteAndDimensions
//	  screen_dimensions_are_bounded_before_allocating_a_screen                   -> TestLegacyPublishAndResumeAndPasteAndDimensions
//	  a_core_paste_is_one_bounded_frame_even_above_the_keystroke_chunk_size      -> TestLegacyPublishAndResumeAndPasteAndDimensions
//	  legacy_publish_keeps_its_original_frame_bytes                              -> TestLegacyPublishAndResumeAndPasteAndDimensions
//	  resume_is_an_empty_control_frame                                           -> TestLegacyPublishAndResumeAndPasteAndDimensions
//	  a_state_without_the_paused_byte_decodes_as_not_paused                      -> TestStateBackwardCompatibilityAndCapabilityFlags
//	  capability_flags_ignore_unknown_bits_and_need_exactly_one_byte             -> TestStateBackwardCompatibilityAndCapabilityFlags
//	  a_state_without_the_ended_group_decodes_as_running                         -> TestStateBackwardCompatibilityAndCapabilityFlags
//	  relaunch_and_close_frames_are_bounded_and_strict                           -> TestRelaunchCloseTerminalDetailAndTerminalRunStrictness
//	  a_terminal_reply_needs_an_owner_a_time_and_one_flag_byte                   -> TestRelaunchCloseTerminalDetailAndTerminalRunStrictness
//	  the_terminal_reply_keeps_its_released_bytes_and_refuses_trailing_names     -> TestRelaunchCloseTerminalDetailAndTerminalRunStrictness
//	  terminal_names_are_display_text_cleaned_on_write_and_on_read               -> TestRelaunchCloseTerminalDetailAndTerminalRunStrictness
//	  a_terminal_detail_reply_is_strict_and_bounded                              -> TestRelaunchCloseTerminalDetailAndTerminalRunStrictness
//	  terminal_run_refuses_hidden_multiline_empty_and_oversized_commands         -> TestRelaunchCloseTerminalDetailAndTerminalRunStrictness
//	output_sanitizer.rs:
//	  raw_c1_and_escape_intermediates_cannot_leak_their_contents                 -> TestRawC1AndEscapeIntermediatesCannotLeakContents
//	  every_byte_boundary_keeps_escape_payloads_out_and_complete_glyphs_in       -> TestEveryByteBoundaryKeepsEscapePayloadsOutAndCompleteGlyphsIn
package ptyprotocol

import (
	"bytes"
	"encoding/binary"
	"errors"
	"reflect"
	"testing"
)

func mustSize(t *testing.T, cols, rows uint16) Size {
	t.Helper()
	s, err := NewSize(cols, rows)
	if err != nil {
		t.Fatalf("NewSize(%d, %d) failed: %v", cols, rows, err)
	}
	return s
}

func roundTripClient(t *testing.T, msg ClientMessage) {
	t.Helper()
	d := NewDecoder()
	if err := d.Push(msg.Encode()); err != nil {
		t.Fatalf("Push failed: %v", err)
	}
	got, ok, err := d.NextClient()
	if err != nil || !ok {
		t.Fatalf("NextClient failed: ok=%v err=%v", ok, err)
	}
	if !reflect.DeepEqual(got, msg) {
		t.Errorf("round-trip client mismatch:\n got: %+v\nwant: %+v", got, msg)
	}
	if _, ok, err := d.NextClient(); err != nil || ok {
		t.Errorf("expected empty decoder after round-trip, got ok=%v err=%v", ok, err)
	}
}

func roundTripServer(t *testing.T, msg ServerMessage) {
	t.Helper()
	d := NewDecoder()
	if err := d.Push(msg.Encode()); err != nil {
		t.Fatalf("Push failed: %v", err)
	}
	got, ok, err := d.NextServer()
	if err != nil || !ok {
		t.Fatalf("NextServer failed: ok=%v err=%v", ok, err)
	}
	if !reflect.DeepEqual(got, msg) {
		t.Errorf("round-trip server mismatch:\n got: %+v\nwant: %+v", got, msg)
	}
	if _, ok, err := d.NextServer(); err != nil || ok {
		t.Errorf("expected empty decoder after round-trip, got ok=%v err=%v", ok, err)
	}
}

func TestEveryFrameRoundTrips(t *testing.T) {
	for _, msg := range []ClientMessage{
		{Tag: ClientHello, Version: Version},
		{Tag: ClientInput, Data: []byte("ls\r")},
		{Tag: ClientResize, Size: mustSize(t, 200, 50)},
		{Tag: ClientTakeSole},
		{Tag: ClientDetach},
		{Tag: ClientSnapshot},
	} {
		roundTripClient(t, msg)
	}

	for _, msg := range []ServerMessage{
		{Tag: ServerSnapshotStart},
		{Tag: ServerSnapshotData, Data: []byte("\x1b[?25l\x1b[1mhi")},
		{Tag: ServerSnapshotEnd, Size: mustSize(t, 132, 43)},
		{Tag: ServerWelcome, Version: Version, Size: mustSize(t, 80, 24)},
		{Tag: ServerOutput, Data: []byte{0, 27, '[', 255}},
		{Tag: ServerResized, Size: mustSize(t, 1, 1)},
		{Tag: ServerExited, Exit: Exit{Kind: ExitCode, Value: -3}},
		{Tag: ServerExited, Exit: Exit{Kind: ExitSignal, Value: 9}},
		{Tag: ServerEvicted, Eviction: EvictionTakenOver},
		{Tag: ServerEvicted, Eviction: EvictionTooSlow},
		{Tag: ServerRefused, Refusal: RefusalVersion},
		{Tag: ServerRefused, Refusal: RefusalHandshake},
		{Tag: ServerRefused, Refusal: RefusalOwner},
		{Tag: ServerRefused, Refusal: RefusalFull},
	} {
		roundTripServer(t, msg)
	}
}

func TestFramesArriveInPiecesAndBatches(t *testing.T) {
	first := (ClientMessage{Tag: ClientInput, Data: []byte("abc")}).Encode()
	second := (ClientMessage{Tag: ClientDetach}).Encode()
	d := NewDecoder()
	for _, b := range first[:len(first)-1] {
		if err := d.Push([]byte{b}); err != nil {
			t.Fatalf("Push byte failed: %v", err)
		}
		if _, ok, err := d.NextClient(); err != nil || ok {
			t.Fatalf("unexpected frame before complete: ok=%v err=%v", ok, err)
		}
	}
	rest := append([]byte{first[len(first)-1]}, second...)
	if err := d.Push(rest); err != nil {
		t.Fatalf("Push rest failed: %v", err)
	}
	got1, ok, err := d.NextClient()
	if err != nil || !ok || got1.Tag != ClientInput || !bytes.Equal(got1.Data, []byte("abc")) {
		t.Fatalf("first frame mismatch: %+v ok=%v err=%v", got1, ok, err)
	}
	got2, ok, err := d.NextClient()
	if err != nil || !ok || got2.Tag != ClientDetach {
		t.Fatalf("second frame mismatch: %+v ok=%v err=%v", got2, ok, err)
	}
	if _, ok, err := d.NextClient(); err != nil || ok {
		t.Fatalf("expected empty decoder")
	}
}

func TestInvalidFramesAndBoundsAndClosedSets(t *testing.T) {
	decodeClient := func(raw []byte) error {
		d := NewDecoder()
		if err := d.Push(raw); err != nil {
			return err
		}
		_, _, err := d.NextClient()
		return err
	}
	decodeServer := func(raw []byte) error {
		d := NewDecoder()
		if err := d.Push(raw); err != nil {
			return err
		}
		_, _, err := d.NextServer()
		return err
	}

	var pe *ProtocolError
	if err := decodeClient([]byte{0x7f, 0, 0, 0, 0}); !errors.As(err, &pe) || pe.Kind != ErrUnknownKind || pe.UnknownKind != 0x7f {
		t.Errorf("unknown kind 0x7f: got %v", err)
	}
	if err := decodeClient([]byte{kindWelcome, 0, 0, 0, 0}); !errors.As(err, &pe) || pe.Kind != ErrUnknownKind || pe.UnknownKind != kindWelcome {
		t.Errorf("server kind as client: got %v", err)
	}

	tooMuchInput := make([]byte, 5+MaxInput+1)
	tooMuchInput[0] = kindInput
	binary.BigEndian.PutUint32(tooMuchInput[1:5], uint32(MaxInput+1))
	for _, raw := range [][]byte{
		{kindDetach, 0, 0, 0, 1, 0},
		{kindSnapshot, 0, 0, 0, 1, 0},
		{kindInput, 0, 0, 0, 0},
		tooMuchInput,
		{kindResize, 0, 0, 0, 3, 0, 80, 0},
		{kindResize, 0, 0, 0, 4, 0, 0, 0, 24},
		{kindResize, 0, 0, 0, 4, 0x27, 0x11, 0, 24}, // 10001 cols
	} {
		if err := decodeClient(raw); err == nil {
			t.Errorf("invalid client frame accepted: %x", raw[:min(len(raw), 16)])
		}
	}

	// Length bounded before buffering.
	oversizedHeader := make([]byte, 5)
	oversizedHeader[0] = kindOutput
	binary.BigEndian.PutUint32(oversizedHeader[1:5], uint32(MaxPayload+1))
	if err := decodeServer(oversizedHeader); !errors.As(err, &pe) || pe.Kind != ErrOversized {
		t.Errorf("oversized header: got %v", err)
	}
	flood := NewDecoder()
	if err := flood.Push(make([]byte, headerSize+2*MaxPayload)); err != nil {
		t.Fatalf("exact 2-frame buffer should succeed: %v", err)
	}
	if err := flood.Push([]byte{0}); !errors.As(err, &pe) || pe.Kind != ErrOversized {
		t.Errorf("flood past 2 frames: got %v", err)
	}

	// Exit, eviction, refusal, snapshot strictness.
	tooMuchSnap := make([]byte, 5+MaxOutput+1)
	tooMuchSnap[0] = kindSnapshotData
	binary.BigEndian.PutUint32(tooMuchSnap[1:5], uint32(MaxOutput+1))
	for _, raw := range [][]byte{
		{kindExited, 0, 0, 0, 5, 2, 0, 0, 0, 0},
		{kindExited, 0, 0, 0, 4, 0, 0, 0, 0},
		{kindEvicted, 0, 0, 0, 1, 2},
		{kindRefused, 0, 0, 0, 1, 4},
		{kindSnapshotStart, 0, 0, 0, 1, 0},
		{kindSnapshotData, 0, 0, 0, 0},
		tooMuchSnap,
		{kindSnapshotEnd, 0, 0, 0, 4, 0, 0, 0, 24},
		{kindSnapshotEnd, 0, 0, 0, 3, 0, 80, 0},
	} {
		if err := decodeServer(raw); err == nil {
			t.Errorf("invalid server frame accepted: %x", raw[:min(len(raw), 16)])
		}
	}
	if err := decodeServer([]byte{kindSnapshot, 0, 0, 0, 0}); !errors.As(err, &pe) || pe.Kind != ErrUnknownKind || pe.UnknownKind != kindSnapshot {
		t.Errorf("client snapshot kind as server: got %v", err)
	}
}
