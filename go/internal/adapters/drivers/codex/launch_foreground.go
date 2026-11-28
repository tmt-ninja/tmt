package codex

import (
	"context"
	"math"
	"path/filepath"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
)

// ProveForeground accepts one named provider under this exact npm launcher.
// The launcher and the provider must both survive independent rechecks.
func (shim *NpmLauncher) ProveForeground(ctx context.Context, observer runtime.Observer,
	identity core.Identity, binding core.Binding, probe core.EndpointProbe, owner, launcher core.ProcessIncarnation,
) (runtime.BoundProvider, error) {
	if shim == nil || ctx.Err() != nil || owner.PID > math.MaxInt32 || launcher.PID > math.MaxInt32 {
		return runtime.BoundProvider{}, ctx.Err()
	}
	expected := runtime.Incarnation{PID: int(launcher.PID), Start: launcher.StartIdentity}
	pinnedOwner := runtime.Incarnation{PID: int(owner.PID), Start: owner.StartIdentity}
	match := func(command, args string) bool {
		switch filepath.Base(command) {
		case "node", "nodejs", "node-MainThread":
			return shim.matchesArguments(args)
		default:
			return false
		}
	}
	verify := func() (bool, error) {
		if ctx.Err() != nil || !shim.unchanged() {
			return false, ctx.Err()
		}
		return observer.ProbeLaunchCommand(ctx, expected, match)
	}
	if ok, err := verify(); err != nil || !ok {
		return runtime.BoundProvider{}, err
	}
	result, err := observer.ProveCodexLauncherChild(ctx, identity, binding, probe, expected, pinnedOwner)
	if err != nil || result.Incarnation.PID == 0 {
		return runtime.BoundProvider{}, err
	}
	if ok, err := verify(); err != nil || !ok {
		return runtime.BoundProvider{}, err
	}
	return result, nil
}
