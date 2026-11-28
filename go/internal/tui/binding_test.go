package tui

// 1:1 mapping from rust/crates/tmt-tui/src/binding/tests.rs (7 #[test] functions):
//
//  1. admission_checks_empty_repeats_and_reports_the_attribute_and_location   -> TestAdmissionChecksEmptyRepeatsAndReportsTheAttributeAndLocation
//  2. scalar_null_missing_and_dynamic_tokens_have_distinct_behavior           -> TestScalarNullMissingAndDynamicTokensHaveDistinctBehavior
//  3. scoped_stable_ids_survive_reordering_and_shadowed_repeats               -> TestScopedStableIDsSurviveReorderingAndShadowedRepeats
//  4. output_and_work_limits_accept_exact_bounds_then_reject_one_more         -> TestOutputAndWorkLimitsAcceptExactBoundsThenRejectOneMore
//  5. branches_may_share_an_id_but_not_with_anything_outside_the_switch       -> TestBranchesMayShareAnIDButNotWithAnythingOutsideTheSwitch
//  6. every_branch_is_checked_and_materialized_not_only_the_one_that_shows    -> TestEveryBranchIsCheckedAndMaterializedNotOnlyTheOneThatShows
//  7. branches_count_against_the_work_budget                                  -> TestBranchesCountAgainstTheWorkBudget

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

type testRegistry struct{}

func (testRegistry) Compile(from, format string, _ map[string]*Schema) ([2]string, error) {
	if from != "member" || format != "text" {
		return [2]string{}, errors.New("unknown source/format")
	}
	return [2]string{from, format}, nil
}

func (testRegistry) Resolve(_ [2]string, _ map[string]any) (*string, error) {
	s := "already displayed"
	return &s, nil
}

func testBindingSchema() Schema {
	return ObjectSchema(map[string]Schema{
		"rows": CollectionSchema(ObjectSchema(map[string]Schema{
			"id":    StableIDSchema(),
			"shown": ScalarSchema(),
			"token": ScalarSchema(),
			"children": CollectionSchema(ObjectSchema(map[string]Schema{
				"id": StableIDSchema(),
			})),
		})),
		"value": ScalarSchema(),
	})
}

func parseBindingBody(t *testing.T, body string) *MarkupElement {
	t.Helper()
	el, err := Parse("test.xml", fmt.Sprintf(`<tmt-view version="1">%s</tmt-view>`, body))
	if err != nil {
		t.Fatalf("Parse(%s): %v", body, err)
	}
	return el
}

func renderBinding(t *testing.T, body string, data any) (*SceneNode, error) {
	t.Helper()
	sc := testBindingSchema()
	tpl, err := CompileTemplate("test.xml", parseBindingBody(t, body), &sc, testRegistry{})
	if err != nil {
		return nil, err
	}
	return tpl.Materialize("test.xml", data, testRegistry{})
}

func TestAdmissionChecksEmptyRepeatsAndReportsTheAttributeAndLocation(t *testing.T) {
	sc := testBindingSchema()
	for _, tc := range []struct{ attrs, msg string }{
		{`bind="row.missing"`, "unknown path"},
		{`bind="row.id[0]"`, "without indexing"},
		{`from="missing"`, "unknown source"},
		{`from="member" format="missing"`, "unknown source"},
		{`bind="row.shown" format="count"`, "already display"},
		{`id-bind="row.shown"`, "StableId"},
		{`selected="yes"`, "true or false"},
		{`token="muted" token-bind="row.token"`, "either token"},
	} {
		markup := parseBindingBody(t, fmt.Sprintf("\n<tmt-repeat each=\"$.rows\" as=\"row\">\n<tmt-cell %s/></tmt-repeat>", tc.attrs))
		_, err := CompileTemplate("test.xml", markup, &sc, testRegistry{})
		if err == nil {
			t.Fatalf("expected error for %s", tc.attrs)
		}
		me := err.(*MarkupError)
		if !strings.Contains(me.Message, tc.msg) || me.File != "test.xml" || me.Location.Line != 3 {
			t.Fatalf("err = %v, want file=test.xml line=3 containing %q", me, tc.msg)
		}
	}
	for _, body := range []string{
		`<tmt-repeat each="$.value" as="row"/>`,
		`<tmt-repeat each="$.rows" as="$"/>`,
		`<tmt-row row-id="member"/>`,
	} {
		if _, err := renderBinding(t, body, map[string]any{"rows": []any{}}); err == nil {
			t.Fatalf("expected error for %s", body)
		}
	}
}

func TestScalarNullMissingAndDynamicTokensHaveDistinctBehavior(t *testing.T) {
	for _, tc := range []struct {
		val  any
		want *string
	}{
		{"487k", strPtr("487k")},
		{42, strPtr("42")},
		{true, strPtr("true")},
		{nil, nil},
	} {
		node, err := renderBinding(t, `<tmt-cell bind="$.value"/>`, map[string]any{"value": tc.val})
		if err != nil {
			t.Fatalf("render(%v): %v", tc.val, err)
		}
		if !reflect.DeepEqual(node.Children[0].Text, tc.want) {
			t.Fatalf("val=%v text=%v want %v", tc.val, node.Children[0].Text, tc.want)
		}
	}
	if _, err := renderBinding(t, `<tmt-cell bind="$.value"/>`, map[string]any{}); err == nil || !strings.Contains(err.Error(), "missing path") {
		t.Fatalf("missing path err = %v", err)
	}
	for _, val := range []any{[]any{}, map[string]any{}} {
		if _, err := renderBinding(t, `<tmt-cell bind="$.value"/>`, map[string]any{"value": val}); err == nil {
			t.Fatalf("expected error for %T", val)
		}
	}
	body := `<tmt-repeat each="$.rows" as="row"><tmt-cell token-bind="row.token" from="member" selected="true"/></tmt-repeat>`
	muted := clistyle.RoleMuted
	for _, tc := range []struct {
		tok  any
		want *clistyle.Role
	}{
		{"muted", &muted},
		{nil, nil},
	} {
		node, err := renderBinding(t, body, map[string]any{"rows": []any{map[string]any{"token": tc.tok}}})
		if err != nil {
			t.Fatalf("token-bind(%v): %v", tc.tok, err)
		}
		if !reflect.DeepEqual(node.Children[0].Style.Token, tc.want) ||
			*node.Children[0].Text != "already displayed" || !node.Children[0].Selected {
			t.Fatalf("token-bind(%v) node = %+v", tc.tok, node.Children[0])
		}
	}
	if _, err := renderBinding(t, body, map[string]any{"rows": []any{map[string]any{"token": "bad"}}}); err == nil || !strings.Contains(err.Error(), "unknown token") {
		t.Fatalf("bad token err = %v", err)
	}
	if _, err := renderBinding(t, "", []any{}); err == nil {
		t.Fatalf("array root should fail")
	}
	if _, err := renderBinding(t, `<tmt-repeat each="$.rows" as="row"/>`, map[string]any{"rows": []any{42}}); err == nil {
		t.Fatalf("non-object row should fail")
	}
}

func TestScopedStableIDsSurviveReorderingAndShadowedRepeats(t *testing.T) {
	body := `<tmt-repeat each="$.rows" as="row"><tmt-row id-bind="row.id" row-bind="row.id"><tmt-repeat each="row.children" as="row"><tmt-cell id-bind="row.id"/></tmt-repeat></tmt-row></tmt-repeat>`
	a := map[string]any{"id": "member-a", "children": []any{map[string]any{"id": "cell"}}}
	b := map[string]any{"id": "member-b", "children": []any{map[string]any{"id": "cell"}}}
	first, err := renderBinding(t, body, map[string]any{"rows": []any{a, b}})
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	moved, err := renderBinding(t, body, map[string]any{"rows": []any{b, a}})
	if err != nil {
		t.Fatalf("moved: %v", err)
	}
	if !reflect.DeepEqual(first.Children[0], moved.Children[1]) {
		t.Fatalf("reordered child mismatch")
	}
	if *first.Children[0].RowID != "member-a" || !reflect.DeepEqual(first.Children[0].Children[0].ID, []string{"member-a", "cell"}) {
		t.Fatalf("scoped id mismatch: %+v", first.Children[0])
	}
	if _, err := renderBinding(t, body, map[string]any{"rows": []any{a, a}}); err == nil || !strings.Contains(err.Error(), "duplicate resolved") {
		t.Fatalf("duplicate id err = %v", err)
	}
	for _, badID := range []any{nil, "0", 0, " leading", "bad\n", strings.Repeat("x", MaxIDBytes+1)} {
		if _, err := renderBinding(t, body, map[string]any{"rows": []any{map[string]any{"id": badID, "children": []any{}}}}); err == nil {
			t.Fatalf("bad id %v should fail", badID)
		}
	}
	if _, err := renderBinding(t, body, map[string]any{"rows": []any{map[string]any{"id": strings.Repeat("x", MaxIDBytes), "children": []any{}}}}); err != nil {
		t.Fatalf("MaxIDBytes failed: %v", err)
	}
}

func TestOutputAndWorkLimitsAcceptExactBoundsThenRejectOneMore(t *testing.T) {
	sc := testBindingSchema()
	for _, tc := range []struct {
		body  string
		limit int
		msg   string
	}{
		{`<tmt-repeat each="$.rows" as="row"><tmt-cell/></tmt-repeat>`, MaxExpandedNodes - 1, "expanded nodes"},
		{`<tmt-repeat each="$.rows" as="row"/>`, MaxRepeatWork, "repeat work"},
	} {
		tpl, err := CompileTemplate("test.xml", parseBindingBody(t, tc.body), &sc, testRegistry{})
		if err != nil {
			t.Fatalf("CompileTemplate: %v", err)
		}
		rows := make([]any, tc.limit)
		for i := range rows {
			rows[i] = map[string]any{}
		}
		if _, err := tpl.Materialize("test.xml", map[string]any{"rows": rows}, testRegistry{}); err != nil {
			t.Fatalf("at limit %d: %v", tc.limit, err)
		}
		rows = append(rows, map[string]any{})
		if _, err := tpl.Materialize("test.xml", map[string]any{"rows": rows}, testRegistry{}); err == nil || !strings.Contains(err.Error(), tc.msg) {
			t.Fatalf("over limit err = %v, want %q", err, tc.msg)
		}
	}
	text := strings.Repeat("x", MaxBoundBytes)
	if _, err := renderBinding(t, `<tmt-cell bind="$.value"/>`, map[string]any{"value": text}); err != nil {
		t.Fatalf("exact MaxBoundBytes failed: %v", err)
	}
	if _, err := renderBinding(t, `<tmt-cell bind="$.value"/>`, map[string]any{"value": text + "x"}); err == nil || !strings.Contains(err.Error(), "8 MiB") {
		t.Fatalf("over MaxBoundBytes err = %v", err)
	}
	data := map[string]any{"value": strings.Repeat("x", MaxBoundBytes-3)}
	if _, err := renderBinding(t, `<tmt-row id="x" row-id="x"><tmt-cell bind="$.value"/></tmt-row>`, data); err != nil {
		t.Fatalf("charged boundary failed: %v", err)
	}
	if _, err := renderBinding(t, `<tmt-row id="x" row-id="x"><tmt-cell bind="$.value"/><tmt-text>y</tmt-text></tmt-row>`, data); err == nil {
		t.Fatalf("over charged boundary should fail")
	}
}

func TestBranchesMayShareAnIDButNotWithAnythingOutsideTheSwitch(t *testing.T) {
	data := map[string]any{"value": "v", "rows": []any{}}
	branches := `<tmt-switch><tmt-case min="md"><tmt-cell id="squad"/></tmt-case><tmt-default><tmt-cell id="squad"/></tmt-default></tmt-switch>`
	scene, err := renderBinding(t, branches, data)
	if err != nil {
		t.Fatalf("render branches: %v", err)
	}
	sw := scene.Children[0]
	if sw.Kind != KindSwitch || sw.Cond != (Cond{Kind: CondSwitch, Of: SwitchOfContainer}) ||
		sw.Children[0].Cond != (Cond{Kind: CondCase, Min: 100}) || sw.Children[1].Cond != (Cond{Kind: CondNone}) {
		t.Fatalf("switch conds mismatch: %+v", sw)
	}
	for _, outside := range []string{`<tmt-cell id="squad"/>` + branches, branches + `<tmt-cell id="squad"/>`} {
		if _, err := renderBinding(t, outside, data); err == nil || !strings.Contains(err.Error(), "duplicate resolved id") {
			t.Fatalf("outside collision err = %v", err)
		}
	}
	twice := `<tmt-switch><tmt-case min="md"/><tmt-default><tmt-cell id="a"/><tmt-cell id="a"/></tmt-default></tmt-switch>`
	if _, err := renderBinding(t, twice, data); err == nil {
		t.Fatalf("duplicate inside branch should fail")
	}
}

func TestEveryBranchIsCheckedAndMaterializedNotOnlyTheOneThatShows(t *testing.T) {
	sc := testBindingSchema()
	bad := `<tmt-switch><tmt-case min="lg"><tmt-cell bind="$.value"/></tmt-case><tmt-default><tmt-cell bind="$.missing"/></tmt-default></tmt-switch>`
	if _, err := CompileTemplate("test.xml", parseBindingBody(t, bad), &sc, testRegistry{}); err == nil || !strings.Contains(err.Error(), "unknown path") {
		t.Fatalf("bad branch err = %v", err)
	}
	good := `<tmt-switch of="terminal"><tmt-case min="lg"><tmt-cell bind="$.value"/></tmt-case><tmt-default><tmt-repeat each="$.rows" as="row"><tmt-cell bind="row.shown"/></tmt-repeat></tmt-default></tmt-switch>`
	scene, err := renderBinding(t, good, map[string]any{
		"value": "wide",
		"rows":  []any{map[string]any{"id": "r1", "shown": "one", "token": nil, "children": []any{}}},
	})
	if err != nil {
		t.Fatalf("good switch: %v", err)
	}
	sw := scene.Children[0]
	if sw.Cond != (Cond{Kind: CondSwitch, Of: SwitchOfTerminal}) ||
		*sw.Children[0].Children[0].Text != "wide" || *sw.Children[1].Children[0].Text != "one" {
		t.Fatalf("switch materialized mismatch: %+v", sw)
	}
}

func TestBranchesCountAgainstTheWorkBudget(t *testing.T) {
	rows := make([]any, MaxRepeatWork/2+1)
	for i := range rows {
		rows[i] = map[string]any{"id": fmt.Sprintf("r%d", i), "shown": "x", "token": nil, "children": []any{}}
	}
	data := map[string]any{"value": "v", "rows": rows}
	branch := `<tmt-repeat each="$.rows" as="row"><tmt-cell/></tmt-repeat>`
	one := fmt.Sprintf(`<tmt-switch><tmt-case min="md"/><tmt-default>%s</tmt-default></tmt-switch>`, branch)
	if _, err := renderBinding(t, one, data); err != nil {
		t.Fatalf("one branch failed: %v", err)
	}
	both := fmt.Sprintf(`<tmt-switch><tmt-case min="md">%s</tmt-case><tmt-default>%s</tmt-default></tmt-switch>`, branch, branch)
	if _, err := renderBinding(t, both, data); err == nil || !strings.Contains(err.Error(), "20,000") {
		t.Fatalf("both branches err = %v", err)
	}
}

func strPtr(s string) *string { return &s }
