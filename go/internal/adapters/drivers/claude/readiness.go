//go:build darwin || linux

package claude

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
)

const hookInputLimit = 64 * 1024

// CheckInitialIdle obtains startup readiness for a hook from the recorded,
// running managed Claude launch. The caller supplies the scoped host probe and
// the managed launch's selection of an interactive command with no prompt.
// Persistence must CAS that same binding and launch and preserve newer activity.
func CheckInitialIdle(ctx context.Context, payload []byte, startupInput bool, identity core.Identity,
	binding core.Binding, probe core.EndpointProbe, observer runtime.Observer,
) (bool, error) {
	reportedPID, present := os.LookupEnv("CLAUDE_PID")
	return checkInitialIdle(ctx, payload, startupInput, identity, binding, probe, observer, os.Getpid(), reportedPID, present)
}

type readinessObserver interface {
	MainInPane(context.Context, int, int, string) (runtime.Incarnation, error)
	Observe(context.Context, int) (runtime.Observation, error)
}

func checkInitialIdle(ctx context.Context, payload []byte, startupInput bool, identity core.Identity,
	binding core.Binding, probe core.EndpointProbe, observer readinessObserver, hookPID int, reportedPID string, hasReportedPID bool,
) (bool, error) {
	session := startupSession(payload)
	if !startupInput || session == "" || binding.Session.RuntimeState != "running" ||
		binding.Session.ProviderSessionID == nil || *binding.Session.ProviderSessionID != session {
		return false, nil
	}
	owned, pane := core.EvaluateBinding(identity, &binding, probe)
	if owned != core.BindingActive || pane.Incarnation == nil || binding.PaneIncarnation == nil ||
		*pane.Incarnation != *binding.PaneIncarnation || binding.PanePID > math.MaxInt32 {
		return false, nil
	}
	process := recordedIncarnation(binding.Session.Runtime)
	owner := recordedIncarnation(binding.Session.LaunchOwner)
	if !process.Valid() || !owner.Valid() {
		return false, nil
	}
	if hasReportedPID {
		pid, err := strconv.ParseUint(reportedPID, 10, 31)
		if err != nil || pid != uint64(process.PID) {
			return false, nil
		}
	}
	main, err := observer.MainInPane(ctx, hookPID, int(binding.PanePID), "claude")
	if err != nil || main != process {
		return false, err
	}
	liveOwner, err := observer.Observe(ctx, owner.PID)
	if err != nil {
		return false, err
	}
	return ctx.Err() == nil && liveOwner.Match(owner) == runtime.Alive, nil
}

func startupSession(input []byte) string {
	if len(input) > hookInputLimit || !utf8.Valid(input) {
		return ""
	}
	var event struct {
		Name    string          `json:"hook_event_name"`
		Session string          `json:"session_id"`
		Source  string          `json:"source"`
		Prompt  json.RawMessage `json:"prompt_id"`
		Agent   json.RawMessage `json:"agent_id"`
	}
	if json.Unmarshal(input, &event) != nil || event.Name != "SessionStart" ||
		(event.Source != "startup" && event.Source != "resume") || event.Prompt != nil || event.Agent != nil ||
		len(event.Session) > 256 || strings.TrimSpace(event.Session) == "" || strings.ContainsFunc(event.Session, unicode.IsControl) {
		return ""
	}
	return event.Session
}

func recordedIncarnation(value *core.ProcessIncarnation) runtime.Incarnation {
	if value == nil || value.PID > math.MaxInt32 {
		return runtime.Incarnation{}
	}
	return runtime.Incarnation{PID: int(value.PID), Start: value.StartIdentity}
}
