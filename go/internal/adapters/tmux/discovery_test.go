//go:build darwin || linux

package tmux

import (
	"os/exec"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

func TestPrivateDiscoveryAndMarkedPaneWithoutMetadata(t *testing.T) {
	server := tmuxtest.Start(t)
	path, err := exec.LookPath("tmux")
	if err != nil {
		t.Fatal(err)
	}
	client := Client{Path: path, Process: process.Runner{}}
	ctx := t.Context()
	first := strings.TrimSpace(server.Run("display-message", "-p", "-t", "=t:", "#{pane_id}"))
	second := strings.TrimSpace(server.Run("split-window", "-d", "-P", "-F", "#{pane_id}", "-t", first))
	initial, err := client.Discover(ctx, server.Socket, "")
	if err != nil || len(initial.Candidates) != 2 || initial.Truncated {
		t.Fatalf("discovery = %+v, %v", initial, err)
	}
	for _, pane := range initial.Candidates {
		if pane.Server.ID != "" || pane.Server.Socket != server.Socket || pane.ServerProcess.StartIdentity == "" ||
			pane.Process.StartIdentity == "" || pane.Reason != "" {
			t.Fatalf("uninitialized pane observation = %+v", pane)
		}
	}
	if nothing, err := client.Discover(ctx, server.Socket, "%987654"); err != nil || len(nothing.Candidates) != 0 {
		t.Fatalf("missing exact pane = %+v, %v", nothing, err)
	}
	if pane, err := client.MarkedPane(ctx, server.Socket); err != nil || pane != nil {
		t.Fatalf("mark before selection = %+v, %v", pane, err)
	}
	server.Run("select-pane", "-m", "-t", first)
	mark, err := client.MarkedPane(ctx, server.Socket)
	if err != nil || mark == nil || mark.Pane.PaneID != first {
		t.Fatalf("mark = %+v, %v", mark, err)
	}
	server.Run("select-pane", "-m", "-t", second)
	after, err := client.Discover(ctx, server.Socket, first)
	if err != nil || len(after.Candidates) != 1 || after.Candidates[0].Pane != mark.Pane ||
		after.Candidates[0].Process != mark.Process || after.Candidates[0].ServerProcess != mark.ServerProcess {
		t.Fatalf("first frozen mark changed after marking another pane: %+v, %v", after, err)
	}
	if got := server.Run("show-options", "-s", "-q", "-v", ServerIDOption); strings.TrimSpace(got) != "" {
		t.Fatal("read-only pane evidence initialized a server ID")
	}
	if got := server.Run("show-options", "-p", "-q", "-t", first, "-v", AgentOption); strings.TrimSpace(got) != "" {
		t.Fatal("read-only pane evidence initialized a pane marker")
	}
}
