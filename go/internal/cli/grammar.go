package cli

import (
	"slices"

	"github.com/tmt-ninja/tmt/go/internal/flavor"
)

type optionSpec struct {
	name, help   string
	short        rune
	value        bool
	defaultValue string
	hyphen       bool
	hidden       bool
	repeat       bool
}

type operandSpec struct {
	name     string
	required bool
}

type commandSpec struct {
	name, summary, usage string
	aliases              []string
	visibleAlias         string
	options              []string
	operands             []operandSpec
	children             []commandSpec
	trailing             bool
	variadic             bool
	hidden               bool
	humanOnly            bool
}

func (c *commandSpec) child(name string) *commandSpec {
	for i := range c.children {
		child := &c.children[i]
		if child.name == name || child.visibleAlias == name || slices.Contains(child.aliases, name) {
			return child
		}
	}
	return nil
}

func (c *commandSpec) accepts(name string) bool {
	if name == "help" || name == "json" {
		return true
	}
	if c == &grammar {
		return name == "version" || name == "team"
	}
	if name == "team" {
		switch c.name {
		case "help", "ls", "add", "name", "rm", "talk", "check", "stop", "whoami", "team":
			return true
		}
	}
	return slices.Contains(c.options, name)
}

func required(name string) operandSpec { return operandSpec{name: name, required: true} }
func optional(name string) operandSpec { return operandSpec{name: name} }

var rootOptions = []string{"json", "force", "config", "delay", "wait", "detach", "timeout", "lines", "no-preamble", "team", "help", "version"}

var options = []optionSpec{
	{name: "json", help: "Output one JSON document"},
	{name: "force", short: 'f', help: "Authorize the command's documented protected replacement or removal"},
	{name: "config", value: true, hyphen: true, hidden: true},
	{name: "delay", value: true, hyphen: true, help: "Pre-send delay in seconds or with ms/s/m suffix"},
	{name: "wait", hidden: true},
	{name: "detach", help: "Return after sending"},
	{name: "timeout", value: true, hyphen: true, help: "Observer timeout in seconds or with ms/s/m suffix"},
	{name: "lines", value: true, hyphen: true, help: "Diagnostic capture line count"},
	{name: "no-preamble", help: "Skip the recipient preamble"},
	{name: "team", value: true, hyphen: true, hidden: true},
	{name: "help", short: 'h', help: "Print help"},
	{name: "version", short: 'V', help: "Print version"},
	{name: "save", short: 's', help: "Preserve this identity after its pane is gone"},
	{name: "room", value: true, help: "Restrict to a room UUID or unique exact name"},
	{name: "saved", help: "Only saved identities"},
	{name: "temp", help: "Only temporary identities"},
	{name: "here", help: "Only agents in this tmux session"},
	{name: "all", help: "Show offline identities one per row"},
	{name: "detected", help: "Also show agent panes that have no identity"},
	{name: "host", value: true, help: "Host to use for this operation"},
	{name: "socket", value: true, help: "Exact host socket"},
	{name: "expect", value: true, help: "Require the exact discovery target digest before binding"},
	{name: "identity", value: true, help: "Select an explicit identity"},
	{name: "close", help: "Also close the pane " + flavor.Binary + " opened for the agent; never one you created"},
	{name: "capture-only", help: "Capture the pane without delivering a retained Digest checklist"},
	{name: "expect-name", value: true, help: "Refuse unless the UUID still has this name"},
	{name: "context", help: "Read bounded identity and pending-work context without changing state"},
	{name: "model", value: true, help: "Start a known agent with this model; put this option before the name"},
	{name: "effort", value: true, help: "Start a known agent with this reasoning effort; put this option before the name"},
	{name: "driver", value: true},
	{name: "move"},
	{name: "new"},
	{name: "retry"},
	{name: "show"},
	{name: "forget"},
	{name: "forget-launch"},
	{name: "resume", help: "Resume the remembered session; put this option before the name"},
	{name: "channel", help: "Require an experimental message channel"},
	{name: "no-channel", help: "Use plain paste delivery for this launch (put before the name)"},
	{name: "remote", value: true, help: "Send to an agent on this Remote peer and return at once"},
	{name: "urgent", help: "Bypass Digest only; all delivery guards still apply"},
	{name: "passthrough", help: "Type a person's own message into the agent's pane as is; not a request, returns at once"},
	{name: "kind", value: true, help: "Checklist purpose (default: fyi)"},
	{name: "limit", value: true, help: "Maximum exchanges, 1 through 200"},
	{name: "after", value: true, help: "List revisions after this cursor"},
	{name: "since", value: true, help: "Window: integer seconds or ms/s/m/h/d; default 24h, maximum 30d"},
	{name: "bucket", value: true, help: "Sum rows into buckets of this length, a multiple of 30m (default 30m)"},
	{name: "incoming", help: "Use recipient-facing request attention"},
	{name: "revision", value: true, help: "Observed revision to acknowledge"},
	{name: "reason", value: true, help: "Why the request is obsolete (1–1024 UTF-8 bytes)"},
	{name: "debounce", value: true, help: "Trailing quiet interval in seconds or ms/s/m suffix"},
	{name: "file", value: true, help: "Read content from a regular file"},
	{name: "message", value: true, help: "Submit exact inline content"},
	{name: "stdin", help: "Read complete input through EOF"},
	{name: "receipt", value: true, help: "Receipt supplied by talk"},
	{name: "from", value: true, help: "Only requests from this identity"},
	{name: "request", value: true, help: "Answer this open request ID"},
	{name: "where", value: true, repeat: true},
	{name: "has", value: true, repeat: true},
	{name: "mood", value: true},
	{name: "for", value: true, hyphen: true},
	{name: "prefix", value: true},
	{name: "skill", value: true, defaultValue: "tmt"},
	{name: "topics"},
	{name: "check"},
	{name: "global"},
	{name: "activity-only", hidden: true},
}

var grammar = commandSpec{
	name: flavor.Binary, summary: "TMT native alpha: collaborate with terminal agents through durable exchanges",
	children: []commandSpec{
		{name: "help", summary: "Show help for a command", trailing: true, humanOnly: true, operands: []operandSpec{optional("command-path")}},
		{name: "extension", summary: "Manage consented extension integrations", children: []commandSpec{
			{name: "ls", aliases: []string{"list"}, summary: "List official extensions, versions and PATH shadowing", options: []string{"prefix", "check"}},
		}},
		{name: "driver", summary: "Manage consented drivers", children: []commandSpec{
			{name: "ls", aliases: []string{"list"}, summary: "List approved drivers"},
		}},
		{name: "host", summary: "Inspect the terminal hosts TMT can drive", children: []commandSpec{
			{name: "templates", summary: "Show the default launch templates"},
		}},
		{name: "learn", summary: "Read agent guidance", humanOnly: true, options: []string{"skill", "topics"}, operands: []operandSpec{optional("TOPIC")}},
		{name: "completion", summary: "Check shell completion setup", operands: []operandSpec{optional("shell")}},
		{name: "storage", summary: "Show what local stores occupy on disk"},
		{name: "init", summary: "Create workspace settings"},
		{name: "config", summary: "View or modify settings", children: []commandSpec{
			{name: "show", summary: "Show settings"},
			{name: "set", summary: "Set a setting", options: []string{"global"}, operands: []operandSpec{required("key"), required("value")}},
			{name: "rm", aliases: []string{"clear"}, summary: "Reset local setting overrides", operands: []operandSpec{optional("key")}},
		}},
		{name: "identity", summary: "Manage identity records, metadata and self-reported status", children: []commandSpec{
			{name: "create", summary: "Create or save an identity", operands: []operandSpec{required("name")}},
			{name: "mv", aliases: []string{"rename"}, summary: "Rename an identity", operands: []operandSpec{required("old"), required("new")}},
			{name: "show", summary: "Show an identity", operands: []operandSpec{optional("name")}, options: []string{"expect-name"}},
			{name: "ls", aliases: []string{"list"}, summary: "List non-retired identities", options: []string{"where", "has"}},
			{name: "status", summary: "Manage self-reported status", children: []commandSpec{
				{name: "show", summary: "Show current or stale status", options: []string{"identity"}},
				{name: "set", summary: "Replace status and renew its expiry", options: []string{"identity", "mood", "for"}, operands: []operandSpec{required("activity")}},
				{name: "rm", aliases: []string{"clear"}, summary: "Remove self-reported status", options: []string{"identity"}},
			}},
			{name: "meta", summary: "Manage descriptive metadata", children: []commandSpec{
				{name: "apply", summary: "Apply conditional metadata changes from JSON stdin", options: []string{"identity"}},
				{name: "set", summary: "Set a metadata value", options: []string{"identity"}, operands: []operandSpec{required("key"), required("value")}},
				{name: "show", aliases: []string{"get"}, summary: "Show a metadata value", options: []string{"identity"}, operands: []operandSpec{required("key")}},
				{name: "ls", aliases: []string{"list"}, summary: "List metadata values", options: []string{"identity"}},
				{name: "rm", summary: "Remove a metadata value", options: []string{"identity"}, operands: []operandSpec{required("key")}},
			}},
		}},
		{name: "notes", summary: "Access saved identity notes", children: []commandSpec{
			{name: "path", summary: "Initialize and print the local Markdown path", options: []string{"identity"}},
		}},
		{name: "role", summary: "Manage role profiles", options: []string{"identity"}, children: []commandSpec{
			{name: "show", summary: "Show a role", options: []string{"identity"}},
			{name: "set", summary: "Set a role from inline text or file", options: []string{"identity", "file"}, operands: []operandSpec{optional("content")}},
			{name: "rm", aliases: []string{"clear"}, summary: "Remove only the role", options: []string{"identity"}},
		}},
		{name: "preamble", summary: "Manage identity-owned preambles", children: []commandSpec{
			{name: "show", summary: "Show preambles", operands: []operandSpec{optional("agent")}},
			{name: "set", summary: "Set a preamble", operands: []operandSpec{required("agent"), required("content")}, variadic: true},
			{name: "rm", aliases: []string{"clear"}, summary: "Remove only the preamble", operands: []operandSpec{required("agent")}},
		}},
		{name: "resume", summary: "Resume an identity's remembered session in this pane", humanOnly: true,
			operands: []operandSpec{optional("name")},
			options:  []string{"driver", "move", "new", "retry", "show", "forget", "forget-launch", "host", "model", "effort", "channel", "no-channel"}},
		{name: "run", summary: "Start a known agent, or bind this pane and run a command", usage: "AGENT [ARGS...] | NAME [COMMAND...]",
			humanOnly: true, trailing: true, operands: []operandSpec{required("run-argv")},
			options: []string{"save", "model", "effort", "resume", "host", "channel", "no-channel"}},
		{name: "ls", aliases: []string{"list"}, summary: "List global identities, lifetime and live presence",
			operands: []operandSpec{optional("target")}, options: []string{"room", "saved", "temp", "here", "all", "detected", "host", "socket"}},
		{name: "add", summary: "Bind an explicit pane; temporary unless saved",
			operands: []operandSpec{required("pane-target"), optional("name")}, options: []string{"save", "identity", "expect", "socket"}},
		{name: "name", visibleAlias: "this", summary: "Bind this pane; temporary unless saved",
			operands: []operandSpec{required("name")}, options: []string{"save"}},
		{name: "rm", aliases: []string{"remove"}, summary: "Retire identity and remove role/preamble; keep pane/exchanges (--force for saved)",
			operands: []operandSpec{required("name")}, options: []string{"force"}},
		{name: "mv", aliases: []string{"rename"}, summary: "Rename an identity; its UUID, session, profile, notes and history stay",
			operands: []operandSpec{required("old"), required("new")}},
		{name: "talk", visibleAlias: "send", summary: "Send a request and wait for its durable reply",
			operands: []operandSpec{required("target"), required("message")},
			options:  []string{"force", "delay", "detach", "timeout", "no-preamble", "identity", "room", "remote", "expect-name", "urgent", "passthrough", "kind"}},
		{name: "check", visibleAlias: "read", summary: "Capture diagnostic pane output",
			operands: []operandSpec{required("target"), optional("capture-lines")}, options: []string{"lines", "capture-only", "expect-name"}},
		{name: "stop", summary: "Stop an agent safely, keeping its identity, binding and session",
			operands: []operandSpec{required("name")}, options: []string{"close"}},
		{name: "unbind", summary: "Detach this pane; retire temporary identity"},
		{name: "whoami", summary: "Show this pane's verified identity", options: []string{"context"}},
		{name: "reply", summary: "Submit an exact final response",
			operands: []operandSpec{required("request-id")}, options: []string{"file", "message", "stdin", "receipt"}},
		{name: "send-now", summary: "Send an eligible queued message now", operands: []operandSpec{required("request-id")}, options: []string{"identity"}},
		{name: "result", summary: "Retrieve a retained final response", operands: []operandSpec{required("request-id")}},
		{name: "inbox", summary: "List requests waiting on you for a final response", options: []string{"identity", "limit", "from"}},
		{name: "answer", summary: "Answer the request an identity is waiting on you for",
			operands: []operandSpec{optional("from"), optional("content")}, options: []string{"identity", "request", "file", "stdin"}},
		{name: "x", summary: "Inspect and acknowledge exchanges", options: []string{"identity", "limit", "after"}, children: []commandSpec{
			{name: "flow", summary: "Read content-free exchange counts for the whole local team", options: []string{"since", "bucket"}},
			{name: "ls", aliases: []string{"list"}, summary: "List unacknowledged exchanges", options: []string{"identity", "limit", "after"}},
			{name: "show", summary: "Show retained exchange content", operands: []operandSpec{required("request-id")}, options: []string{"identity", "incoming"}},
			{name: "ack", summary: "Acknowledge an observed revision", operands: []operandSpec{required("request-id")}, options: []string{"identity", "incoming", "revision"}},
			{name: "withdraw", summary: "Withdraw your obsolete unanswered request", operands: []operandSpec{required("request-id")}, options: []string{"identity", "reason"}},
			{name: "ackall", summary: "Acknowledge the current identity snapshot", options: []string{"identity", "incoming"}},
			{name: "listen", summary: "Wait for incoming inbox activity", options: []string{"identity", "room", "timeout", "debounce"}},
		}},
	},
}

func init() {
	// Public help also reserves the names of commands whose execution is pending.
	grammar.children = append(grammar.children, commandSpec{name: "upgrade", visibleAlias: "update"})
	registerPublicHelpTopics(&grammar)
	for _, name := range []string{
		"team", "__allowance", "__channel-server",
		"__consumption-sample", "__flush", "__native-compact-database",
		"__native-install", "__native-refresh-integrations", "__native-refresh-skills",
		"__native-rename-database", "__native-schema", "__native-upgrade-extensions",
		"__pty-serve", "__reply-notice-worker", "__request-observer",
	} {
		grammar.children = append(grammar.children, commandSpec{name: name, hidden: true})
	}
	grammar.children = append(grammar.children,
		commandSpec{name: "__completion-script", summary: "Internal shell completion script", hidden: true, humanOnly: true, operands: []operandSpec{required("shell")}},
		commandSpec{name: "__complete", summary: "Internal shell completion context", hidden: true, humanOnly: true, trailing: true},
	)
	grammar.children = append(grammar.children, commandSpec{
		name: "__hook", hidden: true, summary: "Internal bounded provider lifecycle callback",
		operands: []operandSpec{required("provider")}, options: []string{"activity-only"},
	})
	grammar.children = append(grammar.children, commandSpec{name: "__digest-hook", aliases: []string{"__focus-hook"}, hidden: true})
}
