package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

const hookQueueFilename = "hook-writes.db"

func provisionMigrationHookQueue(ctx context.Context, tx *sql.Tx) error {
	var mainPath string
	if err := tx.QueryRowContext(ctx, "SELECT file FROM pragma_database_list WHERE name = 'main'").Scan(&mainPath); err != nil {
		return fmt.Errorf("read Core initialization path: %w", err)
	}
	if mainPath == "" {
		return nil // In-memory migration references have no queue.
	}
	return provisionHookQueue(ctx, mainPath)
}

func provisionMissingHookQueue(ctx context.Context, conn *sql.Conn, mainPath string) error {
	path := filepath.Join(filepath.Dir(mainPath), hookQueueFilename)
	missing, err := missingHookQueue(path)
	if err != nil || !missing {
		return err
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("acquire hook queue initialization writer: %w", err)
	}
	defer tx.Rollback()
	missing, err = missingHookQueue(path)
	if err != nil {
		return err
	}
	if missing {
		if err := provisionHookQueue(ctx, mainPath); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func missingHookQueue(path string) (bool, error) {
	_, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return true, nil
	}
	return false, err
}

func provisionHookQueue(ctx context.Context, mainPath string) error {
	path, err := hookQueuePath(mainPath)
	if err != nil {
		return err
	}
	if err := createHookQueueFile(path); err != nil {
		return fmt.Errorf("admit hook queue file: %w", err)
	}
	db, err := openHookSQLite(path, busyTimeout)
	if err != nil {
		return err
	}
	defer db.Close()
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	var version int
	if err := conn.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	switch version {
	case hookQueueVersion:
		return validateHookSchema(ctx, conn)
	case 0:
		if err := initializeHookSchema(ctx, conn); err != nil {
			return err
		}
	default:
		return fmt.Errorf("incompatible hook queue schema version %d", version)
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer dir.Close()
	if err := dir.Sync(); err != nil {
		return fmt.Errorf("sync hook queue directory: %w", err)
	}
	return validateHookSchema(ctx, conn)
}

func hookQueuePath(mainPath string) (string, error) {
	if !filepath.IsAbs(mainPath) || filepath.Base(mainPath) != home.DatabaseName {
		return "", errors.New("invalid tmt-go hook queue root")
	}
	directory, err := filepath.EvalSymlinks(filepath.Dir(mainPath))
	if err != nil {
		return "", err
	}
	info, err := os.Lstat(directory)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode().Perm() != 0o700 || !sys.FileOwnedByEffectiveUser(info) {
		return "", errors.New("hook queue requires a private data directory")
	}
	return filepath.Join(directory, hookQueueFilename), nil
}

// Inspect existing inodes without opening extra descriptors on live SQLite
// files. Closing a separate descriptor could release this process's locks.
func admitPrivateHookFile(path string) (bool, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 || !sys.FileOwnedByEffectiveUser(info) {
		return false, fmt.Errorf("hook queue entry %s must be a private regular file", filepath.Base(path))
	}
	return true, nil
}

func createHookQueueFile(path string) error {
	exists, err := admitPrivateHookFile(path)
	if err != nil {
		return err
	}
	for _, suffix := range []string{"-wal", "-shm", "-journal"} {
		present, err := admitPrivateHookFile(path + suffix)
		if err != nil {
			return err
		}
		if present && !exists {
			// A sidecar may belong to a missing or replaced queue. Do not
			// attach it to a newly created inode.
			stillMissing, err := missingHookQueue(path)
			if err != nil {
				return err
			}
			if stillMissing {
				return errors.New("hook queue file is missing but has existing sidecars")
			}
		}
	}
	if exists {
		return nil
	}
	file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, fs.ErrExist) {
		_, err = admitPrivateHookFile(path)
		return err
	}
	if err != nil {
		return err
	}
	return file.Close()
}

// NOT PORTED (#6938, GO1-06): the public SQLite driver has no SQLITE_OPEN_NOFOLLOW
// option. The owner and symlink preflight leaves a race between Lstat and
// SQLite open within the private directory.
func openHookSQLite(path string, wait time.Duration) (*sql.DB, error) {
	dsn := url.URL{Scheme: "file", Path: path}
	params := url.Values{"mode": {"rw"}, "_txlock": {"immediate"}}
	params.Add("_pragma", fmt.Sprintf("busy_timeout(%d)", max(0, wait.Milliseconds())))
	params.Add("_pragma", "synchronous(FULL)")
	dsn.RawQuery = params.Encode()
	db, err := sql.Open("sqlite", dsn.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	return db, nil
}

func initializeHookSchema(ctx context.Context, conn *sql.Conn) error {
	if err := checkEmptyHookSchema(ctx, conn); err != nil {
		return err
	}
	var mode string
	if err := conn.QueryRowContext(ctx, "PRAGMA journal_mode = WAL").Scan(&mode); err != nil {
		return err
	}
	if mode != "wal" {
		return errors.New("hook queue requires WAL")
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var version int
	if err := tx.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	switch version {
	case hookQueueVersion:
		return tx.Commit()
	case 0:
		if err := checkEmptyHookSchema(ctx, tx); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, hookQueueSchema); err != nil {
			return fmt.Errorf("initialize hook queue: %w", err)
		}
	default:
		return fmt.Errorf("incompatible hook queue schema version %d", version)
	}
	return tx.Commit()
}

type hookSchemaQuery interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func checkEmptyHookSchema(ctx context.Context, db hookSchemaQuery) error {
	var objects bool
	if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%')").Scan(&objects); err != nil {
		return err
	}
	if objects {
		return errors.New("unrecognized hook queue schema")
	}
	return nil
}

func validateHookSchema(ctx context.Context, conn *sql.Conn) error {
	var version int
	if err := conn.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version != hookQueueVersion {
		return fmt.Errorf("incompatible hook queue schema version %d", version)
	}
	var mode string
	if err := conn.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&mode); err != nil {
		return err
	}
	if mode != "wal" {
		return errors.New("hook queue requires WAL")
	}
	for _, query := range []string{
		"SELECT sequence,event_id,identity_id,provisional_batch,kind,enqueued_ms,committed,payload FROM hook_writes LIMIT 0",
		"SELECT turn_key,batch_id,created_ms FROM provisional_batches LIMIT 0",
		"SELECT event_id,quarantined_ms FROM invalid_hook_writes LIMIT 0",
		"SELECT receipt_ms,receipt_id,batch_ms,batch_key FROM hook_retention_scan LIMIT 0",
	} {
		statement, err := conn.PrepareContext(ctx, query)
		if err != nil {
			return fmt.Errorf("incompatible hook queue schema: %w", err)
		}
		if err := statement.Close(); err != nil {
			return err
		}
	}
	return nil
}
