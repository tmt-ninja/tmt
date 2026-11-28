package cli

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

func TestStorageReportsPrivateFootprintWithoutMaintenance(t *testing.T) {
	world := t.TempDir()
	t.Setenv("HOME", world)
	t.Setenv(home.EnvHome, filepath.Join(world, "go"))
	root, err := home.Resolve(os.LookupEnv, world)
	if err != nil {
		t.Fatal(err)
	}
	run := func(args ...string) string {
		t.Helper()
		var stdout, stderr bytes.Buffer
		args = append([]string{"storage"}, args...)
		if status := (application{}).run(t.Context(), args, &stdout, &stderr); status != 0 || stderr.Len() != 0 {
			t.Fatalf("storage %q exit %d: %q, %q", args, status, &stdout, &stderr)
		}
		return stdout.String()
	}
	type report struct {
		DataRoot string
		Database struct {
			Present  bool
			PageSize uint64
			Bytes    uint64
		}
		Notes struct {
			Present  bool
			Bytes    uint64
			Files    uint64
			Complete bool
		}
		Colab struct {
			Present bool
			Backups []struct{ Path string }
		}
		Compaction struct {
			Pending bool
			Command *string
		}
	}
	read := func() report {
		t.Helper()
		var result report
		if err := json.Unmarshal([]byte(run("--json")), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	absent := read()
	if absent.DataRoot != root.Dir || absent.Database.Present || absent.Notes.Present || absent.Colab.Present ||
		absent.Compaction.Pending || absent.Compaction.Command != nil {
		t.Fatalf("empty footprint: %+v", absent)
	}
	if _, err := os.Stat(root.Dir); !os.IsNotExist(err) {
		t.Fatalf("storage created its root: %v", err)
	}
	db, err := storage.Open(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string]string{
		"notes/worker/notes.md":       "notes",
		"colab/space.db":              "opaque colab database",
		"colab/space.db.pre-v2.bak":   "backup",
		"colab/space.db.pre-vbad.bak": "unrelated",
	} {
		path := filepath.Join(root.Dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	before, err := os.ReadFile(root.Database)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(root.Dir)
	if err != nil {
		t.Fatal(err)
	}
	present := read()
	if !present.Database.Present || present.Database.PageSize == 0 || present.Database.Bytes != uint64(len(before)) ||
		!present.Notes.Present || present.Notes.Bytes != 5 || present.Notes.Files != 1 || !present.Notes.Complete ||
		!present.Colab.Present || len(present.Colab.Backups) != 1 ||
		filepath.Base(present.Colab.Backups[0].Path) != "space.db.pre-v2.bak" || present.Compaction.Command != nil {
		t.Fatalf("populated footprint: %+v", present)
	}
	human := run()
	if !strings.Contains(human, "5 B in 1 files") || !strings.Contains(human, "space.db.pre-v2.bak 6 B") || strings.Contains(human, flavor.Binary+" upgrade") {
		t.Fatalf("human footprint: %q", human)
	}
	after, err := os.ReadFile(root.Database)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("storage changed the database: %v", err)
	}
	later, err := os.ReadDir(root.Dir)
	if err != nil || len(later) != len(entries) {
		t.Fatalf("storage left extra state: %v, %v", later, err)
	}
	for i := range later {
		if later[i].Name() != entries[i].Name() {
			t.Fatalf("storage left extra state: %v, %v", later, entries)
		}
	}
}
