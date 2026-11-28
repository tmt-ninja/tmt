package cli

import (
	"fmt"
	"io"
	"strings"
)

func renderHelp(w io.Writer, path []string) error {
	command := &grammar
	for _, name := range path {
		command = command.child(name)
	}
	var result strings.Builder
	if command.summary != "" {
		fmt.Fprintf(&result, "%s\n\n", command.summary)
	}
	fmt.Fprintf(&result, "Usage: %s", strings.Join(append([]string{grammar.name}, path...), " "))
	if command == &grammar || len(command.children) != 0 {
		fmt.Fprint(&result, " [COMMAND]")
	}
	fmt.Fprint(&result, " [OPTIONS]")
	if command.usage != "" {
		fmt.Fprintf(&result, " %s", command.usage)
	} else {
		for _, operand := range command.operands {
			if operand.required {
				fmt.Fprintf(&result, " <%s>", operand.name)
			} else {
				fmt.Fprintf(&result, " [%s]", operand.name)
			}
		}
	}
	fmt.Fprintln(&result)
	if len(command.children) != 0 {
		fmt.Fprintln(&result, "\nCommands:")
		for _, child := range command.children {
			if child.hidden || child.summary == "" {
				continue
			}
			name := child.name
			if child.visibleAlias != "" {
				name += ", " + child.visibleAlias
			}
			fmt.Fprintf(&result, "  %-14s  %s\n", name, child.summary)
		}
	}
	fmt.Fprintln(&result, "\nOptions:")
	for _, opt := range options {
		if opt.hidden || !command.accepts(opt.name) || command.humanOnly && opt.name == "json" {
			continue
		}
		label := "    --" + opt.name
		if opt.short != 0 {
			label = fmt.Sprintf("-%c, --%s", opt.short, opt.name)
		}
		if opt.value {
			label += " <" + strings.ToUpper(opt.name) + ">"
		}
		fmt.Fprintf(&result, "  %-24s  %s\n", label, opt.help)
	}
	_, err := io.WriteString(w, result.String())
	return err
}
