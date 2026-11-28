//go:build darwin || linux

package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type bindingHost interface {
	ProbeBinding(context.Context, ports.PaneRef) (core.EndpointProbe, error)
	EnsureServerID(context.Context, string) (string, error)
	PublishBinding(context.Context, core.Binding, core.Identity) (bool, error)
	Panes(context.Context, string) ([]ports.PaneEvidence, error)
	ClearBinding(context.Context, core.Binding, core.Identity) (bool, error)
	ResolvePane(context.Context, string, string) (ports.PaneRef, error)
}

type bindingCLI struct {
	store   ports.Store
	host    bindingHost
	lookup  func(string) (string, bool)
	process func(context.Context, int) (runtime.Observation, error)
	now     func() uint64
}

// runBinding is the invocation boundary for delegated binding commands.
// Host effects are composed outside Store.Read and Store.Write.
func (app application) runBinding(ctx context.Context, root home.Root, inv invocation) (report output.Report) {
	store := app.store
	if store == nil {
		opened, err := storage.Open(ctx, root)
		if err != nil {
			return bindingFailure("IDENTITY_ERROR", "Could not open identity storage.", 1)
		}
		store = opened
		defer func() {
			if err := opened.Close(); err != nil {
				if _, failed := report.(*output.Failure); !failed {
					report = bindingFailure("CLEANUP_ERROR", "Could not clean up command resources. Effects may already have occurred.", 1)
				}
			}
		}()
	}
	cli := newBindingCLI(store, app.caller.lookup)
	return cli.run(ctx, inv)
}

func newBindingCLI(store ports.Store, lookup func(string) (string, bool)) bindingCLI {
	b := bindingCLI{store: store, lookup: lookup, now: func() uint64 { return uint64(wallClock{}.NowMs()) }}
	if b.lookup == nil {
		b.lookup = os.LookupEnv
	}
	if client, err := newTmuxClient(); err == nil {
		b.host = client
		b.process = (runtime.Observer{Process: client.Process}).Observe
	}
	return b
}

func (b bindingCLI) run(ctx context.Context, inv invocation) output.Report {
	switch inv.path[0] {
	case "add", "name":
		return b.bindCommand(ctx, inv)
	case "mv":
		return b.rename(ctx, inv.operands[0], inv.operands[1])
	case "rm":
		return b.remove(ctx, inv.operands[0], inv.has("force"))
	case "whoami":
		return b.whoami(ctx, inv)
	case "ls":
		return b.list(ctx, inv)
	default:
		return bindingFailure("INTERNAL_ERROR", "Unexpected binding command.", 1)
	}
}

func bindingFailure(code, message string, status int) *output.Failure {
	return &output.Failure{Code: code, Message: message, Status: status}
}

func bindingRejected(err error) *output.Failure {
	if err == nil {
		return nil
	}
	var failure *output.Failure
	if errors.As(err, &failure) {
		return failure
	}
	for _, nameError := range []error{core.ErrNameEmptyOrControl, core.ErrNamePaneTarget, core.ErrNameTooLong} {
		if errors.Is(err, nameError) {
			return bindingFailure("INVALID_NAME", nameError.Error(), 1)
		}
	}
	return bindingFailure("RECONCILIATION_FAILED", "Could not update identity state.", 1)
}

func bindingUnverified() *output.Failure {
	return bindingFailure("RECONCILIATION_FAILED", "Could not verify the identity binding. No successful binding change is claimed.", 1)
}

func bindingPaneMissing(target string) *output.Failure {
	return bindingFailure("PANE_NOT_FOUND", fmt.Sprintf("Pane target '%s' was not found.", target), 3)
}

func bindingUnavailable(option string) *output.Failure {
	return bindingFailure("NOT_PORTED", fmt.Sprintf("Binding option %s is not yet ported.", option), 2)
}

type bindingReport struct {
	document any
	text     string
}

func (r bindingReport) JSON() any                  { return r.document }
func (r bindingReport) HumanStream() output.Stream { return output.Stdout }
func (r bindingReport) ExitStatus() int            { return 0 }
func (r bindingReport) Human(w io.Writer) error {
	_, err := io.WriteString(w, r.text)
	return err
}

type boundIdentityDocument struct {
	Bound    bool            `json:"bound"`
	ID       core.IdentityID `json:"id,omitempty"`
	Name     core.Name       `json:"name,omitempty"`
	Pane     string          `json:"pane"`
	Lifetime core.Lifetime   `json:"lifetime,omitempty"`
}

func boundIdentityJSON(identity *core.Identity, pane string) boundIdentityDocument {
	if identity == nil {
		return boundIdentityDocument{Pane: pane}
	}
	return boundIdentityDocument{Bound: true, ID: identity.ID, Name: identity.Name, Pane: pane, Lifetime: identity.Lifetime}
}

func (b bindingCLI) callerClaim() (callerClaim, *output.Failure) {
	tmux, _ := b.lookup("TMUX")
	pane, _ := b.lookup("TMUX_PANE")
	claim, ok := parseCallerClaim(tmux, pane)
	if !ok {
		return callerClaim{}, bindingFailure("PANE_NOT_FOUND", "Not running inside a resolvable tmux pane.", 3)
	}
	return claim, nil
}

func (b bindingCLI) socket(explicit string) string {
	if explicit != "" {
		return explicit
	}
	tmux, _ := b.lookup("TMUX")
	if claim, ok := parseCallerClaim(tmux, "%0"); ok {
		return claim.pane.Server
	}
	root, _ := b.lookup("TMUX_TMPDIR")
	if root == "" {
		root = "/tmp"
	}
	if real, err := filepath.EvalSymlinks(root); err == nil {
		root = real
	}
	return filepath.Join(root, "tmux-"+strconv.Itoa(os.Getuid()), "default")
}

func (b bindingCLI) resolve(ctx context.Context, socket, target string) (ports.PaneRef, *output.Failure) {
	if b.host == nil || !filepath.IsAbs(socket) || !core.IsPaneTarget(target) {
		return ports.PaneRef{}, bindingPaneMissing(target)
	}
	target = core.TargetText(target)
	pane, err := b.host.ResolvePane(ctx, socket, target)
	switch {
	case errors.Is(err, tmux.ErrPaneNotFound):
		return ports.PaneRef{}, bindingPaneMissing(target)
	case err != nil:
		return ports.PaneRef{}, bindingUnverified()
	case pane.Server != socket || pane.PaneID == "":
		return ports.PaneRef{}, bindingPaneMissing(target)
	default:
		return pane, nil
	}
}

func bindingPane(probe core.EndpointProbe, ref ports.PaneRef) *core.PaneObservation {
	if probe.State != core.EndpointProbeLive || probe.Server.Socket != ref.Server || probe.Server.Host != "tmux" {
		return nil
	}
	for _, pane := range probe.Panes {
		if pane.ID == ref.PaneID && pane.PID > 0 && pane.Incarnation != nil {
			return &pane
		}
	}
	return nil
}

func (b bindingCLI) paneDetails(ctx context.Context, ref ports.PaneRef) *ports.PaneEvidence {
	if b.host == nil {
		return nil
	}
	panes, err := b.host.Panes(ctx, ref.Server)
	if err != nil {
		return nil
	}
	for _, pane := range panes {
		if pane.Pane == ref {
			return &pane
		}
	}
	return nil
}

// recordedProbe may prove an endpoint lost from a complete list and a verified
// snapshot of the same socket. An unreachable socket alone proves nothing.
func (b bindingCLI) recordedProbe(ctx context.Context, recorded core.Binding) core.EndpointProbe {
	if b.host == nil || recorded.Server.Host != "tmux" {
		return core.EndpointProbe{}
	}
	ref := ports.PaneRef{Server: recorded.Server.Socket, PaneID: recorded.PaneID}
	probe, err := b.host.ProbeBinding(ctx, ref)
	if err == nil && bindingPane(probe, ref) != nil {
		return probe
	}
	panes, err := b.host.Panes(ctx, ref.Server)
	if err == nil && len(panes) > 0 {
		for _, pane := range panes {
			if pane.Pane == ref {
				return core.EndpointProbe{}
			}
		}
		other, err := b.host.ProbeBinding(ctx, panes[0].Pane)
		if err == nil && bindingPane(other, panes[0].Pane) != nil {
			return other
		}
	}
	if b.process != nil {
		server, err := b.process(ctx, int(recorded.Server.PID))
		if err == nil && server.State == runtime.Gone {
			return core.EndpointProbe{State: core.EndpointProbeDead}
		}
	}
	return core.EndpointProbe{}
}

type bindingEntry struct {
	identity *core.Identity
	binding  *core.Binding
}

func readBindingEntry(tx ports.StoreTx, selector string) (bindingEntry, error) {
	identity, err := core.ResolveIdentity(tx.Identities(), selector)
	if err != nil || identity == nil {
		return bindingEntry{identity: identity}, err
	}
	binding, err := tx.Bindings().FindByIdentity(identity.ID)
	return bindingEntry{identity: identity, binding: binding}, err
}

func (b bindingCLI) findEntry(ctx context.Context, selector string) (bindingEntry, error) {
	var entry bindingEntry
	err := b.store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		entry, err = readBindingEntry(tx, selector)
		return err
	})
	return entry, err
}

func (b bindingCLI) clearMarker(ctx context.Context, binding core.Binding, identity core.Identity) (bool, error) {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	return b.host.ClearBinding(cleanup, binding, identity)
}
