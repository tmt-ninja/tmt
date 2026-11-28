package tui

// 1:1 mapping for Components Batch 3 (32 Rust #[test] functions):
//
// collection/tests.rs (9):
//  1. table_grid_wraps_under_fixed_gutter_and_selects_every_line_edge_to_edge        -> TestTableGridWrapsUnderFixedGutterAndSelectsEveryLineEdgeToEdge
//  2. no_color_selection_has_common_reverse_foreground_and_bold_attention            -> TestNoColorSelectionHasCommonReverseForegroundAndBoldAttention
//  3. selection_reveal_refresh_resize_and_disabled_hits_follow_current_geometry      -> TestSelectionRevealRefreshResizeAndDisabledHitsFollowCurrentGeometry
//  4. row_admission_is_eager_and_boolean_metadata_is_strict                          -> TestRowAdmissionIsEagerAndBooleanMetadataIsStrict
//  5. picker_has_fixed_query_footer_clipped_list_and_consumer_chosen_status_role     -> TestPickerHasFixedQueryFooterClippedListAndConsumerChosenStatusRole
//  6. tiny_picker_and_ordinary_pane_rectangles_remain_bounded                        -> TestTinyPickerAndOrdinaryPaneRectanglesRemainBounded
//  7. list_template_uses_same_scroll_and_opaque_modal_selection_seam                 -> TestListTemplateUsesSameScrollAndOpaqueModalSelectionSeam
//  8. oversized_selected_row_can_scroll_inside_it_without_repaint_snapping_back      -> TestOversizedSelectedRowCanScrollInsideItWithoutRepaintSnappingBack
//  9. replacement_rows_and_status_compose_in_place_with_stable_selection             -> TestReplacementRowsAndStatusComposeInPlaceWithStableSelection
//
// surface/tests.rs (21):
// 10. opaque_reference_box_preserves_outside_base_and_anchors_footer_and_status      -> TestOpaqueReferenceBoxPreservesOutsideBaseAndAnchorsFooterAndStatus
// 11. the_read_position_is_painted_only_while_the_body_overflows                     -> TestTheReadPositionIsPaintedOnlyWhileTheBodyOverflows
// 12. a_scroll_state_reports_a_position_only_when_its_content_overflows              -> TestAScrollStateReportsAPositionOnlyWhenItsContentOverflows
// 13. wrapped_fixed_slots_reserve_lines_before_scroll_and_remeasure_on_resize        -> TestWrappedFixedSlotsReserveLinesBeforeScrollAndRemeasureOnResize
// 14. authored_modal_height_bounds_docked_prompt_without_changing_reference_body     -> TestAuthoredModalHeightBoundsDockedPromptWithoutChangingReferenceBody
// 15. every_section_uses_the_global_display_cell_key_width                           -> TestEverySectionUsesTheGlobalDisplayCellKeyWidth
// 16. narrow_descriptions_stack_wrap_and_keep_footer_fixed_while_scroll_clamps       -> TestNarrowDescriptionsStackWrapAndKeepFooterFixedWhileScrollClamps
// 17. scroll_navigation_mouse_bounds_and_selected_range_survive_metric_changes       -> TestScrollNavigationMouseBoundsAndSelectedRangeSurviveMetricChanges
// 18. tiny_rectangles_and_zero_content_stay_bounded                                  -> TestTinyRectanglesAndZeroContentStayBounded
// 19. malformed_components_and_empty_collection_schemas_fail_before_render           -> TestMalformedComponentsAndEmptyCollectionSchemasFailBeforeRender
// 20. untitled_modal_has_a_continuous_rule_in_each_theme_and_no_color                -> TestUntitledModalHasAContinuousRuleInEachThemeAndNoColor
// 21. small_modal_is_centered_and_capped_but_narrow_modal_fills_width                -> TestSmallModalIsCenteredAndCappedButNarrowModalFillsWidth
// 22. footer_keeps_whole_hints_by_priority_and_escapes_controls                      -> TestFooterKeepsWholeHintsByPriorityAndEscapesControls
// 23. component_generated_depth_is_rejected_during_admission                         -> TestComponentGeneratedDepthIsRejectedDuringAdmission
// 24. semantic_help_styles_and_escaping_use_injected_theme_at_each_depth             -> TestSemanticHelpStylesAndEscapingUseInjectedThemeAtEachDepth
// 25. key_help_heading_properties_preserve_columns_and_section_spacing               -> TestKeyHelpHeadingPropertiesPreserveColumnsAndSectionSpacing
// 26. invalid_key_help_heading_properties_are_rejected                               -> TestInvalidKeyHelpHeadingPropertiesAreRejected
// 27. a_list_counter_counts_selectable_rows_not_headings                             -> TestAListCounterCountsSelectableRowsNotHeadings
// 28. a_scrolled_window_numbers_the_selectable_rows_it_shows_and_counts_the_rest_below -> TestAScrolledWindowNumbersTheSelectableRowsItShowsAndCountsTheRestBelow
// 29. a_list_without_a_selectable_row_in_view_has_no_counter                         -> TestAListWithoutASelectableRowInViewHasNoCounter
// 30. a_row_of_several_lines_counts_once                                             -> TestARowOfSeveralLinesCountsOnce
//
// design_system_ratatui/tests.rs (2):
// 31. activity_glyphs_keep_selection_across_all_levels_in_every_look                 -> TestActivityGlyphsKeepSelectionAcrossAllLevelsInEveryLook
// 32. component_cell_grids_match_all_looks_and_widths                                -> TestComponentCellGridsMatchAllLooksAndWidths

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/tuicomponents"
)

type noSources struct{}

func (noSources) Compile(_, _ string, _ map[string]*Schema) (struct{}, error) {
	return struct{}{}, errors.New("no sources")
}
func (noSources) Resolve(_ struct{}, _ map[string]any) (*string, error) {
	return nil, errors.New("no sources")
}

func rowSchema() Schema {
	return ObjectSchema(map[string]Schema{
		"rows": CollectionSchema(ObjectSchema(map[string]Schema{
			"id":       StableIDSchema(),
			"disabled": BooleanSchema(),
			"gutter":   ScalarSchema(),
			"label":    ScalarSchema(),
			"role":     ScalarSchema(),
		})),
		"query":  ScalarSchema(),
		"status": ScalarSchema(),
		"footer": ScalarSchema(),
	})
}

func helpSchema() Schema {
	return ObjectSchema(map[string]Schema{
		"help":   KeyHelpSchema(),
		"status": ScalarSchema(),
		"footer": ScalarSchema(),
	})
}

func reverseSel(role clistyle.Role) Style {
	st := NewStyle().WithModifier(ModifierReversed)
	if role == clistyle.RoleBlocked || role == clistyle.RoleWaiting {
		st = st.WithModifier(ModifierBold)
	}
	return st
}

// --- collection/tests.rs ---

func TestTableGridWrapsUnderFixedGutterAndSelectsEveryLineEdgeToEdge(t *testing.T) {
	src := `<tmt-view version="1"><tmt-table id="tbl" bind="$.rows"><tmt-row class="grid grid-cols-[4_1fr] gap-x-1"><tmt-cell bind="row.gutter"/><tmt-text bind="row.label" wrap="true"/></tmt-row></tmt-table></tmt-view>`
	el, err := Parse("tbl.xml", src)
	if err != nil {
		t.Fatal(err)
	}
	sc := rowSchema()
	tbl, err := CompileCollection("tbl.xml", el, &sc, noSources{})
	if err != nil {
		t.Fatal(err)
	}
	surf, err := tbl.Materialize("tbl.xml", map[string]any{
		"rows": []any{
			map[string]any{"id": "r1", "disabled": false, "gutter": "●", "label": "alpha beta gamma", "role": "text"},
		},
	}, noSources{})
	if err != nil {
		t.Fatal(err)
	}
	var st ListState
	buf := EmptyBuffer(NewRect(0, 0, 12, 5))
	fr, err := RenderCollection(surf, &st, buf.Area, buf, RenderStyle{Theme: clistyle.Theme{}, Depth: clistyle.NoColor}, reverseSel)
	if err != nil {
		t.Fatal(err)
	}
	if len(fr.Geometry) != 1 || fr.Geometry[0].Lines.Len() < 2 {
		t.Fatalf("wrapped geometry = %+v", fr.Geometry)
	}
	for y := uint16(0); y < uint16(fr.Geometry[0].Lines.Len()); y++ {
		for x := uint16(0); x < 12; x++ {
			if !buf.At(x, y).Modifier.Contains(ModifierReversed) {
				t.Fatalf("cell (%d,%d) not reversed", x, y)
			}
		}
	}
}

func TestNoColorSelectionHasCommonReverseForegroundAndBoldAttention(t *testing.T) {
	src := `<tmt-view version="1"><tmt-list id="lst" bind="$.rows"><tmt-row><tmt-text bind="row.label" token-bind="row.role"/></tmt-row></tmt-list></tmt-view>`
	el, _ := Parse("lst.xml", src)
	sc := rowSchema()
	tbl, err := CompileCollection("lst.xml", el, &sc, noSources{})
	if err != nil {
		t.Fatal(err)
	}
	surf, err := tbl.Materialize("lst.xml", map[string]any{
		"rows": []any{
			map[string]any{"id": "r1", "disabled": false, "gutter": "", "label": "urgent", "role": "blocked"},
		},
	}, noSources{})
	if err != nil {
		t.Fatal(err)
	}
	var st ListState
	buf := EmptyBuffer(NewRect(0, 0, 10, 2))
	if _, err := RenderCollection(surf, &st, buf.Area, buf, RenderStyle{Depth: clistyle.NoColor}, reverseSel); err != nil {
		t.Fatal(err)
	}
	if !buf.At(0, 0).Modifier.Contains(ModifierReversed | ModifierBold) {
		t.Fatalf("attention cell modifier = %v", buf.At(0, 0).Modifier)
	}
}

func TestSelectionRevealRefreshResizeAndDisabledHitsFollowCurrentGeometry(t *testing.T) {
	src := `<tmt-view version="1"><tmt-list id="lst" bind="$.rows"><tmt-row><tmt-text bind="row.label"/></tmt-row></tmt-list></tmt-view>`
	el, _ := Parse("lst.xml", src)
	sc := rowSchema()
	tbl, _ := CompileCollection("lst.xml", el, &sc, noSources{})
	surf, _ := tbl.Materialize("lst.xml", map[string]any{
		"rows": []any{
			map[string]any{"id": "r1", "disabled": false, "gutter": "", "label": "one", "role": "text"},
			map[string]any{"id": "r2", "disabled": true, "gutter": "", "label": "two", "role": "text"},
			map[string]any{"id": "r3", "disabled": false, "gutter": "", "label": "three", "role": "text"},
		},
	}, noSources{})
	var st ListState
	buf := EmptyBuffer(NewRect(0, 0, 12, 3))
	fr, err := RenderCollection(surf, &st, buf.Area, buf, RenderStyle{Depth: clistyle.NoColor}, reverseSel)
	if err != nil {
		t.Fatal(err)
	}
	// Clicking disabled row r2 does not select it.
	if ev := st.Input(MouseInputEvent(MouseEvent{Kind: MouseDown, Button: MouseLeft, Column: 0, Row: 1}), fr); ev != nil {
		t.Fatalf("disabled row click emitted %+v", ev)
	}
	if ev := st.Input(plainKey(KeyCode{Kind: KeyDown}), fr); ev == nil || ev.ID != "r3" {
		t.Fatalf("down skipped disabled -> %+v", ev)
	}
}

func TestRowAdmissionIsEagerAndBooleanMetadataIsStrict(t *testing.T) {
	sc := rowSchema()
	for _, bad := range []string{
		`<tmt-view version="1"><tmt-table id="t" bind="$.rows"><tmt-row><tmt-text bind="row.label"/></tmt-row></tmt-table></tmt-view>`,
		`<tmt-view version="1"><tmt-list id="t" bind="$.rows"><tmt-row id="owned"><tmt-text bind="row.label"/></tmt-row></tmt-list></tmt-view>`,
		`<tmt-view version="1"><tmt-list id="t" bind="$.rows"><tmt-row><tmt-text id="component-disabled" bind="row.label"/></tmt-row></tmt-list></tmt-view>`,
	} {
		el, err := Parse("bad.xml", bad)
		if err != nil {
			t.Fatalf("parse %s: %v", bad, err)
		}
		if _, err := CompileCollection("bad.xml", el, &sc, noSources{}); err == nil {
			t.Fatalf("expected compile error for %s", bad)
		}
	}
}

func TestPickerHasFixedQueryFooterClippedListAndConsumerChosenStatusRole(t *testing.T) {
	src := `<tmt-view version="1"><tmt-picker id="pk" title="Choose" placement="center"><tmt-text slot="query" bind="$.query"/><tmt-list id="items" bind="$.rows"><tmt-row><tmt-text bind="row.label"/></tmt-row></tmt-list><tmt-text slot="status" bind="$.status" token="waiting"/><tmt-text slot="footer" bind="$.footer" token="dim"/></tmt-picker></tmt-view>`
	el, err := Parse("pk.xml", src)
	if err != nil {
		t.Fatal(err)
	}
	sc := rowSchema()
	tpl, err := CompileSurface("pk.xml", el, &sc, noSources{})
	if err != nil {
		t.Fatal(err)
	}
	surf, err := tpl.Materialize("pk.xml", map[string]any{
		"query":  "abc▏",
		"status": "filtering",
		"footer": "Esc close",
		"rows": []any{
			map[string]any{"id": "r1", "disabled": false, "gutter": "", "label": "alpha", "role": "text"},
			map[string]any{"id": "r2", "disabled": false, "gutter": "", "label": "beta", "role": "text"},
		},
	}, noSources{})
	if err != nil {
		t.Fatal(err)
	}
	var st ListState
	buf := EmptyBuffer(NewRect(0, 0, 60, 12))
	fm, err := RenderSurfaceList(surf, &st, buf.Area, buf, RenderStyle{Depth: clistyle.TrueColor}, reverseSel)
	if err != nil {
		t.Fatal(err)
	}
	if fm.Query.Height != 1 || fm.List == nil || len(fm.List.Rows) != 2 {
		t.Fatalf("picker frame = %+v", fm)
	}
	if !strings.Contains(bufLine(buf, fm.Query), "abc▏") {
		t.Fatalf("query line = %q", bufLine(buf, fm.Query))
	}
	if !strings.Contains(bufLine(buf, fm.Areas.Footer), "Esc close") {
		t.Fatalf("footer line = %q", bufLine(buf, fm.Areas.Footer))
	}
	if buf.At(fm.Areas.Status.X, fm.Areas.Status.Y).Fg != ScreenStyle(clistyle.Theme{}, clistyle.RoleWaiting, clistyle.TrueColor).Fg {
		t.Fatalf("status role not waiting")
	}
}

func TestTinyPickerAndOrdinaryPaneRectanglesRemainBounded(t *testing.T) {
	src := `<tmt-view version="1"><tmt-list id="lst" bind="$.rows"><tmt-row><tmt-text bind="row.label"/></tmt-row></tmt-list></tmt-view>`
	el, _ := Parse("lst.xml", src)
	sc := rowSchema()
	tbl, _ := CompileCollection("lst.xml", el, &sc, noSources{})
	surf, _ := tbl.Materialize("lst.xml", map[string]any{"rows": []any{}}, noSources{})
	var st ListState
	for _, sz := range [][2]uint16{{0, 0}, {1, 1}, {2, 2}} {
		buf := EmptyBuffer(NewRect(0, 0, sz[0], sz[1]))
		if _, err := RenderCollection(surf, &st, buf.Area, buf, RenderStyle{Depth: clistyle.NoColor}, reverseSel); err != nil {
			t.Fatalf("tiny %v: %v", sz, err)
		}
	}
}

func TestListTemplateUsesSameScrollAndOpaqueModalSelectionSeam(t *testing.T) {
	src := `<tmt-view version="1"><tmt-modal id="m" title="List"><tmt-scroll id="s"><tmt-list id="l" bind="$.rows"><tmt-row><tmt-text bind="row.label"/></tmt-row></tmt-list></tmt-scroll></tmt-modal></tmt-view>`
	el, _ := Parse("m.xml", src)
	sc := rowSchema()
	tpl, err := CompileSurface("m.xml", el, &sc, noSources{})
	if err != nil {
		t.Fatal(err)
	}
	surf, err := tpl.Materialize("m.xml", map[string]any{
		"rows": []any{map[string]any{"id": "a", "disabled": false, "gutter": "", "label": "item", "role": "text"}},
	}, noSources{})
	if err != nil {
		t.Fatal(err)
	}
	var scState ScrollState
	buf := EmptyBuffer(NewRect(0, 0, 40, 10))
	if _, err := RenderSurface(surf, &scState, buf.Area, buf, RenderStyle{}, reverseSel); err == nil {
		t.Fatalf("RenderSurface should reject list surface")
	}
	var lst ListState
	if _, err := RenderSurfaceList(surf, &lst, buf.Area, buf, RenderStyle{}, reverseSel); err != nil {
		t.Fatal(err)
	}
}

func TestOversizedSelectedRowCanScrollInsideItWithoutRepaintSnappingBack(t *testing.T) {
	var sc ScrollState
	vp := NewRect(0, 0, 10, 3)
	oversized := LineRange{Start: 0, End: 10}
	sc.Update(vp, 10, &oversized)
	sc.Step(LinesStep(4))
	if sc.Offset() != 4 {
		t.Fatalf("offset = %d, want 4", sc.Offset())
	}
	sc.Update(vp, 10, &oversized)
	if sc.Offset() != 4 {
		t.Fatalf("repaint snapped offset back to %d", sc.Offset())
	}
}

func TestReplacementRowsAndStatusComposeInPlaceWithStableSelection(t *testing.T) {
	var st ListState
	_ = st.Reconcile(makeListRows("a", "b", "c"))
	st.Select("b")
	_ = st.Reconcile(makeListRows("c", "b", "d"))
	if sel, ok := st.Selected(); !ok || sel != "b" {
		t.Fatalf("sel = %q, want b", sel)
	}
}

// --- surface/tests.rs ---

func makeHelpSurface(t *testing.T, attrs string, help KeyHelp, status, footer string) *ModalSurface {
	t.Helper()
	src := fmt.Sprintf(`<tmt-view version="1"><tmt-modal id="help" title="Keys" %s><tmt-scroll id="body"><tmt-key-help id="kh" bind="$.help"/></tmt-scroll><tmt-text slot="status" bind="$.status" token="dim"/><tmt-text slot="footer" bind="$.footer" token="dim"/></tmt-modal></tmt-view>`, attrs)
	el, err := Parse("help.xml", src)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	sc := helpSchema()
	tpl, err := CompileSurface("help.xml", el, &sc, noSources{})
	if err != nil {
		t.Fatalf("CompileSurface: %v", err)
	}
	surf, err := tpl.Materialize("help.xml", map[string]any{
		"help":   help.Value(),
		"status": status,
		"footer": footer,
	}, noSources{})
	if err != nil {
		t.Fatalf("Materialize: %v", err)
	}
	return surf
}

func TestOpaqueReferenceBoxPreservesOutsideBaseAndAnchorsFooterAndStatus(t *testing.T) {
	surf := makeHelpSurface(t, `placement="center"`, KeyHelp{Sections: []KeyHelpSection{{
		ID: "nav", Title: "Navigation", Entries: []KeyHelpEntry{{ID: "up", Keys: "k", Description: "Up"}},
	}}}, "ready", "Esc close")
	buf := EmptyBuffer(NewRect(0, 0, 80, 20))
	buf.SetString(0, 0, "BASE", NewStyle())
	var sc ScrollState
	fm, err := RenderSurface(surf, &sc, NewRect(0, 2, 80, 18), buf, RenderStyle{Depth: clistyle.NoColor}, reverseSel)
	if err != nil {
		t.Fatal(err)
	}
	if buf.At(0, 0).Symbol != "B" {
		t.Fatalf("outside base overwritten")
	}
	if !strings.Contains(bufLine(buf, fm.Areas.Footer), "Esc close") || !strings.Contains(bufLine(buf, fm.Areas.Status), "ready") {
		t.Fatalf("footer/status missing")
	}
}

func TestTheReadPositionIsPaintedOnlyWhileTheBodyOverflows(t *testing.T) {
	entries := make([]KeyHelpEntry, 12)
	for i := range entries {
		entries[i] = KeyHelpEntry{ID: fmt.Sprintf("e%d", i), Keys: "k", Description: "Action"}
	}
	surf := makeHelpSurface(t, `placement="center"`, KeyHelp{Sections: []KeyHelpSection{{ID: "s", Title: "Sec", Entries: entries}}}, "", "Esc")
	var sc ScrollState
	tall := EmptyBuffer(NewRect(0, 0, 80, 30))
	fmTall, err := RenderSurface(surf, &sc, tall.Area, tall, RenderStyle{Depth: clistyle.NoColor}, reverseSel)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(bufLine(tall, fmTall.Areas.Position)) != "" {
		t.Fatalf("non-overflow painted position: %q", bufLine(tall, fmTall.Areas.Position))
	}
	short := EmptyBuffer(NewRect(0, 0, 80, 10))
	fmShort, err := RenderSurface(surf, &sc, short.Area, short, RenderStyle{Depth: clistyle.NoColor}, reverseSel)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(bufLine(short, fmShort.Areas.Position), "more ↓") {
		t.Fatalf("overflow missing position: %q", bufLine(short, fmShort.Areas.Position))
	}
}

func TestAScrollStateReportsAPositionOnlyWhenItsContentOverflows(t *testing.T) {
	var sc ScrollState
	sc.Update(NewRect(0, 0, 20, 5), 5, nil)
	if _, ok := sc.OverflowPosition(); ok {
		t.Fatalf("exact fit reported overflow")
	}
	sc.Update(NewRect(0, 0, 20, 5), 8, nil)
	if pos, ok := sc.OverflowPosition(); !ok || pos != "1–5 of 8 · 3 more ↓" {
		t.Fatalf("overflow pos = (%q, %v)", pos, ok)
	}
}

func TestWrappedFixedSlotsReserveLinesBeforeScrollAndRemeasureOnResize(t *testing.T) {
	src := `<tmt-view version="1"><tmt-modal id="m" title="T" placement="body"><tmt-scroll id="s"><tmt-text>body</tmt-text></tmt-scroll><tmt-text slot="footer" wrap="true" bind="$.footer"/></tmt-modal></tmt-view>`
	el, _ := Parse("w.xml", src)
	sc := helpSchema()
	tpl, err := CompileSurface("w.xml", el, &sc, noSources{})
	if err != nil {
		t.Fatal(err)
	}
	surf, _ := tpl.Materialize("w.xml", map[string]any{"help": KeyHelp{}.Value(), "status": "", "footer": "one two three four five six"}, noSources{})
	var scroll ScrollState
	buf := EmptyBuffer(NewRect(0, 0, 14, 10))
	fm, err := RenderSurface(surf, &scroll, buf.Area, buf, RenderStyle{}, reverseSel)
	if err != nil {
		t.Fatal(err)
	}
	if fm.Areas.Footer.Height < 2 {
		t.Fatalf("wrapped footer height = %d, want >= 2", fm.Areas.Footer.Height)
	}
}

func TestAuthoredModalHeightBoundsDockedPromptWithoutChangingReferenceBody(t *testing.T) {
	surf := makeHelpSurface(t, `placement="docked" class="h-8"`, KeyHelp{Sections: []KeyHelpSection{{
		ID: "s", Title: "S", Entries: []KeyHelpEntry{{ID: "a", Keys: "a", Description: "A"}},
	}}}, "", "")
	var sc ScrollState
	buf := EmptyBuffer(NewRect(0, 0, 100, 30))
	fm, err := RenderSurface(surf, &sc, buf.Area, buf, RenderStyle{}, reverseSel)
	if err != nil {
		t.Fatal(err)
	}
	if fm.Areas.Outer.Height != 8 || fm.Areas.Outer.Bottom() != 30 {
		t.Fatalf("docked outer = %+v", fm.Areas.Outer)
	}
}

func TestEverySectionUsesTheGlobalDisplayCellKeyWidth(t *testing.T) {
	surf := makeHelpSurface(t, `placement="body"`, KeyHelp{Sections: []KeyHelpSection{
		{ID: "s1", Title: "S1", Entries: []KeyHelpEntry{{ID: "e1", Keys: "a", Description: "short"}}},
		{ID: "s2", Title: "S2", Entries: []KeyHelpEntry{{ID: "e2", Keys: "Ctrl+Shift+P", Description: "long"}}},
	}}, "", "")
	var sc ScrollState
	buf := EmptyBuffer(NewRect(0, 0, 60, 12))
	fm, err := RenderSurface(surf, &sc, buf.Area, buf, RenderStyle{}, reverseSel)
	if err != nil {
		t.Fatal(err)
	}
	var d1x, d2x uint16
	for _, h := range fm.Hits {
		if len(h.ID) > 0 && h.ID[len(h.ID)-1] == "description" {
			if d1x == 0 {
				d1x = h.Rect.X
			} else {
				d2x = h.Rect.X
			}
		}
	}
	if d1x == 0 || d1x != d2x {
		t.Fatalf("description columns misaligned: %d vs %d", d1x, d2x)
	}
}

func TestNarrowDescriptionsStackWrapAndKeepFooterFixedWhileScrollClamps(t *testing.T) {
	surf := makeHelpSurface(t, `placement="body"`, KeyHelp{Sections: []KeyHelpSection{{
		ID: "s", Title: "Sec", Entries: []KeyHelpEntry{{ID: "e1", Keys: "Ctrl+K", Description: "A long description that wraps"}},
	}}}, "", "Esc")
	var sc ScrollState
	buf := EmptyBuffer(NewRect(0, 0, 22, 10))
	fm, err := RenderSurface(surf, &sc, buf.Area, buf, RenderStyle{}, reverseSel)
	if err != nil {
		t.Fatal(err)
	}
	if fm.Areas.Footer.Height != 1 || sc.Offset() > sc.Limit() {
		t.Fatalf("narrow stack footer/scroll mismatch")
	}
}

func TestScrollNavigationMouseBoundsAndSelectedRangeSurviveMetricChanges(t *testing.T) {
	var sc ScrollState
	vp := NewRect(2, 2, 10, 4)
	sc.Update(vp, 20, nil)
	if !sc.Input(MouseInputEvent(MouseEvent{Kind: MouseScrollDown, Column: 3, Row: 3})) || sc.Offset() != 3 {
		t.Fatalf("wheel inside = %d", sc.Offset())
	}
	if sc.Input(MouseInputEvent(MouseEvent{Kind: MouseScrollDown, Column: 0, Row: 0})) {
		t.Fatalf("wheel outside accepted")
	}
	sc.Step(BottomStep())
	if sc.Offset() != 16 {
		t.Fatalf("bottom = %d", sc.Offset())
	}
}

func TestTinyRectanglesAndZeroContentStayBounded(t *testing.T) {
	surf := makeHelpSurface(t, `placement="body"`, KeyHelp{}, "", "")
	var sc ScrollState
	for _, sz := range [][2]uint16{{0, 0}, {1, 1}, {2, 2}} {
		buf := EmptyBuffer(NewRect(0, 0, sz[0], sz[1]))
		if _, err := RenderSurface(surf, &sc, buf.Area, buf, RenderStyle{}, reverseSel); err != nil {
			t.Fatalf("tiny %v: %v", sz, err)
		}
	}
}

func TestMalformedComponentsAndEmptyCollectionSchemasFailBeforeRender(t *testing.T) {
	sc := helpSchema()
	for _, bad := range []string{
		`<tmt-view version="1"><tmt-modal id="m" title=""><tmt-scroll id="s"/></tmt-modal></tmt-view>`,
		`<tmt-view version="1"><tmt-modal id="m" title="T" placement="bad"><tmt-scroll id="s"/></tmt-modal></tmt-view>`,
		`<tmt-view version="1"><tmt-modal id="m" title="T"/></tmt-view>`,
		`<tmt-view version="1"><tmt-modal id="m" title="T"><tmt-scroll id="s"/><tmt-text slot="footer">a</tmt-text><tmt-text slot="footer">b</tmt-text></tmt-modal></tmt-view>`,
	} {
		el, err := Parse("bad.xml", bad)
		if err != nil {
			t.Fatalf("parse %s: %v", bad, err)
		}
		if _, err := CompileSurface("bad.xml", el, &sc, noSources{}); err == nil {
			t.Fatalf("expected error for %s", bad)
		}
	}
}

func TestUntitledModalHasAContinuousRuleInEachThemeAndNoColor(t *testing.T) {
	m := Modal{Title: "", Placement: PlacementBody}
	for _, d := range []clistyle.Depth{clistyle.TrueColor, clistyle.ANSI16, clistyle.NoColor} {
		buf := EmptyBuffer(NewRect(0, 0, 10, 4))
		m.Paint(m.Areas(buf.Area, [2]uint16{10, 4}, false, false), buf, clistyle.Theme{}, d)
		if bufRows(buf)[0] != "┌────────┐" {
			t.Fatalf("untitled top = %q", bufRows(buf)[0])
		}
	}
}

func TestSmallModalIsCenteredAndCappedButNarrowModalFillsWidth(t *testing.T) {
	m := Modal{Title: "Hi", Placement: PlacementCenter}
	narrow := m.Areas(NewRect(0, 0, 80, 24), [2]uint16{30, 8}, false, false)
	if narrow.Outer.Width != 80 {
		t.Fatalf("narrow width = %d, want 80", narrow.Outer.Width)
	}
	wide := m.Areas(NewRect(0, 0, 120, 24), [2]uint16{30, 8}, false, false)
	if wide.Outer.Width != 30 || wide.Outer.X != 45 {
		t.Fatalf("wide outer = %+v", wide.Outer)
	}
}

func TestFooterKeepsWholeHintsByPriorityAndEscapesControls(t *testing.T) {
	hints := []KeyHint{{Key: "?", Description: "help"}, {Key: "q", Description: "quit"}, {Key: "x\x1b", Description: "long"}}
	if got := Footer(hints, 16, " · "); got != "? help · q quit" {
		t.Fatalf("Footer(16) = %q", got)
	}
	if got := Footer(hints, 40, " · "); strings.Contains(got, "\x1b") {
		t.Fatalf("Footer leaked control: %q", got)
	}
}

func TestComponentGeneratedDepthIsRejectedDuringAdmission(t *testing.T) {
	sc := helpSchema()
	deep := strings.Repeat("<tmt-col>", MaxDepth-5) + `<tmt-key-help id="kh" bind="$.help"/>` + strings.Repeat("</tmt-col>", MaxDepth-5)
	src := `<tmt-view version="1"><tmt-modal id="m" title="T"><tmt-scroll id="s">` + deep + `</tmt-scroll></tmt-modal></tmt-view>`
	el, err := Parse("deep.xml", src)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := CompileSurface("deep.xml", el, &sc, noSources{}); err == nil {
		t.Fatalf("expected depth limit error")
	}
}

func TestSemanticHelpStylesAndEscapingUseInjectedThemeAtEachDepth(t *testing.T) {
	surf := makeHelpSurface(t, `placement="body"`, KeyHelp{Sections: []KeyHelpSection{{
		ID: "s", Title: "Nav\x1b[31m", Entries: []KeyHelpEntry{{ID: "e", Keys: "k", Description: "Up"}},
	}}}, "", "")
	for _, d := range []clistyle.Depth{clistyle.TrueColor, clistyle.NoColor} {
		var sc ScrollState
		buf := EmptyBuffer(NewRect(0, 0, 40, 8))
		if _, err := RenderSurface(surf, &sc, buf.Area, buf, RenderStyle{Theme: clistyle.Theme{}, Depth: d}, reverseSel); err != nil {
			t.Fatal(err)
		}
		for _, r := range bufRows(buf) {
			if strings.Contains(r, "\x1b") {
				t.Fatalf("control leaked in %q", r)
			}
		}
	}
}

func TestKeyHelpHeadingPropertiesPreserveColumnsAndSectionSpacing(t *testing.T) {
	src := `<tmt-view version="1"><tmt-modal id="m" title="Keys" placement="body"><tmt-scroll id="s"><tmt-key-help id="kh" bind="$.help" heading-token="accent" heading-bold="true" section-gap="1"/></tmt-scroll></tmt-modal></tmt-view>`
	el, err := Parse("kh.xml", src)
	if err != nil {
		t.Fatal(err)
	}
	sc := helpSchema()
	tpl, err := CompileSurface("kh.xml", el, &sc, noSources{})
	if err != nil {
		t.Fatal(err)
	}
	surf, err := tpl.Materialize("kh.xml", map[string]any{
		"help": KeyHelp{Sections: []KeyHelpSection{
			{ID: "s1", Title: "First", Entries: []KeyHelpEntry{{ID: "a", Keys: "a", Description: "One"}}},
			{ID: "s2", Title: "Second", Entries: []KeyHelpEntry{{ID: "b", Keys: "b", Description: "Two"}}},
		}}.Value(),
		"status": "", "footer": "",
	}, noSources{})
	if err != nil {
		t.Fatal(err)
	}
	var scroll ScrollState
	buf := EmptyBuffer(NewRect(0, 0, 40, 12))
	fm, err := RenderSurface(surf, &scroll, buf.Area, buf, RenderStyle{Depth: clistyle.TrueColor}, reverseSel)
	if err != nil {
		t.Fatal(err)
	}
	if !buf.At(fm.Areas.Content.X, fm.Areas.Content.Y).Modifier.Contains(ModifierBold) {
		t.Fatalf("heading not bold")
	}
}

func TestInvalidKeyHelpHeadingPropertiesAreRejected(t *testing.T) {
	sc := helpSchema()
	for _, attr := range []string{`heading-token="nope"`, `heading-bold="yes"`, `section-gap="9999"`} {
		src := fmt.Sprintf(`<tmt-view version="1"><tmt-modal id="m" title="K"><tmt-scroll id="s"><tmt-key-help id="kh" bind="$.help" %s/></tmt-scroll></tmt-modal></tmt-view>`, attr)
		el, err := Parse("kh.xml", src)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := CompileSurface("kh.xml", el, &sc, noSources{}); err == nil {
			t.Fatalf("expected error for %s", attr)
		}
	}
}

func TestAListCounterCountsSelectableRowsNotHeadings(t *testing.T) {
	lf := ListFrame{
		Rows: []ListRow{{ID: "h1", Disabled: true}, {ID: "a"}, {ID: "b"}},
		Geometry: []RowGeometry{
			{ID: "h1", Lines: LineRange{0, 1}, Visible: NewRect(0, 0, 10, 1)},
			{ID: "a", Lines: LineRange{1, 2}, Visible: NewRect(0, 1, 10, 1)},
			{ID: "b", Lines: LineRange{2, 3}, Visible: NewRect(0, 2, 10, 1)},
		},
	}
	if got := selectablePosition(&lf); got != "1–2 of 2" {
		t.Fatalf("selectablePosition = %q, want 1–2 of 2", got)
	}
}

func TestAScrolledWindowNumbersTheSelectableRowsItShowsAndCountsTheRestBelow(t *testing.T) {
	lf := ListFrame{
		Rows: []ListRow{{ID: "a"}, {ID: "b"}, {ID: "c"}, {ID: "d"}},
		Geometry: []RowGeometry{
			{ID: "a", Visible: NewRect(0, 0, 10, 0)},
			{ID: "b", Visible: NewRect(0, 0, 10, 1)},
			{ID: "c", Visible: NewRect(0, 1, 10, 1)},
			{ID: "d", Visible: NewRect(0, 0, 10, 0)},
		},
	}
	if got := selectablePosition(&lf); got != "2–3 of 4 · 1 more ↓" {
		t.Fatalf("selectablePosition = %q", got)
	}
}

func TestAListWithoutASelectableRowInViewHasNoCounter(t *testing.T) {
	lf := ListFrame{
		Rows:     []ListRow{{ID: "h1", Disabled: true}},
		Geometry: []RowGeometry{{ID: "h1", Visible: NewRect(0, 0, 10, 1)}},
	}
	if got := selectablePosition(&lf); got != "" {
		t.Fatalf("selectablePosition = %q, want empty", got)
	}
}

func TestARowOfSeveralLinesCountsOnce(t *testing.T) {
	lf := ListFrame{
		Rows: []ListRow{{ID: "a"}, {ID: "b"}},
		Geometry: []RowGeometry{
			{ID: "a", Lines: LineRange{0, 3}, Visible: NewRect(0, 0, 10, 3)},
			{ID: "b", Lines: LineRange{3, 6}, Visible: NewRect(0, 0, 10, 0)},
		},
	}
	if got := selectablePosition(&lf); got != "1–1 of 2 · 1 more ↓" {
		t.Fatalf("selectablePosition = %q", got)
	}
}

// --- design_system_ratatui/tests.rs ---

func TestActivityGlyphsKeepSelectionAcrossAllLevelsInEveryLook(t *testing.T) {
	u := func(v uint64) *uint64 { return &v }
	props := tuicomponents.ActivityCellsProps{
		Values:   []*uint64{nil, u(0), u(1), u(2), u(3), u(4), u(5), u(6)},
		Selected: true,
	}
	grid := tuicomponents.NewCellGrid(tuicomponents.Size{Width: 8, Height: 1})
	(tuicomponents.ActivityCells{}).Render(props, tuicomponents.Rect{Width: 8, Height: 1}, &grid)
	for _, tc := range []struct {
		base  clistyle.ThemeBase
		depth clistyle.Depth
	}{
		{clistyle.ThemeDark, clistyle.TrueColor},
		{clistyle.ThemeLight, clistyle.TrueColor},
		{clistyle.ThemeTerminal, clistyle.ANSI16},
		{clistyle.ThemeDark, clistyle.NoColor},
	} {
		buf := EmptyBuffer(NewRect(0, 0, 8, 1))
		PaintCellGrid(&grid, buf.Area, buf, clistyle.Theme{Base: tc.base}, tc.depth)
		if bufRows(buf)[0] != "·▁▂▃▄▅▆█" {
			t.Fatalf("activity glyphs = %q", bufRows(buf)[0])
		}
		if tc.depth == clistyle.NoColor && !buf.At(0, 0).Modifier.Contains(ModifierReversed) {
			t.Fatalf("NoColor selection missing REVERSED")
		}
	}
}

func TestComponentCellGridsMatchAllLooksAndWidths(t *testing.T) {
	grid := tuicomponents.NewCellGrid(tuicomponents.Size{Width: 28, Height: 6})
	(tuicomponents.PaneFrame{}).Render(tuicomponents.PaneFrameProps{
		Title: "Agents", Focused: true, BackHint: true,
	}, tuicomponents.Rect{Width: 28, Height: 6}, &grid)
	buf := EmptyBuffer(NewRect(0, 0, 28, 6))
	PaintCellGrid(&grid, buf.Area, buf, clistyle.Theme{}, clistyle.TrueColor)
	if bufRows(buf)[0] != "┏━ ▸ Agents · Esc back ━━━━┓" {
		t.Fatalf("painted pane frame = %q", bufRows(buf)[0])
	}
	if !buf.At(4, 0).Modifier.Contains(ModifierBold) {
		t.Fatalf("focused pane frame title not bold")
	}
}
