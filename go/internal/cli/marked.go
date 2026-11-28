package cli

import (
	"context"
	"reflect"

	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type markedHost interface {
	MarkedPane(context.Context, string) (*tmux.PaneSnapshot, error)
	Discover(context.Context, string, string) (tmux.DiscoveryObservation, error)
}

func (app application) runMarked(ctx context.Context, root home.Root, inv invocation) output.Report {
	b := newBindingCLI(app.store, app.caller.lookup)
	host, ok := b.host.(markedHost)
	if !ok {
		return bindingUnverified()
	}
	socket := b.socket("")
	value, _ := b.lookup("TMUX")
	_, serverPID, _, valid := parseTmuxClaim(value)
	if value != "" && !valid {
		return bindingUnverified()
	}
	mark, err := host.MarkedPane(ctx, socket)
	if err != nil || mark != nil && serverPID != 0 && mark.Server.PID != serverPID {
		return bindingUnverified()
	}
	if mark == nil {
		failure := bindingFailure("MARKED_PANE_NOT_FOUND", "No marked pane was found on the selected tmux server.", 3)
		failure.Suggestion = "Mark the intended pane in tmux, then retry."
		return failure
	}
	return withIdentityStore(ctx, root, app.store, bindingFailure("IDENTITY_ERROR", "Could not open identity storage.", 1), func(store ports.Store) output.Report {
		name, err := core.ValidateName(inv.operands[0])
		if err != nil {
			return bindingRejected(err)
		}
		b.store = store
		entry, failure := b.bind(ctx, mark.Pane, serverPID, bindingSelection{name: name, save: inv.has("save"), frozen: mark})
		if failure != nil {
			return failure
		}
		return bindingSuccess(entry)
	})
}

func (b bindingCLI) stillFrozen(ctx context.Context, frozen tmux.PaneSnapshot, server core.ServerEvidence, pane *core.PaneObservation) bool {
	if frozen.Server.ID == "" {
		frozen.Server.ID = server.ID
	}
	if frozen.Server != server || frozen.Pane.PaneID != pane.ID || frozen.Process.PID != pane.PID ||
		frozen.Process.StartIdentity != *pane.Incarnation || !reflect.DeepEqual(frozen.Marker, pane.Marker) {
		return false
	}
	host, ok := b.host.(markedHost)
	if !ok {
		return false
	}
	seen, err := host.Discover(ctx, frozen.Pane.Server, frozen.Pane.PaneID)
	if err != nil || seen.Truncated || len(seen.Candidates) != 1 {
		return false
	}
	fresh := seen.Candidates[0]
	return fresh.Pane == frozen.Pane && fresh.Server == frozen.Server && fresh.ServerProcess == frozen.ServerProcess &&
		fresh.Process == frozen.Process && !fresh.Linked && fresh.Reason == "" && reflect.DeepEqual(fresh.Marker, frozen.Marker)
}
