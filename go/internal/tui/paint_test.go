package tui

// 1:1 mapping from rust/crates/tmt-tui/src/paint/tests.rs (9 #[test] functions):
//
//  1. grapheme_cuts_wrap_clamp_and_controls_share_metrics                         -> TestGraphemeCutsWrapClampAndControlsShareMetrics
//  2. recorded_width_preserves_fractional_blanks_and_wrapped_height               -> TestRecordedWidthPreservesFractionalBlanksAndWrappedHeight
//  3. cut_lines_keep_logical_height_without_rewrapping                            -> TestCutLinesKeepLogicalHeightWithoutRewrapping
//  4. nested_hits_resize_and_buffer_offsets_keep_identity_and_wide_edges_blank    -> TestNestedHitsResizeAndBufferOffsetsKeepIdentityAndWideEdgesBlank
//  5. themes_inheritance_overrides_depth_and_caller_selection_are_exact           -> TestThemesInheritanceOverridesDepthAndCallerSelectionAreExact
//  6. later_sibling_wins_and_reordering_keeps_semantic_identity                   -> TestLaterSiblingWinsAndReorderingKeepsSemanticIdentity
//  7. aligned_board_text_keeps_graphemes_and_intrinsic_width_upper_bound          -> TestAlignedBoardTextKeepsGraphemesAndIntrinsicWidthUpperBound
//  8. caller_decoration_aligns_at_recorded_width_and_retains_scoped_hits          -> TestCallerDecorationAlignsAtRecordedWidthAndRetainsScopedHits
//  9. hits_and_selection_follow_a_stable_id_across_branches_and_resizes           -> TestHitsAndSelectionFollowAStableIDAcrossBranchesAndResizes

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

func paintScene(t *testing.T, attrs, body string) SceneNode {
	t.Helper()
	el, err := Parse("paint.xml", fmt.Sprintf(`<tmt-view version='1' %s>%s</tmt-view>`, attrs, body))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	return elementToScopedScene(el, nil)
}

func elementToScopedScene(el *MarkupElement, scope []string) SceneNode {
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
	nextScope := scope
	if v, ok := el.Attributes["id"]; ok {
		id = append(append([]string(nil), scope...), v)
		nextScope = id
	}
	var rowID *string
	if v, ok := el.Attributes["row-id"]; ok {
		s := v
		rowID = &s
	}
	selected := el.Attributes["selected"] == "true"
	var text *string
	if el.Kind == KindCell || el.Kind == KindText {
		s := el.Text
		text = &s
	}
	children := make([]SceneNode, len(el.Children))
	for i := range el.Children {
		children[i] = elementToScopedScene(&el.Children[i], nextScope)
	}
	return SceneNode{
		Kind:     el.Kind,
		Cond:     cond,
		Style:    el.Style,
		ID:       id,
		RowID:    rowID,
		Selected: selected,
		Text:     text,
		Token:    el.Style.Token,
		Children: children,
	}
}

func bufRow(buffer *Buffer, y uint16) []string {
	out := make([]string, 0, buffer.Area.Width)
	for x := buffer.Area.X; x < buffer.Area.Right(); x++ {
		out = append(out, buffer.At(x, y).Symbol)
	}
	return out
}

func drawTest(t *testing.T, root *SceneNode, size [2]uint16) (*Buffer, []PaintHit) {
	t.Helper()
	cells, err := Layout(root, size, MeasureText)
	if err != nil {
		t.Fatalf("Layout: %v", err)
	}
	buffer := EmptyBuffer(NewRect(0, 0, size[0], size[1]))
	hits := Paint(cells, buffer, clistyle.Theme{}, clistyle.NoColor, func(clistyle.Role) Style {
		return NewStyle().WithModifier(ModifierReversed)
	})
	return buffer, hits
}

func TestGraphemeCutsWrapClampAndControlsShareMetrics(t *testing.T) {
	cases := []struct {
		value    string
		width    uint16
		flow     TextFlow
		expected []string
	}{
		{"文件更多", 5, TruncateFlow(), []string{"文件…"}},
		{"e\u0301abc", 3, TruncateFlow(), []string{"e\u0301a…"}},
		{"👩‍💻🇹🇼xyz", 5, MiddleFlow(), []string{"👩‍💻…yz"}},
		{"abcdefg", 6, MiddleFlow(), []string{"abc…fg"}},
		{"文件", 3, ClipFlow(), []string{"文 "}},
		{"alpha beta gamma", 7, WrapFlow(), []string{"alpha  ", "beta   ", "gamma  "}},
		{"alpha beta gamma", 7, ClampFlow(2), []string{"alpha  ", "beta g…"}},
		{"\x1b[31m", 10, ClipFlow(), []string{`\u{1b}[31m`}},
	}
	for _, tc := range cases {
		got := TextLines(tc.value, tc.width, tc.flow)
		if !reflect.DeepEqual(got, tc.expected) {
			t.Fatalf("TextLines(%q, %d, %+v) = %q, want %q", tc.value, tc.width, tc.flow, got, tc.expected)
		}
		if mh := MeasureText(tc.value, tc.flow, CellsSpace(tc.width))[1]; int(mh) != len(tc.expected) {
			t.Fatalf("MeasureText height = %d, want %d", mh, len(tc.expected))
		}
	}
	if got := MeasureText("👩‍💻🇹🇼e\u0301", ClipFlow(), MaxContentSpace()); got != [2]uint16{5, 1} {
		t.Fatalf("MaxContent = %v, want [5 1]", got)
	}
	if got := MeasureText("ab cdef", WrapFlow(), MinContentSpace()); got != [2]uint16{4, 2} {
		t.Fatalf("MinContent = %v, want [4 2]", got)
	}
	if len(TextLines("a", 0, WrapFlow())) != 0 {
		t.Fatalf("width 0 should return empty")
	}
}

func TestRecordedWidthPreservesFractionalBlanksAndWrappedHeight(t *testing.T) {
	root := paintScene(t, "class='grid grid-cols-[1fr_1fr]'",
		"<tmt-text id='a' wrap='true'>abcd</tmt-text><tmt-text id='b'>z</tmt-text>")
	cells, err := Layout(&root, [2]uint16{5, 4}, MeasureText)
	if err != nil {
		t.Fatalf("Layout: %v", err)
	}
	if cells[1].Content.Width != 3 || cells[1].TextWidth != 2 || cells[1].Rect.Height != 4 {
		t.Fatalf("cells[1] = (%d, %d, %d), want (3, 2, 4)", cells[1].Content.Width, cells[1].TextWidth, cells[1].Rect.Height)
	}
	buffer, hits := drawTest(t, &root, [2]uint16{5, 4})
	if !reflect.DeepEqual(bufRow(buffer, 0), []string{"a", "b", " ", "z", " "}) {
		t.Fatalf("row 0 = %q", bufRow(buffer, 0))
	}
	if !reflect.DeepEqual(bufRow(buffer, 1), []string{"c", "d", " ", " ", " "}) {
		t.Fatalf("row 1 = %q", bufRow(buffer, 1))
	}
	if h := HitAt(hits, 2, 1); h == nil || !reflect.DeepEqual(h.ID, []string{"a"}) {
		t.Fatalf("hit(2,1) = %+v, want [a]", h)
	}

	padded := paintScene(t, "", "<tmt-text class='w-7 px-1 shrink-0' wrap='true'>abcdefgh</tmt-text>")
	pcells, err := Layout(&padded, [2]uint16{8, 4}, MeasureText)
	if err != nil {
		t.Fatalf("Layout padded: %v", err)
	}
	if pcells[1].TextWidth != 5 || pcells[1].Rect.Height != 2 {
		t.Fatalf("padded = (%d, %d), want (5, 2)", pcells[1].TextWidth, pcells[1].Rect.Height)
	}
	pbuf, _ := drawTest(t, &padded, [2]uint16{8, 4})
	if !reflect.DeepEqual(bufRow(pbuf, 1), []string{" ", "f", "g", "h", " ", " ", " ", " "}) {
		t.Fatalf("padded row 1 = %q", bufRow(pbuf, 1))
	}
}

func TestCutLinesKeepLogicalHeightWithoutRewrapping(t *testing.T) {
	root := paintScene(t, "class='grid grid-cols-[4_8]'",
		"<tmt-cell>head</tmt-cell><tmt-row id='cut' row-id='member' class='flex-col'><tmt-text wrap='true'>abcdefgh ijklmnop</tmt-text></tmt-row>")
	buffer, hits := drawTest(t, &root, [2]uint16{8, 4})
	if !reflect.DeepEqual(bufRow(buffer, 0), []string{"h", "e", "a", "d", "a", "b", "c", "…"}) {
		t.Fatalf("row 0 = %q", bufRow(buffer, 0))
	}
	if !reflect.DeepEqual(bufRow(buffer, 1), []string{" ", " ", " ", " ", "i", "j", "k", "…"}) {
		t.Fatalf("row 1 = %q", bufRow(buffer, 1))
	}
	if h := HitAt(hits, 7, 1); h == nil || h.RowID == nil || *h.RowID != "member" {
		t.Fatalf("hit(7,1) = %+v", h)
	}
	_, hits7 := drawTest(t, &root, [2]uint16{7, 4})
	for _, h := range hits7 {
		if h.RowID != nil && *h.RowID == "member" {
			t.Fatalf("width 7 should hide member hit: %+v", h)
		}
	}
	fullBuf, _ := drawTest(t, &root, [2]uint16{12, 4})
	if !reflect.DeepEqual(bufRow(fullBuf, 0)[4:], []string{"a", "b", "c", "d", "e", "f", "g", "h"}) {
		t.Fatalf("full row 0 = %q", bufRow(fullBuf, 0))
	}
}

func TestNestedHitsResizeAndBufferOffsetsKeepIdentityAndWideEdgesBlank(t *testing.T) {
	root := paintScene(t, "id='outer'",
		"<tmt-row id='inner' row-id='member' class='w-5 px-1 flex-col'><tmt-text id='leaf'>文件</tmt-text></tmt-row>")
	for _, width := range []uint16{120, 80, 120, 1, 0} {
		_, hits := drawTest(t, &root, [2]uint16{width, 3})
		for _, h := range hits {
			if h.Rect.Width == 0 || h.Rect.Height == 0 {
				t.Fatalf("empty hit emitted: %+v", h)
			}
		}
		if width > 5 {
			if !reflect.DeepEqual(HitAt(hits, 1, 0).ID, []string{"outer", "inner", "leaf"}) ||
				!reflect.DeepEqual(HitAt(hits, 0, 0).ID, []string{"outer", "inner"}) ||
				!reflect.DeepEqual(HitAt(hits, 6, 0).ID, []string{"outer"}) {
				t.Fatalf("nested hits mismatch at width %d", width)
			}
		}
	}
	wideRoot := paintScene(t, "", "<tmt-text id='wide'>文件</tmt-text>")
	cells, err := Layout(&wideRoot, [2]uint16{4, 1}, MeasureText)
	if err != nil {
		t.Fatalf("Layout: %v", err)
	}
	buf := EmptyBuffer(NewRect(1, 0, 2, 1))
	hits := Paint(cells, buf, clistyle.Theme{}, clistyle.NoColor, func(clistyle.Role) Style { return NewStyle() })
	if !reflect.DeepEqual(bufRow(buf, 0), []string{" ", " "}) {
		t.Fatalf("offset wide edge = %q, want [\" \", \" \"]", bufRow(buf, 0))
	}
	if hits[0].Rect != (LayoutRect{X: 1, Y: 0, Width: 2, Height: 1}) {
		t.Fatalf("offset hit rect = %+v", hits[0].Rect)
	}
	if HitAt(hits, 0, 0) != nil {
		t.Fatalf("HitAt(0,0) should be nil")
	}
}

func TestThemesInheritanceOverridesDepthAndCallerSelectionAreExact(t *testing.T) {
	root := paintScene(t, "token='dim'", "<tmt-text>文件</tmt-text><tmt-text token='waiting'>x</tmt-text>")
	cases := []struct {
		base clistyle.ThemeBase
		d    clistyle.Depth
		fg   Color
		mod  Modifier
	}{
		{clistyle.ThemeDark, clistyle.TrueColor, RGBColor(133, 133, 133), ModifierEmpty},
		{clistyle.ThemeLight, clistyle.TrueColor, RGBColor(118, 118, 118), ModifierEmpty},
		{clistyle.ThemeTerminal, clistyle.ANSI16, ResetColor, ModifierDim},
		{clistyle.ThemeMono, clistyle.TrueColor, ResetColor, ModifierDim},
		{clistyle.ThemeDark, clistyle.NoColor, ResetColor, ModifierEmpty},
	}
	for _, tc := range cases {
		cells, err := Layout(&root, [2]uint16{4, 3}, MeasureText)
		if err != nil {
			t.Fatalf("Layout: %v", err)
		}
		buf := EmptyBuffer(NewRect(0, 0, 4, 3))
		Paint(cells, buf, clistyle.Theme{Base: tc.base}, tc.d, func(clistyle.Role) Style {
			t.Fatalf("unexpected selected callback")
			return NewStyle()
		})
		if buf.At(0, 0).Symbol != "文" {
			t.Fatalf("symbol(0,0) = %q", buf.At(0, 0).Symbol)
		}
		for x := uint16(0); x < 4; x++ {
			c := buf.At(x, 0)
			if c.Fg != tc.fg || c.Modifier != tc.mod {
				t.Fatalf("base=%v depth=%v x=%d got (%+v,%v) want (%+v,%v)", tc.base, tc.d, x, c.Fg, c.Modifier, tc.fg, tc.mod)
			}
		}
	}

	selRoot := paintScene(t, "selected='true'", "<tmt-text token='dim' class='w-3'>文件</tmt-text>")
	selCells, _ := Layout(&selRoot, [2]uint16{4, 2}, MeasureText)
	selBuf := EmptyBuffer(NewRect(0, 0, 4, 2))
	selStyle := NewStyle().WithModifier(ModifierReversed)
	var roles []clistyle.Role
	Paint(selCells, selBuf, clistyle.Theme{}, clistyle.NoColor, func(role clistyle.Role) Style {
		roles = append(roles, role)
		return selStyle
	})
	if !reflect.DeepEqual(roles, []clistyle.Role{clistyle.RoleText, clistyle.RoleDim}) {
		t.Fatalf("selected roles = %v", roles)
	}
	for _, c := range selBuf.Content {
		if c.Modifier != ModifierReversed || c.Fg != ResetColor {
			t.Fatalf("selected cell = %+v", c)
		}
	}

	ovrRoot := paintScene(t, "token='waiting'", "<tmt-text>x</tmt-text>")
	ovrCells, _ := Layout(&ovrRoot, [2]uint16{2, 1}, MeasureText)
	ovrTheme, err := clistyle.ParseTheme("theme", map[string]string{"waiting": "green"})
	if err != nil {
		t.Fatalf("ParseTheme: %v", err)
	}
	Paint(ovrCells, selBuf, ovrTheme, clistyle.ANSI16, func(clistyle.Role) Style { return NewStyle() })
	if selBuf.At(0, 0).Fg != GreenColor {
		t.Fatalf("override fg = %+v, want Green", selBuf.At(0, 0).Fg)
	}
}

func TestLaterSiblingWinsAndReorderingKeepsSemanticIdentity(t *testing.T) {
	root := paintScene(t, "class='flex-row'", "<tmt-text id='a'>aa</tmt-text><tmt-text id='b'>bb</tmt-text>")
	for _, expected := range []string{"b", "a"} {
		cells, _ := Layout(&root, [2]uint16{4, 1}, MeasureText)
		cells[2].Rect = cells[1].Rect
		cells[2].Content = cells[1].Content
		cells[2].Clip = cells[1].Clip
		buf := EmptyBuffer(NewRect(0, 0, 4, 1))
		hits := Paint(cells, buf, clistyle.Theme{}, clistyle.NoColor, func(clistyle.Role) Style { return NewStyle() })
		if !reflect.DeepEqual(HitAt(hits, 0, 0).ID, []string{expected}) {
			t.Fatalf("hit = %v, want [%s]", HitAt(hits, 0, 0).ID, expected)
		}
		if buf.At(0, 0).Symbol != expected {
			t.Fatalf("symbol = %q, want %q", buf.At(0, 0).Symbol, expected)
		}
		root.Children[0], root.Children[1] = root.Children[1], root.Children[0]
	}
}

func TestAlignedBoardTextKeepsGraphemesAndIntrinsicWidthUpperBound(t *testing.T) {
	cases := []struct {
		value    string
		width    uint16
		flow     TextFlow
		align    clistyle.Align
		expected string
	}{
		{"e\u0301", 4, TruncateFlow(), clistyle.AlignRight, "   e\u0301"},
		{"👩‍💻", 5, MiddleFlow(), clistyle.AlignCenter, " 👩‍💻  "},
		{"👩‍💻xyz", 4, TruncateFlow(), clistyle.AlignRight, "👩‍💻x…"},
		{"文", 1, TruncateFlow(), clistyle.AlignLeft, "…"},
		{"x ", 4, TruncateFlow(), clistyle.AlignRight, "  x "},
	}
	for _, tc := range cases {
		if got := FitLine(tc.value, tc.width, tc.flow, tc.align); got != tc.expected {
			t.Fatalf("FitLine(%q, %d) = %q, want %q", tc.value, tc.width, got, tc.expected)
		}
	}
	if got := FitLines("one two three", 6, ClampFlow(2), clistyle.AlignRight); !reflect.DeepEqual(got, []string{"   one", "two t…"}) {
		t.Fatalf("FitLines = %q", got)
	}
	if got := MeasureText("a a a", WrapFlow(), CellsSpace(4)); got != [2]uint16{4, 2} {
		t.Fatalf("MeasureText(a a a) = %v, want [4 2]", got)
	}
	if got := TextLines("a a a", 4, WrapFlow()); !reflect.DeepEqual(got, []string{"a a ", "a   "}) {
		t.Fatalf("TextLines(a a a) = %q", got)
	}
	if got := FitLine("abcdef", 0, TruncateFlow(), clistyle.AlignCenter); got != "" {
		t.Fatalf("FitLine width 0 = %q", got)
	}
}

func TestCallerDecorationAlignsAtRecordedWidthAndRetainsScopedHits(t *testing.T) {
	root := paintScene(t, "class='grid grid-cols-[1fr_1fr]'",
		"<tmt-text id='left' token='waiting'>x</tmt-text><tmt-text id='right' token='review'>y</tmt-text>")
	cells, _ := Layout(&root, [2]uint16{9, 1}, MeasureText)
	buf := EmptyBuffer(NewRect(0, 0, 9, 1))
	hits := PaintWith(cells, buf, func(index int, role clistyle.Role, selected bool) (Style, clistyle.Align) {
		if selected {
			t.Fatalf("unexpected selected")
		}
		if index == 1 && role != clistyle.RoleWaiting {
			t.Fatalf("index 1 role = %v", role)
		}
		if index == 2 && role != clistyle.RoleReview {
			t.Fatalf("index 2 role = %v", role)
		}
		return NewStyle().WithFg(GreenColor), clistyle.AlignRight
	})
	if !reflect.DeepEqual(bufRow(buf, 0), []string{" ", " ", " ", "x", " ", " ", " ", " ", "y"}) {
		t.Fatalf("aligned row = %q", bufRow(buf, 0))
	}
	if buf.At(4, 0).Fg != GreenColor {
		t.Fatalf("cell(4,0).Fg = %+v", buf.At(4, 0).Fg)
	}
	if !reflect.DeepEqual(HitAt(hits, 4, 0).ID, []string{"left"}) || !reflect.DeepEqual(HitAt(hits, 8, 0).ID, []string{"right"}) {
		t.Fatalf("scoped hits mismatch")
	}
}

func TestHitsAndSelectionFollowAStableIDAcrossBranchesAndResizes(t *testing.T) {
	root := paintScene(t, "class='flex-row'",
		"<tmt-row id='row' row-id='member-1' selected='true' class='w-full'>"+
			"<tmt-cell id='name' class='w-6'>rin</tmt-cell>"+
			"<tmt-switch><tmt-case min='md'><tmt-cell id='squad' class='grow'>squad</tmt-cell></tmt-case>"+
			"<tmt-default><tmt-cell id='squad' class='grow'>s</tmt-cell></tmt-default></tmt-switch>"+
			"</tmt-row>")
	for _, tc := range []struct {
		width uint16
		label string
	}{{120, "squad"}, {99, "s"}, {100, "squad"}, {80, "s"}} {
		buf, hits := drawTest(t, &root, [2]uint16{tc.width, 1})
		text := strings.Join(bufRow(buf, 0), "")
		if !strings.HasPrefix(text, "rin   "+tc.label) {
			t.Fatalf("width %d: text = %q", tc.width, text)
		}
		squad := HitAt(hits, 6, 0)
		if squad == nil || !reflect.DeepEqual(squad.ID, []string{"row", "squad"}) || squad.RowID == nil || *squad.RowID != "member-1" {
			t.Fatalf("width %d: squad hit = %+v", tc.width, squad)
		}
		if !buf.At(6, 0).Modifier.Contains(ModifierReversed) {
			t.Fatalf("width %d: squad cell not reversed", tc.width)
		}
		if !reflect.DeepEqual(HitAt(hits, 0, 0).ID, []string{"row", "name"}) {
			t.Fatalf("width %d: name hit mismatch", tc.width)
		}
	}
}
