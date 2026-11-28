package claude

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"path/filepath"
	"slices"
	"strings"
	"unicode"

	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/invoke"
	"github.com/tmt-ninja/tmt/go/internal/ports"
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

// AddLaunchHooks attaches lifecycle hooks to a prepared foreground command.
func AddLaunchHooks(command ports.ProcessSpec, executable string) (ports.ProcessSpec, error) {
	args, err := withHooks(command.Args, executable)
	if err != nil {
		return ports.ProcessSpec{}, err
	}
	command.Args = args
	return command, nil
}

// StartsAtPrompt mirrors Claude's native empty-prompt launch check. Positional
// text, unknown options and explicit end-of-options do not prove readiness.
func StartsAtPrompt(command ports.ProcessSpec) bool {
	for i := 0; i < len(command.Args); i++ {
		flag, _, inline := strings.Cut(command.Args[i], "=")
		switch flag {
		case "--session-id", "--resume", "-r", "--model", "--effort", "--permission-mode", "--add-dir", "--agent":
			if !inline {
				i++
				if i == len(command.Args) {
					return false
				}
			}
		case "--continue", "-c", "--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "--verbose":
			if inline {
				return false
			}
		default:
			return false
		}
	}
	return true
}

// withHooks adds the native lifecycle observations to Claude's invocation-only
// settings layer. The caller supplies the current build’s executable with a wired __hook handler.
func withHooks(args []string, executable string) ([]string, error) {
	return composeLaunchHooks(args, executable, nil)
}

func composeLaunchHooks(args []string, executable string, digest *digestLaunchSettings) ([]string, error) {
	if !filepath.IsAbs(executable) || filepath.Base(executable) != flavor.Binary ||
		strings.IndexFunc(executable, unicode.IsControl) >= 0 || !invoke.IsExecutable(executable) {
		return nil, errors.New("Claude hooks require an absolute " + flavor.Binary + " callback executable")
	}
	boundary := slices.Index(args, "--")
	if boundary < 0 {
		boundary = len(args)
	}
	insert, remove := boundary, 0
	input := "{}"
	includeUser := true
	var sourcesSeen bool
	for i := 0; i < boundary; i++ {
		word := args[i]
		if word == "--bare" || word == "--safe-mode" {
			return nil, errors.New("the Claude launch disables hooks")
		}
		value, inline := strings.CutPrefix(word, "--setting-sources=")
		if word == "--setting-sources" || inline {
			if sourcesSeen {
				return nil, errClaudeSettings
			}
			sourcesSeen = true
			if !inline {
				i++
				if i >= boundary {
					return nil, errClaudeSettings
				}
				value = args[i]
			}
			includeUser = false
			for source := range strings.SplitSeq(value, ",") {
				switch source {
				case "user":
					includeUser = true
				case "", "project", "local":
				default:
					return nil, errClaudeSettings
				}
			}
			continue
		}
		value, inline = strings.CutPrefix(word, "--settings=")
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
	if digest != nil && !strings.HasPrefix(strings.TrimSpace(input), "{") {
		value, exists, err := readClaudeSettings(claudeAbsolutePath(digest.dir, input))
		if err != nil || !exists {
			return nil, errClaudeSettings
		}
		input = value
	}
	settings, hooks, err := decodeClaudeSettings(input)
	if err != nil {
		return nil, err
	}
	var global claudeHookSettings
	if digest != nil {
		global, err = digest.global(includeUser)
		if err != nil {
			return nil, err
		}
	}
	launcher := quoteHookWord(executable)
	for _, event := range []string{"SessionStart", "SessionEnd", "UserPromptSubmit", "Stop",
		"Notification", "PostToolUse", "PostToolUseFailure", "PreToolUse", "PermissionRequest"} {
		command := launcher + " __hook claude"
		matcher := ""
		if event == "Stop" {
			command += " --activity-only"
		}
		if event == "PreToolUse" {
			matcher = "AskUserQuestion|ExitPlanMode"
		}
		localGroups, err := hooks.groups(event)
		if err != nil {
			return nil, err
		}
		if digest != nil {
			localOwned, err := claudeSetupOwnsEvent(localGroups, matcher)
			if err != nil {
				return nil, err
			}
			globalGroups, err := global.groups(event)
			if err != nil {
				return nil, err
			}
			globalOwned, err := claudeSetupOwnsEvent(globalGroups, matcher)
			if err != nil {
				return nil, err
			}
			if localOwned || globalOwned {
				continue
			}
		}
		group := hookGroup{Matcher: matcher, Hooks: []hookCommand{{Type: "command", Command: command, Timeout: 3}}}
		encoded, err := json.Marshal(group)
		if err != nil {
			return nil, err
		}
		if slices.ContainsFunc(localGroups, func(existing jsontext.Value) bool {
			var group hookGroup
			return json.Unmarshal(existing, &group) == nil && group.Matcher == matcher &&
				slices.Contains(group.Hooks, hookCommand{Type: "command", Command: command, Timeout: 3})
		}) {
			continue
		}
		hooks[event], err = json.Marshal(append(localGroups, encoded))
		if err != nil {
			return nil, err
		}
	}
	if digest != nil {
		scope, err := json.Marshal(digest.launch)
		if err != nil {
			return nil, err
		}
		entry, err := json.Marshal(hookGroup{Hooks: []hookCommand{{Type: "command", Timeout: 3,
			Command: launcher + " __digest-hook claude --launch " + quoteHookWord(string(scope)),
		}}})
		if err != nil {
			return nil, err
		}
		groups, err := hooks.groups("Stop")
		if err != nil {
			return nil, err
		}
		hooks["Stop"], err = json.Marshal(append(groups, entry))
		if err != nil {
			return nil, err
		}
	}
	data, err := json.Marshal(hooks, json.Deterministic(true))
	if err != nil {
		return nil, err
	}
	settings["hooks"] = data
	data, err = json.Marshal(settings, json.Deterministic(true))
	if err != nil {
		return nil, err
	}
	if len(data) > settingsLimit {
		return nil, errors.New("Claude launch settings exceed 1 MiB")
	}
	args = slices.Clone(args)
	return slices.Replace(args, insert, insert+remove, "--settings", string(data)), nil
}
