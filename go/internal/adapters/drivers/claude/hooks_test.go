package claude

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestLifecycleHooksAreInlineAndPreserveCallerSettings(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "test ' launcher")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	launcher := filepath.Join(dir, "tmt-go")
	if err := os.WriteFile(launcher, []byte("#!/bin/sh\nprintf '%s\\n' \"$@\"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	d := Driver{Executable: "/bin/sh", HookExecutable: launcher}
	launch := ports.AgentLaunch{HomeDir: t.TempDir(), Extra: []string{
		"--settings", `{"model":"chosen","hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"user hook"}]}]}}`,
		"--", "--settings",
	}}
	got, err := d.LaunchCommand(launch)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Args) != 4 || got.Args[0] != "--settings" || !slices.Equal(got.Args[2:], launch.Extra[2:]) {
		t.Fatalf("prepared argv = %q", got.Args)
	}
	var settings struct {
		Model string
		Hooks map[string][]hookGroup
	}
	if err := json.Unmarshal([]byte(got.Args[1]), &settings); err != nil {
		t.Fatal(err)
	}
	start := settings.Hooks["SessionStart"]
	if settings.Model != "chosen" || len(settings.Hooks) != 9 || len(start) != 2 || start[0].Hooks[0].Command != "user hook" {
		t.Fatalf("prepared inline settings = %+v", settings)
	}
	if pre := settings.Hooks["PreToolUse"][0]; pre.Matcher != "AskUserQuestion|ExitPlanMode" {
		t.Fatalf("PreToolUse matcher = %q", pre.Matcher)
	}
	stop := settings.Hooks["Stop"][0].Hooks[0]
	if stop.Timeout != 3 {
		t.Fatalf("Stop timeout = %d", stop.Timeout)
	}
	out, err := exec.CommandContext(t.Context(), "/bin/sh", "-c", stop.Command).CombinedOutput()
	if err != nil || string(out) != "__hook\nclaude\n--activity-only\n" {
		t.Fatalf("Stop callback = %q, %v", out, err)
	}
	entries, err := os.ReadDir(launch.HomeDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("inline composition wrote files: %v, %v", entries, err)
	}
}

func TestLifecycleHooksRefuseUnsupportedSettings(t *testing.T) {
	launcher := filepath.Join(t.TempDir(), "tmt-go")
	if err := os.WriteFile(launcher, []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
		t.Fatal(err)
	}
	d := Driver{Executable: "/bin/sh", HookExecutable: launcher}
	for _, args := range [][]string{
		{"--bare"},
		{"--settings"},
		{"--settings=/some/provider/settings.json"},
		{"--settings={}", "--settings={}"},
		{`--settings={"disableAllHooks":true}`},
		{`--settings={"hooks":{"Stop": false}}`},
	} {
		if _, err := d.LaunchCommand(ports.AgentLaunch{HomeDir: t.TempDir(), Extra: args}); err == nil {
			t.Errorf("accepted settings %q", args)
		}
	}
}
