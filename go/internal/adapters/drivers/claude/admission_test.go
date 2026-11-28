//go:build darwin || linux

package claude

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type activityStore struct {
	ports.Store
	repo      activityRepo
	writes    int
	commitErr error
}

func (s *activityStore) Write(_ context.Context, fn func(ports.StoreTx) error) error {
	s.writes++
	if err := fn(activityTx{repo: &s.repo}); err != nil {
		return err
	}
	return s.commitErr
}

type activityTx struct {
	ports.StoreTx
	repo *activityRepo
}

func (tx activityTx) Bindings() ports.BindingRepo { return tx.repo }

type activityRepo struct {
	ports.BindingRepo
	calls   []ports.LaunchActivityObservation
	prompts []ports.DigestPromptObservation
	ok      bool
	err     error
}

func (r *activityRepo) ObserveLaunchActivity(observation ports.LaunchActivityObservation) (bool, error) {
	r.calls = append(r.calls, observation)
	return r.ok, r.err
}

func (r *activityRepo) ObserveDigestPrompt(observation ports.DigestPromptObservation) (bool, error) {
	r.prompts = append(r.prompts, observation)
	return r.ok, r.err
}

func TestAdmitStartupUsesOneExactCAS(t *testing.T) {
	const start = "ps-v1:Sat Jan 1 00:00:00 2000"
	const payload = `{"hook_event_name":"SessionStart","source":"startup","session_id":"exact-session"}`
	owner := core.ProcessIncarnation{PID: 11, StartIdentity: start}
	child := core.ProcessIncarnation{PID: 20, StartIdentity: start}
	identity := core.Identity{ID: "identity", Name: "member", CanonicalName: "member"}
	paneStart := start
	binding := core.Binding{
		ID: "binding", IdentityID: identity.ID, PaneID: "%3", PanePID: 10, PaneIncarnation: &paneStart,
		Server:  core.ServerEvidence{Host: "tmux", ID: "server", Socket: "/test/socket", PID: 5, StartTime: start},
		Session: core.BindingSessionState{RuntimeState: "unknown"},
	}
	marker := binding.Marker(identity)
	probe := core.EndpointProbe{State: core.EndpointProbeLive, Server: binding.Server,
		Panes: []core.PaneObservation{{ID: binding.PaneID, PID: binding.PanePID, Incarnation: &paneStart, Marker: &marker}}}
	processes := startupProbe{
		main:  runtime.Incarnation{PID: int(child.PID), Start: start},
		owner: runtime.Observation{State: runtime.Alive, Incarnation: runtime.Incarnation{PID: int(owner.PID), Start: start}},
	}
	capture := StartupCapture{Identity: identity, Binding: binding, Probe: probe, Owner: owner, StartupInput: true, ObservedAtMs: 123}
	want := ports.LaunchActivityObservation{Expected: binding, Owner: owner, Runtime: child,
		ProviderSession: "exact-session", Transition: core.LaunchTransitionStarted, InitialIdle: true, ObservedAtMs: 123}
	writerErr := errors.New("writer failure")
	for _, tc := range []struct {
		name       string
		body       string
		change     func(*StartupCapture)
		pid        string
		write      bool
		storeOK    bool
		storeErr   error
		commitErr  error
		transition core.LaunchTransition
		idle       bool
	}{
		{name: "stage pending", body: payload, pid: "20", write: true, storeOK: true, idle: true},
		{name: "stale transaction", body: payload, pid: "20", write: true, idle: true},
		{name: "writer error", body: payload, pid: "20", write: true, storeErr: writerErr, idle: true},
		{name: "commit error", body: payload, pid: "20", write: true, storeOK: true, commitErr: writerErr, idle: true},
		{name: "resume uses typed transition", body: `{"hook_event_name":"SessionStart","source":"resume","session_id":"exact-session"}`,
			pid: "20", write: true, storeOK: true, idle: true, transition: core.LaunchTransitionResumed},
		{name: "initial prompt", body: `{"hook_event_name":"SessionStart","source":"startup","session_id":"exact-session","prompt_id":"prompt"}`,
			pid: "20", write: true, storeOK: true},
		{name: "nested does not reach writer", body: `{"hook_event_name":"SessionStart","source":"startup","session_id":"exact-session","agent_id":null}`, pid: "20"},
		{name: "unverified PID does not reach writer", body: payload, pid: "100"},
		{name: "admitted exact runtime", body: payload, pid: "20", write: true, storeOK: true, idle: true, change: func(c *StartupCapture) {
			session := "exact-session"
			c.Binding.Session = core.BindingSessionState{RuntimeState: "running", Runtime: &child, LaunchOwner: &owner, ProviderSessionID: &session}
		}},
		{name: "already admitted different session", body: payload, pid: "20", change: func(c *StartupCapture) {
			session := "different"
			c.Binding.Session = core.BindingSessionState{RuntimeState: "running", Runtime: &child, LaunchOwner: &owner, ProviderSessionID: &session}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			captured := capture
			if tc.change != nil {
				tc.change(&captured)
			}
			store := &activityStore{repo: activityRepo{ok: tc.storeOK, err: tc.storeErr}, commitErr: tc.commitErr}
			got, err := admitStartup(t.Context(), []byte(tc.body), captured, processes, store, 40, tc.pid, true)
			wantErr := tc.storeErr
			if wantErr == nil {
				wantErr = tc.commitErr
			}
			if got != (tc.storeOK && wantErr == nil) || !errors.Is(err, wantErr) {
				t.Fatalf("admission = %t, %v", got, err)
			}
			if !tc.write {
				if store.writes != 0 || len(store.repo.calls) != 0 {
					t.Fatalf("unverified event reached writer: %+v", store.repo.calls)
				}
				return
			}
			expected := want
			expected.Expected = captured.Binding
			if tc.transition != "" {
				expected.Transition = tc.transition
			}
			expected.InitialIdle = tc.idle
			if store.writes != 1 || len(store.repo.calls) != 1 || !reflect.DeepEqual(store.repo.calls[0], expected) {
				t.Fatalf("transactions = %d, writer calls = %+v, want one %+v", store.writes, store.repo.calls, expected)
			}
		})
	}
}
