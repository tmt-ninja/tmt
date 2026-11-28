package cli

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

func TestDiscoverAndMarkedOnPrivateTmux(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	server := tmuxtest.Start(t)
	caller := strings.TrimSpace(server.Run("display-message", "-p", "#{pane_id}"))
	peer := strings.TrimSpace(server.Run("new-window", "-d", "-P", "-F", "#{pane_id}", "-t", "t:", "cat"))
	pid := strings.TrimSpace(server.Run("display-message", "-p", "#{pid}"))
	world := t.TempDir()
	root := home.Root{Dir: world, Database: filepath.Join(world, home.DatabaseName)}
	claim := server.Socket + "," + pid + ",0"
	app := application{caller: callerSelector{lookup: func(k string) (string, bool) {
		return claim, k == "TMUX"
	}}}
	run := func(args ...string) output.Report {
		t.Helper()
		inv, failure := parse(append(args, "--json"))
		if failure != nil {
			t.Fatalf("parse %v: %+v", args, failure)
		}
		if args[0] == "marked" {
			return app.runMarked(t.Context(), root, inv)
		}
		return app.runDiscover(t.Context(), root, inv)
	}
	fails := func(result output.Report, status int, code string) *output.Failure {
		t.Helper()
		failure, ok := result.(*output.Failure)
		if !ok || failure.Status != status || failure.Code != code {
			t.Fatalf("want %s/%d, got %#v", code, status, result.JSON())
		}
		return failure
	}
	failure := fails(run("marked", "Missing"), 3, "MARKED_PANE_NOT_FOUND")
	if failure.Message != "No marked pane was found on the selected tmux server." ||
		failure.Suggestion != "Mark the intended pane in tmux, then retry." {
		t.Fatalf("unexpected missing-mark diagnostic: %+v", failure)
	}
	find := func(report discoveryReport, pane string) discoveryRow {
		t.Helper()
		for _, row := range report.Candidates {
			if row.Pane == pane {
				return row
			}
		}
		t.Fatalf("missing pane %s in %+v", pane, report)
		return discoveryRow{}
	}
	initial := run("discover", "--socket", server.Socket).(discoveryReport)
	if initial.Version != 1 || initial.Truncated || initial.Sources[0].Status != "ok" || len(initial.Candidates) != 2 {
		t.Fatalf("initial inventory: %+v", initial)
	}
	for _, candidate := range initial.Candidates {
		if candidate.State != "unknown" || candidate.Identity != nil || !candidate.Adoptable ||
			candidate.Expect == nil || len(*candidate.Expect) != 64 {
			t.Fatalf("unmarked row: %+v", candidate)
		}
	}
	if _, err := os.Stat(root.Database); !os.IsNotExist(err) {
		t.Fatalf("read-only commands created state: %v", err)
	}
	if got := strings.TrimSpace(server.Run("show-options", "-svq", tmux.ServerIDOption)); got != "" {
		t.Fatalf("discovery initialized the private server ID")
	}

	foreign := tmuxtest.Start(t)
	foreignPane := strings.TrimSpace(foreign.Run("display-message", "-p", "#{pane_id}"))
	foreign.Run("select-pane", "-t", foreignPane, "-m")
	server.Run("select-pane", "-t", peer, "-m")
	fails(run("marked", "bad\x7f"), 1, "INVALID_NAME")
	first := bindingTestJSON(t, run("marked", "Reviewer"))
	if first["bound"] != true || first["pane"] != peer || first["lifetime"] != "temporary" {
		t.Fatalf("marked selection: %+v", first)
	}
	if metadata := strings.TrimSpace(foreign.Run("show-options", "-pqv", "-t", foreignPane, tmux.AgentOption)); metadata != "" {
		t.Fatalf("marked wrote metadata to the unselected server")
	}
	saved := bindingTestJSON(t, run("marked", "Reviewer", "--save"))
	if saved["id"] != first["id"] || saved["pane"] != peer || saved["lifetime"] != "saved" {
		t.Fatalf("marked promotion: %+v", saved)
	}
	fails(run("marked", "Other"), 5, "PANE_ALREADY_BOUND")
	if mark := strings.TrimSpace(server.Run("list-panes", "-a", "-f", "#{pane_marked}", "-F", "#{pane_id}")); mark != peer {
		t.Fatalf("marked cleared or moved the mark: %q", mark)
	}
	server.Run("select-pane", "-t", caller, "-m")
	fails(run("marked", "Reviewer"), 5, "NAME_ALREADY_ACTIVE")

	after := run("discover", "--host", "tmux", "--socket", server.Socket).(discoveryReport)
	known := find(after, peer)
	oldUnbound, newUnbound := find(initial, caller), find(after, caller)
	if known.State != "known" || known.Identity == nil || !known.Adoptable || newUnbound.Expect == nil ||
		*newUnbound.Expect != *oldUnbound.Expect {
		t.Fatalf("ownership annotation or server initialization fence: %+v, %+v", known, newUnbound)
	}
	claim = server.Socket + ".missing," + pid + ",0"
	fails(run("marked", "Elsewhere"), 1, "RECONCILIATION_FAILED")
	offline := run("discover", "--socket", server.Socket+".missing").(discoveryReport)
	if len(offline.Candidates) != 0 || !offline.Truncated || offline.Sources[0].Status != "offline" ||
		offline.Sources[0].Reason == nil || *offline.Sources[0].Reason != "Could not execute tmux operation (tmux exit 1)." {
		t.Fatalf("unavailable source: %+v", offline)
	}
}

type publishMarkedHost struct {
	tmux.Client
	beforePublish func()
}

func (h publishMarkedHost) PublishBinding(ctx context.Context, target core.Binding, identity core.Identity) (bool, error) {
	h.beforePublish()
	return h.Client.PublishBinding(ctx, target, identity)
}

func TestMarkedKeepsFrozenPaneAcrossMarkMoveAndRefusesVanishedPane(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	server := tmuxtest.Start(t)
	first := strings.TrimSpace(server.Run("new-window", "-d", "-P", "-F", "#{pane_id}", "-t", "t:", "cat"))
	second := strings.TrimSpace(server.Run("new-window", "-d", "-P", "-F", "#{pane_id}", "-t", "t:", "cat"))
	b := newBindingCLI(bindingCommandStore(t), nil)
	host := b.host.(tmux.Client)
	bind := func(pane, name string, mutate func()) (bindingEntry, *output.Failure) {
		t.Helper()
		mark := strings.TrimSpace(server.Run("list-panes", "-a", "-f", "#{pane_marked}", "-F", "#{pane_id}"))
		if mark != pane {
			server.Run("select-pane", "-t", pane, "-m")
		}
		frozen, err := host.MarkedPane(t.Context(), server.Socket)
		if err != nil || frozen == nil {
			t.Fatalf("mark %s: %+v, %v", pane, frozen, err)
		}
		validated, err := core.ValidateName(name)
		if err != nil {
			t.Fatal(err)
		}
		b.host = publishMarkedHost{host, mutate}
		return b.bind(t.Context(), frozen.Pane, frozen.Server.PID, bindingSelection{name: validated, frozen: frozen})
	}
	entry, failure := bind(first, "Frozen", func() { server.Run("select-pane", "-t", second, "-m") })
	if failure != nil || entry.binding == nil || entry.binding.PaneID != first {
		t.Fatalf("moved mark changed target: %+v, %+v", entry, failure)
	}
	_, failure = bind(second, "Vanished", func() { server.Run("kill-pane", "-t", second) })
	if failure == nil || failure.Code != "RECONCILIATION_FAILED" {
		t.Fatalf("vanishing pane was bound: %+v", failure)
	}
	err := b.store.Read(t.Context(), func(tx ports.StoreTx) error {
		entries, err := tx.Bindings().List()
		if err == nil && (len(entries) != 1 || entries[0].PaneID != first) {
			t.Errorf("unexpected durable bindings: %+v", entries)
		}
		if err != nil {
			return err
		}
		vanished, err := tx.Identities().FindByCanonicalName("vanished")
		if err == nil && vanished == nil {
			t.Error("a failed publication discarded the active identity")
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestDiscoveryDigestMatchesSharedNativeVectors(t *testing.T) {
	type fields struct {
		Name, Host, Socket, ServerStartTime, ServerStartIdentity, ServerID string
		Pane, PaneStartIdentity, Runtime, Expect                           string
		ServerPID, PanePID                                                 uint64
		Marker                                                             *core.BindingMarker
	}
	type vectorBlock struct {
		Base            json.RawMessage
		Vectors         []json.RawMessage
		ExternalVectors *vectorBlock
	}
	var fixture struct{ DigestFence vectorBlock }
	raw, err := os.ReadFile("../../../contracts/discovery-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.DigestFence.ExternalVectors == nil || len(fixture.DigestFence.Vectors) == 0 ||
		len(fixture.DigestFence.ExternalVectors.Vectors) == 0 {
		t.Fatal("missing native discovery digest vectors")
	}
	for _, block := range []vectorBlock{fixture.DigestFence, *fixture.DigestFence.ExternalVectors} {
		for _, raw := range block.Vectors {
			var v fields
			if err := json.Unmarshal(block.Base, &v); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(raw, &v); err != nil {
				t.Fatal(err)
			}
			pane := tmux.PaneSnapshot{Pane: ports.PaneRef{Server: v.Socket, PaneID: v.Pane},
				Server:        core.ServerEvidence{Host: v.Host, StartTime: v.ServerStartTime, ID: v.ServerID},
				ServerProcess: core.ProcessIncarnation{PID: v.ServerPID, StartIdentity: v.ServerStartIdentity},
				Process:       core.ProcessIncarnation{PID: v.PanePID, StartIdentity: v.PaneStartIdentity}, Marker: v.Marker}
			if got := discoveryDigest(pane, v.Runtime); got != v.Expect {
				t.Errorf("%s: digest = %s, want %s", v.Name, got, v.Expect)
			}
		}
	}
}
