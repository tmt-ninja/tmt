package hostgrammar

import (
	"slices"
	"strings"
	"testing"
)

func strPtr(s string) *string { return &s }

func herdrGrammar(t *testing.T) *HostGrammar {
	t.Helper()
	g, err := New("herdr", "term_", strPtr("w{n}:p{n}"))
	if err != nil {
		t.Fatalf("unexpected error constructing herdr grammar: %v", err)
	}
	return g
}

func TestPaneIDsAndTargetsFollowDeclaredSyntax(t *testing.T) {
	g := herdrGrammar(t)
	if g.Name() != "herdr" {
		t.Fatalf("Name() = %q, want %q", g.Name(), "herdr")
	}
	if g.PaneIDPrefix() != "term_" {
		t.Fatalf("PaneIDPrefix() = %q, want %q", g.PaneIDPrefix(), "term_")
	}

	paneIDCases := []struct {
		id   string
		want bool
	}{
		{"term_0a9z", true},
		{"term_", false},
		{"term_A1", false},
		{"term_a_b", false},
		{"%1", false},
		{"xterm_1", false},
		{"term_" + strings.Repeat("a", 64), true},
		{"term_" + strings.Repeat("a", 65), false},
	}
	for _, tc := range paneIDCases {
		if got := g.IsPaneID(tc.id); got != tc.want {
			t.Errorf("IsPaneID(%q) = %v, want %v", tc.id, got, tc.want)
		}
	}

	// Herdr numbers workspaces and panes with digits and uppercase letters; 0 follows Z.
	targetCases := []struct {
		target string
		want   bool
	}{
		{"w1:p23", true},
		{"w1:p2E", true},
		{"wA:pG", true},
		{"w1:p0", true},
		{"wZZZZZZZZZ:p1", true},
		{"w1:pZZZZZZZZZ", true},
		{"w:p1", false},
		{"w1:p", false},
		{"w1:p2x", false},
		{"w1:p2e", false},
		{"W1:p2", false},
		{"w1:P2", false},
		{"w1234567890:p1", false},
		{"wAAAAAAAAAA:p1", false},
		{"w1:pZZZZZZZZZZ", false},
	}
	for _, tc := range targetCases {
		if got := g.IsTarget(tc.target); got != tc.want {
			t.Errorf("IsTarget(%q) = %v, want %v", tc.target, got, tc.want)
		}
	}

	// A number ends at a lowercase literal as it does at ':'.
	joined, err := New("joined", "jn-", strPtr("w{n}p{n}"))
	if err != nil {
		t.Fatalf("New(joined) failed: %v", err)
	}
	if !joined.IsTarget("wApG") {
		t.Errorf("joined.IsTarget(wApG) = false, want true")
	}
	if joined.IsTarget("wApGx") {
		t.Errorf("joined.IsTarget(wApGx) = true, want false")
	}

	if sample, ok := g.SampleTarget(); !ok || sample != "w1:p1" {
		t.Errorf("SampleTarget() = (%q, %v), want (%q, true)", sample, ok, "w1:p1")
	}
	if numbered, ok := g.TargetNumbered("42"); !ok || numbered != "w42:p42" {
		t.Errorf("TargetNumbered(42) = (%q, %v), want (%q, true)", numbered, ok, "w42:p42")
	}

	untargeted, err := New("plain", "pane-", nil)
	if err != nil {
		t.Fatalf("New(plain) failed: %v", err)
	}
	if untargeted.IsTarget("w1:p1") {
		t.Errorf("untargeted.IsTarget(w1:p1) = true, want false")
	}
	if sample, ok := untargeted.SampleTarget(); ok || sample != "" {
		t.Errorf("untargeted.SampleTarget() = (%q, %v), want (\"\", false)", sample, ok)
	}
}

func TestUnsafeDeclarationsAreRefused(t *testing.T) {
	cases := []struct {
		name   string
		prefix string
		target *string
	}{
		{"Herdr", "term_", nil},
		{"9lives", "term_", nil},
		{strings.Repeat("a", 33), "term_", nil},
		{"herdr", "term", nil},
		{"herdr", "%_", nil},
		{"herdr", "_x_", nil},
		{"herdr", "term_", strPtr("{n}.{n}")},
		{"herdr", "term_", strPtr("w{n}{n}")},
		{"herdr", "term_", strPtr("pane")},
		{"herdr", "term_", strPtr("w{n}.p{n}")},
		{"herdr", "term_", strPtr("")},
	}
	for _, tc := range cases {
		if _, err := New(tc.name, tc.prefix, tc.target); err == nil {
			t.Errorf("New(%q, %q, %v) succeeded, want error", tc.name, tc.prefix, tc.target)
		}
	}
}

func TestHostsThatCouldReadEachOthersIDsConflict(t *testing.T) {
	herdr := herdrGrammar(t)
	makeOther := func(prefix string, target *string) *HostGrammar {
		t.Helper()
		g, err := New("other", prefix, target)
		if err != nil {
			t.Fatalf("New(other, %q, %v) failed: %v", prefix, target, err)
		}
		return g
	}

	cases := []struct {
		label      string
		other      *HostGrammar
		wantReason string
		wantHit    bool
	}{
		{"distinct target", makeOther("pane-", strPtr("t{n}")), "", false},
		// A number never reads a literal, so different literals stay apart.
		{"different literal", makeOther("pane-", strPtr("w{n}:q{n}")), "", false},
		{"shorter target", makeOther("pane-", strPtr("w{n}")), "", false},
		{"same prefix", makeOther("term_", nil), "both use the pane-ID prefix term_", true},
		{"same target", makeOther("pane-", strPtr("w{n}:p{n}")), "herdr and other targets look alike", true},
		{"same name", herdrGrammar(t), "both are named herdr", true},
	}
	for _, tc := range cases {
		reason, hit := herdr.Conflict(tc.other)
		if hit != tc.wantHit || reason != tc.wantReason {
			t.Errorf("%s: Conflict() = (%q, %v), want (%q, %v)", tc.label, reason, hit, tc.wantReason, tc.wantHit)
		}
	}
}

func TestHostNameIsValidatedAndOrdersAsText(t *testing.T) {
	longest := strings.Repeat("a", 32)
	for _, name := range []string{"a", "herdr", "fake-host", longest} {
		got, ok := NewHostName(name)
		if !ok || got.String() != name {
			t.Errorf("NewHostName(%q) = (%q, %v), want (%q, true)", name, got, ok, name)
		}
	}
	for _, invalid := range []string{"", "Tmux", "9host", "a_b", strings.Repeat("a", 33)} {
		if got, ok := NewHostName(invalid); ok {
			t.Errorf("NewHostName(%q) = (%q, true), want false", invalid, got)
		}
	}
	var names []HostName
	for _, raw := range []string{"zeta", "alpha", "al", "alpha-2"} {
		n, ok := NewHostName(raw)
		if !ok {
			t.Fatalf("NewHostName(%q) failed", raw)
		}
		names = append(names, n)
	}
	slices.Sort(names)
	got := make([]string, len(names))
	for i, n := range names {
		got[i] = n.String()
	}
	want := []string{"al", "alpha", "alpha-2", "zeta"}
	if !slices.Equal(got, want) {
		t.Errorf("sorted names = %v, want %v", got, want)
	}
}

func TestPaneIDShapeIsAnyDeclarablePrefixThenSuffix(t *testing.T) {
	for _, id := range []string{"term_7", "fake-1", "a_b-c_1z", "x-0"} {
		if !HasPaneIDShape(id) {
			t.Errorf("HasPaneIDShape(%q) = false, want true", id)
		}
		end := strings.LastIndexAny(id, "_-")
		g, err := New("other", id[:end+1], nil)
		if err != nil {
			t.Fatalf("New(other, %q, nil) failed: %v", id[:end+1], err)
		}
		if !g.IsPaneID(id) {
			t.Errorf("IsPaneID(%q) = false, want true", id)
		}
	}
	invalid := []string{
		"%3", "term_", "_7", "7_7", "Term_7", "term_7_", "term_A", "w3:p5", "",
		"ab_" + strings.Repeat("1", 65),
		strings.Repeat("a", 16) + "_1",
	}
	for _, id := range invalid {
		if HasPaneIDShape(id) {
			t.Errorf("HasPaneIDShape(%q) = true, want false", id)
		}
	}
}
