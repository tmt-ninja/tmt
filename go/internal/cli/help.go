package cli

import (
	"io"
	"os"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

func renderHelp(w io.Writer, path []string) error {
	command := &grammar
	for _, name := range path {
		command = command.child(name)
	}
	program := strings.Join(append([]string{grammar.name}, path...), " ")
	examples := helpExamples[strings.Join(path, " ")]
	if command.summary == "" || len(examples) == 0 {
		// Reserved commands keep a minimal usage line until their help is ported.
		_, err := io.WriteString(w, "Usage: "+program+" [OPTIONS]\n")
		return err
	}
	spec := clistyle.HelpSpec{Program: program, Summary: command.summary, Examples: examples}
	var usage []string
	if command == &grammar || len(command.children) != 0 {
		usage = append(usage, "[COMMAND]")
	}
	usage = append(usage, "[OPTIONS]")
	if command.usage != "" {
		usage = append(usage, command.usage)
	} else {
		for _, operand := range command.operands {
			label := "[" + operand.name + "]"
			if operand.required {
				label = "<" + operand.name + ">"
			}
			usage = append(usage, label)
			spec.Arguments = append(spec.Arguments, clistyle.HelpEntry{Name: label})
		}
	}
	spec.Usage = strings.Join(usage, " ")
	for _, child := range command.children {
		if child.hidden || child.summary == "" {
			continue
		}
		name := child.name
		if child.visibleAlias != "" {
			name += ", " + child.visibleAlias
		}
		spec.Commands = append(spec.Commands, clistyle.HelpEntry{Name: name, Description: child.summary})
	}
	for _, opt := range options {
		if opt.hidden || !command.accepts(opt.name) || command.humanOnly && opt.name == "json" {
			continue
		}
		entry := clistyle.HelpOption{Short: opt.short, Long: opt.name, Description: opt.help}
		if opt.value {
			entry.Value = "<" + opt.name + ">"
		}
		spec.Options = append(spec.Options, entry)
	}
	return clistyle.WriteHelp(w, helpTerminal(w), spec)
}

func helpTerminal(w io.Writer) clistyle.Terminal {
	file, ok := w.(*os.File)
	if !ok {
		return clistyle.Terminal{}
	}
	width, ok := clistyle.ProbeWidth(file)
	if !ok {
		return clistyle.Terminal{}
	}
	term := clistyle.Terminal{Width: &width}
	if os.Getenv("NO_COLOR") == "" && os.Getenv("TERM") != "dumb" {
		term.Depth = clistyle.ANSI16
	}
	return term
}

var helpExamples = map[string][]clistyle.Example{
	"": {
		{Note: "List identities and whether they are live", Command: "tmt-go ls"},
		{Note: "Ask an agent and wait for its reply", Command: `tmt-go talk worker "Run the tests"`},
	},
	"help": {
		{Note: "Show help for a command", Command: "tmt-go help talk"},
		{Note: "Show help for a subcommand", Command: "tmt-go help x show"},
	},
	"run": {
		{Note: "Start and name an agent", Command: "tmt-go run worker codex"},
		{Note: "Save the agent for later", Command: "tmt-go run --save worker codex"},
	},
	"ls": {
		{Note: "List identities and whether they are live", Command: "tmt-go ls"},
		{Note: "The same, as JSON", Command: "tmt-go ls --json"},
	},
	"add": {
		{Note: "Bind a pane by its tmux ID", Command: "tmt-go add %3 worker"},
		{Note: "Keep the identity after the pane is gone", Command: "tmt-go add --save %3 worker"},
	},
	"name": {
		{Note: "Name this pane", Command: "tmt-go name worker"},
		{Note: "Keep the identity after the pane is gone", Command: "tmt-go name --save worker"},
	},
	"rm": {
		{Note: "Retire a temporary identity", Command: "tmt-go rm worker"},
		{Note: "Retire a saved identity", Command: "tmt-go rm --force worker"},
	},
	"mv": {{Note: "Give an identity a new name", Command: "tmt-go mv worker reviewer"}},
	"talk": {
		{Note: "Send a message and wait for the reply", Command: `tmt-go talk worker "Run the tests"`},
		{Note: "Send and return at once", Command: `tmt-go talk --detach worker "Deploy when green"`},
	},
	"check": {
		{Note: "Show recent output from an agent's pane", Command: "tmt-go check worker"},
		{Note: "Show the last 50 lines", Command: "tmt-go check worker 50"},
	},
	"stop": {{Note: "Stop an agent by name", Command: "tmt-go stop worker"}},
	"whoami": {
		{Note: "Show this pane's identity", Command: "tmt-go whoami"},
		{Note: "Include pending work", Command: "tmt-go whoami --context"},
	},
	"reply": {{Note: "Reply with a message", Command: `tmt-go reply req_0f8e4b52-3c1d-4a6e-9b7f-2d5c8a1e6f30 --receipt v2_7OxG2uwfdAFFMd0qNWJDnA --message "Done"`}},
	"result": {
		{Note: "Print a request's final response", Command: "tmt-go result req_0f8e4b52-3c1d-4a6e-9b7f-2d5c8a1e6f30"},
		{Note: "Use a unique short request ID", Command: "tmt-go result 0f8e4b52"},
	},
	"inbox": {
		{Note: "What is waiting on you", Command: "tmt-go inbox"},
		{Note: "As a named identity outside its pane", Command: "tmt-go inbox --identity ben"},
	},
	"answer": {{Note: "Answer with a message", Command: `tmt-go answer reviewer "Yes, ship it"`}},
	"x":      {{Note: "List unacknowledged exchanges", Command: "tmt-go x ls"}},
	"x ls": {
		{Note: "List unacknowledged exchanges", Command: "tmt-go x ls"},
		{Note: "Show at most 20", Command: "tmt-go x ls --limit 20"},
	},
	"x show": {{Note: "Show one exchange", Command: "tmt-go x show req_0f8e4b52-3c1d-4a6e-9b7f-2d5c8a1e6f30"}},
	"x ack":  {{Note: "Acknowledge the revision you read", Command: "tmt-go x ack --revision 3 req_0f8e4b52-3c1d-4a6e-9b7f-2d5c8a1e6f30"}},
	"x ackall": {
		{Note: "Acknowledge everything shown so far", Command: "tmt-go x ackall"},
	},
	"x withdraw": {{Note: "Withdraw an obsolete request", Command: `tmt-go x withdraw req_0f8e4b52-3c1d-4a6e-9b7f-2d5c8a1e6f30 --reason "Already resolved"`}},
	"x flow":     {{Note: "Read the last day as UTC buckets", Command: "tmt-go x flow --json"}},
	"x listen":   {{Note: "Wait for new inbox work", Command: "tmt-go x listen"}},
}
