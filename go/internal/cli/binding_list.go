//go:build darwin || linux

package cli

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type bindingLocationDocument struct {
	Host    string `json:"host"`
	Session string `json:"session,omitempty"`
	Window  string `json:"window,omitempty"`
}

type bindingPaneDocument struct {
	ID       string                   `json:"id"`
	Command  string                   `json:"command"`
	CWD      string                   `json:"cwd,omitempty"`
	Target   string                   `json:"target,omitempty"`
	Location *bindingLocationDocument `json:"location,omitempty"`
}

func bindingPaneJSON(id string, evidence *ports.PaneEvidence) *bindingPaneDocument {
	value := &bindingPaneDocument{ID: id}
	if evidence != nil {
		value.Command, value.CWD = evidence.Command, evidence.CurrentDir
		value.Location = &bindingLocationDocument{Host: "tmux", Session: evidence.Session, Window: evidence.Window}
	}
	return value
}

type bindingActivityDocument struct {
	State          string         `json:"state"`
	SinceMs        *uint64        `json:"sinceMs"`
	LastActivityMs *uint64        `json:"lastActivityMs"`
	Providers      map[string]any `json:"providers"`
}

type bindingSessionDocument struct {
	Activity     bindingActivityDocument `json:"activity"`
	Unbound      any                     `json:"unbound"`
	Learning     any                     `json:"learning"`
	StartRefusal *string                 `json:"startRefusal"`
}

type bindingPresence struct {
	identity *core.Identity
	binding  *core.Binding
	presence string
	pane     *bindingPaneDocument
	program  *string
	driver   *string
	address  *string
	session  bindingSessionDocument
}

func (b bindingCLI) presence(ctx context.Context, entry bindingEntry) bindingPresence {
	row := bindingPresence{
		identity: entry.identity, binding: entry.binding, presence: "offline",
		session: bindingSessionDocument{Activity: bindingActivityDocument{State: "unknown", Providers: map[string]any{}}},
	}
	if entry.binding == nil {
		return row
	}
	binding := *entry.binding
	row.session.StartRefusal = binding.Session.StartRefusal
	probe := b.recordedProbe(ctx, binding)
	switch state, _ := core.EvaluateBinding(*entry.identity, &binding, probe); state {
	case core.BindingActive:
		ref := ports.PaneRef{Server: binding.Server.Socket, PaneID: binding.PaneID}
		row.presence, row.pane = "active", bindingPaneJSON(binding.PaneID, b.paneDetails(ctx, ref))
		driver, address := binding.Server.Host, binding.Server.Host+":"+binding.PaneID
		row.driver, row.address = &driver, &address
		row.program = binding.Session.PlainProgram
		if binding.Session.RuntimeState == "ended" {
			row.session.Activity.State = "ended"
		}
	case core.BindingEndpointLost:
	default:
		row.presence = "unknown"
	}
	// NOT PORTED (#6938): session preferences, provider activity, and presence reconciliation on list.
	return row
}

type bindingListDocument struct {
	identityDocument
	Presence     string                   `json:"presence"`
	Pane         *string                  `json:"pane"`
	Command      string                   `json:"command"`
	Target       string                   `json:"target,omitempty"`
	CWD          string                   `json:"cwd,omitempty"`
	Location     *bindingLocationDocument `json:"location,omitempty"`
	Session      bindingSessionDocument   `json:"session"`
	PlainProgram *string                  `json:"plainProgram,omitempty"`
	Address      *string                  `json:"address"`
	Driver       *string                  `json:"driver"`
}

func (p bindingPresence) listed() bindingListDocument {
	row := bindingListDocument{
		identityDocument: identityJSON(p.identity), Presence: p.presence, Session: p.session,
		PlainProgram: p.program, Address: p.address, Driver: p.driver,
	}
	if p.pane != nil {
		row.Pane, row.Command, row.Target, row.CWD, row.Location = &p.pane.ID, p.pane.Command, p.pane.Target, p.pane.CWD, p.pane.Location
	}
	return row
}

func (b bindingCLI) whoami(ctx context.Context, inv invocation) output.Report {
	if inv.has("context") {
		// NOT PORTED (#6938): bounded caller context projection.
		return bindingUnavailable("--context")
	}
	claim, failure := b.callerClaim()
	if failure != nil {
		return failure
	}
	if b.host == nil {
		return bindingPaneMissing(claim.pane.PaneID)
	}
	pane := b.paneDetails(ctx, claim.pane)
	probe, err := b.host.ProbeBinding(ctx, claim.pane)
	if err != nil || (probe.State == core.EndpointProbeLive && (probe.Server.PID != claim.serverPID || bindingPane(probe, claim.pane) == nil)) ||
		(probe.State != core.EndpointProbeLive && pane == nil) {
		return callerPaneMissing()
	}
	var identity *core.Identity
	var bound *core.Binding
	state := "unknown"
	if probe.State == core.EndpointProbeLive {
		err = b.store.Read(ctx, func(tx ports.StoreTx) error {
			var err error
			identity, err = verifiedCaller(tx, claim, probe)
			if err != nil || identity == nil {
				return err
			}
			bound, err = tx.Bindings().FindByIdentity(identity.ID)
			if err == nil && bound != nil && bound.Session.RuntimeState == "ended" {
				state = "ended"
			}
			return err
		})
		if err != nil {
			return bindingRejected(err)
		}
		if bound != nil && bound.Session.RuntimeState == "running" && bound.Session.Runtime != nil && b.process != nil {
			process := bound.Session.Runtime
			observed, err := b.process(ctx, int(process.PID))
			if err == nil {
				switch observed.Match(runtime.Incarnation{PID: int(process.PID), Start: process.StartIdentity}) {
				case runtime.Alive:
					state = "running"
				case runtime.Gone:
					state = "ended"
				}
			}
		}
	}
	type sessionDocument struct {
		Unbound any `json:"unbound"`
	}
	var session *sessionDocument
	text := fmt.Sprintf("Pane %s is unbound\n  hint: tmt name <name>\n", claim.pane.PaneID)
	if identity != nil {
		session = &sessionDocument{}
		text = fmt.Sprintf("%s (%s) on pane %s\n", identity.Name, identity.Lifetime, claim.pane.PaneID)
	}
	return bindingReport{document: struct {
		boundIdentityDocument
		Session       *sessionDocument `json:"session,omitempty"`
		InterfaceKind string           `json:"interfaceKind"`
		SessionState  string           `json:"sessionState"`
	}{boundIdentityJSON(identity, claim.pane.PaneID), session, "container", state}, text: text}
}

func (b bindingCLI) list(ctx context.Context, inv invocation) output.Report {
	for _, option := range []string{"room", "detected"} {
		if inv.has(option) {
			// NOT PORTED (#6938): room-scoped lists and the detected-agent projection.
			return bindingUnavailable("--" + option)
		}
	}
	if inv.has("host") && inv.options["host"] != "tmux" {
		return bindingUnavailable("--host " + inv.options["host"])
	}
	if len(inv.operands) > 0 {
		return b.listTarget(ctx, inv.operands[0], b.socket(inv.options["socket"]))
	}
	var here *ports.PaneEvidence
	if inv.has("here") {
		claim, failed := b.callerClaim()
		if failed == nil {
			here = b.paneDetails(ctx, claim.pane)
		}
		if here == nil {
			failure := bindingFailure("PANE_NOT_FOUND", "`tmt ls --here` needs a tmux pane, and this is not one.", 3)
			failure.Suggestion = "Run it inside tmux, or drop --here to list every agent."
			return failure
		}
	}
	var entries []bindingEntry
	err := b.store.Read(ctx, func(tx ports.StoreTx) error {
		identities, err := tx.Identities().List()
		if err != nil {
			return err
		}
		bindings, err := tx.Bindings().List()
		if err != nil {
			return err
		}
		byIdentity := make(map[core.IdentityID]*core.Binding, len(bindings))
		for _, binding := range bindings {
			byIdentity[binding.IdentityID] = &binding
		}
		for _, identity := range identities {
			if (inv.has("saved") && identity.Lifetime != core.LifetimeSaved) ||
				(inv.has("temp") && identity.Lifetime != core.LifetimeTemporary) {
				continue
			}
			entries = append(entries, bindingEntry{identity: &identity, binding: byIdentity[identity.ID]})
		}
		return nil
	})
	if err != nil {
		return bindingRejected(err)
	}
	rows := []bindingListDocument{}
	var text strings.Builder
	var offline []string
	for _, entry := range entries {
		p := b.presence(ctx, entry)
		if here != nil && (p.pane == nil || p.pane.Location == nil || p.pane.Location.Session != here.Session || entry.binding.Server.Socket != here.Pane.Server) {
			continue
		}
		if inv.has("socket") && entry.binding != nil && entry.binding.Server.Socket != inv.options["socket"] {
			continue
		}
		rows = append(rows, p.listed())
		if p.pane == nil && !inv.has("all") {
			offline = append(offline, string(p.identity.Name))
			continue
		}
		pane := "-"
		if p.pane != nil {
			pane = p.pane.ID
		}
		fmt.Fprintf(&text, "%s\t%s\t%s\t%s\n", p.identity.Name, p.identity.Lifetime, p.presence, pane)
	}
	if len(offline) > 0 {
		fmt.Fprintf(&text, "Offline: %s\n", strings.Join(offline, ", "))
	}
	if len(rows) == 0 {
		text.WriteString("No identities.\n")
	}
	return bindingReport{document: struct {
		Identities []bindingListDocument `json:"identities"`
	}{rows}, text: text.String()}
}

func (b bindingCLI) listTarget(ctx context.Context, target, socket string) output.Report {
	var entry bindingEntry
	var asPane bool
	err := b.store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		asPane, err = core.AddressesPane(tx.Identities(), target)
		if err != nil || asPane {
			return err
		}
		entry, err = readBindingEntry(tx, target)
		return err
	})
	if err != nil {
		return bindingRejected(err)
	}
	if asPane {
		return b.listPaneTarget(ctx, target, socket)
	}
	if entry.identity == nil {
		return identityMissing(target)
	}
	row := b.presence(ctx, entry)
	return bindingReport{document: struct {
		Target   string                 `json:"target"`
		Identity identityDocument       `json:"identity"`
		Presence string                 `json:"presence"`
		Pane     *bindingPaneDocument   `json:"pane"`
		Session  bindingSessionDocument `json:"session"`
		Address  *string                `json:"address"`
		Driver   *string                `json:"driver"`
	}{target, identityJSON(row.identity), row.presence, row.pane, row.session, row.address, row.driver},
		text: fmt.Sprintf("%s\n  lifetime: %s\n  presence: %s\n", row.identity.Name, row.identity.Lifetime, row.presence)}
}

func (b bindingCLI) listPaneTarget(ctx context.Context, target, socket string) output.Report {
	ref, failure := b.resolve(ctx, socket, target)
	if failure != nil {
		return failure
	}
	details := b.paneDetails(ctx, ref)
	if details == nil {
		return bindingPaneMissing(target)
	}
	var identity *identityDocument
	probe, err := b.host.ProbeBinding(ctx, ref)
	if err == nil && bindingPane(probe, ref) != nil {
		err := b.store.Read(ctx, func(tx ports.StoreTx) error {
			found, err := verifiedCaller(tx, callerClaim{pane: ref}, probe)
			if err == nil && found != nil {
				document := identityJSON(found)
				identity = &document
			}
			return err
		})
		if err != nil {
			return bindingRejected(err)
		}
	}
	pane := bindingPaneJSON(ref.PaneID, details)
	text := fmt.Sprintf("%s\n  target: %s\n  cwd: %s\n  command: %s\n", pane.ID, pane.Target, pane.CWD, pane.Command)
	if identity == nil {
		text += fmt.Sprintf("  hint: tmt add %s <name>\n", ref.PaneID)
	}
	return bindingReport{document: struct {
		Target   string               `json:"target"`
		Identity *identityDocument    `json:"identity"`
		Pane     *bindingPaneDocument `json:"pane"`
	}{target, identity, pane}, text: text}
}

func bindingShell(command string) bool {
	return slices.Contains([]string{"sh", "bash", "zsh", "fish", "dash", "ksh", "tcsh", "nu"}, strings.TrimPrefix(command, "-"))
}
