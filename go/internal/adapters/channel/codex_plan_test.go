package channel

import (
	"errors"
	"net/netip"
	"slices"
	"strings"
	"testing"

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
