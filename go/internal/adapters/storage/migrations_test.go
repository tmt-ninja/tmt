package storage

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

func testRoot(t *testing.T) home.Root {
	t.Helper()
	parent := t.TempDir()
	root, err := home.Resolve(func(key string) (string, bool) {
		if key == home.EnvHome {
			return filepath.Join(parent, "go ? # storage"), true
		}
		return "", false
	}, parent)
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func TestOpenCurrentSchema(t *testing.T) {
	root := testRoot(t)
	store, err := Open(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	for _, tc := range []struct{ query, want string }{
		{"PRAGMA journal_mode", "wal"},
		{"PRAGMA foreign_keys", "1"},
		{"PRAGMA synchronous", "1"},
		{"PRAGMA busy_timeout", "5000"},
		{"PRAGMA journal_size_limit", "4194304"},
		{"SELECT COUNT(*) FROM _migrations", "100"},
		{"SELECT name FROM _migrations WHERE version = 100", "retain person-marked reply intent and pins"},
		{"SELECT COUNT(*) FROM pragma_foreign_key_check", "0"},
	} {
		var got string
		if err := store.db.QueryRowContext(t.Context(), tc.query).Scan(&got); err != nil || got != tc.want {
			t.Errorf("%s = %q, %v, want %q", tc.query, got, err, tc.want)
		}
	}
	for _, tc := range []struct {
		path string
		want os.FileMode
	}{{root.Dir, 0o700}, {root.Database, 0o600}, {root.Database + "-wal", 0o600}, {root.Database + "-shm", 0o600}} {
		info, err := os.Stat(tc.path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != tc.want {
			t.Errorf("mode of %s = %o, want %o", tc.path, info.Mode().Perm(), tc.want)
		}
	}

	writer, err := store.db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Rollback()
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	reopened, err := Open(ctx, root)
	if err != nil {
		t.Fatalf("current database must open while a writer holds it: %v", err)
	}
	if err := reopened.Close(); err != nil {
		t.Fatal(err)
	}
	if err := writer.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestConcurrentFreshOpen(t *testing.T) {
	root := testRoot(t)
	start := make(chan struct{})
	results := make(chan error, 2)
	for range 2 {
		go func() {
			<-start
			store, err := Open(t.Context(), root)
			if err == nil {
				err = store.Close()
			}
			results <- err
		}()
	}
	close(start)
	for range 2 {
		if err := <-results; err != nil {
			t.Error(err)
		}
	}
	store, err := Open(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	var count int
	if err := store.db.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM _migrations").Scan(&count); err != nil || count != SchemaVersion {
		t.Fatalf("migration count = %d, %v", count, err)
	}
}

func TestRetentionMigrationBackfillsHistoricalRows(t *testing.T) {
	t.Parallel()
	conn := predecessor(t, 5)
	execMigrationTest(t, conn, `INSERT INTO request_attempts (
		attempt_id, request_id, server_id, socket_path, server_pid, server_start_time,
		pane_id, pane_pid, wait_active, status, inject_preamble, cadence_reserved,
		prepared_at_ms, settled_at_ms, expires_at_ms
	) VALUES ('attempt', 'request', 'server', '/tmp/fixture', 1, 'start', '%1', 2,
		0, 'sent', 0, 0, 10, 20, 30)`)
	execMigrationTest(t, conn, `INSERT INTO request_responses (
		request_id, attempt_id, server_id, socket_path, server_pid, server_start_time, pane_id,
		pane_pid, body, body_bytes, submitted_at_ms
	) VALUES ('request', 'attempt', 'server', '/tmp/fixture', 1, 'start', '%1', 2, 'body', 4, ?)`, core.MaxJSSafeInteger-1)

	if err := migrateThrough(t.Context(), conn, 6); err != nil {
		t.Fatal(err)
	}
	var attempt, response uint64
	err := conn.QueryRowContext(t.Context(), `SELECT retention_expires_at_ms, response_expires_at_ms
		FROM request_attempts JOIN request_responses USING (request_id)`).Scan(&attempt, &response)
	if err != nil || attempt != core.MaxJSSafeInteger || response != core.MaxJSSafeInteger {
		t.Fatalf("backfilled horizons = %d and %d, %v", attempt, response, err)
	}
}

func TestMigrationRefusesCustomRebuildSource(t *testing.T) {
	t.Parallel()
	conn := predecessor(t, 40)
	execMigrationTest(t, conn, "CREATE INDEX custom_binding_index ON bindings (pane_id)")
	if err := migrateThrough(t.Context(), conn, 41); err == nil || !strings.Contains(err.Error(), "schema-40 definitions") {
		t.Fatalf("custom source was not refused: %v", err)
	}
	if got, err := recordedThrough(t.Context(), conn); err != nil || got != 40 {
		t.Fatalf("history advanced on failure: %d, %v", got, err)
	}
	var index, foreignKeys int
	if err := conn.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM sqlite_schema WHERE name = 'custom_binding_index'").Scan(&index); err != nil || index != 1 {
		t.Fatalf("custom index was lost: %d, %v", index, err)
	}
	if err := conn.QueryRowContext(t.Context(), "PRAGMA foreign_keys").Scan(&foreignKeys); err != nil || foreignKeys != 1 {
		t.Fatalf("foreign keys were not restored: %d, %v", foreignKeys, err)
	}
}

func TestIncompatibleMigrationHistoryIsRefused(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name      string
		statement string
		want      string
		from      int
	}{
		{"missing version", "DELETE FROM _migrations WHERE version = 1", "not contiguous", 2},
		{"renamed version", "UPDATE _migrations SET name = 'different' WHERE version = 1", "has changed", 1},
		{"unknown version", "INSERT INTO _migrations VALUES (101, 'future', 'now')", "newer than supported", SchemaVersion},
		{"extra history column", "ALTER TABLE _migrations ADD COLUMN custom TEXT", "does not match", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			conn := predecessor(t, tc.from)
			execMigrationTest(t, conn, tc.statement)
			if err := migrateThrough(t.Context(), conn, SchemaVersion); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("migrateThrough error = %v, want %q", err, tc.want)
			}
		})
	}
}

func predecessor(t *testing.T, version int) *sql.Conn {
	t.Helper()
	db, err := sql.Open("sqlite", "file::memory:?_txlock=immediate&_pragma=foreign_keys(ON)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	conn, err := db.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if err := migrateThrough(t.Context(), conn, version); err != nil {
		t.Fatal(err)
	}
	return conn
}

func execMigrationTest(t *testing.T, conn *sql.Conn, statement string, args ...any) {
	t.Helper()
	if _, err := conn.ExecContext(t.Context(), statement, args...); err != nil {
		t.Fatal(err)
	}
}
