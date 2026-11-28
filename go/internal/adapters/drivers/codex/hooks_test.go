//go:build darwin || linux

package codex

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestNativeCodexLaunchCompositionPreservesSources(t *testing.T) {
	paths := providerPaths{home: t.TempDir(), system: t.TempDir(), cwd: t.TempDir()}
	config := "[hooks.state.\"/u/hooks.json:stop:0:0\"]\ntrusted_hash='sha256:aa'\n"
	owned := `{"hooks":{"Stop":[{"hooks":[{"command":"'/old/tmt' __hook codex","type":"command","timeout":3}]}]}}`
	fixtureSetting(t, paths.home, "config.toml", config)
	fixtureSetting(t, paths.system, "hooks.json", owned)

	args := []string{"resume", "-c", `hooks.SessionStart=[{hooks=[{type="command",command="echo local",timeout=4}]}]`, "exact", "--", "initial prompt"}
	original := ports.ProcessSpec{Path: "/fake/codex", Dir: paths.cwd, Args: args}
	command, err := addLaunchHooks(original, "/tmp/tmt'go", paths)
	if err != nil {
		t.Fatal(err)
	}
	if command.Args[1] != "-c" || !slices.Equal(command.Args[3:], args[1:]) {
		t.Fatalf("resume argument placement = %+v", command.Args)
	}
	hooks, state, err := hookSettings([]byte(command.Args[2]))
	if err != nil || state {
		t.Fatalf("generated override is invalid: %v", err)
	}
	for event, count := range map[string]int{"SessionStart": 2, "SessionEnd": 1, "UserPromptSubmit": 1, "Stop": 1, "Interrupt": 1} {
		groups, ok := hooks[event].([]any)
		if !ok || len(groups) != count {
			t.Fatalf("%s = %+v, want %d groups", event, hooks[event], count)
		}
	}
	if !strings.Contains(command.Args[2], "echo local") || !strings.Contains(command.Args[2], "__digest-hook codex --discover-launch") ||
		strings.Contains(command.Args[2], "trusted_hash") || strings.Contains(command.Args[2], "__hook codex --activity-only") {
		t.Fatalf("incorrect composed override %s", command.Args[2])
	}
	for _, entry := range []struct{ dir, name, want string }{{paths.home, "config.toml", config}, {paths.system, "hooks.json", owned}} {
		got, err := os.ReadFile(filepath.Join(entry.dir, entry.name))
		if err != nil || string(got) != entry.want {
			t.Fatalf("source %s was changed: %v", entry.name, err)
		}
	}
}

func TestNativeCodexLaunchRefusesUnsupportedHookSources(t *testing.T) {
	for _, tc := range []struct{ name, value string }{
		{"config.toml", "hooks.Stop=[]"},
		{"requirements.toml", "allow_managed_hooks_only=true"},
		{"hooks.json", `{"hooks":{"Stop":[{"hooks":[{"command":"'/old/tmt' __hook codex","type":"command","timeout":30}]}]}}`},
		{"hooks.json", `{"hooks":{},"hooks":{}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			paths := providerPaths{home: t.TempDir(), system: t.TempDir(), cwd: t.TempDir()}
			fixtureSetting(t, paths.home, tc.name, tc.value)
			_, err := addLaunchHooks(ports.ProcessSpec{Path: "/fake/codex"}, "/tmp/tmt-go", paths)
			if !errors.Is(err, ErrHookSources) {
				t.Fatalf("source refusal = %v", err)
			}
		})
	}
}

func TestCodexFolderTrustPrefersExactProjectThenRepository(t *testing.T) {
	home := t.TempDir()
	root := t.TempDir()
	cwd := filepath.Join(root, "work")
	if err := os.Mkdir(cwd, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, ".git"), 0700); err != nil {
		t.Fatal(err)
	}
	fixtureSetting(t, filepath.Join(root, ".git"), "HEAD", "ref: refs/heads/main")
	if got := localProjectTrust(home, cwd); got != trustUnset {
		t.Fatalf("missing settings trust = %v", got)
	}
	base := "[projects.\"" + root + "\"]\ntrust_level='trusted'\n"
	fixtureSetting(t, home, "config.toml", base)
	if got := localProjectTrust(home, cwd); got != trustTrusted {
		t.Fatalf("repository trust = %v", got)
	}
	fixtureSetting(t, home, "config.toml", base+"[projects.\""+cwd+"\"]\ntrust_level='untrusted'\n")
	if got := folderTrustAdvisory(home, cwd); got != "Codex may ask you to trust this folder in its own window." {
		t.Fatalf("exact trust advisory = %q", got)
	}
	fixtureSetting(t, home, "config.toml", "invalid = [")
	if got := localProjectTrust(home, cwd); got != trustUnknown {
		t.Fatalf("invalid config trust = %v", got)
	}
}

func fixtureSetting(t *testing.T, dir, name, value string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(value), 0600); err != nil {
		t.Fatal(err)
	}
}
