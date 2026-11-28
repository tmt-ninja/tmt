package cli

import (
	"context"
	"encoding/json/v2"
	"errors"
	"path/filepath"
	"strings"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/claude"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/invoke"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const hookLaunchLifetime = 24 * time.Hour

var errHookLaunchChanged = errors.New("binding or launch intent changed")

type hookLaunchIntent struct {
	expected    core.Binding
	owner       core.ProcessIncarnation
	provider    string
	createdAtMs uint64
	expiresAtMs uint64
}

// hookLaunchStorage keeps the sequencing testable until the binding launch
// intent port is wired. Implementations own the storage transaction and fence.
type hookLaunchStorage interface {
	createLaunchIntent(context.Context, hookLaunchIntent) (bool, error)
	admitLaunch(context.Context, hookLaunchIntent, core.ProcessIncarnation, uint64) (*core.Binding, error)
}

type hookLaunchCoordinator struct {
	storage hookLaunchStorage
	now     func() time.Time
}

// prepare records the intent before handing the caller a launchable command.
// The caller has already verified the binding and the launch-owner incarnation.
func (c hookLaunchCoordinator) prepare(ctx context.Context, root home.Root, binding core.Binding,
	provider string, command ports.ProcessSpec, owner core.ProcessIncarnation, executable string, startupInput bool,
) (ports.ProcessSpec, *hookLaunchIntent, error) {
	if !filepath.IsAbs(root.Dir) || !filepath.IsAbs(executable) || !invoke.IsExecutable(executable) ||
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
	case "claude":
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
	case "codex", "gemini":
		// Plain launch only. Neither provider makes an initial Idle claim.
	default:
		return ports.ProcessSpec{}, nil, errors.New("unsupported managed launch provider")
	}
	command.Env = invoke.OverlayEnv(env, overlay)

	now := c.now()
	intent := hookLaunchIntent{expected: binding, owner: owner, provider: provider,
		createdAtMs: uint64(now.UnixMilli()), expiresAtMs: uint64(now.Add(hookLaunchLifetime).UnixMilli())}
	created, err := c.storage.createLaunchIntent(ctx, intent)
	if err != nil {
		return ports.ProcessSpec{}, nil, err
	}
	if !created {
		return ports.ProcessSpec{}, nil, errHookLaunchChanged
	}
	return command, &intent, nil
}

// admit sends one writer request for the independently verified foreground
// incarnation. The writer decides whether matching staged evidence is present.
func (c hookLaunchCoordinator) admit(ctx context.Context, intent *hookLaunchIntent, main core.ProcessIncarnation) (*core.Binding, error) {
	now := uint64(c.now().UnixMilli())
	if intent == nil || !validHookIncarnation(main) || now < intent.createdAtMs || now >= intent.expiresAtMs {
		return nil, errHookLaunchChanged
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	binding, err := c.storage.admitLaunch(ctx, *intent, main, now)
	if err == nil && binding == nil {
		return nil, errHookLaunchChanged
	}
	return binding, err
}

func validHookIncarnation(process core.ProcessIncarnation) bool {
	return process.PID <= 2147483647 &&
		(runtime.Incarnation{PID: int(process.PID), Start: process.StartIdentity}).Valid()
}
