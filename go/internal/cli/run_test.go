package cli

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

func TestRunBindsAndPreparesProviderBeforeForegroundLaunch(t *testing.T) {
	server := tmuxtest.Start(t)
	root := t.TempDir()
	t.Setenv(flavor.EnvHome, root)
	provider := filepath.Join(t.TempDir(), "codex")
	if err := os.WriteFile(provider, []byte("#!/bin/sh\nexit 99\n"), 0700); err != nil {
		t.Fatal(err)
	}
	pane := strings.TrimSpace(server.Run("display-message", "-p", "#{pane_id}"))
	pid := strings.TrimSpace(server.Run("display-message", "-p", "-t", pane, "#{pid}"))
	const nativeMarker = "native marker must survive"
	server.Run("set-option", "-p", "-t", pane, otherFlavorTMUXOption("agent"), nativeMarker)
	app := systemApplication()
	app.caller.lookup = func(key string) (string, bool) {
		switch key {
		case "TMUX":
			return server.Socket + "," + pid + ",0", true
		case "TMUX_PANE":
			return pane, true
		}
		return "", false
	}
	var launched bool
	app.launch = func(ctx context.Context, found home.Root, store ports.Store, entry bindingEntry, plan runPlan, _, _ io.Writer) int {
		launched = true
		if found.Dir != root || entry.identity.Name != "Worker" || entry.identity.Lifetime != core.LifetimeSaved ||
			entry.binding.PaneID != pane || entry.binding.Server.Socket != server.Socket || plan.provider != "codex" ||
			plan.command.Path != provider || !strings.Contains(strings.Join(plan.command.Args, " "), "--model provider-owned") {
			t.Fatalf("foreground launch received %+v, %+v, %+v", found, entry, plan)
		}
		if err := store.Read(ctx, func(tx ports.StoreTx) error {
			binding, err := tx.Bindings().FindByIdentity(entry.identity.ID)
			if err == nil && (binding == nil || binding.ID != entry.binding.ID) {
				return errors.New("foreground launch did not receive a committed binding")
			}
			return err
		}); err != nil {
			t.Fatal(err)
		}
		if native := server.Run("show-options", "-p", "-v", "-t", pane, otherFlavorTMUXOption("agent")); native != nativeMarker+"\n" {
			t.Fatalf("native pane marker changed: %q", native)
		}
		return 7
	}
	var stdout, stderr bytes.Buffer
	if status := app.run(t.Context(), []string{"run", "--save", "Worker", provider, "--model", "provider-owned"}, &stdout, &stderr); status != 7 ||
		!launched || stderr.Len() != 0 {
		t.Fatalf("run exit=%d launched=%t stdout=%q stderr=%q", status, launched, &stdout, &stderr)
	}
}

type foregroundEndFixture struct {
	ports.Store
	ports.StoreTx
	ports.BindingRepo
	current core.Binding
	ends    []ports.LaunchEnd
}

func (f *foregroundEndFixture) Write(_ context.Context, fn func(ports.StoreTx) error) error {
	return fn(f)
}
func (f *foregroundEndFixture) Bindings() ports.BindingRepo { return f }
func (f *foregroundEndFixture) FindByIdentity(id core.IdentityID) (*core.Binding, error) {
	if f.current.IdentityID != id {
		return nil, nil
	}
	return &f.current, nil
}
func (f *foregroundEndFixture) EndLaunch(end ports.LaunchEnd) (bool, error) {
	f.ends = append(f.ends, end)
	return reflect.DeepEqual(end.Expected, f.current), nil
}

func TestForegroundExitRefreshesOnlyExactLateAdmission(t *testing.T) {
	owner := core.ProcessIncarnation{PID: 120, StartIdentity: "owner"}
	runtime := core.ProcessIncarnation{PID: 121, StartIdentity: "runtime"}
	original := core.Binding{ID: "binding", IdentityID: "member", PaneID: "%1",
		Session: core.BindingSessionState{RuntimeState: "running", LaunchOwner: &owner, Runtime: &runtime}}
	session, transition := "late-session", "started"
	for _, test := range []struct {
		name   string
		change func(*core.Binding)
		match  bool
	}{
		{"exact late session", func(*core.Binding) {}, true},
		{"exact late resume", func(b *core.Binding) { resumed := "resumed"; b.Session.LastTransition = &resumed }, true},
		{"different binding", func(b *core.Binding) { b.ID = "replacement" }, false},
		{"different pane", func(b *core.Binding) { b.PaneID = "%2" }, false},
		{"same PID reused", func(b *core.Binding) {
			b.Session.Runtime = &core.ProcessIncarnation{PID: runtime.PID, StartIdentity: "new-runtime"}
		}, false},
		{"different owner", func(b *core.Binding) {
			b.Session.LaunchOwner = &core.ProcessIncarnation{PID: owner.PID, StartIdentity: "new-owner"}
		}, false},
		{"different transition", func(b *core.Binding) { ended := "ended"; b.Session.LastTransition = &ended }, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			current := original
			current.Session.ProviderSessionID, current.Session.LastTransition = &session, &transition
			test.change(&current)
			store := &foregroundEndFixture{current: current}
			if err := settleForeground(t.Context(), store, original); err != nil {
				t.Fatal(err)
			}
			expected := original
			if test.match {
				expected = current
			}
			if len(store.ends) != 1 || !reflect.DeepEqual(store.ends[0].Expected, expected) ||
				store.ends[0].Owner != owner || store.ends[0].Runtime != runtime {
				t.Fatalf("end launch = %+v, want exact owner/runtime and %+v", store.ends, expected)
			}
		})
	}
}

func TestReapedLauncherSettlesOnlyAGoneForeground(t *testing.T) {
	const launcherPID = 320
	const start = "ps-v1:Sat Jan 1 00:00:00 2000"
	const newStart = "ps-v1:Sun Jan 2 00:00:00 2000"
	owner := core.ProcessIncarnation{PID: 319, StartIdentity: start}
	for _, tc := range []struct {
		name       string
		pid        int
		state      runtime.Observation
		probeError error
		wantEnd    bool
	}{
		{name: "direct child was reaped", pid: launcherPID, wantEnd: true},
		{name: "distinct foreground still live", pid: 321, state: runtime.Observation{
			State: runtime.Alive, Incarnation: runtime.Incarnation{PID: 321, Start: start},
		}},
		{name: "distinct foreground unknown", pid: 321},
		{name: "distinct foreground gone", pid: 321, state: runtime.Observation{State: runtime.Gone}, wantEnd: true},
		{name: "distinct PID reused", pid: 321, state: runtime.Observation{
			State: runtime.Alive, Incarnation: runtime.Incarnation{PID: 321, Start: newStart},
		}, wantEnd: true},
		{name: "failed proof cannot settle", pid: 321, state: runtime.Observation{State: runtime.Gone},
			probeError: errors.New("cannot observe process")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorded := core.ProcessIncarnation{PID: uint64(tc.pid), StartIdentity: start}
			binding := core.Binding{ID: "binding", IdentityID: "member", PaneID: "%1",
				Session: core.BindingSessionState{RuntimeState: "running", LaunchOwner: &owner, Runtime: &recorded}}
			store := &foregroundEndFixture{current: binding}
			calls := 0
			observe := func(ctx context.Context, pid int) (runtime.Observation, error) {
				calls++
				if len(store.ends) != 0 || pid != tc.pid {
					t.Fatalf("observed PID %d with %d prior settlements", pid, len(store.ends))
				}
				if deadline, ok := ctx.Deadline(); !ok || ctx.Err() != nil || time.Until(deadline) > time.Second {
					t.Fatal("exit observation lacks the independent one-second bound")
				}
				return tc.state, tc.probeError
			}
			ctx, cancel := context.WithCancel(t.Context())
			cancel()
			if err := settleReapedForeground(ctx, store, binding, launcherPID, observe); err != nil {
				t.Fatal(err)
			}
			wantCalls := 1
			if tc.pid == launcherPID {
				wantCalls = 0
			}
			if calls != wantCalls || (len(store.ends) != 0) != tc.wantEnd {
				t.Fatalf("observations = %d, settlement = %+v", calls, store.ends)
			}
			if tc.wantEnd && (len(store.ends) != 1 || store.ends[0].Runtime != recorded) {
				t.Fatalf("settlement lost recorded runtime: %+v", store.ends)
			}
		})
	}
}
