package delivery

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type pasteHost struct {
	probe core.EndpointProbe
	sent  []ports.DeliveryInput
}

func (h *pasteHost) ProbeBinding(context.Context, ports.PaneRef) (core.EndpointProbe, error) {
	return h.probe, nil
}

func (h *pasteHost) Deliver(_ context.Context, _ ports.PaneRef, input ports.DeliveryInput) (ports.DeliveryOutcome, error) {
	h.sent = append(h.sent, input)
	return ports.DeliveryDelivered, nil
}

type stoppedProcess struct{}

func (stoppedProcess) Run(context.Context, ports.ProcessSpec) (ports.Bounded, error) {
	return ports.Bounded{Stdout: []byte("Sat Jan  1 00:00:00 2000 T\n")}, nil
}

func TestGuardedPasteFollowsEnrollmentThroughBindingChanges(t *testing.T) {
	root := home.Root{Dir: t.TempDir()}
	identity := core.Identity{ID: "20000000-0000-4000-8000-000000000002", Name: "member", CanonicalName: "member"}
	const earlier = "10000000-0000-4000-8000-000000000001"
	const current = "10000000-0000-4000-8000-000000000002"
	inc := "ps-v1:Sat Jan 1 00:00:00 2000"
	server := core.ServerEvidence{Host: "tmux", ID: "serverID", Socket: "/tmp/fixture.sock", PID: 33, StartTime: "42"}
	binding := core.Binding{ID: current, IdentityID: identity.ID, Server: server, PaneID: "%7", PanePID: 1234, PaneIncarnation: &inc}
	marker := binding.Marker(identity)
	host := &pasteHost{probe: core.EndpointProbe{State: core.EndpointProbeLive, Server: server,
		Panes: []core.PaneObservation{{ID: "%7", PID: 1234, Incarnation: &inc, Marker: &marker}},
	}}
	target := PasteTarget{Pane: ports.PaneRef{Server: server.Socket, PaneID: "%7"}, Binding: &binding, Identity: identity}
	input := ports.DeliveryInput{Text: "hello", Submit: []ports.KeyStep{{Key: "Enter"}}}
	if out, _, err := GuardedPaste(t.Context(), host, stoppedProcess{}, root, target, input); err != nil || out != ports.DeliveryDelivered {
		t.Fatalf("unenrolled pane was refused: %v, %v", out, err)
	}
	dir := filepath.Join(root.Dir, "channels")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	record := `{"version":1,"bindingId":"` + earlier + `","identityId":"20000000-0000-4000-8000-000000000002","generation":"30000000-0000-4000-8000-000000000001","launchOwner":{"pid":2000,"start":"ps-v1:Sat Jan 1 00:00:00 2000"},"pane":{"host":"tmux","serverId":"serverID","socketPath":"/tmp/fixture.sock","serverPid":33,"serverStartTime":"42","paneId":"%7","panePid":1234},"claude":null}`
	if err := os.WriteFile(filepath.Join(dir, earlier+".json"), []byte(record), 0600); err != nil {
		t.Fatal(err)
	}
	if out, _, err := GuardedPaste(t.Context(), host, stoppedProcess{}, root, target, input); err == nil || out != ports.DeliveryNotStarted {
		t.Fatalf("paste bypassed old enrollment after rebinding: %v, %v", out, err)
	}
	host.probe.Panes[0].Marker = nil
	target.Binding = nil
	if out, _, err := GuardedPaste(t.Context(), host, stoppedProcess{}, root, target, input); err == nil || out != ports.DeliveryNotStarted {
		t.Fatalf("raw paste bypassed old enrollment: %v, %v", out, err)
	}
	if len(host.sent) != 1 || host.sent[0].Text != input.Text {
		t.Fatalf("terminal calls = %+v", host.sent)
	}
}
