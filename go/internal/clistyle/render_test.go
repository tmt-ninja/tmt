package clistyle

import (
	"strings"
	"testing"
)

// These fixtures reproduce the inputs and bytes from the tmt-cli-style
// rendering snapshots. ANSI escapes use the same readable spelling.
func renderGolden(t *testing.T, want string, render func(*strings.Builder) error) {
	t.Helper()
	var b strings.Builder
	if err := render(&b); err != nil {
		t.Fatal(err)
	}
	got := strings.ReplaceAll(b.String(), "\x1b", `\u{1b}`)
	if got != want {
		t.Errorf("render =\n%s\nwant =\n%s", got, want)
	}
}

func TestHelpSnapshots(t *testing.T) {
	const summary = "Send a message to an agent"
	talk := HelpSpec{
		Program:   "tmt talk",
		Usage:     "[OPTIONS] <target> <message>",
		Summary:   summary,
		Arguments: []HelpEntry{{"<target>", "Agent name"}, {"<message>", "Message text"}},
		Options: []HelpOption{
			{Short: 'h', Long: "help", Description: "Print help"},
			{Long: "json", Description: "Output one JSON document"},
			{Long: "wait", Description: "Wait for the reply"},
		},
		Examples: []Example{
			{`tmt talk worker "Run the tests"`, "Send a message to one agent"},
			{`tmt talk worker "Summarize" --wait`, "Wait for the reply"},
		},
	}
	width := 80
	renderGolden(t, helpOnATerminalGolden, func(out *strings.Builder) error { return WriteHelp(out, Terminal{Width: &width, Depth: ANSI16}, talk) })
	renderGolden(t, helpThroughAPipeGolden, func(out *strings.Builder) error { return WriteHelp(out, Terminal{}, talk) })
	root := HelpSpec{
		Program: "tmt", Usage: "[OPTIONS] [COMMAND]", Summary: "Collaborate with agents through durable tmux exchanges",
		Commands: []HelpEntry{{"ls", "List agents"}},
		Options:  talk.Options[:2],
		Sections: []HelpSection{{"Extensions", []HelpEntry{
			{"squad (also: sq)", "Lead a squad of agents"}, {"office", "Run the local Office"},
		}}},
		Examples: []Example{{"tmt ls", "See every agent"}},
	}
	renderGolden(t, rootHelpRendersDiscoveredSectionsInTheTemplateGolden, func(out *strings.Builder) error { return WriteHelp(out, Terminal{}, root) })
}

func TestHelpWrapsProseAtKnownWidth(t *testing.T) {
	spec := HelpSpec{
		Program: "tmt speak", Usage: "[OPTIONS] <A-LONG-OPERAND-IS-PRESERVED-AS-PART-OF-USAGE>",
		Summary: "A summary with enough words to wrap at a known terminal width",
		Options: []HelpOption{
			{Short: 'h', Long: "help", Description: "Print help"},
			{Long: "wait", Description: "Wait for the reply from a cooperating recipient"},
		},
		Details:  "Safety guidance occupies its own help section.\n  tmt speak one two three four five six seven eight nine",
		Examples: []Example{{"tmt speak one two three four five six seven eight nine", "An example command and its explanatory note stay whole."}},
	}
	width := 40
	var b strings.Builder
	if err := WriteHelp(&b, Terminal{Width: &width}, spec); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"A summary with enough words to wrap at a\nknown terminal width\n",
		"Usage: tmt speak [OPTIONS] <A-LONG-OPERAND-IS-PRESERVED-AS-PART-OF-USAGE>\n",
		"      --wait  Wait for the reply from a\n              cooperating recipient\n",
		"Details:\n  Safety guidance occupies its own help\n  section.\n    tmt speak one two three four five six seven eight nine\n",
		"  # An example command and its explanatory note stay whole.\n  tmt speak one two three four five six seven eight nine\n",
	} {
		if !strings.Contains(b.String(), want) {
			t.Errorf("help lacks %q\n%s", want, b.String())
		}
	}
	for _, i := range []int{0, 39} {
		b.Reset()
		if err := WriteHelp(&b, Terminal{Width: &i}, spec); err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(b.String(), spec.Summary+"\n") {
			t.Errorf("prose wrapped with %d columns: %s", i, b.String())
		}
	}
}

func TestListSnapshots(t *testing.T) {
	codex, claude := RoleLink, RoleReview
	cells := func(mark string, state Token, name, address string, hue *Role, path string) []Cell {
		return []Cell{{mark, state}, {Text: name}, {address, DriverToken(hue)}, {Text: path}}
	}
	cols := []Column{ColumnFixed, ColumnName, ColumnFixed, ColumnDetail}
	saved := NewTable(cols...)
	saved.AddRow(cells("●", TokenAccent, "astra", "codex:019a2f4c", &codex, "~/dev/tmt-local")...)
	saved.AddRow(cells("●", TokenAccent, "opus-tmt-peer-2", "claude:7c41e9d2", &claude, "~/dev/tmt-local/worktrees/feature-branch")...)
	saved.AddAction("↻ tmt resume sol", cells("○", TokenDim, "sol", "claude:3f9a1c07", &claude, "~/dev/tmt-local")...)
	temporary := NewTable(cols...)
	temporary.AddRow(cells("●", TokenAccent, "mamezu-astra", "codex:01a9c3b8", &codex, "~/dev/mosaic-art")...)
	temporary.AddAction("shell", cells("◌", TokenDim, "opus-1", "tmux:%31", nil, "/srv/builds/nightly")...)
	three, two := 3, 2
	sections := []ListSection{
		{Title: "saved", Count: &three, Rows: saved},
		{Title: "temporary", Count: &two, Rows: temporary, Note: "offline: gemini-helper · night-owl", Hint: "tmt ls --all shows offline identities"},
	}
	wide, narrow := 80, 40
	for _, tc := range []struct {
		name     string
		terminal Terminal
		golden   string
	}{
		{"terminal", Terminal{Width: &wide, Depth: ANSI16}, listOnATerminalGolden},
		{"narrow", Terminal{Width: &narrow, Depth: ANSI16}, listOnANarrowTerminalGolden},
		{"pipe", Terminal{}, listThroughAPipeGolden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			renderGolden(t, tc.golden, func(b *strings.Builder) error { return WriteList(b, tc.terminal, sections) })
		})
	}
}

func TestTableFitsDetailsBeforeNames(t *testing.T) {
	table := NewTable(ColumnFixed, ColumnName, ColumnDetail)
	table.AddRow(Cell{Text: "●"}, Cell{Text: "coordinator"}, Cell{Text: "~/dev/tmt-local/very/long/path"})
	table.AddRow(Cell{Text: "○"}, Cell{Text: "peer"}, Cell{Text: "~/dev/other"})
	for _, tc := range []struct {
		width int
		want  string
	}{
		{36, "  ●  coordinator  ~/dev/tmt-local/v…\n  ○  peer         ~/dev/other\n"},
		{20, "  ●  coordina…  ~/d…\n  ○  peer       ~/d…\n"},
	} {
		renderGolden(t, tc.want, func(b *strings.Builder) error {
			return table.Write(b, Terminal{Width: &tc.width})
		})
	}
}

func TestTableCutPrefersWordsAndKeepsDisplayWidth(t *testing.T) {
	table := NewTable(ColumnDetail)
	table.SetIndent(0)
	table.AddRow(Cell{Text: "aa bbbbb c", Token: TokenOK})
	table.AddRow(Cell{Text: "文件abcde", Token: TokenOK})
	width := 4
	renderGolden(t, `\u{1b}[32maa…\u{1b}[0m
\u{1b}[32m文…\u{1b}[0m
`, func(b *strings.Builder) error {
		return table.Write(b, Terminal{Width: &width, Depth: ANSI16})
	})
}

func TestTableEscapesControlsAndKeepsTheNoteSlot(t *testing.T) {
	table := NewTable(ColumnName, ColumnDetail)
	table.SetIndent(0)
	table.AddRow(Cell{Text: "a\tb"}, Cell{Text: "\x1b[31m\n\u2028"})
	table.AddNote("basic", Cell{Text: "x"}, Cell{Text: `\n`})
	renderGolden(t, `a\tb  \u{1b}[31m\n\u{2028}
x     \n                    basic
`, func(out *strings.Builder) error { return table.Write(out, Terminal{}) })
}

func TestMessageSnapshots(t *testing.T) {
	for _, tc := range []struct {
		terminal Terminal
		golden   string
	}{
		{Terminal{Depth: ANSI16}, messagesOnATerminalGolden},
		{Terminal{}, messagesThroughAPipeGolden},
	} {
		renderGolden(t, tc.golden, func(b *strings.Builder) error {
			if err := WriteSuccess(b, tc.terminal, "Named pane %3 worker."); err != nil {
				return err
			}
			return WriteError(b, tc.terminal, "Identity 'nobody' was not found.", "tmt ls")
		})
	}
}

const helpOnATerminalGolden = `Send a message to an agent

\u{1b}[1mUsage:\u{1b}[0m \u{1b}[1mtmt talk\u{1b}[0m [OPTIONS] <target> <message>

\u{1b}[1mArguments:\u{1b}[0m
  <target>   Agent name
  <message>  Message text

\u{1b}[1mOptions:\u{1b}[0m
  \u{1b}[1m-h\u{1b}[0m, \u{1b}[1m--help\u{1b}[0m  Print help
      \u{1b}[1m--json\u{1b}[0m  Output one JSON document
      \u{1b}[1m--wait\u{1b}[0m  Wait for the reply

\u{1b}[1mExamples:\u{1b}[0m
  \u{1b}[2m# Send a message to one agent\u{1b}[0m
  tmt talk worker "Run the tests"

  \u{1b}[2m# Wait for the reply\u{1b}[0m
  tmt talk worker "Summarize" --wait
`

const helpThroughAPipeGolden = `Send a message to an agent

Usage: tmt talk [OPTIONS] <target> <message>

Arguments:
  <target>   Agent name
  <message>  Message text

Options:
  -h, --help  Print help
      --json  Output one JSON document
      --wait  Wait for the reply

Examples:
  # Send a message to one agent
  tmt talk worker "Run the tests"

  # Wait for the reply
  tmt talk worker "Summarize" --wait
`

const rootHelpRendersDiscoveredSectionsInTheTemplateGolden = `Collaborate with agents through durable tmux exchanges

Usage: tmt [OPTIONS] [COMMAND]

Commands:
  ls  List agents

Options:
  -h, --help  Print help
      --json  Output one JSON document

Extensions:
  squad (also: sq)  Lead a squad of agents
  office            Run the local Office

Examples:
  # See every agent
  tmt ls
`

const listOnATerminalGolden = `\u{1b}[1mSAVED\u{1b}[0m \u{1b}[2m3\u{1b}[0m
  \u{1b}[34m●\u{1b}[0m  astra            \u{1b}[36mcodex:019a2f4c\u{1b}[0m   ~/dev/tmt-local
  \u{1b}[34m●\u{1b}[0m  opus-tmt-peer-2  \u{1b}[35mclaude:7c41e9d2\u{1b}[0m  ~/dev/tmt-local/worktr…
  \u{1b}[2m○\u{1b}[0m  sol              \u{1b}[35mclaude:3f9a1c07\u{1b}[0m  ~/dev/tmt-local          \u{1b}[34m↻ tmt resume sol\u{1b}[0m

\u{1b}[1mTEMPORARY\u{1b}[0m \u{1b}[2m2\u{1b}[0m
  \u{1b}[34m●\u{1b}[0m  mamezu-astra     \u{1b}[36mcodex:01a9c3b8\u{1b}[0m   ~/dev/mosaic-art
  \u{1b}[2m◌\u{1b}[0m  opus-1           \u{1b}[2mtmux:%31\u{1b}[0m         /srv/builds/nightly      \u{1b}[34mshell\u{1b}[0m
    \u{1b}[2moffline: gemini-helper · night-owl\u{1b}[0m
\u{1b}[34mhint:\u{1b}[0m tmt ls --all shows offline identities
`

const listOnANarrowTerminalGolden = `\u{1b}[1mSAVED\u{1b}[0m \u{1b}[2m3\u{1b}[0m
  \u{1b}[34m●\u{1b}[0m  ast…  \u{1b}[36mcodex:019a2f4c\u{1b}[0m   ~/d…
  \u{1b}[34m●\u{1b}[0m  opu…  \u{1b}[35mclaude:7c41e9d2\u{1b}[0m  ~/d…
  \u{1b}[2m○\u{1b}[0m  sol   \u{1b}[35mclaude:3f9a1c07\u{1b}[0m  ~/d…  \u{1b}[34m↻ tmt resume sol\u{1b}[0m

\u{1b}[1mTEMPORARY\u{1b}[0m \u{1b}[2m2\u{1b}[0m
  \u{1b}[34m●\u{1b}[0m  mam…  \u{1b}[36mcodex:01a9c3b8\u{1b}[0m   ~/d…
  \u{1b}[2m◌\u{1b}[0m  opu…  \u{1b}[2mtmux:%31\u{1b}[0m         /sr…  \u{1b}[34mshell\u{1b}[0m
    \u{1b}[2moffline: gemini-helper · night-owl\u{1b}[0m
\u{1b}[34mhint:\u{1b}[0m tmt ls --all shows offline identities
`

const listThroughAPipeGolden = `SAVED 3
  ●  astra            codex:019a2f4c   ~/dev/tmt-local
  ●  opus-tmt-peer-2  claude:7c41e9d2  ~/dev/tmt-local/worktrees/feature-branch
  ○  sol              claude:3f9a1c07  ~/dev/tmt-local                           ↻ tmt resume sol

TEMPORARY 2
  ●  mamezu-astra     codex:01a9c3b8   ~/dev/mosaic-art
  ◌  opus-1           tmux:%31         /srv/builds/nightly                       shell
    offline: gemini-helper · night-owl
hint: tmt ls --all shows offline identities
`

const messagesOnATerminalGolden = `\u{1b}[32m✓\u{1b}[0m Named pane %3 worker
\u{1b}[31merror:\u{1b}[0m Identity 'nobody' was not found
\u{1b}[34mhint:\u{1b}[0m tmt ls
`

const messagesThroughAPipeGolden = `✓ Named pane %3 worker
error: Identity 'nobody' was not found
hint: tmt ls
`
