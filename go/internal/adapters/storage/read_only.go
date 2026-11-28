package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
)

// The caller has already checked the configured database path. Without a
// WAL, immutable prevents SQLite from initializing logging sidecars.
func openExistingSQLiteReadOnly(root *os.Root, path string, waitMs uint64) (*sql.DB, error) {
	parameters := url.Values{"mode": {"ro"}, "_pragma": {fmt.Sprintf("busy_timeout(%d)", waitMs)}}
	name := filepath.Base(path)
	wal, err := root.Lstat(name + "-wal")
	switch {
	case errors.Is(err, fs.ErrNotExist):
		parameters.Set("immutable", "1")
	case err != nil:
		return nil, err
	case !wal.Mode().IsRegular():
		return nil, errors.New("invalid database WAL file")
	default:
		shm, err := root.Lstat(name + "-shm")
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return nil, err
		}
		if errors.Is(err, fs.ErrNotExist) || !shm.Mode().IsRegular() {
			// NOT PORTED (#6938, GO1-09): native can read a WAL without an existing index.
			// Do not let SQLite initialize a sidecar during read-only inspection.
			return nil, errors.New("read-only SQLite requires an existing shared-memory index for the WAL")
		}
	}
	dsn := url.URL{Scheme: "file", Path: path, RawQuery: parameters.Encode()}
	return sql.Open("sqlite", dsn.String())
}
