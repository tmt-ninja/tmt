//go:build darwin || linux

package tmux

import (
	"context"
	"os/exec"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

func TestCloseOwnedPanePrivateServer(t *testing.T) {
	server := tmuxtest.Start(t)
	path, err := exec.LookPath("tmux")
	if err != nil {
		t.Fatal(err)
	}
	runner := process.Runner{}
	client := Client{Path: path, Process: runner}
	ctx := t.Context()
	if _, err := client.EnsureServerID(ctx, server.Socket); err != nil {
		t.Fatal(err)
	}
	agent := core.Identity{ID: "agent-id", Name: "agent", CanonicalName: "agent"}
	original := ports.PaneRef{Server: server.Socket, PaneID: strings.TrimSpace(server.Run("display-message", "-p", "#{pane_id}"))}
	spec := ports.LaunchSpec{Server: server.Socket, Session: "t", Window: "owned",
		Command: ports.ProcessSpec{Path: "/bin/sleep", Args: []string{"45"}}}
	owned, err := client.LaunchOwned(ctx, spec, agent)
	if err != nil {
		t.Fatal(err)
	}
	bind := func(pane ports.PaneRef, id core.BindingID) core.Binding {
		t.Helper()
		probe, err := client.ProbeBinding(ctx, pane)
		if err != nil || len(probe.Panes) != 1 {
			t.Fatalf("probe %s = %+v, %v", pane.PaneID, probe, err)
		}
		current := probe.Panes[0]
		binding := core.Binding{ID: id, IdentityID: agent.ID, Server: probe.Server,
			PaneID: pane.PaneID, PanePID: current.PID, PaneIncarnation: current.Incarnation}
		if published, err := client.PublishBinding(ctx, binding, agent); err != nil || !published {
			t.Fatalf("publish %s = %t, %v", pane.PaneID, published, err)
		}
		return binding
	}
	current := bind(owned, "owned-binding")
	userPane := bind(original, "user-binding")
	check := func(c Client, binding core.Binding, want PaneClose) {
		t.Helper()
		if got, err := c.CloseOwnedPane(ctx, binding, agent); err != nil || got != want {
			t.Fatalf("close %s = %v, %v, want %v", binding.PaneID, got, err, want)
		}
	}

	nativeOpened := "@tmt.opened"
	if flavor.NativeCompatible {
		nativeOpened = "@tmt-go.opened"
	}
	server.Run("set-option", "-p", "-t", original.PaneID, nativeOpened, "1")
	check(client, userPane, PaneKept)
	origin := strings.TrimSuffix(server.Run("show-options", "-p", "-t", owned.PaneID, "-v", openedOption), "\n")
	server.Run("set-option", "-p", "-t", original.PaneID, openedOption, origin)
	check(client, userPane, PaneKept)
	if got := server.Run("show-options", "-p", "-t", original.PaneID, "-v", nativeOpened); got != "1\n" {
		t.Fatalf("native origin was changed: %q", got)
	}

	racing := Client{Path: path, Process: runFunc(func(ctx context.Context, cmd ports.ProcessSpec) (ports.Bounded, error) {
		for _, arg := range cmd.Args {
			if arg == "kill-pane -t "+owned.PaneID {
				server.Run("set-option", "-p", "-t", owned.PaneID, openedOption, "changed")
			}
		}
		return runner.Run(ctx, cmd)
	})}
	check(racing, current, PaneKept)
	server.Run("set-option", "-p", "-t", owned.PaneID, openedOption, origin)
	server.Run("new-session", "-d", "-s", "other")
	// Move the only other window out. Closing the target would now end t.
	server.Run("move-window", "-s", "=t:0", "-t", "=other:1")
	check(client, current, PaneKept)
	server.Run("move-window", "-s", "=other:1", "-t", "=t:0")
	check(client, current, PaneClosed)
	check(client, current, PaneGone)
	if got := server.Run("list-panes", "-a", "-F", "#{pane_id}"); !strings.Contains(got, original.PaneID+"\n") ||
		strings.Contains(got, owned.PaneID+"\n") {
		t.Fatalf("remaining panes = %q", got)
	}
}
