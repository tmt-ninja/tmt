package tmux

import (
	"context"
	"errors"
	"os/exec"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

func TestResolvePaneUsesTheExplicitPrivateSocket(t *testing.T) {
	server := tmuxtest.Start(t)
	path, err := exec.LookPath("tmux")
	if err != nil {
		t.Fatal(err)
	}
	c := Client{Path: path, Process: process.Runner{}}
	id := strings.TrimSpace(server.Run("split-window", "-d", "-t", "=t:0.0", "-P", "-F", "#{pane_id}"))
	t.Setenv("TMUX", "/invalid/ambient/socket,1,0")
	t.Setenv("TMUX_PANE", "%9999")
	want := ports.PaneRef{Server: server.Socket, PaneID: id}
	for _, target := range []string{id, "0.1", "t:0.1"} {
		if got, err := c.ResolvePane(t.Context(), server.Socket, target); err != nil || got != want {
			t.Fatalf("ResolvePane(%q) = %+v, %v, want %+v", target, got, err, want)
		}
	}
	if got, err := c.ResolvePane(t.Context(), server.Socket, "%9999"); err == nil || got != (ports.PaneRef{}) {
		t.Fatalf("missing exact pane resolved: %+v, %v", got, err)
	}
}

func TestResolvePaneRefusesUnusableEvidence(t *testing.T) {
	const socket = "/test/socket"
	for _, output := range []string{"/other/socket\t%1\n", socket + "\t%2\n",
		socket + "\t%1\n" + socket + "\t%3\n", socket + "\t!1\n"} {
		c := Client{Path: "/fixture/tmux", Process: runFunc(func(_ context.Context, _ ports.ProcessSpec) (ports.Bounded, error) {
			return ports.Bounded{Stdout: []byte(output)}, nil
		})}
		if got, err := c.ResolvePane(t.Context(), socket, "%1"); !errors.Is(err, ErrPaneNotFound) || got != (ports.PaneRef{}) {
			t.Errorf("ResolvePane with %q = %+v, %v", output, got, err)
		}
	}
}
