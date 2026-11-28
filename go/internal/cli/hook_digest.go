package cli

import (
	"context"
	"encoding/json/v2"
	"errors"
	"io"
	"os"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/digest"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/claude"
	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/invoke"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type hookDigestStore interface {
	ports.Store
	ports.DigestStore
	ports.CaptureStore
}

func (app application) openDigestStore(ctx context.Context, root home.Root) (hookDigestStore, func(), error) {
	if app.store != nil {
		store, _ := app.store.(hookDigestStore)
		return store, func() {}, nil
	}
	store, err := openExistingHookStore(ctx, root)
	if err != nil || store == nil {
		return nil, nil, err
	}
	return store, func() { _ = store.Close() }, nil
}

// runDigestHook is the hidden provider callback. Only a supervised worker
// reads and claims the checklist. Only its parent can publish to the provider.
func (app application) runDigestHook(ctx context.Context, root home.Root, inv invocation, stdout io.Writer) int {
	if len(inv.operands) != 1 || inv.operands[0] != "claude" || app.stdin == nil {
		return 0
	}
	out, ok := stdout.(*os.File)
	if !ok {
		return 0
	}
	launch, ok := decodeDigestHookLaunch(inv)
	budget := digestHookBudget(inv.options["work-budget-ms"])
	if !ok || budget <= 0 {
		return 0
	}
	ctx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	deadline, _ := ctx.Deadline()
	body, err := process.ReadInputStdinFor(app.stdin, 64*1024, time.Until(deadline))
	if err != nil || ctx.Err() != nil {
		return 0
	}
	stop, ok := claude.DecodeStop(body)
	if !ok || !stop.CanOfferDigest {
		return 0
	}
	if inv.has("worker") {
		if err := app.prepareClaudeDigestHandoff(ctx, root, out, stop, launch); err != nil {
			return 1
		}
		return 0
	}
	executable, err := os.Executable()
	if err != nil {
		return 0
	}
	env := invoke.OverlayEnv(os.Environ(), []string{home.EnvHome + "=" + root.Dir})
	handoff, err := runClaudeDigestWorker(ctx, process.Runner{}, executable, env, body, launch)
	if err != nil || handoff == nil {
		return 0
	}
	store, closeStore, err := app.openDigestStore(ctx, root)
	if err != nil || store == nil {
		return 0
	}
	defer closeStore()
	claim := digest.ClaimedChecklist{
		Batch: core.DigestChecklist{IdentityID: handoff.Launch.IdentityID, ID: handoff.ChecklistID, AttemptToken: handoff.AttemptToken},
		Text:  handoff.Digest,
	}
	write := func(ctx context.Context, body []byte) (int, error) {
		return process.WriteHandoff(ctx, out, body)
	}
	recheck := func(ctx context.Context) bool {
		_, main, err := app.proveClaudeStop(ctx, store, stop, &handoff.Launch, process.Runner{})
		return err == nil && main.PID != 0
	}
	_ = publishClaudeDigest(ctx, store, claim, recheck, write, hookNowMs)
	return 0
}

func (app application) prepareClaudeDigestHandoff(ctx context.Context, root home.Root, out *os.File, stop claude.Stop,
	launch *core.HookCaptureLaunch,
) error {
	runner, err := process.SupervisedProbes()
	if err != nil {
		return err
	}
	if app.tmux == nil {
		return errors.New("Claude Digest worker requires a host probe")
	}
	client, err := app.tmux()
	if err != nil {
		return err
	}
	client.Process = runner
	app.caller.probe = client.ProbeBinding
	store, closeStore, err := app.openDigestStore(ctx, root)
	if err != nil || store == nil {
		return err
	}
	defer closeStore()
	capture, main, err := app.proveClaudeStop(ctx, store, stop, launch, runner)
	if err != nil || main.PID == 0 {
		return err
	}
	if claude.HasSetupStopObserver() {
		committed, err := recordClaudeStop(ctx, store, capture, stop, main)
		if err != nil || !committed {
			return err
		}
	}
	claim, err := digest.ClaimChecklist(ctx, store, digest.ClaimInput{
		IdentityID: capture.Identity.ID, Opportunity: core.DigestOpportunityTurnBoundary,
		Launch:          &core.DigestLaunchFence{Expected: capture.Binding, ProviderSession: stop.Session, Driver: core.DriverClaude},
		RequireFirstFit: true, NowMs: hookNowMs(),
	})
	if err != nil || claim == nil {
		return err
	}
	handoff := hookDigestHandoff{
		Launch: core.HookCaptureLaunch{IdentityID: capture.Identity.ID, BindingID: capture.Binding.ID,
			OwnerPID: capture.Owner.PID, OwnerStart: capture.Owner.StartIdentity, StartupInput: capture.StartupInput},
		ChecklistID: claim.Batch.ID, AttemptToken: claim.Batch.AttemptToken, Digest: claim.Text,
	}
	bytes, err := json.Marshal(handoff)
	if err != nil {
		return err
	}
	_, err = process.WriteHandoff(ctx, out, bytes)
	return err
}

// observeClaudeStop completes an ordinary or continuation Stop without
// producing provider stdout. The full observer owns final capture if setup
// has installed it; the launch-only observer can still record idle evidence.
func (app application) observeClaudeStop(ctx context.Context, root home.Root, stop claude.Stop,
	launch *core.HookCaptureLaunch, activityOnly bool,
) {
	store, closeStore, err := app.openDigestStore(ctx, root)
	if err != nil || store == nil {
		return
	}
	defer closeStore()
	capture, main, err := app.proveClaudeStop(ctx, store, stop, launch, process.Runner{})
	if err != nil || main.PID == 0 {
		return
	}
	if activityOnly {
		if claude.HasSetupStopObserver() {
			return
		}
		stop.Final = nil
	}
	_, _ = recordClaudeStop(ctx, store, capture, stop, main)
}

func (app application) proveClaudeStop(ctx context.Context, store ports.Store, stop claude.Stop, scope *core.HookCaptureLaunch,
	runner ports.Process,
) (claude.StartupCapture, core.ProcessIncarnation, error) {
	claim, probe, failure := app.caller.observe(ctx)
	if failure != nil {
		return claude.StartupCapture{}, core.ProcessIncarnation{}, nil
	}
	var launch *hookCoordinates
	if scope != nil {
		launch = &hookCoordinates{IdentityID: scope.IdentityID, BindingID: scope.BindingID, StartupInput: scope.StartupInput,
			Owner: core.ProcessIncarnation{PID: scope.OwnerPID, StartIdentity: scope.OwnerStart}}
	}
	capture, ok := readHookCapture(ctx, store, launch, claim, probe)
	if !ok {
		return claude.StartupCapture{}, core.ProcessIncarnation{}, nil
	}
	main, err := claude.ProveStop(ctx, stop, capture, runtime.Observer{Process: runner})
	return capture, main, err
}

// recordClaudeStop verifies the evidence once more against a read snapshot
// before storage commits the exact event. A changed launch never grants a claim.
func recordClaudeStop(ctx context.Context, store ports.CaptureStore, capture claude.StartupCapture, stop claude.Stop,
	main core.ProcessIncarnation,
) (bool, error) {
	event, err := store.PrepareHookCapture(ctx, ports.HookCapturePreparation{
		Expected: capture.Binding, Owner: capture.Owner, Runtime: main, Driver: core.DriverClaude,
		ProviderSession: stop.Session, Model: stop.Model, Continuation: stop.Continuation,
		Final: stop.Final, ObservedAtMs: capture.ObservedAtMs,
	})
	if err != nil || event == nil {
		return false, err
	}
	_, err = store.CommitCapture(ctx, *event)
	return err == nil, err
}

func hookNowMs() uint64 { return uint64(time.Now().UnixMilli()) }
