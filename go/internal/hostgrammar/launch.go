package hostgrammar

import (
	"fmt"
	"slices"
	"strings"
	"unicode"
)

const (
	wordsMin = 2
	wordsMax = 16
	wordMax  = 1024
	totalMax = 4096
)

const (
	// Session is the word the session name fills.
	Session = "{session}"
	// Command is the word the command fills: one argument holding the command line to run.
	Command = "{command}"
)

// Placeholders are the placeholder names, as the public read lists them.
var Placeholders = [2]string{"session", "command"}

// LaunchTemplate is a host's validated default launch template: the argv that opens a new pane
// in a session and runs one command there (contracts/driver-protocol-v1.md).
type LaunchTemplate struct {
	argv []string
}

// NewLaunchTemplate validates 2-16 words of plain text, each at most 1024 bytes and 4096 in all;
// the first is a literal program; {session} and {command} appear only as whole words, the first
// at least once and the second exactly once. A word that only contains one of them, or is any
// other {name}, is refused, so nothing is silently left unexpanded.
func NewLaunchTemplate(argv []string) (*LaunchTemplate, error) {
	if len(argv) < wordsMin || len(argv) > wordsMax {
		return nil, NewGrammarError("launch has 2 to 16 words")
	}
	total := 0
	for _, word := range argv {
		total += len(word)
	}
	if total > totalMax {
		return nil, NewGrammarError("launch is at most 4096 bytes")
	}
	sessions, commands := 0, 0
	for index, word := range argv {
		if len(word) == 0 || len(word) > wordMax || hasControlChar(word) {
			return nil, NewGrammarError(fmt.Sprintf(
				"launch word %d must be 1 to 1024 bytes without control characters",
				index+1,
			))
		}
		switch {
		case word == Session:
			sessions++
		case word == Command:
			commands++
		case strings.Contains(word, Session) || strings.Contains(word, Command) || wholePlaceholder(word):
			return nil, NewGrammarError(fmt.Sprintf(
				"launch word %d may use %s and %s only as whole words",
				index+1, Session, Command,
			))
		}
		if index == 0 && (word == Session || word == Command) {
			return nil, NewGrammarError("launch starts with a literal program")
		}
	}
	if sessions == 0 || commands != 1 {
		return nil, NewGrammarError(fmt.Sprintf(
			"launch has %s at least once and %s exactly once",
			Session, Command,
		))
	}
	return &LaunchTemplate{argv: slices.Clone(argv)}, nil
}

// Argv returns a copy of the validated template words.
func (t *LaunchTemplate) Argv() []string {
	return slices.Clone(t.argv)
}

// IsPlaceholder reports whether word is one of the two words a caller fills.
func IsPlaceholder(word string) bool {
	return word == Session || word == Command
}

func hasControlChar(s string) bool {
	for _, r := range s {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}

// wholePlaceholder reports whether word is {name} as a whole word: placeholder syntax
// that is not one of ours.
func wholePlaceholder(word string) bool {
	if len(word) <= 2 || word[0] != '{' || word[len(word)-1] != '}' {
		return false
	}
	return !strings.ContainsAny(word[1:len(word)-1], "{}")
}
