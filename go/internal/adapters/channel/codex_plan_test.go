package channel

import (
	"bytes"
	"errors"
	"fmt"
	"net/netip"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestCodexChannelPlansFromInvocationOnly(t *testing.T) {
	selected := ports.ProcessSpec{
		Path: "/fixtures/codex", Env: []string{"PATH=/fixtures", codexTokenEnv + "=stale"},
		Args: []string{"-m", "test-model", "-C", "project", "--sandbox", "read-only", "--ask-for-approval", "on-request",
			"--no-alt-screen", `--config=model_reasoning_effort="medium"`},
	}
	plan, err := PlanCodexLaunch(selected, "/owned", "")
	if err != nil {
		t.Fatal(err)
	}
	const tokenFile = "/owned/root/channels/codex/generation/capability"
	server := plan.serverCommand(tokenFile)
	wantServer := []string{"-c", `model="test-model"`, "-c", `sandbox_mode="read-only"`, "-c", `approval_policy="on-request"`,
		"--config", `model_reasoning_effort="medium"`, "app-server", "--listen", "ws://127.0.0.1:0",
		"--ws-auth", "capability-token", "--ws-token-file", tokenFile}
	if server.Path != selected.Path || server.Dir != "/owned/project" || !slices.Equal(server.Args, wantServer) ||
		slices.Contains(server.Env, codexTokenEnv+"=stale") || !slices.Contains(server.Env, "NO_COLOR=1") {
		t.Fatalf("app-server plan = %+v", server)
	}
	endpoint := netip.MustParseAddrPort("127.0.0.1:3123")
	token := strings.Repeat("0a", 32)
	foreground, err := plan.remoteForeground(endpoint, token)
	wantForeground := []string{"--remote", "ws://127.0.0.1:3123", "--remote-auth-token-env", codexTokenEnv,
		"-C", "/owned/project", "-m", "test-model", "--no-alt-screen", "--config", `model_reasoning_effort="medium"`,
		"--sandbox", "read-only", "--ask-for-approval", "on-request"}
	if err != nil || !slices.Equal(foreground.Args, wantForeground) || !slices.Contains(foreground.Env, codexTokenEnv+"="+token) ||
		slices.Contains(foreground.Env, codexTokenEnv+"=stale") {
		t.Fatalf("foreground argv = %q, error = %v", foreground.Args, err)
	}
	if !slices.Contains(selected.Env, codexTokenEnv+"=stale") {
		t.Fatal("foreground planning modified caller environment")
	}
	for _, addr := range []string{"127.0.0.1:0", "127.0.0.2:3123", "[::1]:3123", "192.0.2.3:3123"} {
		if _, err := plan.remoteForeground(netip.MustParseAddrPort(addr), token); err == nil {
			t.Errorf("accepted non-owned endpoint shape %s", addr)
		}
	}
	if _, err := plan.remoteForeground(endpoint, "short"); err == nil {
		t.Fatal("accepted malformed capability")
	}
}

func TestCodexExactResumeUsesTypedThreadAndNoPrompt(t *testing.T) {
	const thread = "10000000-0000-4000-8000-000000000001"
	plan, err := PlanCodexLaunch(ports.ProcessSpec{Path: "/fixtures/codex",
		Args: []string{"resume", "--model", "selected", "-c", `model_reasoning_effort="medium"`, thread, "--no-daemon"}}, "/owned", thread)
	if err != nil {
		t.Fatal(err)
	}
	args, err := plan.remoteForeground(netip.MustParseAddrPort("127.0.0.1:12345"), strings.Repeat("0", 64))
	if err != nil || args.Args[0] != "resume" || args.Args[len(args.Args)-1] != thread ||
		slices.Contains(args.Args, "--no-daemon") || plan.resumeParams()["model"] != "selected" || plan.resumeParams()["threadId"] != thread {
		t.Fatalf("exact resume argv = %q, params = %v, error = %v", args.Args, plan.resumeParams(), err)
	}
	for _, argv := range [][]string{
		{"resume", thread, "extra"},
		{"resume", "-m"},
		{"resume", "--sandbox", "read-only", thread},
		{"resume", "10000000-0000-4000-8000-000000000002"},
	} {
		if _, err := PlanCodexLaunch(ports.ProcessSpec{Path: "/fixtures/codex", Args: argv}, "/owned", thread); !errors.Is(err, ErrCodexLaunchArguments) {
			t.Errorf("accepted invalid resume %q: %v", argv, err)
		}
	}
}

func TestCodexLaunchRejectsAmbiguousOrUnsupportedArguments(t *testing.T) {
	for _, args := range [][]string{
		{"hello"}, {"resume", "latest"}, {"fork"}, {"--remote", "ws://127.0.0.1:8123"},
		{"--model"}, {"--sandbox", "other"}, {"--ask-for-approval", "on-failure"},
		{"--config", `permissions.tools="none"`}, {"-c", `"sandbox_mode"="read-only"`},
		{"-c", `network.enabled=true`}, {"--no-alt-screen=true"},
	} {
		if _, err := PlanCodexLaunch(ports.ProcessSpec{Path: "/fixtures/codex", Args: args}, "/owned", ""); !errors.Is(err, ErrCodexLaunchArguments) {
			t.Errorf("accepted %q: %v", args, err)
		}
	}
}

func TestCodexPreflightTrustNoteUsesNativeCDAndOnlyReadsLocalSettings(t *testing.T) {
	fixture := t.TempDir()
	selected := filepath.Join(fixture, "selected")
	alternate := filepath.Join(fixture, "alternate")
	for _, dir := range []string{selected, alternate} {
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("HOME", fixture)
	t.Setenv("CODEX_HOME", alternate)
	// The selected shim uses the same PATH as the invoker's version probe.
	// This directory contains only fixture executables.
	t.Setenv("PATH", alternate)
	executable := filepath.Join(fixture, "fake-codex")
	shim := "#!/usr/bin/env node\n"
	probe := "#!/bin/sh\n[ \"$#\" = 2 ] && [ \"$2\" = --version ] || exit 2\nprintf 'codex-cli %s\\n' \"$CODEX_FIXTURE_VERSION\"\n"
	settings := filepath.Join(alternate, "config.toml")
	root := home.Root{Dir: filepath.Join(fixture, "channel")}
	write := func(path, content string, mode os.FileMode) {
		t.Helper()
		if err := os.WriteFile(path, []byte(content), mode); err != nil {
			t.Fatal(err)
		}
	}
	write(executable, shim, 0700)
	write(filepath.Join(alternate, "node"), probe, 0700)
	original := fmt.Sprintf("[profiles.managed]\nmodel = %q\n[projects.%q]\ntrust_level = %q\n", "unused", fixture, "trusted")
	write(settings, original, 0600)
	const advisory = "Codex may ask you to trust this folder in its own window."
	plan, err := PlanCodexLaunch(ports.ProcessSpec{Path: executable, Args: []string{"-C", "selected"}}, fixture, "")
	if err != nil {
		t.Fatal(err)
	}
	check := func(plan CodexPlan, version, want string, original string) {
		t.Helper()
		t.Setenv("CODEX_FIXTURE_VERSION", version)
		qualified, got, err := PreflightCodexPlan(t.Context(), process.Runner{}, root, plan)
		if err != nil || got != want || qualified.root != root.Dir || qualified.plan.cwd != plan.cwd {
			t.Fatalf("version %s: advisory = %q, err = %v, want %q", version, got, err, want)
		}
		after, err := os.ReadFile(settings)
		if err != nil || !bytes.Equal(after, []byte(original)) {
			t.Fatalf("settings changed after preflight: %v", err)
		}
		if _, err := os.Lstat(root.Dir); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("preflight created channel state: %v", err)
		}
	}
	for _, version := range []string{"0.159.2", "0.159.3", "0.160.0"} {
		check(plan, version, advisory, original)
	}
	const session = "10000000-0000-4000-8000-000000000001"
	resume, err := PlanCodexLaunch(ports.ProcessSpec{Path: executable, Args: []string{"resume", session}}, selected, session)
	if err != nil {
		t.Fatal(err)
	}
	check(resume, "0.160.0", "", original)

	trusted := original + fmt.Sprintf("[projects.%q]\ntrust_level = %q\n", selected, "trusted")
	write(settings, trusted, 0600)
	check(plan, "0.160.0", "", trusted)
	const malformed = "malformed = ["
	write(settings, malformed, 0600)
	check(plan, "0.160.0", "", malformed)
}
