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
	"sync"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/home"
	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

const (
	busyTimeout = 5 * time.Second
	walAttempt  = 50 * time.Millisecond
	walRetry    = 10 * time.Millisecond
	walLimit    = 4 * 1024 * 1024
)

// Storage owns one SQLite connection at a time for one tmt-go invocation.
type Storage struct {
	db             *sql.DB
	path           string
	skipCheckpoint bool
	closeOnce      sync.Once
	closeErr       error
}

func Open(ctx context.Context, root home.Root) (*Storage, error) {
	if !filepath.IsAbs(root.Dir) || filepath.Clean(root.Database) != filepath.Join(root.Dir, home.DatabaseName) {
		return nil, errors.New("invalid tmt-go database path")
	}
	if err := secureDirectory(root.Dir); err != nil {
		return nil, fmt.Errorf("secure storage directory: %w", err)
	}
	if err := createDatabase(root.Database); err != nil {
		return nil, fmt.Errorf("admit storage database: %w", err)
	}
	db, err := openSQLite(root.Database)
	if err != nil {
		return nil, fmt.Errorf("open storage: %w", err)
	}
	if err := prepareStorage(ctx, db, root.Database); err != nil {
		return nil, errors.Join(err, db.Close())
	}
	return &Storage{db: db, path: root.Database}, nil
}

func openSQLite(path string) (*sql.DB, error) {
	dsn := url.URL{Scheme: "file", Path: path}
	params := url.Values{"_txlock": {"immediate"}}
	params.Add("_pragma", "busy_timeout(5000)")
	params.Add("_pragma", "foreign_keys(ON)")
	params.Add("_pragma", "synchronous(NORMAL)")
	params.Add("_pragma", fmt.Sprintf("journal_size_limit(%d)", walLimit))
	dsn.RawQuery = params.Encode()
	db, err := sql.Open("sqlite", dsn.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	return db, nil
}

func prepareStorage(ctx context.Context, db *sql.DB, path string) error {
	conn, err := db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("open storage connection: %w", err)
	}
	defer conn.Close()
	if err := configureWAL(ctx, conn); err != nil {
		return err
	}
	if _, err := conn.ExecContext(ctx, "CREATE VIRTUAL TABLE temp._tmt_fts5_check USING fts5(content); DROP TABLE temp._tmt_fts5_check;"); err != nil {
		return fmt.Errorf("SQLite runtime does not provide FTS5: %w", err)
	}
	if err := migrateThrough(ctx, conn, SchemaVersion); err != nil {
		return err
	}
	if err := provisionMissingHookQueue(ctx, conn, path); err != nil {
		return err
	}
	return secureDatabaseFiles(path)
}

func configureWAL(ctx context.Context, conn *sql.Conn) (err error) {
	defer func() {
		err = errors.Join(err, setBusyTimeout(context.WithoutCancel(ctx), conn, busyTimeout))
	}()
	deadline := time.Now().Add(busyTimeout)
	for {
		if err := setBusyTimeout(ctx, conn, min(walAttempt, time.Until(deadline))); err != nil {
			return err
		}
		var mode string
		err := conn.QueryRowContext(ctx, "PRAGMA journal_mode = WAL").Scan(&mode)
		if err == nil {
			if mode != "wal" {
				return fmt.Errorf("SQLite could not enable WAL (journal mode %q)", mode)
			}
			return nil
		}
		if !isBusy(err) || time.Until(deadline) <= 0 {
			return fmt.Errorf("configure WAL: %w", err)
		}
		timer := time.NewTimer(min(walRetry, time.Until(deadline)))
		select {
		case <-timer.C:
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("configure WAL: %w", err)
		}
	}
}

func setBusyTimeout(ctx context.Context, conn *sql.Conn, wait time.Duration) error {
	ms := max(0, wait.Milliseconds())
	if _, err := conn.ExecContext(ctx, fmt.Sprintf("PRAGMA busy_timeout = %d", ms)); err != nil {
		return fmt.Errorf("configure busy timeout: %w", err)
	}
	return nil
}

func isBusy(err error) bool {
	var failure *sqlite.Error
	if !errors.As(err, &failure) {
		return false
	}
	code := failure.Code() & 0xff
	return code == sqlite3.SQLITE_BUSY || code == sqlite3.SQLITE_LOCKED
}

func (s *Storage) Close() error {
	s.closeOnce.Do(func() {
		if !s.skipCheckpoint {
			s.closeErr = s.checkpoint()
		}
		s.closeErr = errors.Join(s.closeErr, s.db.Close())
	})
	return s.closeErr
}

func (s *Storage) checkpoint() error {
	ctx := context.Background()
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("acquire close checkpoint connection: %w", err)
	}
	defer conn.Close()
	if err := setBusyTimeout(ctx, conn, 0); err != nil {
		return err
	}
	// NOT PORTED (#6938, GO1-07): the public Go driver has no NO_CKPT_ON_CLOSE option.
	// The explicit checkpoint follows the native no-wait policy.
	var busy, logFrames, copied int
	if err := conn.QueryRowContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)").Scan(&busy, &logFrames, &copied); err != nil {
		return fmt.Errorf("checkpoint storage: %w", err)
	}
	return secureDatabaseFiles(s.path)
}

func secureDirectory(path string) error {
	if err := os.MkdirAll(path, 0o700); err != nil {
		return err
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode().Perm()&0o200 == 0 {
		return &fs.PathError{Op: "admit data directory", Path: path, Err: fs.ErrPermission}
	}
	return os.Chmod(path, 0o700)
}

func createDatabase(path string) error {
	if err := secureDatabaseFiles(path); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if errors.Is(err, fs.ErrExist) {
		return secureDatabaseFiles(path)
	}
	if err != nil {
		return err
	}
	return file.Close()
}

func secureDatabaseFiles(path string) error {
	for _, suffix := range []string{"", "-wal", "-shm"} {
		name := path + suffix
		info, err := os.Lstat(name)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return &fs.PathError{Op: "admit database file", Path: name, Err: fs.ErrInvalid}
		}
		if info.Mode().Perm() != 0o600 {
			if err := os.Chmod(name, 0o600); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return err
			}
		}
	}
	return nil
}
