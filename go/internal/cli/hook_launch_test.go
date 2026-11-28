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

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type fakeHookLaunchStore struct {
	ports.Store
	repo fakeHookLaunchRepo
}

func (s *fakeHookLaunchStore) Write(_ context.Context, fn func(ports.StoreTx) error) error {
	return fn(fakeHookLaunchTx{repo: &s.repo})
}

type fakeHookLaunchTx struct {
	ports.StoreTx
	repo *fakeHookLaunchRepo
}

func (tx fakeHookLaunchTx) Bindings() ports.BindingRepo { return tx.repo }

type fakeHookLaunchRepo struct {
	ports.BindingRepo
	creates   []ports.LaunchIntent
	accept    bool
	createErr error
	admit     func(ports.LaunchAdmission) (*core.Binding, error)
}

func (r *fakeHookLaunchRepo) CreateLaunchIntent(intent ports.LaunchIntent) (bool, error) {
	r.creates = append(r.creates, intent)
	return r.accept, r.createErr
}

func (r *fakeHookLaunchRepo) AdmitLaunch(admission ports.LaunchAdmission) (*core.Binding, error) {
	return r.admit(admission)
}

func TestPrepareHookLaunchScopesHooksAndRecordsIntentBeforeSpawn(t *testing.T) {
	root := home.Root{Dir: t.TempDir()}
	executable := filepath.Join(t.TempDir(), flavor.Binary)
	if err := os.WriteFile(executable, []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
		t.Fatal(err)
	}
	start := hookStart
	binding := core.Binding{ID: "binding", IdentityID: "identity", PaneIncarnation: &start}
	owner := core.ProcessIncarnation{PID: 52, StartIdentity: start}
	now := time.Unix(1700000000, 0)
	for _, tc := range []struct {
		name     string
		provider core.DriverName
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
			store := &fakeHookLaunchStore{repo: fakeHookLaunchRepo{accept: tc.accept}}
			c := hookLaunchCoordinator{store: store, now: func() time.Time { return now }}
			input := ports.ProcessSpec{Path: "/bin/sh", Args: tc.args, Env: []string{hookLaunchEnv + "=old", "TMT_EXECUTABLE=/old/tmt"}}
			command, intent, err := c.prepare(t.Context(), root, binding, tc.provider, input, owner, executable, true, nil)
			if len(store.repo.creates) != 1 || store.repo.creates[0].Expected.ID != binding.ID ||
				store.repo.creates[0].Resume != nil || store.repo.creates[0].Owner != owner || store.repo.creates[0].Driver != tc.provider ||
				store.repo.creates[0].CreatedAtMs != uint64(now.UnixMilli()) ||
				store.repo.creates[0].ExpiresAtMs != uint64(now.Add(hookLaunchLifetime).UnixMilli()) {
				t.Fatalf("launch intents = %+v", store.repo.creates)
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
			if tc.provider == core.DriverCodex && !slices.Equal(command.Args, []string{"--add-dir", root.Dir, "--no-daemon"}) {
				t.Fatalf("managed Codex launch = %q", command.Args)
			}
		})
	}
}

func TestAdmitHookLaunchDoesNotRenewOrRecoverStaleIntent(t *testing.T) {
	binding := core.Binding{ID: "binding"}
	main := core.ProcessIncarnation{PID: 21, StartIdentity: hookStart}
	now := time.UnixMilli(180)
	intent := &hookLaunchIntent{Expected: binding, Driver: core.DriverCodex, CreatedAtMs: 100, ExpiresAtMs: 190}
	calls := 0
	store := &fakeHookLaunchStore{repo: fakeHookLaunchRepo{admit: func(sent ports.LaunchAdmission) (*core.Binding, error) {
		calls++
		if sent.Intent != *intent || sent.Runtime != main || sent.ObservedAtMs != 180 {
			t.Fatalf("admit = %+v", sent)
		}
		return &binding, nil
	}}}
	c := hookLaunchCoordinator{store: store, now: func() time.Time { return now }}
	if got, err := c.admit(t.Context(), intent, main); err != nil || got != &binding {
		t.Fatalf("admit = %+v, %v", got, err)
	}
	now = time.UnixMilli(190)
	if got, err := c.admit(t.Context(), intent, main); !errors.Is(err, errHookLaunchChanged) || got != nil || calls != 1 {
		t.Fatalf("expired admit = %+v, %v, writes %d", got, err, calls)
	}
}

func TestHookLaunchCoordinatorPersistsExactRuntime(t *testing.T) {
	for _, provider := range []core.DriverName{core.DriverClaude, core.DriverCodex} {
		t.Run(string(provider), func(t *testing.T) {
			ctx := t.Context()
			dir := t.TempDir()
			root := home.Root{Dir: dir, Database: filepath.Join(dir, home.DatabaseName)}
			store, err := storage.Open(ctx, root)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = store.Close() })
			exe := filepath.Join(dir, flavor.Binary)
			if err := os.WriteFile(exe, []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
				t.Fatal(err)
			}

			identity := core.Identity{ID: "04de7153-8b12-4665-8fba-718e358fa68c",
				Name: "Fixture", CanonicalName: "fixture", Lifetime: core.LifetimeSaved}
			owner := core.ProcessIncarnation{PID: 12, StartIdentity: hookStart}
			child := core.ProcessIncarnation{PID: 13, StartIdentity: hookStart}
			paneStart := hookStart
			reservation := core.BindingReservation{
				Target: core.Binding{ID: "6c57fcc9-96b1-4022-b071-870b81288814", IdentityID: identity.ID,
					PaneID: "%1", PanePID: 14, PaneIncarnation: &paneStart,
					Server: core.ServerEvidence{Host: "tmux", ID: "server-id", Socket: "/test/private", PID: 15, StartTime: "1700000000"}},
				Publisher: owner, CreatedAtMs: 2000, ExpiresAtMs: 3000,
			}
			var binding *core.Binding
			err = store.Write(ctx, func(tx ports.StoreTx) error {
				if err := tx.Identities().Insert(identity, 1000); err != nil {
					return err
				}
				ok, err := tx.Bindings().Reserve(reservation, nil)
				if err == nil && !ok {
					return errors.New("fixture reservation refused")
				}
				if err != nil {
					return err
				}
				binding, err = tx.Bindings().Activate(reservation, nil, 2100)
				return err
			})
			if err != nil || binding == nil {
				t.Fatalf("fixture binding = %+v, %v", binding, err)
			}

			now := time.UnixMilli(2200)
			c := hookLaunchCoordinator{store: store, now: func() time.Time { return now }}
			_, intent, err := c.prepare(ctx, root, *binding, provider, ports.ProcessSpec{Path: "/bin/sh"}, owner, exe, true, nil)
			if err != nil || intent == nil {
				t.Fatalf("prepare intent = %+v, %v", intent, err)
			}
			const providerSession = "verified-claude-session"
			if provider == core.DriverClaude {
				err := store.Write(ctx, func(tx ports.StoreTx) error {
					ok, err := tx.Bindings().ObserveLaunchActivity(ports.LaunchActivityObservation{
						Expected: *binding, Owner: owner, Runtime: child, ProviderSession: providerSession,
						Transition: core.LaunchTransitionStarted, ObservedAtMs: 2300, InitialIdle: true,
					})
					if err == nil && !ok {
						return errors.New("fixture startup observation refused")
					}
					return err
				})
				if err != nil {
					t.Fatal(err)
				}
			}
			now = time.UnixMilli(2400)
			got, err := c.admit(ctx, intent, child)
			if err != nil || got == nil || got.ID != binding.ID || got.Session.RuntimeState != "running" ||
				got.Session.Runtime == nil || *got.Session.Runtime != child ||
				got.Session.LaunchOwner == nil || *got.Session.LaunchOwner != owner {
				t.Fatalf("admitted binding = %+v, %v", got, err)
			}
			session := got.Session.ProviderSessionID
			if provider == core.DriverClaude && (session == nil || *session != providerSession) ||
				provider == core.DriverCodex && session != nil {
				t.Fatalf("admitted provider session = %v", session)
			}
			if again, err := c.admit(ctx, intent, child); again != nil || !errors.Is(err, errHookLaunchChanged) {
				t.Fatalf("repeated admit = %+v, %v", again, err)
			}
		})
	}
}

func TestHookLaunchResumePassesFenceAndPreservesTypedFailures(t *testing.T) {
	root := home.Root{Dir: t.TempDir()}
	executable := filepath.Join(root.Dir, flavor.Binary)
	if err := os.WriteFile(executable, []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
		t.Fatal(err)
	}
	binding := core.Binding{ID: "binding", IdentityID: "identity", PaneIncarnation: new(hookStart)}
	owner := core.ProcessIncarnation{PID: 52, StartIdentity: hookStart}
	expectation := &core.ResumeExpectation{ProviderSession: "exact-session"}
	store := &fakeHookLaunchStore{repo: fakeHookLaunchRepo{accept: true}}
	c := hookLaunchCoordinator{store: store, now: func() time.Time { return time.UnixMilli(100) }}
	prepare := func() (*hookLaunchIntent, error) {
		_, intent, err := c.prepare(t.Context(), root, binding, core.DriverCodex,
			ports.ProcessSpec{Path: "/bin/sh"}, owner, executable, true, expectation)
		return intent, err
	}
	intent, err := prepare()
	if err != nil || intent == nil || intent.Resume != expectation || store.repo.creates[0].Resume != expectation {
		t.Fatalf("intent = %+v, error = %v", intent, err)
	}
	rejected := &core.RequestFailure{Code: "RUNTIME_CONFLICT", Status: 5, Reason: "fixture"}
	store.repo.createErr = rejected
	if _, err := prepare(); err != rejected {
		t.Fatalf("prepare error = %v", err)
	}
	store.repo.createErr, store.repo.accept = nil, false
	if _, err := prepare(); !isResumeDrift(err) {
		t.Fatalf("refused prepare error = %v", err)
	}

	main := core.ProcessIncarnation{PID: 53, StartIdentity: hookStart}
	store.repo.admit = func(sent ports.LaunchAdmission) (*core.Binding, error) {
		if sent.Intent.Resume != expectation {
			t.Fatalf("admit lost expectation: %+v", sent.Intent)
		}
		return nil, rejected
	}
	if _, err := c.admit(t.Context(), intent, main); err != rejected {
		t.Fatalf("admit error = %v", err)
	}
	store.repo.admit = func(ports.LaunchAdmission) (*core.Binding, error) { return nil, nil }
	if _, err := c.admit(t.Context(), intent, main); !isResumeDrift(err) ||
		!strings.Contains(err.Error(), "Inspect the pane") {
		t.Fatalf("refused admission error = %v", err)
	}
}

func isResumeDrift(err error) bool {
	var failure *core.RequestFailure
	return errors.As(err, &failure) && failure.Code == "RUNTIME_CONFLICT" && failure.Status == 5 && failure.Reason == "resume_drift"
}
