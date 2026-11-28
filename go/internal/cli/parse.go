package cli

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

type invocation struct {
	path     []string
	options  map[string]string
	repeated map[string][]string
	operands []string
	json     bool
	help     bool
	version  bool
}

type argumentScan struct {
	invocation
	helpPath  []string
	helpFound bool
	problem   string
}

func (s *argumentScan) reject(format string, args ...any) {
	if s.problem == "" {
		s.problem = fmt.Sprintf(format, args...)
	}
}

func findOption(chain []*commandSpec, name string, short rune) *optionSpec {
	for i := range options {
		opt := &options[i]
		if (short != 0 && opt.short != short) || (short == 0 && opt.name != name) {
			continue
		}
		leaf := chain[len(chain)-1]
		if slices.Contains(rootOptions, opt.name) || leaf.accepts(opt.name) {
			return opt
		}
		// Only x's explicit selector and cursor options are inherited here.
		if len(chain) > 2 && chain[1].name == "x" && slices.Contains(chain[1].options, opt.name) {
			return opt
		}
		return nil
	}
	return nil
}

func (s *argumentScan) option(chain []*commandSpec, opt *optionSpec, value string, supplied bool, tail []string) int {
	if !opt.value {
		if supplied {
			s.reject("Option '--%s' does not take a value.", opt.name)
			return 0
		}
		s.options[opt.name] = ""
		if opt.name == "help" && !s.helpFound {
			s.helpFound = true
			s.helpPath = slices.Clone(s.path)
		}
		return 0
	}
	if supplied {
		s.setValue(opt, value)
		return 0
	}
	if len(tail) > 0 && tail[0] != "--" && (opt.hyphen || tail[0] == "-" || !strings.HasPrefix(tail[0], "-")) {
		s.setValue(opt, tail[0])
		return 1
	}
	if opt.defaultValue != "" {
		s.setValue(opt, opt.defaultValue)
		return 0
	}
	s.reject("A value is required for '--%s'.", opt.name)
	return 0
}

func (s *argumentScan) setValue(opt *optionSpec, value string) {
	s.options[opt.name] = value
	if opt.repeat {
		if s.repeated == nil {
			s.repeated = make(map[string][]string)
		}
		s.repeated[opt.name] = append(s.repeated[opt.name], value)
	}
}

func scanArguments(args []string) (argumentScan, *commandSpec) {
	scan := argumentScan{invocation: invocation{options: make(map[string]string)}}
	command := &grammar
	chain := []*commandSpec{command}
	for i := 0; i < len(args); i++ {
		token := args[i]
		switch {
		case token == "--":
			scan.operands = append(scan.operands, args[i+1:]...)
			i = len(args)
		case strings.HasPrefix(token, "--"):
			name, value, supplied := strings.Cut(token[2:], "=")
			opt := findOption(chain, name, 0)
			if opt == nil {
				scan.reject("Unexpected argument '%s' found.", token)
				continue
			}
			i += scan.option(chain, opt, value, supplied, args[i+1:])
		case strings.HasPrefix(token, "-") && token != "-":
			if slices.Equal(scan.path, []string{"config", "set"}) && len(scan.operands) == 1 {
				if _, err := strconv.ParseFloat(token, 64); err == nil {
					scan.operands = append(scan.operands, token)
					continue
				}
			}
			for _, short := range token[1:] {
				opt := findOption(chain, "", short)
				if opt == nil {
					scan.reject("Unexpected argument '-%c' found.", short)
					continue
				}
				scan.option(chain, opt, "", false, nil)
			}
		default:
			if len(scan.operands) == 0 {
				if child := command.child(token); child != nil {
					command = child
					chain = append(chain, child)
					scan.path = append(scan.path, child.name)
					continue
				}
				if command == &grammar || len(command.children) > 0 && len(command.operands) == 0 {
					scan.reject("Unrecognized subcommand '%s'.", token)
				}
			}
			scan.operands = append(scan.operands, token)
			if command.trailing && command.name != "help" {
				scan.operands = append(scan.operands, args[i+1:]...)
				i = len(args)
			}
		}
	}
	scan.json = scan.has("json")
	return scan, command
}

func (i invocation) has(name string) bool {
	_, present := i.options[name]
	return present
}

func parse(args []string) (invocation, *output.Failure) {
	scan, command := scanArguments(args)
	parsed := scan.invocation
	fail := func(code, message string) (invocation, *output.Failure) {
		return parsed, &output.Failure{Code: code, Message: message, Status: 1}
	}
	if scan.problem != "" {
		return fail("USAGE_ERROR", scan.problem)
	}
	if parsed.has("wait") {
		return fail("USAGE_ERROR", "The --wait option is retired. talk waits for a durable reply by default; use --timeout or --detach.")
	}
	// Keep diagnostics deterministic even when several options are invalid.
	for _, opt := range options {
		if parsed.has(opt.name) && !command.accepts(opt.name) {
			return fail("USAGE_ERROR", fmt.Sprintf("Unknown option or argument '%s' for %s.", opt.name, command.name))
		}
	}
	if command.name == "team" || parsed.has("team") && command.accepts("team") {
		return fail("UNSUPPORTED_TEAM", "Team workflows are not supported.")
	}
	parsed.version = command == &grammar && parsed.has("version") && !scan.helpFound
	parsed.help = scan.helpFound || command.name == "help" || command == &grammar && !parsed.version
	if parsed.help {
		path := scan.helpPath
		if !scan.helpFound && command.name == "help" {
			path = parsed.operands
		}
		var err error
		parsed.path, err = publicPath(path)
		if err != nil {
			return fail("USAGE_ERROR", err.Error())
		}
	}
	if parsed.json && (parsed.help || parsed.version) {
		return fail("JSON_UNSUPPORTED", "This command does not support --json.")
	}
	if !parsed.help && !parsed.version {
		if problem := validateCommand(command, parsed); problem != "" {
			return fail("USAGE_ERROR", problem)
		}
	}
	if parsed.json && command.name == "resume" {
		return fail("USAGE_ERROR", "Unknown option or argument 'json' for resume.\nUsage: tmt-go resume [OPTIONS] [name]\nTry `tmt-go help resume` for supported options.")
	}
	if parsed.json && command.humanOnly {
		return fail("JSON_UNSUPPORTED", "This command does not support --json.")
	}
	return parsed, nil
}

func publicPath(path []string) ([]string, error) {
	command := &grammar
	var canonical []string
	for _, name := range path {
		child := command.child(name)
		if child == nil || child.hidden {
			parent := strings.Join(append([]string{grammar.name}, canonical...), " ")
			hint := strings.Join(append([]string{grammar.name, "help"}, canonical...), " ")
			return nil, fmt.Errorf("Unknown command '%s' after %s.\nRun %s to see its commands.", name, parent, hint)
		}
		canonical = append(canonical, child.name)
		command = child
	}
	return canonical, nil
}

func validateCommand(command *commandSpec, parsed invocation) string {
	if command.summary == "" {
		return ""
	}
	if !command.trailing && !command.variadic && len(parsed.operands) > len(command.operands) {
		return fmt.Sprintf("Unexpected argument '%s' found.", parsed.operands[len(command.operands)])
	}
	for i, operand := range command.operands {
		if operand.required && len(parsed.operands) <= i {
			return fmt.Sprintf("Missing required argument '<%s>'.", operand.name)
		}
	}

	if command.name == "learn" {
		return learnUsage(parsed)
	}

	required, conflicts, requires := commandConstraints(parsed)
	for _, name := range required {
		if !parsed.has(name) {
			return fmt.Sprintf("Missing required option '--%s'.", name)
		}
	}
	for _, pair := range conflicts {
		if parsed.has(pair[0]) && parsed.has(pair[1]) {
			return fmt.Sprintf("Options '--%s' and '--%s' cannot be used together.", pair[0], pair[1])
		}
	}
	for _, pair := range requires {
		if parsed.has(pair[0]) && !parsed.has(pair[1]) {
			return fmt.Sprintf("Option '--%s' requires '--%s'.", pair[0], pair[1])
		}
	}
	return validateOperands(parsed)
}

func commandConstraints(parsed invocation) (required []string, conflicts, requires [][2]string) {
	switch strings.Join(parsed.path, " ") {
	case "ls":
		conflicts = [][2]string{{"saved", "temp"}, {"detected", "room"}, {"detected", "here"}}
		requires = [][2]string{{"host", "detected"}, {"socket", "detected"}}
	case "add":
		requires = [][2]string{{"identity", "expect"}, {"socket", "expect"}}
	case "run":
		conflicts = [][2]string{{"model", "resume"}, {"effort", "resume"}, {"channel", "no-channel"}}
	case "resume":
		conflicts = [][2]string{
			{"driver", "forget"}, {"driver", "forget-launch"}, {"driver", "show"},
			{"move", "forget"}, {"move", "forget-launch"}, {"move", "show"},
			{"new", "driver"}, {"new", "move"}, {"new", "retry"}, {"new", "forget"}, {"new", "forget-launch"}, {"new", "show"},
			{"retry", "forget"}, {"show", "forget"}, {"show", "forget-launch"}, {"show", "retry"},
			{"show", "channel"}, {"show", "no-channel"}, {"show", "model"}, {"show", "effort"},
			{"forget-launch", "forget"}, {"forget-launch", "retry"}, {"forget-launch", "channel"}, {"forget-launch", "no-channel"},
			{"forget-launch", "model"}, {"forget-launch", "effort"}, {"forget", "model"}, {"forget", "effort"},
			{"forget", "channel"}, {"forget", "no-channel"}, {"channel", "no-channel"},
		}
	case "reply":
		required = []string{"receipt"}
	case "x ack":
		required = []string{"revision"}
	case "x withdraw":
		required = []string{"reason"}
	}
	return
}

func validateOperands(parsed invocation) string {
	switch parsed.path[0] {
	case "extension", "driver", "host":
		if len(parsed.path) == 1 {
			subcommands := map[string]string{
				"extension": "hooks, install, upgrade, rm, uninstall, ls, list",
				"driver":    "install, ls, list, rm",
				"host":      "templates",
			}
			name := parsed.path[0]
			return fmt.Sprintf("error: 'tmt-go %s' requires a subcommand but one was not provided\n  [subcommands: %s]\n\nUsage: tmt-go %s [OPTIONS] <COMMAND>\n", name, subcommands[name], name)
		}
	case "completion", "__completion-script":
		if len(parsed.operands) == 1 && !slices.Contains(completionShells, parsed.operands[0]) {
			return fmt.Sprintf("Invalid value '%s' for '<shell>'.", parsed.operands[0])
		}
	case "identity":
		if parsed.has("expect-name") && (len(parsed.operands) != 1 || !core.IsCanonicalIdentityID(parsed.operands[0])) {
			return "--expect-name needs the identity's UUID."
		}
	case "ls":
		if len(parsed.operands) != 0 {
			for _, name := range []string{"room", "saved", "temp", "here", "all", "detected"} {
				if parsed.has(name) {
					return fmt.Sprintf("Option '--%s' cannot be used with a target.", name)
				}
			}
		}
	case "add":
		if len(parsed.operands) == 1 && !parsed.has("identity") {
			return "Missing required argument '<name>'."
		}
		if len(parsed.operands) == 2 && parsed.has("identity") {
			return "Option '--identity' cannot be used with a name."
		}
	case "check":
		if parsed.has("expect-name") && (!parsed.has("capture-only") || !core.IsCanonicalIdentityID(parsed.operands[0])) {
			return "--expect-name needs --capture-only and the identity's canonical UUIDv4."
		}
		_, failure := checkLines(parsed)
		return failure
	case "run":
		return validateRunOperands(parsed)
	case "resume":
		if len(parsed.operands) == 0 && (parsed.has("move") || parsed.has("driver")) {
			return "Missing required argument '<name>'."
		}
	case "__hook":
		if parsed.operands[0] != "claude" {
			return fmt.Sprintf("Invalid value '%s' for '<provider>'.", parsed.operands[0])
		}
	case "talk":
		if parsed.has("timeout") && parsed.has("detach") {
			return "Use either --timeout or --detach, not both."
		}
		if kind := parsed.options["kind"]; parsed.has("kind") && !slices.Contains([]string{"decision", "review", "fyi"}, kind) {
			return fmt.Sprintf("Invalid value '%s' for '--kind'.", kind)
		}
	case "reply":
		return validateContent(parsed, parsed.has("message"))
	case "answer":
		if !parsed.has("request") && len(parsed.operands) == 0 {
			return "Usage: name who is waiting (tmt-go answer <from> <text>) or choose --request <id>."
		}
		return validateContent(parsed, answerOperands(parsed).inline)
	case "inbox":
		_, failure := optionalDecimal(parsed, "limit", 1, 200)
		return failure
	case "x":
		return validateExchangeOptions(parsed)
	}
	return ""
}

func validateRunOperands(inv invocation) string {
	if host := inv.options["host"]; inv.has("host") && !slices.Contains([]string{"tmux", "herdr", "pty"}, host) {
		return fmt.Sprintf("Invalid value '%s' for '--host'.", host)
	}
	name := inv.operands[0]
	if !utf8.ValidString(name) {
		return "Identity name must be valid UTF-8."
	}
	if len(inv.operands) == 1 {
		return ""
	}
	if !nativeRunProvider(name) && strings.HasPrefix(inv.operands[1], "-") {
		return "The command must not start with '-'. TMT options go before the name: tmt-go run -s Alice <command>."
	}
	if inv.has("resume") {
		return "Use `tmt-go run --resume <name>` to resume, or pass the command's own flags after the name; do not combine both forms."
	}
	return ""
}

// The grammar preserves native provider tails even for executables outside the
// phase 1 driver set. Selection and host admission happen after parsing.
func nativeRunProvider(executable string) bool {
	switch executable {
	case "claude", "codex", "gemini", "agy", "pi", "opencode", "muse", "cursor-agent":
		return true
	}
	return false
}

func validateContent(parsed invocation, inline bool) string {
	sources := 0
	for _, supplied := range []bool{inline, parsed.has("file"), parsed.has("stdin")} {
		if supplied {
			sources++
		}
	}
	if sources != 1 {
		return "Usage: select exactly one inline content, --file, or supported --stdin source."
	}
	return ""
}

// optionalDecimal matches the native decimal-only option grammar. An omitted
// option returns zero so the service can apply its own default.
func optionalDecimal(inv invocation, name string, minimum, maximum uint64) (uint64, string) {
	if !inv.has(name) {
		return 0, ""
	}
	return parseDecimal(inv.options[name], "--"+name, minimum, maximum)
}

func parseDecimal(value, label string, minimum, maximum uint64) (uint64, string) {
	number, err := strconv.ParseUint(value, 10, 64)
	if err != nil || number < minimum || number > maximum {
		return 0, fmt.Sprintf("%s must be a decimal integer between %d and %d.", label, minimum, maximum)
	}
	return number, ""
}

func validateExchangeOptions(inv invocation) string {
	if len(inv.path) == 2 {
		switch inv.path[1] {
		case "ack":
			_, failure := optionalDecimal(inv, "revision", 1, core.MaxJSSafeInteger)
			return failure
		case "ls":
		default:
			return ""
		}
	}
	if _, failure := optionalDecimal(inv, "limit", 1, 200); failure != "" {
		return failure
	}
	_, failure := optionalDecimal(inv, "after", 0, core.MaxJSSafeInteger)
	return failure
}
