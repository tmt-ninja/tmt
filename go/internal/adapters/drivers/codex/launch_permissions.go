package codex

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/pelletier/go-toml/v2"

	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type sandboxMode uint8

const (
	sandboxUnknown sandboxMode = iota
	sandboxReadOnly
	sandboxWorkspaceWrite
	sandboxFullAccess
)

func codexSandboxMode(value any) sandboxMode {
	switch value {
	case "read-only":
		return sandboxReadOnly
	case "workspace-write":
		return sandboxWorkspaceWrite
	case "danger-full-access":
		return sandboxFullAccess
	default:
		return sandboxUnknown
	}
}

// PrepareManagedLaunch gives an embedded Codex command the managed state root
// when its explicit options or local settings leave that grant applicable.
// It does not change the provider's sandbox mode or approval policy.
func PrepareManagedLaunch(command ports.ProcessSpec, stateRoot string, exactResume bool) ports.ProcessSpec {
	if !filepath.IsAbs(stateRoot) {
		return command
	}
	args := command.Args
	embedded := exactResume && len(args) != 0 && args[len(args)-1] == "--no-daemon"
	writable := false
	for i := 0; i < len(args); i++ {
		word := args[i]
		if word == "--" || !utf8.ValidString(word) {
			break
		}
		flag, value, inline := splitLaunchOption(word)
		switch {
		case flag == "--remote" || codexSubcommand(word):
			return command
		case flag == "--no-daemon":
			embedded = true
		case launchOptionTakesValue(flag):
			if !inline && i+1 < len(args) {
				i++
				value = args[i]
			}
			writable = writable || flag == "--add-dir" && value == stateRoot
		case !strings.HasPrefix(word, "-") && word != "resume" && word != "fork":
			i = len(args)
		}
	}
	var options []string
	if !embedded {
		options = append(options, "--no-daemon")
	}
	if !writable && (filepath.Base(command.Path) != "codex" || keepStateGrant(args, func(profile *string) sandboxMode {
		return localSandboxMode(codexLaunchHome(command), profile)
	})) {
		options = append(options, "--add-dir", stateRoot)
	}
	if len(options) != 0 {
		index := 0
		if len(args) != 0 && args[0] == "resume" {
			index = 1
		}
		command.Args = slices.Insert(slices.Clone(args), index, options...)
	}
	return command
}

func keepStateGrant(args []string, inspect func(*string) sandboxMode) bool {
	var explicit *sandboxMode
	var profile *string
	ambiguous := false
	for i := 0; i < len(args); i++ {
		word := args[i]
		if !utf8.ValidString(word) {
			return true
		}
		if word == "--" || !strings.HasPrefix(word, "-") && word != "resume" && word != "fork" {
			break
		}
		if word == "resume" || word == "fork" {
			continue
		}
		flag, value, hasValue := splitLaunchOption(word)
		takesValue := launchOptionTakesValue(flag)
		if takesValue && !hasValue && i+1 < len(args) {
			i++
			value, hasValue = args[i], utf8.ValidString(args[i])
		}
		switch flag {
		case "-s", "--sandbox":
			mode := codexSandboxMode(value)
			explicit = &mode
		case "-p", "--profile":
			if !hasValue {
				return true
			}
			profile = &value
		case "-c", "--config":
			key, _, assigned := strings.Cut(value, "=")
			if !hasValue || !assigned {
				return true
			}
			key = strings.Trim(strings.TrimSpace(key), "'\"")
			ambiguous = ambiguous || strings.HasPrefix(key, "sandbox") || strings.HasPrefix(key, "permissions") || key == "profile"
		case "--dangerously-bypass-approvals-and-sandbox":
			mode := sandboxFullAccess
			explicit = &mode
		case "--approve-for-me":
			mode := sandboxWorkspaceWrite
			explicit = &mode
		case "--no-daemon", "--search", "--no-alt-screen", "--oss", "--worktree", "--strict-config":
		default:
			if takesValue && !hasValue {
				return true
			}
			ambiguous = ambiguous || !takesValue
		}
	}
	if ambiguous {
		return true
	}
	mode := sandboxUnknown
	if explicit != nil {
		mode = *explicit
	} else {
		mode = inspect(profile)
	}
	return mode == sandboxWorkspaceWrite || mode == sandboxUnknown
}

func codexLaunchHome(command ports.ProcessSpec) string {
	var home, codexHome string
	for _, line := range command.Env {
		name, value, _ := strings.Cut(line, "=")
		switch name {
		case "HOME":
			home = value
		case "CODEX_HOME":
			codexHome = value
		}
	}
	if codexHome == "" {
		if !filepath.IsAbs(home) {
			return ""
		}
		return filepath.Join(home, ".codex")
	}
	if !filepath.IsAbs(codexHome) && !filepath.IsAbs(command.Dir) {
		return ""
	}
	return resolve(command.Dir, codexHome)
}

func localSandboxMode(home string, profile *string) sandboxMode {
	if home == "" {
		return sandboxUnknown
	}
	data, err := readSettings(home, "config.toml")
	var config map[string]any
	if err != nil || toml.Unmarshal(data, &config) != nil || config["permissions"] != nil || config["requirements"] != nil {
		return sandboxUnknown
	}
	if profile == nil && config["profile"] != nil {
		name, ok := config["profile"].(string)
		if !ok {
			return sandboxUnknown
		}
		profile = &name
	}
	base := codexSandboxMode(config["sandbox_mode"])
	if profile == nil {
		return base
	}
	name := *profile
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\\x00") {
		return sandboxUnknown
	}
	file := name + ".config.toml"
	var selected map[string]any
	if _, err := os.Lstat(filepath.Join(home, file)); err == nil {
		data, err := readSettings(home, file)
		if err != nil || data == nil || toml.Unmarshal(data, &selected) != nil || selected["permissions"] != nil {
			return sandboxUnknown
		}
	} else {
		if !errors.Is(err, fs.ErrNotExist) {
			return sandboxUnknown
		}
		profiles, _ := config["profiles"].(map[string]any)
		selected, _ = profiles[name].(map[string]any)
		if selected == nil {
			return sandboxUnknown
		}
	}
	if mode, ok := selected["sandbox_mode"]; ok {
		return codexSandboxMode(mode)
	}
	return base
}

func splitLaunchOption(word string) (string, string, bool) {
	if len(word) > 2 {
		switch word[:2] {
		case "-s", "-p", "-c", "-m", "-a", "-C", "-i":
			return word[:2], word[2:], true
		}
	}
	return strings.Cut(word, "=")
}

func launchOptionTakesValue(flag string) bool {
	switch flag {
	case "-c", "--config", "--enable", "--disable", "-m", "--model", "-s", "--sandbox",
		"-a", "--ask-for-approval", "-C", "--cd", "-p", "--profile", "--local-provider",
		"--remote-auth-token-env", "-i", "--image", "--add-dir":
		return true
	default:
		return false
	}
}

func codexSubcommand(word string) bool {
	switch word {
	case "app-server", "agents", "exec", "e", "review", "login", "logout", "mcp",
		"plugin", "remote-control", "app", "completion", "update", "doctor", "sandbox",
		"debug", "apply", "a", "queue", "archive", "delete", "migrate-rollouts",
		"unarchive", "cloud", "exec-server", "features", "help":
		return true
	default:
		return false
	}
}
