package tuicomponents

// 1:1 mapping from rust/crates/tmt-tui-components/src/tests.rs (21 #[test] functions):
//
//  1. serde_and_grapheme_cells_round_trip_without_partial_wide_characters -> TestSerdeAndGraphemeCellsRoundTripWithoutPartialWideCharacters
//  2. section_drops_note_before_ellipsizing_title                         -> TestSectionDropsNoteBeforeEllipsizingTitle
//  3. chip_hits_are_emitted_only_for_a_complete_visible_prefix            -> TestChipHitsAreEmittedOnlyForACompleteVisiblePrefix
//  4. stacked_mixed_cell_keeps_fraction_and_role_background               -> TestStackedMixedCellKeepsFractionAndRoleBackground
//  5. stacked_saved_is_part_of_used_not_added_to_its_height               -> TestStackedSavedIsPartOfUsedNotAddedToItsHeight
//  6. stacked_missing_saved_is_not_invented_as_zero                       -> TestStackedMissingSavedIsNotInventedAsZero
//  7. stacked_saved_larger_than_used_is_unknown                           -> TestStackedSavedLargerThanUsedIsUnknown
//  8. activity_keeps_missing_zero_and_all_six_glyph_levels                -> TestActivityKeepsMissingZeroAndAllSixGlyphLevels
//  9. totals_keep_values_whole_and_publish_only_visible_rows              -> TestTotalsKeepValuesWholeAndPublishOnlyVisibleRows
// 10. styled_text_strips_terminal_controls_and_preserves_span_roles       -> TestStyledTextStripsTerminalControlsAndPreservesSpanRoles
// 11. styled_text_emphasis_defaults_to_false                              -> TestStyledTextEmphasisDefaultsToFalse
// 12. layout_allocates_bounded_tracks_without_gaps                        -> TestLayoutAllocatesBoundedTracksWithoutGaps
// 13. pure_design_system_does_not_import_terminal_or_board_modules        -> go/internal/archtest.TestLayerRules + TestApprovedDependencies
// 14. clipped_chips_never_publish_hits                                    -> TestClippedChipsNeverPublishHits
// 15. row_and_column_use_the_same_track_rules                             -> TestRowAndColumnUseTheSameTrackRules
// 16. gauge_matches_the_two_model_rows_in_digest_spec_f21e67b7            -> TestGaugeMatchesTheTwoModelRowsInDigestSpecF21E67B7
// 17. portable_cell_serializes_bold_and_semantic_chip_surface             -> TestPortableCellSerializesBoldAndSemanticChipSurface
// 18. empty_section_title_is_a_plain_rule                                 -> TestEmptySectionTitleIsAPlainRule
// 19. mark_state_owns_attention_role_and_limits_emphasis                  -> TestMarkStateOwnsAttentionRoleAndLimitsEmphasis
// 20. sparkline_preserves_missing_zero_scale_and_insufficient_track       -> TestSparklinePreservesMissingZeroScaleAndInsufficientTrack
// 21. more_hints_distinguish_directions_and_truncation_in_unicode_and_ascii -> TestMoreHintsDistinguishDirectionsAndTruncationInUnicodeAndASCII

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

func area(width, height uint16) Rect {
	return Rect{X: 0, Y: 0, Width: width, Height: height}
}

func lines(grid *CellGrid) []string {
	sz := grid.Size()
	out := make([]string, sz.Height)
	for y := uint16(0); y < sz.Height; y++ {
		var b strings.Builder
		for x := uint16(0); x < sz.Width; x++ {
			b.WriteString(grid.Get(x, y).Glyph)
		}
		out[y] = b.String()
	}
	return out
}

func strPtr(s string) *string { return &s }
func u64Ptr(v uint64) *uint64 { return &v }
func intPtr(v int) *int       { return &v }
func tokPtr(t Token) *Token   { return &t }

func TestSerdeAndGraphemeCellsRoundTripWithoutPartialWideCharacters(t *testing.T) {
	p := GaugeProps{
		Label:       "usage",
		LabelWidth:  17,
		Total:       nil,
		Numerator:   2,
		Denominator: 3,
		FilledRole:  Token(clistyle.RoleWorking),
		RestRole:    Token(clistyle.RoleDim),
	}
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("marshal GaugeProps: %v", err)
	}
	var decoded GaugeProps
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal GaugeProps: %v", err)
	}
	if decoded.FilledRole.Role() != clistyle.RoleWorking {
		t.Fatalf("filled_role = %v, want working", decoded.FilledRole.Role())
	}
	var bad Token
	if err := json.Unmarshal([]byte(`"unknown"`), &bad); err == nil {
		t.Fatalf("expected error for unknown role token")
	}
	for _, role := range []clistyle.Role{clistyle.RoleMatrixBatch, clistyle.RoleMatrixUrgent} {
		encoded, err := json.Marshal(Token(role))
		if err != nil {
			t.Fatalf("marshal role %v: %v", role, err)
		}
		var got Token
		if err := json.Unmarshal(encoded, &got); err != nil {
			t.Fatalf("unmarshal role %v: %v", role, err)
		}
		if got != Token(role) {
			t.Fatalf("round-trip role = %v, want %v", got, Token(role))
		}
	}
	grid := NewCellGrid(Size{Width: 3, Height: 1})
	grid.Text(area(3, 1), "a世x", clistyle.RoleText, nil)
	if grid.Get(1, 0).Glyph != "世" {
		t.Fatalf("cell(1,0).Glyph = %q, want 世", grid.Get(1, 0).Glyph)
	}
	if !grid.Get(2, 0).Continuation {
		t.Fatalf("cell(2,0).Continuation = false, want true")
	}
}

func TestSectionDropsNoteBeforeEllipsizingTitle(t *testing.T) {
	p := SectionRuleProps{
		Title:    "An unusually long title",
		Note:     strPtr("important note"),
		NoteRole: tokPtr(Token(clistyle.RoleMuted)),
		Focused:  false,
	}
	grid := NewCellGrid(Size{Width: 18, Height: 1})
	(SectionRule{}).Render(p, area(18, 1), &grid)
	s := lines(&grid)[0]
	if strings.Contains(s, "important") {
		t.Fatalf("section rule kept note at width 18: %q", s)
	}
	if !strings.HasSuffix(s, "…") {
		t.Fatalf("section rule did not ellipsize: %q", s)
	}
	if want := "── An unusually l…"; s != want {
		t.Fatalf("section rule = %q, want %q", s, want)
	}
}

func TestChipHitsAreEmittedOnlyForACompleteVisiblePrefix(t *testing.T) {
	props := ChipRowProps{
		Label: "",
		Chips: []Chip{
			{ID: 7, Label: "first", Gap: " ", Enabled: true},
			{ID: 8, Label: "selected", Gap: "", Enabled: true},
		},
		Selected: intPtr(1),
		Cursor:   intPtr(1),
		Active:   true,
	}
	grid := NewCellGrid(Size{Width: 12, Height: 1})
	hits := (ChipRow{}).Render(props, area(12, 1), &grid)
	if len(hits) != 1 || hits[0].ID != 7 {
		t.Fatalf("hits = %+v, want single hit with id 7", hits)
	}
	if strings.Contains(lines(&grid)[0], "selected") {
		t.Fatalf("clipped chip painted: %q", lines(&grid)[0])
	}
}

func TestStackedMixedCellKeepsFractionAndRoleBackground(t *testing.T) {
	p := StackedBarsProps{
		Points:      []StackedPoint{{Used: u64Ptr(14), Saved: u64Ptr(2)}},
		UsedRole:    Token(clistyle.RoleText),
		SavedRole:   Token(clistyle.RoleAccent),
		MissingRole: Token(clistyle.RoleDim),
	}
	grid := NewCellGrid(Size{Width: 1, Height: 2})
	(StackedBars{}).Render(p, area(1, 2), &grid)
	cell := grid.Get(0, 1)
	if cell.Glyph != "▂" {
		t.Fatalf("cell.Glyph = %q, want ▂", cell.Glyph)
	}
	if cell.Fg == nil || *cell.Fg != clistyle.RoleAccent {
		t.Fatalf("cell.Fg = %v, want accent", cell.Fg)
	}
	if cell.Bg == nil || *cell.Bg != clistyle.RoleText {
		t.Fatalf("cell.Bg = %v, want text", cell.Bg)
	}
}

func TestStackedSavedIsPartOfUsedNotAddedToItsHeight(t *testing.T) {
	props := StackedBarsProps{
		Points: []StackedPoint{
			{Used: u64Ptr(8), Saved: u64Ptr(8)},
			{Used: u64Ptr(8), Saved: u64Ptr(0)},
		},
		UsedRole:    Token(clistyle.RoleText),
		SavedRole:   Token(clistyle.RoleAccent),
		MissingRole: Token(clistyle.RoleDim),
	}
	grid := NewCellGrid(Size{Width: 2, Height: 2})
	(StackedBars{}).Render(props, area(2, 2), &grid)
	if grid.Get(0, 0).Glyph != "█" || grid.Get(1, 0).Glyph != "█" {
		t.Fatalf("top glyphs = %q, %q, want █, █", grid.Get(0, 0).Glyph, grid.Get(1, 0).Glyph)
	}
	if *grid.Get(0, 0).Fg != clistyle.RoleAccent || *grid.Get(1, 0).Fg != clistyle.RoleText {
		t.Fatalf("top roles = %v, %v", *grid.Get(0, 0).Fg, *grid.Get(1, 0).Fg)
	}
}

func TestStackedMissingSavedIsNotInventedAsZero(t *testing.T) {
	props := StackedBarsProps{
		Points:      []StackedPoint{{Used: u64Ptr(8), Saved: nil}},
		UsedRole:    Token(clistyle.RoleText),
		SavedRole:   Token(clistyle.RoleAccent),
		MissingRole: Token(clistyle.RoleDim),
	}
	grid := NewCellGrid(Size{Width: 1, Height: 2})
	(StackedBars{}).Render(props, area(1, 2), &grid)
	if grid.Get(0, 0).Glyph != "·" || grid.Get(0, 1).Glyph != "·" {
		t.Fatalf("missing saved glyphs = %q, %q, want ·, ·", grid.Get(0, 0).Glyph, grid.Get(0, 1).Glyph)
	}
}

func TestStackedSavedLargerThanUsedIsUnknown(t *testing.T) {
	props := StackedBarsProps{
		Points:      []StackedPoint{{Used: u64Ptr(2), Saved: u64Ptr(3)}},
		UsedRole:    Token(clistyle.RoleText),
		SavedRole:   Token(clistyle.RoleAccent),
		MissingRole: Token(clistyle.RoleDim),
	}
	grid := NewCellGrid(Size{Width: 1, Height: 2})
	(StackedBars{}).Render(props, area(1, 2), &grid)
	if grid.Get(0, 0).Glyph != "·" || grid.Get(0, 1).Glyph != "·" {
		t.Fatalf("saved>used glyphs = %q, %q, want ·, ·", grid.Get(0, 0).Glyph, grid.Get(0, 1).Glyph)
	}
}

func TestActivityKeepsMissingZeroAndAllSixGlyphLevels(t *testing.T) {
	wantGlyphs := []string{"·", "▁", "▂", "▃", "▄", "▅", "▆", "█"}
	for _, selected := range []bool{false, true} {
		props := ActivityCellsProps{
			Values:   []*uint64{nil, u64Ptr(0), u64Ptr(1), u64Ptr(2), u64Ptr(3), u64Ptr(4), u64Ptr(5), u64Ptr(6)},
			Selected: selected,
		}
		grid := NewCellGrid(Size{Width: 8, Height: 1})
		(ActivityCells{}).Render(props, area(8, 1), &grid)
		for x, glyph := range wantGlyphs {
			cell := grid.Get(uint16(x), 0)
			if cell.Glyph != glyph {
				t.Fatalf("selected=%v x=%d glyph=%q want %q", selected, x, cell.Glyph, glyph)
			}
			wantRole := clistyle.RoleText
			if x < 2 {
				if selected {
					wantRole = clistyle.RoleMuted
				} else {
					wantRole = clistyle.RoleDim
				}
			}
			if cell.Fg == nil || *cell.Fg != wantRole {
				t.Fatalf("selected=%v x=%d fg=%v want %v", selected, x, cell.Fg, wantRole)
			}
			if cell.Bg != nil {
				t.Fatalf("selected=%v x=%d bg=%v want nil", selected, x, cell.Bg)
			}
			if cell.HeatLevel != nil {
				t.Fatalf("selected=%v x=%d heat_level=%v want nil", selected, x, cell.HeatLevel)
			}
			if selected {
				if cell.Underlay == nil || *cell.Underlay != clistyle.RoleSelection {
					t.Fatalf("selected=true x=%d underlay=%v want selection", x, cell.Underlay)
				}
			} else if cell.Underlay != nil {
				t.Fatalf("selected=false x=%d underlay=%v want nil", x, cell.Underlay)
			}
		}
	}
}

func TestTotalsKeepValuesWholeAndPublishOnlyVisibleRows(t *testing.T) {
	id7, id8 := HitId(7), HitId(8)
	props := TotalsTableProps{
		Columns: []TotalsColumn{
			{Header: "TOK", Width: 4, Role: Token(clistyle.RoleText), RightAligned: true},
			{Header: "saved", Width: 5, Role: Token(clistyle.RoleAccent), RightAligned: true},
		},
		Rows: []TotalsRow{
			{Values: []string{"840M", "7.8M"}, Selected: true, ID: &id7},
			{Values: []string{"9", "too-long"}, Selected: false, ID: &id8},
		},
	}
	grid := NewCellGrid(Size{Width: 10, Height: 2})
	hits := (TotalsTable{}).Render(props, area(10, 2), &grid)
	got := lines(&grid)
	if got[0] != " TOK      " || got[1] != "840M      " {
		t.Fatalf("totals lines = %q, want [\" TOK      \", \"840M      \"]", got)
	}
	wantHits := []Hit{{Rect: Rect{X: 0, Y: 1, Width: 10, Height: 1}, ID: 7}}
	if !reflect.DeepEqual(hits, wantHits) {
		t.Fatalf("hits = %+v, want %+v", hits, wantHits)
	}
	if u := grid.Get(0, 1).Underlay; u == nil || *u != clistyle.RoleSelection {
		t.Fatalf("row 1 underlay = %v, want selection", u)
	}
}

func TestStyledTextStripsTerminalControlsAndPreservesSpanRoles(t *testing.T) {
	props := TextProps{
		Spans: []TextSpan{
			{Text: "A\x1b[31m", Role: Token(clistyle.RoleText), Bold: false},
			{Text: "世", Role: Token(clistyle.RoleAccent), Bold: true},
		},
	}
	grid := NewCellGrid(Size{Width: 3, Height: 1})
	(Text{}).Render(props, area(3, 1), &grid)
	if grid.Get(0, 0).Glyph != "A" {
		t.Fatalf("cell(0,0).Glyph = %q, want A", grid.Get(0, 0).Glyph)
	}
	if grid.Get(1, 0).Glyph != "世" {
		t.Fatalf("cell(1,0).Glyph = %q, want 世", grid.Get(1, 0).Glyph)
	}
	if *grid.Get(1, 0).Fg != clistyle.RoleAccent {
		t.Fatalf("cell(1,0).Fg = %v, want accent", *grid.Get(1, 0).Fg)
	}
	if grid.Get(0, 0).Bold {
		t.Fatalf("cell(0,0).Bold = true, want false")
	}
	if !grid.Get(1, 0).Bold {
		t.Fatalf("cell(1,0).Bold = false, want true")
	}
	if !grid.Get(2, 0).Bold {
		t.Fatalf("wide-cell continuation lost emphasis")
	}
	if !grid.Get(2, 0).Continuation {
		t.Fatalf("cell(2,0).Continuation = false, want true")
	}
}

func TestStyledTextEmphasisDefaultsToFalse(t *testing.T) {
	var span TextSpan
	if err := json.Unmarshal([]byte(`{"text":"label","role":"text"}`), &span); err != nil {
		t.Fatalf("unmarshal default span: %v", err)
	}
	if span.Bold {
		t.Fatalf("span.Bold = true, want false")
	}
	var bold TextSpan
	if err := json.Unmarshal([]byte(`{"text":"label","role":"text","bold":true}`), &bold); err != nil {
		t.Fatalf("unmarshal bold span: %v", err)
	}
	if !bold.Bold {
		t.Fatalf("bold.Bold = false, want true")
	}
}

func TestLayoutAllocatesBoundedTracksWithoutGaps(t *testing.T) {
	rects := Split(area(10, 1), []Track{FixedTrack(3), FillTrack(1), FillTrack(2)}, true)
	got := []uint16{rects[0].Width, rects[1].Width, rects[2].Width}
	want := []uint16{3, 2, 5}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("widths = %v, want %v", got, want)
	}
}

func TestClippedChipsNeverPublishHits(t *testing.T) {
	props := ChipRowProps{
		Label:    "",
		Chips:    []Chip{{ID: 7, Label: "selected", Gap: "", Enabled: true}},
		Selected: intPtr(0),
		Cursor:   nil,
		Active:   true,
	}
	grid := NewCellGrid(Size{Width: 5, Height: 1})
	if hits := (ChipRow{}).Render(props, area(20, 1), &grid); len(hits) != 0 {
		t.Fatalf("clipped chips emitted hits: %+v", hits)
	}
}

func TestRowAndColumnUseTheSameTrackRules(t *testing.T) {
	tracks := []Track{FixedTrack(2), FillTrack(1)}
	encoded, err := json.Marshal(tracks[0])
	if err != nil {
		t.Fatalf("marshal track: %v", err)
	}
	var decoded Track
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal track: %v", err)
	}
	if decoded != tracks[0] {
		t.Fatalf("round-trip track = %+v, want %+v", decoded, tracks[0])
	}
	rowRects := Row(area(8, 6), tracks)
	if got := []uint16{rowRects[0].Width, rowRects[1].Width}; !reflect.DeepEqual(got, []uint16{2, 6}) {
		t.Fatalf("row widths = %v, want [2 6]", got)
	}
	colRects := Column(area(8, 6), tracks)
	if got := []uint16{colRects[0].Height, colRects[1].Height}; !reflect.DeepEqual(got, []uint16{2, 4}) {
		t.Fatalf("col heights = %v, want [2 4]", got)
	}
}

func TestGaugeMatchesTheTwoModelRowsInDigestSpecF21E67B7(t *testing.T) {
	cases := []struct {
		label     string
		numerator uint64
		total     string
		expected  string
	}{
		{"claude-opus-5.5", 78, "655M", "claude-opus-5.5   ███████████████████·····  78%   655M"},
		{"claude-sonnet-5.5", 19, "160M", "claude-sonnet-5.5 █████···················  19%   160M"},
	}
	for _, tc := range cases {
		props := GaugeProps{
			Label:       tc.label,
			LabelWidth:  17,
			Numerator:   tc.numerator,
			Denominator: 100,
			Total:       strPtr(tc.total),
			FilledRole:  Token(clistyle.RoleText),
			RestRole:    Token(clistyle.RoleDim),
		}
		grid := NewCellGrid(Size{Width: 80, Height: 1})
		(Gauge{}).Render(props, area(80, 1), &grid)
		got := strings.TrimRight(lines(&grid)[0], " ")
		if got != tc.expected {
			t.Fatalf("gauge(%s) = %q, want %q", tc.label, got, tc.expected)
		}
		if *grid.Get(18, 0).Fg != clistyle.RoleText {
			t.Fatalf("filled cell fg = %v, want text", *grid.Get(18, 0).Fg)
		}
		if *grid.Get(41, 0).Fg != clistyle.RoleDim {
			t.Fatalf("rest cell fg = %v, want dim", *grid.Get(41, 0).Fg)
		}
	}
}

func TestPortableCellSerializesBoldAndSemanticChipSurface(t *testing.T) {
	hot := ChipSurfaceHot
	cell := Cell{
		Glyph:        "x",
		Underlay:     rolePtr(clistyle.RoleDim),
		Fg:           rolePtr(clistyle.RoleText),
		Bg:           nil,
		Bold:         true,
		ChipSurface:  &hot,
		HeatLevel:    nil,
		Continuation: false,
	}
	raw, err := json.Marshal(cell)
	if err != nil {
		t.Fatalf("marshal cell: %v", err)
	}
	serialized := string(raw)
	var decoded Cell
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal cell: %v", err)
	}
	if !reflect.DeepEqual(decoded, cell) {
		t.Fatalf("decoded cell = %+v, want %+v", decoded, cell)
	}
	for _, want := range []string{`"underlay":"dim"`, `"bold":true`, `"chip_surface":"hot"`} {
		if !strings.Contains(serialized, want) {
			t.Fatalf("serialized cell %s missing %s", serialized, want)
		}
	}
	if strings.Contains(serialized, `"heat_level"`) {
		t.Fatalf("nil heat_level should be omitted: %s", serialized)
	}
}

func TestEmptySectionTitleIsAPlainRule(t *testing.T) {
	props := SectionRuleProps{
		Title:    "",
		Note:     nil,
		NoteRole: nil,
		Focused:  false,
	}
	grid := NewCellGrid(Size{Width: 8, Height: 1})
	(SectionRule{}).Render(props, area(8, 1), &grid)
	if got := lines(&grid)[0]; got != "────────" {
		t.Fatalf("empty section rule = %q, want ────────", got)
	}
	for x := uint16(0); x < 8; x++ {
		if *grid.Get(x, 0).Fg != clistyle.RoleDim {
			t.Fatalf("x=%d fg=%v, want dim", x, *grid.Get(x, 0).Fg)
		}
	}
}

func TestMarkStateOwnsAttentionRoleAndLimitsEmphasis(t *testing.T) {
	cases := []struct {
		state MarkState
		role  clistyle.Role
		bold  bool
	}{
		{MarkStateWorking, clistyle.RoleMuted, false},
		{MarkStateWaiting, clistyle.RoleWaiting, true},
		{MarkStateBlocked, clistyle.RoleBlocked, true},
		{MarkStateReview, clistyle.RoleMuted, false},
		{MarkStateIdle, clistyle.RoleMuted, false},
		{MarkStateOffline, clistyle.RoleMuted, false},
		{MarkStateEnded, clistyle.RoleMuted, false},
		{MarkStateShell, clistyle.RoleMuted, false},
	}
	for _, tc := range cases {
		grid := NewCellGrid(Size{Width: 20, Height: 1})
		(Mark{}).Render(MarkProps{
			State:    tc.state,
			Label:    "state",
			Emphasis: true,
		}, area(20, 1), &grid)
		cell := grid.Get(0, 0)
		if cell.Fg == nil || *cell.Fg != tc.role {
			t.Fatalf("state=%s fg=%v want %v", tc.state, cell.Fg, tc.role)
		}
		if cell.Bold != tc.bold {
			t.Fatalf("state=%s bold=%v want %v", tc.state, cell.Bold, tc.bold)
		}
	}
}

func TestSparklinePreservesMissingZeroScaleAndInsufficientTrack(t *testing.T) {
	grid := NewCellGrid(Size{Width: 5, Height: 1})
	props := SparklineProps{
		Points:      []*uint64{nil, u64Ptr(0), u64Ptr(1), u64Ptr(4), u64Ptr(8)},
		Scale:       8,
		Unavailable: false,
	}
	(Sparkline{}).Render(props, area(5, 1), &grid)
	if got := lines(&grid); !reflect.DeepEqual(got, []string{"· ▁▄█"}) {
		t.Fatalf("sparkline = %q, want [\"· ▁▄█\"]", got)
	}
	props.Unavailable = true
	(Sparkline{}).Render(props, area(5, 1), &grid)
	if got := lines(&grid); !reflect.DeepEqual(got, []string{"     "}) {
		t.Fatalf("unavailable sparkline = %q, want [\"     \"]", got)
	}
	before := grid.Clone()
	(Sparkline{}).Render(props, area(4, 1), &grid)
	if !reflect.DeepEqual(grid, before) {
		t.Fatalf("narrow sparkline mutated grid")
	}
}

func TestMoreHintsDistinguishDirectionsAndTruncationInUnicodeAndASCII(t *testing.T) {
	cases := []struct {
		direction MoreDirection
		unicode   string
		ascii     string
	}{
		{MoreDirectionDown, "12 more ↓", "12 more v"},
		{MoreDirectionUp, "12 more ↑", "12 more ^"},
		{MoreDirectionRight, "12 more →", "12 more >"},
		{MoreDirectionTruncated, "+12 more", "+12 more"},
	}
	for _, tc := range cases {
		if got := (MoreHint{}).Label(12, tc.direction, false); got != tc.unicode {
			t.Fatalf("unicode label(%s) = %q, want %q", tc.direction, got, tc.unicode)
		}
		if got := (MoreHint{}).Label(12, tc.direction, true); got != tc.ascii {
			t.Fatalf("ascii label(%s) = %q, want %q", tc.direction, got, tc.ascii)
		}
		grid := NewCellGrid(Size{Width: 20, Height: 1})
		(MoreHint{}).Render(MoreHintProps{
			Count:     12,
			Direction: tc.direction,
			ASCII:     false,
		}, area(20, 1), &grid)
		if got := strings.TrimRight(lines(&grid)[0], " "); got != tc.unicode {
			t.Fatalf("rendered(%s) = %q, want %q", tc.direction, got, tc.unicode)
		}
	}
}

func TestPaneFrameAndPaneRuleAndSanitizeAndHeatLevel(t *testing.T) {
	// PaneFrame boxed focused with back hint.
	grid := NewCellGrid(Size{Width: 28, Height: 6})
	(PaneFrame{}).Render(PaneFrameProps{
		Title:    "Agents",
		Focused:  true,
		ASCII:    false,
		BackHint: true,
	}, area(28, 6), &grid)
	gotFrame := lines(&grid)
	if gotFrame[0] != "┏━ ▸ Agents · Esc back ━━━━┓" {
		t.Fatalf("pane frame top = %q", gotFrame[0])
	}
	if gotFrame[1] != "┃                          ┃" || gotFrame[5] != "┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛" {
		t.Fatalf("pane frame body/bottom = %q / %q", gotFrame[1], gotFrame[5])
	}

	// PaneRule focused unicode and ASCII.
	ruleGrid := NewCellGrid(Size{Width: 31, Height: 1})
	(PaneRule{}).Render(PaneRuleProps{
		Title:    "Agents",
		Note:     strPtr("/ Search"),
		NoteRole: tokPtr(Token(clistyle.RoleMuted)),
		Focused:  true,
		ASCII:    false,
	}, area(31, 1), &ruleGrid)
	if got := lines(&ruleGrid)[0]; got != "▸━ Agents ━━━━━━━━━ / Search ━━" {
		t.Fatalf("pane rule focused = %q", got)
	}
	if !ruleGrid.Get(0, 0).Bold || *ruleGrid.Get(0, 0).Underlay != clistyle.RoleDim {
		t.Fatalf("pane rule focus marker metadata mismatch: %+v", ruleGrid.Get(0, 0))
	}

	// Sanitize strips CSI, OSC, C1, bidi, CR, converts tab to 4 spaces.
	if got := Sanitize("a\x1b[31mb\x1b]0;title\x07c\u009b2Jd\u202ee\tf\r\ng"); got != "abcde    f\ng" {
		t.Fatalf("Sanitize = %q", got)
	}
	if got := SingleLine("a\nb\u2028c\u2029d"); got != "a b c d" {
		t.Fatalf("SingleLine = %q", got)
	}

	// HeatLevel JSON range validation (0..5).
	var hl HeatLevel
	if err := json.Unmarshal([]byte("5"), &hl); err != nil || hl != HeatLevelFive {
		t.Fatalf("HeatLevel(5) = (%v, %v)", hl, err)
	}
	if err := json.Unmarshal([]byte("6"), &hl); err == nil {
		t.Fatalf("HeatLevel(6) should fail")
	}
}
