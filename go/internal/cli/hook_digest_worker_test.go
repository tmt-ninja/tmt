package cli

import (
	"context"
	"encoding/json/v2"
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type digestWorkerRun func(context.Context, ports.ProcessSpec) (ports.Bounded, error)

func (run digestWorkerRun) Run(ctx context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
	return run(ctx, spec)
}

func TestClaudeDigestWorkerUsesReservedBudgetAndExactScope(t *testing.T) {
	launch := core.HookCaptureLaunch{
		IdentityID: "11111111-1111-4111-8111-111111111111",
		BindingID:  "22222222-2222-4222-8222-222222222222",
		OwnerPID:   42, OwnerStart: hookStart,
	}
	result := hookDigestHandoff{Launch: launch, ChecklistID: "33333333-3333-4333-8333-333333333333",
		AttemptToken: "44444444-4444-4444-8444-444444444444", Digest: "private checklist"}
	input := `{"hook_event_name":"Stop","stop_hook_active":false}`
	ctx, cancel := context.WithTimeout(t.Context(), hookBudget)
	defer cancel()
	deadline, _ := ctx.Deadline()
	run := digestWorkerRun(func(ctx context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
		t.Helper()
		childDeadline, _ := ctx.Deadline()
		if !childDeadline.Equal(deadline.Add(-hookPublicationReserve)) || spec.MaxOut != hookDigestHandoffLimit ||
			len(spec.Args) != 7 || spec.Args[0] != "__digest-hook" || spec.Args[1] != "claude" ||
			spec.Args[2] != "--worker" || spec.Args[3] != "--work-budget-ms" || spec.Args[5] != "--launch" ||
			string(spec.Stdin) != input {
			t.Fatalf("worker command = %+v, deadline = %v", spec, childDeadline)
		}
		budget, err := strconv.ParseInt(spec.Args[4], 10, 64)
		if err != nil || budget <= 0 || time.Duration(budget)*time.Millisecond != spec.Timeout ||
			spec.Timeout > hookBudget-hookPublicationReserve {
			t.Fatalf("worker timeout = %s, budget = %d, err = %v", spec.Timeout, budget, err)
		}
		wire, ok := decodeDigestHookLaunch(invocation{options: map[string]string{"launch": spec.Args[6]}})
		if !ok || *wire != launch {
			t.Fatalf("worker launch = %+v", wire)
		}
		data, err := json.Marshal(result)
		return ports.Bounded{Stdout: data}, err
	})
	got, err := runClaudeDigestWorker(ctx, run, "/private/tmt", nil, []byte(input), &launch)
	if err != nil || got == nil || *got != result {
		t.Fatalf("handoff = %+v, %v", got, err)
	}
	result.Launch.OwnerPID++
	got, err = runClaudeDigestWorker(ctx, run, "/private/tmt", nil, []byte(input), &launch)
	if err == nil || got != nil {
		t.Fatalf("mismatched handoff = %+v, %v", got, err)
	}
}

func TestClaudeDigestWorkerDoesNotRunAfterReserve(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), hookPublicationReserve)
	defer cancel()
	run := digestWorkerRun(func(context.Context, ports.ProcessSpec) (ports.Bounded, error) {
		t.Fatal("worker started without a publication reserve")
		return ports.Bounded{}, nil
	})
	if got, err := runClaudeDigestWorker(ctx, run, "/private/tmt", nil, nil, nil); got != nil || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expired handoff = %+v, %v", got, err)
	}
}
