package core

import "testing"

func TestEvaluateBindingEvidence(t *testing.T) {
	identity := Identity{ID: testIdentityID, Name: "Alice", CanonicalName: "alice"}
	binding := Binding{
		ID: "binding-1", IdentityID: identity.ID,
		Server: ServerEvidence{Host: "tmux", ID: "server-1", Socket: "/tmp/tmt.sock", PID: 321, StartTime: "1700000000"},
		PaneID: "%9", PanePID: 654,
	}
	oldStart, newStart := "16300", "16301"
	for _, tc := range []struct {
		name  string
		alter func(*Identity, *Binding, *EndpointProbe)
		want  BindingEvidence
	}{
		{"matching evidence", nil, BindingActive},
		{"rename keeps old marker valid", func(i *Identity, _ *Binding, _ *EndpointProbe) {
			i.Name, i.CanonicalName = "Alicia", "alicia"
		}, BindingActive},
		{"unreachable probe", func(_ *Identity, _ *Binding, p *EndpointProbe) {
			p.State = EndpointProbeUnknown
		}, BindingUnknown},
		{"server known dead", func(_ *Identity, _ *Binding, p *EndpointProbe) {
			p.State = EndpointProbeDead
		}, BindingEndpointLost},
		{"another socket", func(_ *Identity, _ *Binding, p *EndpointProbe) {
			p.Server.Socket = "/tmp/another.sock"
		}, BindingUnknown},
		{"server ID changed on same process", func(_ *Identity, _ *Binding, p *EndpointProbe) {
			p.Server.ID = "server-2"
		}, BindingUnknown},
		{"server PID reused", func(_ *Identity, _ *Binding, p *EndpointProbe) {
			p.Server.StartTime = "1700000100"
		}, BindingEndpointLost},
		{"pane absent", func(_ *Identity, _ *Binding, p *EndpointProbe) {
			p.Panes = nil
		}, BindingEndpointLost},
		{"pane PID changed", func(_ *Identity, _ *Binding, p *EndpointProbe) {
			p.Panes[0].PID++
		}, BindingEndpointLost},
		{"pane PID reused", func(_ *Identity, b *Binding, p *EndpointProbe) {
			b.PaneIncarnation, p.Panes[0].Incarnation = &oldStart, &newStart
		}, BindingEndpointLost},
		{"pane incarnation unknown", func(_ *Identity, b *Binding, _ *EndpointProbe) {
			b.PaneIncarnation = &oldStart
		}, BindingActive},
		{"marker missing", func(_ *Identity, _ *Binding, p *EndpointProbe) {
			p.Panes[0].Marker = nil
		}, BindingMarkerMismatch},
		{"marker claims another binding", func(_ *Identity, _ *Binding, p *EndpointProbe) {
			p.Panes[0].Marker.BindingID = "binding-2"
		}, BindingMarkerMismatch},
		{"marker has inconsistent name", func(_ *Identity, _ *Binding, p *EndpointProbe) {
			p.Panes[0].Marker.CanonicalName = "other"
		}, BindingMarkerMismatch},
	} {
		t.Run(tc.name, func(t *testing.T) {
			i, b := identity, binding
			marker := b.Marker(i)
			probe := EndpointProbe{
				State: EndpointProbeLive, Server: b.Server,
				Panes: []PaneObservation{{ID: b.PaneID, PID: b.PanePID, Marker: &marker}},
			}
			if tc.alter != nil {
				tc.alter(&i, &b, &probe)
			}
			got, pane := EvaluateBinding(i, &b, probe)
			if got != tc.want || (pane != nil) != (tc.want == BindingActive) {
				t.Fatalf("EvaluateBinding = %v, %+v, want %v", got, pane, tc.want)
			}
		})
	}
}
