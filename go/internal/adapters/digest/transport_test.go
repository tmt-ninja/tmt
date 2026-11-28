package digest

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type digestPasteHost struct {
	probe core.EndpointProbe
	pane  ports.PaneRef
	input ports.DeliveryInput
	calls int
}

func (h *digestPasteHost) ProbeBinding(context.Context, ports.PaneRef) (core.EndpointProbe, error) {
	return h.probe, nil
}

func (h *digestPasteHost) Deliver(_ context.Context, pane ports.PaneRef, input ports.DeliveryInput) (ports.DeliveryOutcome, error) {
	h.calls++
	h.pane, h.input = pane, input
	return ports.DeliveryDelivered, nil
}

func TestDigestSendUsesLastBoundaryBindingCheck(t *testing.T) {
	root := home.Root{Dir: t.TempDir()}
	identity := core.Identity{ID: "worker", Name: "Worker", CanonicalName: "worker"}
	incarnation := "observed-pane"
	server := core.ServerEvidence{Host: "tmux", ID: "server", Socket: filepath.Join(root.Dir, "tmux.sock"), PID: 42, StartTime: "server-start"}
	binding := core.Binding{ID: "saved-binding", IdentityID: identity.ID, Server: server, PaneID: "%1", PanePID: 51, PaneIncarnation: &incarnation}
	marker := binding.Marker(identity)
	host := &digestPasteHost{probe: core.EndpointProbe{State: core.EndpointProbeLive, Server: server,
		Panes: []core.PaneObservation{{ID: binding.PaneID, PID: binding.PanePID, Incarnation: &incarnation, Marker: &marker}}}}
	send := guardedDigestSend(root, host, nil)
	launch := core.DigestLaunchFence{Expected: binding, Driver: core.DriverCodex}
	const text = "you have 3 messages, 1 urgent: tmt-go inbox"
	outcome, started, err := send(t.Context(), launch, text)
	if err != nil || outcome != ports.DeliveryDelivered || started || host.calls != 1 ||
		host.pane != (ports.PaneRef{Server: server.Socket, PaneID: binding.PaneID}) ||
		!reflect.DeepEqual(host.input, ports.DeliveryInput{Text: text, Submit: []ports.KeyStep{{Key: "Enter"}}}) {
		t.Fatalf("verified paste = %v, %v, %v, host %+v", outcome, started, err, host)
	}
	marker.BindingID = "replacement"
	outcome, started, err = send(t.Context(), launch, text)
	if err == nil || outcome != ports.DeliveryNotStarted || started || host.calls != 1 {
		t.Fatalf("replaced binding reached tmux input: %v, %v, %v, calls %d", outcome, started, err, host.calls)
	}
}
