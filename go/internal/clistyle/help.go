package clistyle

import (
	"io"
	"strings"
	"unicode"
)

// Example is a complete runnable command and the note displayed above it.
type Example struct {
	Command string
	Note    string
}

// HelpEntry is a command, argument or discovered entry and its description.
type HelpEntry struct {
	Name        string
	Description string
}

// HelpOption holds the visible spellings of one option. Value includes the
// operand's surrounding punctuation, for example "<NAME>".
type HelpOption struct {
	Short       rune
	Long        string
	Value       string
	Description string
}

// HelpSection is a titled list shown after the standard help sections.
type HelpSection struct {
	Title   string
	Entries []HelpEntry
}

// HelpSpec projects a CLI's visible grammar into the shared help layout.
// Program is the full command path. Usage contains its remaining operands
// and placeholders, in the order the grammar presents them.
type HelpSpec struct {
	Program   string
	Usage     string
	Summary   string
	Commands  []HelpEntry
	Arguments []HelpEntry
	Options   []HelpOption
	Sections  []HelpSection
	Details   string
	Examples  []Example
}

// WriteHelp renders a help view. The CLI supplies the same spec for each of
// its help routes. A missing summary or invalid example count is a caller bug.
func WriteHelp(output io.Writer, term Terminal, spec HelpSpec) error {
	if spec.Summary == "" || len(spec.Examples) == 0 || len(spec.Examples) > 3 {
		panic("help needs a summary and one to three examples")
	}
	// Help uses the same palette even when the caller uses a theme elsewhere.
	term.Theme = nil
	var b strings.Builder
	width := 0
	if term.Width != nil && *term.Width >= 40 {
		width = *term.Width
	}
	program, _, _ := strings.Cut(spec.Program, " ")
	prose := func(prefix, text string) {
		for _, line := range strings.Split(text, "\n") {
			body := strings.TrimLeftFunc(line, unicode.IsSpace)
			leading := prefix + Escape(line[:len(line)-len(body)])
			lineWidth := width
			if tail, ok := strings.CutPrefix(body, program); ok && program != "" &&
				(tail == "" || strings.TrimLeftFunc(tail, unicode.IsSpace) != tail) {
				lineWidth = 0
			}
			writeHelpProse(&b, leading, DisplayWidth(leading), Escape(body), lineWidth, leading)
		}
	}
	title := func(text string) {
		b.WriteString(term.Paint(TokenTitle, Escape(text)+":"))
	}
	entries := func(name string, rows []HelpEntry, literal bool) {
		if len(rows) == 0 {
			return
		}
		title(name)
		b.WriteByte('\n')
		longest := 0
		for _, row := range rows {
			longest = max(longest, DisplayWidth(Escape(row.Name)))
		}
		for _, row := range rows {
			label := Escape(row.Name)
			labelWidth := DisplayWidth(label)
			if literal {
				label = term.Paint(TokenLiteral, label)
			}
			prefix := "  " + label + strings.Repeat(" ", longest-labelWidth+2)
			writeHelpProse(&b, prefix, longest+4, Escape(row.Description), width, "  ")
		}
		b.WriteByte('\n')
	}

	prose("", spec.Summary)
	b.WriteByte('\n')
	title("Usage")
	b.WriteByte(' ')
	b.WriteString(term.Paint(TokenLiteral, Escape(spec.Program)))
	if spec.Usage != "" {
		b.WriteByte(' ')
		b.WriteString(Escape(spec.Usage))
	}
	b.WriteString("\n\n")
	entries("Commands", spec.Commands, false)
	entries("Arguments", spec.Arguments, false)
	writeHelpOptions(&b, term, spec.Options, width)
	for _, section := range spec.Sections {
		entries(section.Title, section.Entries, true)
	}
	if spec.Details != "" {
		title("Details")
		b.WriteByte('\n')
		prose("  ", strings.TrimSuffix(spec.Details, "\n"))
		b.WriteByte('\n')
	}
	title("Examples")
	b.WriteByte('\n')
	for i, example := range spec.Examples {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString("  " + term.Paint(TokenDim, "# "+Escape(example.Note)) + "\n")
		b.WriteString("  " + Escape(example.Command) + "\n")
	}
	_, err := io.WriteString(output, b.String())
	return err
}

func writeHelpOptions(b *strings.Builder, term Terminal, options []HelpOption, width int) {
	if len(options) == 0 {
		return
	}
	type label struct {
		painted string
		cells   int
	}
	labels := make([]label, len(options))
	longest := 0
	for i, opt := range options {
		var plain, painted string
		if opt.Short != 0 {
			short := "-" + Escape(string(opt.Short))
			plain, painted = short, term.Paint(TokenLiteral, short)
			if opt.Long != "" {
				plain += ", "
				painted += ", "
			}
		} else {
			plain, painted = "    ", "    "
		}
		if opt.Long != "" {
			long := "--" + Escape(opt.Long)
			plain += long
			painted += term.Paint(TokenLiteral, long)
		}
		if opt.Value != "" {
			value := " " + Escape(opt.Value)
			plain += value
			painted += value
		}
		labels[i] = label{painted: painted, cells: DisplayWidth(plain)}
		longest = max(longest, labels[i].cells)
	}
	b.WriteString(term.Paint(TokenTitle, "Options:") + "\n")
	for i, opt := range options {
		label := labels[i]
		prefix := "  " + label.painted + strings.Repeat(" ", longest-label.cells+2)
		writeHelpProse(b, prefix, longest+4, Escape(opt.Description), width, "  ")
	}
	b.WriteByte('\n')
}

// The prefix may contain our own SGR. Descriptions start under the label
// where that leaves at least 20 cells for a readable continuation.
func writeHelpProse(b *strings.Builder, prefix string, prefixWidth int, text string, width int, indent string) {
	if text == "" {
		b.WriteString(strings.TrimRight(prefix, " "))
		b.WriteByte('\n')
		return
	}
	if width == 0 || prefixWidth+DisplayWidth(text) <= width {
		b.WriteString(prefix)
		b.WriteString(text)
		b.WriteByte('\n')
		return
	}
	column := prefixWidth
	hasWord := prefixWidth > DisplayWidth(indent)
	if width-prefixWidth >= 20 {
		indent = strings.Repeat(" ", prefixWidth)
	}
	for cursor := 0; cursor < len(text); {
		start := strings.IndexFunc(text[cursor:], func(r rune) bool { return !unicode.IsSpace(r) })
		if start < 0 {
			if cursor == 0 {
				b.WriteString(prefix)
			}
			b.WriteString(text[cursor:])
			break
		}
		start += cursor
		end := strings.IndexFunc(text[start:], unicode.IsSpace)
		if end < 0 {
			end = len(text)
		} else {
			end += start
		}
		gap, word := text[cursor:start], text[start:end]
		wordWidth := DisplayWidth(word)
		wrap := wordWidth > 0 && hasWord && column+DisplayWidth(gap)+wordWidth > width
		if cursor == 0 {
			if wrap {
				prefix = strings.TrimRight(prefix, " ")
			}
			b.WriteString(prefix)
		}
		if wrap {
			b.WriteByte('\n')
			b.WriteString(indent)
			column = DisplayWidth(indent)
		} else {
			b.WriteString(gap)
			column += DisplayWidth(gap)
		}
		b.WriteString(word)
		column += wordWidth
		hasWord = hasWord || wordWidth > 0
		cursor = end
	}
	b.WriteByte('\n')
}
