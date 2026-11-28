package cli

import (
	"context"
	"encoding/json/v2"
	"errors"
	"strconv"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/claude"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const hookPublicationReserve = 600 * time.Millisecond
const hookDigestHandoffLimit = claude.StopDigestLimit*6 + 4096

// hookDigestHandoff is private output from a worker. It cannot be published
// until the supervisor independently proves the launch and the active attempt.
type hookDigestHandoff struct {
	Launch       core.HookCaptureLaunch  `json:"launch"`
	ChecklistID  core.DigestChecklistID  `json:"checklist_id"`
	AttemptToken core.DigestAttemptToken `json:"attempt_token"`
	Digest       string                  `json:"digest"`
}

func validDigestHookLaunch(launch core.HookCaptureLaunch) bool {
	return core.ValidUUID(string(launch.IdentityID)) && core.ValidUUID(string(launch.BindingID)) &&
		validHookIncarnation(core.ProcessIncarnation{PID: launch.OwnerPID, StartIdentity: launch.OwnerStart})
}

func (h hookDigestHandoff) valid(launch *core.HookCaptureLaunch) bool {
	return validDigestHookLaunch(h.Launch) && (launch == nil || h.Launch == *launch) &&
		core.ValidUUID(string(h.ChecklistID)) && core.ValidUUID(string(h.AttemptToken)) &&
		len(h.Digest) > 0 && len(h.Digest) <= claude.StopDigestLimit
}

func runClaudeDigestWorker(ctx context.Context, runner ports.Process, executable string,
	env []string, payload []byte, launch *core.HookCaptureLaunch,
) (*hookDigestHandoff, error) {
	deadline, ok := ctx.Deadline()
	if !ok {
		return nil, errors.New("Digest worker requires an absolute deadline")
	}
	workerDeadline := deadline.Add(-hookPublicationReserve)
	remaining := time.Until(workerDeadline).Milliseconds()
	if remaining <= 0 || ctx.Err() != nil {
		return nil, context.DeadlineExceeded
	}
	args := []string{"__digest-hook", "claude", "--worker", "--work-budget-ms", strconv.FormatInt(remaining, 10)}
	if launch == nil {
		args = append(args, "--discover-launch")
	} else {
		data, err := json.Marshal(launch)
		if err != nil {
			return nil, err
		}
		args = append(args, "--launch", string(data))
	}
	worker, cancel := context.WithDeadline(ctx, workerDeadline)
	defer cancel()
	result, err := runner.Run(worker, ports.ProcessSpec{
		Path: executable, Args: args, Env: env, Stdin: payload,
		Timeout: time.Duration(remaining) * time.Millisecond, MaxOut: hookDigestHandoffLimit,
	})
	if err != nil {
		return nil, err
	}
	if result.ExitCode != 0 || result.Truncated || len(result.Stderr) != 0 {
		return nil, errors.New("Digest worker refused the handoff")
	}
	if err := worker.Err(); err != nil {
		return nil, err
	}
	if len(result.Stdout) == 0 {
		return nil, nil
	}
	var handoff hookDigestHandoff
	if len(result.Stdout) > hookDigestHandoffLimit ||
		json.Unmarshal(result.Stdout, &handoff, json.RejectUnknownMembers(true)) != nil || !handoff.valid(launch) {
		return nil, errors.New("invalid Digest worker handoff")
	}
	return &handoff, nil
}

func decodeDigestHookLaunch(inv invocation) (*core.HookCaptureLaunch, bool) {
	raw, explicit := inv.options["launch"]
	if explicit == inv.has("discover-launch") {
		return nil, false
	}
	if !explicit {
		return nil, true
	}
	var launch core.HookCaptureLaunch
	if len(raw) > 2048 || json.Unmarshal([]byte(raw), &launch, json.RejectUnknownMembers(true)) != nil ||
		!validDigestHookLaunch(launch) {
		return nil, false
	}
	return &launch, true
}

func digestHookBudget(raw string) time.Duration {
	if raw == "" {
		return hookBudget
	}
	ms, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		return 0
	}
	return time.Duration(min(ms, uint64(hookBudget.Milliseconds()))) * time.Millisecond
}
