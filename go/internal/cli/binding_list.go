//go:build darwin || linux

package cli

import (
	"context"
	"fmt"
	"io"
	"slices"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
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
	// NOT PORTED (CLI-10): Remembered sessions, provider activity and presence reconciliation.
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
		// NOT PORTED (CLI-13): Bounded caller context.
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
	if identity != nil {
		session = &sessionDocument{}
	}
	return bindingReport{document: struct {
		boundIdentityDocument
		Session       *sessionDocument `json:"session,omitempty"`
		InterfaceKind string           `json:"interfaceKind"`
		SessionState  string           `json:"sessionState"`
	}{boundIdentityJSON(identity, claim.pane.PaneID), session, "container", state}, render: func(w io.Writer) error {
		if identity != nil {
			_, err := fmt.Fprintf(w, "%s (%s) on pane %s\n", identity.Name, identity.Lifetime, claim.pane.PaneID)
			return err
		}
		if _, err := fmt.Fprintf(w, "Pane %s is unbound\n", claim.pane.PaneID); err != nil {
			return err
		}
		return clistyle.WriteHint(w, outputTerminal(w), "tmt-go name <name>")
	}}
}

func (b bindingCLI) list(ctx context.Context, inv invocation) output.Report {
	for _, option := range []string{"room", "detected"} {
		if inv.has(option) {
			// NOT PORTED (CLI-11, CLI-12): Room-scoped lists and detected-agent projection.
			return bindingUnavailable("--" + option)
		}
	}
	if inv.has("host") && inv.options["host"] != "tmux" {
		// NOT PORTED (CLI-12): Discovery on non-tmux hosts.
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
	rows := []bindingPresence{}
	for _, entry := range entries {
		p := b.presence(ctx, entry)
		if here != nil && (p.pane == nil || p.pane.Location == nil || p.pane.Location.Session != here.Session || entry.binding.Server.Socket != here.Pane.Server) {
			continue
		}
		if inv.has("socket") && entry.binding != nil && entry.binding.Server.Socket != inv.options["socket"] {
			continue
		}
		rows = append(rows, p)
	}
	userHome, _ := b.lookup("HOME")
	return bindingListReport{rows: rows, all: inv.has("all"), home: userHome}
}

type bindingListReport struct {
	rows []bindingPresence
	all  bool
	home string
}

func (r bindingListReport) JSON() any {
	rows := make([]bindingListDocument, 0, len(r.rows))
	for _, row := range r.rows {
		rows = append(rows, row.listed())
	}
	return struct {
		Identities []bindingListDocument `json:"identities"`
	}{rows}
}
func (r bindingListReport) HumanStream() output.Stream { return output.Stdout }
func (r bindingListReport) ExitStatus() int            { return 0 }

func (r bindingListReport) Human(w io.Writer) error {
	term := outputTerminal(w)
	if len(r.rows) == 0 {
		if _, err := fmt.Fprintln(w, "No identities found."); err != nil {
			return err
		}
		return clistyle.WriteHint(w, term, "tmt-go name <name>")
	}
	rows := slices.Clone(r.rows)
	slices.SortFunc(rows, func(a, b bindingPresence) int {
		return strings.Compare(a.identity.CanonicalName, b.identity.CanonicalName)
	})
	var sections []clistyle.ListSection
	for _, lifetime := range []core.Lifetime{core.LifetimeSaved, core.LifetimeTemporary} {
		table := clistyle.NewTable(clistyle.ColumnFixed, clistyle.ColumnName, clistyle.ColumnFixed, clistyle.ColumnDetail)
		var offline []string
		count := 0
		for _, row := range rows {
			if row.identity.Lifetime != lifetime {
				continue
			}
			count++
			if row.pane == nil && !r.all {
				offline = append(offline, string(row.identity.Name))
				continue
			}
			row.writeListRow(table, r.home)
		}
		if count > 0 {
			section := clistyle.ListSection{Title: string(lifetime), Count: &count, Rows: table}
			if len(offline) > 0 {
				section.Note = "offline: " + strings.Join(offline, " · ")
			}
			sections = append(sections, section)
		}
	}
	return clistyle.WriteList(w, term, sections)
}

func (p bindingPresence) writeListRow(table *clistyle.Table, userHome string) {
	mark := p.mark()
	address, cwd := "-", ""
	if p.pane != nil {
		address = clistyle.Address(p.binding.Server.Host, p.pane.ID)
		cwd = clistyle.HomePath(p.pane.CWD, userHome)
	}
	cells := []clistyle.Cell{
		{Text: mark.Symbol(), Token: mark.Token()},
		{Text: string(p.identity.Name)},
		{Text: address, Token: clistyle.TokenDim},
		{Text: cwd},
	}
	if mark == clistyle.MarkIdle {
		table.AddAction("shell", cells...)
	} else {
		table.AddRow(cells...)
	}
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
		render: row.writeDetail}
}

func (p bindingPresence) mark() clistyle.Mark {
	if p.pane == nil {
		return clistyle.MarkOffline
	}
	if (p.binding != nil && p.binding.Session.RuntimeState == "running") || !bindingShell(p.pane.Command) {
		return clistyle.MarkRunning
	}
	return clistyle.MarkIdle
}

func (p bindingPresence) writeDetail(w io.Writer) error {
	address, pane, target, cwd, command := "-", "-", "-", "-", "-"
	if p.address != nil {
		address = *p.address
	}
	if p.pane != nil {
		pane, target, cwd, command = p.pane.ID, detailValue(p.pane.Target), detailValue(p.pane.CWD), p.pane.Command
	}
	fields := []clistyle.DetailField{
		{Label: "lifetime", Value: string(p.identity.Lifetime)},
		{Label: "state", Value: p.mark().Symbol() + " " + p.presence},
		{Label: "address", Value: address},
		{Label: "pane", Value: pane},
		{Label: "target", Value: target},
		{Label: "cwd", Value: cwd},
		{Label: "command", Value: command},
	}
	return clistyle.WriteDetail(w, outputTerminal(w), string(p.identity.Name), fields)
}

func detailValue(text string) string {
	if text == "" {
		return "-"
	}
	return text
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
	return bindingReport{document: struct {
		Target   string               `json:"target"`
		Identity *identityDocument    `json:"identity"`
		Pane     *bindingPaneDocument `json:"pane"`
	}{target, identity, pane}, render: func(w io.Writer) error {
		if identity != nil {
			member := &core.Identity{ID: identity.ID, Name: identity.Name, CanonicalName: identity.CanonicalName, Lifetime: identity.Lifetime}
			return (bindingPresence{identity: member, pane: pane, presence: "active"}).writeDetail(w)
		}
		term := outputTerminal(w)
		fields := []clistyle.DetailField{
			{Label: "target", Value: detailValue(pane.Target)},
			{Label: "cwd", Value: detailValue(pane.CWD)},
			{Label: "command", Value: pane.Command},
		}
		if err := clistyle.WriteDetail(w, term, pane.ID, fields); err != nil {
			return err
		}
		return clistyle.WriteHint(w, term, fmt.Sprintf("tmt-go add %s <name>", pane.ID))
	}}
}

func bindingShell(command string) bool {
	return slices.Contains([]string{"sh", "bash", "zsh", "fish", "dash", "ksh", "tcsh", "nu"}, strings.TrimPrefix(command, "-"))
}
