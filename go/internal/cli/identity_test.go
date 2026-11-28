package cli

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestIdentityAndNotesUseTheSavedUUID(t *testing.T) {
	world := t.TempDir()
	t.Setenv("HOME", world)
	t.Setenv(home.EnvHome, filepath.Join(world, "data"))
	root, err := home.Resolve(os.LookupEnv, world)
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	const id = "c804a722-ccf6-43cd-8c14-863142fae887"
	if err := store.Write(t.Context(), func(tx ports.StoreTx) error {
		return tx.Identities().Insert(core.Identity{ID: id, Name: "Reviewer", CanonicalName: "reviewer", Lifetime: core.LifetimeTemporary}, uint64(wallClock{}.NowMs()))
	}); err != nil {
		t.Fatal(err)
	}
	app := application{store: store}
	run := func(want int, args ...string) map[string]any {
		t.Helper()
		var stdout, stderr bytes.Buffer
		if status := app.run(t.Context(), append(args, "--json"), &stdout, &stderr); status != want || stderr.Len() != 0 {
			t.Fatalf("%q: exit %d, stdout %q, stderr %q", args, status, &stdout, &stderr)
		}
		var doc map[string]any
		if err := json.Unmarshal(stdout.Bytes(), &doc); err != nil {
			t.Fatalf("%q: %v", &stdout, err)
		}
		return doc
	}
	temporary := run(1, "notes", "path", "--identity", "Reviewer")
	if temporary["error"].(map[string]any)["code"] != "NOTES_SAVED_IDENTITY_REQUIRED" {
		t.Fatalf("temporary identity: %v", temporary)
	}
	promoted := run(0, "identity", "create", "reviewer")
	member := promoted["identity"].(map[string]any)
	if promoted["created"] != false || member["id"] != id || member["lifetime"] != "saved" {
		t.Fatalf("promotion: %v", promoted)
	}
	created := run(0, "notes", "path", "--identity", "Reviewer")
	path := filepath.Join(root.Dir, "notes", id, "notes.md")
	if created["created"] != true || created["identityId"] != id || created["path"] != path {
		t.Fatalf("new notes: %v", created)
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0600 || info.Size() != 0 {
		t.Fatalf("new notes stat: %v, %v", info, err)
	}
	if err := os.WriteFile(path, []byte("retained notes\n"), 0600); err != nil {
		t.Fatal(err)
	}
	run(0, "identity", "mv", "Reviewer", "Auditor")
	run(5, "identity", "show", id, "--expect-name", "Reviewer")
	pinned := run(0, "identity", "show", id, "--expect-name", "auditor")
	if found := pinned["identity"].(map[string]any); found["id"] != id || found["presence"] != "offline" || found["name"] != "Auditor" {
		t.Fatalf("pinned identity: %v", pinned)
	}
	reopened := run(0, "notes", "path", "--identity", "Auditor")
	if reopened["created"] != false || reopened["path"] != path {
		t.Fatalf("notes after rename: %v", reopened)
	}
	content, err := os.ReadFile(path)
	if err != nil || string(content) != "retained notes\n" {
		t.Fatalf("notes content: %q, %v", content, err)
	}
	list := run(0, "identity", "ls")["identities"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["id"] != id {
		t.Fatalf("identity list: %v", list)
	}

	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(world, "outside.md")
	if err := os.Symlink(outside, path); err != nil {
		t.Fatal(err)
	}
	if rejected := run(1, "notes", "path", "--identity", id); rejected["error"].(map[string]any)["code"] != "NOTES_IO_ERROR" {
		t.Fatalf("notes symlink: %v", rejected)
	}
	if _, err := os.Stat(outside); !os.IsNotExist(err) {
		t.Fatalf("notes followed symlink: %v", err)
	}
}
