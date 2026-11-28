//go:build darwin || linux

package runtime

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type nativeOnlyRunner struct{ process.Runner }

func (nativeOnlyRunner) Run(context.Context, ports.ProcessSpec) (ports.Bounded, error) {
	return ports.Bounded{}, errors.New("unexpected ps subprocess on native acquisition")
}

func TestNativeStartTokenMatchesTheBoundedPSFallback(t *testing.T) {
	pid := os.Getpid()
	native := Observer{Process: nativeOnlyRunner{}}
	// Embed only the fallback port to avoid exposing the native capability.
	fallback := Observer{Process: struct{ ports.Process }{process.Runner{}}}
	observation, err := native.Observe(t.Context(), pid)
	if err != nil || observation.State != Alive || !observation.Incarnation.Valid() {
		t.Fatalf("native process = %+v, %v", observation, err)
	}
	ps, err := fallback.Observe(t.Context(), pid)
	if err != nil || ps != observation {
		t.Fatalf("ps process = %+v, %v, want %+v", ps, err, observation)
	}
	starts, err := native.ObserveStarts(t.Context(), []int{pid, pid})
	if err != nil || len(starts) != 1 || starts[pid] != observation.Incarnation {
		t.Fatalf("native batch = %+v, %v, want %+v", starts, err, observation.Incarnation)
	}
	cancelled, stop := context.WithCancel(t.Context())
	stop()
	if got, _ := native.Observe(cancelled, pid); got.State != Unknown {
		t.Fatalf("cancelled process evidence = %+v", got)
	}
}
