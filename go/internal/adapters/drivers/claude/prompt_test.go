//go:build darwin || linux

package claude

import (
	"reflect"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// Synthetic fixture from native runtime/fixtures/claude-prompt-submit.json.
const promptFixture = `{
  "session_id": "11111111-1111-4111-8111-111111111111",
  "hook_event_name": "UserPromptSubmit",
  "cwd": "/fixture",
  "prompt": "Fixture prompt"
}`
const promptSession = "11111111-1111-4111-8111-111111111111"

func TestClaudePromptDecodesOnlySubmissions(t *testing.T) {
	if got := PromptSession([]byte(promptFixture)); got != promptSession {
		t.Fatalf("prompt session = %q", got)
	}
	for _, event := range []string{"Stop", "SubagentStop", "SessionStart", "future-event"} {
		if got := PromptSession([]byte(strings.Replace(promptFixture, "UserPromptSubmit", event, 1))); got != "" {
			t.Fatalf("%s decoded as a prompt in session %s", event, got)
		}
	}
	for _, invalid := range []string{"{}", "not json", strings.Repeat("x", hookInputLimit+1),
		strings.Replace(promptFixture, promptSession, "", 1)} {
		if got := PromptSession([]byte(invalid)); got != "" {
			t.Fatal("invalid input decoded as a prompt")
		}
	}
}

func TestClaudeDigestPromptUsesExactAdmissionAndLeavesStopSeparate(t *testing.T) {
	const start = "ps-v1:Sat Jan 1 00:00:00 2000"
	const later = "ps-v1:Sun Jan 2 00:00:00 2000"
	owner := core.ProcessIncarnation{PID: 11, StartIdentity: start}
	child := core.ProcessIncarnation{PID: 20, StartIdentity: start}
	identity := core.Identity{ID: "identity", Name: "member", CanonicalName: "member"}
	binding := core.Binding{ID: "binding", IdentityID: identity.ID,
		PaneID: "%3", PanePID: 10, PaneIncarnation: new(start),
		Server: core.ServerEvidence{Host: "tmux", ID: "server", Socket: "/test/socket", PID: 5, StartTime: start},
		Session: core.BindingSessionState{RuntimeState: "running", Runtime: &child,
			LaunchOwner: &owner, ProviderSessionID: new(promptSession)}}
	marker := binding.Marker(identity)
	probe := core.EndpointProbe{State: core.EndpointProbeLive, Server: binding.Server,
		Panes: []core.PaneObservation{{ID: binding.PaneID, PID: binding.PanePID, Incarnation: new(start), Marker: &marker}}}
	for _, tc := range []struct {
		name, event, reportedPID, runtimeStart string
		wantWrite                              bool
	}{
		{"verified prompt", "UserPromptSubmit", "20", start, true},
		{"blocked Stop is not a prompt", "Stop", "20", start, false},
		{"unverified provider PID", "UserPromptSubmit", "21", start, false},
		{"reused runtime PID", "UserPromptSubmit", "20", later, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			capture := StartupCapture{Identity: identity, Binding: binding, Probe: probe, Owner: owner, ObservedAtMs: 123}
			processes := startupProbe{
				main:  runtime.Incarnation{PID: int(child.PID), Start: tc.runtimeStart},
				owner: runtime.Observation{State: runtime.Alive, Incarnation: runtime.Incarnation{PID: int(owner.PID), Start: start}},
			}
			store := &activityStore{repo: activityRepo{ok: true}}
			body := []byte(strings.Replace(promptFixture, "UserPromptSubmit", tc.event, 1))
			got, err := admitDigestPrompt(t.Context(), body, capture, processes, store, 40, tc.reportedPID, true)
			if err != nil || got != tc.wantWrite {
				t.Fatalf("prompt admission = %t, %v", got, err)
			}
			if !tc.wantWrite {
				if store.writes != 0 || len(store.repo.prompts) != 0 {
					t.Fatalf("unverified event reached writer: %+v", store.repo.prompts)
				}
				return
			}
			want := ports.DigestPromptObservation{Expected: binding, Owner: owner,
				Runtime: child, ProviderSession: promptSession, ObservedAtMs: 123}
			if store.writes != 1 || !reflect.DeepEqual(store.repo.prompts, []ports.DigestPromptObservation{want}) {
				t.Fatalf("prompt transaction count %d and writes %+v, want one %+v", store.writes, store.repo.prompts, want)
			}
		})
	}
}
