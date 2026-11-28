package storage

import (
	"fmt"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

type identityRows struct{ records }

const identityColumns = "id, name, canonical_name, lifetime, created_at, updated_at, auto_named"

func readIdentity(row scanner) (*core.Identity, error) {
	var identity core.Identity
	err := row.Scan(&identity.ID, &identity.Name, &identity.CanonicalName, &identity.Lifetime,
		&identity.CreatedAt, &identity.UpdatedAt, &identity.AutoNamed)
	if err != nil {
		return nil, err
	}
	return &identity, nil
}

func (r identityRows) FindByID(id core.IdentityID) (*core.Identity, error) {
	return optional(readIdentity(r.one("SELECT "+identityColumns+" FROM identities WHERE id = ? AND retired_at_ms IS NULL", id)))
}

func (r identityRows) FindByCanonicalName(name string) (*core.Identity, error) {
	return optional(readIdentity(r.one("SELECT "+identityColumns+" FROM identities WHERE canonical_name = ? AND retired_at_ms IS NULL", name)))
}

func (r identityRows) List() ([]core.Identity, error) {
	rows, err := r.query("SELECT " + identityColumns + " FROM identities WHERE retired_at_ms IS NULL ORDER BY canonical_name COLLATE BINARY")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	identities := []core.Identity{}
	for rows.Next() {
		identity, err := readIdentity(rows)
		if err != nil {
			return nil, err
		}
		identities = append(identities, *identity)
	}
	return identities, rows.Err()
}

func (r identityRows) Insert(identity core.Identity, nowMs uint64) error {
	timestamp, err := storedTimestamp(nowMs)
	if err != nil {
		return err
	}
	_, err = r.exec(`INSERT INTO identities (id, name, canonical_name, lifetime, auto_named, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, identity.ID, identity.Name, identity.CanonicalName, identity.Lifetime,
		identity.AutoNamed, timestamp, timestamp)
	return err
}

func (r identityRows) Promote(id core.IdentityID, nowMs uint64) error {
	timestamp, err := storedTimestamp(nowMs)
	if err != nil {
		return err
	}
	changed, err := r.exec(`UPDATE identities SET lifetime = 'saved', updated_at = ?
		WHERE id = ? AND retired_at_ms IS NULL AND lifetime = 'temporary'`, timestamp, id)
	if err != nil {
		return err
	}
	count, err := changed.RowsAffected()
	if err == nil && count != 1 {
		return fmt.Errorf("identity %q is not an active temporary identity", id)
	}
	return err
}
