package cli

import (
	"bytes"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

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
