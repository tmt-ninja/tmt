package clistyle

import "slices"

// Breakpoints are terminal widths in display cells.
const (
	SmallWidth  = 80
	MediumWidth = 100
	LargeWidth  = 140
)

// Track describes one grid column. Basis is a cell count unless Percent is
// set. Max and Priority are optional. Higher priorities hide first.
type Track struct {
	Basis    int
	Percent  bool
	Min      int
	Max      *int
	Grow     uint16
	Shrink   uint8
	Priority *uint16
}

// FixedTrack creates a track that keeps its width.
func FixedTrack(width int) Track {
	return Track{Basis: width, Min: width, Max: &width}
}

// ColumnWidth distinguishes a hidden column from a visible zero-width column.
type ColumnWidth struct {
	Cells   int
	Visible bool
}

// SolveGrid assigns display cells. A nil available width keeps each track at
// its bounded basis. A percentage track needs a known or content-derived budget.
func SolveGrid(tracks []Track, available *int, gap int) []ColumnWidth {
	widths := make([]ColumnWidth, len(tracks))
	tiers := make([]uint8, len(tracks))
	for i, track := range tracks {
		widths[i].Visible = true
		tiers[i] = track.Shrink
	}
	slices.Sort(tiers)
	tiers = slices.Compact(tiers)
	for {
		setGridBases(tracks, widths, available, gap)
		if available == nil {
			return widths
		}
		shrinkGrid(tracks, widths, tiers, *available, gap)
		if SpanWidth(widths, gap) <= *available {
			growGrid(tracks, widths, *available, gap)
			return widths
		}
		hide := -1
		for i, track := range tracks {
			if widths[i].Visible && track.Priority != nil &&
				(hide < 0 || *track.Priority >= *tracks[hide].Priority) {
				hide = i
			}
		}
		if hide < 0 {
			return widths
		}
		widths[hide] = ColumnWidth{}
	}
}

func setGridBases(tracks []Track, widths []ColumnWidth, available *int, gap int) {
	type fraction struct{ index, remainder int }
	var fractions []fraction
	count := 0
	for _, width := range widths {
		if width.Visible {
			count++
		}
	}
	data := 0
	if available != nil {
		data = max(0, *available-gap*max(0, count-1))
	}
	remainders := 0
	for i, track := range tracks {
		if !widths[i].Visible {
			continue
		}
		widths[i].Cells = track.Basis
		if track.Percent {
			whole, fractionCells := data/100*track.Basis, data%100*track.Basis
			widths[i].Cells = whole + fractionCells/100
			fractions = append(fractions, fraction{i, fractionCells % 100})
			remainders += fractionCells % 100
		}
	}
	slices.SortStableFunc(fractions, func(a, b fraction) int { return b.remainder - a.remainder })
	for _, fraction := range fractions[:remainders/100] {
		widths[fraction.index].Cells++
	}
	for i, track := range tracks {
		if widths[i].Visible {
			cells := widths[i].Cells
			if track.Max != nil {
				cells = min(cells, *track.Max)
			}
			widths[i].Cells = max(cells, track.Min)
		}
	}
}

func shrinkGrid(tracks []Track, widths []ColumnWidth, tiers []uint8, available, gap int) {
	excess := SpanWidth(widths, gap) - available
	for _, tier := range tiers {
		for excess > 0 {
			widest := -1
			for i, width := range widths {
				if width.Visible && tracks[i].Shrink == tier && width.Cells > tracks[i].Min &&
					(widest < 0 || width.Cells > widths[widest].Cells) {
					widest = i
				}
			}
			if widest < 0 {
				break
			}
			next := tracks[widest].Min
			for i, width := range widths {
				if width.Visible && tracks[i].Shrink == tier && width.Cells > tracks[i].Min &&
					width.Cells < widths[widest].Cells {
					next = max(next, width.Cells)
				}
			}
			cut := min(excess, widths[widest].Cells-next)
			widths[widest].Cells -= cut
			excess -= cut
		}
	}
}

func growGrid(tracks []Track, widths []ColumnWidth, available, gap int) {
	left := available - SpanWidth(widths, gap)
	growing := make([]int, 0, len(tracks))
	for left > 0 {
		growing = growing[:0]
		shares := 0
		for i, track := range tracks {
			if widths[i].Visible && track.Grow > 0 && (track.Max == nil || widths[i].Cells < *track.Max) {
				growing = append(growing, i)
				shares += int(track.Grow)
			}
		}
		if shares == 0 {
			return
		}
		given := 0
		for _, i := range growing {
			share := left * int(tracks[i].Grow) / shares
			if ceiling := tracks[i].Max; ceiling != nil {
				share = min(share, *ceiling-widths[i].Cells)
			}
			widths[i].Cells += share
			given += share
		}
		if given == 0 {
			given = min(left, len(growing))
			for _, i := range growing[:given] {
				widths[i].Cells++
			}
		}
		left -= given
	}
}

// SpanWidth counts the visible columns and intervening gaps in a grid span.
func SpanWidth(widths []ColumnWidth, gap int) int {
	cells, count := 0, 0
	for _, width := range widths {
		if width.Visible {
			count++
			cells += width.Cells
		}
	}
	return cells + gap*max(0, count-1)
}
