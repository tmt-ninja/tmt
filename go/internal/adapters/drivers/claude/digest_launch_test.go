package claude

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func claudeDigestLaunchFixture(t *testing.T, global string, args ...string) (ports.ProcessSpec, string, core.HookCaptureLaunch) {
	t.Helper()
	dir := t.TempDir()
	config := filepath.Join(dir, "fake-claude")
	if err := os.Mkdir(config, 0700); err != nil {
		t.Fatal(err)
	}
	if global != "" {
		if err := os.WriteFile(filepath.Join(config, "settings.json"), []byte(global), 0600); err != nil {
			t.Fatal(err)
		}
	}
	launcher := filepath.Join(dir, "'callback "+flavor.Binary, flavor.Binary)
	if err := os.Mkdir(filepath.Dir(launcher), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(launcher, []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
		t.Fatal(err)
	}
	return ports.ProcessSpec{Path: "/bin/sh", Args: args, Dir: dir, Env: []string{"CLAUDE_CONFIG_DIR=fake-claude"}}, launcher,
		core.HookCaptureLaunch{IdentityID: "11111111-1111-4111-8111-111111111111",
			BindingID: "22222222-2222-4222-8222-222222222222", OwnerPID: 42, OwnerStart: "start' token"}
}

type observedHookGroup struct {
	Hooks []struct{ Command string }
}

func digestLaunchSettingsValue(t *testing.T, args []string) (map[string][]observedHookGroup, string) {
	t.Helper()
	index := slices.Index(args, "--settings")
	if index < 0 || index+1 >= len(args) {
		t.Fatalf("missing inline settings: %q", args)
	}
	raw := args[index+1]
	var settings struct {
		Hooks map[string][]observedHookGroup
	}
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		t.Fatal(err)
	}
	return settings.Hooks, raw
}

func TestDigestLaunchAddsOneActivityObserverAndOneScopedStop(t *testing.T) {
	command, launcher, launch := claudeDigestLaunchFixture(t, "", "--resume", "session", "--model", "model")
	prepared, err := AddDigestLaunchHooks(command, launcher, launch)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(prepared.Args[:4], command.Args) {
		t.Fatalf("changed provider args: %q", prepared.Args)
	}
	hooks, _ := digestLaunchSettingsValue(t, prepared.Args)
	for _, event := range []string{"SessionStart", "SessionEnd", "UserPromptSubmit", "Notification", "PostToolUse", "PostToolUseFailure"} {
		if len(hooks[event]) != 1 {
			t.Fatalf("observer for %s = %+v", event, hooks[event])
		}
	}
	stop := hooks["Stop"]
	if len(stop) != 2 || !strings.HasSuffix(stop[0].Hooks[0].Command, "__hook claude --activity-only") ||
		!strings.HasPrefix(stop[1].Hooks[0].Command, quoteHookWord(launcher)+" __digest-hook claude --launch '") ||
		!strings.Contains(stop[1].Hooks[0].Command, "start'\\'' token") {
		t.Fatalf("Stop hooks = %+v", stop)
	}
}

func TestDigestLaunchPreservesSetupObserversAndExplicitSettings(t *testing.T) {
	shipped, err := json.Marshal(hookGroup{Hooks: []hookCommand{{
		Type: "command", Timeout: 3, Command: "'/stable/" + flavor.Binary + "' __hook claude",
	}}})
	if err != nil {
		t.Fatal(err)
	}
	global, err := json.Marshal(map[string]any{"hooks": map[string][]json.RawMessage{
		"Stop": {shipped}, "SessionStart": {shipped}, "Notification": {shipped},
	}})
	if err != nil {
		t.Fatal(err)
	}
	command, launcher, launch := claudeDigestLaunchFixture(t, string(global), "--settings=explicit.json", "--", "literal")
	const original = `{"permissions":{"allow":["Read"]},"unknown":123456789012345678901234567890,"hooks":{"Stop":[{"hooks":[{"type":"command","command":"user-hook","timeout":"opaque"}]}]}}`
	explicit := filepath.Join(command.Dir, "explicit.json")
	if err := os.WriteFile(explicit, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	prepared, err := AddDigestLaunchHooks(command, launcher, launch)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(prepared.Args[2:], []string{"--", "literal"}) {
		t.Fatalf("changed literal argument boundary: %q", prepared.Args)
	}
	hooks, raw := digestLaunchSettingsValue(t, prepared.Args)
	if hooks["SessionStart"] != nil || hooks["Notification"] != nil ||
		!strings.Contains(raw, "123456789012345678901234567890") ||
		!strings.Contains(raw, `"timeout":"opaque"`) || !strings.Contains(raw, "__digest-hook") {
		t.Fatalf("settings lost a user hook or duplicated setup observers: %s", raw)
	}
	unchanged, err := os.ReadFile(explicit)
	if err != nil || string(unchanged) != original {
		t.Fatalf("explicit settings changed: %q, %v", unchanged, err)
	}
	unchanged, err = os.ReadFile(filepath.Join(command.Dir, "fake-claude", "settings.json"))
	if err != nil || string(unchanged) != string(global) {
		t.Fatalf("fake global settings changed: %q, %v", unchanged, err)
	}

	command.Args = []string{"--setting-sources=project"}
	prepared, err = AddDigestLaunchHooks(command, launcher, launch)
	if err != nil {
		t.Fatal(err)
	}
	hooks, _ = digestLaunchSettingsValue(t, prepared.Args)
	if len(hooks["SessionStart"]) != 1 || len(hooks["Stop"]) != 2 {
		t.Fatalf("ignored user settings suppressed a launch observer: %+v", hooks)
	}
}

func TestDigestLaunchRefusesAmbiguousSettingsWithoutReadsOrWrites(t *testing.T) {
	for _, args := range [][]string{
		{"--bare"}, {"--safe-mode"}, {"--setting-sources", "user", "--setting-sources=local"},
		{"--settings", `{"disableAllHooks":true}`}, {"--settings", `{"allowManagedHooksOnly":true}`},
		{"--settings", `{"hooks":{},"hooks":{}}`}, {"--settings", "{}", "--settings={}"},
		{"--settings", `{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"'/stable/tmt' __hook claude --changed","timeout":3}]}]}}`},
		{"--settings=linked.json"}, {"--settings=auth.json"},
	} {
		command, launcher, launch := claudeDigestLaunchFixture(t, "", args...)
		if err := os.WriteFile(filepath.Join(command.Dir, "settings.json"), []byte("{}"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink("settings.json", filepath.Join(command.Dir, "linked.json")); err != nil {
			t.Fatal(err)
		}
		if _, err := AddDigestLaunchHooks(command, launcher, launch); err == nil {
			t.Errorf("admitted ambiguous settings %q", args)
		}
	}
}

func TestSetupStopObserverRequiresExactSelectedFlavor(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	path := filepath.Join(dir, "settings.json")
	const fixture = `{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"'/stable/executable' __hook claude","timeout":3}]}]}}`
	for _, tc := range []struct {
		text string
		want bool
	}{
		{strings.Replace(fixture, "executable", flavor.Binary, 1), true},
		{strings.Replace(fixture, "executable", "tmt", 1), flavor.NativeCompatible},
		{strings.Replace(fixture, "executable", "another-launcher", 1), flavor.NativeCompatible},
		{strings.Replace(strings.Replace(fixture, "executable", flavor.Binary, 1), "timeout\":3", "timeout\":30", 1), false},
		{`{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"user-hook"}]}]}}`, false},
	} {
		if err := os.WriteFile(path, []byte(tc.text), 0600); err != nil {
			t.Fatal(err)
		}
		if got := HasSetupStopObserver(); got != tc.want {
			t.Errorf("setup ownership for %s = %t, want %t", tc.text, got, tc.want)
		}
	}
}
