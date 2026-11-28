// fakeclaude drives deterministic provider callbacks in private tmux tests.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/flavor"
)

const session = "55555555-5555-4555-8555-555555555555"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	binary, fixture := os.Getenv("TMT_EXECUTABLE"), os.Getenv("TMT_FAKE_CLAUDE")
	if !filepath.IsAbs(binary) || filepath.Base(binary) != flavor.Binary ||
		!filepath.IsAbs(fixture) || !filepath.IsAbs(os.Getenv(flavor.EnvHome)) ||
		!filepath.IsAbs(os.Getenv("CLAUDE_CONFIG_DIR")) {
		return errors.New("Claude callback fixture requires a pinned test executable and private roots")
	}
	launch := digestLaunch(os.Args[1:], binary)
	if launch == "" {
		return errors.New("missing exact Digest launch argument")
	}
	if err := report(fixture, "ready", nil); err != nil {
		return err
	}
	steps := bufio.NewScanner(os.Stdin)
	for steps.Scan() {
		switch step := steps.Text(); step {
		case "startup":
			out, err := invoke(binary, []string{"__hook", "claude"}, map[string]any{
				"hook_event_name": "SessionStart", "source": "startup",
			})
			if err != nil {
				return err
			}
			if err := report(fixture, step, out); err != nil {
				return err
			}
		case "digest", "continued":
			if err := turn(binary, fixture, launch, step); err != nil {
				return err
			}
		case "exit":
			return nil
		}
	}
	return steps.Err()
}

func digestLaunch(args []string, executable string) string {
	quoted := "'" + strings.ReplaceAll(executable, "'", "'\\''") + "'"
	prefix := quoted + " __digest-hook claude --launch '"
	for i, arg := range args {
		if arg != "--settings" || i+1 >= len(args) {
			continue
		}
		var settings struct {
			Hooks map[string][]struct{ Hooks []struct{ Command string } }
		}
		if json.Unmarshal([]byte(args[i+1]), &settings) != nil {
			return ""
		}
		var launch string
		for _, group := range settings.Hooks["Stop"] {
			for _, hook := range group.Hooks {
				raw, has := strings.CutPrefix(hook.Command, prefix)
				if !has {
					continue
				}
				raw, complete := strings.CutSuffix(raw, "'")
				raw = strings.ReplaceAll(raw, "'\\''", "'")
				if launch != "" || !complete || !json.Valid([]byte(raw)) {
					return ""
				}
				launch = raw
			}
		}
		return launch
	}
	return ""
}

func turn(binary, fixture, launch, step string) error {
	active := step == "continued"
	answer := "after digest"
	if !active {
		answer = "before digest"
		if _, err := invoke(binary, []string{"__hook", "claude"}, map[string]any{"hook_event_name": "UserPromptSubmit"}); err != nil {
			return err
		}
	}
	body := map[string]any{"hook_event_name": "Stop", "stop_hook_active": active, "last_assistant_message": answer}
	if _, err := invoke(binary, []string{"__hook", "claude"}, body); err != nil {
		return err
	}
	out, err := invoke(binary, []string{"__digest-hook", "claude", "--launch", launch}, body)
	if err != nil {
		return err
	}
	return report(fixture, step, out)
}

func invoke(binary string, args []string, body map[string]any) ([]byte, error) {
	body["session_id"] = session
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Env = append(os.Environ(), "CLAUDE_PID="+strconv.Itoa(os.Getpid()))
	cmd.Stdin = strings.NewReader(string(data))
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("callback failed: %w: %s", err, out)
	}
	return out, nil
}

func report(fixture, name string, data []byte) error {
	path := filepath.Join(fixture, name)
	if err := os.WriteFile(path+".temporary", data, 0600); err != nil {
		return err
	}
	return os.Rename(path+".temporary", path)
}
