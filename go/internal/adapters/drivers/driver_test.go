package drivers_test

import (
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/claude"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/codex"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/gemini"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const session = "3fa85f64-5717-4562-b3fc-2c963f66afa6"

func TestPlainDriverLaunchArguments(t *testing.T) {
	root, work := t.TempDir(), t.TempDir()
	t.Setenv("TMT_GO_HOME", "parent-root")
	t.Setenv("TMT_AGENT", "parent-agent")
	fake := filepath.Join(t.TempDir(), "fake provider")
	if err := os.WriteFile(fake, nil, 0700); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		driver ports.Driver
		resume string
		effort string
		extra  []string
		args   []string
	}{
		{"claude exact resume", claude.Driver{Executable: fake}, session, "high", []string{"--", "literal prompt"},
			[]string{"--resume", session, "--model", "chosen", "--effort", "high", "--", "literal prompt"}},
		{"codex exact resume", codex.Driver{Executable: fake}, session, "high", nil,
			[]string{"resume", "-m", "chosen", "-c", `model_reasoning_effort="high"`, session, "--no-daemon"}},
		{"codex remote", codex.Driver{Executable: fake}, "", "", []string{"--remote", "endpoint"},
			[]string{"-m", "chosen", "--remote", "endpoint"}},
		{"codex flag-looking prompt", codex.Driver{Executable: fake}, "", "", []string{"--", "--remote"},
			[]string{"-m", "chosen", "--no-daemon", "--", "--remote"}},
		{"codex flag-looking value", codex.Driver{Executable: fake}, "", "", []string{"--profile", "--remote"},
			[]string{"-m", "chosen", "--no-daemon", "--profile", "--remote"}},
		{"gemini", gemini.Driver{Executable: fake}, "", "", []string{"--", "literal prompt"},
			[]string{"--model", "chosen", "--", "literal prompt"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := tc.driver.LaunchCommand(ports.AgentLaunch{
				Dir: work, HomeDir: root, Resume: tc.resume,
				Model: "chosen", Effort: tc.effort, Extra: tc.extra,
			})
			if err != nil {
				t.Fatal(err)
			}
			if got.Path != fake || got.Dir != work || !slices.Equal(got.Args, tc.args) {
				t.Fatalf("launch path %q, cwd %q, argv %q", got.Path, got.Dir, got.Args)
			}
			if !slices.Contains(got.Env, "TMT_GO_HOME="+root) || !slices.Contains(got.Env, "TMT_AGENT=1") ||
				slices.Contains(got.Env, "TMT_GO_HOME=parent-root") || slices.Contains(got.Env, "TMT_AGENT=parent-agent") ||
				os.Getenv("TMT_GO_HOME") != "parent-root" || os.Getenv("TMT_AGENT") != "parent-agent" {
				t.Fatal("launch changed or failed to isolate the child environment")
			}
		})
	}
}

func TestDriversRefuseAmbiguousManagedResume(t *testing.T) {
	for _, d := range []ports.Driver{
		claude.Driver{Executable: "/bin/sh"}, codex.Driver{Executable: "/bin/sh"}, gemini.Driver{Executable: "/bin/sh"},
	} {
		if _, err := d.LaunchCommand(ports.AgentLaunch{HomeDir: t.TempDir(), Resume: "latest"}); err == nil {
			t.Fatalf("%s accepted an ambiguous managed resume", d.Name())
		}
	}
}

func TestDriverScreenAndSubmitPlan(t *testing.T) {
	for _, tc := range []struct {
		driver ports.Driver
		idle   string
		busy   string
		prompt string
	}{
		{claude.Driver{}, "❯", "Processing · esc to interrupt", "Do you want to proceed?"},
		{codex.Driver{}, "›", "Working · esc to interrupt", "Do you trust the contents of this directory?"},
		{gemini.Driver{}, ">", "Thinking · esc to cancel", "Allow execution of: echo hello"},
	} {
		t.Run(tc.driver.Name(), func(t *testing.T) {
			for screen, want := range map[string]ports.DriverState{
				"earlier output\n" + tc.idle + "  \n": ports.DriverIdle,
				tc.busy + "\n" + tc.idle:              ports.DriverBusy,
				tc.prompt + "\n" + tc.idle:            ports.DriverPrompt,
				tc.idle + "\nlater output":            ports.DriverUnknown,
			} {
				if got := tc.driver.Classify(ports.Screen{Text: screen}); got != want {
					t.Errorf("Classify(%q) = %v, want %v", screen, got, want)
				}
			}
			if got := tc.driver.SubmitPlan("literal\ninput"); !slices.Equal(got, []ports.KeyStep{{Key: "Enter"}}) {
				t.Fatalf("SubmitPlan = %+v", got)
			}
		})
	}
}
