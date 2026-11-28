package clistyle

import (
	"io"
	"slices"
	"strconv"
	"strings"
	"unicode"
)

const (
	tableGap     = 2
	tableMinimum = 4
)

// Column controls which table columns give up width first.
type Column uint8

const (
	ColumnFixed Column = iota
	ColumnName
	ColumnDetail
)

// Cell is text with an optional semantic style.
type Cell struct {
	Text  string
	Token Token
}

type tableRow struct {
	cells []Cell
	tail  *Cell
}

// Table lays out borderless, headerless rows.
type Table struct {
	columns []Column
	rows    []tableRow
	indent  int
}

// NewTable uses the standard two-cell indent.
func NewTable(columns ...Column) *Table {
	if len(columns) == 0 {
		panic("a table needs a column")
	}
	return &Table{columns: slices.Clone(columns), indent: 2}
}

func (t *Table) SetIndent(cells int) {
	t.indent = max(0, cells)
}

func (t *Table) AddRow(cells ...Cell) {
	t.addRow(nil, cells)
}

func (t *Table) AddAction(action string, cells ...Cell) {
	t.addRow(&Cell{Text: Escape(action), Token: TokenAccent}, cells)
}

func (t *Table) AddNote(note string, cells ...Cell) {
	t.addRow(&Cell{Text: Escape(note), Token: TokenDim}, cells)
}

func (t *Table) addRow(tail *Cell, cells []Cell) {
	if len(cells) != len(t.columns) {
		panic("one cell per column")
	}
	cells = slices.Clone(cells)
	for i := range cells {
		cells[i].Text = Escape(cells[i].Text)
	}
	t.rows = append(t.rows, tableRow{cells: cells, tail: tail})
}

// Write renders a table. With no known width, values are left whole.
func (t *Table) Write(output io.Writer, term Terminal) error {
	return t.writeLayout(output, term, layoutTables([]*Table{t}, term.Width))
}

func layoutTables(tables []*Table, available *int) []ColumnWidth {
	first := tables[0]
	tracks := make([]Track, len(first.columns))
	maxTail := -1
	for _, table := range tables {
		for _, row := range table.rows {
			for i, cell := range row.cells {
				tracks[i].Basis = max(tracks[i].Basis, DisplayWidth(cell.Text))
			}
			if row.tail != nil {
				maxTail = max(maxTail, DisplayWidth(row.tail.Text))
			}
		}
	}
	for i, column := range first.columns {
		basis := tracks[i].Basis
		if column == ColumnFixed {
			tracks[i] = FixedTrack(basis)
			continue
		}
		tracks[i].Min = min(basis, tableMinimum)
		if column == ColumnName {
			tracks[i].Shrink = 1
		}
	}
	if maxTail >= 0 {
		tracks = append(tracks, FixedTrack(maxTail))
	}
	if available != nil {
		width := max(0, *available-first.indent)
		available = &width
	}
	return SolveGrid(tracks, available, tableGap)
}

func (t *Table) writeLayout(output io.Writer, term Terminal, widths []ColumnWidth) error {
	indent := strings.Repeat(" ", t.indent)
	for _, row := range t.rows {
		var line strings.Builder
		gap := 0
		for i, width := range widths {
			var cell Cell
			if i < len(row.cells) {
				cell = row.cells[i]
			} else if row.tail != nil {
				cell = *row.tail
			}
			text := strings.TrimRight(fitTableText(cell.Text, width.Cells), " ")
			if text != "" {
				line.WriteString(strings.Repeat(" ", gap))
				line.WriteString(term.Paint(cell.Token, text))
				gap = -DisplayWidth(text)
			}
			gap += width.Cells + tableGap
		}
		text := strings.TrimRightFunc(line.String(), unicode.IsSpace)
		if text != "" {
			text = indent + text
		}
		if _, err := io.WriteString(output, text+"\n"); err != nil {
			return err
		}
	}
	return nil
}

// fitTableText gives the first line the same word budget as the table's
// fixed-width column, then replaces any remaining text with one ellipsis.
func fitTableText(text string, cells int) string {
	if DisplayWidth(text) <= cells {
		return text
	}
	if cells <= 0 {
		return ""
	}
	var first strings.Builder
	used := 0
	for word := range strings.SplitSeq(text, " ") {
		if used > max(0, cells-2) {
			break
		}
		remaining := cells - used
		if first.Len() != 0 {
			remaining--
		}
		wordWidth := DisplayWidth(word)
		if wordWidth > remaining {
			if wordWidth > cells && (first.Len() == 0 || remaining > 2) {
				if first.Len() != 0 {
					first.WriteByte(' ')
				}
				prefix, _ := textHead(word, remaining)
				first.WriteString(prefix)
			}
			break
		}
		if first.Len() != 0 {
			first.WriteByte(' ')
			used++
		}
		first.WriteString(word)
		used += wordWidth
	}
	// NOT PORTED (#6938): use Unicode grapheme segmentation and sequence
	// widths once the approved Go dependency is available.
	prefix, _ := textHead(first.String(), cells-1)
	// The word loop can also finish without wrapping, for example when it
	// drops leading whitespace. In that case there is no ellipsis.
	if first.String() == strings.TrimLeft(text, " ") {
		return first.String()
	}
	return prefix + "…"
}

// ListSection is a title, optional count, rows and optional trailing text.
type ListSection struct {
	Title string
	Count *int
	Rows  *Table
	Note  string
	Hint  string
}

// WriteList separates sections by one blank line. Compatible tables share
// widths across their sections.
func WriteList(output io.Writer, term Terminal, sections []ListSection) error {
	var tables []*Table
	compatible := true
	for _, section := range sections {
		if section.Rows == nil || len(section.Rows.rows) == 0 {
			continue
		}
		if len(tables) != 0 && (!slices.Equal(tables[0].columns, section.Rows.columns) || tables[0].indent != section.Rows.indent) {
			compatible = false
		}
		tables = append(tables, section.Rows)
	}
	var shared []ColumnWidth
	if compatible && len(tables) != 0 {
		shared = layoutTables(tables, term.Width)
	}

	for i, section := range sections {
		if i > 0 {
			if _, err := io.WriteString(output, "\n"); err != nil {
				return err
			}
		}
		title := term.Paint(TokenTitle, Escape(strings.ToUpper(section.Title)))
		if section.Count != nil {
			title += " " + term.Paint(TokenDim, strconv.Itoa(*section.Count))
		}
		if _, err := io.WriteString(output, title+"\n"); err != nil {
			return err
		}
		if section.Rows != nil && len(section.Rows.rows) != 0 {
			widths := shared
			if widths == nil {
				widths = layoutTables([]*Table{section.Rows}, term.Width)
			}
			if err := section.Rows.writeLayout(output, term, widths); err != nil {
				return err
			}
		}
		if section.Note != "" {
			if _, err := io.WriteString(output, "    "+term.Paint(TokenDim, Escape(section.Note))+"\n"); err != nil {
				return err
			}
		}
		if section.Hint != "" {
			if err := WriteHint(output, term, section.Hint); err != nil {
				return err
			}
		}
	}
	return nil
}
