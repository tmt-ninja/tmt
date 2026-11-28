//go:build darwin || linux

package claude

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

func TestClaudeStopOnlyOffersDigestForDocumentedUnrecursiveMainStop(t *testing.T) {
	for _, tc := range []struct {
		body                          string
		accepted, continuation, offer bool
	}{
		{`{"hook_event_name":"Stop","session_id":"one","stop_hook_active":false}`, true, false, true},
		{`{"hook_event_name":"Stop","session_id":"one","stop_hook_active":true}`, true, true, false},
		{`{"hook_event_name":"Stop","session_id":"one"}`, true, false, false},
		{`{"hook_event_name":"StopFailure","session_id":"one","stop_hook_active":false}`, false, false, false},
		{`{"hook_event_name":"SubagentStop","session_id":"one","stop_hook_active":false}`, false, false, false},
	} {
		event, ok := DecodeStop([]byte(tc.body))
		if ok != tc.accepted || ok && (event.Session != "one" || event.Continuation != tc.continuation ||
			event.CanOfferDigest != tc.offer) {
			t.Errorf("Stop decode = %+v, %t for %s", event, ok, tc.body)
		}
	}
	if got := string(EncodeStopContinuation("digest")); got != `{"decision":"block","reason":"digest"}` {
		t.Fatalf("provider continuation = %q", got)
	}
	if EncodeStopContinuation("") != nil || EncodeStopContinuation(strings.Repeat("x", StopDigestLimit+1)) != nil {
		t.Fatal("invalid continuation produced output")
	}
}

func TestClaudeStopBoundsProviderFinalAtScalarBoundary(t *testing.T) {
	for _, tc := range []struct{ text, kept string }{
		{"", ""},
		{"a\r\nb\n", "a\r\nb\n"},
		{strings.Repeat("x", stopFinalLimit-4) + "🦀", strings.Repeat("x", stopFinalLimit-4) + "🦀"},
		{strings.Repeat("x", stopFinalLimit-2) + "🦀tail", strings.Repeat("x", stopFinalLimit-2)},
	} {
		raw, err := json.Marshal(map[string]any{
			"hook_event_name": "Stop", "session_id": "one", "last_assistant_message": tc.text,
		})
		if err != nil {
			t.Fatal(err)
		}
		stop, ok := DecodeStop(raw)
		if !ok {
			t.Fatal("final-bearing Stop was rejected")
		}
		if tc.kept == "" && stop.Final != nil {
			t.Fatal("empty final was retained")
		}
		if tc.kept != "" && (stop.Final == nil ||
			*stop.Final != (core.HookFinalText{Text: tc.kept, OriginalBytes: uint64(len(tc.text))})) {
			t.Fatal("final did not preserve expected UTF-8 text and original byte length")
		}
	}
}
