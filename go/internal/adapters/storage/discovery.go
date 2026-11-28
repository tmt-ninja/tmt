package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

const discoveryEntryLimit = 256

type DiscoveryEntry struct {
	Identity core.Identity
	Binding  core.Binding
}

type DiscoveryPage struct {
	Entries   []DiscoveryEntry
	Truncated bool
}

// ReadDiscovery observes at most 256 active ownership records on the exact
// host and socket. It opens existing current-schema state without provisioning.
func ReadDiscovery(ctx context.Context, root home.Root, host, socket string) (DiscoveryPage, error) {
	page := DiscoveryPage{Entries: []DiscoveryEntry{}}
	if err := ctx.Err(); err != nil {
		return DiscoveryPage{}, err
	}
	directory := filepath.Clean(root.Dir)
	database := filepath.Join(directory, home.DatabaseName)
	if !filepath.IsAbs(directory) || filepath.Clean(root.Database) != database {
		return DiscoveryPage{}, errors.New("invalid tmt-go database path")
	}
	base, err := os.OpenRoot(directory)
	if errors.Is(err, fs.ErrNotExist) {
		return page, nil
	}
	if err != nil {
		return DiscoveryPage{}, err
	}
	defer base.Close()
	file, err := base.Lstat(home.DatabaseName)
	if errors.Is(err, fs.ErrNotExist) {
		return page, nil
	}
	if err != nil {
		return DiscoveryPage{}, err
	}
	if !file.Mode().IsRegular() {
		return DiscoveryPage{}, errors.New("discovery database is not a regular file")
	}
	err = withExistingSQLiteReadOnly(ctx, base, database, 0, func(tx *sql.Tx) error {
		return readDiscoveryPage(ctx, tx, host, socket, &page)
	})
	if err != nil {
		return DiscoveryPage{}, err
	}
	return page, nil
}

func readDiscoveryPage(ctx context.Context, tx *sql.Tx, host, socket string, page *DiscoveryPage) error {
	if err := validateHistoryTable(ctx, tx); err != nil {
		return err
	}
	version, err := validateHistory(ctx, tx)
	if err != nil {
		return err
	}
	if version != SchemaVersion {
		return fmt.Errorf("discovery requires schema version %d, found %d", SchemaVersion, version)
	}
	r := records{ctx: ctx, tx: tx, readOnly: true}
	ids, err := scanRows(r, `SELECT b.identity_id FROM bindings b JOIN identities i ON i.id=b.identity_id
		WHERE b.transport=? AND b.socket_path=? AND i.retired_at_ms IS NULL ORDER BY b.pane_id LIMIT ?`,
		func(row scanner) (core.IdentityID, error) {
			var id core.IdentityID
			err := row.Scan(&id)
			return id, err
		}, host, socket, discoveryEntryLimit+1)
	if err != nil {
		return err
	}
	page.Truncated = len(ids) > discoveryEntryLimit
	for _, id := range ids[:min(len(ids), discoveryEntryLimit)] {
		identity, err := r.Identities().FindByID(id)
		if err != nil {
			return err
		}
		binding, err := r.Bindings().FindByIdentity(id)
		if err != nil {
			return err
		}
		if identity != nil && binding != nil {
			page.Entries = append(page.Entries, DiscoveryEntry{Identity: *identity, Binding: *binding})
		}
	}
	return nil
}
