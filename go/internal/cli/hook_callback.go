package cli

import (
	"context"
	"encoding/json/v2"
	"io"
	"os"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/claude"
	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const hookLaunchEnv = "TMT_GO_HOOK_LAUNCH"
const hookBudget = 2 * time.Second

type hookCoordinates struct {
	IdentityID   core.IdentityID         `json:"identity_id"`
	BindingID    core.BindingID          `json:"binding_id"`
	Owner        core.ProcessIncarnation `json:"owner"`
	StartupInput bool                    `json:"startup_input,omitempty"`
}

func decodeHookCoordinates(value string) (hookCoordinates, bool) {
	var launch hookCoordinates
	if len(value) == 0 || len(value) > 2048 || json.Unmarshal([]byte(value), &launch, json.RejectUnknownMembers(true)) != nil {
		return hookCoordinates{}, false
	}
	return launch, launch.IdentityID != "" && launch.BindingID != "" && validHookIncarnation(launch.Owner)
}

// Provider callbacks have a silent success result so they never veto a turn.
type hookReport struct{}

func (hookReport) Human(io.Writer) error      { return nil }
func (hookReport) JSON() any                  { return struct{}{} }
func (hookReport) HumanStream() output.Stream { return output.Stdout }
func (hookReport) ExitStatus() int            { return 0 }

func (app application) runHook(ctx context.Context, root home.Root, inv invocation) output.Report {
	// NOT PORTED (#6938): turn activity, provider context and Digest continuation.
	if len(inv.operands) != 1 || inv.operands[0] != "claude" || inv.has("activity-only") || app.caller.lookup == nil {
		return hookReport{}
	}
	raw, _ := app.caller.lookup(hookLaunchEnv)
	launch, ok := decodeHookCoordinates(raw)
	if !ok || app.stdin == nil {
		return hookReport{}
	}
	ctx, cancel := context.WithTimeout(ctx, hookBudget)
	defer cancel()
	deadline, _ := ctx.Deadline()
	const limit = 64 * 1024
	body, err := process.ReadInputStdinFor(app.stdin, limit, time.Until(deadline))
	if err != nil || !claude.IsStartupHook(body) || ctx.Err() != nil {
		return hookReport{}
	}
	claim, probe, failure := app.caller.observe(ctx)
	if failure != nil {
		return hookReport{}
	}

	store := app.store
	if store == nil {
		// A provider callback cannot initialize an empty tmt-go home.
		info, err := os.Lstat(root.Database)
		if err != nil || !info.Mode().IsRegular() {
			return hookReport{}
		}
		current, err := storage.Open(ctx, root)
		if err != nil {
			return hookReport{}
		}
		defer current.Close()
		store = current
	}
	capture, ok := readHookCapture(ctx, store, launch, claim, probe)
	if !ok {
		return hookReport{}
	}
	_, _ = claude.AdmitStartup(ctx, body, capture, runtime.Observer{Process: process.Runner{}}, store)
	return hookReport{}
}

func readHookCapture(ctx context.Context, store ports.Store, launch hookCoordinates, claim callerClaim,
	probe core.EndpointProbe,
) (claude.StartupCapture, bool) {
	key := core.EndpointKey{Host: probe.Server.Host, ServerID: probe.Server.ID, PaneID: claim.pane.PaneID}
	var capture claude.StartupCapture
	err := store.Read(ctx, func(tx ports.StoreTx) error {
		binding, err := tx.Bindings().FindByEndpoint(key)
		if err != nil || binding == nil || binding.ID != launch.BindingID || binding.IdentityID != launch.IdentityID ||
			binding.EndpointKey() != key {
			return err
		}
		identity, err := tx.Identities().FindByID(launch.IdentityID)
		if err != nil || identity == nil || identity.ID != launch.IdentityID {
			return err
		}
		capture = claude.StartupCapture{Identity: *identity, Binding: *binding, Probe: probe,
			Owner: launch.Owner, StartupInput: launch.StartupInput, ObservedAtMs: uint64(time.Now().UnixMilli())}
		return nil
	})
	return capture, err == nil && capture.Binding.ID != ""
}
