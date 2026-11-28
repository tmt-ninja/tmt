package cli

import (
	"bytes"
	"context"
	"database/sql"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

func TestResumeUsesExactSnapshotThroughPrivateBinding(t *testing.T) {
	server := tmuxtest.Start(t)
	pane := strings.TrimSpace(server.Run("display-message", "-p", "#{pane_id}"))
	pid := strings.TrimSpace(server.Run("display-message", "-p", "-t", pane, "#{pid}"))
	world := t.TempDir()
	t.Setenv("HOME", world)
	t.Setenv(home.EnvHome, filepath.Join(world, "go"))
	t.Setenv("TMUX", server.Socket+","+pid+",0")
	t.Setenv("TMUX_PANE", pane)
	providers := t.TempDir()
	t.Setenv("PATH", providers+string(os.PathListSeparator)+os.Getenv("PATH"))
	for _, name := range []string{"claude", "codex"} {
		if err := os.WriteFile(filepath.Join(providers, name), []byte("#!/bin/sh\nexit 99\n"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	root, err := home.Resolve(os.LookupEnv, world)
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Error(err)
		}
	})
	const id core.IdentityID = "da3c6d1e-f088-4e0e-a839-7b126d4eb840"
	const session = "ed3e0815-19b0-468f-897d-c4217150d2df"
	if err := store.Write(t.Context(), func(tx ports.StoreTx) error {
		return tx.Identities().Insert(core.Identity{ID: id, Name: "Worker", CanonicalName: "worker", Lifetime: core.LifetimeSaved}, 1000)
	}); err != nil {
		t.Fatal(err)
	}

	app := systemApplication()
	app.store = store
	var launches []runPlan
	app.launch = func(ctx context.Context, _ home.Root, gotStore ports.Store, binding bindingEntry, plan runPlan, _, _ io.Writer) int {
		launches = append(launches, plan)
		if binding.identity == nil || binding.identity.ID != id || binding.binding == nil ||
			binding.binding.PaneID != pane || binding.binding.Server.Socket != server.Socket {
			t.Fatalf("launch received the wrong binding: %+v", binding)
		}
		if plan.resume == nil || plan.binding.resume == nil || plan.resume.IdentityID != id ||
			plan.resume.ProviderSession != session || plan.resume.Fence != plan.binding.resume.Fence {
			t.Fatalf("resume launch lost its original session fence: %+v", plan)
		}
		if err := gotStore.Read(ctx, func(tx ports.StoreTx) error {
			snapshot, err := tx.Bindings().ReadResume(id)
			if err == nil && (snapshot == nil || snapshot.Fence != plan.resume.Fence ||
				snapshot.PriorBinding == nil || snapshot.PriorBinding.ID != binding.binding.ID) {
				t.Fatal("binding publication did not preserve the saved-session fence")
			}
			return err
		}); err != nil {
			t.Fatal(err)
		}
		return 17
	}
	run := func(status int, args ...string) (string, string) {
		t.Helper()
		var out, diagnostic bytes.Buffer
		if got := app.run(t.Context(), args, &out, &diagnostic); got != status {
			t.Fatalf("%v exit %d, want %d, stdout %q, stderr %q", args, got, status, &out, &diagnostic)
		}
		return out.String(), diagnostic.String()
	}
	if out, diagnostic := run(0, "resume", "--show", string(id)); out != "{\n  \"identity\": \"Worker\",\n  \"launch\": null\n}\n" || diagnostic != "" {
		t.Fatalf("resume show stdout=%q stderr=%q", out, diagnostic)
	}
	if out, diagnostic := run(1, "resume", "Worker"); out != "" || !strings.Contains(diagnostic, "Worker has no remembered session to resume. Start fresh with: tmt-go run Worker") {
		t.Fatalf("resume without a saved session stdout=%q stderr=%q", out, diagnostic)
	}
	if got := server.Run("show-options", "-sqv", tmux.ServerIDOption); got != "" {
		t.Fatalf("missed resume initialized the private server: %q", got)
	}

	// Seed legacy preferences in the private database so both command aliases
	// consume the same typed snapshot that would come from native storage.
	db, err := sql.Open("sqlite", root.Database)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	change := func(statement string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(t.Context(), statement, args...); err != nil {
			t.Fatal(err)
		}
	}
	change(`INSERT INTO identity_session_preferences
		(identity_id,preferred_harness,remembered_harness,runtime_mode,provider_session_id,channel)
		VALUES(?,'codex','codex','shared',?,1)`, id, session)
	if _, diagnostic := run(1, "run", "--resume", string(id)); !strings.Contains(diagnostic, "requires a provider channel") || len(launches) != 0 {
		t.Fatalf("enrolled resume was launched or misreported: %q", diagnostic)
	}
	change(`UPDATE identity_session_preferences SET channel=0 WHERE identity_id=?`, id)
	change(`UPDATE identity_session_preferences SET stale_at_ms=2000 WHERE identity_id=?`, id)
	if _, diagnostic := run(1, "resume", "Worker"); !strings.Contains(diagnostic, "session looked gone") || len(launches) != 0 {
		t.Fatalf("stale resume was launched or misreported: %q", diagnostic)
	}
	change(`UPDATE identity_session_preferences SET stale_at_ms=NULL WHERE identity_id=?`, id)
	if out, diagnostic := run(17, "run", "--resume", string(id)); out != "" || diagnostic != "" ||
		len(launches) != 1 || launches[0].provider != "codex" || !slices.Equal(launches[0].command.Args, []string{"resume", session, "--no-daemon"}) {
		t.Fatalf("Codex resume = %+v, %q, %q", launches, out, diagnostic)
	}
	change(`UPDATE identity_session_preferences SET remembered_harness='claude',runtime_mode='default' WHERE identity_id=?`, id)
	if out, diagnostic := run(17, "resume", "--model", "test-model"); out != "" || diagnostic != "" ||
		len(launches) != 2 || launches[1].provider != "claude" ||
		!slices.Equal(launches[1].command.Args, []string{"--resume", session, "--model", "test-model"}) {
		t.Fatalf("Claude resume = %+v, %q, %q", launches, out, diagnostic)
	}
	change(`INSERT INTO identity_metadata(identity_id,key,value) VALUES(?,'resume.launch',?)`, id, `{
		"executable":"claude","model":"test-model","effort":null,"env":{},
		"binding":"d092a9fe-c775-455d-9217-135450d5061a","owner_pid":42,
		"owner_start":"ps-v1:Sat Jan 1 00:00:00 2000","harness":"claude",
		"session":"`+session+`"}`)
	const preset = `{
  "identity": "Worker",
  "launch": {
    "executable": "claude",
    "model": "test-model",
    "effort": null,
    "env": {},
    "associated": true
  }
}
`
	if out, diagnostic := run(0, "resume", "--show", "Worker"); out != preset || diagnostic != "" {
		t.Fatalf("resume preset stdout=%q stderr=%q", out, diagnostic)
	}
	if _, diagnostic := run(1, "resume", "Worker"); !strings.Contains(diagnostic, "requires a saved launch preset") || len(launches) != 2 {
		t.Fatalf("matching preset was ignored: %q", diagnostic)
	}
}

func TestResumeAdmissionFailureReportsThatTheChildStarted(t *testing.T) {
	for _, err := range []error{
		nil,
		errHookLaunchChanged,
		&core.RequestFailure{
			Code: "RUNTIME_CONFLICT", Status: 5, Reason: "resume_drift",
			Message: resumeConflict().Message,
		},
	} {
		failure := resumeAdmissionFailure(err)
		if failure.Code != "RUNTIME_CONFLICT" || failure.Status != 5 ||
			!strings.Contains(failure.Message, "Inspect its pane before retrying") ||
			strings.Contains(failure.Message, "No new agent") {
			t.Fatalf("post-spawn failure = %+v", failure)
		}
	}
}

func TestResumePreflightRequiresRecordedRuntimeToBeGone(t *testing.T) {
	old := runtime.Incarnation{PID: 42, Start: "ps-v1:Sat Jan 1 00:00:00 2000"}
	prior := core.Binding{
		Server: core.ServerEvidence{Host: "tmux"}, PaneID: "%4",
		Session: core.BindingSessionState{
			RuntimeState: "ended",
			Runtime:      &core.ProcessIncarnation{PID: uint64(old.PID), StartIdentity: old.Start},
		},
	}
	snapshot := core.ResumeSnapshot{Identity: core.Identity{Name: "Worker"}, PriorBinding: &prior}
	for _, test := range []struct {
		name    string
		seen    runtime.Observation
		blocked bool
	}{
		{"live", runtime.Observation{State: runtime.Alive, Incarnation: old}, true},
		{"suspended", runtime.Observation{State: runtime.Suspended, Incarnation: old}, true},
		{"unknown", runtime.Observation{}, true},
		{"gone", runtime.Observation{State: runtime.Gone}, false},
		{"reused", runtime.Observation{State: runtime.Alive, Incarnation: runtime.Incarnation{
			PID: old.PID, Start: "ps-v1:Sun Jan 2 00:00:00 2000",
		}}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := preflightResume(t.Context(), func(_ context.Context, pid int) (runtime.Observation, error) {
				if pid != old.PID {
					t.Fatalf("probed PID %d, want %d", pid, old.PID)
				}
				return test.seen, nil
			}, snapshot)
			if (got != nil) != test.blocked || got != nil && got.Code != "RUNTIME_CONFLICT" {
				t.Fatalf("preflight refusal = %+v", got)
			}
		})
	}
}

func TestResumeShowReadsThePinnedPresetWithoutAHost(t *testing.T) {
	world := t.TempDir()
	t.Setenv("HOME", world)
	t.Setenv(home.EnvHome, filepath.Join(world, "go"))
	root, err := home.Resolve(func(key string) (string, bool) {
		if key == home.EnvHome {
			return filepath.Join(world, "go"), true
		}
		return "", false
	}, world)
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Error(err)
		}
	})
	const id core.IdentityID = "da3c6d1e-f088-4e0e-a839-7b126d4eb840"
	if err := store.Write(t.Context(), func(tx ports.StoreTx) error {
		return tx.Identities().Insert(core.Identity{ID: id, Name: "Worker", CanonicalName: "worker", Lifetime: core.LifetimeSaved}, 1000)
	}); err != nil {
		t.Fatal(err)
	}
	app := application{store: store, caller: callerSelector{lookup: func(string) (string, bool) {
		t.Fatal("explicit inspection attempted host selection")
		return "", false
	}}}
	show := func(selector, want string) {
		t.Helper()
		var stdout, stderr bytes.Buffer
		args := []string{"resume", "--show", selector}
		if status := app.run(t.Context(), args, &stdout, &stderr); status != 0 || stdout.String() != want || stderr.Len() != 0 {
			t.Fatalf("%v exit %d stdout=%q stderr=%q", args, status, &stdout, &stderr)
		}
	}
	show(string(id), "{\n  \"identity\": \"Worker\",\n  \"launch\": null\n}\n")
	db, err := sql.Open("sqlite", root.Database)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.ExecContext(t.Context(), `INSERT INTO identity_metadata(identity_id,key,value) VALUES(?,'resume.launch',?)`, id, `{
		"executable":"claude","model":"test-model","effort":null,"env":{},
		"binding":"d092a9fe-c775-455d-9217-135450d5061a","owner_pid":42,
		"owner_start":"ps-v1:Sat Jan 1 00:00:00 2000","harness":null,"session":null}`); err != nil {
		t.Fatal(err)
	}
	show("Worker", `{
  "identity": "Worker",
  "launch": {
    "executable": "claude",
    "model": "test-model",
    "effort": null,
    "env": {},
    "associated": false
  }
}
`)
}
