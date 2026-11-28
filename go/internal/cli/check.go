package cli

import (
	"context"
	"fmt"
	"io"
	"reflect"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type checkReport struct {
	Target   string                 `json:"target"`
	Pane     string                 `json:"pane"`
	Lines    uint64                 `json:"lines"`
	Output   string                 `json:"output"`
	Identity *output.TargetIdentity `json:"identity,omitempty"`
}

func (r checkReport) JSON() any                  { return r }
func (r checkReport) HumanStream() output.Stream { return output.Stdout }
func (r checkReport) ExitStatus() int            { return 0 }

func (r checkReport) Human(w io.Writer) error {
	title := fmt.Sprintf("OUTPUT %s %s", clistyle.Escape(r.Target), r.Pane)
	_, err := fmt.Fprintf(w, "%s\n%s\n", outputTerminal(w).Paint(clistyle.TokenTitle, title), r.Output)
	return err
}

func checkLines(inv invocation) (*uint64, string) {
	flagged, failure := optionalDecimal(inv, "lines", 0, core.MaxCaptureLines)
	if failure != "" {
		return nil, failure
	}
	if len(inv.operands) > 1 {
		lines, failure := parseDecimal(inv.operands[1], "--lines", 0, core.MaxCaptureLines)
		return &lines, failure
	}
	if inv.has("lines") {
		return &flagged, ""
	}
	return nil, ""
}

func checkDefaultLines(root home.Root) (uint64, error) {
	settings, err := loadSettings(root)
	if err != nil {
		return 0, err
	}
	return settings["captureLines"].value.(uint64), nil
}

func (app application) check(ctx context.Context, root home.Root, inv invocation) (report output.Report) {
	lines, _ := checkLines(inv)
	if lines == nil {
		value, err := checkDefaultLines(root)
		if err != nil {
			return &output.Failure{Code: "CONFIG_ERROR", Message: "Could not read capture settings.", Status: 1}
		}
		lines = &value
	}
	if app.store == nil {
		store, err := storage.Open(ctx, root)
		if err != nil {
			return &output.Failure{Code: "IDENTITY_ERROR", Message: "Could not open identity storage.", Status: 1}
		}
		app.store = store
		defer func() {
			if err := store.Close(); err != nil {
				if _, failed := report.(*output.Failure); !failed {
					report = &output.Failure{Code: "CLEANUP_ERROR", Message: "Could not clean up command resources. Effects may already have occurred.", Status: 1}
				}
			}
		}()
	}
	target := inv.operands[0]
	var identity *core.Identity
	var binding *core.Binding
	var direct bool
	err := app.store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		records := tx.Identities()
		if inv.has("expect-name") {
			identity, err = records.FindByID(core.IdentityID(target))
		} else {
			if !inv.has("capture-only") {
				direct, err = core.AddressesPane(records, target)
				if direct || err != nil {
					return err
				}
			}
			identity, err = core.ResolveIdentity(records, target)
		}
		if err != nil || identity == nil {
			return err
		}
		binding, err = tx.Bindings().FindByIdentity(identity.ID)
		return err
	})
	if err != nil {
		return &output.Failure{Code: "IDENTITY_ERROR", Message: "Could not read identity storage.", Status: 1}
	}
	if direct {
		return app.checkDirect(ctx, target, *lines)
	}
	if identity == nil {
		return identityMissing(target)
	}
	if failure := checkIdentityPin(inv, identity); failure != nil {
		return failure
	}
	if binding == nil {
		return inactiveCheckTarget(target)
	}

	pane := ports.PaneRef{Server: binding.Server.Socket, PaneID: binding.PaneID}
	if app.caller.probe == nil || binding.Server.Host != "tmux" {
		return checkEndpointFailure()
	}
	probe, err := app.caller.probe(ctx, pane)
	if err != nil || probe.State != core.EndpointProbeLive {
		return checkEndpointFailure()
	}
	state, observed := core.EvaluateBinding(*identity, binding, probe)
	if state != core.BindingActive || observed == nil || binding.PaneIncarnation != nil && observed.Incarnation == nil {
		return inactiveCheckTarget(target)
	}
	if inv.has("expect-name") {
		var fresh *core.Identity
		var freshBinding *core.Binding
		err := app.store.Read(ctx, func(tx ports.StoreTx) error {
			var err error
			fresh, err = tx.Identities().FindByID(identity.ID)
			if err != nil || fresh == nil {
				return err
			}
			freshBinding, err = tx.Bindings().FindByIdentity(identity.ID)
			return err
		})
		if err != nil {
			return &output.Failure{Code: "IDENTITY_ERROR", Message: "Could not read identity storage.", Status: 1}
		}
		if fresh == nil || !reflect.DeepEqual(freshBinding, binding) {
			return &output.Failure{Code: "IDENTITY_CHANGED", Message: "The selected identity changed before capture.", Status: 5}
		}
		if failure := checkIdentityPin(inv, fresh); failure != nil {
			return failure
		}
		identity = fresh
	}
	// NOT PORTED (#6938): ordinary check's idle Digest checklist handoff.
	return app.captureCheck(ctx, target, pane, *lines, identity)
}

func checkIdentityPin(inv invocation, identity *core.Identity) *output.Failure {
	if expected, ok := inv.options["expect-name"]; ok && core.NormalizeName(expected) != identity.CanonicalName {
		return &output.Failure{
			Code: "IDENTITY_CHANGED", Message: fmt.Sprintf("The identity %s is now named '%s', not '%s'.", identity.ID, identity.Name, expected), Status: 5,
		}
	}
	return nil
}

func inactiveCheckTarget(target string) *output.Failure {
	return &output.Failure{Code: "NAME_NOT_FOUND", Message: fmt.Sprintf("Identity '%s' is not active.", target), Status: 3}
}

func checkEndpointFailure() *output.Failure {
	return &output.Failure{Code: "RECONCILIATION_FAILED", Message: "Could not verify the recipient's tmux endpoint.", Status: 1}
}

func (app application) checkDirect(ctx context.Context, target string, lines uint64) output.Report {
	if app.tmux == nil || app.caller.lookup == nil {
		return callerPaneMissing()
	}
	raw, _ := app.caller.lookup("TMUX")
	paneID, _ := app.caller.lookup("TMUX_PANE")
	claim, ok := parseCallerClaim(raw, paneID)
	if !ok {
		return callerPaneMissing()
	}
	client, err := app.tmux()
	if err != nil {
		return checkEndpointFailure()
	}
	pane, err := client.ResolvePane(ctx, claim.pane.Server, target)
	if err != nil {
		return &output.Failure{Code: "PANE_NOT_FOUND", Message: fmt.Sprintf("Pane target '%s' was not found.", target), Status: 3}
	}
	return app.captureCheck(ctx, target, pane, lines, nil)
}

func (app application) captureCheck(ctx context.Context, target string, pane ports.PaneRef, lines uint64, identity *core.Identity) output.Report {
	if app.live.capture == nil {
		return checkEndpointFailure()
	}
	screen, err := app.live.capture(ctx, pane, ports.CaptureOpts{Lines: int(lines)})
	if err != nil || screen.Pane != pane {
		return &output.Failure{Code: "ERROR", Message: fmt.Sprintf("Failed to capture pane %s. Is tmux running?", pane.PaneID), Status: 1}
	}
	result := checkReport{Target: target, Pane: pane.PaneID, Lines: lines, Output: screen.Text}
	if identity != nil {
		result.Identity = &output.TargetIdentity{Name: string(identity.Name), CanonicalName: identity.CanonicalName}
	}
	return result
}
