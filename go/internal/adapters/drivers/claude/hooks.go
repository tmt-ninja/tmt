package claude

import (
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"unicode"

	"github.com/tmt-ninja/tmt/go/internal/invoke"
)

const settingsLimit = 1024 * 1024

type hookCommand struct {
	Type    string `json:"type"`
	Command string `json:"command"`
	Timeout int    `json:"timeout"`
}

type hookGroup struct {
	Matcher string        `json:"matcher,omitempty"`
	Hooks   []hookCommand `json:"hooks"`
}

// withHooks adds the native lifecycle observations to Claude's invocation-only
// settings layer. The caller supplies a tmt-go with a wired __hook handler.
func withHooks(args []string, executable string) ([]string, error) {
	if !filepath.IsAbs(executable) || filepath.Base(executable) != "tmt-go" ||
		strings.IndexFunc(executable, unicode.IsControl) >= 0 || !invoke.IsExecutable(executable) {
		return nil, errors.New("Claude hooks require an absolute tmt-go callback executable")
	}
	boundary := slices.Index(args, "--")
	if boundary < 0 {
		boundary = len(args)
	}
	insert, remove := boundary, 0
	input := "{}"
	for i := 0; i < boundary; i++ {
		word := args[i]
		if word == "--bare" || word == "--safe-mode" {
			return nil, errors.New("the Claude launch disables hooks")
		}
		value, inline := strings.CutPrefix(word, "--settings=")
		if word == "--settings" || inline {
			if remove != 0 {
				return nil, errors.New("multiple Claude --settings values cannot be composed")
			}
			insert, remove = i, 1
			if !inline {
				if i+1 >= boundary {
					return nil, errors.New("Claude --settings requires inline JSON")
				}
				i++
				value = args[i]
				remove++
			}
			input = value
		}
	}
	if len(input) > settingsLimit || !strings.HasPrefix(strings.TrimSpace(input), "{") {
		return nil, errors.New("Claude hooks require bounded inline settings JSON")
	}
	var settings map[string]json.RawMessage
	if err := json.Unmarshal([]byte(input), &settings); err != nil {
		return nil, fmt.Errorf("decode Claude inline settings: %w", err)
	}

	if value := settings["disableAllHooks"]; string(value) == "true" {
		return nil, errors.New("Claude inline settings disable hooks")
	}
	hooks := make(map[string][]json.RawMessage)
	if value, exists := settings["hooks"]; exists {
		if err := json.Unmarshal(value, &hooks); err != nil || hooks == nil {
			return nil, errors.New("Claude inline hooks must be an object of event arrays")
		}
	}
	launcher := "'" + strings.ReplaceAll(executable, "'", "'\\''") + "' __hook claude"
	for _, event := range []string{"SessionStart", "SessionEnd", "UserPromptSubmit", "Stop",
		"Notification", "PostToolUse", "PostToolUseFailure", "PreToolUse", "PermissionRequest"} {
		command := launcher
		matcher := ""
		if event == "Stop" {
			command += " --activity-only"
		}
		if event == "PreToolUse" {
			matcher = "AskUserQuestion|ExitPlanMode"
		}
		group := hookGroup{Matcher: matcher, Hooks: []hookCommand{{Type: "command", Command: command, Timeout: 3}}}
		encoded, err := json.Marshal(group)
		if err != nil {
			return nil, err
		}
		if slices.ContainsFunc(hooks[event], func(existing json.RawMessage) bool {
			var group hookGroup
			return json.Unmarshal(existing, &group) == nil && group.Matcher == matcher &&
				slices.Contains(group.Hooks, hookCommand{Type: "command", Command: command, Timeout: 3})
		}) {
			continue
		}
		hooks[event] = append(hooks[event], encoded)
	}
	data, err := json.Marshal(hooks)
	if err != nil {
		return nil, err
	}
	settings["hooks"] = data
	data, err = json.Marshal(settings)
	if err != nil {
		return nil, err
	}
	if len(data) > settingsLimit {
		return nil, errors.New("Claude launch settings exceed 1 MiB")
	}
	args = slices.Clone(args)
	return slices.Replace(args, insert, insert+remove, "--settings", string(data)), nil
}
