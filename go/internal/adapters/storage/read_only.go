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

	"modernc.org/sqlite/vfs"
)

var errInspectionWALChanged = errors.New("database or WAL changed during read-only inspection")

// The caller has already checked the configured database path. Without a
// WAL, immutable prevents SQLite from initializing logging sidecars.
func withExistingSQLiteReadOnly(ctx context.Context, root *os.Root, path string, waitMs uint64, read func(*sql.Tx) error) error {
	parameters := url.Values{"mode": {"ro"}, "_pragma": {fmt.Sprintf("busy_timeout(%d)", waitMs)}}
	name := filepath.Base(path)
	wal, err := root.Lstat(name + "-wal")
	switch {
	case errors.Is(err, fs.ErrNotExist):
		parameters.Set("immutable", "1")
	case err != nil:
		return err
	case !wal.Mode().IsRegular():
		return errors.New("invalid database WAL file")
	default:
		shm, err := root.Lstat(name + "-shm")
		switch {
		case errors.Is(err, fs.ErrNotExist):
			return observeWALWithoutIndex(ctx, root, name, wal, parameters, read)
		case err != nil:
			return err
		case !shm.Mode().IsRegular():
			return errors.New("invalid database shared-memory index")
		}
	}
	dsn := url.URL{Scheme: "file", Path: path, RawQuery: parameters.Encode()}
	return readOnlySQLiteSnapshot(ctx, dsn.String(), read)
}

// Native storage/compaction.rs::observe_pages and storage/discovery.rs read
// the WAL in a read-only connection. For an unindexed WAL use the read-only
// VFS heap index (modernc TestVFSWALReadOnlyClose) to avoid creating SHM.
// The VFS does not lock the live files, so refuse to publish a drifting read.
func observeWALWithoutIndex(ctx context.Context, root *os.Root, name string, wal fs.FileInfo, parameters url.Values, read func(*sql.Tx) error) (err error) {
	main, err := root.Lstat(name)
	if err != nil {
		return err
	}
	if !main.Mode().IsRegular() {
		return errors.New("invalid inspection database file")
	}
	vfsName, handle, err := vfs.New(root.FS())
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, handle.Close()) }()

	parameters.Set("vfs", vfsName)
	parameters.Add("_pragma", "locking_mode(EXCLUSIVE)")
	dsn := url.URL{Scheme: "file", Opaque: url.PathEscape(name), RawQuery: parameters.Encode()}
	if err := readOnlySQLiteSnapshot(ctx, dsn.String(), read); err != nil {
		return err
	}
	for _, file := range []struct {
		name   string
		before fs.FileInfo
	}{{name, main}, {name + "-wal", wal}} {
		current, err := root.Lstat(file.name)
		if errors.Is(err, fs.ErrNotExist) {
			return errInspectionWALChanged
		}
		if err != nil {
			return err
		}
		if !os.SameFile(file.before, current) || file.before.Size() != current.Size() ||
			!file.before.ModTime().Equal(current.ModTime()) {
			return errInspectionWALChanged
		}
	}
	if _, err := root.Lstat(name + "-shm"); !errors.Is(err, fs.ErrNotExist) {
		if err == nil {
			return errInspectionWALChanged
		}
		return err
	}
	return nil
}

func readOnlySQLiteSnapshot(ctx context.Context, dsn string, read func(*sql.Tx) error) (err error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, db.Close()) }()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := read(tx); err != nil {
		return err
	}
	return tx.Commit()
}
