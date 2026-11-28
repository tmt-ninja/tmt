package cli

import (
	"context"
	"encoding/json/v2"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/claude"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/codex"
	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/invoke"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const hookLaunchLifetime = 24 * time.Hour

var errHookLaunchChanged = errors.New("binding or launch intent changed")

type hookLaunchIntent = ports.LaunchIntent

type hookLaunchCoordinator struct {
	store ports.Store
	now   func() time.Time
}

// prepareHookLaunch uses the invocation's open store and own live incarnation.
func (app application) prepareHookLaunch(ctx context.Context, root home.Root, binding core.Binding, provider string,
	command ports.ProcessSpec, startupInput bool,
) (ports.ProcessSpec, *hookLaunchIntent, error) {
	return app.prepareHookLaunchWithResume(ctx, root, binding, provider, command, startupInput, nil)
}

func (app application) prepareHookLaunchWithResume(ctx context.Context, root home.Root, binding core.Binding, provider string,
	command ports.ProcessSpec, startupInput bool, expectation *core.ResumeExpectation,
) (ports.ProcessSpec, *hookLaunchIntent, error) {
	executable, err := os.Executable()
	if err != nil {
		return ports.ProcessSpec{}, nil, err
	}
	observed, err := (runtime.Observer{Process: process.Runner{}}).Observe(ctx, os.Getpid())
	if err != nil {
		return ports.ProcessSpec{}, nil, err
	}
	if observed.State != runtime.Alive || observed.Incarnation.PID != os.Getpid() {
		return ports.ProcessSpec{}, nil, errHookLaunchChanged
	}
	owner := core.ProcessIncarnation{PID: uint64(observed.Incarnation.PID), StartIdentity: observed.Incarnation.Start}
	coordinator := hookLaunchCoordinator{store: app.store, now: time.Now}
	return coordinator.prepare(ctx, root, binding, core.DriverName(provider), command, owner, executable, startupInput, expectation)
}

// admitHookLaunch commits an independently verified foreground observation
// while the parent run invocation still owns that launch.
func (app application) admitHookLaunch(ctx context.Context, _ home.Root, intent *hookLaunchIntent,
	main core.ProcessIncarnation,
) (*core.Binding, error) {
	if intent == nil || intent.Owner.PID != uint64(os.Getpid()) {
		return nil, errHookLaunchChanged
	}
	coordinator := hookLaunchCoordinator{store: app.store, now: time.Now}
	return coordinator.admit(ctx, intent, main)
}

// prepare records the intent before handing the caller a launchable command.
// The caller has already verified the binding and the launch-owner incarnation.
func (c hookLaunchCoordinator) prepare(ctx context.Context, root home.Root, binding core.Binding,
	provider core.DriverName, command ports.ProcessSpec, owner core.ProcessIncarnation, executable string, startupInput bool, expectation *core.ResumeExpectation,
) (ports.ProcessSpec, *hookLaunchIntent, error) {
	if c.store == nil || !filepath.IsAbs(root.Dir) || !filepath.IsAbs(executable) || !invoke.IsExecutable(executable) ||
		binding.ID == "" || binding.IdentityID == "" || binding.PaneIncarnation == nil || !validHookIncarnation(owner) {
		return ports.ProcessSpec{}, nil, errors.New("invalid managed launch coordinates")
	}
	if err := ctx.Err(); err != nil {
		return ports.ProcessSpec{}, nil, err
	}

	env := make([]string, 0, len(command.Env))
	for _, entry := range command.Env {
		if !strings.HasPrefix(entry, hookLaunchEnv+"=") {
			env = append(env, entry)
		}
	}
	overlay := []string{home.EnvHome + "=" + root.Dir, "TMT_EXECUTABLE=" + executable}
	switch provider {
	case core.DriverClaude:
		launch := hookCoordinates{IdentityID: binding.IdentityID, BindingID: binding.ID, Owner: owner,
			StartupInput: startupInput && claude.StartsAtPrompt(command)}
		data, err := json.Marshal(launch)
		if err != nil {
			return ports.ProcessSpec{}, nil, err
		}
		command, err = claude.AddLaunchHooks(command, executable)
		if err != nil {
			return ports.ProcessSpec{}, nil, err
		}
		overlay = append(overlay, hookLaunchEnv+"="+string(data))
	case core.DriverCodex:
		command = codex.PrepareManagedLaunch(command, root.Dir, expectation != nil)
	case core.DriverGemini:
		// Plain launch only, with no initial Idle claim.
	default:
		return ports.ProcessSpec{}, nil, errors.New("unsupported managed launch provider")
	}
	command.Env = invoke.OverlayEnv(env, overlay)

	now := c.now()
	intent := hookLaunchIntent{Expected: binding, Owner: owner, Driver: provider,
		CreatedAtMs: uint64(now.UnixMilli()), ExpiresAtMs: uint64(now.Add(hookLaunchLifetime).UnixMilli()), Resume: expectation}
	var created bool
	err := c.store.Write(ctx, func(tx ports.StoreTx) error {
		var err error
		created, err = tx.Bindings().CreateLaunchIntent(intent)
		return err
	})
	if err != nil {
		return ports.ProcessSpec{}, nil, err
	}
	if !created {
		return ports.ProcessSpec{}, nil, hookLaunchConflict(expectation, false)
	}
	return command, &intent, nil
}

// admit sends one writer request for the independently verified foreground
// incarnation. The writer decides whether matching staged evidence is present.
func (c hookLaunchCoordinator) admit(ctx context.Context, intent *hookLaunchIntent, main core.ProcessIncarnation) (*core.Binding, error) {
	now := uint64(c.now().UnixMilli())
	if c.store == nil || intent == nil || !validHookIncarnation(main) || now < intent.CreatedAtMs || now >= intent.ExpiresAtMs {
		return nil, errHookLaunchChanged
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	var binding *core.Binding
	err := c.store.Write(ctx, func(tx ports.StoreTx) error {
		var err error
		binding, err = tx.Bindings().AdmitLaunch(ports.LaunchAdmission{Intent: *intent, Runtime: main, ObservedAtMs: now})
		return err
	})
	if err != nil {
		return nil, err
	}
	if binding == nil {
		return nil, hookLaunchConflict(intent.Resume, true)
	}
	return binding, nil
}

func hookLaunchConflict(expectation *core.ResumeExpectation, childStarted bool) error {
	if expectation == nil {
		return errHookLaunchChanged
	}
	message := "The identity changed before resume. No new agent was launched; check the old pane and retry."
	if childStarted {
		message = "The identity changed during resume. Inspect the pane before retrying."
	}
	return &core.RequestFailure{Code: "RUNTIME_CONFLICT", Status: 5, Reason: "resume_drift", Message: message}
}

func validHookIncarnation(process core.ProcessIncarnation) bool {
	return process.PID <= 2147483647 &&
		(runtime.Incarnation{PID: int(process.PID), Start: process.StartIdentity}).Valid()
}
