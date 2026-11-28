package tui

// 1:1 mapping from rust/crates/tmt-tui/src/style/tests.rs (10 #[test] functions):
//
//  1. literal_cell_styles_and_defaults                                    -> TestLiteralCellStylesAndDefaults
//  2. integer_boundaries_and_axis_shorthands                              -> TestIntegerBoundariesAndAxisShorthands
//  3. overlaps_and_duplicates_fail_in_both_orders                         -> TestOverlapsAndDuplicatesFailInBothOrders
//  4. unsupported_syntax_and_numbers_fail_without_coercion                -> TestUnsupportedSyntaxAndNumbersFailWithoutCoercion
//  5. tokens_reuse_the_style_owner_without_resolving_a_palette            -> TestTokensReuseTheStyleOwnerWithoutResolvingAPalette
//  6. grid_and_integer_utilities_admit_only_the_canonical_vocabulary      -> TestGridAndIntegerUtilitiesAdmitOnlyTheCanonicalVocabulary
//  7. malformed_grid_tracks_sizes_and_conflicts_have_located_errors       -> TestMalformedGridTracksSizesAndConflictsHaveLocatedErrors
//  8. repeated_static_track_lists_share_storage                           -> TestRepeatedStaticTrackListsShareStorage
//  9. bracket_integers_fail_with_the_canonical_bare_hint                  -> TestBracketIntegersFailWithTheCanonicalBareHint
// 10. auto_grid_tracks_and_each_conflict_have_specific_located_errors     -> TestAutoGridTracksAndEachConflictHaveSpecificLocatedErrors

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

func styledCell(t *testing.T, attrs string) CellStyle {
	t.Helper()
	root, err := Parse("styles.xml", fmt.Sprintf(`<tmt-view version="1"><tmt-cell %s/></tmt-view>`, attrs))
	if err != nil {
		t.Fatalf("Parse(%s): %v", attrs, err)
	}
	return root.Children[0].Style
}

func invalidStyleMsg(t *testing.T, attrs string) string {
	t.Helper()
	source := fmt.Sprintf("<tmt-view version=\"1\">\n  <tmt-repeat each=\"$.empty\" as=\"row\">\n    <tmt-cell %s/>\n  </tmt-repeat>\n</tmt-view>", attrs)
	_, err := Parse("invalid.xml", source)
	if err == nil {
		t.Fatalf("expected error for attrs %s", attrs)
	}
	me := err.(*MarkupError)
	if me.Location != (Location{Line: 3, Column: 5}) {
		t.Fatalf("location = %+v, want {3 5} (%v)", me.Location, me)
	}
	if !strings.HasPrefix(me.Error(), "invalid.xml:3:5: <tmt-cell>:") {
		t.Fatalf("error prefix mismatch: %s", me.Error())
	}
	return me.Message
}

func TestLiteralCellStylesAndDefaults(t *testing.T) {
	node, err := Parse("board.xml", `<tmt-view version="1">
      <tmt-row class="flex gap-x-2 gap-y-3 px-4 py-5 grow-2 shrink-0 w-full h-7" token="working">
        <tmt-col/><tmt-cell class="w-0 h-full truncate"/>
      </tmt-row>
    </tmt-view>`)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	wantRoot := CellStyle{
		Display:   DisplayFlex,
		Direction: DirectionColumn,
		Basis:     AutoExtent(),
		ColSpan:   1,
		Width:     AutoExtent(),
		Height:    AutoExtent(),
		Shrink:    1,
		TextFlow:  ClipFlow(),
	}
	if !reflect.DeepEqual(node.Style, wantRoot) {
		t.Fatalf("root style = %+v, want %+v", node.Style, wantRoot)
	}
	working := clistyle.RoleWorking
	wantRow := CellStyle{
		Display:   DisplayFlex,
		Direction: DirectionRow,
		Basis:     AutoExtent(),
		ColSpan:   1,
		Width:     FullExtent(),
		Height:    CellsExtent(7),
		Gap:       [2]uint16{2, 3},
		Padding:   [2]uint16{4, 5},
		Grow:      2,
		Shrink:    0,
		TextFlow:  ClipFlow(),
		Token:     &working,
	}
	if !reflect.DeepEqual(node.Children[0].Style, wantRow) {
		t.Fatalf("row style = %+v, want %+v", node.Children[0].Style, wantRow)
	}
	if node.Children[0].Children[0].Style.Direction != DirectionColumn {
		t.Fatalf("col direction != Column")
	}
	cell := node.Children[0].Children[1].Style
	if cell.Width != CellsExtent(0) || cell.Height != FullExtent() || cell.TextFlow != TruncateFlow() {
		t.Fatalf("cell style mismatch: %+v", cell)
	}
}

func TestIntegerBoundariesAndAxisShorthands(t *testing.T) {
	for _, n := range []uint16{0, 1, 4096} {
		res := styledCell(t, fmt.Sprintf(`class="w-%d h-%d gap-%d p-%d grow-%d shrink-%d"`, n, n, n, n, n, n))
		if res.Width != CellsExtent(n) || res.Height != CellsExtent(n) {
			t.Fatalf("w/h for %d mismatch: %+v", n, res)
		}
		if res.Gap != [2]uint16{n, n} || res.Padding != [2]uint16{n, n} || res.Grow != n || res.Shrink != n {
			t.Fatalf("shorthands for %d mismatch: %+v", n, res)
		}
	}
	res := styledCell(t, `class="flex-col grow shrink" wrap="true"`)
	if res.Direction != DirectionColumn || res.Grow != 1 || res.Shrink != 1 || res.TextFlow != WrapFlow() {
		t.Fatalf("flex-col/grow/shrink/wrap mismatch: %+v", res)
	}
	if styledCell(t, `wrap="false"`).TextFlow != ClipFlow() {
		t.Fatalf("wrap=false != Clip")
	}
	row, err := Parse("direction.xml", `<tmt-view version="1" class="flex-row"/>`)
	if err != nil || row.Style.Direction != DirectionRow {
		t.Fatalf("view flex-row: %v", err)
	}
	if got := styledCell(t, `class='  px-01&#9;py-2  '`).Padding; got != [2]uint16{1, 2} {
		t.Fatalf("padding = %v, want [1 2]", got)
	}
}

func TestOverlapsAndDuplicatesFailInBothOrders(t *testing.T) {
	pairs := [][3]string{
		{"w-1", "w-full", "w"},
		{"h-full", "h-2", "h"},
		{"gap-1", "gap-x-2", "gap-x"},
		{"gap-1", "gap-y-2", "gap-y"},
		{"p-1", "px-2", "px"},
		{"p-1", "py-2", "py"},
		{"grow", "grow-1", "grow"},
		{"shrink", "shrink-0", "shrink"},
		{"flex-row", "flex-col", "direction"},
		{"flex", "flex", "display"},
		{"truncate", "truncate", "text-flow"},
		{"w-2", "w-2", "w"},
		{"px-1", "px-1", "px"},
		{"gap-y-0", "gap-y-0", "gap-y"},
	}
	for _, p := range pairs {
		for _, order := range [][2]string{{p[0], p[1]}, {p[1], p[0]}} {
			msg := invalidStyleMsg(t, fmt.Sprintf(`class="%s %s"`, order[0], order[1]))
			for _, want := range []string{"conflicts", order[0], order[1], p[2]} {
				if !strings.Contains(msg, want) {
					t.Fatalf("msg %q missing %q", msg, want)
				}
			}
		}
	}
	for _, val := range []string{"true", "false"} {
		msg := invalidStyleMsg(t, fmt.Sprintf(`class="truncate" wrap="%s"`, val))
		if !strings.Contains(msg, "wrap=") || !strings.Contains(msg, "truncate") {
			t.Fatalf("msg %q missing wrap/truncate", msg)
		}
	}
}

func TestUnsupportedSyntaxAndNumbersFailWithoutCoercion(t *testing.T) {
	for _, class := range []string{
		"hidden", "hover:w-1", "sm:flex", "w-1/2", "w-30%", "text-ellipsis-middle",
		"w-auto", "w-1px", "w-1.0", "w--1", "w-+1", "w-4097", "h-65536",
		"p-999999999999999999999", "gap-x-4097", "gap-y-", "px-4097", "py-4097",
		"grow-4097", "shrink-4097",
	} {
		msg := invalidStyleMsg(t, fmt.Sprintf(`class="%s"`, class))
		if !strings.Contains(msg, class) {
			t.Fatalf("msg %q missing %q", msg, class)
		}
	}
	for _, val := range []string{"1", "True", "", "yes"} {
		msg := invalidStyleMsg(t, fmt.Sprintf(`wrap="%s"`, val))
		if !strings.Contains(msg, fmt.Sprintf("wrap=%q", val)) || !strings.Contains(msg, "must be true or false") {
			t.Fatalf("wrap msg mismatch: %q", msg)
		}
	}
}

func TestTokensReuseTheStyleOwnerWithoutResolvingAPalette(t *testing.T) {
	for _, role := range allRoles {
		st := styledCell(t, fmt.Sprintf(`token="%s"`, role.String()))
		if st.Token == nil || *st.Token != role {
			t.Fatalf("token %s -> %v", role.String(), st.Token)
		}
	}
	for _, val := range []string{"", "Working", "working ", "red", "#ff0000", "unknown"} {
		msg := invalidStyleMsg(t, fmt.Sprintf(`token="%s"`, val))
		if !strings.Contains(msg, fmt.Sprintf("unknown token=%q", val)) {
			t.Fatalf("token msg mismatch: %q", msg)
		}
	}
	if styledCell(t, `token-bind="row.role"`).Token != nil {
		t.Fatalf("token-bind should leave Token nil")
	}
}

func TestGridAndIntegerUtilitiesAdmitOnlyTheCanonicalVocabulary(t *testing.T) {
	s := styledCell(t, `class='grid grid-cols-[4_30%_2fr_minmax(2,3fr)] gap-2 col-span-2 truncate-middle'`)
	if s.Display != DisplayGrid || s.ColSpan != 2 || s.Gap != [2]uint16{2, 2} || s.TextFlow != MiddleFlow() {
		t.Fatalf("grid style mismatch: %+v", s)
	}
	if s.Columns[0] != (GridTrack{Min: CellsBreadth(4), Max: CellsBreadth(4)}) ||
		s.Columns[1].Max != PercentBreadth(30) ||
		s.Columns[2].Max != FractionBreadth(2) ||
		s.Columns[3] != (GridTrack{Min: CellsBreadth(2), Max: FractionBreadth(3)}) {
		t.Fatalf("columns = %+v", s.Columns)
	}
	s2 := styledCell(t, `class='basis-[30%] w-[100%] h-[50%] min-w-2 max-w-20 grow-3 line-clamp-2'`)
	if s2.Basis != PercentExtent(30) || s2.Width != PercentExtent(100) || s2.Height != PercentExtent(50) ||
		*s2.MinWidth != 2 || *s2.MaxWidth != 20 || s2.Grow != 3 || s2.TextFlow != ClampFlow(2) {
		t.Fatalf("flex/percent style mismatch: %+v", s2)
	}
	for _, class := range []string{"w-[0%]", "basis-[100%]", "grid grid-cols-[0_0%_0fr_minmax(0,1)]"} {
		styledCell(t, fmt.Sprintf(`class='%s'`, class))
	}
}

func TestMalformedGridTracksSizesAndConflictsHaveLocatedErrors(t *testing.T) {
	for _, class := range []string{
		"grid-cols-[2]", "grid flex-row", "grid grid-cols-[]", "grid grid-cols-[2_]",
		"grid grid-cols-[1.2fr]", "grid grid-cols-[101%]", "grid grid-cols-[minmax(1fr,2fr)]",
		"grid grid-cols-[minmax(2,3,4)]", "grid grid-cols-[minmax(1,minmax(2,3))]",
		"col-span-0", "line-clamp-0", "w-[101%]", "min-w-[20%]", "w-1 w-1",
		"w-[20%] w-full", "truncate-middle truncate", "line-clamp-2 truncate",
		"grid flex", "grid grid-cols-[1] grid-cols-[2]", "text-ellipsis-middle",
	} {
		msg := invalidStyleMsg(t, fmt.Sprintf(`class='%s'`, class))
		matched := false
		for _, w := range strings.Fields(class) {
			if strings.Contains(msg, w) {
				matched = true
				break
			}
		}
		if !matched {
			t.Fatalf("msg %q does not mention any token from %q", msg, class)
		}
	}
	msg := invalidStyleMsg(t, `class='w-30%'`)
	if !strings.Contains(msg, "w-30%") || !strings.Contains(msg, "w-[n%]") {
		t.Fatalf("w-30%% hint mismatch: %q", msg)
	}
	if !strings.Contains(invalidStyleMsg(t, `class='line-clamp-2' wrap='true'`), "conflicts") {
		t.Fatalf("line-clamp + wrap should report conflicts")
	}
}

func TestRepeatedStaticTrackListsShareStorage(t *testing.T) {
	original := styledCell(t, `class='grid grid-cols-[1_2_3]'`)
	copied := original
	if &original.Columns[0] != &copied.Columns[0] {
		t.Fatalf("copied CellStyle did not share Columns backing storage")
	}
}

func TestBracketIntegersFailWithTheCanonicalBareHint(t *testing.T) {
	for _, key := range []string{
		"w", "h", "grow", "gap", "gap-x", "gap-y", "basis",
		"min-w", "max-w", "col-span", "line-clamp", "p", "shrink",
	} {
		class := fmt.Sprintf("%s-[3]", key)
		msg := invalidStyleMsg(t, fmt.Sprintf(`class='%s'`, class))
		if !strings.Contains(msg, class) || !strings.Contains(msg, fmt.Sprintf("hint: use %s-N", key)) {
			t.Fatalf("bracket hint mismatch for %s: %q", class, msg)
		}
	}
}

func TestAutoGridTracksAndEachConflictHaveSpecificLocatedErrors(t *testing.T) {
	st := styledCell(t, `class='grid grid-cols-[auto_minmax(auto,12)]'`)
	if st.Columns[0] != (GridTrack{Min: AutoBreadth(), Max: AutoBreadth()}) ||
		st.Columns[1] != (GridTrack{Min: AutoBreadth(), Max: CellsBreadth(12)}) {
		t.Fatalf("auto tracks = %+v", st.Columns)
	}
	if msg := invalidStyleMsg(t, `class='grid grid-cols-[minmax(2,auto)]'`); !strings.Contains(msg, "minmax(auto,N)") {
		t.Fatalf("minmax(2,auto) msg = %q", msg)
	}
	needsGrid := invalidStyleMsg(t, `class='grid-cols-[2]'`)
	if !strings.Contains(needsGrid, "grid-cols-[2]") || !strings.Contains(needsGrid, "requires grid") || strings.Contains(needsGrid, "conflicts") {
		t.Fatalf("needsGrid msg = %q", needsGrid)
	}
	dir := invalidStyleMsg(t, `class='grid flex-row'`)
	if !strings.Contains(dir, "flex-row") || !strings.Contains(dir, "conflicts with grid") || strings.Contains(dir, "requires grid") {
		t.Fatalf("dir msg = %q", dir)
	}
}
