package tui

// 1:1 mapping from rust/crates/tmt-tui/src/geometry/tests.rs (13 #[test] functions):
//
//  1. nested_flex_and_integer_percentages_keep_css_gaps                       -> TestNestedFlexAndIntegerPercentagesKeepCSSGaps
//  2. grid_tracks_fr_minmax_span_and_cumulative_rounding                      -> TestGridTracksFrMinmaxSpanAndCumulativeRounding
//  3. grid_overflow_keeps_earlier_columns_and_four_cell_cut_guard             -> TestGridOverflowKeepsEarlierColumnsAndFourCellCutGuard
//  4. text_measure_and_paint_budget_resize_and_ancestor_clips                 -> TestTextMeasureAndPaintBudgetResizeAndAncestorClips
//  5. wrapping_clamp_and_fractional_width_use_the_final_measure_budget        -> TestWrappingClampAndFractionalWidthUseTheFinalMeasureBudget
//  6. flex_basis_bounds_and_shrink_have_literal_results                       -> TestFlexBasisBoundsAndShrinkHaveLiteralResults
//  7. manually_forged_scene_limits_fail_before_engine_allocation              -> TestManuallyForgedSceneLimitsFailBeforeEngineAllocation
//  8. switch_picks_the_branch_by_width_and_boundaries_are_inclusive_at_min    -> TestSwitchPicksTheBranchByWidthAndBoundariesAreInclusiveAtMin
//  9. switch_output_equals_the_hand_written_branch_for_every_width            -> TestSwitchOutputEqualsTheHandWrittenBranchForEveryWidth
// 10. container_width_is_the_parent_content_width_and_terminal_is_the_viewport -> TestContainerWidthIsTheParentContentWidthAndTerminalIsTheViewport
// 11. a_switch_inside_a_width_chosen_branch_resolves_on_the_next_level        -> TestASwitchInsideAWidthChosenBranchResolvesOnTheNextLevel
// 12. hide_below_removes_only_that_element_and_keeps_the_siblings_in_place    -> TestHideBelowRemovesOnlyThatElementAndKeepsTheSiblingsInPlace
// 13. the_resolving_pass_measures_no_branch_text                              -> TestTheResolvingPassMeasuresNoBranchText

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

func literalScene(t *testing.T, attrs, body string) SceneNode {
	t.Helper()
	el, err := Parse("geometry.xml", fmt.Sprintf(`<tmt-view version='1' %s>%s</tmt-view>`, attrs, body))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	return elementToSceneNode(el)
}

func elementToSceneNode(el *MarkupElement) SceneNode {
	var cond Cond
	switch el.Kind {
	case KindSwitch:
		of := SwitchOfContainer
		if el.Attributes["of"] == "terminal" {
			of = SwitchOfTerminal
		}
		cond = Cond{Kind: CondSwitch, Of: of}
	case KindCase:
		bp, _ := parseBreakpoint(el.Attributes["min"])
		cond = Cond{Kind: CondCase, Min: bp.cells}
	}
	var id []string
	if v, ok := el.Attributes["id"]; ok {
		id = []string{v}
	}
	var text *string
	if el.Kind == KindCell || el.Kind == KindText {
		s := el.Text
		text = &s
	}
	children := make([]SceneNode, len(el.Children))
	for i := range el.Children {
		children[i] = elementToSceneNode(&el.Children[i])
	}
	return SceneNode{
		Kind:     el.Kind,
		Cond:     cond,
		Style:    el.Style,
		ID:       id,
		Text:     text,
		Token:    el.Style.Token,
		Children: children,
	}
}

func testMeasure(text string, flow TextFlow, space Space) [2]uint16 {
	var natural uint16
	switch text {
	case "文件":
		natural = 4
	case "e\u0301":
		natural = 1
	case "👩‍💻":
		natural = 2
	default:
		natural = uint16(len(text))
	}
	var width uint16
	switch space.Kind {
	case SpaceCells:
		width = space.Cells
	case SpaceMinContent:
		width = 1
	case SpaceMaxContent:
		width = natural
	}
	var height uint16 = 1
	if flow.Kind == TextFlowWrap || flow.Kind == TextFlowClamp {
		maxLines := 255
		if flow.Kind == TextFlowClamp {
			maxLines = min(int(flow.Lines), 255)
		}
		height = uint16(len(clistyle.FitLines(text, int(width), clistyle.AlignLeft, clistyle.TruncateEnd, maxLines)))
	}
	return [2]uint16{min(natural, width), height}
}

type boxInfo struct {
	id        string
	rect      LayoutRect
	clip      LayoutRect
	textWidth uint16
	cut       bool
}

func testBoxes(t *testing.T, root *SceneNode, width uint16) []boxInfo {
	t.Helper()
	cells, err := Layout(root, [2]uint16{width, 20}, testMeasure)
	if err != nil {
		t.Fatalf("Layout: %v", err)
	}
	var out []boxInfo
	for _, c := range cells {
		if len(c.Node.ID) > 0 {
			out = append(out, boxInfo{
				id:        c.Node.ID[len(c.Node.ID)-1],
				rect:      c.Rect,
				clip:      c.Clip,
				textWidth: c.TextWidth,
				cut:       c.Cut,
			})
		}
	}
	return out
}

func lrect(x, y int32, w, h uint32) LayoutRect {
	return LayoutRect{X: x, Y: y, Width: w, Height: h}
}

func TestNestedFlexAndIntegerPercentagesKeepCSSGaps(t *testing.T) {
	root := literalScene(t, "class='flex-row px-1 gap-2'",
		"<tmt-col id='a' class='w-[50%] shrink-0 py-1'><tmt-text id='text' class='h-[50%]'>a</tmt-text></tmt-col><tmt-cell id='b' class='grow'/>")
	cells := testBoxes(t, &root, 22)
	if cells[0].rect != lrect(1, 0, 10, 20) {
		t.Fatalf("a = %+v, want (1,0,10,20)", cells[0].rect)
	}
	if cells[1].rect != lrect(1, 1, 10, 9) {
		t.Fatalf("text = %+v, want (1,1,10,9)", cells[1].rect)
	}
	if cells[2].rect != lrect(13, 0, 8, 20) {
		t.Fatalf("b = %+v, want (13,0,8,20)", cells[2].rect)
	}
	if !reflect.DeepEqual(cells, testBoxes(t, &root, 22)) {
		t.Fatalf("non-deterministic layout")
	}
}

func TestGridTracksFrMinmaxSpanAndCumulativeRounding(t *testing.T) {
	root := literalScene(t, "class='grid grid-cols-[4_minmax(2,1fr)_2fr] gap-1'",
		"<tmt-cell id='a'/><tmt-cell id='b'/><tmt-cell id='c'/><tmt-cell id='span' class='col-span-3' />")
	cells := testBoxes(t, &root, 15)
	if cells[0].rect.X != 0 || cells[0].rect.Width != 4 {
		t.Fatalf("a = %+v", cells[0].rect)
	}
	if cells[1].rect.X != 5 || cells[1].rect.Width != 3 {
		t.Fatalf("b = %+v", cells[1].rect)
	}
	if cells[2].rect.X != 9 || cells[2].rect.Width != 6 {
		t.Fatalf("c = %+v", cells[2].rect)
	}
	if cells[3].rect.X != 0 || cells[3].rect.Width != 15 || cells[3].rect.Y != int32(cells[0].rect.Height)+1 {
		t.Fatalf("span = %+v (row0 h=%d)", cells[3].rect, cells[0].rect.Height)
	}

	thirds := literalScene(t, "class='grid grid-cols-[1fr_1fr_1fr]'",
		"<tmt-cell id='a'/><tmt-cell id='b'/><tmt-cell id='c'/>")
	a := testBoxes(t, &thirds, 10)
	got := [][2]int32{{a[0].rect.X, int32(a[0].rect.Width)}, {a[1].rect.X, int32(a[1].rect.Width)}, {a[2].rect.X, int32(a[2].rect.Width)}}
	want := [][2]int32{{0, 3}, {3, 4}, {7, 3}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("thirds = %v, want %v", got, want)
	}
}

func TestGridOverflowKeepsEarlierColumnsAndFourCellCutGuard(t *testing.T) {
	root := literalScene(t, "class='grid grid-cols-[6_8] gap-1'",
		"<tmt-cell id='first'/><tmt-cell id='last' class='truncate-middle'>path/to/file</tmt-cell>")
	c11, err := Layout(&root, [2]uint16{11, 20}, testMeasure)
	if err != nil || !c11[0].Overflowing {
		t.Fatalf("width 11 should overflow: err=%v overflowing=%v", err, c11[0].Overflowing)
	}
	c20, err := Layout(&root, [2]uint16{20, 20}, testMeasure)
	if err != nil || c20[0].Overflowing {
		t.Fatalf("width 20 should not overflow: err=%v overflowing=%v", err, c20[0].Overflowing)
	}
	four := testBoxes(t, &root, 11)
	three := testBoxes(t, &root, 10)
	if four[0].rect != lrect(0, 0, 6, 20) || four[0].clip != lrect(0, 0, 6, 20) {
		t.Fatalf("four[0] = %+v", four[0])
	}
	if four[1].rect != lrect(7, 0, 8, 20) || four[1].clip != lrect(7, 0, 4, 20) || !four[1].cut {
		t.Fatalf("four[1] = %+v", four[1])
	}
	if three[1].clip.Width != 0 || three[1].clip.Height != 0 {
		t.Fatalf("three[1].clip = %+v, want 0x0", three[1].clip)
	}
	if root.Children[1].Style.TextFlow != MiddleFlow() {
		t.Fatalf("last flow != Middle")
	}
	percentages := literalScene(t, "class='grid grid-cols-[50%_50%] gap-2'", "<tmt-cell id='a'/><tmt-cell id='b'/>")
	p := testBoxes(t, &percentages, 12)
	if p[0].rect.Width != 6 || p[1].rect.X != 8 || p[1].rect.Width != 6 || p[1].clip.Width != 4 {
		t.Fatalf("percentages = %+v", p)
	}
}

func TestTextMeasureAndPaintBudgetResizeAndAncestorClips(t *testing.T) {
	root := literalScene(t, "class='grid grid-cols-[1fr_1fr]'",
		"<tmt-text id='wrap' wrap='true'>alpha beta gamma</tmt-text><tmt-col id='outer' class='px-1'><tmt-text id='unicode'>文件</tmt-text><tmt-text id='combining'>e&#x301;</tmt-text><tmt-text id='emoji'>👩‍💻</tmt-text></tmt-col>")
	full := testBoxes(t, &root, 12)
	if full[0].textWidth != 6 {
		t.Fatalf("full[0].textWidth = %d, want 6", full[0].textWidth)
	}
	cells, err := Layout(&root, [2]uint16{12, 20}, testMeasure)
	if err != nil {
		t.Fatalf("Layout: %v", err)
	}
	wrapped := cells[1]
	wantMinH := uint32(testMeasure("alpha beta gamma", WrapFlow(), CellsSpace(wrapped.TextWidth))[1])
	if wrapped.Rect.Height < wantMinH {
		t.Fatalf("wrapped height %d < %d", wrapped.Rect.Height, wantMinH)
	}
	for _, c := range cells {
		if c.Clip.Intersect(lrect(0, 0, 12, 20)) != c.Clip {
			t.Fatalf("clip escaped viewport: %+v", c.Clip)
		}
	}
	if reflect.DeepEqual(full, testBoxes(t, &root, 8)) {
		t.Fatalf("resize to 8 did not change layout")
	}
	if !reflect.DeepEqual(full, testBoxes(t, &root, 12)) {
		t.Fatalf("resize back to 12 changed layout")
	}
	for _, w := range []uint16{0, 1, 2} {
		tiny, err := Layout(&root, [2]uint16{w, 0}, testMeasure)
		if err != nil {
			t.Fatalf("tiny Layout(%d,0): %v", w, err)
		}
		for _, c := range tiny {
			if c.Clip.Width != 0 && c.Clip.Height != 0 {
				t.Fatalf("tiny clip non-empty: %+v", c.Clip)
			}
		}
	}
}

func TestWrappingClampAndFractionalWidthUseTheFinalMeasureBudget(t *testing.T) {
	root := literalScene(t, "class='flex-col'",
		"<tmt-text id='wrap' class='w-7 shrink-0' wrap='true'>alpha beta gamma</tmt-text><tmt-text id='clamp' class='w-7 shrink-0 line-clamp-2'>alpha beta gamma</tmt-text><tmt-text id='padded' class='w-7 px-1 shrink-0' wrap='true'>abcdefghijk</tmt-text><tmt-text id='bounded' class='w-5 max-w-20 shrink-0' wrap='true'>abcdefghijk</tmt-text>")
	cells := testBoxes(t, &root, 12)
	if cells[0].rect.Height != 3 || cells[1].rect.Height != 2 {
		t.Fatalf("wrap/clamp heights = %d, %d, want 3, 2", cells[0].rect.Height, cells[1].rect.Height)
	}
	if cells[2].rect.Height != 3 || cells[2].textWidth != 5 {
		t.Fatalf("padded = %+v, want h=3 tw=5", cells[2])
	}
	if cells[3].rect.Height != 3 || cells[3].textWidth != 5 {
		t.Fatalf("bounded = %+v, want h=3 tw=5", cells[3])
	}

	fractional := literalScene(t, "class='grid grid-cols-[1fr_1fr]'",
		"<tmt-text id='a' wrap='true'>alpha beta gamma</tmt-text><tmt-text id='b'>beta</tmt-text>")
	measured := map[string]uint16{}
	output, err := Layout(&fractional, [2]uint16{11, 20}, func(text string, flow TextFlow, space Space) [2]uint16 {
		if space.Kind == SpaceCells {
			measured[text] = space.Cells
		}
		return testMeasure(text, flow, space)
	})
	if err != nil {
		t.Fatalf("fractional Layout: %v", err)
	}
	for _, c := range output {
		if c.Node.Text != nil && *c.Node.Text != "" {
			gotW, ok := measured[*c.Node.Text]
			if !ok || gotW != c.TextWidth {
				t.Fatalf("measured[%q] = (%d,%v), want %d", *c.Node.Text, gotW, ok, c.TextWidth)
			}
			if c.Content.Width-uint32(c.TextWidth) > 1 {
				t.Fatalf("content width %d too far from text_width %d", c.Content.Width, c.TextWidth)
			}
		}
	}
	fb := testBoxes(t, &fractional, 11)
	if fb[0].rect.Width != 6 || fb[0].textWidth != 5 || fb[1].rect.Width != 5 {
		t.Fatalf("fractional boxes = (%d, %d, %d), want (6, 5, 5)", fb[0].rect.Width, fb[0].textWidth, fb[1].rect.Width)
	}
	wantH := uint32(testMeasure("alpha beta gamma", WrapFlow(), CellsSpace(5))[1])
	if fb[0].rect.Height < wantH {
		t.Fatalf("fractional height %d < %d", fb[0].rect.Height, wantH)
	}
}

func TestFlexBasisBoundsAndShrinkHaveLiteralResults(t *testing.T) {
	root := literalScene(t, "class='flex-row gap-2'",
		"<tmt-cell id='fixed' class='basis-8 shrink-0'/><tmt-cell id='flex' class='basis-[50%] grow min-w-2 max-w-6'/>")
	a := testBoxes(t, &root, 16)
	if a[0].rect.Width != 8 || a[1].rect.X != 10 || a[1].rect.Width != 6 {
		t.Fatalf("width 16 = (%d, %d, %d), want (8, 10, 6)", a[0].rect.Width, a[1].rect.X, a[1].rect.Width)
	}
	b := testBoxes(t, &root, 12)
	if b[0].rect.Width != 8 || b[1].rect.Width != 2 {
		t.Fatalf("width 12 = (%d, %d), want (8, 2)", b[0].rect.Width, b[1].rect.Width)
	}
}

func TestManuallyForgedSceneLimitsFailBeforeEngineAllocation(t *testing.T) {
	root := literalScene(t, "", "")
	root.Style.ColSpan = 0
	if _, err := Layout(&root, [2]uint16{10, 10}, testMeasure); err == nil {
		t.Fatalf("col_span=0 should fail")
	}
	root.Style.ColSpan = 1
	for i := 0; i < MaxDepth; i++ {
		parent := literalScene(t, "", "")
		parent.Children = append(parent.Children, root)
		root = parent
	}
	_, err := Layout(&root, [2]uint16{10, 10}, testMeasure)
	if err == nil || !strings.Contains(err.Error(), "depth/node") {
		t.Fatalf("deep scene err = %v", err)
	}
}

func shownTexts(t *testing.T, root *SceneNode, width uint16) []string {
	t.Helper()
	cells, err := Layout(root, [2]uint16{width, 4}, testMeasure)
	if err != nil {
		t.Fatalf("Layout(%d): %v", width, err)
	}
	var out []string
	for _, c := range cells {
		if c.Node.Text != nil && *c.Node.Text != "" {
			out = append(out, *c.Node.Text)
		}
	}
	return out
}

const geomKeyLine = `<tmt-switch><tmt-case min='lg'><tmt-cell>full</tmt-cell></tmt-case><tmt-case min='md'><tmt-cell>short</tmt-cell></tmt-case><tmt-default><tmt-cell>min</tmt-cell></tmt-default></tmt-switch>`

func TestSwitchPicksTheBranchByWidthAndBoundariesAreInclusiveAtMin(t *testing.T) {
	root := literalScene(t, "", geomKeyLine)
	for _, tc := range []struct {
		width uint16
		want  string
	}{
		{1, "min"}, {79, "min"}, {80, "min"}, {99, "min"},
		{100, "short"}, {139, "short"}, {140, "full"}, {400, "full"},
	} {
		if got := shownTexts(t, &root, tc.width); !reflect.DeepEqual(got, []string{tc.want}) {
			t.Fatalf("width %d: got %v want [%s]", tc.width, got, tc.want)
		}
	}
	for _, w := range []uint16{140, 99, 100, 80, 140} {
		want := "min"
		if w >= 140 {
			want = "full"
		} else if w >= 100 {
			want = "short"
		}
		if got := shownTexts(t, &root, w); !reflect.DeepEqual(got, []string{want}) {
			t.Fatalf("resize %d: got %v want [%s]", w, got, want)
		}
	}
}

func TestSwitchOutputEqualsTheHandWrittenBranchForEveryWidth(t *testing.T) {
	type sig struct {
		rect, content, clip LayoutRect
		text                string
		id                  string
		cut                 bool
	}
	signature := func(root *SceneNode, width uint16) []sig {
		cells, err := Layout(root, [2]uint16{width, 6}, testMeasure)
		if err != nil {
			t.Fatalf("Layout: %v", err)
		}
		out := make([]sig, len(cells))
		for i, c := range cells {
			txt := ""
			if c.Node.Text != nil {
				txt = *c.Node.Text
			}
			out[i] = sig{c.Rect, c.Content, c.Clip, txt, strings.Join(c.Node.ID, "/"), c.Cut}
		}
		return out
	}
	around := func(inner string) SceneNode {
		return literalScene(t, "class='grid grid-cols-[6_1fr_8] gap-x-1'",
			fmt.Sprintf("<tmt-cell id='a'>aa</tmt-cell>%s<tmt-cell id='z'>zz</tmt-cell>", inner))
	}
	sw := around("<tmt-switch><tmt-case min='md'><tmt-cell id='b' class='col-span-2'>wide</tmt-cell></tmt-case><tmt-default><tmt-cell id='b'>narrow</tmt-cell></tmt-default></tmt-switch>")
	wide := around("<tmt-cell id='b' class='col-span-2'>wide</tmt-cell>")
	narrow := around("<tmt-cell id='b'>narrow</tmt-cell>")
	for _, w := range []uint16{60, 99, 100, 130} {
		exp := &narrow
		if w >= 100 {
			exp = &wide
		}
		if !reflect.DeepEqual(signature(&sw, w), signature(exp, w)) {
			t.Fatalf("switch signature != hand-written at width %d", w)
		}
	}
}

func TestContainerWidthIsTheParentContentWidthAndTerminalIsTheViewport(t *testing.T) {
	container := literalScene(t, "class='px-10'", geomKeyLine)
	if !reflect.DeepEqual(shownTexts(t, &container, 120), []string{"short"}) ||
		!reflect.DeepEqual(shownTexts(t, &container, 119), []string{"min"}) ||
		!reflect.DeepEqual(shownTexts(t, &container, 159), []string{"short"}) ||
		!reflect.DeepEqual(shownTexts(t, &container, 160), []string{"full"}) {
		t.Fatalf("padded container switch failed")
	}
	pane := func(of string) SceneNode {
		return literalScene(t, "class='flex-row'",
			fmt.Sprintf("<tmt-col class='w-60'>%s</tmt-col><tmt-col class='grow'/>",
				strings.Replace(geomKeyLine, "<tmt-switch>", fmt.Sprintf("<tmt-switch of='%s'>", of), 1)))
	}
	pCont := pane("container")
	pTerm := pane("terminal")
	if !reflect.DeepEqual(shownTexts(t, &pCont, 200), []string{"min"}) ||
		!reflect.DeepEqual(shownTexts(t, &pTerm, 200), []string{"full"}) ||
		!reflect.DeepEqual(shownTexts(t, &pTerm, 99), []string{"min"}) {
		t.Fatalf("pane container vs terminal switch failed")
	}
}

func TestASwitchInsideAWidthChosenBranchResolvesOnTheNextLevel(t *testing.T) {
	nested := literalScene(t, "",
		"<tmt-switch><tmt-case min='md'><tmt-col class='w-60'><tmt-switch><tmt-case min='lg'><tmt-cell>inner-lg</tmt-cell></tmt-case><tmt-default><tmt-cell>inner-min</tmt-cell></tmt-default></tmt-switch></tmt-col><tmt-switch of='terminal'><tmt-case min='lg'><tmt-cell>outer-lg</tmt-cell></tmt-case><tmt-default><tmt-cell>outer-md</tmt-cell></tmt-default></tmt-switch></tmt-case><tmt-default><tmt-cell>none</tmt-cell></tmt-default></tmt-switch>")
	if !reflect.DeepEqual(shownTexts(t, &nested, 90), []string{"none"}) {
		t.Fatalf("nested(90) = %v", shownTexts(t, &nested, 90))
	}
	if !reflect.DeepEqual(shownTexts(t, &nested, 120), []string{"inner-min", "outer-md"}) {
		t.Fatalf("nested(120) = %v", shownTexts(t, &nested, 120))
	}
	if !reflect.DeepEqual(shownTexts(t, &nested, 200), []string{"inner-min", "outer-lg"}) {
		t.Fatalf("nested(200) = %v", shownTexts(t, &nested, 200))
	}
}

func TestHideBelowRemovesOnlyThatElementAndKeepsTheSiblingsInPlace(t *testing.T) {
	hidden := literalScene(t, "class='flex-row gap-x-1'",
		"<tmt-cell class='w-4'>a</tmt-cell><tmt-cell class='w-4' hide-below='md'>b</tmt-cell><tmt-cell class='w-4'>c</tmt-cell>")
	at := func(width uint16) []struct {
		text string
		x    int32
	} {
		cells, err := Layout(&hidden, [2]uint16{width, 1}, testMeasure)
		if err != nil {
			t.Fatalf("Layout: %v", err)
		}
		var out []struct {
			text string
			x    int32
		}
		for _, c := range cells {
			if c.Node.Text != nil && c.Node.Kind == KindCell {
				out = append(out, struct {
					text string
					x    int32
				}{*c.Node.Text, c.Rect.X})
			}
		}
		return out
	}
	want99 := []struct {
		text string
		x    int32
	}{{"a", 0}, {"c", 5}}
	want100 := []struct {
		text string
		x    int32
	}{{"a", 0}, {"b", 5}, {"c", 10}}
	if !reflect.DeepEqual(at(99), want99) {
		t.Fatalf("at(99) = %+v, want %+v", at(99), want99)
	}
	if !reflect.DeepEqual(at(100), want100) {
		t.Fatalf("at(100) = %+v, want %+v", at(100), want100)
	}
}

func TestTheResolvingPassMeasuresNoBranchText(t *testing.T) {
	count := func(root *SceneNode, width uint16) int {
		calls := 0
		if _, err := Layout(root, [2]uint16{width, 2}, func(text string, flow TextFlow, space Space) [2]uint16 {
			if text != "" {
				calls++
			}
			return testMeasure(text, flow, space)
		}); err != nil {
			t.Fatalf("Layout: %v", err)
		}
		return calls
	}
	sw := literalScene(t, "", "<tmt-switch><tmt-case min='md'><tmt-cell>wide</tmt-cell></tmt-case><tmt-default><tmt-cell>narrow</tmt-cell></tmt-default></tmt-switch>")
	wide := literalScene(t, "", "<tmt-cell>wide</tmt-cell>")
	narrow := literalScene(t, "", "<tmt-cell>narrow</tmt-cell>")
	if count(&sw, 100) != count(&wide, 100) {
		t.Fatalf("switch(100) calls %d != wide(100) calls %d", count(&sw, 100), count(&wide, 100))
	}
	if count(&sw, 99) != count(&narrow, 99) {
		t.Fatalf("switch(99) calls %d != narrow(99) calls %d", count(&sw, 99), count(&narrow, 99))
	}
}
