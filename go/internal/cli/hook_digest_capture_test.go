package cli

import (
	"context"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/claude"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type claudeStopCaptureFixture struct {
	input  ports.HookCapturePreparation
	event  *core.HookCaptureEvent
	commit *core.HookCaptureEvent
}

func (f *claudeStopCaptureFixture) PrepareHookCapture(_ context.Context, input ports.HookCapturePreparation) (*core.HookCaptureEvent, error) {
	f.input = input
	return f.event, nil
}

func (f *claudeStopCaptureFixture) CommitCapture(_ context.Context, event core.HookCaptureEvent) (core.HookCaptureReceipt, error) {
	f.commit = &event
	return core.HookCaptureReceipt{EventID: event.ID, Outcome: core.HookCaptureCommitted}, nil
}

func TestClaudeContinuedStopCommitsOnlyThePreparedExactCapture(t *testing.T) {
	capture := claude.StartupCapture{
		Binding: core.Binding{ID: "binding", IdentityID: "worker"},
		Owner:   core.ProcessIncarnation{PID: 42, StartIdentity: hookStart}, ObservedAtMs: 74,
	}
	runtime := core.ProcessIncarnation{PID: 44, StartIdentity: hookStart}
	stop := claude.Stop{Continuation: true, Session: "this-session", Final: &core.HookFinalText{Text: "the continuation", OriginalBytes: 16}}
	want := ports.HookCapturePreparation{
		Expected: capture.Binding, Owner: capture.Owner, Runtime: runtime, Driver: core.DriverClaude,
		ProviderSession: stop.Session, Continuation: true, Final: stop.Final, ObservedAtMs: capture.ObservedAtMs,
	}

	for _, prepared := range []bool{false, true} {
		store := &claudeStopCaptureFixture{}
		if prepared {
			store.event = &core.HookCaptureEvent{ID: "exact-prepared-event"}
		}
		got, err := recordClaudeStop(t.Context(), store, capture, stop, runtime)
		if err != nil || got != prepared || store.input != want {
			t.Fatalf("capture result = %t, %v, input = %+v, want %+v", got, err, store.input, want)
		}
		if prepared {
			if store.commit == nil || *store.commit != *store.event {
				t.Fatalf("commit = %+v, want exact prepared event", store.commit)
			}
		} else if store.commit != nil {
			t.Fatalf("changed launch committed %+v", store.commit)
		}
	}
}
