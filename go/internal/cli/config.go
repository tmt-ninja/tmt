package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
	"os/user"
	"slices"
	"strconv"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/config"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

const configThemeBases = "tmt, tmt-light, terminal, mono"

type configChange struct{ message string }

func (r configChange) Human(w io.Writer) error    { return success(w, r.message) }
func (r configChange) JSON() any                  { return map[string]bool{"ok": true} }
func (r configChange) HumanStream() output.Stream { return output.Stdout }
func (r configChange) ExitStatus() int            { return 0 }

type configShow struct {
	settings resolvedConfig
	paths    map[string]string
	theme    map[string]string
	problem  *clistyle.ThemeError
}

func (r configShow) HumanStream() output.Stream { return output.Stdout }
func (r configShow) ExitStatus() int            { return 0 }

func (r configShow) JSON() any {
	values, sources := map[string]any{}, map[string]any{}
	for _, field := range settingFields {
		setting := r.settings[field.key]
		putSetting(values, field.path, setting.value)
		if field.editable {
			putSetting(sources, field.key, setting.source)
		}
	}
	values["preambleEvery"] = r.settings["preambleEvery"].value
	values["pasteEnterDelayMs"] = r.settings["pasteEnterDelayMs"].value
	values["theme"] = r.theme
	sources["theme"] = r.themeSource()
	var problem any
	if r.problem != nil {
		problem = map[string]string{"key": r.problem.Key, "message": r.problem.Message}
	}
	return map[string]any{"resolved": values, "sources": sources, "paths": r.paths, "themeError": problem}
}

func putSetting(doc map[string]any, path string, value any) {
	container, key := splitSettingPath(path)
	if container == "" {
		doc[key] = value
		return
	}
	target, ok := doc[container].(map[string]any)
	if !ok {
		target = make(map[string]any)
		doc[container] = target
	}
	target[key] = value
}

func (r configShow) themeSource() string {
	if len(r.theme) == 0 {
		return "default"
	}
	return "global"
}

func (r configShow) Human(w io.Writer) error {
	term := outputTerminal(w)
	table := clistyle.NewTable(clistyle.ColumnName, clistyle.ColumnFixed, clistyle.ColumnFixed, clistyle.ColumnFixed, clistyle.ColumnDetail)
	row := func(name, value, source, changes, expected string) {
		table.AddRow(clistyle.Cell{Text: name}, clistyle.Cell{Text: value},
			clistyle.Cell{Text: source, Token: clistyle.TokenDim}, clistyle.Cell{Text: changes},
			clistyle.Cell{Text: expected, Token: clistyle.TokenDim})
	}
	for _, field := range settingFields {
		name, changes := field.key, "global file only"
		switch {
		case field.local:
			changes = "local/global CLI"
		case field.editable:
			changes = "global CLI"
		default:
			name = field.path
		}
		setting := r.settings[field.key]
		text := "unset"
		if setting.value != nil {
			text = fmt.Sprint(setting.value)
		}
		row(name, text, setting.source, changes, field.expected)
	}
	base, ok := r.theme["base"]
	if !ok {
		base = "terminal colors"
	}
	row("theme.base", base, r.themeSource(), "global CLI", configThemeBases)
	for _, key := range slices.Sorted(maps.Keys(r.theme)) {
		if key != "base" {
			row("theme."+key, r.theme[key], "global", "global file only", "#rrggbb or a color name")
		}
	}
	if err := clistyle.WriteList(w, term, []clistyle.ListSection{{
		Title: "settings", Rows: table, Hint: "CLI numeric writes use unsigned decimal integers; config rm removes local overrides only",
	}}); err != nil {
		return err
	}
	if _, err := fmt.Fprintln(w); err != nil {
		return err
	}
	userHome, _ := os.UserHomeDir()
	return clistyle.WriteDetail(w, term, "PATHS", []clistyle.DetailField{
		{Label: "global", Value: clistyle.HomePath(r.paths["global"], userHome)},
		{Label: "local", Value: clistyle.HomePath(r.paths["local"], userHome)},
	})
}

func (r configShow) HumanDiagnostic(w io.Writer) error {
	if r.problem == nil {
		return nil
	}
	file, _ := w.(*os.File)
	term := clistyle.DiagnosticTerminal(file, nil)
	if r.problem.Key == "theme.base" && r.theme["base"] == "auto" {
		return clistyle.WriteError(w, term, "theme.base auto only works for the board, not in config.json", flavor.Binary+" ops sq theme set auto")
	}
	message := strings.TrimSuffix(r.problem.Message, ".")
	return clistyle.WriteError(w, term, r.problem.Key+" "+message+"; commands use the terminal's colors until it is fixed", "")
}

func runConfig(ctx context.Context, root home.Root, inv invocation) output.Report {
	files, err := configFiles(root)
	if err != nil {
		return configFailure(err)
	}
	if len(inv.path) == 1 || inv.path[1] == "show" {
		values, global, err := readSettings(files)
		if err != nil {
			return configFailure(err)
		}
		if values["user.name"].source == "default" {
			var login any
			if account, err := user.LookupId(strconv.Itoa(os.Getuid())); err == nil {
				login = account.Username
			}
			values["user.name"] = settingValue{value: login, source: "default"}
		}
		theme, problem := readConfigTheme(global)
		return configShow{settings: values, theme: theme, problem: problem,
			paths: map[string]string{"global": files.Path(config.Global), "local": files.Path(config.Local)}}
	}
	switch inv.path[1] {
	case "set":
		return setConfig(ctx, files, inv.operands[0], inv.operands[1], inv.has("global"))
	case "rm":
		return clearConfig(ctx, files, inv.operands)
	default:
		panic("unhandled config subcommand")
	}
}

func configFailure(err error) *output.Failure {
	failure := &output.Failure{Code: "ERROR", Message: err.Error(), Status: 1}
	if errors.Is(err, config.ErrChanged) {
		failure.Suggestion = "Read the current settings with " + flavor.Binary + " config show before retrying"
	}
	return failure
}

func readConfigTheme(global config.Document) (map[string]string, *clistyle.ThemeError) {
	theme := make(map[string]string)
	raw, exists := global["theme"]
	if !exists {
		return theme, nil
	}
	var values config.Document
	if err := json.Unmarshal(raw, &values); err != nil || values == nil {
		return theme, &clistyle.ThemeError{Key: "theme", Message: "must be an object of settings"}
	}
	for _, key := range slices.Sorted(maps.Keys(values)) {
		var value *string
		if err := json.Unmarshal(values[key], &value); err != nil || value == nil {
			return map[string]string{}, &clistyle.ThemeError{Key: "theme." + key, Message: "must be a string"}
		}
		theme[key] = *value
	}
	if theme["base"] == "auto" {
		return theme, &clistyle.ThemeError{Key: "theme.base", Message: "auto only works for the board, not in config.json"}
	}
	_, err := clistyle.ParseTheme("theme", theme)
	var problem *clistyle.ThemeError
	if err != nil && !errors.As(err, &problem) {
		return theme, &clistyle.ThemeError{Key: "theme", Message: err.Error()}
	}
	return theme, problem
}

func setConfig(ctx context.Context, files config.Files, key, text string, global bool) output.Report {
	scope, destination := config.Global, "global config"
	if !global {
		scope, destination = config.Local, "local config (repo override)"
	}
	if key == "theme.base" {
		if !global {
			return configFailure(fmt.Errorf("%s can only be set in global config with --global.", key))
		}
		if _, err := clistyle.ParseTheme("theme", map[string]string{"base": text}); err != nil || text == "auto" {
			failure := configFailure(fmt.Errorf("Invalid value for theme.base: %s.", text))
			failure.Suggestion = "Valid bases: " + configThemeBases
			return failure
		}
		return applyConfigSetting(ctx, files, scope, key, text, fmt.Sprintf("Set %s=%s in %s", key, text, destination))
	}

	field, err := editableSetting(key)
	if err != nil {
		return configFailure(err)
	}
	if !global && !field.local {
		return configFailure(fmt.Errorf("%s can only be set in global config with --global.", key))
	}
	value, err := field.fromArgument(text)
	if err != nil {
		return configFailure(err)
	}
	path := field.path
	if !global {
		path = "$config." + key
	}
	return applyConfigSetting(ctx, files, scope, path, value, fmt.Sprintf("Set %s=%s in %s", key, text, destination))
}

func applyConfigSetting(ctx context.Context, files config.Files, scope config.Scope, path string, value any, message string) output.Report {
	container, key := splitSettingPath(path)
	plan, err := files.Prepare(scope, func(doc config.Document) error {
		target, err := settingsContainer(doc, container)
		if err != nil {
			return err
		}
		if container == "defaults" && doc[container] == nil {
			for _, field := range settingFields {
				if name, item := splitSettingPath(field.path); name == container {
					target[item], err = json.Marshal(field.fallback)
					if err != nil {
						return err
					}
				}
			}
		}
		target[key], err = json.Marshal(value)
		if err == nil && container != "" {
			doc[container], err = json.Marshal(target)
		}
		return err
	})
	if err == nil {
		// The explicit config set invocation approves this exact edit.
		err = plan.Apply(ctx, true)
	}
	if err != nil {
		return configFailure(err)
	}
	return configChange{message}
}

var errNoLocalOverride = errors.New("workspace has no setting overrides")

func clearConfig(ctx context.Context, files config.Files, args []string) output.Report {
	message := "Cleared all local config overrides"
	if len(args) > 0 {
		key := args[0]
		if key != "mode" {
			field, err := editableSetting(key)
			if err != nil {
				return configFailure(err)
			}
			if !field.local {
				return configFailure(fmt.Errorf("%s is global-only and has no local override to clear.", key))
			}
		}
		message = "Cleared local override for " + key
	}
	plan, err := files.Prepare(config.Local, func(doc config.Document) error {
		const container = "$config"
		if len(args) == 0 {
			delete(doc, container)
			return nil
		}
		if _, exists := doc[container]; !exists {
			return errNoLocalOverride
		}
		target, err := settingsContainer(doc, container)
		if err != nil {
			return err
		}
		delete(target, args[0])
		if len(target) == 0 {
			delete(doc, container)
		} else {
			doc[container], err = json.Marshal(target)
		}
		return err
	})
	if err == nil {
		err = plan.Apply(ctx, true)
	}
	if err != nil && !errors.Is(err, errNoLocalOverride) {
		return configFailure(err)
	}
	return configChange{message}
}
