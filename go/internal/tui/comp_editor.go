package tui

import (
	"fmt"
	"slices"
	"sort"
	"strings"
	"unicode"

	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// ByteRange is a half-open UTF-8 byte offset range [Start, End).
type ByteRange struct {
	Start int
	End   int
}

func (r ByteRange) Len() int {
	if r.End <= r.Start {
		return 0
	}
	return r.End - r.Start
}

func (r ByteRange) IsEmpty() bool        { return r.End <= r.Start }
func (r ByteRange) Contains(at int) bool { return at >= r.Start && at < r.End }

// Fold is an application-labelled source range. Folding never replaces source text.
type Fold struct {
	ID       uint64
	Source   ByteRange
	Label    string
	Expanded bool
}

// EditorCell is one visual unit in an EditorLine.
type EditorCell struct {
	Text   string
	Source ByteRange
	Column int
	Width  int
}

// EditorLine is one wrapped visual line in an EditorLayout.
type EditorLine struct {
	Cells []EditorCell
	Start int
	End   int
}

// EditorLayout holds cached wrapped lines and the caret's (row, column).
type EditorLayout struct {
	Lines  *[]EditorLine
	Cursor [2]int
}

// Editor provides grapheme-safe editing, folds, and display-cell geometry.
type Editor struct {
	text            string
	cursor          int
	anchor          *int
	preferredColumn *int
	folds           []Fold
	nextFold        uint64
	cachedWidth     uint16
	cachedLines     *[]EditorLine
}

// NewEditor creates an Editor initialized with text and caret at end.
func NewEditor(text string) Editor {
	return Editor{text: text, cursor: len(text)}
}

// Equal compares logical draft state, ignoring cached layout geometry.
func (e *Editor) Equal(other *Editor) bool {
	if e.text != other.text || e.cursor != other.cursor || e.nextFold != other.nextFold {
		return false
	}
	if (e.anchor == nil) != (other.anchor == nil) || (e.anchor != nil && *e.anchor != *other.anchor) {
		return false
	}
	if (e.preferredColumn == nil) != (other.preferredColumn == nil) ||
		(e.preferredColumn != nil && *e.preferredColumn != *other.preferredColumn) {
		return false
	}
	return slices.Equal(e.folds, other.folds)
}

// Clone returns an independent copy of e (without sharing mutable slices).
func (e *Editor) Clone() Editor {
	out := *e
	if e.anchor != nil {
		v := *e.anchor
		out.anchor = &v
	}
	if e.preferredColumn != nil {
		v := *e.preferredColumn
		out.preferredColumn = &v
	}
	if len(e.folds) > 0 {
		out.folds = append([]Fold(nil), e.folds...)
	}
	return out
}

func (e *Editor) String() string { return e.text }
func (e *Editor) Len() int       { return len(e.text) }
func (e *Editor) IsEmpty() bool  { return len(e.text) == 0 }
func (e *Editor) Cursor() int    { return e.cursor }
func (e *Editor) Folds() []Fold  { return e.folds }
func (e *Editor) Clear()         { *e = Editor{} }

func (e *Editor) Selection() ByteRange {
	anchor := e.cursor
	if e.anchor != nil {
		anchor = *e.anchor
	}
	return ByteRange{Start: min(anchor, e.cursor), End: max(anchor, e.cursor)}
}

// Insert replaces the selection with value if the resulting length <= maxBytes.
func (e *Editor) Insert(value string, maxBytes int) bool {
	sel := e.Selection()
	if len(e.text)-sel.Len()+len(value) > maxBytes {
		return false
	}
	e.replace(sel, value)
	e.cursor = boundaryAfter(e.text, sel.Start+len(value))
	e.anchor = nil
	e.preferredColumn = nil
	return true
}

// ReplaceRange replaces an admitted grapheme-aligned byte range atomically.
func (e *Editor) ReplaceRange(r ByteRange, value string, maxBytes int) bool {
	if r.Start < 0 || r.Start > r.End || r.End > len(e.text) ||
		boundaryAfter(e.text, r.Start) != r.Start ||
		boundaryAfter(e.text, r.End) != r.End ||
		len(e.text)-r.Len()+len(value) > maxBytes {
		return false
	}
	a := r.Start
	e.anchor = &a
	e.cursor = r.End
	return e.Insert(value, maxBytes)
}

// InsertFolded inserts value and attaches a collapsed Fold over it.
func (e *Editor) InsertFolded(value, label string, maxBytes int) bool {
	start := e.Selection().Start
	if !e.Insert(value, maxBytes) {
		return false
	}
	if value != "" && boundaryAfter(e.text, start) == start && boundaryAfter(e.text, start+len(value)) == start+len(value) {
		e.nextFold++
		e.folds = append(e.folds, Fold{
			ID:       e.nextFold,
			Source:   ByteRange{Start: start, End: start + len(value)},
			Label:    label,
			Expanded: false,
		})
		sort.Slice(e.folds, func(i, j int) bool { return e.folds[i].Source.Start < e.folds[j].Source.Start })
		e.cachedLines = nil
	}
	return true
}

// RelabelFold updates the label of the fold covering exact source range.
func (e *Editor) RelabelFold(source ByteRange, label string) bool {
	for i := range e.folds {
		if e.folds[i].Source == source {
			if e.folds[i].Label == label {
				return false
			}
			e.folds[i].Label = label
			e.cachedLines = nil
			return true
		}
	}
	return false
}

// ToggleFold toggles the fold at or immediately before the caret.
func (e *Editor) ToggleFold() bool {
	for i := len(e.folds) - 1; i >= 0; i-- {
		f := e.folds[i]
		if f.Source.Contains(e.cursor) || f.Source.End == e.cursor {
			return e.SetExpanded(f.ID, !f.Expanded)
		}
	}
	return false
}

// SetExpanded sets the expanded state of the fold with id.
func (e *Editor) SetExpanded(id uint64, expanded bool) bool {
	for i := range e.folds {
		if e.folds[i].ID == id {
			e.folds[i].Expanded = expanded
			e.cachedLines = nil
			if !expanded && e.folds[i].Source.Contains(e.cursor) {
				e.cursor = e.folds[i].Source.Start
			}
			e.anchor = nil
			return true
		}
	}
	return false
}

func (e *Editor) replace(r ByteRange, value string) {
	e.cachedLines = nil
	kept := e.folds[:0]
	for _, f := range e.folds {
		if f.Source.End <= r.Start {
			kept = append(kept, f)
		} else if f.Source.Start >= r.End {
			f.Source.Start = f.Source.Start - r.Len() + len(value)
			f.Source.End = f.Source.End - r.Len() + len(value)
			kept = append(kept, f)
		}
	}
	e.folds = kept
	e.text = e.text[:r.Start] + value + e.text[r.End:]
	if len(e.folds) > 0 {
		boundaries := make(map[int]struct{})
		for rest, state := e.text, -1; rest != ""; {
			at := len(e.text) - len(rest)
			boundaries[at] = struct{}{}
			_, rest, _, state = uniseg.FirstGraphemeClusterInString(rest, state)
		}
		boundaries[len(e.text)] = struct{}{}
		valid := e.folds[:0]
		for _, f := range e.folds {
			_, ok1 := boundaries[f.Source.Start]
			_, ok2 := boundaries[f.Source.End]
			if ok1 && ok2 {
				valid = append(valid, f)
			}
		}
		e.folds = valid
	}
}

func (e *Editor) moveTo(cursor int, selecting bool) {
	if selecting {
		if e.anchor == nil {
			a := e.cursor
			e.anchor = &a
		}
	} else {
		e.anchor = nil
	}
	e.cursor = boundaryAfter(e.text, min(max(cursor, 0), len(e.text)))
}

func (e *Editor) eraseTo(target int) {
	sel := e.Selection()
	r := sel
	if sel.IsEmpty() {
		r = ByteRange{Start: min(e.cursor, target), End: max(e.cursor, target)}
	}
	e.replace(r, "")
	e.cursor = boundaryAfter(e.text, r.Start)
	e.anchor = nil
	e.preferredColumn = nil
}

func unicodeWords(text string) []ByteRange {
	var out []ByteRange
	for rest, state := text, -1; rest != ""; {
		start := len(text) - len(rest)
		var word string
		word, rest, state = uniseg.FirstWordInString(rest, state)
		isWord := false
		for _, r := range word {
			if unicode.IsLetter(r) || unicode.IsNumber(r) {
				isWord = true
				break
			}
		}
		if isWord {
			out = append(out, ByteRange{Start: start, End: start + len(word)})
		}
	}
	return out
}

func (e *Editor) wordBoundary(forward bool) int {
	words := unicodeWords(e.text)
	target := 0
	if forward {
		target = len(e.text)
		for _, w := range words {
			if w.End > e.cursor {
				target = w.End
				break
			}
		}
	} else {
		for _, w := range words {
			if w.Start < e.cursor {
				target = w.Start
			} else {
				break
			}
		}
	}
	for _, f := range e.folds {
		if !f.Expanded && f.Source.Start < target && target < f.Source.End {
			if forward {
				return f.Source.End
			}
			return f.Source.Start
		}
	}
	return target
}

func (e *Editor) lineBoundary(width uint16, end bool) int {
	layout := e.Layout(width)
	line := (*layout.Lines)[layout.Cursor[0]]
	if end {
		return line.End
	}
	return line.Start
}

func (e *Editor) previous() int {
	for _, f := range e.folds {
		if !f.Expanded && f.Source.End == e.cursor {
			return f.Source.Start
		}
	}
	last := 0
	prefix := e.text[:e.cursor]
	for rest, state := prefix, -1; rest != ""; {
		last = len(prefix) - len(rest)
		_, rest, _, state = uniseg.FirstGraphemeClusterInString(rest, state)
	}
	return last
}

func (e *Editor) next() int {
	for _, f := range e.folds {
		if !f.Expanded && f.Source.Start == e.cursor {
			return f.Source.End
		}
	}
	if e.cursor >= len(e.text) {
		return e.cursor
	}
	g, _, _, _ := uniseg.FirstGraphemeClusterInString(e.text[e.cursor:], -1)
	return e.cursor + len(g)
}

// Key handles editing keys; Enter/Esc/Tab and application bindings return false.
func (e *Editor) Key(key KeyEvent, width uint16, maxBytes int) bool {
	if key.Kind == KeyRelease {
		return false
	}
	selecting := key.Modifiers.Contains(KeyModShift)
	mods := key.Modifiers &^ KeyModShift
	code := key.Code
	if code.Kind == KeyChar {
		if code.Char >= 'A' && code.Char <= 'Z' {
			code.Char += 'a' - 'A'
		}
	}

	var motion *int
	setMotion := func(v int) { motion = &v }
	switch {
	case code.Kind == KeyHome && mods == KeyModControl:
		setMotion(0)
	case code.Kind == KeyEnd && mods == KeyModControl:
		setMotion(len(e.text))
	case (code == CharKey('a') && mods == KeyModControl) || (code.Kind == KeyLeft && mods == KeyModSuper):
		setMotion(e.lineBoundary(width, false))
	case (code == CharKey('e') && mods == KeyModControl) || (code.Kind == KeyRight && mods == KeyModSuper):
		setMotion(e.lineBoundary(width, true))
	case (code.Kind == KeyLeft && (mods == KeyModAlt || mods == KeyModControl)) || (code == CharKey('b') && mods == KeyModAlt):
		setMotion(e.wordBoundary(false))
	case (code.Kind == KeyRight && (mods == KeyModAlt || mods == KeyModControl)) || (code == CharKey('f') && mods == KeyModAlt):
		setMotion(e.wordBoundary(true))
	}
	if motion != nil {
		e.moveTo(*motion, selecting)
		e.preferredColumn = nil
		return true
	}

	var deletion *int
	setDel := func(v int) { deletion = &v }
	switch {
	case (code.Kind == KeyBackspace && mods == KeyModAlt) || (code == CharKey('w') && mods == KeyModControl):
		setDel(e.wordBoundary(false))
	case (code.Kind == KeyDelete && mods == KeyModAlt) || (code == CharKey('d') && mods == KeyModAlt):
		setDel(e.wordBoundary(true))
	case (code == CharKey('u') && mods == KeyModControl) || (code.Kind == KeyBackspace && mods == KeyModSuper):
		setDel(e.lineBoundary(width, false))
	case code == CharKey('k') && mods == KeyModControl:
		setDel(e.lineBoundary(width, true))
	}
	if deletion != nil {
		e.eraseTo(*deletion)
		return true
	}
	if mods != KeyModNone {
		return false
	}

	switch key.Code.Kind {
	case KeyChar:
		if unicode.IsControl(key.Code.Char) {
			return false
		}
		e.Insert(string(key.Code.Char), maxBytes)
	case KeyBackspace:
		e.eraseTo(e.previous())
	case KeyDelete:
		e.eraseTo(e.next())
	case KeyLeft, KeyRight:
		r := e.Selection()
		var at int
		if !selecting && !r.IsEmpty() {
			if key.Code.Kind == KeyLeft {
				at = r.Start
			} else {
				at = r.End
			}
		} else if key.Code.Kind == KeyLeft {
			at = e.previous()
		} else {
			at = e.next()
		}
		e.moveTo(at, selecting)
		e.preferredColumn = nil
	case KeyHome, KeyEnd:
		e.moveTo(e.lineBoundary(width, key.Code.Kind == KeyEnd), selecting)
		e.preferredColumn = nil
	case KeyUp, KeyDown:
		layout := e.Layout(width)
		col := layout.Cursor[1]
		if e.preferredColumn != nil {
			col = *e.preferredColumn
		}
		var row int
		if key.Code.Kind == KeyUp {
			row = max(layout.Cursor[0]-1, 0)
		} else {
			row = min(layout.Cursor[0]+1, len(*layout.Lines)-1)
		}
		e.moveTo(layout.Offset(row, col), selecting)
		e.preferredColumn = &col
	default:
		return false
	}
	return true
}

// Place moves the caret to the source offset at visual (row, column).
func (e *Editor) Place(width uint16, row, column int, selecting bool) {
	offset := e.Layout(width).Offset(row, column)
	e.moveTo(offset, selecting)
	e.preferredColumn = nil
}

// Layout hard-wraps text without dropping spaces, caching geometry per width.
func (e *Editor) Layout(width uint16) EditorLayout {
	if width < 1 {
		width = 1
	}
	if e.cachedLines == nil || e.cachedWidth != width {
		built := e.buildLines(width)
		e.cachedLines = &built
		e.cachedWidth = width
	}
	lines := *e.cachedLines
	row := sort.Search(len(lines), func(i int) bool { return lines[i].Start > e.cursor })
	if row > 0 {
		row--
	}
	col := 0
	for _, cell := range lines[row].Cells {
		if cell.Source.End > e.cursor {
			break
		}
		col += cell.Width
	}
	return EditorLayout{Lines: e.cachedLines, Cursor: [2]int{row, col}}
}

func (e *Editor) buildLines(width uint16) []EditorLine {
	w := int(width)
	lines := []EditorLine{{}}
	column := 0
	start := 0
	for start < len(e.text) {
		var fold *Fold
		for i := range e.folds {
			if !e.folds[i].Expanded && e.folds[i].Source.Start == start {
				fold = &e.folds[i]
				break
			}
		}
		var grapheme string
		if fold != nil {
			grapheme = e.text[start:fold.Source.End]
		} else {
			grapheme, _, _, _ = uniseg.FirstGraphemeClusterInString(e.text[start:], -1)
		}
		end := start + len(grapheme)
		if fold == nil && (grapheme == "\n" || grapheme == "\r\n" || grapheme == "\r") {
			lines[len(lines)-1].End = start
			lines = append(lines, EditorLine{Start: end, End: end})
			column = 0
			start = end
			continue
		}
		rawText := grapheme
		if fold != nil {
			rawText = fold.Label
		}
		text := safeGrapheme(rawText)
		if fold != nil && uniseg.StringWidth(text) > w {
			var b strings.Builder
			used := 0
			for rest, state := text, -1; rest != ""; {
				var g string
				var gw int
				g, rest, gw, state = uniseg.FirstGraphemeClusterInString(rest, state)
				used += gw
				if used >= w {
					break
				}
				b.WriteString(g)
			}
			b.WriteRune('…')
			text = b.String()
		}
		cells := uniseg.StringWidth(text)
		if cells == 0 {
			text = "◌" + text
			cells = uniseg.StringWidth(text)
		}
		if cells > w {
			text = ""
			cells = 1
		}
		if column+cells > w || column == w {
			lines = append(lines, EditorLine{Start: start, End: start})
			column = 0
		}
		last := &lines[len(lines)-1]
		last.Cells = append(last.Cells, EditorCell{
			Text:   text,
			Source: ByteRange{Start: start, End: end},
			Column: column,
			Width:  cells,
		})
		last.End = end
		column += cells
		start = end
	}
	if column == w {
		lines = append(lines, EditorLine{Start: len(e.text), End: len(e.text)})
	}
	return lines
}

// Paint renders visible lines into buffer and returns the cursor Position if visible.
func (l EditorLayout) Paint(buffer *Buffer, area Rect, offset int, selected ByteRange, base, highlight Style) *Position {
	lines := *l.Lines
	for row := 0; row < int(area.Height) && offset+row < len(lines); row++ {
		line := lines[offset+row]
		spans := make([]Span, len(line.Cells))
		for i, cell := range line.Cells {
			st := base
			if cell.Source.Start < selected.End && cell.Source.End > selected.Start {
				st = highlight
			}
			spans[i] = StyledSpan(cell.Text, st)
		}
		PaintLeft(buffer, NewRect(area.X, area.Y+uint16(row), area.Width, 1), Line{Spans: spans})
	}
	if l.Cursor[0] >= offset && l.Cursor[0]-offset < int(area.Height) && l.Cursor[1] < int(area.Width) {
		pos := Position{X: area.X + uint16(l.Cursor[1]), Y: area.Y + uint16(l.Cursor[0]-offset)}
		return &pos
	}
	return nil
}

// Offset maps visual (row, column) back to a UTF-8 byte offset.
func (l EditorLayout) Offset(row, column int) int {
	lines := *l.Lines
	r := min(max(row, 0), len(lines)-1)
	line := lines[r]
	for _, cell := range line.Cells {
		if column < cell.Column+cell.Width {
			if max(column-cell.Column, 0)*2 < cell.Width {
				return cell.Source.Start
			}
			return cell.Source.End
		}
	}
	return line.End
}

// Reveal returns the smallest scroll offset keeping the caret inside height rows.
func (l EditorLayout) Reveal(offset int, height uint16) int {
	h := max(int(height), 1)
	out := min(offset, l.Cursor[0])
	if need := l.Cursor[0] + 1 - h; need > out {
		out = need
	}
	maxOff := max(len(*l.Lines)-h, 0)
	return min(out, maxOff)
}

func boundaryAfter(text string, at int) int {
	for rest, state := text, -1; rest != ""; {
		i := len(text) - len(rest)
		if i >= at {
			return i
		}
		_, rest, _, state = uniseg.FirstGraphemeClusterInString(rest, state)
	}
	return len(text)
}

func safeGrapheme(value string) string {
	var b strings.Builder
	for _, ch := range value {
		if ch == '\u061c' || ch == '\u200e' || ch == '\u200f' ||
			(ch >= '\u202a' && ch <= '\u202e') ||
			(ch >= '\u2066' && ch <= '\u2069') {
			fmt.Fprintf(&b, `\u{%x}`, uint32(ch))
		} else {
			b.WriteRune(ch)
		}
	}
	return clistyle.Escape(b.String())
}
