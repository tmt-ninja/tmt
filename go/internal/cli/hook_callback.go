package cli

import (
	"context"
	"encoding/json/v2"
	"io"
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

// openExistingHookStore keeps native's writer reserve and never creates or
// migrates storage. Capture preparation itself uses its separate zero-wait read.
func openExistingHookStore(ctx context.Context, root home.Root) (*storage.Storage, error) {
	deadline, ok := ctx.Deadline()
	if !ok || ctx.Err() != nil {
		return nil, nil
	}
	wait := min(500*time.Millisecond, time.Until(deadline)-100*time.Millisecond)
	if wait <= 0 {
		return nil, nil
	}
	return storage.OpenExistingCapture(ctx, root, wait)
}

// Provider callbacks have a silent success result so they never veto a turn.
type hookReport struct{}

func (hookReport) Human(io.Writer) error      { return nil }
func (hookReport) JSON() any                  { return struct{}{} }
func (hookReport) HumanStream() output.Stream { return output.Stdout }
func (hookReport) ExitStatus() int            { return 0 }

func (app application) runHook(ctx context.Context, root home.Root, inv invocation) output.Report {
	// NOT PORTED (CLI-29): Provider context and activity outside startup, prompt and Stop.
	if len(inv.operands) != 1 || inv.operands[0] != "claude" || app.caller.lookup == nil || app.stdin == nil {
		return hookReport{}
	}
	raw, _ := app.caller.lookup(hookLaunchEnv)
	launch, ok := decodeHookCoordinates(raw)
	if raw != "" && !ok {
		return hookReport{}
	}
	ctx, cancel := context.WithTimeout(ctx, hookBudget)
	defer cancel()
	deadline, _ := ctx.Deadline()
	const limit = 64 * 1024
	body, err := process.ReadInputStdinFor(app.stdin, limit, time.Until(deadline))
	if err != nil || ctx.Err() != nil {
		return hookReport{}
	}
	if stop, decoded := claude.DecodeStop(body); decoded {
		var scope *core.HookCaptureLaunch
		if ok {
			scope = &core.HookCaptureLaunch{IdentityID: launch.IdentityID, BindingID: launch.BindingID,
				OwnerPID: launch.Owner.PID, OwnerStart: launch.Owner.StartIdentity, StartupInput: launch.StartupInput}
		}
		app.observeClaudeStop(ctx, root, stop, scope, inv.has("activity-only"))
		return hookReport{}
	}
	prompt := claude.PromptSession(body) != ""
	if !ok || inv.has("activity-only") || !prompt && !claude.IsStartupHook(body) {
		return hookReport{}
	}
	claim, probe, failure := app.caller.observe(ctx)
	if failure != nil {
		return hookReport{}
	}

	store := app.store
	if store == nil {
		current, err := openExistingHookStore(ctx, root)
		if err != nil || current == nil {
			return hookReport{}
		}
		defer current.Close()
		store = current
	}
	capture, ok := readHookCapture(ctx, store, &launch, claim, probe)
	if !ok {
		return hookReport{}
	}
	observer := runtime.Observer{Process: process.Runner{}}
	if prompt {
		_, _ = claude.AdmitDigestPrompt(ctx, body, capture, observer, store)
	} else {
		_, _ = claude.AdmitStartup(ctx, body, capture, observer, store)
	}
	return hookReport{}
}

func readHookCapture(ctx context.Context, store ports.Store, launch *hookCoordinates, claim callerClaim,
	probe core.EndpointProbe,
) (claude.StartupCapture, bool) {
	key := core.EndpointKey{Host: probe.Server.Host, ServerID: probe.Server.ID, PaneID: claim.pane.PaneID}
	var capture claude.StartupCapture
	err := store.Read(ctx, func(tx ports.StoreTx) error {
		binding, err := tx.Bindings().FindByEndpoint(key)
		if err != nil || binding == nil || binding.EndpointKey() != key {
			return err
		}
		identity, err := tx.Identities().FindByID(binding.IdentityID)
		if err != nil || identity == nil || identity.ID != binding.IdentityID {
			return err
		}
		var owner core.ProcessIncarnation
		var startupInput bool
		if launch != nil {
			if binding.ID != launch.BindingID || binding.IdentityID != launch.IdentityID {
				return nil
			}
			owner, startupInput = launch.Owner, launch.StartupInput
		} else if binding.Session.LaunchOwner != nil {
			owner = *binding.Session.LaunchOwner
		} else {
			return nil
		}
		capture = claude.StartupCapture{Identity: *identity, Binding: *binding, Probe: probe,
			Owner: owner, StartupInput: startupInput, ObservedAtMs: uint64(time.Now().UnixMilli())}
		return nil
	})
	return capture, err == nil && capture.Binding.ID != ""
}
