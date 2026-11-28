package storage

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHookQueueProvisionedAndRepairedByMainStore(t *testing.T) {
	parallelStorageFixture(t)
	root := testRoot(t)
	ctx := t.Context()
	queuePath := filepath.Join(root.Dir, hookQueueFilename)
	for range 2 {
		store, err := Open(ctx, root)
		if err != nil {
			t.Fatal(err)
		}
		if err := store.Close(); err != nil {
			t.Fatal(err)
		}
		assertHookQueueReady(t, queuePath)
		if err := os.Remove(queuePath); err != nil {
			t.Fatal(err)
		}
	}
}

func assertHookQueueReady(t *testing.T, path string) {
	t.Helper()
	info, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 {
		t.Fatalf("hook queue mode = %v", info.Mode())
	}
	db, err := openHookSQLite(path, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for query, want := range map[string]string{
		"PRAGMA user_version":                                   "3",
		"PRAGMA journal_mode":                                   "wal",
		"PRAGMA synchronous":                                    "2",
		"PRAGMA busy_timeout":                                   "0",
		"SELECT COUNT(*) FROM hook_writes":                      "0",
		"SELECT receipt_ms FROM hook_retention_scan WHERE id=1": "-1",
	} {
		var got string
		if err := db.QueryRowContext(t.Context(), query).Scan(&got); err != nil || got != want {
			t.Errorf("%s = %q, %v, want %q", query, got, err, want)
		}
	}
}

func TestMigration84RefusesForeignQueueBeforePublishingReceiptSchema(t *testing.T) {
	parallelStorageFixture(t)
	root := testRoot(t)
	ctx := t.Context()
	if err := secureDirectory(root.Dir); err != nil {
		t.Fatal(err)
	}
	main, err := openSQLite(root.Database)
	if err != nil {
		t.Fatal(err)
	}
	defer main.Close()
	conn, err := main.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := migrateThrough(ctx, conn, 83); err != nil {
		t.Fatal(err)
	}
	queuePath := filepath.Join(root.Dir, hookQueueFilename)
	if err := createHookQueueFile(queuePath); err != nil {
		t.Fatal(err)
	}
	writeForeignHookQueue(t, queuePath, "CREATE TABLE foreign_payload(value TEXT); INSERT INTO foreign_payload VALUES ('keep')")
	if err := migrateThrough(ctx, conn, 84); err == nil || !strings.Contains(err.Error(), "unrecognized hook queue schema") {
		t.Fatalf("migration 84 did not refuse foreign queue: %v", err)
	}
	if version, err := recordedThrough(ctx, conn); err != nil || version != 83 {
		t.Fatalf("recorded migration = %d, %v, want 83", version, err)
	}
	var receipts bool
	if err := conn.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='hook_capture_receipts')").
		Scan(&receipts); err != nil || receipts {
		t.Fatalf("receipt table was published despite queue refusal: %t, %v", receipts, err)
	}
	queue, err := openHookSQLite(queuePath, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer queue.Close()
	var original string
	if err := queue.QueryRowContext(ctx, "SELECT value FROM foreign_payload").Scan(&original); err != nil || original != "keep" {
		t.Fatalf("foreign row = %q, %v", original, err)
	}
}

func TestCurrentMainOpenLeavesIncompatibleQueueUntouched(t *testing.T) {
	parallelStorageFixture(t)
	root := testRoot(t)
	ctx := t.Context()
	store, err := Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root.Dir, hookQueueFilename)
	writeForeignHookQueue(t, path, "PRAGMA user_version=9")
	reopened, err := Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if err := reopened.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := openHookSQLite(path, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var version int
	if err := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil || version != 9 {
		t.Fatalf("queue was altered during ordinary open: version %d, %v", version, err)
	}
}

func TestHookQueueBootstrapRejectsSymlinks(t *testing.T) {
	for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
		t.Run(suffix, func(t *testing.T) {
			root := testRoot(t)
			if err := secureDirectory(root.Dir); err != nil {
				t.Fatal(err)
			}
			sentinel := filepath.Join(t.TempDir(), "untouched")
			if err := os.WriteFile(sentinel, []byte("fixture"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(sentinel, filepath.Join(root.Dir, hookQueueFilename+suffix)); err != nil {
				t.Fatal(err)
			}
			if err := provisionHookQueue(t.Context(), root.Database); err == nil {
				t.Fatal("hook bootstrap accepted a symlink")
			}
			if got, err := os.ReadFile(sentinel); err != nil || string(got) != "fixture" {
				t.Fatalf("sentinel changed: %q, %v", got, err)
			}
		})
	}
}

func TestHookQueueBootstrapRejectsNonprivateFiles(t *testing.T) {
	root := testRoot(t)
	if err := secureDirectory(root.Dir); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root.Dir, hookQueueFilename)
	if err := os.WriteFile(path, []byte("fixture"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := provisionHookQueue(t.Context(), root.Database); err == nil {
		t.Fatal("hook bootstrap accepted a nonprivate file")
	}
	if got, err := os.ReadFile(path); err != nil || string(got) != "fixture" {
		t.Fatalf("nonprivate sentinel changed: %q, %v", got, err)
	}
}

func writeForeignHookQueue(t *testing.T, path, statement string) {
	t.Helper()
	db, err := openHookSQLite(path, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	}()
	if _, err := db.ExecContext(t.Context(), statement); err != nil {
		t.Fatal(err)
	}
}
