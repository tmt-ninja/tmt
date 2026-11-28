package clistyle

import "io"

// DetailField has a label and its full human-readable value.
type DetailField struct {
	Label string
	Value string
}

// WriteDetail displays one record. Its values remain whole at every width.
func WriteDetail(output io.Writer, term Terminal, title string, fields []DetailField) error {
	if _, err := io.WriteString(output, term.Paint(TokenTitle, Escape(title))+"\n"); err != nil {
		return err
	}
	table := NewTable(ColumnFixed, ColumnDetail)
	for _, field := range fields {
		table.AddRow(Cell{Text: field.Label, Token: TokenDim}, Cell{Text: field.Value})
	}
	term.Width = nil
	return table.Write(output, term)
}
