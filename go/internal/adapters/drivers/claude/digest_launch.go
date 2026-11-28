package claude

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

var errClaudeSettings = errors.New("Claude launch settings cannot be composed safely")

type digestLaunchSettings struct {
	launch core.HookCaptureLaunch
	dir    string
	env    []string
}

// AddDigestLaunchHooks composes the currently selected settings for one
// verified launch. Native setup hooks remain the only persistent observers.
func AddDigestLaunchHooks(command ports.ProcessSpec, executable string, launch core.HookCaptureLaunch) (ports.ProcessSpec, error) {
	if !core.ValidUUID(string(launch.IdentityID)) || !core.ValidUUID(string(launch.BindingID)) ||
		launch.OwnerPID == 0 || launch.OwnerStart == "" {
		return ports.ProcessSpec{}, errors.New("invalid Claude Digest launch coordinates")
	}
	dir := command.Dir
	if dir == "" {
		var err error
		dir, err = os.Getwd()
		if err != nil {
			return ports.ProcessSpec{}, err
		}
	}
	args, err := composeLaunchHooks(command.Args, executable, &digestLaunchSettings{launch: launch, dir: dir, env: command.Env})
	if err != nil {
		return ports.ProcessSpec{}, err
	}
	command.Args = args
	return command, nil
}

// HasSetupStopObserver checks whether the active provider config has an exact
// setup-owned full Stop observer. Missing, edited and unreadable settings
// do not grant reply or transcript capture.
func HasSetupStopObserver() bool {
	dir, err := os.Getwd()
	if err != nil {
		return false
	}
	settings := digestLaunchSettings{dir: dir, env: os.Environ()}
	hooks, err := settings.global(true)
	if err != nil {
		return false
	}
	stops, err := hooks.groups("Stop")
	if err != nil {
		return false
	}
	owned, err := claudeSetupOwnsEvent(stops, "")
	return owned && err == nil
}

func (plan *digestLaunchSettings) global(includeUser bool) (claudeHookSettings, error) {
	if !includeUser {
		return nil, nil
	}
	var config string
	for i := len(plan.env) - 1; i >= 0; i-- {
		if value, ok := strings.CutPrefix(plan.env[i], "CLAUDE_CONFIG_DIR="); ok {
			config = claudeAbsolutePath(plan.dir, value)
			break
		}
	}
	if config == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, errClaudeSettings
		}
		config = filepath.Join(home, ".claude")
	}
	value, exists, err := readClaudeSettings(filepath.Join(config, "settings.json"))
	if err != nil || !exists {
		return nil, err
	}
	_, hooks, err := decodeClaudeSettings(value)
	return hooks, err
}

func claudeAbsolutePath(dir, value string) string {
	if filepath.IsAbs(value) {
		return filepath.Clean(value)
	}
	return filepath.Join(dir, value)
}

func readClaudeSettings(path string) (string, bool, error) {
	name := filepath.Base(path)
	switch strings.ToLower(name) {
	case "auth.json", ".credentials.json", "credentials.json", "owner.key":
		return "", false, errClaudeSettings
	}
	root, err := os.OpenRoot(filepath.Dir(path))
	if errors.Is(err, fs.ErrNotExist) {
		return "", false, nil
	}
	if err != nil {
		return "", false, errClaudeSettings
	}
	defer root.Close()
	dir, err := root.Open(".")
	if err != nil {
		return "", false, errClaudeSettings
	}
	defer dir.Close()
	file, err := sys.OpenEntryNoFollow(dir, name, os.O_RDONLY, 0)
	if errors.Is(err, fs.ErrNotExist) {
		return "", false, nil
	}
	if err != nil {
		return "", false, errClaudeSettings
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > settingsLimit {
		return "", false, errClaudeSettings
	}
	data, err := io.ReadAll(io.LimitReader(file, settingsLimit+1))
	if err != nil || len(data) > settingsLimit || !utf8.Valid(data) {
		return "", false, errClaudeSettings
	}
	return string(data), true, nil
}

type claudeHookSettings map[string]jsontext.Value

func (settings claudeHookSettings) groups(event string) ([]jsontext.Value, error) {
	raw, ok := settings[event]
	if !ok {
		return nil, nil
	}
	var groups []jsontext.Value
	if json.Unmarshal(raw, &groups) != nil || groups == nil {
		return nil, errClaudeSettings
	}
	return groups, nil
}

func decodeClaudeSettings(input string) (map[string]jsontext.Value, claudeHookSettings, error) {
	var settings map[string]jsontext.Value
	if len(input) > settingsLimit || json.Unmarshal([]byte(input), &settings) != nil || settings == nil {
		return nil, nil, errClaudeSettings
	}
	for _, key := range []string{"disableAllHooks", "allowManagedHooksOnly"} {
		if raw, ok := settings[key]; ok && raw.Kind() != 'f' {
			return nil, nil, errClaudeSettings
		}
	}
	hooks := make(claudeHookSettings)
	if raw, ok := settings["hooks"]; ok && (json.Unmarshal(raw, &hooks) != nil || hooks == nil) {
		return nil, nil, errClaudeSettings
	}
	return settings, hooks, nil
}

func claudeSetupOwnsEvent(groups []jsontext.Value, matcher string) (bool, error) {
	found := false
	for _, raw := range groups {
		var group map[string]jsontext.Value
		var hooks []jsontext.Value
		if json.Unmarshal(raw, &group) != nil || json.Unmarshal(group["hooks"], &hooks) != nil || hooks == nil {
			return false, errClaudeSettings
		}
		for _, item := range hooks {
			var fields map[string]jsontext.Value
			if json.Unmarshal(item, &fields) != nil || fields == nil {
				return false, errClaudeSettings
			}
			value, present := fields["command"]
			if !present {
				continue
			}
			var command string
			if value.Kind() != '"' || json.Unmarshal(value, &command) != nil {
				return false, errClaudeSettings
			}
			if !strings.Contains(command, "__hook claude") {
				continue
			}
			quoted, exact := strings.CutSuffix(command, " __hook claude")
			if !exact || len(quoted) < 2 || quoted[0] != '\'' || quoted[len(quoted)-1] != '\'' {
				return false, errClaudeSettings
			}
			launcher := strings.ReplaceAll(quoted[1:len(quoted)-1], "'\\''", "'")
			if !flavor.NativeCompatible && filepath.Base(launcher) != flavor.Binary {
				// The isolated build needs its own observer and data root.
				continue
			}
			var strict hookGroup
			_, hasMatcher := group["matcher"]
			if found || !filepath.IsAbs(launcher) || quoteHookWord(launcher) != quoted ||
				json.Unmarshal(raw, &strict, json.RejectUnknownMembers(true)) != nil ||
				hasMatcher != (matcher != "") || strict.Matcher != matcher ||
				!slices.Equal(strict.Hooks, []hookCommand{{Type: "command", Command: command, Timeout: 3}}) {
				return false, errClaudeSettings
			}
			found = true
		}
	}
	return found, nil
}

func quoteHookWord(word string) string {
	return "'" + strings.ReplaceAll(word, "'", "'\\''") + "'"
}
