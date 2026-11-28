//go:build darwin || linux

package cli

import (
	"context"
	"fmt"
	"io"
	"os"
	"reflect"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const bindingLeaseMs = 10_000

type bindingSelection struct {
	name       core.ValidatedName
	id         core.IdentityID
	save       bool
	autoNamed  bool
	renameAuto bool
}

func (b bindingCLI) bindCommand(ctx context.Context, inv invocation) output.Report {
	selection := bindingSelection{save: inv.has("save"), renameAuto: inv.path[0] == "name"}
	var ref ports.PaneRef
	var callerPID uint64
	var rawName string
	if selection.renameAuto {
		claim, failure := b.callerClaim()
		if failure != nil {
			return failure
		}
		ref, callerPID, rawName = claim.pane, claim.serverPID, inv.operands[0]
	} else {
		if inv.has("expect") || inv.has("identity") {
			// NOT PORTED (CLI-05): Discovery-guarded add.
			return bindingUnavailable("--expect/--identity")
		}
		if len(inv.operands) < 2 {
			// NOT PORTED (CLI-06): Exact marked-pane selection.
			return bindingUnavailable("marked pane selection")
		}
		target := inv.operands[0]
		rawName = inv.operands[1]
		if !core.IsPaneTarget(target) && core.IsPaneTarget(rawName) {
			failure := bindingFailure("LEGACY_ADD_ORDER", "The v4 add argument order is no longer supported.", 1)
			failure.Suggestion = fmt.Sprintf("Use: tmt add %s %s", core.CommandWord(rawName), core.CommandWord(target))
			return failure
		}
		var failure *output.Failure
		ref, failure = b.resolve(ctx, b.socket(inv.options["socket"]), target)
		if failure != nil {
			return failure
		}
	}
	name, err := core.ValidateName(rawName)
	if err != nil {
		return bindingRejected(err)
	}
	selection.name = name
	entry, failure := b.bind(ctx, ref, callerPID, selection)
	if failure != nil {
		return failure
	}
	return bindingReport{
		document: boundIdentityJSON(entry.identity, entry.binding.PaneID),
		render: func(w io.Writer) error {
			return success(w, fmt.Sprintf("Bound %s identity '%s' on pane %s", entry.identity.Lifetime, entry.identity.Name, entry.binding.PaneID))
		},
	}
}

// bind is shared by add/name and the run composition. The supplied reference
// is an exact pane on an explicit socket. callerPID is set for a caller claim.
func (b bindingCLI) bind(ctx context.Context, ref ports.PaneRef, callerPID uint64, selected bindingSelection) (bindingEntry, *output.Failure) {
	if b.host == nil || b.process == nil || b.paneDetails(ctx, ref) == nil {
		return bindingEntry{}, bindingPaneMissing(ref.PaneID)
	}
	serverID, err := b.host.EnsureServerID(ctx, ref.Server)
	if err != nil {
		return bindingEntry{}, bindingUnverified()
	}
	probe, err := b.host.ProbeBinding(ctx, ref)
	pane := bindingPane(probe, ref)
	if err != nil || pane == nil || probe.Server.ID != serverID || (callerPID != 0 && probe.Server.PID != callerPID) {
		return bindingEntry{}, bindingUnverified()
	}
	key := core.EndpointKey{Host: "tmux", ServerID: probe.Server.ID, PaneID: ref.PaneID}
	var existing bindingEntry
	var occupant bindingEntry
	err = b.store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		existing, err = readBindingSelection(tx, selected)
		if err != nil {
			return err
		}
		occupant.binding, err = tx.Bindings().FindByEndpoint(key)
		if err != nil || occupant.binding == nil {
			return err
		}
		occupant.identity, err = tx.Identities().FindByID(occupant.binding.IdentityID)
		return err
	})
	if err != nil {
		return bindingEntry{}, bindingRejected(err)
	}
	if selected.id != "" && existing.identity == nil {
		return bindingEntry{}, identityMissing(string(selected.id))
	}
	if occupant.binding != nil {
		if occupant.identity == nil {
			return bindingEntry{}, bindingUnverified()
		}
		state, _ := core.EvaluateBinding(*occupant.identity, occupant.binding, probe)
		if state == core.BindingActive {
			if selected.renameAuto && occupant.identity.AutoNamed {
				if existing.identity != nil && existing.identity.ID != occupant.identity.ID {
					return bindingEntry{}, bindingNameTaken(selected.name.DisplayName())
				}
				return b.reuseBinding(ctx, occupant, selected, key, true)
			}
			if existing.identity != nil && occupant.identity.ID == existing.identity.ID {
				return b.reuseBinding(ctx, occupant, selected, key, false)
			}
			return bindingEntry{}, bindingFailure("PANE_ALREADY_BOUND", "Pane is already bound to another name.", 5)
		}
		// An unfamiliar marker or changed pane is not permission to adopt it.
		return bindingEntry{}, bindingUnverified()
	}
	if pane.Marker != nil {
		// NOT PORTED (CLI-09): Reclaiming orphaned and legacy pane metadata.
		return bindingEntry{}, bindingUnverified()
	}
	if existing.binding != nil {
		switch state, _ := core.EvaluateBinding(*existing.identity, existing.binding, b.recordedProbe(ctx, *existing.binding)); state {
		case core.BindingActive:
			return bindingEntry{}, bindingFailure("NAME_ALREADY_ACTIVE", "Name is already active on another pane.", 5)
		case core.BindingEndpointLost:
			if existing.identity.Lifetime == core.LifetimeTemporary {
				return bindingEntry{}, bindingUnverified()
			}
		default:
			return bindingEntry{}, bindingUnverified()
		}
	}
	publisher, err := b.process(ctx, os.Getpid())
	if err != nil || publisher.State != runtime.Alive || !publisher.Incarnation.Valid() {
		return bindingEntry{}, bindingUnverified()
	}
	now := b.now()
	expires, ok := core.CheckedDeadline(now, bindingLeaseMs)
	if !ok {
		return bindingEntry{}, bindingUnverified()
	}
	reservation := core.BindingReservation{
		Target: core.Binding{
			ID: core.BindingID(talkUUID()), Server: probe.Server, PaneID: pane.ID, PanePID: pane.PID,
			PaneIncarnation: pane.Incarnation,
		},
		Publisher:   core.ProcessIncarnation{PID: uint64(publisher.Incarnation.PID), StartIdentity: publisher.Incarnation.Start},
		CreatedAtMs: now, ExpiresAtMs: expires,
	}
	if existing.binding != nil {
		reservation.OldBindingID = &existing.binding.ID
	}
	var identity *core.Identity
	err = b.store.Write(ctx, func(tx ports.StoreTx) error {
		current, err := readBindingSelection(tx, selected)
		if err != nil {
			return err
		}
		if !sameBindingEntryForCLI(existing, current) || (selected.autoNamed && current.identity != nil) {
			return bindingUnverified()
		}
		identity = current.identity
		if identity == nil {
			id := core.IdentityID(talkUUID())
			lifetime := core.LifetimeTemporary
			if selected.save {
				lifetime = core.LifetimeSaved
			}
			if err := tx.Identities().Insert(core.Identity{
				ID: id, Name: selected.name.DisplayName(), CanonicalName: selected.name.CanonicalName(),
				Lifetime: lifetime, AutoNamed: selected.autoNamed,
			}, now); err != nil {
				return err
			}
			identity, err = tx.Identities().FindByID(id)
			if err != nil || identity == nil {
				return bindingUnverified()
			}
		} else if selected.save && identity.Lifetime == core.LifetimeTemporary {
			identity, err = promoteBindingIdentity(tx, identity.ID, now)
			if err != nil {
				return err
			}
		}
		reservation.Target.IdentityID = identity.ID
		for _, read := range []func() (*core.BindingReservation, error){
			func() (*core.BindingReservation, error) { return tx.Bindings().FindReservationByIdentity(identity.ID) },
			func() (*core.BindingReservation, error) { return tx.Bindings().FindReservationByEndpoint(key) },
		} {
			stored, err := read()
			if err != nil {
				return err
			}
			if stored != nil && now >= stored.ExpiresAtMs {
				if _, err := tx.Bindings().ReleaseReservation(*stored); err != nil {
					return err
				}
			}
		}
		reserved, err := tx.Bindings().Reserve(reservation, current.binding)
		if err != nil {
			return err
		}
		if !reserved {
			return bindingUnverified()
		}
		return nil
	})
	if err != nil {
		return bindingEntry{}, bindingRejected(err)
	}
	return b.publishBinding(ctx, *identity, reservation, existing.binding)
}

func readBindingSelection(tx ports.StoreTx, selected bindingSelection) (bindingEntry, error) {
	var identity *core.Identity
	var err error
	if selected.id != "" {
		identity, err = tx.Identities().FindByID(selected.id)
	} else {
		identity, err = tx.Identities().FindByCanonicalName(selected.name.CanonicalName())
	}
	if err != nil || identity == nil {
		return bindingEntry{identity: identity}, err
	}
	binding, err := tx.Bindings().FindByIdentity(identity.ID)
	return bindingEntry{identity: identity, binding: binding}, err
}

func sameBindingEntryForCLI(a, b bindingEntry) bool {
	return reflect.DeepEqual(a.identity, b.identity) && reflect.DeepEqual(a.binding, b.binding)
}

func (b bindingCLI) publishBinding(ctx context.Context, identity core.Identity, reservation core.BindingReservation, old *core.Binding) (bindingEntry, *output.Failure) {
	target := reservation.Target
	published, err := b.host.PublishBinding(ctx, target, identity)
	if err != nil || !published {
		b.compensateBinding(ctx, reservation, identity, err != nil)
		return bindingEntry{}, bindingUnverified()
	}
	ref := ports.PaneRef{Server: target.Server.Socket, PaneID: target.PaneID}
	probe, err := b.host.ProbeBinding(ctx, ref)
	state, _ := core.EvaluateBinding(identity, &target, probe)
	if err != nil || bindingPane(probe, ref) == nil || state != core.BindingActive {
		b.compensateBinding(ctx, reservation, identity, true)
		return bindingEntry{}, bindingUnverified()
	}
	var result bindingEntry
	err = b.store.Write(ctx, func(tx ports.StoreTx) error {
		fresh, err := tx.Identities().FindByID(identity.ID)
		if err != nil {
			return err
		}
		if fresh == nil {
			return bindingUnverified()
		}
		binding, err := tx.Bindings().Activate(reservation, old, b.now())
		if err != nil {
			return err
		}
		if binding == nil {
			return bindingUnverified()
		}
		result = bindingEntry{identity: fresh, binding: binding}
		return nil
	})
	if err != nil {
		b.compensateBinding(ctx, reservation, identity, true)
		return bindingEntry{}, bindingRejected(err)
	}
	return result, nil
}

func (b bindingCLI) compensateBinding(ctx context.Context, reservation core.BindingReservation, identity core.Identity, maybePublished bool) {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	if maybePublished {
		target := reservation.Target
		ref := ports.PaneRef{Server: target.Server.Socket, PaneID: target.PaneID}
		probe, err := b.host.ProbeBinding(cleanup, ref)
		pane := bindingPane(probe, ref)
		if err != nil || pane == nil {
			return
		}
		if pane.Marker != nil && pane.Marker.BindingID == target.ID {
			cleared, err := b.clearMarker(cleanup, target, identity)
			if err != nil || !cleared {
				return
			}
		}
	}
	// A stale reservation cannot be released if a later owner replaced it.
	_ = b.store.Write(cleanup, func(tx ports.StoreTx) error {
		_, err := tx.Bindings().ReleaseReservation(reservation)
		return err
	})
}

func promoteBindingIdentity(tx ports.StoreTx, id core.IdentityID, now uint64) (*core.Identity, error) {
	if err := tx.Identities().Promote(id, now); err != nil {
		return nil, err
	}
	identity, err := tx.Identities().FindByID(id)
	if err == nil && identity == nil {
		return nil, bindingUnverified()
	}
	return identity, err
}

func (b bindingCLI) reuseBinding(ctx context.Context, observed bindingEntry, selected bindingSelection, key core.EndpointKey, rename bool) (bindingEntry, *output.Failure) {
	identity := observed.identity
	now := b.now()
	err := b.store.Write(ctx, func(tx ports.StoreTx) error {
		current, err := tx.Identities().FindByID(identity.ID)
		if err != nil {
			return err
		}
		if current == nil || *current != *identity {
			return bindingUnverified()
		}
		reservation, err := tx.Bindings().FindReservationByEndpoint(key)
		if err != nil {
			return err
		}
		if reservation != nil {
			return bindingUnverified()
		}
		ok, err := tx.Bindings().Touch(*observed.binding, now)
		if err != nil {
			return err
		}
		if !ok {
			return bindingUnverified()
		}
		if rename {
			identity, err = renameBindingIdentity(tx, *identity, selected.name, now)
			if err != nil {
				return err
			}
		}
		if selected.save && identity.Lifetime == core.LifetimeTemporary {
			identity, err = promoteBindingIdentity(tx, identity.ID, now)
		}
		return err
	})
	if err != nil {
		return bindingEntry{}, bindingRejected(err)
	}
	if rename {
		_, _ = b.host.PublishBinding(ctx, *observed.binding, *identity)
	}
	return bindingEntry{identity: identity, binding: observed.binding}, nil
}

func bindingNameTaken(name core.Name) *output.Failure {
	return bindingFailure("NAME_ALREADY_ACTIVE", fmt.Sprintf("Another identity is already named '%s'.", name), 5)
}

func renameBindingIdentity(tx ports.StoreTx, current core.Identity, name core.ValidatedName, now uint64) (*core.Identity, error) {
	owner, err := tx.Identities().FindByCanonicalName(name.CanonicalName())
	if err != nil {
		return nil, err
	}
	if owner != nil && owner.ID != current.ID {
		return nil, bindingNameTaken(name.DisplayName())
	}
	renamed, err := tx.Identities().Rename(current, name, now)
	if err == nil && renamed == nil {
		return nil, bindingUnverified()
	}
	return renamed, err
}

func (b bindingCLI) rename(ctx context.Context, selector, change string) output.Report {
	name, err := core.ValidateName(change)
	if err != nil {
		return bindingRejected(err)
	}
	var entry bindingEntry
	var renamed *core.Identity
	err = b.store.Write(ctx, func(tx ports.StoreTx) error {
		var err error
		entry, err = readBindingEntry(tx, selector)
		if err != nil {
			return err
		}
		if entry.identity == nil {
			return identityMissing(selector)
		}
		renamed, err = renameBindingIdentity(tx, *entry.identity, name, b.now())
		return err
	})
	if err != nil {
		return bindingRejected(err)
	}
	changed := renamed.Name != entry.identity.Name
	type refresh struct {
		ID      string `json:"id"`
		Updated bool   `json:"updated"`
	}
	var pane *refresh
	if changed && entry.binding != nil {
		probe := b.recordedProbe(ctx, *entry.binding)
		if state, _ := core.EvaluateBinding(*entry.identity, entry.binding, probe); state == core.BindingActive {
			ok, _ := b.host.PublishBinding(ctx, *entry.binding, *renamed)
			pane = &refresh{ID: entry.binding.PaneID, Updated: ok}
		}
	}
	return bindingReport{document: struct {
		Renamed      bool             `json:"renamed"`
		PreviousName core.Name        `json:"previousName"`
		Identity     identityDocument `json:"identity"`
		Pane         *refresh         `json:"pane"`
	}{changed, entry.identity.Name, identityJSON(renamed), pane}, render: func(w io.Writer) error {
		if changed {
			return success(w, fmt.Sprintf("Renamed %s to %s", entry.identity.Name, renamed.Name))
		}
		_, err := fmt.Fprintf(w, "%s already has this name\n", clistyle.Escape(string(renamed.Name)))
		return err
	}}
}

func (b bindingCLI) remove(ctx context.Context, selector string, force bool) output.Report {
	entry, err := b.findEntry(ctx, selector)
	if err != nil {
		return bindingRejected(err)
	}
	if entry.identity == nil {
		return identityMissing(selector)
	}
	identity, binding := *entry.identity, entry.binding
	if identity.Lifetime == core.LifetimeSaved && !force {
		return bindingFailure("CONFIRMATION_REQUIRED", "Saved identity removal requires --force. Its role and preamble will be removed; exchanges are retained.", 5)
	}
	var active bool
	if binding != nil {
		probe := b.recordedProbe(ctx, *binding)
		state, _ := core.EvaluateBinding(identity, binding, probe)
		active = state == core.BindingActive
		if state == core.BindingUnknown || state == core.BindingMarkerMismatch {
			return bindingFailure("AGENT_RUNNING", fmt.Sprintf("%s's host could not be observed, so TMT cannot tell whether its agent ended. Nothing was removed; retry once the host is reachable.", identity.Name), 5)
		}
		if active {
			if failure := b.checkRemovable(ctx, identity, *binding); failure != nil {
				return failure
			}
		}
	}
	err = b.store.Write(ctx, func(tx ports.StoreTx) error {
		changed, err := tx.Identities().Retire(identity, binding, true, b.now())
		if err != nil {
			return err
		}
		if !changed {
			return bindingFailure("IDENTITY_CONFLICT", "The identity's binding changed before it was removed. Nothing was removed.", 5)
		}
		return nil
	})
	if err != nil {
		return bindingRejected(err)
	}
	if active {
		if _, err := b.clearMarker(ctx, *binding, identity); err != nil {
			return bindingFailure("CLEANUP_ERROR", "Could not clean up command resources. Effects may already have occurred.", 1)
		}
	}
	return bindingReport{document: struct {
		Removed  bool             `json:"removed"`
		Identity identityDocument `json:"identity"`
	}{true, identityJSON(&identity)}, render: func(w io.Writer) error {
		return success(w, fmt.Sprintf("Removed identity '%s'; exchanges are retained", identity.Name))
	}}
}

func (b bindingCLI) checkRemovable(ctx context.Context, identity core.Identity, binding core.Binding) *output.Failure {
	unproven := func() *output.Failure {
		return bindingFailure("AGENT_RUNNING", fmt.Sprintf("%s's agent is suspended or could not be observed, so it cannot be proven ended; exit it in its pane, then remove. Nothing was removed.", identity.Name), 5)
	}
	running := func() *output.Failure {
		return bindingFailure("AGENT_RUNNING", fmt.Sprintf("%s's agent is still running; stop it first with tmt stop %s or quit it in its pane, then remove. Nothing was removed.", identity.Name, core.CommandWord(string(identity.Name))), 5)
	}
	if recorded := binding.Session.Runtime; binding.Session.RuntimeState == "running" && recorded != nil {
		if b.process == nil {
			return unproven()
		}
		observed, err := b.process(ctx, int(recorded.PID))
		if err != nil {
			return unproven()
		}
		switch observed.Match(runtime.Incarnation{PID: int(recorded.PID), Start: recorded.StartIdentity}) {
		case runtime.Alive:
			return running()
		case runtime.Gone:
			return nil
		default:
			return unproven()
		}
	}
	pane := b.paneDetails(ctx, ports.PaneRef{Server: binding.Server.Socket, PaneID: binding.PaneID})
	if pane == nil {
		return unproven()
	}
	if !bindingShell(pane.Command) {
		return running()
	}
	return nil
}
