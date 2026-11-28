package digest

import (
	"context"

	"github.com/tmt-ninja/tmt/go/internal/adapters/delivery"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// TmuxIdleGuard supplies the ordinary guarded transport for a verified idle
// launch. The installed channel can prevent pane input at the last boundary.
func TmuxIdleGuard(root home.Root, client tmux.Client, readIdle func(context.Context, core.IdentityID) (*core.DigestLaunchFence, error)) IdleGuard {
	return IdleGuard{
		ReadIdle: readIdle,
		Host:     client,
		Runtime:  runtime.Observer{Process: client.Process},
		Send:     guardedDigestSend(root, client, client.Process),
	}
}

func guardedDigestSend(root home.Root, host delivery.PasteHost, runner ports.Process) func(context.Context, core.DigestLaunchFence, string) (ports.DeliveryOutcome, bool, error) {
	return func(ctx context.Context, launch core.DigestLaunchFence, text string) (ports.DeliveryOutcome, bool, error) {
		b := launch.Expected
		target := delivery.PasteTarget{
			Pane:     ports.PaneRef{Server: b.Server.Socket, PaneID: b.PaneID},
			Binding:  &b,
			Identity: core.Identity{ID: b.IdentityID},
		}
		input := ports.DeliveryInput{Text: text, Submit: drivers.Enter()}
		outcome, _, err := delivery.GuardedPaste(ctx, host, runner, root, target, input)
		// A successful pane submit alone does not confirm a provider turn.
		return outcome, false, err
	}
}
