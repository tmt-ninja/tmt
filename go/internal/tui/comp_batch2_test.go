package tui

// 1:1 mapping for Components Batch 2 (42 Rust #[test] functions):
//
// editor/tests.rs (16):
//  1. middle_edits_and_selection_never_split_graphemes                                -> TestMiddleEditsAndSelectionNeverSplitGraphemes
//  2. combining_insert_and_delete_keep_a_valid_boundary                               -> TestCombiningInsertAndDeleteKeepAValidBoundary
//  3. paste_overflow_preserves_text_selection_and_cursor                              -> TestPasteOverflowPreservesTextSelectionAndCursor
//  4. newline_wrap_spaces_and_pointer_share_source_geometry                           -> TestNewlineWrapSpacesAndPointerShareSourceGeometry
//  5. terminal_paste_line_endings_keep_exact_source_and_share_visual_newlines         -> TestTerminalPasteLineEndingsKeepExactSourceAndShareVisualNewlines
//  6. vertical_movement_keeps_column_across_short_lines_and_resize                    -> TestVerticalMovementKeepsColumnAcrossShortLinesAndResize
//  7. controls_and_bidi_are_inert_but_raw_payload_is_preserved                        -> TestControlsAndBidiAreInertButRawPayloadIsPreserved
//  8. text_selection_replace_and_application_keys_remain_separate                     -> TestTextSelectionReplaceAndApplicationKeysRemainSeparate
//  9. folded_paste_keeps_exact_source_but_bounds_collapsed_geometry                   -> TestFoldedPasteKeepsExactSourceButBoundsCollapsedGeometry
// 10. folded_ranges_follow_insertions_and_do_not_swallow_adjacent_text                -> TestFoldedRangesFollowInsertionsAndDoNotSwallowAdjacentText
// 11. isolated_combining_marks_have_a_cell_and_folds_never_split_joined_graphemes     -> TestIsolatedCombiningMarksHaveACellAndFoldsNeverSplitJoinedGraphemes
// 12. geometry_is_reused_for_paint_and_caret_but_invalidated_by_edits_and_resize      -> TestGeometryIsReusedForPaintAndCaretButInvalidatedByEditsAndResize
// 13. standard_motions_and_deletions_use_unicode_words_and_visual_lines               -> TestStandardMotionsAndDeletionsUseUnicodeWordsAndVisualLines
// 14. word_motion_keeps_combining_boundaries_and_collapsed_sources_atomic             -> TestWordMotionKeepsCombiningBoundariesAndCollapsedSourcesAtomic
// 15. release_and_unassigned_modified_keys_leave_the_editor_untouched                 -> TestReleaseAndUnassignedModifiedKeysLeaveTheEditorUntouched
// 16. relabeling_a_collapsed_range_keeps_its_source_and_resets_the_layout             -> TestRelabelingACollapsedRangeKeepsItsSourceAndResetsTheLayout
//
// completion/tests.rs (9):
// 17. completion_replaces_only_the_query_and_preserves_candidate_identity             -> TestCompletionReplacesOnlyTheQueryAndPreservesCandidateIdentity
// 18. dismiss_no_matches_and_overflow_never_change_source                             -> TestDismissNoMatchesAndOverflowNeverChangeSource
// 19. emails_and_folded_source_do_not_open_completion                                 -> TestEmailsAndFoldedSourceDoNotOpenCompletion
// 20. fuzzy_completion_ignores_separators_and_keeps_unicode_names                     -> TestFuzzyCompletionIgnoresSeparatorsAndKeepsUnicodeNames
// 21. fuzzy_completion_ranks_matches_and_keeps_inventory_order_on_ties                -> TestFuzzyCompletionRanksMatchesAndKeepsInventoryOrderOnTies
// 22. fuzzy_highlights_are_label_source_ranges_and_clear_with_the_picker              -> TestFuzzyHighlightsAreLabelSourceRangesAndClearWithThePicker
// 23. empty_query_preserves_inventory_order_without_highlights                        -> TestEmptyQueryPreservesInventoryOrderWithoutHighlights
// 24. the_caller_trigger_opens_the_picker_and_other_prefixes_do_not                   -> TestTheCallerTriggerOpensThePickerAndOtherPrefixesDoNot
// 25. grouped_matches_stay_in_inventory_groups_and_details_match_after_labels         -> TestGroupedMatchesStayInInventoryGroupsAndDetailsMatchAfterLabels
//
// picker/tests.rs (7):
// 26. query_owns_printable_keys_but_arrow_selection_confirm_and_escape_are_neutral    -> TestQueryOwnsPrintableKeysButArrowSelectionConfirmAndEscapeAreNeutral
// 27. grapheme_cursor_editing_and_bounded_paste_preserve_unicode                      -> TestGraphemeCursorEditingAndBoundedPastePreserveUnicode
// 28. selection_only_picker_q_cancels_and_empty_disabled_never_confirm                -> TestSelectionOnlyPickerQCancelsAndEmptyDisabledNeverConfirm
// 29. focus_routing_keeps_edit_keys_in_query_and_list_keys_in_list                    -> TestFocusRoutingKeepsEditKeysInQueryAndListKeysInList
// 30. query_filter_refresh_reports_new_identity_without_application_effects           -> TestQueryFilterRefreshReportsNewIdentityWithoutApplicationEffects
// 31. cursor_motion_and_rejected_edits_are_handled_before_the_modal_handler           -> TestCursorMotionAndRejectedEditsAreHandledBeforeTheModalHandler
// 32. query_uses_shared_word_editing_selection_and_unbound_modifier_routing           -> TestQueryUsesSharedWordEditingSelectionAndUnboundModifierRouting
//
// dialog/tests.rs (10):
// 33. tab_is_never_a_dialog_key_in_any_kind                                           -> TestTabIsNeverADialogKeyInAnyKind
// 34. form_moves_with_up_down_through_fields_then_the_button_row                      -> TestFormMovesWithUpDownThroughFieldsThenTheButtonRow
// 35. left_right_edit_a_field_or_move_between_enabled_buttons                         -> TestLeftRightEditAFieldOrMoveBetweenEnabledButtons
// 36. enter_chooses_the_focused_button_else_the_enabled_primary                       -> TestEnterChoosesTheFocusedButtonElseTheEnabledPrimary
// 37. esc_cancels_everywhere_and_q_cancels_outside_text_fields                        -> TestEscCancelsEverywhereAndQCancelsOutsideTextFields
// 38. lists_and_read_only_hand_rows_and_scroll_to_their_owner                         -> TestListsAndReadOnlyHandRowsAndScrollToTheirOwner
// 39. control_chords_and_releases_are_not_dialog_keys                                 -> TestControlChordsAndReleasesAreNotDialogKeys
// 40. a_press_outside_cancels_inside_presses_choose_or_focus                          -> TestAPressOutsideCancelsInsidePressesChooseOrFocus
// 41. size_follows_the_modal_rule_at_sm_md_and_lg                                     -> TestSizeFollowsTheModalRuleAtSmMdAndLg
// 42. paint_frames_the_title_and_left_aligns_buttons_with_the_cursor_focused_at_every_depth -> TestPaintFramesTheTitleAndLeftAlignsButtonsWithTheCursorFocusedAtEveryDepth

import (
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// --- editor/tests.rs ---

func edKey(t *testing.T, ed *Editor, code KeyCode, mods KeyModifiers) {
	t.Helper()
	if !ed.Key(NewKeyEvent(code, mods), 8, 1024) {
		t.Fatalf("editor.Key(%+v, %v) = false", code, mods)
	}
}

func TestMiddleEditsAndSelectionNeverSplitGraphemes(t *testing.T) {
	ed := NewEditor("Ae\u0301👩‍💻界Z")
	edKey(t, &ed, KeyCode{Kind: KeyLeft}, KeyModNone)
	edKey(t, &ed, KeyCode{Kind: KeyLeft}, KeyModShift)
	sel := ed.Selection()
	if ed.String()[sel.Start:sel.End] != "界" {
		t.Fatalf("selection = %q", ed.String()[sel.Start:sel.End])
	}
	if !ed.Insert("中文", 1024) || ed.String() != "Ae\u0301👩‍💻中文Z" {
		t.Fatalf("after insert = %q", ed.String())
	}
	edKey(t, &ed, KeyCode{Kind: KeyBackspace}, KeyModNone)
	edKey(t, &ed, KeyCode{Kind: KeyBackspace}, KeyModNone)
	edKey(t, &ed, KeyCode{Kind: KeyBackspace}, KeyModNone)
	if ed.String() != "Ae\u0301Z" {
		t.Fatalf("after 3 bs = %q", ed.String())
	}
	edKey(t, &ed, KeyCode{Kind: KeyBackspace}, KeyModNone)
	if ed.String() != "AZ" {
		t.Fatalf("after 4 bs = %q", ed.String())
	}
}

func TestCombiningInsertAndDeleteKeepAValidBoundary(t *testing.T) {
	ed := NewEditor("ab")
	edKey(t, &ed, KeyCode{Kind: KeyLeft}, KeyModNone)
	ed.Insert("\u0301", 1024)
	if ed.Cursor() != len("a\u0301") {
		t.Fatalf("cursor = %d", ed.Cursor())
	}
	edKey(t, &ed, KeyCode{Kind: KeyBackspace}, KeyModNone)
	if ed.String() != "b" {
		t.Fatalf("after bs = %q", ed.String())
	}
}

func TestPasteOverflowPreservesTextSelectionAndCursor(t *testing.T) {
	ed := NewEditor("abc")
	edKey(t, &ed, KeyCode{Kind: KeyLeft}, KeyModShift)
	before := ed.Clone()
	if ed.Insert("123456", 5) || !ed.Equal(&before) {
		t.Fatalf("overflow mutated editor")
	}
	if !ed.Insert("界", 5) || ed.String() != "ab界" {
		t.Fatalf("exact fit = %q", ed.String())
	}
}

func TestNewlineWrapSpacesAndPointerShareSourceGeometry(t *testing.T) {
	ed := NewEditor("ab 界\n\nx ")
	layout := ed.Layout(4)
	lines := *layout.Lines
	if len(lines) != 4 {
		t.Fatalf("len(lines) = %d, want 4", len(lines))
	}
	var l0 strings.Builder
	for _, c := range lines[0].Cells {
		l0.WriteString(c.Text)
	}
	if l0.String() != "ab " || lines[1].Cells[0].Text != "界" {
		t.Fatalf("line0=%q line1=%+v", l0.String(), lines[1].Cells)
	}
	ed.Place(4, 1, 0, false)
	if ed.Cursor() != 3 {
		t.Fatalf("cursor = %d, want 3", ed.Cursor())
	}
	ed.Place(4, 1, 1, true)
	sel := ed.Selection()
	if ed.String()[sel.Start:sel.End] != "界" {
		t.Fatalf("sel = %q", ed.String()[sel.Start:sel.End])
	}
}

func TestTerminalPasteLineEndingsKeepExactSourceAndShareVisualNewlines(t *testing.T) {
	for _, src := range []string{"a\nb", "a\rb", "a\r\nb"} {
		ed := NewEditor(src)
		lines := *ed.Layout(20).Lines
		if len(lines) != 2 || lines[0].Cells[0].Text != "a" || lines[1].Cells[0].Text != "b" {
			t.Fatalf("source %q lines mismatch", src)
		}
		ed.Place(20, 1, 0, false)
		if ed.String()[ed.Cursor():] != "b" || ed.String() != src {
			t.Fatalf("source %q cursor mismatch", src)
		}
	}
}

func TestVerticalMovementKeepsColumnAcrossShortLinesAndResize(t *testing.T) {
	ed := NewEditor("abcdef\nx\n123456")
	ed.Place(20, 0, 5, false)
	if !ed.Key(NewKeyEvent(KeyCode{Kind: KeyDown}, KeyModNone), 20, 1024) || ed.Cursor() != 8 {
		t.Fatalf("down1 cursor = %d", ed.Cursor())
	}
	if !ed.Key(NewKeyEvent(KeyCode{Kind: KeyDown}, KeyModNone), 20, 1024) || ed.Cursor() != 14 {
		t.Fatalf("down2 cursor = %d", ed.Cursor())
	}
	before := ed.Clone()
	for _, w := range []uint16{1, 2, 5, 80} {
		fr := ed.Layout(w)
		top := fr.Reveal(99, 2)
		if fr.Cursor[0] < top || fr.Cursor[0] >= top+2 {
			t.Fatalf("width %d cursor %v not in [%d,%d)", w, fr.Cursor, top, top+2)
		}
	}
	if !ed.Equal(&before) {
		t.Fatalf("layout mutated editor")
	}
}

func TestControlsAndBidiAreInertButRawPayloadIsPreserved(t *testing.T) {
	raw := "a\x1b]52;c;abc\x07\r\x08\u202ez"
	ed := NewEditor(raw)
	var shown strings.Builder
	for _, l := range *ed.Layout(100).Lines {
		for _, c := range l.Cells {
			shown.WriteString(c.Text)
		}
	}
	s := shown.String()
	if strings.ContainsAny(s, "\x1b\x07") || strings.ContainsRune(s, '\u202e') || ed.String() != raw {
		t.Fatalf("controls/bidi leaked: %q", s)
	}
}

func TestTextSelectionReplaceAndApplicationKeysRemainSeparate(t *testing.T) {
	ed := NewEditor("a\nb")
	edKey(t, &ed, KeyCode{Kind: KeyHome}, KeyModControl)
	edKey(t, &ed, KeyCode{Kind: KeyEnd}, KeyModControl|KeyModShift)
	ed.Insert("hello", 1024)
	if ed.String() != "hello" {
		t.Fatalf("after select-all replace = %q", ed.String())
	}
	for _, k := range []KeyCodeKind{KeyEnter, KeyEsc, KeyTab} {
		if ed.Key(NewKeyEvent(KeyCode{Kind: k}, KeyModNone), 8, 1024) {
			t.Fatalf("app key %v consumed", k)
		}
	}
}

func TestFoldedPasteKeepsExactSourceButBoundsCollapsedGeometry(t *testing.T) {
	for _, n := range []int{1024, 10 * 1024, 100 * 1024} {
		src := fmt.Sprintf("  \n%s\n\x1b[31m", strings.Repeat("x", n))
		ed := NewEditor("before ")
		if !ed.InsertFolded(src, "[paste]", 1024*1024) || ed.String() != "before "+src || len(ed.Folds()) != 1 {
			t.Fatalf("insert folded failed for %d", n)
		}
		if len(*ed.Layout(80).Lines) != 1 {
			t.Fatalf("collapsed lines != 1")
		}
		if !ed.ToggleFold() || len(*ed.Layout(80).Lines) <= 10 {
			t.Fatalf("expanded lines <= 10")
		}
		if !ed.ToggleFold() {
			t.Fatalf("re-collapse failed")
		}
		ed.Key(NewKeyEvent(KeyCode{Kind: KeyBackspace}, KeyModNone), 80, 1024*1024)
		if ed.String() != "before " || len(ed.Folds()) != 0 {
			t.Fatalf("after bs folded: %q folds=%d", ed.String(), len(ed.Folds()))
		}
	}
}

func TestFoldedRangesFollowInsertionsAndDoNotSwallowAdjacentText(t *testing.T) {
	ed := NewEditor("a")
	if !ed.InsertFolded("long\nsource", "[paste]", 100) {
		t.Fatal("InsertFolded")
	}
	ed.Insert("z", 100)
	ed.Key(NewKeyEvent(KeyCode{Kind: KeyHome}, KeyModControl), 40, 100)
	ed.Insert("start", 100)
	if ed.Folds()[0].Source != (ByteRange{Start: 6, End: 17}) {
		t.Fatalf("fold source = %+v, want {6 17}", ed.Folds()[0].Source)
	}
	ed.Key(NewKeyEvent(KeyCode{Kind: KeyRight}, KeyModNone), 40, 100)
	ed.Key(NewKeyEvent(KeyCode{Kind: KeyDelete}, KeyModNone), 40, 100)
	if ed.String() != "startaz" || len(ed.Folds()) != 0 {
		t.Fatalf("after delete = %q folds=%d", ed.String(), len(ed.Folds()))
	}
}

func TestIsolatedCombiningMarksHaveACellAndFoldsNeverSplitJoinedGraphemes(t *testing.T) {
	ed := NewEditor("\u0301")
	if ed.Layout(20).Cursor != [2]int{0, 1} {
		t.Fatalf("combining cursor = %v", ed.Layout(20).Cursor)
	}
	ed2 := NewEditor("e")
	ed2.InsertFolded("\u0301", "[source]", 100)
	if len(ed2.Folds()) != 0 {
		t.Fatalf("combining fold should be dropped")
	}
	ed2.Key(NewKeyEvent(KeyCode{Kind: KeyBackspace}, KeyModNone), 20, 100)
	if !ed2.IsEmpty() {
		t.Fatalf("not empty: %q", ed2.String())
	}
	ed2.InsertFolded("e", "[source]", 100)
	ed2.Insert("\u0301", 100)
	if len(ed2.Folds()) != 0 || ed2.String() != "e\u0301" {
		t.Fatalf("joined fold not dropped: %q folds=%d", ed2.String(), len(ed2.Folds()))
	}
}

func TestGeometryIsReusedForPaintAndCaretButInvalidatedByEditsAndResize(t *testing.T) {
	ed := NewEditor("a long editable line")
	first := ed.Layout(8)
	unpainted := ed.Clone()
	second := ed.Layout(8)
	if first.Lines != second.Lines {
		t.Fatalf("geometry not reused")
	}
	ed.Key(NewKeyEvent(KeyCode{Kind: KeyLeft}, KeyModNone), 8, 100)
	moved := ed.Layout(8)
	if first.Lines != moved.Lines || first.Cursor == moved.Cursor {
		t.Fatalf("caret move should reuse lines and move cursor")
	}
	painted := unpainted.Clone()
	painted.Layout(10)
	if !painted.Equal(&unpainted) {
		t.Fatalf("geometry changed draft equality")
	}
	painted.Insert("!", 100)
	if first.Lines == painted.Layout(8).Lines || first.Lines == ed.Layout(10).Lines {
		t.Fatalf("edit or resize did not invalidate cache")
	}
}

func TestStandardMotionsAndDeletionsUseUnicodeWordsAndVisualLines(t *testing.T) {
	type chord struct {
		code KeyCode
		mods KeyModifiers
	}
	starts := []chord{{KeyCode{Kind: KeyHome}, KeyModNone}, {CharKey('a'), KeyModControl}, {KeyCode{Kind: KeyLeft}, KeyModSuper}}
	ends := []chord{{KeyCode{Kind: KeyEnd}, KeyModNone}, {CharKey('e'), KeyModControl}, {KeyCode{Kind: KeyRight}, KeyModSuper}}
	left := []chord{{KeyCode{Kind: KeyLeft}, KeyModAlt}, {KeyCode{Kind: KeyLeft}, KeyModControl}, {CharKey('b'), KeyModAlt}}
	right := []chord{{KeyCode{Kind: KeyRight}, KeyModAlt}, {KeyCode{Kind: KeyRight}, KeyModControl}, {CharKey('f'), KeyModAlt}}
	delLeft := []chord{{KeyCode{Kind: KeyBackspace}, KeyModAlt}, {CharKey('w'), KeyModControl}}
	delRight := []chord{{KeyCode{Kind: KeyDelete}, KeyModAlt}, {CharKey('d'), KeyModAlt}}
	delStart := []chord{{CharKey('u'), KeyModControl}, {KeyCode{Kind: KeyBackspace}, KeyModSuper}}
	delEnd := []chord{{CharKey('k'), KeyModControl}}

	for _, tc := range []struct {
		text                                           string
		cursor, lineStart, lineEnd, wordStart, wordEnd int
		width                                          uint16
	}{
		{"one two!", 5, 0, 8, 4, 7, 80},
		{"你我他", 3, 0, 9, 0, 6, 80},
		{"top\none two!", 9, 4, 12, 8, 11, 80},
		{"one two! tail", 5, 4, 8, 4, 7, 4},
	} {
		for _, op := range []struct {
			aliases  []chord
			target   int
			deleting bool
		}{
			{starts, tc.lineStart, false},
			{ends, tc.lineEnd, false},
			{left, tc.wordStart, false},
			{right, tc.wordEnd, false},
			{[]chord{{KeyCode{Kind: KeyHome}, KeyModControl}}, 0, false},
			{[]chord{{KeyCode{Kind: KeyEnd}, KeyModControl}}, len(tc.text), false},
			{delLeft, tc.wordStart, true},
			{delRight, tc.wordEnd, true},
			{delStart, tc.lineStart, true},
			{delEnd, tc.lineEnd, true},
		} {
			for _, ch := range op.aliases {
				for _, shift := range []KeyModifiers{KeyModNone, KeyModShift} {
					ed := NewEditor(tc.text)
					ed.moveTo(tc.cursor, false)
					if !ed.Key(NewKeyEvent(ch.code, ch.mods|shift), tc.width, 1024) {
						t.Fatalf("key failed for %q %+v", tc.text, ch)
					}
					if op.deleting {
						want := tc.text[:min(tc.cursor, op.target)] + tc.text[max(tc.cursor, op.target):]
						if ed.String() != want {
							t.Fatalf("%q %+v got %q want %q", tc.text, ch, ed.String(), want)
						}
						ed2 := NewEditor(tc.text)
						ed2.moveTo(0, false)
						ed2.moveTo(tc.cursor, true)
						ed2.Key(NewKeyEvent(ch.code, ch.mods|shift), tc.width, 1024)
						if ed2.String() != tc.text[tc.cursor:] || !ed2.Selection().IsEmpty() {
							t.Fatalf("selection delete mismatch")
						}
					} else {
						if ed.Cursor() != op.target || ed.String() != tc.text {
							t.Fatalf("%q %+v cursor=%d want %d", tc.text, ch, ed.Cursor(), op.target)
						}
						wantSel := ByteRange{Start: op.target, End: op.target}
						if shift != KeyModNone {
							wantSel = ByteRange{Start: min(tc.cursor, op.target), End: max(tc.cursor, op.target)}
						}
						if ed.Selection() != wantSel {
							t.Fatalf("sel = %+v want %+v", ed.Selection(), wantSel)
						}
					}
				}
			}
		}
	}
}

func TestWordMotionKeepsCombiningBoundariesAndCollapsedSourcesAtomic(t *testing.T) {
	ed := NewEditor("hi, e\u0301 你我")
	var visited []int
	for ed.Cursor() > 0 {
		edKey(t, &ed, KeyCode{Kind: KeyLeft}, KeyModAlt)
		visited = append(visited, ed.Cursor())
		if boundaryAfter(ed.String(), ed.Cursor()) != ed.Cursor() {
			t.Fatalf("non-grapheme boundary %d", ed.Cursor())
		}
	}
	want := []int{len("hi, e\u0301 你"), len("hi, e\u0301 "), 4, 0}
	if !reflect.DeepEqual(visited, want) {
		t.Fatalf("visited = %v, want %v", visited, want)
	}
	ed2 := NewEditor("prefix ")
	ed2.InsertFolded("two hidden words", "paste", 1024)
	edKey(t, &ed2, KeyCode{Kind: KeyLeft}, KeyModAlt)
	if ed2.Cursor() != 7 {
		t.Fatalf("alt-left across fold = %d, want 7", ed2.Cursor())
	}
	edKey(t, &ed2, KeyCode{Kind: KeyRight}, KeyModAlt)
	if ed2.Cursor() != ed2.Len() {
		t.Fatalf("alt-right across fold = %d, want %d", ed2.Cursor(), ed2.Len())
	}
}

func TestReleaseAndUnassignedModifiedKeysLeaveTheEditorUntouched(t *testing.T) {
	ed := NewEditor("keep")
	for _, ev := range []KeyEvent{
		NewKeyEvent(CharKey('q'), KeyModAlt),
		NewKeyEvent(KeyCode{Kind: KeyLeft}, KeyModAlt|KeyModControl),
		{Code: KeyCode{Kind: KeyBackspace}, Kind: KeyRelease},
	} {
		before := ed.Clone()
		if ed.Key(ev, 80, 1024) || !ed.Equal(&before) {
			t.Fatalf("event %+v modified editor", ev)
		}
	}
}

func TestRelabelingACollapsedRangeKeepsItsSourceAndResetsTheLayout(t *testing.T) {
	ed := NewEditor("a ")
	ed.InsertFolded("/f/x.png", "x.png · 1 KB ×", 100)
	src := ed.Folds()[0].Source
	before := len((*ed.Layout(40).Lines)[0].Cells)
	if !ed.RelabelFold(src, "x.png · 10×10 · 1 KB ×") || ed.String() != "a /f/x.png" ||
		ed.Folds()[0].Label != "x.png · 10×10 · 1 KB ×" || len((*ed.Layout(40).Lines)[0].Cells) < before {
		t.Fatalf("relabel fold failed")
	}
	if ed.RelabelFold(src, "x.png · 10×10 · 1 KB ×") || ed.RelabelFold(ByteRange{0, 1}, "other") {
		t.Fatalf("unchanged or wrong-range relabel returned true")
	}
}

// --- completion/tests.rs ---

func sampleCandidates() []Candidate {
	return []Candidate{
		{ID: "agent:1", Kind: "agent", Label: "core", Insertion: "@core"},
		{ID: "squad:2", Kind: "squad", Label: "core", Insertion: "@core"},
	}
}

func namedCandidates(labels ...string) []Candidate {
	out := make([]Candidate, len(labels))
	for i, l := range labels {
		out[i] = Candidate{ID: l, Kind: "agent", Label: l, Insertion: "@" + l}
	}
	return out
}

func TestCompletionReplacesOnlyTheQueryAndPreservesCandidateIdentity(t *testing.T) {
	ed := NewEditor("hello @co")
	var comp Completion
	comp.Update(&ed, sampleCandidates(), "@")
	if !comp.Open() || len(comp.Matches) != 2 {
		t.Fatalf("comp = %+v", comp)
	}
	comp.MoveBy(1)
	comp.Update(&ed, sampleCandidates(), "@")
	if comp.Matches[comp.Selected].ID != "squad:2" {
		t.Fatalf("selected = %+v", comp.Matches[comp.Selected])
	}
	if !comp.Accept(&ed, 100) || ed.String() != "hello @core " || comp.Open() {
		t.Fatalf("after accept: %q open=%v", ed.String(), comp.Open())
	}
}

func TestDismissNoMatchesAndOverflowNeverChangeSource(t *testing.T) {
	ed := NewEditor("@unknown")
	var comp Completion
	comp.Update(&ed, sampleCandidates(), "@")
	if !comp.Open() || len(comp.Matches) != 0 || comp.Accept(&ed, 100) {
		t.Fatalf("no-match state wrong")
	}
	comp.Dismiss(&ed)
	comp.Update(&ed, sampleCandidates(), "@")
	if comp.Open() {
		t.Fatalf("reopened after dismiss")
	}
	ed = NewEditor("@c")
	comp.Update(&ed, sampleCandidates(), "@")
	if comp.Accept(&ed, 2) || ed.String() != "@c" || !comp.Open() {
		t.Fatalf("overflow mutated")
	}
}

func TestEmailsAndFoldedSourceDoNotOpenCompletion(t *testing.T) {
	for _, txt := range []string{"name@example", "word@@core", "plain"} {
		ed := NewEditor(txt)
		var comp Completion
		comp.Update(&ed, sampleCandidates(), "@")
		if comp.Open() {
			t.Fatalf("%q opened completion", txt)
		}
	}
	var ed Editor
	ed.InsertFolded("@core", "[source]", 100)
	var comp Completion
	comp.Update(&ed, sampleCandidates(), "@")
	if comp.Open() {
		t.Fatalf("folded source opened completion")
	}
}

func TestFuzzyCompletionIgnoresSeparatorsAndKeepsUnicodeNames(t *testing.T) {
	for _, tc := range [][2]string{
		{"ux1", "ux-1"}, {"rvmp", "ux-revamp"}, {"coreops", "core-ops"},
		{"nl", "night-lead"}, {"tul", "tmt-ux-lead"}, {"UX1", "ux_1"}, {"é班", "Équipe.班"},
	} {
		ed := NewEditor("hello @" + tc[0])
		var comp Completion
		comp.Update(&ed, namedCandidates(tc[1]), "@")
		if len(comp.Matches) != 1 {
			t.Fatalf("%q should match %q", tc[0], tc[1])
		}
	}
}

func TestFuzzyCompletionRanksMatchesAndKeepsInventoryOrderOnTies(t *testing.T) {
	var comp Completion
	ed := NewEditor("@abc")
	comp.Update(&ed, namedCandidates("azbzc", "xxabcxx", "alpha beta charlie", "a-b-c-tail", "abc", "axbyc", "unrelated"), "@")
	var labels []string
	for _, m := range comp.Matches {
		labels = append(labels, m.Label)
	}
	want := []string{"abc", "a-b-c-tail", "alpha beta charlie", "xxabcxx", "azbzc", "axbyc"}
	if !reflect.DeepEqual(labels, want) {
		t.Fatalf("ranked = %q, want %q", labels, want)
	}
}

func TestFuzzyHighlightsAreLabelSourceRangesAndClearWithThePicker(t *testing.T) {
	for _, tc := range [][3]string{
		{"ux1", "u-x_1", "ux1"}, {"tul", "tmt-ux-lead", "tul"},
		{"é班", "Équipe.班", "É班"}, {"i", "İpek", "İ"},
	} {
		ed := NewEditor("@" + tc[0])
		var comp Completion
		comp.Update(&ed, namedCandidates(tc[1]), "@")
		var hl strings.Builder
		for _, r := range comp.MatchedRanges(0) {
			hl.WriteString(tc[1][r.Start:r.End])
		}
		if hl.String() != tc[2] {
			t.Fatalf("highlight(%q,%q) = %q want %q", tc[0], tc[1], hl.String(), tc[2])
		}
		if !comp.Accept(&ed, 100) || ed.String() != "@"+tc[1]+" " || len(comp.MatchedRanges(0)) != 0 {
			t.Fatalf("accept/clear failed")
		}
	}
	ed := NewEditor("@ux1")
	var comp Completion
	comp.Update(&ed, namedCandidates("ux-1"), "@")
	comp.Dismiss(&ed)
	if len(comp.MatchedRanges(0)) != 0 {
		t.Fatalf("dismiss kept highlights")
	}
	plain := NewEditor("plain")
	comp.Update(&plain, namedCandidates("ux-1"), "@")
	if len(comp.MatchedRanges(0)) != 0 {
		t.Fatalf("plain kept highlights")
	}
}

func TestEmptyQueryPreservesInventoryOrderWithoutHighlights(t *testing.T) {
	var comp Completion
	ed := NewEditor("@")
	comp.Update(&ed, namedCandidates("z", "", "a"), "@")
	var labels []string
	for _, m := range comp.Matches {
		labels = append(labels, m.Label)
	}
	if !reflect.DeepEqual(labels, []string{"z", "", "a"}) {
		t.Fatalf("labels = %q", labels)
	}
	for i := 0; i < 3; i++ {
		if len(comp.MatchedRanges(i)) != 0 {
			t.Fatalf("empty query had highlights")
		}
	}
}

func TestTheCallerTriggerOpensThePickerAndOtherPrefixesDoNot(t *testing.T) {
	cands := []Candidate{{ID: "agent:1", Kind: "agent", Label: "night-lead", Insertion: "tmt/night-lead"}}
	var comp Completion
	ed := NewEditor("ask tmt/ni")
	comp.Update(&ed, cands, "tmt/")
	if !comp.Open() || !comp.Accept(&ed, math.MaxInt) || ed.String() != "ask tmt/night-lead " {
		t.Fatalf("tmt/ trigger failed")
	}
	for _, txt := range []string{"ask @ni", "see ~/.config/tmt/ni", "github.com/tmt-ninja/tmt/ni", "tmt/a/tmt/ni"} {
		e := NewEditor(txt)
		comp.Update(&e, cands, "tmt/")
		if comp.Open() {
			t.Fatalf("%q opened", txt)
		}
	}
	e := NewEditor("ask tmt/ni")
	comp.Update(&e, cands, "")
	if comp.Open() {
		t.Fatalf("empty trigger opened")
	}
}

func TestGroupedMatchesStayInInventoryGroupsAndDetailsMatchAfterLabels(t *testing.T) {
	inv := []GroupedCandidate{
		{Candidate{ID: "skill:tmt-colab", Kind: "tmt", Label: "tmt-colab", Insertion: "/tmt-colab"}, "Create and update Colab pages"},
		{Candidate{ID: "skill:tmt-ops", Kind: "tmt", Label: "tmt-ops", Insertion: "/tmt-ops"}, "Read the squad board"},
		{Candidate{ID: "skill:code-review", Kind: "user", Label: "code-review", Insertion: "/code-review"}, "Review the current diff"},
		{Candidate{ID: "skill:tmt-dev", Kind: "project", Label: "tmt-dev", Insertion: "/tmt-dev"}, "Development workflow for this repo"},
	}
	ids := func(c *Completion) []string {
		out := make([]string, len(c.Matches))
		for i, m := range c.Matches {
			out[i] = m.Label
		}
		return out
	}
	var comp Completion
	e1 := NewEditor("/")
	comp.UpdateGrouped(&e1, inv, "/")
	if !reflect.DeepEqual(ids(&comp), []string{"tmt-colab", "tmt-ops", "code-review", "tmt-dev"}) {
		t.Fatalf("empty grouped = %q", ids(&comp))
	}
	e2 := NewEditor("ask /co")
	comp.UpdateGrouped(&e2, inv, "/")
	if !reflect.DeepEqual(ids(&comp), []string{"tmt-colab", "code-review"}) {
		t.Fatalf("grouped /co = %q", ids(&comp))
	}
	e3 := NewEditor("/board")
	comp.UpdateGrouped(&e3, inv, "/")
	if !reflect.DeepEqual(ids(&comp), []string{"tmt-ops"}) || len(comp.MatchedRanges(0)) != 0 {
		t.Fatalf("detail match = %q", ids(&comp))
	}
	e4 := NewEditor("/usr/bin")
	comp.UpdateGrouped(&e4, inv, "/")
	if comp.Open() {
		t.Fatalf("/usr/bin opened")
	}
}

// --- picker/tests.rs ---

func makePickerFrame(p *Picker) ListFrame {
	rows := []ListRow{{ID: "first"}, {ID: "second"}}
	_ = p.List.Reconcile(rows)
	vp := NewRect(0, 0, 20, 5)
	p.List.Scroll.Update(vp, 2, nil)
	return ListFrame{
		Rows:     rows,
		Viewport: vp,
		Offset:   0,
		Geometry: []RowGeometry{
			{ID: "first", Lines: LineRange{0, 1}, Visible: NewRect(0, 0, 20, 1)},
			{ID: "second", Lines: LineRange{1, 2}, Visible: NewRect(0, 1, 20, 1)},
		},
	}
}

func TestQueryOwnsPrintableKeysButArrowSelectionConfirmAndEscapeAreNeutral(t *testing.T) {
	p, err := NewPicker(strPtr(""))
	if err != nil {
		t.Fatal(err)
	}
	fr := makePickerFrame(p)
	for _, ch := range []rune{'q', '?', 'j', 'k', 'g', 'G'} {
		res := p.Input(plainKey(CharKey(ch)), fr)
		if res == nil || res.Kind != PickerInputEvent || res.Event.Kind != PickerQueryChanged {
			t.Fatalf("char %q = %+v", ch, res)
		}
	}
	if q, _ := p.Query(); q != "q?jkgG" {
		t.Fatalf("query = %q", q)
	}
	if res := p.Input(plainKey(KeyCode{Kind: KeyDown}), fr); res == nil || res.Event != (PickerEvent{Kind: PickerChanged, Value: "second"}) {
		t.Fatalf("down = %+v", res)
	}
	if res := p.Input(plainKey(KeyCode{Kind: KeyEnter}), fr); res == nil || res.Event != (PickerEvent{Kind: PickerConfirm, Value: "second"}) {
		t.Fatalf("enter = %+v", res)
	}
	if res := p.Input(plainKey(KeyCode{Kind: KeyEsc}), fr); res == nil || res.Event != (PickerEvent{Kind: PickerCancel}) {
		t.Fatalf("esc = %+v", res)
	}
	if q, _ := p.Query(); q != "q?jkgG" {
		t.Fatalf("esc mutated query = %q", q)
	}
}

func TestGraphemeCursorEditingAndBoundedPastePreserveUnicode(t *testing.T) {
	p, _ := NewPicker(strPtr("a👩‍💻e\u0301"))
	fr := makePickerFrame(p)
	p.Input(plainKey(KeyCode{Kind: KeyLeft}), fr)
	if disp, _ := p.QueryDisplay(); disp != "a👩‍💻▏e\u0301" {
		t.Fatalf("disp = %q", disp)
	}
	if res := p.Input(plainKey(KeyCode{Kind: KeyBackspace}), fr); res == nil || res.Event != (PickerEvent{Kind: PickerQueryChanged, Value: "ae\u0301"}) {
		t.Fatalf("bs = %+v", res)
	}
	p.Input(plainKey(KeyCode{Kind: KeyDelete}), fr)
	if q, _ := p.Query(); q != "a" {
		t.Fatalf("after del = %q", q)
	}
	p.Input(PasteInputEvent("界"), fr)
	if q, _ := p.Query(); q != "a界" {
		t.Fatalf("after paste = %q", q)
	}
	if res := p.Input(PasteInputEvent(strings.Repeat("x", MaxQueryBytes)), fr); res == nil || res.Kind != PickerInputCaptured {
		t.Fatalf("overflow paste = %+v", res)
	}
	if _, err := NewPicker(strPtr(strings.Repeat("x", MaxQueryBytes+1))); err == nil {
		t.Fatalf("oversized initial query accepted")
	}
}

func TestSelectionOnlyPickerQCancelsAndEmptyDisabledNeverConfirm(t *testing.T) {
	p, _ := NewPicker(nil)
	fr := makePickerFrame(p)
	if res := p.Input(plainKey(CharKey('j')), fr); res == nil || res.Event != (PickerEvent{Kind: PickerChanged, Value: "second"}) {
		t.Fatalf("j = %+v", res)
	}
	if res := p.Input(plainKey(CharKey('q')), fr); res == nil || res.Event != (PickerEvent{Kind: PickerCancel}) {
		t.Fatalf("q = %+v", res)
	}
	if p.Input(PasteInputEvent("text"), fr) != nil {
		t.Fatalf("paste accepted in selection-only picker")
	}
	_ = p.List.Reconcile(nil)
	if res := p.Input(plainKey(KeyCode{Kind: KeyEnter}), fr); res == nil || res.Kind != PickerInputCaptured {
		t.Fatalf("empty enter = %+v", res)
	}
	if p.Input(KeyInputEvent(CharKey('c'), KeyModControl), fr) != nil {
		t.Fatalf("ctrl-c consumed by picker")
	}
}

func TestFocusRoutingKeepsEditKeysInQueryAndListKeysInList(t *testing.T) {
	p, _ := NewPicker(strPtr("long query with 界 cells"))
	fr := makePickerFrame(p)
	if v, _ := p.QueryVisible(1); v != "▏" {
		t.Fatalf("visible(1) = %q", v)
	}
	if v, _ := p.QueryVisible(0); v != "" {
		t.Fatalf("visible(0) = %q", v)
	}
	if v, _ := p.QueryVisible(8); !strings.HasSuffix(v, "▏") || uniseg.StringWidth(v) > 8 {
		t.Fatalf("visible(8) = %q", v)
	}
	if res := p.InputField(plainKey(CharKey('j')), fr, PickerFieldList); res == nil || res.Event != (PickerEvent{Kind: PickerChanged, Value: "second"}) {
		t.Fatalf("list j = %+v", res)
	}
	if res := p.InputField(plainKey(CharKey('q')), fr, PickerFieldList); res == nil || res.Event != (PickerEvent{Kind: PickerCancel}) {
		t.Fatalf("list q = %+v", res)
	}
	if res := p.InputField(plainKey(CharKey('q')), fr, PickerFieldQuery); res == nil || res.Event.Kind != PickerQueryChanged {
		t.Fatalf("query q = %+v", res)
	}
	stack := NewFocusStack([]ComponentID{cid("base")})
	stack.Open(cid("picker"))
	if got := Route(&stack, KeyInputEvent(CharKey('c'), KeyModControl), func(ComponentID, Event) (PickerInput, bool) {
		t.Fatalf("quit must bypass")
		return PickerInput{}, false
	}); got.Kind != RoutedQuit {
		t.Fatalf("ctrl-c = %v", got.Kind)
	}
	gotEsc := Route(&stack, plainKey(KeyCode{Kind: KeyEsc}), func(_ ComponentID, ev Event) (PickerInput, bool) {
		r := p.Input(ev, fr)
		if r == nil {
			return PickerInput{}, false
		}
		return *r, true
	})
	if gotEsc.Kind != RoutedHandled || gotEsc.Effect.Event.Kind != PickerCancel {
		t.Fatalf("esc route = %+v", gotEsc)
	}
	stack.Close()
	if !reflect.DeepEqual(stack.Focused(), cid("base")) {
		t.Fatalf("focus not restored")
	}
}

func TestQueryFilterRefreshReportsNewIdentityWithoutApplicationEffects(t *testing.T) {
	p, _ := NewPicker(strPtr(""))
	first := []ListRow{{ID: "one"}}
	if ev, err := p.Reconcile(first); err != nil || ev == nil || *ev != (PickerEvent{Kind: PickerChanged, Value: "one"}) {
		t.Fatalf("reconcile1 = %+v %v", ev, err)
	}
	if ev, err := p.Reconcile(first); err != nil || ev != nil {
		t.Fatalf("reconcile2 = %+v %v", ev, err)
	}
	if ev, err := p.Reconcile([]ListRow{{ID: "two"}}); err != nil || ev == nil || *ev != (PickerEvent{Kind: PickerChanged, Value: "two"}) {
		t.Fatalf("reconcile3 = %+v %v", ev, err)
	}
	if ev, err := p.Reconcile([]ListRow{{ID: "two", Disabled: true}}); err != nil || ev != nil || p.List.Confirm() != nil {
		t.Fatalf("reconcile disabled = %+v %v", ev, err)
	}
}

func TestCursorMotionAndRejectedEditsAreHandledBeforeTheModalHandler(t *testing.T) {
	p, _ := NewPicker(strPtr(strings.Repeat("x", MaxQueryBytes)))
	fr := makePickerFrame(p)
	stack := NewFocusStack([]ComponentID{cid("base")})
	stack.Open(cid("picker"))
	for _, code := range []KeyCode{{Kind: KeyLeft}, {Kind: KeyHome}, CharKey('j')} {
		got := Route(&stack, plainKey(code), func(id ComponentID, ev Event) (PickerInput, bool) {
			if !reflect.DeepEqual(id, cid("picker")) {
				t.Fatalf("wrong target %v", id)
			}
			r := p.InputField(ev, fr, PickerFieldQuery)
			if r == nil {
				return PickerInput{}, false
			}
			return *r, true
		})
		if got.Kind != RoutedHandled || got.Effect.Kind != PickerInputCaptured {
			t.Fatalf("code %+v got %+v", code, got)
		}
	}
}

func TestQueryUsesSharedWordEditingSelectionAndUnboundModifierRouting(t *testing.T) {
	p, _ := NewPicker(strPtr("one 你我"))
	fr := makePickerFrame(p)
	for _, ev := range []Event{KeyInputEvent(CharKey('a'), KeyModControl), KeyInputEvent(CharKey('f'), KeyModAlt)} {
		if r := p.Input(ev, fr); r == nil || r.Kind != PickerInputCaptured {
			t.Fatalf("motion = %+v", r)
		}
	}
	if d, _ := p.QueryDisplay(); d != "one▏ 你我" {
		t.Fatalf("disp = %q", d)
	}
	if r := p.Input(KeyInputEvent(KeyCode{Kind: KeyDelete}, KeyModAlt), fr); r == nil || r.Event != (PickerEvent{Kind: PickerQueryChanged, Value: "one我"}) {
		t.Fatalf("alt-del = %+v", r)
	}
	p.Input(KeyInputEvent(KeyCode{Kind: KeyEnd}, KeyModControl|KeyModShift), fr)
	if r := p.Input(PasteInputEvent("replacement"), fr); r == nil || r.Event != (PickerEvent{Kind: PickerQueryChanged, Value: "onereplacement"}) {
		t.Fatalf("paste replace = %+v", r)
	}
	if p.Input(KeyInputEvent(CharKey('z'), KeyModAlt), fr) != nil || p.Input(plainKey(KeyCode{Kind: KeyTab}), fr) != nil {
		t.Fatalf("unbound alt-z or tab consumed")
	}
}

// --- dialog/tests.rs ---

func confirmButtons() []Button {
	return []Button{SecondaryButton("Cancel"), PrimaryButton("Delete")}
}

func TestTabIsNeverADialogKeyInAnyKind(t *testing.T) {
	fields := []FieldKind{FieldText, FieldChoice}
	btns := confirmButtons()
	for _, kind := range []DialogKind{DialogConfirm, DialogForm, DialogList, DialogReadOnly} {
		st := NewDialogState(fields, btns)
		for _, k := range []KeyCodeKind{KeyTab, KeyBackTab} {
			if got := st.Key(kind, NewKeyEvent(KeyCode{Kind: k}, KeyModNone), fields, btns); got.Kind != DialogInputIgnored || st.Focus != (Focus{Kind: FocusField, Index: 0}) {
				t.Fatalf("kind=%v tab=%v got %+v", kind, k, got)
			}
		}
	}
}

func TestFormMovesWithUpDownThroughFieldsThenTheButtonRow(t *testing.T) {
	fields := []FieldKind{FieldText, FieldChoice}
	btns := confirmButtons()
	st := NewDialogState(fields, btns)
	down := func() DialogInput {
		return st.Key(DialogForm, NewKeyEvent(KeyCode{Kind: KeyDown}, KeyModNone), fields, btns)
	}
	if down().Kind != DialogInputMoved || st.Focus != (Focus{Kind: FocusField, Index: 1}) {
		t.Fatalf("down1 = %+v", st.Focus)
	}
	if down().Kind != DialogInputMoved || st.Focus != (Focus{Kind: FocusButtons, Index: 1}) {
		t.Fatalf("down2 = %+v", st.Focus)
	}
	if down().Kind != DialogInputIgnored {
		t.Fatalf("down3 should ignore")
	}
	if got := st.Key(DialogForm, NewKeyEvent(KeyCode{Kind: KeyUp}, KeyModNone), fields, btns); got.Kind != DialogInputMoved || st.Focus != (Focus{Kind: FocusField, Index: 1}) {
		t.Fatalf("up = %+v %+v", got, st.Focus)
	}
}

func TestLeftRightEditAFieldOrMoveBetweenEnabledButtons(t *testing.T) {
	fields := []FieldKind{FieldChoice}
	btns := []Button{SecondaryButton("Back"), SecondaryButton("Skip").WithEnabled(false), PrimaryButton("Save")}
	st := NewDialogState(fields, btns)
	right := NewKeyEvent(KeyCode{Kind: KeyRight}, KeyModNone)
	if got := st.Key(DialogForm, right, fields, btns); got != (DialogInput{Kind: DialogInputField, Index: 0, Key: right}) {
		t.Fatalf("right on field = %+v", got)
	}
	st.Focus = Focus{Kind: FocusButtons, Index: 2}
	left := NewKeyEvent(KeyCode{Kind: KeyLeft}, KeyModNone)
	if got := st.Key(DialogForm, left, fields, btns); got.Kind != DialogInputMoved || st.Focus != (Focus{Kind: FocusButtons, Index: 0}) {
		t.Fatalf("left skipped disabled = %+v %+v", got, st.Focus)
	}
	if got := st.Key(DialogForm, left, fields, btns); got.Kind != DialogInputIgnored {
		t.Fatalf("left at end = %+v", got)
	}
}

func TestEnterChoosesTheFocusedButtonElseTheEnabledPrimary(t *testing.T) {
	fields := []FieldKind{FieldText}
	btns := confirmButtons()
	st := NewDialogState(fields, btns)
	enter := NewKeyEvent(KeyCode{Kind: KeyEnter}, KeyModNone)
	if got := st.Key(DialogForm, enter, fields, btns); got != (DialogInput{Kind: DialogInputChoose, Index: 1}) {
		t.Fatalf("enter on field = %+v", got)
	}
	st.Focus = Focus{Kind: FocusButtons, Index: 0}
	if got := st.Key(DialogForm, enter, fields, btns); got != (DialogInput{Kind: DialogInputChoose, Index: 0}) {
		t.Fatalf("enter on btn 0 = %+v", got)
	}
	dis := []Button{SecondaryButton("Cancel"), PrimaryButton("Save").WithEnabled(false)}
	st2 := NewDialogState(fields, dis)
	if got := st2.Key(DialogForm, enter, fields, dis); got.Kind != DialogInputIgnored {
		t.Fatalf("enter on disabled primary = %+v", got)
	}
	conf := NewDialogState(nil, btns)
	if conf.Focus != (Focus{Kind: FocusButtons, Index: 1}) || conf.Key(DialogConfirm, enter, nil, btns) != (DialogInput{Kind: DialogInputChoose, Index: 1}) {
		t.Fatalf("confirm enter failed")
	}
}

func TestEscCancelsEverywhereAndQCancelsOutsideTextFields(t *testing.T) {
	fields := []FieldKind{FieldText, FieldChoice}
	btns := confirmButtons()
	for _, kind := range []DialogKind{DialogConfirm, DialogForm, DialogList, DialogReadOnly} {
		st := NewDialogState(fields, btns)
		if st.Key(kind, NewKeyEvent(KeyCode{Kind: KeyEsc}, KeyModNone), fields, btns).Kind != DialogInputCancel {
			t.Fatalf("esc failed for %v", kind)
		}
	}
	st := NewDialogState(fields, btns)
	q := NewKeyEvent(CharKey('q'), KeyModNone)
	if got := st.Key(DialogForm, q, fields, btns); got != (DialogInput{Kind: DialogInputField, Index: 0, Key: q}) {
		t.Fatalf("q in text field = %+v", got)
	}
	st.Focus = Focus{Kind: FocusField, Index: 1}
	if st.Key(DialogForm, q, fields, btns).Kind != DialogInputCancel {
		t.Fatalf("q in choice field did not cancel")
	}
	list := NewDialogState(nil, nil)
	if list.Key(DialogList, q, nil, nil).Kind != DialogInputCancel {
		t.Fatalf("q in list did not cancel")
	}
}

func TestListsAndReadOnlyHandRowsAndScrollToTheirOwner(t *testing.T) {
	st := NewDialogState(nil, nil)
	for _, code := range []KeyCode{{Kind: KeyUp}, {Kind: KeyDown}, {Kind: KeyPageDown}, {Kind: KeyHome}, CharKey('j')} {
		for _, kind := range []DialogKind{DialogList, DialogReadOnly} {
			ev := NewKeyEvent(code, KeyModNone)
			if got := st.Key(kind, ev, nil, nil); got != (DialogInput{Kind: DialogInputContent, Key: ev}) {
				t.Fatalf("kind=%v code=%+v got %+v", kind, code, got)
			}
		}
	}
	enter := NewKeyEvent(KeyCode{Kind: KeyEnter}, KeyModNone)
	if st.Key(DialogList, enter, nil, nil) != (DialogInput{Kind: DialogInputContent, Key: enter}) ||
		st.Key(DialogReadOnly, enter, nil, nil).Kind != DialogInputIgnored {
		t.Fatalf("list/readonly enter mismatch")
	}
}

func TestControlChordsAndReleasesAreNotDialogKeys(t *testing.T) {
	btns := confirmButtons()
	st := NewDialogState(nil, btns)
	if st.Key(DialogConfirm, NewKeyEvent(CharKey('c'), KeyModControl), nil, btns).Kind != DialogInputIgnored {
		t.Fatalf("ctrl-c not ignored")
	}
	if st.Key(DialogConfirm, KeyEvent{Code: KeyCode{Kind: KeyEsc}, Kind: KeyRelease}, nil, btns).Kind != DialogInputIgnored {
		t.Fatalf("release not ignored")
	}
}

func TestAPressOutsideCancelsInsidePressesChooseOrFocus(t *testing.T) {
	btns := confirmButtons()
	fields := []FieldKind{FieldText, FieldText}
	b0, b1 := NewRect(30, 13, 8, 1), NewRect(39, 13, 8, 1)
	hits := DialogHits{
		Outer:   NewRect(10, 5, 40, 10),
		Content: NewRect(12, 6, 36, 6),
		Buttons: []*Rect{&b0, &b1},
		Fields:  []Rect{NewRect(12, 6, 36, 1), NewRect(12, 8, 36, 1)},
	}
	press := func(c, r uint16) MouseEvent { return MouseEvent{Kind: MouseDown, Button: MouseLeft, Column: c, Row: r} }
	st := NewDialogState(fields, btns)
	if st.Mouse(press(0, 0), hits, btns).Kind != DialogInputCancel ||
		st.Mouse(press(9, 7), hits, btns).Kind != DialogInputCancel ||
		st.Mouse(press(20, 10), hits, btns).Kind != DialogInputIgnored ||
		st.Mouse(press(13, 8), hits, btns).Kind != DialogInputMoved ||
		st.Focus != (Focus{Kind: FocusField, Index: 1}) ||
		st.Mouse(press(31, 13), hits, btns) != (DialogInput{Kind: DialogInputChoose, Index: 0}) {
		t.Fatalf("dialog mouse routing failed")
	}
	dis := []Button{SecondaryButton("Cancel").WithEnabled(false), PrimaryButton("Delete")}
	if st.Mouse(press(31, 13), hits, dis).Kind != DialogInputIgnored {
		t.Fatalf("disabled button press accepted")
	}
	if st.Mouse(MouseEvent{Kind: MouseMoved, Column: 0, Row: 0}, hits, btns).Kind != DialogInputIgnored {
		t.Fatalf("mouse move cancelled dialog")
	}
}

func TestSizeFollowsTheModalRuleAtSmMdAndLg(t *testing.T) {
	d := Dialog{Title: "delete timer?", Kind: DialogConfirm, Placement: PlacementCenter, Buttons: confirmButtons()}
	width := func(cells uint16) uint16 {
		return d.Areas(NewRect(0, 0, cells, 40), [2]uint16{60, 8}, false).Outer.Width
	}
	if width(clistyle.SmallWidth) != clistyle.SmallWidth || width(clistyle.MediumWidth) != 60 || width(clistyle.LargeWidth) != 60 {
		t.Fatalf("modal widths mismatch")
	}
	if d.Areas(NewRect(0, 0, 120, 40), [2]uint16{200, 80}, false).Outer.Height != 32 {
		t.Fatalf("4/5 height mismatch")
	}
	if d.Areas(NewRect(0, 0, 120, 40), [2]uint16{60, 8}, false).Footer.Height != 1 {
		t.Fatalf("footer height != 1")
	}
	ro := Dialog{Title: "delete timer?", Kind: DialogReadOnly, Placement: PlacementBody}
	areas := ro.Areas(NewRect(0, 2, 120, 30), [2]uint16{10, 10}, false)
	if areas.Outer != NewRect(0, 2, 120, 30) || areas.Footer.Height != 0 {
		t.Fatalf("readonly areas mismatch")
	}
}

func TestPaintFramesTheTitleAndLeftAlignsButtonsWithTheCursorFocusedAtEveryDepth(t *testing.T) {
	d := Dialog{Title: "delete timer?", Kind: DialogConfirm, Placement: PlacementCenter, Buttons: confirmButtons()}
	for _, depth := range []clistyle.Depth{clistyle.TrueColor, clistyle.ANSI16, clistyle.NoColor} {
		theme := clistyle.Theme{Base: clistyle.ThemeDark}
		a := NewRect(0, 0, 120, 30)
		buf := EmptyBuffer(a)
		areas := d.Areas(a, [2]uint16{40, 7}, false)
		st := NewDialogState(nil, d.Buttons)
		hits := d.Paint(areas, &st, buf, DialogLook{Theme: theme, Depth: depth, Active: true})
		if hits.Outer != areas.Outer {
			t.Fatalf("hits.Outer mismatch")
		}
		footerRow := bufLine(buf, areas.Footer)
		if !strings.HasPrefix(footerRow, " Cancel   Delete ") {
			t.Fatalf("depth=%v footer=%q", depth, footerRow)
		}
		topRow := bufLine(buf, NewRect(areas.Outer.X, areas.Outer.Y, areas.Outer.Width, 1))
		if !strings.Contains(topRow, " delete timer? ") {
			t.Fatalf("top=%q", topRow)
		}
		cancel, del := hits.Buttons[0], hits.Buttons[1]
		if cancel == nil || del == nil || cancel.X != areas.Footer.X {
			t.Fatalf("button rects = %+v", hits.Buttons)
		}
		hot := ScreenChip(theme, ChipKindSecondary, ChipStateHot, depth)
		idle := ScreenChip(theme, ChipKindSecondary, ChipStateIdle, depth)
		if buf.At(del.X, del.Y).Modifier != hot.AddModifier || buf.At(cancel.X, cancel.Y).Modifier != idle.AddModifier {
			t.Fatalf("depth=%v button modifiers mismatch", depth)
		}
		hov := d.Paint(areas, &st, buf, DialogLook{Theme: theme, Depth: depth, Active: true, Hovered: cancel})
		if !reflect.DeepEqual(hov.Buttons, hits.Buttons) || buf.At(cancel.X, cancel.Y).Modifier != hot.AddModifier {
			t.Fatalf("depth=%v hover mismatch", depth)
		}
	}
}
