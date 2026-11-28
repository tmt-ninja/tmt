package cli

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
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

func (r callerBindingRepo) FindByIdentity(id core.IdentityID) (*core.Binding, error) {
	if id == r.row.IdentityID {
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
	t.Setenv(flavor.EnvHome, t.TempDir())
	ctx := context.Background()
	caller := systemApplication().caller
	pane := ports.PaneRef{Server: server.Socket, PaneID: strings.TrimSpace(server.Run("display-message", "-p", "#{pane_id}"))}
	nativeOption := otherFlavorTMUXOption("agent")
	const nativeMarker = `{"version":1,"native":"preset sentinel"}`
	server.Run("set-option", "-p", "-t", pane.PaneID, nativeOption, nativeMarker)
	client, err := newTmuxClient()
	if err != nil {
		t.Fatal(err)
	}
	serverID, err := client.EnsureServerID(ctx, pane.Server)
	if err != nil {
		t.Fatal(err)
	}
	observed, err := caller.probe(ctx, pane)
	if err != nil || observed.State != core.EndpointProbeLive || len(observed.Panes) != 1 || observed.Panes[0].Incarnation == nil {
		t.Fatalf("private binding probe = %+v, error = %v", observed, err)
	}

	records, identity, other := requestIdentitiesFixture()
	delete(records.records.byID, other.ID)
	paneEvidence := observed.Panes[0]
	binding := core.Binding{
		ID: "fixture-binding", IdentityID: identity.ID, PaneID: pane.PaneID,
		PanePID: paneEvidence.PID, PaneIncarnation: paneEvidence.Incarnation, Server: observed.Server,
	}
	setMarker := func(bindingID core.BindingID) {
		t.Helper()
		marker := fmt.Sprintf(`{"version":1,"globalIdentity":{"name":%q,"canonicalName":%q,"identityId":%q,"bindingId":%q,"serverId":%q,"panePid":%d}}`,
			identity.Name, identity.CanonicalName, identity.ID, bindingID, serverID, binding.PanePID)
		server.Run("set-option", "-p", "-t", pane.PaneID, tmux.AgentOption, marker)
	}
	if published, err := client.PublishBinding(ctx, binding, *identity); err != nil || !published {
		t.Fatalf("publish binding = %t, error = %v", published, err)
	}
	if native := server.Run("show-options", "-p", "-v", "-t", pane.PaneID, nativeOption); native != nativeMarker+"\n" {
		t.Fatalf("native pane marker changed: %q", native)
	}

	env := map[string]string{
		"TMUX": server.Socket + "," + strconv.FormatUint(observed.Server.PID, 10) + ",0", "TMUX_PANE": pane.PaneID,
	}
	caller.lookup = func(key string) (string, bool) { value, ok := env[key]; return value, ok }
	app := application{
		store: callerTestStore{tx: callerTestTx{
			identityTxFake: identityTxFake{records: records.records}, bindings: callerBindingRepo{row: binding},
		}},
		caller: caller,
	}
	implicit := invocation{}
	verify := func(inv invocation, want *core.Identity, code string) {
		t.Helper()
		selected, failure := app.caller.selectIdentity(ctx, inv)
		var got *core.Identity
		if failure == nil {
			got, _, failure = app.requestIdentities(ctx, selected, nil)
		}
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

	setMarker("unrelated-binding")
	verify(implicit, nil, "IDENTITY_REQUIRED")

	env["TMUX"] = server.Socket + "," + strconv.FormatUint(observed.Server.PID+1, 10) + ",0"
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
