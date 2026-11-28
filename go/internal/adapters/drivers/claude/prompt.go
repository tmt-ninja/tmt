//go:build darwin || linux

package claude

import (
	"context"
	"encoding/json/v2"
	"errors"
	"os"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// PromptSession recognizes the main prompt envelope without retaining the
// prompt text or reading the transcript path.
func PromptSession(payload []byte) string {
	if len(payload) > hookInputLimit || !utf8.Valid(payload) {
		return ""
	}
	var event struct {
		Name    string `json:"hook_event_name"`
		Session string `json:"session_id"`
	}
	if json.Unmarshal(payload, &event) != nil || event.Name != "UserPromptSubmit" ||
		len(event.Session) > 256 || strings.TrimSpace(event.Session) == "" ||
		strings.ContainsFunc(event.Session, unicode.IsControl) {
		return ""
	}
	return event.Session
}

// AdmitDigestPrompt submits the exact verified main prompt to the existing
// continuation writer. Phase and remembered-session ownership stay in storage.
func AdmitDigestPrompt(ctx context.Context, payload []byte, capture StartupCapture, observer runtime.Observer, store ports.Store) (bool, error) {
	reportedPID, present := os.LookupEnv("CLAUDE_PID")
	return admitDigestPrompt(ctx, payload, capture, observer, store, os.Getpid(), reportedPID, present)
}

func admitDigestPrompt(ctx context.Context, payload []byte, capture StartupCapture, observer readinessObserver,
	store ports.Store, hookPID int, reportedPID string, hasReportedPID bool,
) (bool, error) {
	session := PromptSession(payload)
	recorded := capture.Binding.Session
	expected := recordedIncarnation(recorded.Runtime)
	if session == "" || capture.ObservedAtMs == 0 || capture.ObservedAtMs > 9007199254740991 ||
		recorded.RuntimeState != "running" || recorded.PlainProgram != nil || !expected.Valid() ||
		recorded.LaunchOwner == nil || *recorded.LaunchOwner != capture.Owner ||
		recorded.ProviderSessionID == nil || *recorded.ProviderSessionID != session {
		return false, nil
	}
	main, err := proveManagedHook(ctx, capture.Identity, capture.Binding, capture.Probe,
		recordedIncarnation(&capture.Owner), observer, hookPID, reportedPID, hasReportedPID)
	if err != nil || main != expected {
		return false, err
	}
	if store == nil {
		return false, errors.New("Claude prompt requires a binding writer")
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	observation := ports.DigestPromptObservation{
		Expected: capture.Binding, Owner: capture.Owner, Runtime: *recorded.Runtime,
		ProviderSession: session, ObservedAtMs: capture.ObservedAtMs,
	}
	var accepted bool
	err = store.Write(ctx, func(tx ports.StoreTx) error {
		var err error
		accepted, err = tx.Bindings().ObserveDigestPrompt(observation)
		return err
	})
	return accepted && err == nil, err
}
