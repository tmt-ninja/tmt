package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

type callerBindingRepo struct {
	ports.BindingRepo
	row core.Binding
}

func (r callerBindingRepo) FindByEndpoint(key core.EndpointKey) (*core.Binding, error) {
	if key == r.row.EndpointKey() {
		return &r.row, nil
	}
	return nil, nil
}

type callerTestStore struct {
	ports.Store
	tx callerTestTx
}

func (s callerTestStore) Read(_ context.Context, fn func(ports.StoreTx) error) error {
	return fn(s.tx)
}

type callerTestTx struct {
	identityTxFake
	bindings callerBindingRepo
}

func (tx callerTestTx) Bindings() ports.BindingRepo { return tx.bindings }

func TestCallerSelectionWithPrivateTmuxEvidence(t *testing.T) {
	server := tmuxtest.Start(t)
	t.Setenv("TMT_GO_HOME", t.TempDir())
	ctx := context.Background()
	path, err := exec.LookPath("tmux")
	if err != nil {
		t.Fatal(err)
	}
	runner := process.Runner{}
	client := tmux.Client{Process: runner, Path: path}
	observer := runtime.Observer{Process: runner}
	incarnation := func(pid int) string {
		t.Helper()
		observation, err := observer.Observe(ctx, pid)
		if err != nil || observation.State != runtime.Alive || !observation.Incarnation.Valid() {
			t.Fatalf("process %d observation = %+v, error = %v", pid, observation, err)
		}
		return observation.Incarnation.Start
	}

	rawPID := strings.TrimSpace(server.Run("display-message", "-p", "#{pid}"))
	pid, err := strconv.Atoi(rawPID)
	if err != nil || pid <= 0 {
		t.Fatalf("server PID %q: %v", rawPID, err)
	}
	const serverID = "fixture-server"
	server.Run("set-option", "-s", "@tmt.server-id", serverID)
	panes, err := client.Panes(ctx, server.Socket)
	if err != nil || len(panes) != 1 {
		t.Fatalf("expected exactly one fixture pane, got %+v: %v", panes, err)
	}
	pane := panes[0]
	records, identity, other := requestIdentitiesFixture()
	delete(records.records.byID, other.ID)
	paneStart := incarnation(pane.PID)
	binding := core.Binding{
		ID: "fixture-binding", IdentityID: identity.ID, PaneID: pane.Pane.PaneID, PanePID: uint64(pane.PID),
		PaneIncarnation: &paneStart,
		Server: core.ServerEvidence{
			Host: "tmux", ID: serverID, Socket: server.Socket, PID: uint64(pid), StartTime: incarnation(pid),
		},
	}

	setMarker := func(marker core.BindingMarker) {
		t.Helper()
		data, err := json.Marshal(marker)
		if err != nil {
			t.Fatal(err)
		}
		server.Run("set-option", "-p", "-t", pane.Pane.PaneID, "@tmt.agent", string(data))
	}
	setMarker(binding.Marker(*identity))
	env := map[string]string{"TMUX": server.Socket + "," + rawPID + ",0", "TMUX_PANE": pane.Pane.PaneID}
	probe := func(_ context.Context, ref ports.PaneRef) (core.EndpointProbe, error) {
		if ref.Server != server.Socket {
			t.Fatalf("probe escaped fixture socket: %+v", ref)
		}
		observed, err := client.Panes(ctx, ref.Server)
		if err != nil {
			return core.EndpointProbe{}, err
		}
		currentPID, err := strconv.Atoi(strings.TrimSpace(server.Run("display-message", "-p", "#{pid}")))
		if err != nil {
			return core.EndpointProbe{}, err
		}
		currentID := strings.TrimSpace(server.Run("show-options", "-sv", "@tmt.server-id"))
		for _, candidate := range observed {
			if candidate.Pane != ref {
				continue
			}
			rawMarker := server.Run("show-options", "-p", "-qv", "-t", ref.PaneID, "@tmt.agent")
			var marker core.BindingMarker
			if err := json.Unmarshal([]byte(rawMarker), &marker); err != nil {
				return core.EndpointProbe{}, err
			}
			start := incarnation(candidate.PID)
			return core.EndpointProbe{
				State: core.EndpointProbeLive,
				Server: core.ServerEvidence{
					Host: "tmux", ID: currentID, Socket: candidate.Pane.Server,
					PID: uint64(currentPID), StartTime: incarnation(currentPID),
				},
				Panes: []core.PaneObservation{{ID: ref.PaneID, PID: uint64(candidate.PID), Incarnation: &start, Marker: &marker}},
			}, nil
		}
		return core.EndpointProbe{}, fmt.Errorf("fixture pane disappeared")
	}
	app := application{
		store: callerTestStore{tx: callerTestTx{
			identityTxFake: identityTxFake{records: records.records}, bindings: callerBindingRepo{row: binding},
		}},
		caller: callerSelector{
			lookup: func(key string) (string, bool) { value, ok := env[key]; return value, ok },
			probe:  probe,
		},
	}
	implicit := invocation{}
	verify := func(inv invocation, want *core.Identity, code string) {
		t.Helper()
		got, _, failure := app.requestIdentities(ctx, inv, nil)
		if got != want || failureCode(failure) != code {
			t.Fatalf("selected %+v with %v, want %+v and %s", got, failure, want, code)
		}
	}
	verify(implicit, identity, "")
	app.requests = incomingFake{inbox: func(query core.InboxQuery) (core.InboxPage, error) {
		if query.Recipient != identity.ID {
			t.Fatalf("inbox received identity %q, want %q", query.Recipient, identity.ID)
		}
		return core.InboxPage{}, nil
	}}
	assertResponse(t, app, []string{"inbox", "--json"}, 0, map[string]any{
		"identity": map[string]any{"id": string(identity.ID), "name": "Worker", "canonicalName": "worker", "lifetime": "saved"},
		"items":    []any{},
		"more":     false,
	})

	marker := binding.Marker(*identity)
	marker.BindingID = "unrelated-binding"
	setMarker(marker)
	verify(implicit, nil, "IDENTITY_REQUIRED")

	env["TMUX"] = server.Socket + "," + strconv.Itoa(pid+1) + ",0"
	verify(implicit, nil, "PANE_NOT_FOUND")
	delete(env, "TMUX")
	delete(env, "TMUX_PANE")
	verify(implicit, nil, "IDENTITY_REQUIRED")

	app.caller.probe = func(context.Context, ports.PaneRef) (core.EndpointProbe, error) {
		t.Fatal("explicit identity probed caller host")
		return core.EndpointProbe{}, nil
	}
	verify(invocation{options: map[string]string{"identity": "worker"}}, identity, "")
}

func failureCode(failure *output.Failure) string {
	if failure == nil {
		return ""
	}
	return failure.Code
}
