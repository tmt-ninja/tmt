package cli

import (
	"bytes"
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/flavor"
)

func TestGrammarRecognizesAliasesAndDataBoundaries(t *testing.T) {
	tests := []struct {
		args, path, operands []string
		option, value        string
		json                 bool
	}{
		{args: []string{"--timeout", "30", "send", "peer", "hello", "--json"}, path: []string{"talk"}, operands: []string{"peer", "hello"}, option: "timeout", value: "30", json: true},
		{args: []string{"this", "-s", "worker"}, path: []string{"name"}, operands: []string{"worker"}, option: "save"},
		{args: []string{"x", "--identity", "worker", "list"}, path: []string{"x", "ls"}, option: "identity", value: "worker"},
		{args: []string{"reply", "req", "--receipt", "token", "--message=--json"}, path: []string{"reply"}, operands: []string{"req"}, option: "message", value: "--json"},
		{args: []string{"talk", "peer", "--", "--help"}, path: []string{"talk"}, operands: []string{"peer", "--help"}},
		{args: []string{"run", "-s", "worker", "fake-provider", "--json", "--help", "--"}, path: []string{"run"}, operands: []string{"worker", "fake-provider", "--json", "--help", "--"}, option: "save"},
	}
	for _, tt := range tests {
		t.Run(strings.Join(tt.args, " "), func(t *testing.T) {
			got, failure := parse(tt.args)
			if failure != nil {
				t.Fatal(failure)
			}
			if !slices.Equal(got.path, tt.path) || !slices.Equal(got.operands, tt.operands) || got.json != tt.json || got.help {
				t.Fatalf("got %+v", got)
			}
			if tt.option != "" && (!got.has(tt.option) || got.options[tt.option] != tt.value) {
				t.Fatalf("option %s: got %q, want %q", tt.option, got.options[tt.option], tt.value)
			}
		})
	}
}

func TestGrammarRejectsInvalidOptionsBeforeExecution(t *testing.T) {
	tests := []struct {
		args, want []string
		code       string
		json       bool
	}{
		{args: []string{"--identity", "worker", "talk", "peer", "hello"}, want: []string{"--identity"}, code: "USAGE_ERROR"},
		{args: []string{"--lines", "50", "talk", "peer", "hello"}, want: []string{"lines", "talk"}, code: "USAGE_ERROR"},
		{args: []string{"talk", "peer", "hello", "--wait"}, want: []string{"retired"}, code: "USAGE_ERROR"},
		{args: []string{"--json", "--team", "legacy", "list"}, want: []string{"Team workflows"}, code: "UNSUPPORTED_TEAM", json: true},
		{args: []string{"--json", "talk", "peer"}, want: []string{"message"}, code: "USAGE_ERROR", json: true},
		{args: []string{"talk", "peer", "hi", "--unknown", "--json"}, want: []string{"--unknown"}, code: "USAGE_ERROR", json: true},
		{args: []string{"talk", "--config", "--json", "peer", "hi"}, want: []string{"config"}, code: "USAGE_ERROR"},
		{args: []string{"talk", "peer", "hi", "--detach", "--timeout", "1s"}, want: []string{"--detach", "--timeout"}, code: "USAGE_ERROR"},
		{args: []string{"x", "--limit", "2", "listen"}, want: []string{"limit", "listen"}, code: "USAGE_ERROR"},
		{args: []string{"reply", "req", "--receipt", "token", "--message=", "--stdin"}, want: []string{"exactly one"}, code: "USAGE_ERROR"},
		{args: []string{"run", "--json", "worker"}, want: []string{"--json"}, code: "JSON_UNSUPPORTED", json: true},
		{args: []string{"name", "--help", "--json"}, want: []string{"--json"}, code: "JSON_UNSUPPORTED", json: true},
		{args: []string{"--version", "--json"}, want: []string{"--json"}, code: "JSON_UNSUPPORTED", json: true},
	}
	for _, tt := range tests {
		t.Run(strings.Join(tt.args, " "), func(t *testing.T) {
			got, failure := parse(tt.args)
			if failure == nil || failure.Code != tt.code || got.json != tt.json {
				t.Fatalf("got %+v and %+v, want %s (json=%t)", got, failure, tt.code, tt.json)
			}
			for _, fragment := range tt.want {
				if !strings.Contains(failure.Message, fragment) {
					t.Errorf("message %q does not contain %q", failure.Message, fragment)
				}
			}
		})
	}
}

func TestHelpAndVersionUseNoDataRoot(t *testing.T) {
	t.Setenv("HOME", "")
	t.Setenv(flavor.EnvHome, t.TempDir())
	for _, args := range [][]string{{"send", "-h"}, {"help", "send"}} {
		var stdout, stderr bytes.Buffer
		status := Main(args, &stdout, &stderr)
		if status != 0 || stderr.Len() != 0 {
			t.Fatalf("exit %d, stderr %q", status, &stderr)
		}
		page := stdout.String()
		for _, text := range []string{"Usage: " + flavor.Binary + " talk", "--detach", "--identity"} {
			if !strings.Contains(page, text) {
				t.Errorf("help missing %q", text)
			}
		}
		for _, text := range []string{"--wait", "--lines", "--version", "--config"} {
			if strings.Contains(page, text) {
				t.Errorf("help exposed %q", text)
			}
		}
	}
	var stdout, stderr bytes.Buffer
	if status := Main([]string{"-V"}, &stdout, &stderr); status != 0 || stdout.String() != flavor.Binary+" "+Version+"\n" || stderr.Len() != 0 {
		t.Fatalf("exit %d, stdout %q, stderr %q", status, &stdout, &stderr)
	}
}

func TestHiddenNamesAreReservedButAbsentFromHelp(t *testing.T) {
	for _, name := range []string{"__complete", "__digest-hook", "__focus-hook", "__native-install", "team"} {
		child := grammar.child(name)
		if child == nil || !child.hidden {
			t.Fatalf("hidden name %q was not reserved", name)
		}
		if _, failure := parse([]string{"help", name}); failure == nil || failure.Code != "USAGE_ERROR" {
			t.Fatalf("hidden name %q was available as a help topic", name)
		}
	}
}

func TestParseFailureOutputStreams(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if status := Main([]string{"name", "--json"}, &stdout, &stderr); status != 1 || stderr.Len() != 0 {
		t.Fatalf("exit %d, stderr %q", status, &stderr)
	}
	var failure struct {
		Error struct{ Code string }
	}
	if err := json.Unmarshal(stdout.Bytes(), &failure); err != nil || failure.Error.Code != "USAGE_ERROR" {
		t.Fatalf("stdout %q, JSON error %v", &stdout, err)
	}
	stdout.Reset()
	if status := Main([]string{"name"}, &stdout, &stderr); status != 1 || stdout.Len() != 0 || !strings.HasPrefix(stderr.String(), "error: ") {
		t.Fatalf("exit %d, stdout %q, stderr %q", status, &stdout, &stderr)
	}
}

func TestRunSeparatesLaunchOptionsFromProviderArguments(t *testing.T) {
	args := []string{"run", "--save", "codex", "--json", "--help", "--", string([]byte{0xff})}
	inv, failure := parse(args)
	if failure != nil || !inv.has("save") || inv.json || inv.help || !slices.Equal(inv.operands, args[2:]) {
		t.Fatalf("provider launch = %+v, %v", inv, failure)
	}
	for _, option := range []string{"-s", "--save", "--resume", "--help", "-", "--"} {
		_, failure := parse([]string{"run", "Worker", option})
		if failure == nil || failure.Code != "USAGE_ERROR" || !strings.Contains(failure.Message, "TMT options go before the name") {
			t.Fatalf("misplaced %q: failure = %+v", option, failure)
		}
	}
	_, failure = parse([]string{"run", "--resume", "Worker", "codex"})
	if failure == nil || failure.Code != "USAGE_ERROR" || !strings.Contains(failure.Message, "do not combine") {
		t.Fatalf("resume with explicit command: failure = %+v", failure)
	}
	_, failure = parse([]string{"run", string([]byte{0xff}), "codex"})
	if failure == nil || failure.Code != "USAGE_ERROR" || failure.Message != "Identity name must be valid UTF-8." {
		t.Fatalf("invalid name: failure = %+v", failure)
	}
}

func TestProviderHookIsHiddenAndDispatchesSilently(t *testing.T) {
	t.Setenv(flavor.EnvHome, t.TempDir())
	t.Setenv(hookLaunchEnv, "")
	inv, failure := parse([]string{"__hook", "claude", "--activity-only"})
	if failure != nil || !slices.Equal(inv.path, []string{"__hook"}) || !inv.has("activity-only") {
		t.Fatalf("hidden hook = %+v, %v", inv, failure)
	}
	if _, failure := parse([]string{"help", "__hook"}); failure == nil || failure.Code != "USAGE_ERROR" {
		t.Fatalf("hidden hook help = %+v", failure)
	}
	var stdout, stderr bytes.Buffer
	if status := Main([]string{"__hook", "claude"}, &stdout, &stderr); status != 0 || stdout.Len() != 0 || stderr.Len() != 0 {
		t.Fatalf("hook exit = %d, stdout = %q, stderr = %q", status, &stdout, &stderr)
	}
}

// Port the baked hook invocations and worker constraints from parser/tests/setup.rs.
func TestDigestHookGrammarMatchesNative(t *testing.T) {
	for _, command := range []string{"__digest-hook", "__focus-hook"} {
		for _, fixture := range []struct {
			provider string
			tail     []string
		}{
			{"claude", []string{"--launch", `{"identity_id":"pinned-scope"}`}},
			{"codex", []string{"--discover-launch"}},
			{"agy", []string{"--discover-launch"}},
			{"claude", []string{"--launch", "__focus-hook"}},
		} {
			for _, budget := range []string{"", "0", "999", "2000"} {
				args := append([]string{command, fixture.provider}, fixture.tail...)
				if budget != "" {
					args = append(args, "--worker", "--work-budget-ms", budget)
				}
				inv, failure := parse(args)
				if failure != nil || !slices.Equal(inv.path, []string{"__digest-hook"}) ||
					!slices.Equal(inv.operands, []string{fixture.provider}) {
					t.Fatalf("parse %q = %+v, %v", args, inv, failure)
				}
				if inv.has("worker") != (budget != "") || inv.has("work-budget-ms") != (budget != "") ||
					inv.options["work-budget-ms"] != budget {
					t.Fatalf("parse %q lost worker option presence: %+v", args, inv)
				}
				if len(fixture.tail) == 2 {
					if inv.options["launch"] != fixture.tail[1] || inv.has("discover-launch") {
						t.Fatalf("parse %q lost the exact launch value: %+v", args, inv)
					}
				} else if inv.has("launch") || !inv.has("discover-launch") {
					t.Fatalf("parse %q did not preserve discovery mode: %+v", args, inv)
				}
			}
		}
	}
	if inv, failure := parse([]string{"__digest-hook", "claude", "--launch", "{}", "--worker"}); failure != nil ||
		!inv.has("worker") || inv.has("work-budget-ms") {
		t.Fatalf("worker without explicit budget = %+v, %v", inv, failure)
	}
}

func TestDigestHookGrammarRejectsInvalidSourcesAndBudgets(t *testing.T) {
	reject := func(args ...string) {
		t.Helper()
		if _, failure := parse(args); failure == nil || failure.Code != "USAGE_ERROR" {
			t.Fatalf("parse %q = %v, want usage error", args, failure)
		}
	}
	reject("__digest-hook")
	reject("__digest-hook", "claude")
	reject("__digest-hook", "claude", "--launch", "{}", "--discover-launch")
	reject("__digest-hook", "claude", "--launch", "{}", "--launch", "{}")
	reject("__digest-hook", "claude", "--launch", "{}", "--activity-only")
	reject("__digest-hook", "claude", "--discover-launch", "--activity-only")
	reject("__digest-hook", "gemini", "--discover-launch")
	reject("__digest-hook", "pi", "--discover-launch")
	reject("__digest-hook", "codex", "--discover-launch", "--work-budget-ms", "1")
	for _, budget := range []string{"", "-1", "+1", "1.5", "1s", "2001", "18446744073709551616"} {
		reject("__digest-hook", "codex", "--discover-launch", "--worker", "--work-budget-ms="+budget)
	}
}

// Port the Remote pin and passthrough constraints from parser/tests/messaging.rs.
func TestTalkAdmissionMatchesNativeRemoteAndPassthroughOptions(t *testing.T) {
	const id = "7f0c2f2e-2b1a-4c1e-9d2a-0a1b2c3d4e5f"
	for _, args := range [][]string{
		{"talk", "reviewer", "hello", "--remote", "bob", "--identity", "ben", "--detach"},
		{"send", id, "hello", "--remote", "bob", "--expect-name", "reviewer"},
		{"talk", "peer", "hello", "--passthrough", "--detach", "--urgent", "--identity", "ben"},
	} {
		if _, failure := parse(args); failure != nil {
			t.Fatalf("%q: %v", args, failure)
		}
	}
	reject := func(want string, args ...string) {
		t.Helper()
		if _, failure := parse(args); failure == nil || failure.Code != "USAGE_ERROR" || !strings.Contains(failure.Message, want) {
			t.Fatalf("%q: %v, want usage diagnostic containing %q", args, failure, want)
		}
	}
	reject("needs --remote", "talk", id, "hello", "--expect-name", "reviewer")
	reject("A UUID target needs --expect-name", "talk", id, "hello", "--remote", "bob")
	reject("--expect-name is only for a UUID", "talk", "reviewer", "hello", "--remote", "bob", "--expect-name", "reviewer")
	for _, option := range [][]string{{"--passthrough"}, {"--urgent"}, {"--no-preamble"}, {"--timeout", "5"}, {"--delay", "5"}, {"--room", "design"}, {"--kind", "review"}} {
		reject("--remote sends one request through Remote", append([]string{"talk", "reviewer", "hello", "--remote", "bob"}, option...)...)
	}
	for _, option := range [][]string{{"--timeout", "5"}, {"--room", "design"}, {"--no-preamble"}} {
		reject("--passthrough sends the message as typed", append([]string{"talk", "peer", "hello", "--passthrough"}, option...)...)
	}
}
