package cli

import (
	"fmt"
	"io"
	"slices"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/skills"
)

func learnUsage(inv invocation) string {
	list, topic := inv.has("topics"), len(inv.operands) > 0
	usage := "tmt-go learn --skill [<skill>]"
	switch {
	case list:
		usage += " --topics [TOPIC]"
	case topic:
		usage += " <TOPIC>"
	}
	if !inv.has("skill") && (list || topic) {
		return "the following required arguments were not provided:\n  --skill [<skill>]\n\nUsage: " + usage
	}
	if list && topic {
		return "the argument '--topics' cannot be used with '[TOPIC]'\n\nUsage: " + usage
	}
	if !inv.has("skill") {
		return ""
	}
	skill := inv.options["skill"]
	names := skills.Names()
	if !slices.Contains(names, skill) {
		return fmt.Sprintf("invalid value '%s' for '--skill [<skill>]'\n  [possible values: %s]", skill, strings.Join(names, ", "))
	}
	if !list && !topic {
		return ""
	}
	topics, err := skills.Topics(skill)
	if err != nil {
		return fmt.Sprintf("Could not read reference topics for %s.", skill)
	}
	if len(topics) == 0 {
		return fmt.Sprintf("The %s skill has no reference topics", skill)
	}
	if topic && !slices.Contains(topics, inv.operands[0]) {
		return fmt.Sprintf("Unknown %s reference topic '%s'. Topics: %s", skill, inv.operands[0], strings.Join(topics, ", "))
	}
	return ""
}

func writeLearn(w io.Writer, inv invocation) error {
	skill := inv.options["skill"]
	if skill == "" {
		topics, err := skills.Topics("tmt")
		if err != nil {
			return err
		}
		tail := "Use tmt-go help for options.\n"
		if len(topics) > 0 {
			tail = "Use tmt-go learn --skill tmt --topics for references.\n" + tail
		}
		_, err = io.WriteString(w, learnQuickStart+tail)
		return err
	}
	if inv.has("topics") {
		topics, err := skills.Topics(skill)
		if err != nil {
			return err
		}
		_, err = io.WriteString(w, strings.Join(topics, "\n")+"\n")
		return err
	}
	var content []byte
	var err error
	if len(inv.operands) > 0 {
		content, err = skills.ReadTopic(skill, inv.operands[0])
	} else {
		content, err = skills.ReadGuide(skill)
	}
	if err != nil {
		return err
	}
	_, err = w.Write(content)
	return err
}

// NOT PORTED (CLI-45): Native quick start and bundled reference parity.
const learnQuickStart = `TMT — collaborate with terminal agents through durable exchanges.

The Go preview is a standalone runtime and requires no Node.js or daemon.

  tmt-go name alice             Bind this pane temporarily; add -s to save it.
  tmt-go add %14 reviewer       Bind another pane by stable ID.
  tmt-go ls                     Show lifetime and verified presence.
  tmt-go talk reviewer 'Review this patch' --timeout 300 --json
  tmt-go talk reviewer 'Run the tests' --detach --json
  tmt-go result <request-id> --json
  tmt-go x ackall --identity coordinator
  tmt-go config show --json

Talk waits for tmt-go reply. Use exactly the supplied request ID and receipt
with reply --message, --file or --stdin. Timeout ends only the observer.
Preserve the request ID and retrieve its result before considering another send.

Outside tmux, use an existing --identity for attributed talk or x.
Create saved identities with tmt-go identity create <name>. Talk to an
identity with no pane queues for its inbox. Reads never ack.

Read tmt-go learn --skill for safety and usage guidance.
`
