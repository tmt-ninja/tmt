//go:build darwin || linux

package claude

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
)

type activityWriter struct {
	calls []LaunchActivityObservation
	ok    bool
	err   error
}

func (w *activityWriter) ObserveLaunchActivity(_ context.Context, observation LaunchActivityObservation) (bool, error) {
	w.calls = append(w.calls, observation)
	return w.ok, w.err
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
	want := LaunchActivityObservation{ExpectedBinding: binding, Owner: owner, Runtime: child,
		ProviderSession: "exact-session", Transition: "started", InitialIdle: true, ObservedAtMs: 123}
	writerErr := errors.New("writer failure")
	for _, tc := range []struct {
		name     string
		body     string
		change   func(*StartupCapture)
		pid      string
		write    bool
		storeOK  bool
		storeErr error
		idle     bool
	}{
		{name: "stage pending", body: payload, pid: "20", write: true, storeOK: true, idle: true},
		{name: "stale transaction", body: payload, pid: "20", write: true, idle: true},
		{name: "writer error", body: payload, pid: "20", write: true, storeErr: writerErr, idle: true},
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
			w := &activityWriter{ok: tc.storeOK, err: tc.storeErr}
			got, err := admitStartup(t.Context(), []byte(tc.body), captured, processes, w, 40, tc.pid, true)
			if got != tc.storeOK || !errors.Is(err, tc.storeErr) {
				t.Fatalf("admission = %t, %v", got, err)
			}
			if !tc.write {
				if len(w.calls) != 0 {
					t.Fatalf("unverified event reached writer: %+v", w.calls)
				}
				return
			}
			expected := want
			expected.ExpectedBinding = captured.Binding
			expected.InitialIdle = tc.idle
			if len(w.calls) != 1 || !reflect.DeepEqual(w.calls[0], expected) {
				t.Fatalf("writer calls = %+v, want %+v", w.calls, expected)
			}
		})
	}
}
