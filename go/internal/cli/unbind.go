package cli

import (
	"context"
	"fmt"
	"io"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type unbindReport struct {
	Unbound  bool            `json:"unbound"`
	ID       core.IdentityID `json:"id"`
	Name     core.Name       `json:"name"`
	Pane     string          `json:"pane"`
	Lifetime core.Lifetime   `json:"lifetime"`
	Retired  bool            `json:"retired"`
}

func (r unbindReport) JSON() any                  { return r }
func (r unbindReport) HumanStream() output.Stream { return output.Stdout }
func (r unbindReport) ExitStatus() int            { return 0 }
func (r unbindReport) Human(w io.Writer) error {
	ending := "saved offline"
	if r.Retired {
		ending = "retired"
	}
	return success(w, fmt.Sprintf("Unbound '%s' from pane %s; identity %s", r.Name, r.Pane, ending))
}

func (app application) runUnbind(ctx context.Context, root home.Root) output.Report {
	cli := newBindingCLI(app.store, app.caller.lookup)
	claim, failure := cli.callerClaim()
	if failure != nil {
		return failure
	}
	if cli.host == nil {
		return callerPaneMissing()
	}
	return withIdentityStore(ctx, root, app.store, identityOperationFailure(), func(store ports.Store) output.Report {
		cli.store = store
		return cli.unbind(ctx, claim)
	})
}

func (b bindingCLI) unbind(ctx context.Context, claim callerClaim) output.Report {
	pane := claim.pane
	unbound := bindingFailure("UNBOUND_PANE", "Pane has no active global name.", 1)
	probe, err := b.host.ProbeBinding(ctx, pane)
	if err != nil {
		return callerPaneMissing()
	}
	if probe.State != core.EndpointProbeLive {
		// A newly opened server may have no Go metadata. Confirm the pane
		// without creating an ID or treating incomplete evidence as ownership.
		if b.paneDetails(ctx, pane) == nil {
			return callerPaneMissing()
		}
		var recorded bool
		err := b.store.Read(ctx, func(tx ports.StoreTx) error {
			bindings, err := tx.Bindings().List()
			for _, binding := range bindings {
				if binding.Server.Socket == pane.Server && binding.PaneID == pane.PaneID {
					recorded = true
					break
				}
			}
			return err
		})
		if err != nil || recorded {
			return bindingUnverified()
		}
		return unbound
	}
	if probe.Server.PID != claim.serverPID || bindingPane(probe, pane) == nil {
		return callerPaneMissing()
	}

	var entry bindingEntry
	key := core.EndpointKey{Host: probe.Server.Host, ServerID: probe.Server.ID, PaneID: pane.PaneID}
	err = b.store.Write(ctx, func(tx ports.StoreTx) error {
		var err error
		entry.binding, err = tx.Bindings().FindByEndpoint(key)
		if err != nil {
			return err
		}
		if entry.binding == nil {
			return unbound
		}
		entry.identity, err = tx.Identities().FindByID(entry.binding.IdentityID)
		if err != nil || entry.identity == nil {
			return requiredBindingLookup(err)
		}
		state, observed := core.EvaluateBinding(*entry.identity, entry.binding, probe)
		if state != core.BindingActive || observed == nil || entry.binding.PaneIncarnation == nil {
			return bindingUnverified()
		}
		var changed bool
		if entry.identity.Lifetime == core.LifetimeTemporary {
			changed, err = tx.Identities().Retire(*entry.identity, entry.binding, false, b.now())
		} else {
			changed, err = tx.Bindings().Detach(*entry.binding)
		}
		if err != nil || !changed {
			return requiredBindingLookup(err)
		}
		return nil
	})
	if err != nil {
		return bindingRejected(err)
	}
	// Compare and clear only the exact Go marker. A newer marker may have
	// appeared after the commit and belongs to the newer binding.
	if _, err := b.clearMarker(ctx, *entry.binding, *entry.identity); err != nil {
		return bindingFailure("CLEANUP_ERROR", "Could not clean up command resources. Effects may already have occurred.", 1)
	}
	member := entry.identity
	return unbindReport{true, member.ID, member.Name, pane.PaneID, member.Lifetime, member.Lifetime == core.LifetimeTemporary}
}

func requiredBindingLookup(err error) error {
	if err != nil {
		return err
	}
	return bindingUnverified()
}
