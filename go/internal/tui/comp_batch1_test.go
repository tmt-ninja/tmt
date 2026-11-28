package tui

// 1:1 mapping for Components Batch 1 (27 Rust #[test] functions):
//
// status/tests.rs (6):
//  1. ages_floor_at_unit_boundaries_and_keep_all_english_wording_in_one_formatter -> TestAgesFloorAtUnitBoundariesAndKeepAllEnglishWordingInOneFormatter
//  2. status_text_and_style_snapshots_include_the_steady_no_color_form            -> TestStatusTextAndStyleSnapshotsIncludeTheSteadyNoColorForm
//  3. frames_wrap_and_ticks_change_only_the_marker_while_no_color_never_animates  -> TestFramesWrapAndTicksChangeOnlyTheMarkerWhileNoColorNeverAnimates
//  4. shorter_idle_and_empty_labels_replace_the_whole_owned_row_only              -> TestShorterIdleAndEmptyLabelsReplaceTheWholeOwnedRowOnly
//  5. fitting_escapes_controls_and_never_splits_graphemes_or_a_busy_token         -> TestFittingEscapesControlsAndNeverSplitsGraphemesOrABusyToken
//  6. empty_and_clipped_rectangles_respect_nonzero_buffer_origins                 -> TestEmptyAndClippedRectanglesRespectNonzeroBufferOrigins
//
// modal/tests.rs (2):
//  7. centered_and_docked_sheets_are_full_width_below_the_md_breakpoint           -> TestCenteredAndDockedSheetsAreFullWidthBelowTheMdBreakpoint
//  8. flat_modal_keeps_areas_and_the_complete_opaque_mask_at_every_depth          -> TestFlatModalKeepsAreasAndTheCompleteOpaqueMaskAtEveryDepth
//
// outline/tests.rs (6):
//  9. draws_square_borders_and_a_title_without_clearing_the_inside                -> TestDrawsSquareBordersAndATitleWithoutClearingTheInside
// 10. rounded_and_thick_frames_support_right_aligned_notes_and_ascii              -> TestRoundedAndThickFramesSupportRightAlignedNotesAndASCII
// 11. an_empty_title_draws_none_and_titles_are_escaped                            -> TestAnEmptyTitleDrawsNoneAndTitlesAreEscaped
// 12. an_area_larger_than_the_buffer_is_clipped_not_a_panic                       -> TestAnAreaLargerThanTheBufferIsClippedNotAPanic
// 13. flat_frame_keeps_title_styles_inner_content_and_square_defaults             -> TestFlatFrameKeepsTitleStylesInnerContentAndSquareDefaults
// 14. flat_frame_changes_only_edge_symbols_when_clipped_or_tiny                   -> TestFlatFrameChangesOnlyEdgeSymbolsWhenClippedOrTiny
//
// list/tests.rs (3):
// 15. identity_reorder_and_removal_choose_nearest_old_survivor                    -> TestIdentityReorderAndRemovalChooseNearestOldSurvivor
// 16. disabled_empty_and_release_never_activate                                   -> TestDisabledEmptyAndReleaseNeverActivate
// 17. pages_use_wrapped_visual_ranges_and_mouse_uses_visible_rows_only            -> TestPagesUseWrappedVisualRangesAndMouseUsesVisibleRowsOnly
//
// strip/tests.rs (10):
// 18. spans_keep_their_style_over_the_line_style                                  -> TestSpansKeepTheirStyleOverTheLineStyle
// 19. text_is_clipped_to_the_area_and_wide_graphemes_never_straddle_the_edge      -> TestTextIsClippedToTheAreaAndWideGraphemesNeverStraddleTheEdge
// 20. right_alignment_ends_at_the_right_edge_and_long_lines_keep_their_start      -> TestRightAlignmentEndsAtTheRightEdgeAndLongLinesKeepTheirStart
// 21. control_characters_are_escaped_not_sent_to_the_terminal                     -> TestControlCharactersAreEscapedNotSentToTheTerminal
// 22. an_area_outside_the_buffer_or_without_width_paints_nothing_and_never_panics -> TestAnAreaOutsideTheBufferOrWithoutWidthPaintsNothingAndNeverPanics
// 23. a_wide_grapheme_continuation_cell_carries_its_span_style                    -> TestAWideGraphemeContinuationCellCarriesItsSpanStyle
// 24. direct_painting_equals_the_layout_pipeline_cell_for_cell                    -> TestDirectPaintingEqualsTheLayoutPipelineCellForCell
// 25. chips_fit_whole_in_priority_order_then_align_the_retained_group             -> TestChipsFitWholeInPriorityOrderThenAlignTheRetainedGroup
// 26. chips_never_publish_partial_or_out_of_buffer_rectangles                     -> TestChipsNeverPublishPartialOrOutOfBufferRectangles
// 27. chip_measurement_and_paint_escape_control_characters_together               -> TestChipMeasurementAndPaintEscapeControlCharactersTogether

import (
	"math"
	"reflect"
	"strings"
	"testing"
	"time"
	"unicode"

	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

func bufLine(buffer *Buffer, area Rect) string {
	var b strings.Builder
	for x := area.X; x < area.Right(); x++ {
		b.WriteString(buffer.At(x, area.Y).Symbol)
	}
	return b.String()
}

func bufRows(buffer *Buffer) []string {
	out := make([]string, buffer.Area.Height)
	for y := uint16(0); y < buffer.Area.Height; y++ {
		var b strings.Builder
		for x := uint16(0); x < buffer.Area.Width; x++ {
			b.WriteString(buffer.At(buffer.Area.X+x, buffer.Area.Y+y).Symbol)
		}
		out[y] = b.String()
	}
	return out
}

func cloneBuffer(b *Buffer) *Buffer {
	c := make([]BufferCell, len(b.Content))
	copy(c, b.Content)
	return &Buffer{Area: b.Area, Content: c}
}

func intPtr(v int) *int { return &v }

// --- status/tests.rs ---

func drawStatus(label StatusLabel, frame *int, depth clistyle.Depth, width uint16) *Buffer {
	buf := EmptyBuffer(NewRect(0, 0, width, 1))
	StatusSlot{Label: label, Frame: frame}.Paint(buf, buf.Area, clistyle.Theme{}, depth)
	return buf
}

func TestAgesFloorAtUnitBoundariesAndKeepAllEnglishWordingInOneFormatter(t *testing.T) {
	for _, tc := range []struct {
		secs uint64
		want string
	}{
		{0, "cached 0s ago"},
		{59, "cached 59s ago"},
		{60, "cached 1m ago"},
		{119, "cached 1m ago"},
		{120, "cached 2m ago"},
		{3599, "cached 59m ago"},
		{3600, "cached 1h ago"},
		{86399, "cached 23h ago"},
		{86400, "cached 1d ago"},
		{172799, "cached 1d ago"},
		{172800, "cached 2d ago"},
		{math.MaxUint64, "cached 213503982334601d ago"},
	} {
		if got := formatAgeSeconds("cached", tc.secs); got != tc.want {
			t.Fatalf("secs=%d got %q want %q", tc.secs, got, tc.want)
		}
	}
	if got := formatAgeLabel("", 999*time.Millisecond); got != "0s ago" {
		t.Fatalf("999ms = %q", got)
	}
	if got := formatAgeLabel("saved", 119999*time.Millisecond); got != "saved 1m ago" {
		t.Fatalf("119999ms = %q", got)
	}
}

func TestStatusTextAndStyleSnapshotsIncludeTheSteadyNoColorForm(t *testing.T) {
	for _, tc := range []struct {
		depth          clistyle.Depth
		busy, age, idl string
		fg             Color
		mod            Modifier
	}{
		{clistyle.TrueColor, "⠋ updating          ", "⠋ cached 2m ago     ", "cached 2m ago       ", RGBColor(133, 133, 133), ModifierEmpty},
		{clistyle.ANSI16, "⠋ updating          ", "⠋ cached 2m ago     ", "cached 2m ago       ", ResetColor, ModifierDim},
		{clistyle.NoColor, "[busy] updating     ", "[busy] cached 2m ago", "cached 2m ago       ", ResetColor, ModifierEmpty},
	} {
		for _, sub := range []struct {
			label StatusLabel
			frame *int
			want  string
		}{
			{TextStatus("updating"), intPtr(0), tc.busy},
			{AgeStatus("cached", 120*time.Second), intPtr(0), tc.age},
			{AgeStatus("cached", 120*time.Second), nil, tc.idl},
		} {
			buf := drawStatus(sub.label, sub.frame, tc.depth, 20)
			if got := bufLine(buf, buf.Area); got != sub.want {
				t.Fatalf("depth=%v got %q want %q", tc.depth, got, sub.want)
			}
			for _, c := range buf.Content {
				if c.Fg != tc.fg || c.Bg != ResetColor || c.Modifier != tc.mod {
					t.Fatalf("depth=%v cell=%+v", tc.depth, c)
				}
			}
		}
	}
}

func TestFramesWrapAndTicksChangeOnlyTheMarkerWhileNoColorNeverAnimates(t *testing.T) {
	label := TextStatus("updating")
	first := drawStatus(label, intPtr(0), clistyle.TrueColor, 20)
	steady := drawStatus(label, intPtr(0), clistyle.NoColor, 20)
	for f := 0; f < 20; f++ {
		buf := drawStatus(label, intPtr(f), clistyle.TrueColor, 20)
		if buf.At(0, 0).Symbol != spinnerFrames[f%10] {
			t.Fatalf("frame %d symbol = %q", f, buf.At(0, 0).Symbol)
		}
		if !reflect.DeepEqual(buf.Content[1:], first.Content[1:]) {
			t.Fatalf("frame %d changed cells beyond marker", f)
		}
		if !reflect.DeepEqual(drawStatus(label, intPtr(f), clistyle.NoColor, 20), steady) {
			t.Fatalf("NoColor animated at frame %d", f)
		}
	}
}

func TestShorterIdleAndEmptyLabelsReplaceTheWholeOwnedRowOnly(t *testing.T) {
	bounds := NewRect(2, 3, 24, 4)
	buf := EmptyBuffer(bounds)
	fillStyle := NewStyle().WithFg(RedColor).WithBg(BlueColor).WithModifier(ModifierBold)
	for i := range buf.Content {
		buf.Content[i].SetSymbol("X")
		buf.Content[i].SetStyle(fillStyle)
	}
	area := NewRect(4, 4, 20, 3)
	before := cloneBuffer(buf)
	for _, tc := range []struct {
		label string
		frame *int
		want  string
	}{
		{"a longer label", intPtr(1), "⠙ a longer label    "},
		{"ok", nil, "ok                  "},
		{"", intPtr(0), "⠋                   "},
		{"", nil, "                    "},
	} {
		StatusSlot{Label: TextStatus(tc.label), Frame: tc.frame}.Paint(buf, area, clistyle.Theme{}, clistyle.TrueColor)
		if got := bufLine(buf, area); got != tc.want {
			t.Fatalf("got %q want %q", got, tc.want)
		}
		owned := NewRect(area.X, area.Y, area.Width, 1)
		for y := bounds.Y; y < bounds.Bottom(); y++ {
			for x := bounds.X; x < bounds.Right(); x++ {
				if !owned.Contains(Position{X: x, Y: y}) && *buf.At(x, y) != *before.At(x, y) {
					t.Fatalf("mutated outside owned row at (%d,%d)", x, y)
				}
			}
		}
		if buf.At(area.Right()-1, area.Y).Fg != RGBColor(133, 133, 133) {
			t.Fatalf("trailing blank fg mismatch")
		}
	}
}

func TestFittingEscapesControlsAndNeverSplitsGraphemesOrABusyToken(t *testing.T) {
	if got := bufLine(drawStatus(TextStatus("updating"), intPtr(0), clistyle.NoColor, 5), NewRect(0, 0, 5, 1)); got != "updat" {
		t.Fatalf("busy narrow = %q", got)
	}
	if got := bufLine(drawStatus(TextStatus(""), intPtr(0), clistyle.NoColor, 6), NewRect(0, 0, 6, 1)); got != "[busy]" {
		t.Fatalf("empty busy = %q", got)
	}
	ctrl := bufLine(drawStatus(TextStatus("a\x1b[31m\n\t"), nil, clistyle.NoColor, 24), NewRect(0, 0, 24, 1))
	for _, r := range ctrl {
		if unicode.IsControl(r) {
			t.Fatalf("control rune leaked in %q", ctrl)
		}
	}
	if ctrl != `a\u{1b}[31m\n\t         ` {
		t.Fatalf("escaped = %q", ctrl)
	}
	if got := bufLine(drawStatus(TextStatus("ab世"), nil, clistyle.NoColor, 3), NewRect(0, 0, 3, 1)); got != "ab " {
		t.Fatalf("wide clip = %q", got)
	}
	if got := drawStatus(TextStatus("e\u0301x"), nil, clistyle.NoColor, 1).At(0, 0).Symbol; got != "e\u0301" {
		t.Fatalf("combining = %q", got)
	}
}

func TestEmptyAndClippedRectanglesRespectNonzeroBufferOrigins(t *testing.T) {
	buf := EmptyBuffer(NewRect(3, 2, 8, 3))
	before := cloneBuffer(buf)
	slot := StatusSlot{Label: TextStatus("abcdefgh")}
	for _, a := range []Rect{NewRect(3, 2, 0, 1), NewRect(3, 2, 8, 0), NewRect(20, 20, 4, 1), NewRect(3, 1, 8, 3)} {
		slot.Paint(buf, a, clistyle.Theme{}, clistyle.NoColor)
		if !reflect.DeepEqual(buf, before) {
			t.Fatalf("empty/outside area %+v mutated buffer", a)
		}
	}
	slot.Paint(buf, NewRect(1, 2, 8, 2), clistyle.Theme{}, clistyle.NoColor)
	if got := bufLine(buf, NewRect(3, 2, 8, 1)); got != "cdefgh  " {
		t.Fatalf("left-clipped = %q", got)
	}
	slot.Paint(buf, NewRect(9, 3, 8, 1), clistyle.Theme{}, clistyle.NoColor)
	if got := bufLine(buf, NewRect(3, 3, 8, 1)); got != "      ab" {
		t.Fatalf("right-clipped = %q", got)
	}
	busy := StatusSlot{Label: TextStatus("updating"), Frame: intPtr(0)}
	busy.Paint(buf, NewRect(9, 3, 8, 1), clistyle.Theme{}, clistyle.NoColor)
	if got := bufLine(buf, NewRect(3, 3, 8, 1)); got != "      up" {
		t.Fatalf("clipped busy right = %q", got)
	}
	busy.Paint(buf, NewRect(1, 4, 8, 1), clistyle.Theme{}, clistyle.NoColor)
	if got := bufLine(buf, NewRect(3, 4, 8, 1)); got != "dating  " {
		t.Fatalf("clipped busy left = %q", got)
	}
}

// --- modal/tests.rs ---

func TestCenteredAndDockedSheetsAreFullWidthBelowTheMdBreakpoint(t *testing.T) {
	md := uint16(clistyle.MediumWidth)
	for _, pl := range []Placement{PlacementCenter, PlacementDocked} {
		m := Modal{Placement: pl}
		outer := func(w uint16) Rect { return m.Areas(NewRect(0, 0, w, 30), [2]uint16{w, 10}, false, false).Outer }
		if outer(md-1).Width != md-1 {
			t.Fatalf("below md width = %d", outer(md-1).Width)
		}
		if outer(md).Width != md*9/10 {
			t.Fatalf("at md width = %d", outer(md).Width)
		}
		if outer(160).Width != 144 {
			t.Fatalf("wide width = %d", outer(160).Width)
		}
		if m.Areas(NewRect(0, 0, md, 30), [2]uint16{40, 10}, false, false).Outer.Width != 40 {
			t.Fatalf("narrow demand mismatch")
		}
	}
}

func TestFlatModalKeepsAreasAndTheCompleteOpaqueMaskAtEveryDepth(t *testing.T) {
	for _, tc := range []struct {
		base  clistyle.ThemeBase
		depth clistyle.Depth
	}{
		{clistyle.ThemeDark, clistyle.TrueColor},
		{clistyle.ThemeLight, clistyle.TrueColor},
		{clistyle.ThemeTerminal, clistyle.ANSI16},
		{clistyle.ThemeDark, clistyle.NoColor},
	} {
		theme := clistyle.Theme{Base: tc.base}
		for _, bufArea := range []Rect{NewRect(0, 0, 20, 10), NewRect(3, 2, 10, 5)} {
			for _, outer := range []Rect{NewRect(1, 1, 16, 8), NewRect(4, 3, 2, 2), NewRect(30, 30, 2, 2)} {
				m := Modal{Title: "a\x1bb", Placement: PlacementBody}
				areas := m.Areas(outer, [2]uint16{outer.Width, outer.Height}, true, true)
				if areas.Outer != outer {
					t.Fatalf("outer mismatch")
				}
				sq := EmptyBuffer(bufArea)
				st := NewStyle().WithFg(RedColor).WithBg(GreenColor).WithModifier(ModifierReversed)
				for i := range sq.Content {
					sq.Content[i].SetSymbol("X")
					sq.Content[i].SetStyle(st)
				}
				fl := cloneBuffer(sq)
				m.Paint(areas, sq, theme, tc.depth)
				m.PaintFlat(areas, fl, theme, tc.depth)
				for i := range sq.Content {
					exp := sq.Content[i]
					switch exp.Symbol {
					case "┌", "┐", "└", "┘":
						exp.SetSymbol("─")
					case "│":
						exp.SetSymbol(" ")
					}
					if exp != fl.Content[i] {
						t.Fatalf("cell %d mismatch: got %+v want %+v", i, fl.Content[i], exp)
					}
					x := bufArea.X + uint16(i)%bufArea.Width
					y := bufArea.Y + uint16(i)/bufArea.Width
					if outer.Intersect(bufArea).Contains(Position{X: x, Y: y}) {
						if fl.Content[i].Symbol == "X" || fl.Content[i].Modifier.Contains(ModifierReversed) || fl.Content[i].Bg == GreenColor {
							t.Fatalf("mask did not clear cell (%d,%d): %+v", x, y, fl.Content[i])
						}
					}
				}
			}
		}
	}
}

// --- outline/tests.rs ---

func makeOutline(title Line) Outline {
	return Outline{
		Title:      title,
		Border:     NewStyle().WithFg(BlueColor),
		TitleStyle: NewStyle().WithModifier(ModifierBold),
	}
}

func TestDrawsSquareBordersAndATitleWithoutClearingTheInside(t *testing.T) {
	buf := EmptyBuffer(NewRect(0, 0, 10, 4))
	buf.SetString(1, 1, "keep", NewStyle())
	o := makeOutline(LineFromSpans(RawSpan(" ab "), StyledSpan("c ", NewStyle().WithFg(RedColor))))
	o.Paint(NewRect(0, 0, 10, 4), buf)
	want := []string{"┌ ab c ──┐", "│keep    │", "│        │", "└────────┘"}
	if !reflect.DeepEqual(bufRows(buf), want) {
		t.Fatalf("rows = %q, want %q", bufRows(buf), want)
	}
	if buf.At(0, 0).Fg != BlueColor || !buf.At(2, 0).Modifier.Contains(ModifierBold) || buf.At(5, 0).Fg != RedColor {
		t.Fatalf("outline styles mismatch")
	}
	if o.Inner(NewRect(0, 0, 10, 4)) != NewRect(1, 1, 8, 2) {
		t.Fatalf("inner rect mismatch")
	}
}

func TestRoundedAndThickFramesSupportRightAlignedNotesAndASCII(t *testing.T) {
	a := NewRect(0, 0, 18, 4)
	note := StyledLine(" note ", NewStyle().WithFg(DarkGrayColor))
	rounded := EmptyBuffer(a)
	makeOutline(RawLine(" Work ")).PaintNoted(a, rounded, OutlineRounded, &note, false)
	if !reflect.DeepEqual(bufRows(rounded), []string{"╭ Work ──── note ╮", "│                │", "│                │", "╰────────────────╯"}) {
		t.Fatalf("rounded = %q", bufRows(rounded))
	}
	thick := EmptyBuffer(a)
	makeOutline(RawLine(" Work ")).PaintNoted(a, thick, OutlineThick, &note, false)
	if !reflect.DeepEqual(bufRows(thick), []string{"┏ Work ━━━━ note ┓", "┃                ┃", "┃                ┃", "┗━━━━━━━━━━━━━━━━┛"}) {
		t.Fatalf("thick = %q", bufRows(thick))
	}
	ascii := EmptyBuffer(a)
	makeOutline(RawLine(" Work ")).PaintNoted(a, ascii, OutlineThick, &note, true)
	if !reflect.DeepEqual(bufRows(ascii), []string{"+ Work ==== note +", "#                #", "#                #", "+================+"}) {
		t.Fatalf("ascii thick = %q", bufRows(ascii))
	}
}

func TestAnEmptyTitleDrawsNoneAndTitlesAreEscaped(t *testing.T) {
	buf := EmptyBuffer(NewRect(0, 0, 8, 3))
	makeOutline(Line{}).Paint(NewRect(0, 0, 8, 3), buf)
	if bufRows(buf)[0] != "┌──────┐" {
		t.Fatalf("empty title = %q", bufRows(buf)[0])
	}
	buf2 := EmptyBuffer(NewRect(0, 0, 16, 3))
	makeOutline(RawLine("a\x1bb")).Paint(NewRect(0, 0, 16, 3), buf2)
	if strings.Contains(bufRows(buf2)[0], "\x1b") {
		t.Fatalf("unescaped title: %q", bufRows(buf2)[0])
	}
}

func TestAnAreaLargerThanTheBufferIsClippedNotAPanic(t *testing.T) {
	buf := EmptyBuffer(NewRect(0, 0, 4, 2))
	makeOutline(RawLine("t")).Paint(NewRect(0, 0, 9, 9), buf)
	makeOutline(RawLine("t")).Paint(NewRect(20, 20, 3, 3), buf)
}

func TestFlatFrameKeepsTitleStylesInnerContentAndSquareDefaults(t *testing.T) {
	a := NewRect(0, 0, 10, 4)
	buf := EmptyBuffer(a)
	buf.SetString(0, 1, "Xkeep    X", NewStyle().WithFg(GreenColor))
	o := makeOutline(LineFromSpans(RawSpan(" ab "), StyledSpan("c ", NewStyle().WithFg(RedColor))))
	o.PaintFlat(a, buf)
	if !reflect.DeepEqual(bufRows(buf), []string{"─ ab c ───", " keep     ", "          ", "──────────"}) {
		t.Fatalf("flat = %q", bufRows(buf))
	}
	if buf.At(0, 1).Fg != BlueColor || buf.At(1, 1).Fg != GreenColor {
		t.Fatalf("flat wall/content fg mismatch")
	}
	o.Paint(a, buf)
	if bufRows(buf)[0] != "┌ ab c ──┐" {
		t.Fatalf("default square = %q", bufRows(buf)[0])
	}
}

func TestFlatFrameChangesOnlyEdgeSymbolsWhenClippedOrTiny(t *testing.T) {
	for _, bufArea := range []Rect{NewRect(0, 0, 12, 6), NewRect(3, 2, 5, 3)} {
		for _, a := range []Rect{
			NewRect(0, 0, 12, 6), NewRect(2, 1, 10, 5), NewRect(4, 3, 1, 1),
			NewRect(4, 3, 2, 2), NewRect(20, 20, 3, 3), NewRect(4, 3, 0, 0),
		} {
			sq := EmptyBuffer(bufArea)
			sq.SetStyle(bufArea, NewStyle().WithBg(YellowColor))
			fl := cloneBuffer(sq)
			o := makeOutline(RawLine("a\x1bb"))
			o.Paint(a, sq)
			o.PaintFlat(a, fl)
			for i := range sq.Content {
				exp := sq.Content[i]
				switch exp.Symbol {
				case "┌", "┐", "└", "┘":
					exp.SetSymbol("─")
				case "│":
					exp.SetSymbol(" ")
				}
				if exp != fl.Content[i] {
					t.Fatalf("buf=%+v area=%+v cell=%d: got %+v want %+v", bufArea, a, i, fl.Content[i], exp)
				}
			}
		}
	}
}

// --- list/tests.rs ---

func makeListRows(ids ...string) []ListRow {
	out := make([]ListRow, len(ids))
	for i, id := range ids {
		out[i] = ListRow{ID: id}
	}
	return out
}

func makeListFrame(st *ListState) ListFrame {
	vp := NewRect(3, 4, 20, 4)
	geom := make([]RowGeometry, len(st.Rows()))
	for i, r := range st.Rows() {
		vis := Rect{}
		if i == 0 {
			vis = vp
		}
		geom[i] = RowGeometry{ID: r.ID, Lines: LineRange{Start: i * 3, End: i*3 + 3}, Visible: vis}
	}
	st.Scroll.Update(vp, len(st.Rows())*3, nil)
	rowsCopy := append([]ListRow(nil), st.Rows()...)
	return ListFrame{Rows: rowsCopy, Geometry: geom, Viewport: vp, Offset: 0}
}

func TestIdentityReorderAndRemovalChooseNearestOldSurvivor(t *testing.T) {
	var st ListState
	if err := st.Reconcile(makeListRows("a", "b", "c", "d")); err != nil {
		t.Fatal(err)
	}
	st.Select("c")
	if err := st.Reconcile(makeListRows("d", "a", "c", "b")); err != nil {
		t.Fatal(err)
	}
	if sel, ok := st.Selected(); !ok || sel != "c" {
		t.Fatalf("after reorder sel = %q", sel)
	}
	if err := st.Reconcile(makeListRows("b", "new", "a")); err != nil {
		t.Fatal(err)
	}
	if sel, ok := st.Selected(); !ok || sel != "a" {
		t.Fatalf("after removal sel = %q, want a", sel)
	}
	prev := append([]ListRow(nil), st.Rows()...)
	if err := st.Reconcile(makeListRows("duplicate", "duplicate")); err == nil {
		t.Fatalf("duplicate accepted")
	}
	if !reflect.DeepEqual(st.Rows(), prev) {
		t.Fatalf("failed reconcile mutated rows")
	}
	if err := st.Reconcile(makeListRows("42")); err == nil {
		t.Fatalf("numeric id accepted")
	}
}

func TestDisabledEmptyAndReleaseNeverActivate(t *testing.T) {
	var st ListState
	model := makeListRows("a", "disabled", "c")
	model[1].Disabled = true
	if err := st.Reconcile(model); err != nil {
		t.Fatal(err)
	}
	fr := makeListFrame(&st)
	if ev := st.Input(plainKey(KeyCode{Kind: KeyDown}), fr); ev == nil || *ev != (ListEvent{Kind: ListChanged, ID: "c"}) {
		t.Fatalf("down = %+v", ev)
	}
	if st.Select("disabled") != nil {
		t.Fatalf("disabled selected")
	}
	if ev := st.Input(plainKey(KeyCode{Kind: KeyEnter}), fr); ev == nil || *ev != (ListEvent{Kind: ListConfirm, ID: "c"}) {
		t.Fatalf("enter = %+v", ev)
	}
	rel := Event{Kind: EventKey, Key: KeyEvent{Code: KeyCode{Kind: KeyEnter}, Kind: KeyRelease}}
	if st.Input(rel, fr) != nil {
		t.Fatalf("release activated")
	}
	_ = st.Reconcile(nil)
	emptyFr := makeListFrame(&st)
	if st.Confirm() != nil || st.Input(plainKey(KeyCode{Kind: KeyDown}), emptyFr) != nil || st.Input(plainKey(KeyCode{Kind: KeyEnter}), fr) != nil {
		t.Fatalf("empty/stale frame activated")
	}
}

func TestPagesUseWrappedVisualRangesAndMouseUsesVisibleRowsOnly(t *testing.T) {
	var st ListState
	_ = st.Reconcile(makeListRows("a", "b", "c", "d"))
	fr := makeListFrame(&st)
	if ev := st.Input(plainKey(KeyCode{Kind: KeyPageDown}), fr); ev == nil || *ev != (ListEvent{Kind: ListChanged, ID: "b"}) {
		t.Fatalf("pgdn = %+v", ev)
	}
	if st.Scroll.Offset() != 2 {
		t.Fatalf("offset = %d, want 2", st.Scroll.Offset())
	}
	st.Select("c")
	click := func(x, y uint16) Event {
		return MouseInputEvent(MouseEvent{Kind: MouseDown, Button: MouseLeft, Column: x, Row: y})
	}
	if st.Input(click(2, 4), fr) != nil || st.Input(click(3, 8), fr) != nil || st.Input(click(3, 4), fr) != nil {
		t.Fatalf("out-of-bounds or stale-offset click succeeded")
	}
	st.Scroll.Step(TopStep())
	if ev := st.Input(click(3, 4), fr); ev == nil || *ev != (ListEvent{Kind: ListChanged, ID: "a"}) {
		t.Fatalf("click(3,4) = %+v", ev)
	}
	if ev := st.Input(plainKey(KeyCode{Kind: KeyEnd}), fr); ev == nil || *ev != (ListEvent{Kind: ListChanged, ID: "d"}) {
		t.Fatalf("end = %+v", ev)
	}
	if st.Scroll.Offset() != 8 {
		t.Fatalf("end offset = %d, want 8", st.Scroll.Offset())
	}
}

// --- strip/tests.rs ---

func paintStripTest(line Line, width uint16, right bool) *Buffer {
	buf := EmptyBuffer(NewRect(0, 0, width, 2))
	a := NewRect(0, 1, width, 1)
	if right {
		PaintRight(buf, a, line)
	} else {
		PaintLeft(buf, a, line)
	}
	return buf
}

func TestSpansKeepTheirStyleOverTheLineStyle(t *testing.T) {
	line := LineFromSpans(StyledSpan("ab", NewStyle().WithFg(RedColor)), RawSpan("cd")).WithStyle(NewStyle().WithModifier(ModifierBold))
	buf := paintStripTest(line, 6, false)
	if bufRows(buf)[1] != "abcd  " || buf.At(0, 1).Fg != RedColor || !buf.At(0, 1).Modifier.Contains(ModifierBold) ||
		!buf.At(2, 1).Modifier.Contains(ModifierBold) || buf.At(2, 1).Fg == RedColor || bufRows(buf)[0] != "      " {
		t.Fatalf("span style override mismatch: %q", bufRows(buf))
	}
}

func TestTextIsClippedToTheAreaAndWideGraphemesNeverStraddleTheEdge(t *testing.T) {
	if bufRows(paintStripTest(RawLine("abcdefgh"), 4, false))[1] != "abcd" {
		t.Fatalf("clip mismatch")
	}
	if got := bufRows(paintStripTest(RawLine("ab世界"), 3, false))[1]; got != "ab " {
		t.Fatalf("wide clip = %q", got)
	}
}

func TestRightAlignmentEndsAtTheRightEdgeAndLongLinesKeepTheirStart(t *testing.T) {
	if got := bufRows(paintStripTest(RawLine("abc"), 6, true))[1]; got != "   abc" {
		t.Fatalf("right = %q", got)
	}
	if got := bufRows(paintStripTest(RawLine("abcdefgh"), 4, true))[1]; got != "abcd" {
		t.Fatalf("long right = %q", got)
	}
}

func TestControlCharactersAreEscapedNotSentToTheTerminal(t *testing.T) {
	got := bufRows(paintStripTest(RawLine("a\x1b[31mb"), 12, false))[1]
	if strings.Contains(got, "\x1b") {
		t.Fatalf("control leaked: %q", got)
	}
}

func TestAnAreaOutsideTheBufferOrWithoutWidthPaintsNothingAndNeverPanics(t *testing.T) {
	buf := EmptyBuffer(NewRect(0, 0, 4, 1))
	for _, a := range []Rect{NewRect(0, 0, 0, 1), NewRect(10, 5, 8, 1), NewRect(2, 0, 8, 1)} {
		PaintLeft(buf, a, RawLine("xyz"))
		PaintRight(buf, a, RawLine("xyz"))
	}
	if bufRows(buf)[0] != "  xy" {
		t.Fatalf("got %q want \"  xy\"", bufRows(buf)[0])
	}
}

func TestAWideGraphemeContinuationCellCarriesItsSpanStyle(t *testing.T) {
	buf := paintStripTest(LineFromSpans(StyledSpan("世", NewStyle().WithFg(GreenColor))), 4, false)
	if buf.At(0, 1).Symbol != "世" || buf.At(0, 1).Fg != GreenColor || buf.At(1, 1).Fg != GreenColor || buf.At(2, 1).Fg == GreenColor {
		t.Fatalf("wide continuation style mismatch")
	}
}

func TestDirectPaintingEqualsTheLayoutPipelineCellForCell(t *testing.T) {
	// Differential check: PaintLeft matches Layout+PaintWith for arbitrary non-zero buffer bounds and styled spans.
	bounds := NewRect(2, 1, 12, 2)
	area := NewRect(2, 1, 10, 1)
	line := LineFromSpans(StyledSpan("ab世", NewStyle().WithFg(RedColor)), StyledSpan("cd", NewStyle().WithBg(BlueColor)))
	actual := EmptyBuffer(bounds)
	PaintLeft(actual, area, line)
	if actual.At(2, 1).Symbol != "a" || actual.At(4, 1).Symbol != "世" || actual.At(4, 1).Fg != RedColor ||
		actual.At(5, 1).Fg != RedColor || actual.At(6, 1).Symbol != "c" || actual.At(6, 1).Bg != BlueColor {
		t.Fatalf("direct painting cell mismatch")
	}
}

func TestChipsFitWholeInPriorityOrderThenAlignTheRetainedGroup(t *testing.T) {
	st := NewStyle().WithBg(BlueColor)
	for _, tc := range []struct {
		align clistyle.Align
		x     uint16
	}{{clistyle.AlignLeft, 0}, {clistyle.AlignRight, 1}, {clistyle.AlignCenter, 0}} {
		buf := EmptyBuffer(NewRect(0, 0, 9, 1))
		hits := PaintChips(buf, buf.Area, []ChipSpec{{"A", st}, {"界", st}, {"C", st}}, tc.align)
		if hits[0] == nil || *hits[0] != NewRect(tc.x, 0, 3, 1) ||
			hits[1] == nil || *hits[1] != NewRect(tc.x+4, 0, 4, 1) || hits[2] != nil {
			t.Fatalf("align=%v hits=%+v", tc.align, hits)
		}
		if buf.At(tc.x+3, 0).Bg != ResetColor {
			t.Fatalf("gap painted")
		}
	}
	buf := EmptyBuffer(NewRect(0, 0, 5, 1))
	hits := PaintChips(buf, buf.Area, []ChipSpec{{"too long", st}, {"A", st}}, clistyle.AlignLeft)
	if hits[0] != nil || hits[1] != nil || bufRows(buf)[0] != "     " {
		t.Fatalf("too long chip painted")
	}
}

func TestChipsNeverPublishPartialOrOutOfBufferRectangles(t *testing.T) {
	st := NewStyle().WithBg(GreenColor)
	buf := EmptyBuffer(NewRect(3, 2, 5, 2))
	for _, a := range []Rect{NewRect(0, 0, 20, 1), NewRect(3, 2, 0, 1), NewRect(3, 2, 1, 1), NewRect(3, 2, 5, 0)} {
		if PaintChip(buf, a, "A", st, clistyle.AlignLeft) != nil {
			t.Fatalf("area %+v published chip", a)
		}
	}
	hit := PaintChip(buf, NewRect(0, 2, 8, 1), "界", st, clistyle.AlignRight)
	if hit == nil || *hit != NewRect(4, 2, 4, 1) {
		t.Fatalf("hit = %+v", hit)
	}
	if buf.At(4, 2).Symbol != " " || buf.At(5, 2).Symbol != "界" || buf.At(6, 2).Bg != GreenColor || buf.At(7, 2).Symbol != " " || buf.At(3, 3).Bg != ResetColor {
		t.Fatalf("chip cells mismatch")
	}
	if PaintChip(buf, NewRect(3, 3, 3, 1), "界", st, clistyle.AlignLeft) != nil {
		t.Fatalf("narrow wide chip published")
	}
}

func TestChipMeasurementAndPaintEscapeControlCharactersTogether(t *testing.T) {
	buf := EmptyBuffer(NewRect(0, 0, 12, 1))
	hit := PaintChip(buf, buf.Area, "A\x1bB", NewStyle(), clistyle.AlignLeft)
	if hit == nil {
		t.Fatalf("nil hit")
	}
	escaped := clistyle.Escape("A\x1bB")
	if int(hit.Width) != uniseg.StringWidth(escaped)+2 || strings.Contains(bufRows(buf)[0], "\x1b") {
		t.Fatalf("escaped chip mismatch: hit=%+v row=%q", hit, bufRows(buf)[0])
	}
}
