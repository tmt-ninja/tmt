package tui

// 1:1 mapping from rust/crates/tmt-tui/src/tests.rs (9 #[test] functions) and text.rs (1 #[test]):
//
//  1. literal_board_and_xml_escaping_are_preserved                       -> TestLiteralBoardAndXMLEscapingArePreserved
//  2. version_and_structure_fail_before_any_rendering                    -> TestVersionAndStructureFailBeforeAnyRendering
//  3. repeat_templates_are_checked_without_materialized_rows             -> TestRepeatTemplatesAreCheckedWithoutMaterializedRows
//  4. byte_depth_and_node_limits_have_positive_boundary_controls         -> TestByteDepthAndNodeLimitsHavePositiveBoundaryControls
//  5. depth_preflight_ignores_xml_literals_but_not_real_nested_tags      -> TestDepthPreflightIgnoresXMLLiteralsButNotRealNestedTags
//  6. dtd_and_entity_expansion_are_refused                               -> TestDTDAndEntityExpansionAreRefused
//  7. switch_admits_ordered_cases_with_a_default                         -> TestSwitchAdmitsOrderedCasesWithADefault
//  8. switch_rejects_what_would_leave_a_gap_overlap_or_raw_number        -> TestSwitchRejectsWhatWouldLeaveAGapOverlapOrRawNumber
//  9. hide_below_is_a_switch_with_the_element_and_an_empty_default       -> TestHideBelowIsASwitchWithTheElementAndAnEmptyDefault
// 10. one_visible_grapheme_fits_one_or_two_cells_without_joiners (text)  -> TestOneVisibleGraphemeFitsOneOrTwoCellsWithoutJoiners

import (
	"fmt"
	"strings"
	"testing"
)

func wrapView(body string) string {
	return fmt.Sprintf(`<tmt-view version="1">%s</tmt-view>`, body)
}

func assertRejects(t *testing.T, source, message string) {
	t.Helper()
	_, err := Parse("board.xml", source)
	if err == nil {
		t.Fatalf("expected error containing %q for %q, got nil", message, source)
	}
	me, ok := err.(*MarkupError)
	if !ok {
		t.Fatalf("expected *MarkupError, got %T: %v", err, err)
	}
	if !strings.Contains(me.Message, message) {
		t.Fatalf("error %q does not contain %q", me.Error(), message)
	}
	if !strings.HasPrefix(me.Error(), "board.xml:") {
		t.Fatalf("error %q missing file prefix", me.Error())
	}
	if me.Location.Line == 0 || me.Location.Column == 0 {
		t.Fatalf("error %q has zero location: %+v", me.Error(), me.Location)
	}
}

func TestLiteralBoardAndXMLEscapingArePreserved(t *testing.T) {
	root, err := Parse("board.xml", wrapView("\n<tmt-row id=\"header\"><tmt-text>A &amp; B &lt; C &#x754c;</tmt-text></tmt-row>\n<tmt-col><tmt-cell from=\"member\"/></tmt-col>"))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if root.Kind != KindView || len(root.Children) != 2 {
		t.Fatalf("root kind/children = %v/%d", root.Kind, len(root.Children))
	}
	if root.Children[0].Location != (Location{Line: 2, Column: 1}) {
		t.Fatalf("child[0].Location = %+v, want {2 1}", root.Children[0].Location)
	}
	if root.Children[0].Attributes["id"] != "header" {
		t.Fatalf("id = %q", root.Children[0].Attributes["id"])
	}
	if root.Children[0].Children[0].Text != "A & B < C 界" {
		t.Fatalf("text = %q", root.Children[0].Children[0].Text)
	}
	if root.Children[1].Children[0].Attributes["from"] != "member" {
		t.Fatalf("from = %q", root.Children[1].Children[0].Attributes["from"])
	}
}

func TestVersionAndStructureFailBeforeAnyRendering(t *testing.T) {
	for _, source := range []string{`<tmt-view/>`, `<tmt-view version="2"/>`, `<tmt-row version="1"/>`} {
		assertRejects(t, source, "root must be")
	}
	for _, tc := range []struct{ body, message string }{
		{`<other/>`, "unknown element"},
		{`<tmt-view version="1"/>`, "nested tmt-view"},
		{`<tmt-row width="2"/>`, `width="2"`},
		{`<tmt-row version="1"/>`, `version="1"`},
		{`<tmt-text><tmt-cell/></tmt-text>`, "cannot contain elements"},
		{`<tmt-col>unexpected</tmt-col>`, "literal text"},
		{`<tmt-cell bind="row.name">literal</tmt-cell>`, "literal text"},
		{`<tmt-cell from="member">literal</tmt-cell>`, "literal text"},
		{`<tmt-cell bind="x" from="member"/>`, "either bind or from"},
		{`<tmt-row id="x" id-bind="row.id"/>`, "either id or id-bind"},
		{`<tmt-row row-id="x" row-bind="row.id"/>`, "either row-id or row-bind"},
		{`<tmt-repeat each="rows"/>`, "requires nonempty as"},
		{`<tmt-repeat each="" as="row"/>`, "requires nonempty each"},
		{`<tmt-row xmlns="urn:evil"/>`, "namespaces"},
		{`<tmt-row xmlns:x="urn:evil"/>`, "namespaces"},
	} {
		assertRejects(t, wrapView(tc.body), tc.message)
	}
	for _, source := range []string{
		`<`,
		`<tmt-view version="1">`,
		`<tmt-view version="1" version="1"/>`,
		`<tmt-view version="1"/><tmt-view version="1"/>`,
	} {
		if _, err := Parse("broken.xml", source); err == nil {
			t.Fatalf("expected error for %q", source)
		}
	}
	_, err := Parse("board.xml", wrapView("\n  <tmt-cell wrong=\"value\"/>"))
	if err == nil || err.Error() != `board.xml:2:3: <tmt-cell>: attribute wrong="value" is not allowed` {
		t.Fatalf("err = %v", err)
	}
}

func TestRepeatTemplatesAreCheckedWithoutMaterializedRows(t *testing.T) {
	assertRejects(t, wrapView(`<tmt-repeat each="rows" as="row"><tmt-bad/></tmt-repeat>`), "unknown element")
	if _, err := Parse("board.xml", wrapView(`<tmt-repeat each="rows" as="row"><tmt-cell bind="row.name"/></tmt-repeat>`)); err != nil {
		t.Fatalf("valid repeat failed: %v", err)
	}
}

func TestByteDepthAndNodeLimitsHavePositiveBoundaryControls(t *testing.T) {
	overhead := len(wrapView(`<tmt-text></tmt-text>`))
	source := wrapView(`<tmt-text>` + strings.Repeat("x", MaxBytes-overhead) + `</tmt-text>`)
	if len(source) != MaxBytes {
		t.Fatalf("source len = %d, want %d", len(source), MaxBytes)
	}
	if _, err := Parse("limit.xml", source); err != nil {
		t.Fatalf("exact MaxBytes failed: %v", err)
	}
	assertRejects(t, source+" ", "256 KiB")

	nested := func(count int) string {
		return wrapView(strings.Repeat("<tmt-col>", count) + strings.Repeat("</tmt-col>", count))
	}
	if _, err := Parse("limit.xml", nested(MaxDepth-1)); err != nil {
		t.Fatalf("MaxDepth-1 failed: %v", err)
	}
	assertRejects(t, nested(MaxDepth), "nesting exceeds")

	if _, err := Parse("limit.xml", wrapView(strings.Repeat("<tmt-cell/>", MaxNodes-2))); err != nil {
		t.Fatalf("MaxNodes-2 failed: %v", err)
	}
	assertRejects(t, wrapView(strings.Repeat("<tmt-cell/>", MaxNodes-1)), "nodes limit")

	assertRejects(t, strings.Repeat("<tmt-col>", MaxDepth+1)+"<", "nesting exceeds")
	assertRejects(t, strings.Repeat("<", MaxBytes+1), "256 KiB")
}

func TestDepthPreflightIgnoresXMLLiteralsButNotRealNestedTags(t *testing.T) {
	decoys := strings.Repeat("<tmt-col>", MaxDepth+1)
	source := wrapView(fmt.Sprintf(`<!--%s--><?probe %s?><tmt-text><![CDATA[%s]]></tmt-text><tmt-cell id="greater > sign"/>`, decoys, decoys, decoys))
	if _, err := Parse("literal.xml", source); err != nil {
		t.Fatalf("decoy literals failed: %v", err)
	}
	assertRejects(t, fmt.Sprintf(`<tmt-view version="1">%s<tmt-cell/>%s`, strings.Repeat("<tmt-col>", MaxDepth-1), strings.Repeat("</tmt-col>", MaxDepth-1)), "nesting exceeds")
}

func TestDTDAndEntityExpansionAreRefused(t *testing.T) {
	decls := `<!ENTITY a 'ha'><!ENTITY b '&a;&a;&a;&a;'><!ENTITY c '&b;&b;&b;&b;'>`
	assertRejects(t, fmt.Sprintf(`<!DOCTYPE tmt-view [%s]>%s`, decls, wrapView(`<tmt-text>&c;</tmt-text>`)), "DOCTYPE")
	assertRejects(t, fmt.Sprintf(`<!DOCTYPE tmt-view SYSTEM 'file:///not-opened'>%s`, wrapView("")), "DOCTYPE")
	if _, err := Parse("entity.xml", wrapView(`<tmt-text>&unknown;</tmt-text>`)); err == nil {
		t.Fatalf("unknown entity should fail")
	}
	root, err := Parse("entity.xml", wrapView(`<tmt-text>&amp;&lt;&gt;&quot;&apos;</tmt-text>`))
	if err != nil || root.Children[0].Text != `&<>"'` {
		t.Fatalf("standard entities = %q err=%v", root.Children[0].Text, err)
	}
}

const keyLineMarkup = `<tmt-switch><tmt-case min="lg"><tmt-text>full</tmt-text></tmt-case><tmt-case min="md"><tmt-text>short</tmt-text></tmt-case><tmt-default><tmt-text>min</tmt-text></tmt-default></tmt-switch>`

func TestSwitchAdmitsOrderedCasesWithADefault(t *testing.T) {
	root, err := Parse("switch.xml", wrapView(keyLineMarkup))
	if err != nil {
		t.Fatalf("Parse switch: %v", err)
	}
	sw := root.Children[0]
	if sw.Kind != KindSwitch || len(sw.Children) != 3 {
		t.Fatalf("switch = %+v", sw)
	}
	if sw.Children[0].Kind != KindCase || sw.Children[1].Kind != KindCase || sw.Children[2].Kind != KindDefault {
		t.Fatalf("branch kinds mismatch")
	}
	if sw.Children[1].Attributes["min"] != "md" {
		t.Fatalf("case 1 min = %q", sw.Children[1].Attributes["min"])
	}
	for _, of := range []string{"container", "terminal"} {
		src := strings.Replace(keyLineMarkup, "<tmt-switch>", fmt.Sprintf(`<tmt-switch of="%s">`, of), 1)
		if _, err := Parse("switch.xml", wrapView(src)); err != nil {
			t.Fatalf("switch of=%s failed: %v", of, err)
		}
	}
}

func TestSwitchRejectsWhatWouldLeaveAGapOverlapOrRawNumber(t *testing.T) {
	mkCase := func(min string) string {
		return fmt.Sprintf(`<tmt-case min="%s"><tmt-text>x</tmt-text></tmt-case>`, min)
	}
	def := `<tmt-default/>`
	sw := func(body string) string { return wrapView(`<tmt-switch>` + body + `</tmt-switch>`) }
	for _, tc := range []struct{ source, msg string }{
		{sw(mkCase("100") + def), "breakpoint name (sm, md, lg)"},
		{sw(mkCase("MD") + def), "breakpoint name"},
		{sw(mkCase("") + def), "breakpoint name"},
		{sw(`<tmt-case max="md"/>` + def), `max="md"`},
		{sw(`<tmt-case/>` + def), "requires min"},
		{sw(mkCase("md") + mkCase("lg") + def), `must come before "md"`},
		{sw(mkCase("md") + mkCase("md") + def), "never repeat"},
		{sw(mkCase("md")), "requires a final <tmt-default>"},
		{sw(def + mkCase("md")), "single last"},
		{sw(mkCase("md") + def + def), "single last"},
		{sw(def), "at least one <tmt-case"},
		{sw(""), "at least one <tmt-case"},
		{sw(mkCase("md") + `<tmt-row/>` + def), "holds only"},
		{wrapView(mkCase("md")), "belong directly inside <tmt-switch>"},
		{wrapView(`<tmt-row>` + def + `</tmt-row>`), "belong directly inside"},
		{wrapView(`<tmt-switch><tmt-case min="md">` + mkCase("sm") + `</tmt-case>` + def + `</tmt-switch>`), "belong directly inside"},
		{wrapView(`<tmt-switch of="screen"><tmt-default/></tmt-switch>`), "container or terminal"},
		{wrapView(`<tmt-switch class="flex"><tmt-default/></tmt-switch>`), "class="},
		{wrapView(`<tmt-switch><tmt-case min="md" id="x"/><tmt-default/></tmt-switch>`), "id="},
		{wrapView(`<tmt-switch><tmt-case min="md"/><tmt-default token="dim"/></tmt-switch>`), "token="},
	} {
		assertRejects(t, tc.source, tc.msg)
	}
	_, err := Parse("switch.xml", wrapView(fmt.Sprintf("<tmt-switch>\n%s\n%s\n%s</tmt-switch>", mkCase("md"), mkCase("lg"), def)))
	me := err.(*MarkupError)
	if me.Location.Line != 3 {
		t.Fatalf("offending branch line = %d, want 3 (%v)", me.Location.Line, me)
	}
}

func TestHideBelowIsASwitchWithTheElementAndAnEmptyDefault(t *testing.T) {
	root, err := Parse("hide.xml", wrapView(`<tmt-cell id="squad" hide-below="md">squad</tmt-cell>`))
	if err != nil {
		t.Fatalf("Parse hide-below: %v", err)
	}
	sw := root.Children[0]
	if sw.Kind != KindSwitch || len(sw.Attributes) != 0 || len(sw.Children) != 2 {
		t.Fatalf("switch = %+v", sw)
	}
	cs, def := sw.Children[0], sw.Children[1]
	if cs.Kind != KindCase || cs.Attributes["min"] != "md" || def.Kind != KindDefault || len(def.Children) != 0 {
		t.Fatalf("branches = %+v, %+v", cs, def)
	}
	cell := cs.Children[0]
	if cell.Kind != KindCell || cell.Text != "squad" {
		t.Fatalf("cell = %+v", cell)
	}
	if _, ok := cell.Attributes["hide-below"]; ok {
		t.Fatalf("hide-below not removed from cell")
	}
	for _, tag := range []string{"tmt-row", "tmt-col", "tmt-text"} {
		if _, err := Parse("hide.xml", wrapView(fmt.Sprintf(`<%s hide-below="sm"/>`, tag))); err != nil {
			t.Fatalf("%s hide-below failed: %v", tag, err)
		}
	}
	for _, tc := range []struct{ body, msg string }{
		{`<tmt-cell hide-below="100"/>`, "breakpoint name"},
		{`<tmt-cell hide-below=""/>`, "breakpoint name"},
		{`<tmt-repeat each="$.x" as="x" hide-below="md"/>`, "hide-below"},
		{`<tmt-switch hide-below="md"><tmt-default/></tmt-switch>`, "hide-below"},
	} {
		assertRejects(t, wrapView(tc.body), tc.msg)
	}
}

func TestOneVisibleGraphemeFitsOneOrTwoCellsWithoutJoiners(t *testing.T) {
	for _, text := range []string{"P", "界", "★", "e\u0301", "😀"} {
		if !IsSingleCellOrWideGrapheme(text) {
			t.Errorf("IsSingleCellOrWideGrapheme(%q) = false, want true", text)
		}
	}
	for _, text := range []string{"", " ", "\n", "ab", "\u0301", "👩\u200d💻"} {
		if IsSingleCellOrWideGrapheme(text) {
			t.Errorf("IsSingleCellOrWideGrapheme(%q) = true, want false", text)
		}
	}
}
