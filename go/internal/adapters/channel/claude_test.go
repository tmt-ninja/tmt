//go:build darwin || linux

package channel

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const (
	testBinding  = "10000000-0000-4000-8000-000000000001"
	testIdentity = "20000000-0000-4000-8000-000000000002"
	testStart    = "ps-v1:Sat Jan 1 00:00:00 2000"
)

type testRunner func(context.Context, ports.ProcessSpec) (ports.Bounded, error)

func (f testRunner) Run(ctx context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
	return f(ctx, spec)
}

func TestProviderBuildPolicy(t *testing.T) {
	for _, tc := range []struct {
		build         string
		claude, codex BuildStatus
	}{
		{"2.1.285 (Claude Code)", BuildTested, BuildUnsupported},
		{"2.1.286 (Claude Code)", BuildUntested, BuildUnsupported},
		{"2.2.0 (Claude Code)", BuildUntested, BuildUnsupported},
		{"2.1.284 (Claude Code)", BuildUnsupported, BuildUnsupported},
		{"3.0.0 (Claude Code)", BuildUnsupported, BuildUnsupported},
		{"2.01.285 (Claude Code)", BuildUnsupported, BuildUnsupported},
		{"2.1.285 (Claude Code)\nextra", BuildUnsupported, BuildUnsupported},
		{"codex-cli 0.159.2", BuildUnsupported, BuildTested},
		{"codex-cli 0.159.3", BuildUnsupported, BuildTested},
		{"codex-cli 0.160.0", BuildUnsupported, BuildTested},
		{"codex-cli 0.159.4", BuildUnsupported, BuildUntested},
		{"codex-cli 0.160.1", BuildUnsupported, BuildUnsupported},
		{"codex-cli 0.159.2-dev", BuildUnsupported, BuildUnsupported},
	} {
		if a, b := ClaudeBuild(tc.build), CodexBuild(tc.build); a != tc.claude || b != tc.codex {
			t.Errorf("%q: builds %v %v, want %v %v", tc.build, a, b, tc.claude, tc.codex)
		}
	}
	root := home.Root{Dir: "/tmp/short"}
	const executable = "/fixtures/provider"
	version := "2.1.286 (Claude Code)"
	runner := testRunner(func(ctx context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
		if _, ok := ctx.Deadline(); !ok || spec.Path != executable ||
			!slices.Equal(spec.Args, []string{"--version"}) || spec.MaxOut != 4096 || len(spec.Stdin) != 0 {
			t.Fatalf("unexpected provider probe %+v", spec)
		}
		return ports.Bounded{Stdout: []byte(version + "\n")}, nil
	})
	if note, err := PreflightClaude(t.Context(), runner, root, executable); err != nil || !strings.Contains(note, "2.1.286") {
		t.Fatalf("Claude preflight = %q, %v", note, err)
	}
	version = "codex-cli 0.159.4"
	if err := PreflightCodex(t.Context(), runner, root, executable); !errors.Is(err, ErrProviderUnqualified) {
		t.Fatalf("Codex preflight = %v", err)
	}
	version = "codex-cli 0.160.0"
	if err := PreflightCodex(t.Context(), runner, root, executable); err != nil {
		t.Fatal(err)
	}
}

func TestClaudeLeaseRecordsBeforeSpawnAndComparesGeneration(t *testing.T) {
	ctx := t.Context()
	in := fixtureEnrollment(t)
	runner := testRunner(func(_ context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
		if spec.Path != "/bin/ps" || len(spec.Args) < 2 || spec.Args[0] != "-p" {
			t.Fatalf("unexpected process invocation: %+v", spec)
		}
		return ports.Bounded{Stdout: []byte("Sat Jan  1 00:00:00 2000 S\n")}, nil
	})
	lease, err := EnrollClaude(ctx, runner, in)
	if err != nil {
		t.Fatal(err)
	}
	dir, err := openChannelDir(in.Root, false)
	if err != nil {
		t.Fatal(err)
	}
	defer dir.close()
	initial, err := dir.readClaude(testBinding)
	if err != nil || initial == nil || initial.Foreground != nil || initial.Claude != nil ||
		initial.LaunchOwner != storedProcess(in.LaunchOwner) || initial.Pane.PaneID != in.Binding.PaneID ||
		initial.IdentityID != string(in.Identity.ID) {
		t.Fatalf("pending enrollment = %+v, %v", initial, err)
	}
	command := lease.Command()
	args := command.Args
	var config struct {
		MCP map[string]struct {
			Command string   `json:"command"`
			Args    []string `json:"args"`
		} `json:"mcpServers"`
	}
	if !slices.Equal(args[:2], in.Command.Args) || args[2] != "--mcp-config" ||
		args[4] != claudeChannelFlag || args[5] != "server:tmt" ||
		json.Unmarshal([]byte(args[3]), &config) != nil {
		t.Fatalf("wrong launch args: %q", args)
	}
	server, ok := config.MCP["tmt"]
	if !ok || server.Command != in.TMTExecutable || !slices.Equal(server.Args, []string{
		"__channel-server", "claude", testBinding, initial.Generation, filepath.Join(in.Root.Dir, "channels"),
	}) || command.Path != in.Command.Path || !slices.Equal(command.Env, in.Command.Env) {
		t.Fatalf("wrong inline config or command: %+v, %+v", config, command)
	}
	child := core.ProcessIncarnation{PID: 8765, StartIdentity: testStart}
	if err := lease.ForegroundStarted(ctx, child); err != nil {
		t.Fatal(err)
	}
	now, err := dir.readClaude(testBinding)
	if err != nil || now == nil || now.Foreground == nil || *now.Foreground != storedProcess(child) {
		t.Fatalf("foreground = %+v, %v", now, err)
	}
	differentOwner := in
	differentOwner.LaunchOwner.PID++
	if _, err := EnrollClaude(ctx, runner, differentOwner); !errors.Is(err, ErrOccupied) {
		t.Fatalf("replacement over a live launch = %v", err)
	}
	replacement, err := EnrollClaude(ctx, runner, in)
	if err != nil {
		t.Fatal(err)
	}
	if err := lease.ForegroundStarted(ctx, child); !errors.Is(err, ErrOccupied) {
		t.Fatalf("stale foreground update = %v", err)
	}
	if err := lease.Withdraw(ctx); !errors.Is(err, ErrOccupied) {
		t.Fatalf("stale withdrawal = %v", err)
	}
	after, err := dir.readClaude(testBinding)
	if err != nil || after == nil || after.Generation == initial.Generation || after.Foreground != nil {
		t.Fatalf("replacement changed by old lease: %+v, %v", after, err)
	}
	if err := replacement.Withdraw(ctx); err != nil {
		t.Fatal(err)
	}
	if record, err := dir.readClaude(testBinding); err != nil || record != nil {
		t.Fatalf("withdrawal left %+v, %v", record, err)
	}
	if info, err := dir.root.Lstat(lockName); err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
		t.Fatalf("lock was not retained: %+v, %v", info, err)
	}
}

func TestClaudeRejectsUntrustedEnrollmentEntry(t *testing.T) {
	in := fixtureEnrollment(t)
	dir, err := openChannelDir(in.Root, true)
	if err != nil {
		t.Fatal(err)
	}
	defer dir.close()
	name := testBinding + ".json"
	valid := claudeRecord{Version: 1, BindingID: testBinding, Generation: "30000000-0000-4000-8000-000000000003",
		LaunchOwner: storedProcess(in.LaunchOwner)}
	data, err := json.Marshal(valid)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(in.Root.Dir, channelDirectory, name)
	target := filepath.Join(in.Root.Dir, "fixture")
	if err := os.WriteFile(target, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, path); err != nil {
		t.Fatal(err)
	}
	if _, err := dir.readClaude(testBinding); err == nil {
		t.Fatal("a symlink was accepted as enrollment")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		body []byte
		mode os.FileMode
	}{
		{data, 0644},
		{[]byte(strings.Repeat(" ", 4097)), 0600},
		{[]byte(strings.Replace(string(data), `"version":1`, `"version":1,"version":1`, 1)), 0600},
		{[]byte(strings.Replace(string(data), `"pid":`, `"pid":1,"pid":`, 1)), 0600},
	} {
		if err := os.WriteFile(path, tc.body, tc.mode); err != nil {
			t.Fatal(err)
		}
		if _, err := dir.readClaude(testBinding); err == nil {
			t.Fatal("an invalid enrollment was accepted")
		}
		if err := os.Remove(path); err != nil {
			t.Fatal(err)
		}
	}
}

func fixtureEnrollment(t *testing.T) ClaudeEnrollment {
	t.Helper()
	root, err := os.MkdirTemp("/tmp", "tmt-go-channel-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	identity := core.Identity{ID: testIdentity, Name: "member", CanonicalName: "member"}
	start := testStart
	binding := core.Binding{ID: testBinding, IdentityID: identity.ID, PaneID: "%7", PanePID: 1234, PaneIncarnation: &start,
		Server: core.ServerEvidence{Host: "tmux", ID: "server-id", Socket: "/tmp/fixture.sock", PID: 123, StartTime: "1700000000"}}
	marker := binding.Marker(identity)
	probe := core.EndpointProbe{State: core.EndpointProbeLive, Server: binding.Server,
		Panes: []core.PaneObservation{{ID: binding.PaneID, PID: binding.PanePID, Incarnation: &start, Marker: &marker}}}
	return ClaudeEnrollment{
		Root: home.Root{Dir: root}, Identity: identity, Binding: binding, Probe: probe,
		LaunchOwner: core.ProcessIncarnation{PID: 4321, StartIdentity: start}, TMTExecutable: "/fixture/tmt-go",
		Command: ports.ProcessSpec{Path: "/fixture/claude", Args: []string{"--model", "sonnet"}, Env: []string{"EXAMPLE=1"}},
	}
}
