package clistyle

import (
	"slices"
	"testing"
)

func TestGridColumnWidths(t *testing.T) {
	width40, width34, width25 := 40, 34, 25
	width31, width30, width16, width5 := 31, 30, 16, 5
	width14, width12, width8 := 14, 12, 8
	width20, width6 := 20, 6
	cap5 := 5
	low, high := uint16(1), uint16(2)
	shrink := []Track{{Basis: 12, Min: 4, Shrink: 1}, FixedTrack(5), {Basis: 20, Min: 4}, {Basis: 10, Min: 4}}
	hide := []Track{FixedTrack(10), FixedTrack(8), FixedTrack(6), {Basis: 4, Min: 4, Grow: 1}}
	hide[1].Priority, hide[2].Priority = &low, &high
	tied := []Track{FixedTrack(5), FixedTrack(5)}
	tied[0].Priority, tied[1].Priority = &low, &low
	oversized := FixedTrack(20)
	oversized.Priority = &low
	shares := []Track{{Basis: 33, Percent: true}, {Basis: 33, Percent: true}, {Basis: 34, Percent: true}}
	fiftyFifty := []Track{{Basis: 50, Percent: true}, {Basis: 50, Percent: true}}
	cases := []struct {
		name   string
		tracks []Track
		width  *int
		gap    int
		want   []int
	}{
		{"unknown", shrink, nil, 1, []int{12, 5, 20, 10}},
		{"shrink to next", shrink, &width40, 1, []int{12, 5, 10, 10}},
		{"shrink leftmost tie", shrink, &width34, 1, []int{12, 5, 4, 10}},
		{"shrink multitiers", shrink, &width25, 1, []int{9, 5, 4, 4}},
		{"keep all", hide, &width31, 1, []int{10, 8, 6, 4}},
		{"hide highest priority", hide, &width30, 1, []int{10, 8, -1, 10}},
		{"hide two", hide, &width16, 1, []int{10, -1, -1, 5}},
		{"keep required", hide, &width5, 1, []int{10, -1, -1, 4}},
		{"hide rightmost tie", tied, &width8, 1, []int{5, -1}},
		{"percentage shares after gaps", shares, &width14, 2, []int{3, 3, 4}},
		{"percentage tie to left", fiftyFifty, &width12, 1, []int{6, 5}},
		{"grow by share", []Track{{Basis: 4, Grow: 1}, {Basis: 4, Grow: 3}, FixedTrack(2)}, &width20, 1, []int{6, 10, 2}},
		{"grow up to max", []Track{{Basis: 4, Grow: 1, Max: &cap5}, {Basis: 4, Grow: 1}}, &width20, 1, []int{5, 14}},
		{"grow remainder to left", []Track{{Basis: 1, Grow: 1}, {Basis: 1, Grow: 1}}, &width6, 1, []int{3, 2}},
		{"hidden recomputes percentage", []Track{{Basis: 100, Percent: true}, oversized}, &width12, 2, []int{12, -1}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got []int
			for _, width := range SolveGrid(tc.tracks, tc.width, tc.gap) {
				if width.Visible {
					got = append(got, width.Cells)
				} else {
					got = append(got, -1)
				}
			}
			if !slices.Equal(got, tc.want) {
				t.Fatalf("widths = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestFitGolden(t *testing.T) {
	for _, tc := range []struct {
		in    string
		cells int
		align Align
		cut   Truncate
		want  string
	}{
		{"ab", 5, AlignLeft, TruncateEnd, "ab   "},
		{"ab", 5, AlignRight, TruncateEnd, "   ab"},
		{"ab", 5, AlignCenter, TruncateEnd, " ab  "},
		{"abcdefgh", 5, AlignLeft, TruncateEnd, "abcd…"},
		{"abcdefgh", 6, AlignLeft, TruncateMiddle, "abc…gh"},
		{"中文字", 4, AlignLeft, TruncateEnd, "中… "},
		{"中文字", 4, AlignLeft, TruncateMiddle, "中 …"},
		{"🚀🚀🚀", 5, AlignLeft, TruncateEnd, "🚀🚀…"},
		{"a\u001b[31mb", 12, AlignLeft, TruncateEnd, `a\u{1b}[31mb`},
		{"a\t\r\nb", 8, AlignLeft, TruncateEnd, `a\t\r\nb`},
		{"a\u2028b", 10, AlignLeft, TruncateEnd, `a\u{2028}b`},
		{"a\u0301b", 2, AlignLeft, TruncateEnd, "a\u0301b"},
		{"abc", 0, AlignLeft, TruncateEnd, ""},
	} {
		got := Fit(tc.in, tc.cells, tc.align, tc.cut)
		if got != tc.want || DisplayWidth(got) != tc.cells {
			t.Errorf("Fit(%q, %d) = %q (%d cells), want %q", tc.in, tc.cells, got, DisplayWidth(got), tc.want)
		}
	}
}

func TestFitLinesGolden(t *testing.T) {
	for _, tc := range []struct {
		in    string
		cells int
		want  []string
	}{
		{"alpha beta gamma delta", 8, []string{"alpha   ", "beta ga…"}},
		{"abcdefghijk", 4, []string{"abcd", "efg…"}},
		{"中文文本更多", 4, []string{"中文", "文… "}},
		{"中", 1, []string{"…"}},
		{"abc", 0, []string{""}},
		{"a\nb", 3, []string{`a\n`, "b  "}},
	} {
		if got := FitLines(tc.in, tc.cells, AlignLeft, TruncateMiddle, 2); !slices.Equal(got, tc.want) {
			t.Errorf("FitLines(%q, %d) = %q, want %q", tc.in, tc.cells, got, tc.want)
		}
	}
}
