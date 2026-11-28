package cli

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/config"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

// settingField describes the native scalar and where it lives in config.json.
// Only the three workspace overrides also live under `$config`.
type settingField struct {
	key      string
	path     string
	fallback any
	expected string
	check    func(any) (any, bool)
	local    bool
	editable bool
}

func boolSetting(value any) (any, bool) {
	_, ok := value.(bool)
	return value, ok
}

func oneOfSetting(values ...string) func(any) (any, bool) {
	return func(value any) (any, bool) {
		for _, choice := range values {
			if value == choice {
				return value, true
			}
		}
		return nil, false
	}
}

func integerSetting(minimum, maximum uint64) func(any) (any, bool) {
	return func(value any) (any, bool) {
		num, ok := value.(float64)
		if !ok || math.Trunc(num) != num || num < float64(minimum) || num > float64(maximum) {
			return nil, false
		}
		return uint64(num), true
	}
}

func numberSetting(valid func(float64) bool) func(any) (any, bool) {
	return func(value any) (any, bool) {
		num, ok := value.(float64)
		return num, ok && valid(num)
	}
}

func usernameSetting(value any) (any, bool) {
	text, ok := value.(string)
	if !ok {
		return nil, false
	}
	name, err := core.ValidateName(text)
	return string(name.DisplayName()), err == nil
}

var settingFields = []settingField{
	{"experimental.channel", "experimental.channel", false, "true or false", boolSetting, false, true},
	{"workspace.snapshotEnabled", "workspace.snapshotEnabled", true, "true or false", boolSetting, false, true},
	{"workspace.snapshotIntervalMs", "workspace.snapshotIntervalMs", uint64(60000), "an integer from 0 through 2147483647 milliseconds", integerSetting(0, math.MaxInt32), false, true},
	{"notes.compactionReminder", "notes.compactionReminder", true, "true or false", boolSetting, false, true},
	{"notifications.replyBatchWindowMs", "notifications.replyBatchWindowMs", uint64(5000), "an integer from 0 through 60000 milliseconds", integerSetting(0, 60000), false, true},
	{"notifications.typingQuietMs", "notifications.typingQuietMs", uint64(2000), "an integer from 0 through 30000 milliseconds", integerSetting(0, 30000), false, true},
	{"preambleMode", "preambleMode", "always", "'always' or 'disabled'", oneOfSetting("always", "disabled"), true, true},
	{"preambleEvery", "defaults.preambleEvery", uint64(3), "a safe non-negative integer", integerSetting(0, core.MaxJSSafeInteger), true, true},
	{"pasteEnterDelayMs", "defaults.pasteEnterDelayMs", float64(500), "a finite number from 0 through 2147483647", numberSetting(core.ValidTimerDelayMs), true, true},
	{"timeout", "defaults.timeout", float64(180), "a finite positive number no greater than 86400", numberSetting(core.ValidObserverTimeoutSeconds), false, false},
	{"pollInterval", "defaults.pollInterval", float64(1), "a finite positive number", numberSetting(func(v float64) bool { return v > 0 && !math.IsInf(v, 0) }), false, false},
	{"captureLines", "defaults.captureLines", uint64(100), "an integer from 0 through 2147483647", integerSetting(0, core.MaxCaptureLines), false, false},
	{"exchange.retentionDays", "exchange.retentionDays", uint64(core.DefaultRetentionDays), "an integer from 1 through 3650", integerSetting(1, core.MaxRetentionDays), false, true},
	{"ui.paneBadge", "ui.paneBadge", "on", "'on' or 'off'", oneOfSetting("on", "off"), false, true},
	{"user.name", "user.name", "", "a name of 1 to 64 characters that is not a pane target", usernameSetting, false, true},
}

const editableSettings = "preambleMode, ui.paneBadge, user.name, preambleEvery, pasteEnterDelayMs, exchange.retentionDays, notifications.replyBatchWindowMs, notifications.typingQuietMs, experimental.channel, notes.compactionReminder, workspace.snapshotEnabled, workspace.snapshotIntervalMs"

func editableSetting(key string) (settingField, error) {
	for _, field := range settingFields {
		if field.key == key && field.editable {
			return field, nil
		}
	}
	return settingField{}, fmt.Errorf("Invalid key: %s. Valid keys: %s", key, editableSettings)
}

func (s settingField) fromArgument(text string) (any, error) {
	bad := func(expected string) error {
		return fmt.Errorf("Invalid value for %s: %s. %s", s.key, text, expected)
	}
	var value any = text
	var expectation string
	switch s.fallback.(type) {
	case bool:
		switch text {
		case "true":
			value = true
		case "false":
			value = false
		default:
			return nil, bad("Valid values: true, false")
		}
	case string:
		switch s.key {
		case "preambleMode":
			expectation = "Valid values: always, disabled"
		case "ui.paneBadge":
			expectation = "Valid values: on, off"
		default:
			expectation = "Must be 1 to 64 characters, without control characters, and not a pane target."
		}
	default:
		if !decimalText(text) {
			return nil, bad("Must be a non-negative integer.")
		}
		expectation = "Must be a supported non-negative integer."
		n, err := strconv.ParseUint(text, 10, 64)
		if err != nil || n > core.MaxJSSafeInteger {
			return nil, bad(expectation)
		}
		value = float64(n)
	}
	checked, ok := s.check(value)
	if !ok {
		return nil, bad(expectation)
	}
	return checked, nil
}

type settingValue struct {
	value  any
	source string
}

type resolvedConfig map[string]settingValue

func configFiles(root home.Root) (config.Files, error) {
	workspace, err := os.Getwd()
	if err != nil {
		return config.Files{}, err
	}
	return config.Resolve(root, workspace)
}

func readSettings(files config.Files) (resolvedConfig, config.Document, error) {
	global, err := files.Read(config.Global)
	if err != nil {
		return nil, nil, err
	}
	local, err := files.Read(config.Local)
	if err != nil {
		return nil, nil, err
	}
	values, err := projectSettings(global, local, files)
	return values, global, err
}

func loadSettings(root home.Root) (resolvedConfig, error) {
	files, err := configFiles(root)
	if err != nil {
		return nil, err
	}
	values, _, err := readSettings(files)
	return values, err
}

func projectSettings(global, local config.Document, files config.Files) (resolvedConfig, error) {
	settings := make(resolvedConfig, len(settingFields))
	for _, field := range settingFields {
		setting := settingValue{value: field.fallback, source: "default"}
		scopes := []config.Scope{config.Global}
		if field.local {
			scopes = append(scopes, config.Local)
		}
		for _, scope := range scopes {
			doc, path, source := global, field.path, "global"
			if scope == config.Local {
				doc, path, source = local, "$config."+field.key, "local"
			}
			container, property := splitSettingPath(path)
			target, err := settingsContainer(doc, container)
			if err != nil {
				return nil, err
			}
			raw, ok := target[property]
			if !ok {
				continue
			}
			var value any
			if err := json.Unmarshal(raw, &value); err == nil {
				if checked, ok := field.check(value); ok {
					setting = settingValue{value: checked, source: source}
					continue
				}
			}
			return nil, fmt.Errorf("Invalid configuration in %s (%s): must be %s.", files.Path(scope), path, field.expected)
		}
		settings[field.key] = setting
	}
	return settings, nil
}

func splitSettingPath(path string) (container, key string) {
	before, after, found := strings.Cut(path, ".")
	if !found {
		return "", before
	}
	return before, after
}

func settingsContainer(doc config.Document, name string) (config.Document, error) {
	if name == "" {
		return doc, nil
	}
	values := make(config.Document)
	if raw, ok := doc[name]; ok {
		if err := json.Unmarshal(raw, &values); err != nil || values == nil {
			return nil, fmt.Errorf("Invalid %s configuration: must be a non-null object.", name)
		}
	}
	return values, nil
}
