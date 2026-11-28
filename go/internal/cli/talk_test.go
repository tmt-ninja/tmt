package cli

import (
	"context"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type talkWaitFake struct {
	ports.RequestService
	read    func(context.Context, core.RequestID) (core.ResponseLookup, error)
	release func(context.Context, core.AttemptID) error
}

func (s talkWaitFake) Result(ctx context.Context, id core.RequestID) (core.ResponseLookup, error) {
	return s.read(ctx, id)
}

func (s talkWaitFake) ReleaseWait(ctx context.Context, id core.AttemptID) error {
	return s.release(ctx, id)
}

func TestTalkWaitUsesExactIDAndReleasesObserver(t *testing.T) {
	const id = "req_11111111-0000-4000-8000-000000000000"
	const attempt = "22222222-0000-4000-8000-000000000000"
	const body = "\ufeff\r\nreply\x00"
	for _, interrupted := range []bool{false, true} {
		ctx, cancel := context.WithCancel(t.Context())
		released := 0
		app := application{requests: talkWaitFake{
			read: func(_ context.Context, request core.RequestID) (core.ResponseLookup, error) {
				if request != id {
					t.Fatalf("read request = %q", request)
				}
				if interrupted {
					cancel()
				}
				return core.ResponseLookup{
					Status: core.ResponseAvailable, Final: &core.FinalResponse{RequestID: id, Body: body, BodyBytes: uint64(len(body))},
				}, nil
			},
			release: func(cleanup context.Context, got core.AttemptID) error {
				released++
				if cleanup.Err() != nil || got != attempt {
					t.Fatalf("release attempt = %q, context error = %v", got, cleanup.Err())
				}
				return nil
			},
		}}
		result := app.waitForTalk(ctx, talkPlan{timeout: time.Second, poll: time.Second},
			core.PreparedRequest{RequestID: id, AttemptID: attempt}, talkReport{RequestID: id, Target: "worker"})
		cancel()
		if released != 1 {
			t.Fatalf("released = %d, want one", released)
		}
		if interrupted {
			failure, ok := result.(*output.Failure)
			if !ok || failure.Code != "INTERRUPTED" || failure.Request.RequestID != id {
				t.Fatalf("interrupted result = %+v", result)
			}
		} else if completed, ok := result.(talkReport); !ok || completed.Status != "completed" || completed.Response == nil || *completed.Response != body {
			t.Fatalf("completed result = %+v", result)
		}
	}
}
