package storage

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"io/fs"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/home"
)

const (
	footprintEntryLimit = 10000
	footprintNotesDepth = 2
)

type AutoVacuum string

const (
	AutoVacuumNone        AutoVacuum = "none"
	AutoVacuumFull        AutoVacuum = "full"
	AutoVacuumIncremental AutoVacuum = "incremental"
)

type DatabasePages struct {
	PageSize, PageCount, FreePages uint64
	AutoVacuum                     AutoVacuum
}

func (p DatabasePages) FreeBytes() uint64 {
	if p.PageSize != 0 && p.FreePages > math.MaxUint64/p.PageSize {
		return math.MaxUint64
	}
	return p.PageSize * p.FreePages
}

type StoreFile struct {
	Path  string
	Bytes uint64
}

type DatabaseFootprint struct {
	Path            string
	Bytes, WALBytes uint64
	Pages           *DatabasePages
	PageError       *string
}

type NotesFootprint struct {
	Path         string
	Bytes, Files uint64
	Complete     bool
}

type ColabFootprint struct {
	Path            string
	Bytes, WALBytes uint64
	Backups         []StoreFile
}

type Footprint struct {
	DataRoot, DatabasePath, NotesPath, ColabPath string
	Database                                     *DatabaseFootprint
	Notes                                        *NotesFootprint
	Colab                                        *ColabFootprint
}

// InspectFootprint observes the provided Go home without provisioning any
// stores. SQLite accounting failures are attached to the database section.
func InspectFootprint(ctx context.Context, root home.Root) (Footprint, error) {
	if err := ctx.Err(); err != nil {
		return Footprint{}, err
	}
	directory := filepath.Clean(root.Dir)
	database := filepath.Join(directory, home.DatabaseName)
	if !filepath.IsAbs(directory) || filepath.Clean(root.Database) != database {
		return Footprint{}, errors.New("invalid tmt-go database path")
	}
	result := Footprint{DataRoot: directory, DatabasePath: database, NotesPath: filepath.Join(directory, "notes"),
		ColabPath: filepath.Join(directory, "colab", "space.db")}
	base, err := os.OpenRoot(directory)
	if errors.Is(err, fs.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return Footprint{}, err
	}
	defer base.Close()
	if result.Database, err = inspectDatabaseFootprint(ctx, base, database); err != nil {
		return Footprint{}, err
	}
	if result.Notes, err = inspectNotesFootprint(ctx, base, result.NotesPath); err != nil {
		return Footprint{}, err
	}
	if result.Colab, err = inspectColabFootprint(ctx, base, result.ColabPath); err != nil {
		return Footprint{}, err
	}
	return result, ctx.Err()
}

func statFootprintFile(root *os.Root, name string) (*uint64, error) {
	info, err := root.Lstat(name)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, nil
	}
	size := uint64(info.Size())
	return &size, nil
}

func inspectDatabaseFootprint(ctx context.Context, root *os.Root, path string) (*DatabaseFootprint, error) {
	name := filepath.Base(path)
	size, err := statFootprintFile(root, name)
	if err != nil || size == nil {
		return nil, err
	}
	wal, err := statFootprintFile(root, name+"-wal")
	if err != nil {
		return nil, err
	}
	result := DatabaseFootprint{Path: path, Bytes: *size}
	if wal != nil {
		result.WALBytes = *wal
	}
	result.Pages, err = observeFootprintPages(ctx, root, path, wal != nil)
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		message := err.Error()
		result.PageError = &message
	}
	return &result, nil
}

func observeFootprintPages(ctx context.Context, root *os.Root, path string, wal bool) (*DatabasePages, error) {
	parameters := url.Values{"mode": {"ro"}, "_pragma": {"busy_timeout(100)"}}
	name := filepath.Base(path)
	if wal {
		shm, err := statFootprintFile(root, name+"-shm")
		if err != nil {
			return nil, err
		}
		if shm == nil {
			// NOT PORTED (#6938, GO1-09): native can observe a WAL without an existing index.
			// Refuse that case so SQLite does not initialize a sidecar during inspection.
			return nil, errors.New("WAL page counts require an existing shared-memory index")
		}
	} else {
		if info, err := root.Lstat(name + "-wal"); err == nil && !info.Mode().IsRegular() {
			return nil, errors.New("invalid database WAL file")
		} else if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return nil, err
		}
		parameters.Set("immutable", "1")
	}
	dsn := url.URL{Scheme: "file", Path: path, RawQuery: parameters.Encode()}
	db, err := sql.Open("sqlite", dsn.String())
	if err != nil {
		return nil, err
	}
	defer db.Close()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var result DatabasePages
	var vacuum uint64
	err = tx.QueryRowContext(ctx, `SELECT page_size,page_count,freelist_count,auto_vacuum FROM
		pragma_page_size(),pragma_page_count(),pragma_freelist_count(),pragma_auto_vacuum()`).
		Scan(&result.PageSize, &result.PageCount, &result.FreePages, &vacuum)
	if err != nil {
		return nil, err
	}
	switch vacuum {
	case 0:
		result.AutoVacuum = AutoVacuumNone
	case 1:
		result.AutoVacuum = AutoVacuumFull
	case 2:
		result.AutoVacuum = AutoVacuumIncremental
	default:
		return nil, errors.New("unrecognized database auto-vacuum mode")
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &result, nil
}

func openFootprintDirectory(root *os.Root, name string) (*os.Root, error) {
	info, err := root.Lstat(name)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil || !info.IsDir() {
		return nil, err
	}
	return root.OpenRoot(name)
}

func inspectNotesFootprint(ctx context.Context, base *os.Root, path string) (*NotesFootprint, error) {
	root, err := openFootprintDirectory(base, "notes")
	if err != nil || root == nil {
		return nil, err
	}
	defer root.Close()
	result := NotesFootprint{Path: path, Complete: true}
	type directory struct {
		path  string
		depth int
	}
	pending := []directory{{path: "."}}
	remaining := footprintEntryLimit
	for len(pending) > 0 {
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		done, err := walkFootprintDirectory(ctx, root, current.path, &remaining, func(entry fs.DirEntry) error {
			switch {
			case entry.IsDir() && current.depth < footprintNotesDepth:
				pending = append(pending, directory{path: filepath.Join(current.path, entry.Name()), depth: current.depth + 1})
			case entry.Type().IsRegular():
				info, err := entry.Info()
				if err != nil {
					return err
				}
				if info.Mode().IsRegular() {
					result.Bytes += uint64(info.Size())
					result.Files++
				}
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
		if !done {
			result.Complete = false
			break
		}
	}
	return &result, nil
}

func inspectColabFootprint(ctx context.Context, base *os.Root, path string) (*ColabFootprint, error) {
	root, err := openFootprintDirectory(base, "colab")
	if err != nil || root == nil {
		return nil, err
	}
	defer root.Close()
	size, err := statFootprintFile(root, "space.db")
	if err != nil || size == nil {
		return nil, err
	}
	result := ColabFootprint{Path: path, Bytes: *size, Backups: make([]StoreFile, 0)}
	wal, err := statFootprintFile(root, "space.db-wal")
	if err != nil {
		return nil, err
	}
	if wal != nil {
		result.WALBytes = *wal
	}
	remaining := footprintEntryLimit
	done, err := walkFootprintDirectory(ctx, root, ".", &remaining, func(entry fs.DirEntry) error {
		if !isColabFootprintBackup(entry.Name()) || !entry.Type().IsRegular() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode().IsRegular() {
			result.Backups = append(result.Backups, StoreFile{Path: filepath.Join(filepath.Dir(path), entry.Name()), Bytes: uint64(info.Size())})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if !done {
		// NOT PORTED (#6938, GO1-10): native backup discovery has no entry limit.
		return nil, errors.New("Colab footprint directory exceeds its inspection limit")
	}
	slices.SortFunc(result.Backups, func(a, b StoreFile) int { return strings.Compare(a.Path, b.Path) })
	return &result, nil
}

func isColabFootprintBackup(name string) bool {
	version, ok := strings.CutPrefix(name, "space.db.pre-v")
	if !ok {
		return false
	}
	version, ok = strings.CutSuffix(version, ".bak")
	if !ok || version == "" {
		return false
	}
	return !strings.ContainsFunc(version, func(c rune) bool { return c < '0' || c > '9' })
}

// Directory enumeration is capped without reading an entire huge directory at
// once. One extra entry distinguishes an exact fit from a truncated report.
func walkFootprintDirectory(ctx context.Context, root *os.Root, path string, remaining *int, visit func(fs.DirEntry) error) (bool, error) {
	f, err := root.Open(path)
	if err != nil {
		return false, err
	}
	defer f.Close()
	for {
		if err := ctx.Err(); err != nil {
			return false, err
		}
		entries, err := f.ReadDir(min(*remaining+1, 256))
		if err != nil && !errors.Is(err, io.EOF) {
			return false, err
		}
		for _, entry := range entries {
			if *remaining == 0 {
				return false, nil
			}
			*remaining -= 1
			if err := visit(entry); err != nil {
				return false, err
			}
		}
		if errors.Is(err, io.EOF) {
			return true, nil
		}
	}
}
