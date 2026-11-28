//go:build darwin || linux

package claude

import (
	"context"
	"errors"
	"os"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// StartupCapture holds the binding and launch captured by the caller. Owner
// comes from the stored launch intent or the admitted binding. StartupInput
// comes from the invocation's captured interactive, empty-prompt selection.
type StartupCapture struct {
	Identity     core.Identity
	Binding      core.Binding
	Probe        core.EndpointProbe
	Owner        core.ProcessIncarnation
	StartupInput bool
	ObservedAtMs uint64
}

// AdmitStartup verifies a Claude callback and sends one observation to the
// binding CAS. A staged observation does not yet establish deliverability.
func AdmitStartup(ctx context.Context, payload []byte, capture StartupCapture, observer runtime.Observer, store ports.Store) (bool, error) {
	reportedPID, present := os.LookupEnv("CLAUDE_PID")
	return admitStartup(ctx, payload, capture, observer, store, os.Getpid(), reportedPID, present)
}

func admitStartup(ctx context.Context, payload []byte, capture StartupCapture, observer readinessObserver,
	store ports.Store, hookPID int, reportedPID string, hasReportedPID bool,
) (bool, error) {
	event := decodeStartup(payload)
	const maxObservedAt = 9007199254740991
	if event.session == "" || capture.ObservedAtMs == 0 || capture.ObservedAtMs > maxObservedAt {
		return false, nil
	}
	binding := capture.Binding
	recorded := binding.Session
	switch recorded.RuntimeState {
	case "running":
		if recorded.LaunchOwner == nil || *recorded.LaunchOwner != capture.Owner || recorded.PlainProgram != nil ||
			recorded.ProviderSessionID != nil && *recorded.ProviderSessionID != event.session ||
			!recordedIncarnation(recorded.Runtime).Valid() {
			return false, nil
		}
	case "unknown", "ended":
		// The writer must still find and compare the exact existing launch intent.
	default:
		return false, nil
	}
	main, err := proveManagedHook(ctx, capture.Identity, binding, capture.Probe, recordedIncarnation(&capture.Owner),
		observer, hookPID, reportedPID, hasReportedPID)
	if err != nil || !main.Valid() {
		return false, err
	}
	if recorded.RuntimeState == "running" && main != recordedIncarnation(recorded.Runtime) {
		return false, nil
	}
	if store == nil {
		return false, errors.New("Claude startup requires a binding activity writer")
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	observation := ports.LaunchActivityObservation{
		Expected: binding, Owner: capture.Owner,
		Runtime:         core.ProcessIncarnation{PID: uint64(main.PID), StartIdentity: main.Start},
		ProviderSession: event.session, Transition: event.transition,
		InitialIdle: capture.StartupInput && event.idle, ObservedAtMs: capture.ObservedAtMs,
	}
	var recordedOK bool
	err = store.Write(ctx, func(tx ports.StoreTx) error {
		var err error
		recordedOK, err = tx.Bindings().ObserveLaunchActivity(observation)
		return err
	})
	return err == nil && recordedOK, err
}
