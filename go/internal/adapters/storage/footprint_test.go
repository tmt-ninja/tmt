package storage

import (
	"bytes"
	"database/sql"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"testing"
)

func TestInspectFootprintLeavesMissingHomeAbsent(t *testing.T) {
	root := testRoot(t)
	got, err := InspectFootprint(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	want := Footprint{
		DataRoot: root.Dir, DatabasePath: root.Database,
		NotesPath: filepath.Join(root.Dir, "notes"), ColabPath: filepath.Join(root.Dir, "colab", "space.db"),
	}
	if got != want {
		t.Fatalf("footprint = %+v, want %+v", got, want)
	}
	if _, err := os.Lstat(root.Dir); !os.IsNotExist(err) {
		t.Fatalf("absent home stat = %v", err)
	}
}

func TestInspectFootprintMeasuresStoresWithoutCreatingSidecars(t *testing.T) {
	root := testRoot(t)
	writeFootprintFixture(t, root.Dir, "notes/one/notes.md", "first")
	writeFootprintFixture(t, root.Dir, "notes/two/nested/notes.md", "second")
	writeFootprintFixture(t, root.Dir, "notes/two/nested/too-deep/notes.md", "excluded")
	writeFootprintFixture(t, root.Dir, "colab/space.db", "colab")
	writeFootprintFixture(t, root.Dir, "colab/space.db-wal", "wal")
	writeFootprintFixture(t, root.Dir, "colab/space.db.pre-v2.bak", "two")
	writeFootprintFixture(t, root.Dir, "colab/space.db.pre-v10.bak", "ten!")
	writeFootprintFixture(t, root.Dir, "colab/space.db.pre-vx.bak", "excluded")
	outsideNotes := t.TempDir()
	writeFootprintFixture(t, outsideNotes, "notes.md", "excluded")
	if err := os.Symlink(outsideNotes, filepath.Join(root.Dir, "notes/link")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("space.db", filepath.Join(root.Dir, "colab/space.db.pre-v3.bak")); err != nil {
		t.Fatal(err)
	}
	db := openFootprintFixture(t, root.Database)
	if _, err := db.Exec("PRAGMA auto_vacuum=INCREMENTAL; CREATE TABLE fixture (data BLOB)"); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(root.Database)
	if err != nil {
		t.Fatal(err)
	}
	got, err := InspectFootprint(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	if got.Database == nil || got.Database.Pages == nil || got.Database.PageError != nil {
		t.Fatalf("database = %+v", got.Database)
	}
	database := got.Database
	pages := database.Pages
	if database.Bytes != uint64(len(before)) || database.WALBytes != 0 ||
		pages.PageSize*pages.PageCount != database.Bytes || pages.AutoVacuum != AutoVacuumIncremental || pages.FreeBytes() != 0 {
		t.Fatalf("database = %+v, pages = %+v", database, pages)
	}
	wantNotes := NotesFootprint{Path: filepath.Join(root.Dir, "notes"), Bytes: 11, Files: 2, Complete: true}
	if got.Notes == nil || *got.Notes != wantNotes {
		t.Fatalf("notes = %+v, want %+v", got.Notes, wantNotes)
	}
	wantColab := ColabFootprint{Path: filepath.Join(root.Dir, "colab/space.db"), Bytes: 5, WALBytes: 3,
		Backups: []StoreFile{
			{Path: filepath.Join(root.Dir, "colab/space.db.pre-v10.bak"), Bytes: 4},
			{Path: filepath.Join(root.Dir, "colab/space.db.pre-v2.bak"), Bytes: 3},
		},
	}
	if got.Colab == nil || !reflect.DeepEqual(*got.Colab, wantColab) {
		t.Fatalf("Colab = %+v, want %+v", got.Colab, wantColab)
	}
	assertFootprintFile(t, root.Database, before)
	for _, suffix := range []string{"-shm", "-wal", "-journal"} {
		if _, err := os.Lstat(root.Database + suffix); !os.IsNotExist(err) {
			t.Fatalf("sidecar %s stat = %v", suffix, err)
		}
	}
}

func TestInspectFootprintObservesCommittedWALPages(t *testing.T) {
	root := testRoot(t)
	if err := os.Mkdir(root.Dir, 0700); err != nil {
		t.Fatal(err)
	}
	db := openFootprintFixture(t, root.Database)
	if _, err := db.Exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE fixture (data BLOB); INSERT INTO fixture VALUES (zeroblob(32768))"); err != nil {
		t.Fatal(err)
	}
	disk, err := os.ReadFile(root.Database)
	if err != nil {
		t.Fatal(err)
	}
	wal, err := os.ReadFile(root.Database + "-wal")
	if err != nil {
		t.Fatal(err)
	}
	got, err := InspectFootprint(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	database := got.Database
	if database == nil || database.Pages == nil || database.PageError != nil ||
		database.Bytes != uint64(len(disk)) || database.WALBytes != uint64(len(wal)) || len(wal) == 0 ||
		database.Pages.PageCount*database.Pages.PageSize <= database.Bytes {
		t.Fatalf("committed WAL footprint = %+v", database)
	}
	assertFootprintFile(t, root.Database, disk)
	assertFootprintFile(t, root.Database+"-wal", wal)

	// Simulate a copied database with committed WAL pages but no SHM sidecar.
	copyRoot := testRoot(t)
	writeFootprintFixture(t, copyRoot.Dir, filepath.Base(copyRoot.Database), string(disk))
	writeFootprintFixture(t, copyRoot.Dir, filepath.Base(copyRoot.Database)+"-wal", string(wal))
	copyFootprint, err := InspectFootprint(t.Context(), copyRoot)
	if err != nil {
		t.Fatal(err)
	}
	copied := copyFootprint.Database
	if copied == nil || copied.Pages != nil || copied.PageError == nil ||
		copied.Bytes != uint64(len(disk)) || copied.WALBytes != uint64(len(wal)) {
		t.Fatalf("database without SHM = %+v", copied)
	}
	if _, err := os.Lstat(copyRoot.Database + "-shm"); !os.IsNotExist(err) {
		t.Fatalf("WAL index stat = %v", err)
	}
	assertFootprintFile(t, copyRoot.Database, disk)
	assertFootprintFile(t, copyRoot.Database+"-wal", wal)
}

func TestInspectFootprintPreservesSizeWhenPageAccountingUnavailable(t *testing.T) {
	root := testRoot(t)
	data := "not a SQLite database"
	writeFootprintFixture(t, root.Dir, filepath.Base(root.Database), data)
	got, err := InspectFootprint(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	if got.Database == nil || got.Database.Pages != nil || got.Database.PageError == nil || got.Database.Bytes != uint64(len(data)) {
		t.Fatalf("database = %+v", got.Database)
	}
	assertFootprintFile(t, root.Database, []byte(data))
}

func TestWalkFootprintDirectoryDistinguishesExactLimitFromTruncated(t *testing.T) {
	path := t.TempDir()
	writeFootprintFixture(t, path, "a", "")
	writeFootprintFixture(t, path, "b", "")
	root, err := os.OpenRoot(path)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	for _, limit := range []int{1, 2} {
		remaining := limit
		var names []string
		complete, err := walkFootprintDirectory(t.Context(), root, ".", &remaining, func(entry fs.DirEntry) error {
			names = append(names, entry.Name())
			return nil
		})
		if err != nil || complete != (limit == 2) || len(names) != limit || remaining != 0 {
			t.Fatalf("limit %d: complete=%v names=%v remaining=%d err=%v", limit, complete, names, remaining, err)
		}
		if complete {
			slices.Sort(names)
			if !slices.Equal(names, []string{"a", "b"}) {
				t.Fatalf("entries = %v", names)
			}
		}
	}
}

func writeFootprintFixture(t *testing.T, root, name, contents string) {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
}

func openFootprintFixture(t *testing.T, path string) *sql.DB {
	t.Helper()
	dsn := url.URL{Scheme: "file", Path: path}
	db, err := sql.Open("sqlite", dsn.String())
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func assertFootprintFile(t *testing.T, path string, want []byte) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("file %s changed from %d bytes to %d bytes, read error %v", path, len(want), len(got), err)
	}
}
