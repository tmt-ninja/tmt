//go:build darwin || linux

package claude

import (
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"os"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
)

const (
	stopFinalLimit  = 16 * 1024
	StopDigestLimit = 32 * 1024
)

// Stop is the main-turn boundary and the supplied final text, if any.
type Stop struct {
	Session        string
	Model          *string
	Continuation   bool
	CanOfferDigest bool
	Final          *core.HookFinalText
}

// DecodeStop takes the final supplied by Claude before its transcript catches
// up. A continued Stop completes a continuation and cannot offer another.
func DecodeStop(payload []byte) (Stop, bool) {
	if len(payload) > hookInputLimit || !utf8.Valid(payload) {
		return Stop{}, false
	}
	var wire struct {
		Event   string         `json:"hook_event_name"`
		Session string         `json:"session_id"`
		Model   *string        `json:"model"`
		Active  jsontext.Value `json:"stop_hook_active"`
		Answer  jsontext.Value `json:"last_assistant_message"`
	}
	if json.Unmarshal(payload, &wire) != nil || wire.Event != "Stop" ||
		len(wire.Session) > 256 || strings.TrimSpace(wire.Session) == "" ||
		strings.ContainsFunc(wire.Session, unicode.IsControl) {
		return Stop{}, false
	}
	stop := Stop{Session: wire.Session, Model: wire.Model}
	switch string(wire.Active) {
	case "false":
		stop.CanOfferDigest = true
	case "true":
		stop.Continuation = true
	case "":
	default:
		return Stop{}, false
	}
	var answer string
	if len(wire.Answer) != 0 && json.Unmarshal(wire.Answer, &answer) == nil && answer != "" {
		end := min(stopFinalLimit, len(answer))
		for end < len(answer) && !utf8.RuneStart(answer[end]) {
			end--
		}
		stop.Final = &core.HookFinalText{Text: answer[:end], OriginalBytes: uint64(len(answer))}
	}
	return stop, true
}

// ProveStop binds a Stop to the exact admitted foreground and provider session.
func ProveStop(ctx context.Context, stop Stop, capture StartupCapture, observer runtime.Observer) (core.ProcessIncarnation, error) {
	reportedPID, present := os.LookupEnv("CLAUDE_PID")
	return proveAdmittedHook(ctx, stop.Session, capture, observer, os.Getpid(), reportedPID, present)
}

// EncodeStopContinuation builds Claude's blocking reason for an exact
// checklist. Empty and oversize content cannot veto the Stop.
func EncodeStopContinuation(reason string) []byte {
	if len(reason) == 0 || len(reason) > StopDigestLimit || !utf8.ValidString(reason) {
		return nil
	}
	payload, err := json.Marshal(struct {
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}{Decision: "block", Reason: reason})
	if err != nil {
		return nil
	}
	return payload
}
