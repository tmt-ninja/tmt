//go:build darwin || linux

package claude

import (
	"context"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
)

type startupProbe struct {
	main  runtime.Incarnation
	owner runtime.Observation
}

func (p startupProbe) MainInPane(context.Context, int, int, string) (runtime.Incarnation, error) {
	return p.main, nil
}

func (p startupProbe) Observe(context.Context, int) (runtime.Observation, error) {
	return p.owner, nil
}

func TestClaudeInitialIdleRequiresExactLiveManagedLaunch(t *testing.T) {
	const stamp = "ps-v1:Sat Jan 1 00:00:00 2000"
	const payload = `{"hook_event_name":"SessionStart","source":"startup","session_id":"provider-session"}`
	for _, test := range []struct {
		name   string
		change func(*core.Binding, *core.EndpointProbe, *startupProbe)
		body   string
		input  bool
		pid    string
		want   bool
	}{
		{"verified", nil, payload, true, "20", true},
		{"old provider without PID", nil, payload, true, "", true},
		{"wrong reported PID", nil, payload, true, "40", false},
		{"prompt launch", nil, payload, false, "20", false},
		{"hook contains prompt marker", nil, strings.TrimSuffix(payload, "}") + `,"prompt_id":null}`, true, "20", false},
		{"hook contains agent marker", nil, strings.TrimSuffix(payload, "}") + `,"agent_id":null}`, true, "20", false},
		{"compaction is not startup", nil, strings.Replace(payload, "startup", "compact", 1), true, "20", false},
		{"wrong session", nil, strings.Replace(payload, "provider-session", "other", 1), true, "20", false},
		{"pane marker lost", func(_ *core.Binding, p *core.EndpointProbe, _ *startupProbe) { p.Panes[0].Marker = nil }, payload, true, "20", false},
		{"pane incarnation unknown", func(_ *core.Binding, p *core.EndpointProbe, _ *startupProbe) { p.Panes[0].Incarnation = nil }, payload, true, "20", false},
		{"binding is ended", func(b *core.Binding, _ *core.EndpointProbe, _ *startupProbe) { b.Session.RuntimeState = "ended" }, payload, true, "20", false},
		{"runtime was reused", func(_ *core.Binding, _ *core.EndpointProbe, s *startupProbe) {
			s.main.Start = "ps-v1:Sun Jan 2 00:00:00 2000"
		}, payload, true, "20", false},
		{"launch owner ended", func(_ *core.Binding, _ *core.EndpointProbe, s *startupProbe) { s.owner.State = runtime.Gone }, payload, true, "20", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			session, start := "provider-session", stamp
			identity := core.Identity{ID: "identity", Name: "member", CanonicalName: "member"}
			binding := core.Binding{
				ID: "binding", IdentityID: identity.ID, PaneID: "%3", PanePID: 10, PaneIncarnation: &start,
				Server: core.ServerEvidence{Host: "tmux", ID: "server", Socket: "/test/socket", PID: 5, StartTime: stamp},
				Session: core.BindingSessionState{
					RuntimeState: "running", ProviderSessionID: &session,
					Runtime:     &core.ProcessIncarnation{PID: 20, StartIdentity: stamp},
					LaunchOwner: &core.ProcessIncarnation{PID: 11, StartIdentity: stamp},
				},
			}
			marker := binding.Marker(identity)
			probe := core.EndpointProbe{State: core.EndpointProbeLive, Server: binding.Server,
				Panes: []core.PaneObservation{{ID: binding.PaneID, PID: binding.PanePID, Incarnation: &start, Marker: &marker}}}
			running := startupProbe{main: runtime.Incarnation{PID: 20, Start: stamp},
				owner: runtime.Observation{State: runtime.Alive, Incarnation: runtime.Incarnation{PID: 11, Start: stamp}}}
			if test.change != nil {
				test.change(&binding, &probe, &running)
			}
			got, err := checkInitialIdle(t.Context(), []byte(test.body), test.input, identity, binding, probe, running, 40, test.pid, test.pid != "")
			if err != nil || got != test.want {
				t.Fatalf("readiness = %t, %v; want %t", got, err, test.want)
			}
		})
	}
}
