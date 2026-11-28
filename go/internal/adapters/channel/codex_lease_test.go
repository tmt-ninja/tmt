//go:build darwin || linux

package channel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const fixtureCodexThread = "60000000-0000-4000-8000-000000000001"

func TestCodexFreshLeasePinsOriginalChildAndThreadAfterAdmission(t *testing.T) {
	for _, mode := range []string{"fresh", "resume", "wrong resume"} {
		t.Run(mode, func(t *testing.T) {
			in := fixtureEnrollment(t)
			in.Binding.Server.ID = "40000000-0000-4000-8000-000000000001"
			in.Probe.Server = in.Binding.Server
			marker := in.Binding.Marker(in.Identity)
			in.Probe.Panes[0].Marker = &marker
			runner := process.Runner{}
			observer := runtime.Observer{Process: runner}
			start, err := observer.Observe(t.Context(), os.Getpid())
			if err != nil || start.State != runtime.Alive {
				t.Fatalf("test launcher incarnation = %+v, %v", start, err)
			}
			in.LaunchOwner = core.ProcessIncarnation{PID: uint64(os.Getpid()), StartIdentity: start.Incarnation.Start}
			selected := fixtureOwnedCodexEndpoint(t, in.Root.Dir, mode)
			resume := ""
			if mode != "fresh" {
				resume = fixtureCodexThread
				selected.Args = []string{"resume", resume}
			}
			plan, err := PlanCodexLaunch(selected, in.Root.Dir, resume)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			t.Setenv("CODEX_HOME", filepath.Join(in.Root.Dir, "fake-provider-home"))
			qualified, _, err := PreflightCodexPlan(ctx, runner, in.Root, plan)
			if err != nil {
				t.Fatal(err)
			}
			supervisor, err := EnrollCodex(ctx, runner, CodexEnrollment{
				Root: in.Root, Identity: in.Identity, Binding: in.Binding, Probe: in.Probe,
				LaunchOwner: in.LaunchOwner, Plan: qualified, ClientVersion: "fixture",
				TMTExecutable: codexSupervisorFixtureExecutable(t, in.Root.Dir),
			})
			if mode == "wrong resume" {
				if supervisor != nil || !errors.Is(err, ErrEnrollment) {
					t.Fatalf("wrong resume = %t, %v", supervisor != nil, err)
				}
				dir, dirErr := openCodexDir(in.Root, false)
				if dirErr != nil {
					t.Fatal(dirErr)
				}
				defer dir.close()
				if record, readErr := dir.readCodex(testBinding); readErr != nil || record != nil {
					t.Fatalf("failed no-child enrollment was retained: %+v, %v", record, readErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = supervisor.Close() })
			lease := supervisor.lease
			dir, err := openCodexDir(in.Root, false)
			if err != nil {
				t.Fatal(err)
			}
			defer dir.close()
			pending, err := dir.readCodex(testBinding)
			if err != nil || pending == nil || pending.Foreground.Process != nil ||
				(resume == "" && (pending.Fresh == nil || pending.Fresh.Thread != nil || pending.Ready != nil)) ||
				(resume != "" && (pending.Ready == nil || pending.Ready.Thread != resume)) {
				t.Fatalf("pre-spawn record = %+v, %v", pending, err)
			}
			raw, err := dir.readPrivate(testBinding+".json", codexRecordLimit)
			if err != nil || bytes.Contains(raw, []byte(lease.endpoint.token)) ||
				!slices.Contains(supervisor.Command().Env, codexTokenEnv+"="+lease.endpoint.token) ||
				slices.Contains(supervisor.Command().Args, lease.endpoint.token) {
				t.Fatal("capability did not stay in the generation and child environment")
			}
			child := exec.Command("/bin/sleep", "30")
			if err := child.Start(); err != nil {
				t.Fatal(err)
			}
			reaped := false
			defer func() {
				if !reaped {
					_ = child.Process.Kill()
					_ = child.Wait()
				}
			}()
			observed, err := observer.Observe(ctx, child.Process.Pid)
			if err != nil || observed.State != runtime.Alive {
				t.Fatalf("foreground incarnation = %+v, %v", observed, err)
			}
			foreground := core.ProcessIncarnation{PID: uint64(child.Process.Pid), StartIdentity: observed.Incarnation.Start}
			thread, err := supervisor.ForegroundStarted(ctx, foreground)
			if err != nil || thread != fixtureCodexThread {
				t.Fatalf("foreground candidate = %q, %v", thread, err)
			}
			if err := supervisor.ForegroundAdmitted(ctx, in.Identity, in.Binding, in.Probe); !errors.Is(err, ErrEnrollment) {
				t.Fatalf("uncommitted foreground got readiness: %v", err)
			}
			if resume == "" {
				record, err := dir.readCodex(testBinding)
				if err != nil || record == nil || record.Ready != nil || record.Fresh == nil ||
					record.Fresh.Thread == nil || *record.Fresh.Thread != thread {
					t.Fatalf("candidate bypassed committed admission: %+v, %v", record, err)
				}
			}
			in.Binding.Session = core.BindingSessionState{RuntimeState: "running", Runtime: &foreground, LaunchOwner: &in.LaunchOwner}
			if err := supervisor.ForegroundAdmitted(ctx, in.Identity, in.Binding, in.Probe); !errors.Is(err, ErrEnrollment) {
				t.Fatalf("sessionless admission published readiness: %v", err)
			}
			in.Binding.Session.ProviderSessionID = new("70000000-0000-4000-8000-000000000001")
			if err := supervisor.ForegroundAdmitted(ctx, in.Identity, in.Binding, in.Probe); !errors.Is(err, ErrEnrollmentChanged) {
				t.Fatalf("different session published readiness: %v", err)
			}
			in.Binding.Session.ProviderSessionID = &thread
			if err := supervisor.ForegroundAdmitted(ctx, in.Identity, in.Binding, in.Probe); err != nil {
				t.Fatal(err)
			}
			if resume == "" {
				if err := supervisor.ForegroundAdmitted(ctx, in.Identity, in.Binding, in.Probe); !errors.Is(err, ErrEnrollmentChanged) {
					t.Fatalf("fresh readiness published a second time: %v", err)
				}
			}
			record, err := dir.readCodex(testBinding)
			if err != nil || record == nil || record.Ready == nil || record.Ready.Thread != thread ||
				record.Foreground.Process == nil || *record.Foreground.Process != storedProcess(foreground) {
				t.Fatalf("ready = %+v, %v", record, err)
			}
			send := CodexDelivery{Root: in.Root, Binding: in.Binding, Identity: in.Identity, Probe: in.Probe, Content: "exact fixture content", Build: "fixture"}
			send.Binding.Session.ProviderSessionID = new("60000000-0000-4000-8000-000000000002")
			if got := SendCodex(ctx, runner, send); got != denied(ChannelMismatch) {
				t.Fatalf("wrong-thread delivery = %+v", got)
			}
			send.Binding.Session.ProviderSessionID = &thread
			queries := 0
			changed := false
			replacing := codexDeliveryProcessFunc(func(ctx context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
				queries++
				if queries == 4 {
					// The second proof runs after app-server initialization.
					replacement := *record
					replacement.Generation = launchGeneration()
					if err := dir.writeCodex(replacement); err != nil {
						t.Fatal(err)
					}
					changed = true
				}
				return runner.Run(ctx, spec)
			})
			if got := SendCodex(ctx, replacing, send); !changed || got != denied(ChannelMismatch) {
				t.Fatalf("replacement during preparation: changed=%t, delivery=%+v", changed, got)
			}
			if err := dir.writeCodex(*record); err != nil {
				t.Fatal(err)
			}
			if got := SendCodex(ctx, runner, send); got != (SendResult{Outcome: SendQueued}) {
				t.Fatalf("exact queue delivery = %+v", got)
			}
			_ = child.Process.Kill()
			_ = child.Wait()
			reaped = true
			if err := supervisor.Withdraw(); err != nil {
				t.Fatal(err)
			}
			if record, err := dir.readCodex(testBinding); err != nil || record != nil {
				t.Fatalf("withdraw left a record: %+v, %v", record, err)
			}
			if _, err := os.Lstat(filepath.Join(ClaudeDirectory(in.Root), codexDirectory, lease.record.Generation)); !errors.Is(err, fs.ErrNotExist) {
				t.Fatalf("withdraw left the owned generation: %v", err)
			}
		})
	}
}

type codexDeliveryProcessFunc func(context.Context, ports.ProcessSpec) (ports.Bounded, error)

func (f codexDeliveryProcessFunc) Run(ctx context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
	return f(ctx, spec)
}

func TestCodexStaleLeaseCannotMutateReplacement(t *testing.T) {
	in := fixtureEnrollment(t)
	in.Binding.Server.ID = "40000000-0000-4000-8000-000000000001"
	owner := newCodexRecord(in.Identity, in.Binding, in.LaunchOwner)
	for _, field := range []string{"generation", "pid", "start"} {
		t.Run(field, func(t *testing.T) {
			dir, err := openCodexDir(in.Root, true)
			if err != nil {
				t.Fatal(err)
			}
			defer dir.close()
			replacement := owner
			switch field {
			case "generation":
				replacement.Generation = launchGeneration()
			case "pid":
				replacement.LaunchOwner.PID++
			case "start":
				replacement.LaunchOwner.Start = "ps-v1:Mon Jan 1 00:00:00 2001"
			}
			if err := dir.writeCodex(replacement); err != nil {
				t.Fatal(err)
			}
			if err := retireCodexRecord(t.Context(), in.Root, owner); !errors.Is(err, ErrEnrollmentChanged) {
				t.Fatalf("old lease retired different %s: %v", field, err)
			}
			if got, err := dir.readCodex(owner.BindingID); err != nil || got == nil || !got.sameLease(replacement) {
				t.Fatalf("replacement = %+v, %v", got, err)
			}
		})
	}
}

func fixtureOwnedCodexEndpoint(t *testing.T, root, mode string) ports.ProcessSpec {
	t.Helper()
	testBinary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "fake-codex-app")
	quoted := "'" + strings.ReplaceAll(testBinary, "'", "'\\''") + "'"
	script := "#!/bin/sh\nif [ \"$1\" = --version ]; then printf 'codex-cli 0.160.0\\n'; exit; fi\n" +
		"TMT_GO_CODEX_TEST_MODE='" + mode + "' exec " + quoted + " -test.run='^TestOwnedCodexFixtureProcess$' -- \"$@\"\n"
	if err := os.WriteFile(path, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	return ports.ProcessSpec{Path: path}
}

func TestOwnedCodexFixtureProcess(t *testing.T) {
	mode := os.Getenv("TMT_GO_CODEX_TEST_MODE")
	if mode == "" {
		return
	}
	tokenFile := ""
	for i, arg := range os.Args {
		if arg == "--ws-token-file" && i+1 < len(os.Args) {
			tokenFile = os.Args[i+1]
		}
	}
	token, err := os.ReadFile(tokenFile)
	if err != nil || !validCodexToken(string(token)) {
		t.Fatal("fixture missing private capability")
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	fmt.Fprintf(os.Stderr, "listening on: ws://%s\n", listener.Addr())
	var lists atomic.Int32
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+string(token) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		socket, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer socket.CloseNow()
		for {
			var request struct {
				ID     string
				Method string
				Params map[string]json.RawMessage
			}
			if err := fixtureRead(r.Context(), socket, &request); err != nil {
				return
			}
			var result map[string]any
			switch request.Method {
			case "initialize":
				result = map[string]any{"userAgent": "codex_cli_rs/0.160.0 (fixture)"}
			case "initialized":
				continue
			case "thread/loaded/list":
				threads := []string{}
				if lists.Add(1) > 1 {
					threads = append(threads, fixtureCodexThread)
				}
				result = map[string]any{"data": threads}
			case "thread/read":
				if codexString(request.Params["threadId"]) != fixtureCodexThread {
					return
				}
				result = map[string]any{"thread": map[string]any{"id": fixtureCodexThread, "cwd": cwd, "ephemeral": false}}
			case "thread/queue/add":
				if codexString(request.Params["threadId"]) != fixtureCodexThread {
					return
				}
				var input []map[string]string
				if json.Unmarshal(request.Params["input"], &input) != nil || len(input) != 1 ||
					input[0]["type"] != "text" || input[0]["text"] != "exact fixture content" {
					return
				}
				result = map[string]any{"queuedSubmission": map[string]any{
					"id": "fixture-queued", "clientUserMessageId": codexString(request.Params["clientUserMessageId"]), "input": input,
				}}
			case "thread/resume":
				if codexString(request.Params["threadId"]) != fixtureCodexThread {
					return
				}
				id := fixtureCodexThread
				if mode == "wrong resume" {
					id = "60000000-0000-4000-8000-000000000002"
				}
				result = map[string]any{"thread": map[string]any{"id": id}, "cwd": cwd}
			default:
				return
			}
			if err := fixtureWrite(r.Context(), socket, map[string]any{"id": request.ID, "result": result}); err != nil {
				return
			}
		}
	})}
	if err := server.Serve(listener); err != nil {
		t.Fatal(err)
	}
}

func TestCodexFreshThreadRequiresExplicitNonEphemeralMatch(t *testing.T) {
	for _, tc := range []struct {
		cwd       string
		ephemeral *bool
		want      bool
	}{
		{"/owned", new(false), true},
		{"/owned", nil, false},
		{"/owned", new(true), false},
		{"/other", new(false), false},
	} {
		thread := map[string]any{"id": fixtureCodexThread, "cwd": tc.cwd}
		if tc.ephemeral != nil {
			thread["ephemeral"] = *tc.ephemeral
		}
		raw, err := json.Marshal(thread)
		if err != nil {
			t.Fatal(err)
		}
		if ok := verifiedFreshCodexThread(map[string]json.RawMessage{"thread": raw}, "/owned", fixtureCodexThread); ok != tc.want {
			t.Errorf("fresh proof for %s: accepted %v, want %v", raw, ok, tc.want)
		}
	}
}
