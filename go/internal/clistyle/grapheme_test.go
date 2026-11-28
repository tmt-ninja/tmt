package clistyle

import (
	"strings"
	"testing"
)

func TestTableCutKeepsGraphemesWhole(t *testing.T) {
	for _, tc := range []struct{ text, cut string }{
		{"👩🏽\u200d💻abcde", "👩🏽\u200d💻a…"},
		{"👨\u200d👩\u200d👧\u200d👦abcde", "👨\u200d👩\u200d👧\u200d👦a…"},
		{"🇹🇼abcde", "🇹🇼a…"},
		{"e\u0301abcde", "e\u0301ab…"},
		{"文件abcde", "文…"},
	} {
		for _, depth := range []Depth{NoColor, ANSI16} {
			width := 4
			terminal := Terminal{Width: &width, Depth: depth}
			table := NewTable(ColumnName)
			table.SetIndent(0)
			table.AddRow(Cell{Text: tc.text, Token: TokenOK})
			var b strings.Builder
			if err := table.Write(&b, terminal); err != nil {
				t.Fatal(err)
			}
			want := terminal.Paint(TokenOK, tc.cut) + "\n"
			if got := b.String(); got != want {
				t.Errorf("cut %q = %q, want %q", tc.text, got, want)
			}
		}
	}
}

func TestFitKeepsJoinedEmojiInBothEnds(t *testing.T) {
	const left = "👩🏽\u200d💻"
	const right = "🇹🇼"
	if fitted := Fit(left+"abcdefgh"+right, 5, AlignLeft, TruncateMiddle); fitted != left+"…"+right || DisplayWidth(fitted) != 5 {
		t.Errorf("middle cut = %q", fitted)
	}
	if lines := FitLines(left+"abcdefgh"+right, 3, AlignLeft, TruncateEnd, 2); len(lines) != 2 || lines[0] != left+"a" || lines[1] != "bc…" {
		t.Errorf("wrapped graphemes = %q", lines)
	}
}
