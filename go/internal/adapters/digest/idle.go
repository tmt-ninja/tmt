package digest

import (
	"context"
	"reflect"
	"sync/atomic"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type IdleHost interface {
	ProbeBinding(context.Context, ports.PaneRef) (core.EndpointProbe, error)
}

type IdleRuntime interface {
	ProveBoundMain(context.Context, core.Identity, core.Binding, core.EndpointProbe) (runtime.BoundProvider, error)
}

// IdleGuard checks both the stored idle session and its live foreground
// placement. ReadIdle must return nil when a provider continuation is open.
// Send is the guarded Digest transport for the supplied exact launch.
type IdleGuard struct {
	ReadIdle func(context.Context, core.IdentityID) (*core.DigestLaunchFence, error)
	Host     IdleHost
	Runtime  IdleRuntime
	Send     func(context.Context, core.DigestLaunchFence, string) (ports.DeliveryOutcome, bool, error)
}

// Prepare pins the launch for the durable claim and rechecks it before delivery.
func (g IdleGuard) Prepare(ctx context.Context, id core.IdentityID) (*IdleDelivery, error) {
	launch, err := g.verified(ctx, id)
	if launch == nil || err != nil {
		return nil, err
	}
	var used atomic.Bool
	return &IdleDelivery{
		Launch: *launch,
		Send: func(ctx context.Context, text string) (ports.DeliveryOutcome, bool, error) {
			if used.Swap(true) {
				return ports.DeliveryNotStarted, false, nil
			}
			fresh, err := g.verified(ctx, id)
			if err != nil || !reflect.DeepEqual(fresh, launch) {
				return ports.DeliveryNotStarted, false, err
			}
			return g.Send(ctx, *fresh, text)
		},
	}, nil
}

func (g IdleGuard) verified(ctx context.Context, id core.IdentityID) (*core.DigestLaunchFence, error) {
	launch, err := g.ReadIdle(ctx, id)
	if err != nil || launch == nil {
		return nil, err
	}
	b := launch.Expected
	session := b.Session
	if b.IdentityID != id || b.Server.Host != "tmux" || b.Server.Socket == "" ||
		session.RuntimeState != "running" || session.Runtime == nil || session.LaunchOwner == nil ||
		session.ProviderSessionID == nil || *session.ProviderSessionID != launch.ProviderSession || launch.ProviderSession == "" ||
		!launch.Driver.Valid() || session.PlainProgram != nil {
		return nil, nil
	}
	probe, err := g.Host.ProbeBinding(ctx, ports.PaneRef{Server: b.Server.Socket, PaneID: b.PaneID})
	if err != nil {
		return nil, err
	}
	// Binding ownership is keyed on the saved UUID. Renaming a member leaves
	// its existing marker valid.
	provider, err := g.Runtime.ProveBoundMain(ctx, core.Identity{ID: id}, b, probe)
	if err != nil || provider.Name != string(launch.Driver) ||
		uint64(provider.Incarnation.PID) != session.Runtime.PID || provider.Incarnation.Start != session.Runtime.StartIdentity {
		return nil, err
	}
	fresh, err := g.ReadIdle(ctx, id)
	if err != nil || !reflect.DeepEqual(fresh, launch) {
		return nil, err
	}
	return launch, ctx.Err()
}
