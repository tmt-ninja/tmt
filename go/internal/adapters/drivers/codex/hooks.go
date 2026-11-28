//go:build darwin || linux

package codex

import (
	"bytes"
	"encoding/json"
	"io"
	"maps"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
)

type hookDocument map[string]json.RawMessage

func decodeHookDocument(data []byte) (hookDocument, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	if open, err := decoder.Token(); err != nil || open != json.Delim('{') {
		return nil, ErrHookSources
	}
	doc := make(hookDocument)
	for decoder.More() {
		key, err := decoder.Token()
		name, ok := key.(string)
		var value json.RawMessage
		if _, duplicate := doc[name]; err != nil || !ok || duplicate || decoder.Decode(&value) != nil {
			return nil, ErrHookSources
		}
		doc[name] = value
	}
	if close, err := decoder.Token(); err != nil || close != json.Delim('}') {
		return nil, ErrHookSources
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, ErrHookSources
	}
	return doc, nil
}

func ownedHookCount(doc hookDocument, event string) (int, error) {
	raw, present := doc["hooks"]
	if !present {
		return 0, nil
	}
	events, err := decodeHookDocument(raw)
	if err != nil {
		return 0, err
	}
	raw, present = events[event]
	if !present {
		return 0, nil
	}
	var groups []json.RawMessage
	if json.Unmarshal(raw, &groups) != nil || groups == nil {
		return 0, ErrHookSources
	}
	count := 0
	for _, group := range groups {
		entry, err := decodeHookDocument(group)
		if err != nil {
			return 0, err
		}
		var handlers []json.RawMessage
		if json.Unmarshal(entry["hooks"], &handlers) != nil || handlers == nil {
			return 0, ErrHookSources
		}
		for _, handler := range handlers {
			fields, err := decodeHookDocument(handler)
			if err != nil {
				return 0, err
			}
			if _, present := fields["command"]; !present {
				continue
			}
			var command string
			if bytes.Equal(fields["command"], []byte("null")) || json.Unmarshal(fields["command"], &command) != nil {
				return 0, ErrHookSources
			}
			if !strings.Contains(command, "__hook codex") {
				continue
			}
			quoted, suffix := strings.CutSuffix(command, " __hook codex")
			inner, prefix := strings.CutPrefix(quoted, "'")
			inner, trailing := strings.CutSuffix(inner, "'")
			launcher := strings.ReplaceAll(inner, "'\\''", "'")
			var kind string
			var timeout int
			if !suffix || !prefix || !trailing || !filepath.IsAbs(launcher) || quoteLauncher(launcher) != quoted ||
				len(entry) != 1 || len(handlers) != 1 || len(fields) != 3 ||
				json.Unmarshal(fields["type"], &kind) != nil || kind != "command" ||
				json.Unmarshal(fields["timeout"], &timeout) != nil || timeout != 3 {
				return 0, ErrHookSources
			}
			count++
		}
	}
	if count > 1 {
		return 0, ErrHookSources
	}
	return count, nil
}

func quoteLauncher(path string) string {
	return "'" + strings.ReplaceAll(path, "'", "'\\''") + "'"
}

func observerHook(command string) map[string]any {
	return map[string]any{"hooks": []any{map[string]any{"type": "command", "command": command, "timeout": int64(3)}}}
}

func composeHooks(hooks map[string]any, sources []hookDocument, launcher string) (string, error) {
	serialized, err := json.Marshal(hooks)
	if err != nil {
		return "", ErrHookSources
	}
	sources = append(slices.Clone(sources), hookDocument{"hooks": serialized})
	appendHook := func(event, command string) error {
		var groups []any
		if previous, present := hooks[event]; present {
			var ok bool
			groups, ok = previous.([]any)
			if !ok {
				return ErrHookSources
			}
		}
		hooks[event] = append(groups, observerHook(command))
		return nil
	}
	quoted := quoteLauncher(launcher)
	for _, event := range []string{"SessionStart", "SessionEnd", "UserPromptSubmit", "Stop", "Interrupt"} {
		count := 0
		for _, doc := range sources {
			owned, err := ownedHookCount(doc, event)
			if err != nil {
				return "", err
			}
			count += owned
		}
		if count > 1 {
			return "", ErrHookSources
		}
		if count == 0 {
			command := quoted + " __hook codex"
			if event == "Stop" {
				command += " --activity-only"
			}
			if err := appendHook(event, command); err != nil {
				return "", err
			}
		}
	}
	if err := appendHook("Stop", quoted+" __digest-hook codex --discover-launch"); err != nil {
		return "", err
	}
	var result strings.Builder
	if err := writeInlineTOML(&result, hooks); err != nil || result.Len() > settingsLimit {
		return "", ErrHookSources
	}
	return result.String(), nil
}

func writeInlineTOML(out *strings.Builder, value any) error {
	switch v := value.(type) {
	case string:
		// JSON basic string escaping is TOML-compatible after handling DEL.
		var escaped strings.Builder
		for _, ch := range v {
			switch {
			case ch == '"' || ch == '\\':
				escaped.WriteByte('\\')
				escaped.WriteRune(ch)
			case ch < 32 || ch == 127:
				escaped.WriteString(`\u00`)
				escaped.WriteByte("0123456789abcdef"[ch>>4])
				escaped.WriteByte("0123456789abcdef"[ch&15])
			default:
				escaped.WriteRune(ch)
			}
		}
		out.WriteByte('"')
		out.WriteString(escaped.String())
		out.WriteByte('"')
	case bool:
		out.WriteString(strconv.FormatBool(v))
	case int64:
		out.WriteString(strconv.FormatInt(v, 10))
	case float64:
		if !finite(v) {
			return ErrHookSources
		}
		number := strconv.FormatFloat(v, 'g', -1, 64)
		if !strings.ContainsAny(number, ".eE") {
			number += ".0"
		}
		out.WriteString(number)
	case []any:
		out.WriteByte('[')
		for i, element := range v {
			if i > 0 {
				out.WriteByte(',')
			}
			if err := writeInlineTOML(out, element); err != nil {
				return err
			}
		}
		out.WriteByte(']')
	case map[string]any:
		out.WriteByte('{')
		for i, key := range slices.Sorted(maps.Keys(v)) {
			if i > 0 {
				out.WriteByte(',')
			}
			if err := writeInlineTOML(out, key); err != nil {
				return err
			}
			out.WriteByte('=')
			if err := writeInlineTOML(out, v[key]); err != nil {
				return err
			}
		}
		out.WriteByte('}')
	default:
		return ErrHookSources
	}
	return nil
}
