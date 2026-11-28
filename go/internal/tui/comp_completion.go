package tui

import (
	"slices"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Candidate is one completion item supplied by the application.
type Candidate struct {
	ID        string
	Kind      string
	Label     string
	Insertion string
}

// GroupedCandidate pairs a Candidate with its searchable detail string.
type GroupedCandidate struct {
	Candidate Candidate
	Detail    string
}

// Completion manages source-range fuzzy completion without routing semantics.
type Completion struct {
	Matches       []Candidate
	Selected      int
	matchedRanges [][]ByteRange
	rng           *ByteRange
	dismissedAt   int
	dismissedTok  string
	hasDismissed  bool
}

func (c *Completion) Open() bool { return c.rng != nil }

// MatchedRanges returns UTF-8 byte ranges in the matched label for emphasis.
func (c *Completion) MatchedRanges(index int) []ByteRange {
	if index < 0 || index >= len(c.matchedRanges) {
		return nil
	}
	return c.matchedRanges[index]
}

// Update refreshes completion matches for the token immediately before the caret.
func (c *Completion) Update(editor *Editor, candidates []Candidate, trigger string) {
	c.updateRanked(editor, trigger, func(query []rune) []rankedCandidate {
		var out []rankedCandidate
		for _, cand := range candidates {
			if rank, ranges, ok := matchLabel(cand.Label, query); ok {
				out = append(out, rankedCandidate{group: 0, rank: rank, cand: cand, ranges: ranges})
			}
		}
		return out
	})
}

// UpdateGrouped refreshes completion matches preserving inventory group order and matching detail text after labels.
func (c *Completion) UpdateGrouped(editor *Editor, candidates []GroupedCandidate, trigger string) {
	var groups []string
	for _, gc := range candidates {
		if !slices.Contains(groups, gc.Candidate.Kind) {
			groups = append(groups, gc.Candidate.Kind)
		}
	}
	c.updateRanked(editor, trigger, func(query []rune) []rankedCandidate {
		needle := string(query)
		var out []rankedCandidate
		for _, gc := range candidates {
			group := slices.Index(groups, gc.Candidate.Kind)
			if group < 0 {
				continue
			}
			if rank, ranges, ok := matchLabel(gc.Candidate.Label, query); ok {
				out = append(out, rankedCandidate{group: group, rank: rank, cand: gc.Candidate, ranges: ranges})
			} else if strings.Contains(string(normalizeLabel(gc.Detail).chars), needle) {
				out = append(out, rankedCandidate{group: group, rank: 5, cand: gc.Candidate})
			}
		}
		return out
	})
}

type rankedCandidate struct {
	group  int
	rank   uint8
	cand   Candidate
	ranges []ByteRange
}

func (c *Completion) updateRanked(editor *Editor, trigger string, rankFn func([]rune) []rankedCandidate) {
	cursor := editor.Cursor()
	prefix := editor.String()[:cursor]
	start := 0
	for i, r := range prefix {
		if unicode.IsSpace(r) {
			start = i + utf8.RuneLen(r)
		}
	}
	token := prefix[start:]
	queryStr, hasTrigger := strings.CutPrefix(token, trigger)
	validQuery := hasTrigger && trigger != "" && !strings.Contains(queryStr, trigger)
	folded := false
	for _, f := range editor.Folds() {
		if !f.Expanded && f.Source.Start <= start && cursor <= f.Source.End {
			folded = true
			break
		}
	}
	if !validQuery || folded || (c.hasDismissed && c.dismissedAt == cursor && c.dismissedTok == token) {
		c.rng = nil
		c.Matches = nil
		c.matchedRanges = nil
		return
	}
	priorID := ""
	hasPrior := false
	if c.Selected >= 0 && c.Selected < len(c.Matches) {
		priorID = c.Matches[c.Selected].ID
		hasPrior = true
	}
	query := normalizeLabel(queryStr).chars
	ranked := rankFn(query)
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].group != ranked[j].group {
			return ranked[i].group < ranked[j].group
		}
		return ranked[i].rank < ranked[j].rank
	})
	c.Matches = make([]Candidate, len(ranked))
	c.matchedRanges = make([][]ByteRange, len(ranked))
	c.Selected = 0
	for i, item := range ranked {
		c.Matches[i] = item.cand
		c.matchedRanges[i] = item.ranges
		if hasPrior && item.cand.ID == priorID {
			c.Selected = i
		}
	}
	r := ByteRange{Start: start, End: cursor}
	c.rng = &r
	c.hasDismissed = false
}

func (c *Completion) MoveBy(delta int) {
	if len(c.Matches) == 0 {
		c.Selected = 0
		return
	}
	c.Selected = min(max(c.Selected+delta, 0), len(c.Matches)-1)
}

func (c *Completion) Dismiss(editor *Editor) {
	if c.rng != nil {
		c.dismissedAt = editor.Cursor()
		c.dismissedTok = editor.String()[c.rng.Start:c.rng.End]
		c.hasDismissed = true
		c.rng = nil
	}
	c.Matches = nil
	c.matchedRanges = nil
}

func (c *Completion) Chosen() (ByteRange, Candidate, bool) {
	if c.rng == nil || c.Selected < 0 || c.Selected >= len(c.Matches) {
		return ByteRange{}, Candidate{}, false
	}
	return *c.rng, c.Matches[c.Selected], true
}

func (c *Completion) Accept(editor *Editor, maxBytes int) bool {
	r, cand, ok := c.Chosen()
	if !ok {
		return false
	}
	if !editor.ReplaceRange(r, cand.Insertion+" ", maxBytes) {
		return false
	}
	c.Close()
	return true
}

func (c *Completion) Close() {
	c.rng = nil
	c.Matches = nil
	c.matchedRanges = nil
	c.hasDismissed = false
}

type normalizedLabel struct {
	chars    []rune
	source   []ByteRange
	initials []int
}

func normalizeLabel(text string) normalizedLabel {
	var out normalizedLabel
	wordStart := true
	for at, ch := range text {
		if ch == '-' || ch == '_' || ch == '.' || ch == ' ' {
			wordStart = true
			continue
		}
		if wordStart {
			out.initials = append(out.initials, len(out.chars))
			wordStart = false
		}
		rLen := utf8.RuneLen(ch)
		lower := strings.ToLower(string(ch))
		for _, lr := range lower {
			out.chars = append(out.chars, lr)
			out.source = append(out.source, ByteRange{Start: at, End: at + rLen})
		}
	}
	return out
}

func matchLabel(label string, query []rune) (uint8, []ByteRange, bool) {
	if len(query) == 0 {
		return 0, nil, true
	}
	norm := normalizeLabel(label)
	var rank uint8
	var positions []int

	switch {
	case slices.Equal(norm.chars, query):
		rank = 0
		positions = make([]int, len(query))
		for i := range query {
			positions[i] = i
		}
	case len(norm.chars) >= len(query) && slices.Equal(norm.chars[:len(query)], query):
		rank = 1
		positions = make([]int, len(query))
		for i := range query {
			positions[i] = i
		}
	case len(query) <= len(norm.initials) && matchInitials(norm.chars, norm.initials, query):
		rank = 2
		positions = append([]int(nil), norm.initials[:len(query)]...)
	default:
		if idx := indexRunes(norm.chars, query); idx >= 0 {
			rank = 3
			positions = make([]int, len(query))
			for i := range query {
				positions[i] = idx + i
			}
		} else {
			at := 0
			positions = make([]int, 0, len(query))
			for _, q := range query {
				found := -1
				for i := at; i < len(norm.chars); i++ {
					if norm.chars[i] == q {
						found = i
						break
					}
				}
				if found < 0 {
					return 0, nil, false
				}
				positions = append(positions, found)
				at = found + 1
			}
			rank = 4
		}
	}

	var ranges []ByteRange
	for _, at := range positions {
		src := norm.source[at]
		if len(ranges) > 0 && ranges[len(ranges)-1].End >= src.Start {
			if src.End > ranges[len(ranges)-1].End {
				ranges[len(ranges)-1].End = src.End
			}
		} else {
			ranges = append(ranges, src)
		}
	}
	return rank, ranges, true
}

func matchInitials(chars []rune, initials []int, query []rune) bool {
	for i, q := range query {
		if chars[initials[i]] != q {
			return false
		}
	}
	return true
}

func indexRunes(haystack, needle []rune) int {
	if len(needle) > len(haystack) {
		return -1
	}
	for i := 0; i <= len(haystack)-len(needle); i++ {
		if slices.Equal(haystack[i:i+len(needle)], needle) {
			return i
		}
	}
	return -1
}
