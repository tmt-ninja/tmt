package cli

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type fakeHookLaunchStorage struct {
	creates []hookLaunchIntent
	accept  bool
	admit   func(hookLaunchIntent, core.ProcessIncarnation, uint64) (*core.Binding, error)
}

func (s *fakeHookLaunchStorage) createLaunchIntent(_ context.Context, intent hookLaunchIntent) (bool, error) {
	s.creates = append(s.creates, intent)
	return s.accept, nil
}

func (s *fakeHookLaunchStorage) admitLaunch(_ context.Context, intent hookLaunchIntent, runtime core.ProcessIncarnation, now uint64) (*core.Binding, error) {
	return s.admit(intent, runtime, now)
}

func TestPrepareHookLaunchScopesHooksAndRecordsIntentBeforeSpawn(t *testing.T) {
	root := home.Root{Dir: t.TempDir()}
	executable := filepath.Join(t.TempDir(), "tmt-go")
	if err := os.WriteFile(executable, []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
		t.Fatal(err)
	}
	start := hookStart
	binding := core.Binding{ID: "binding", IdentityID: "identity", PaneIncarnation: &start}
	owner := core.ProcessIncarnation{PID: 52, StartIdentity: start}
	now := time.Unix(1700000000, 0)
	for _, tc := range []struct {
		name     string
		provider string
		args     []string
		accept   bool
		hooks    bool
		idle     bool
	}{
		{"empty Claude launcher", "claude", []string{"--model", "selected"}, true, true, true},
		{"Claude initial prompt", "claude", []string{"--", "initial prompt"}, true, true, false},
		{"plain Codex fixture", "codex", []string{"--no-daemon"}, true, false, false},
		{"plain Gemini", "gemini", nil, true, false, false},
		{"stale binding", "claude", nil, false, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeHookLaunchStorage{accept: tc.accept}
			c := hookLaunchCoordinator{storage: store, now: func() time.Time { return now }}
			input := ports.ProcessSpec{Path: "/bin/sh", Args: tc.args, Env: []string{hookLaunchEnv + "=old", "TMT_EXECUTABLE=/old/tmt"}}
			command, intent, err := c.prepare(t.Context(), root, binding, tc.provider, input, owner, executable, true)
			if len(store.creates) != 1 || store.creates[0].expected.ID != binding.ID ||
				store.creates[0].owner != owner || store.creates[0].provider != tc.provider ||
				store.creates[0].createdAtMs != uint64(now.UnixMilli()) ||
				store.creates[0].expiresAtMs != uint64(now.Add(hookLaunchLifetime).UnixMilli()) {
				t.Fatalf("launch intents = %+v", store.creates)
			}
			if !tc.accept {
				if !errors.Is(err, errHookLaunchChanged) || intent != nil || command.Path != "" {
					t.Fatalf("stale prepare returned command %q, intent %+v, error %v", command.Path, intent, err)
				}
				return
			}
			if err != nil || intent == nil || command.Path != input.Path || !slices.Contains(command.Env, "TMT_EXECUTABLE="+executable) ||
				!slices.Contains(command.Env, home.EnvHome+"="+root.Dir) || !slices.Contains(input.Env, hookLaunchEnv+"=old") {
				t.Fatalf("prepared command path %q, intent %+v, error %v", command.Path, intent, err)
			}
			found := false
			for _, entry := range command.Env {
				if raw, ok := strings.CutPrefix(entry, hookLaunchEnv+"="); ok {
					got, valid := decodeHookCoordinates(raw)
					if found || !valid || got.BindingID != binding.ID || got.IdentityID != binding.IdentityID ||
						got.Owner != owner || got.StartupInput != tc.idle {
						t.Fatalf("callback coordinates = %+v, valid = %t", got, valid)
					}
					found = true
				}
			}
			if found != tc.hooks || slices.Contains(command.Args, "--settings") != tc.hooks {
				t.Fatalf("callback env present = %t, argv = %q", found, command.Args)
			}
		})
	}
}

func TestAdmitHookLaunchDoesNotRenewOrRecoverStaleIntent(t *testing.T) {
	binding := core.Binding{ID: "binding"}
	main := core.ProcessIncarnation{PID: 21, StartIdentity: hookStart}
	now := time.UnixMilli(180)
	intent := &hookLaunchIntent{expected: binding, provider: "codex", createdAtMs: 100, expiresAtMs: 190}
	calls := 0
	store := &fakeHookLaunchStorage{admit: func(sent hookLaunchIntent, process core.ProcessIncarnation, clock uint64) (*core.Binding, error) {
		calls++
		if sent != *intent || process != main || clock != 180 {
			t.Fatalf("admit got intent %+v, process %+v, time %d", sent, process, clock)
		}
		return &binding, nil
	}}
	c := hookLaunchCoordinator{storage: store, now: func() time.Time { return now }}
	if got, err := c.admit(t.Context(), intent, main); err != nil || got != &binding {
		t.Fatalf("admit = %+v, %v", got, err)
	}
	now = time.UnixMilli(190)
	if got, err := c.admit(t.Context(), intent, main); !errors.Is(err, errHookLaunchChanged) || got != nil || calls != 1 {
		t.Fatalf("expired admit = %+v, %v, writes %d", got, err, calls)
	}
}
