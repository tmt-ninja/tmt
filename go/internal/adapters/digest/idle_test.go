package digest

import (
	"context"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type idleHostFunc func(context.Context, ports.PaneRef) (core.EndpointProbe, error)

func (f idleHostFunc) ProbeBinding(ctx context.Context, ref ports.PaneRef) (core.EndpointProbe, error) {
	return f(ctx, ref)
}

type idleRuntimeFunc func(context.Context, core.Identity, core.Binding, core.EndpointProbe) (runtime.BoundProvider, error)

func (f idleRuntimeFunc) ProveBoundMain(ctx context.Context, id core.Identity, b core.Binding, probe core.EndpointProbe) (runtime.BoundProvider, error) {
	return f(ctx, id, b, probe)
}

func TestIdleGuardRechecksExactLaunchAndContinuation(t *testing.T) {
	for _, state := range []string{"verified", "continuation", "replaced", "different_driver", "lost_during_probe"} {
		t.Run(state, func(t *testing.T) {
			providerSession := "remembered-session"
			launch := core.DigestLaunchFence{
				Driver: core.DriverCodex, ProviderSession: providerSession,
				Expected: core.Binding{ID: "binding", IdentityID: "worker", PaneID: "%5", Server: core.ServerEvidence{Host: "tmux", Socket: "/private/socket"},
					Session: core.BindingSessionState{RuntimeState: "running", ProviderSessionID: &providerSession,
						LaunchOwner: &core.ProcessIncarnation{PID: 123, StartIdentity: "owner"},
						Runtime:     &core.ProcessIncarnation{PID: 456, StartIdentity: "runtime"}}},
			}
			sent, reads, probes := 0, 0, 0
			guard := IdleGuard{
				ReadIdle: func(_ context.Context, id core.IdentityID) (*core.DigestLaunchFence, error) {
					reads++
					if id != "worker" {
						t.Fatalf("read identity %q", id)
					}
					if (reads >= 3 && state == "continuation") || (reads == 2 && state == "lost_during_probe") {
						return nil, nil
					}
					current := launch
					if reads >= 3 && state == "replaced" {
						current.Expected.ID = "replacement"
					}
					return &current, nil
				},
				Host: idleHostFunc(func(_ context.Context, ref ports.PaneRef) (core.EndpointProbe, error) {
					probes++
					if ref.Server != launch.Expected.Server.Socket || ref.PaneID != launch.Expected.PaneID {
						t.Fatalf("unexpected pane %+v", ref)
					}
					return core.EndpointProbe{State: core.EndpointProbeLive}, nil
				}),
				Runtime: idleRuntimeFunc(func(_ context.Context, id core.Identity, b core.Binding, probe core.EndpointProbe) (runtime.BoundProvider, error) {
					if id.ID != launch.Expected.IdentityID || probe.State != core.EndpointProbeLive {
						t.Fatalf("runtime proof got %+v, %+v", id, probe)
					}
					name := string(launch.Driver)
					if state == "different_driver" {
						name = "claude"
					}
					return runtime.BoundProvider{Name: name, Incarnation: runtime.Incarnation{PID: int(b.Session.Runtime.PID), Start: b.Session.Runtime.StartIdentity}}, nil
				}),
				Send: func(_ context.Context, target core.DigestLaunchFence, text string) (ports.DeliveryOutcome, bool, error) {
					sent++
					if target.Expected.ID != launch.Expected.ID || text != "summary" {
						t.Fatalf("wrong delivery: %+v %q", target, text)
					}
					return ports.DeliveryDelivered, true, nil
				},
			}
			idle, err := guard.Prepare(t.Context(), "worker")
			if state == "different_driver" || state == "lost_during_probe" {
				if err != nil || idle != nil || sent != 0 {
					t.Fatalf("unverified launch exposed: %+v, %v, %d", idle, err, sent)
				}
				return
			}
			if err != nil || idle == nil || idle.Launch.Expected.ID != launch.Expected.ID {
				t.Fatalf("no exact launch: %+v, %v", idle, err)
			}
			outcome, started, err := idle.Send(t.Context(), "summary")
			if state == "verified" {
				if err != nil || outcome != ports.DeliveryDelivered || !started || sent != 1 || probes != 2 {
					t.Fatalf("delivery = %v, %v, %v (sent %d, probes %d)", outcome, started, err, sent, probes)
				}
				if outcome, _, _ := idle.Send(t.Context(), "summary"); outcome != ports.DeliveryNotStarted || sent != 1 {
					t.Fatalf("replayed guarded send: %v (sent %d)", outcome, sent)
				}
			} else if err != nil || outcome != ports.DeliveryNotStarted || started || sent != 0 {
				t.Fatalf("lost readiness still delivered: %v, %v, %v (sent %d)", outcome, started, err, sent)
			}
		})
	}
}
