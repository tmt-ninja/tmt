package storage

import (
	"encoding/json/v2"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

func (r identityRows) requireActive(id core.IdentityID) error {
	var active bool
	err := r.one("SELECT EXISTS(SELECT 1 FROM identities WHERE id=? AND retired_at_ms IS NULL)", id).Scan(&active)
	if err == nil && !active {
		return core.ErrIdentityInactive
	}
	return err
}

func (r identityRows) IsRetired(id core.IdentityID) (bool, error) {
	var retired bool
	err := r.one("SELECT EXISTS(SELECT 1 FROM identities WHERE id=? AND retired_at_ms IS NOT NULL)", id).Scan(&retired)
	return retired, err
}

func (r identityRows) ReadMetadata(id core.IdentityID) (map[string]string, error) {
	if err := r.requireActive(id); err != nil {
		return nil, err
	}
	rows, err := r.query("SELECT key,value FROM identity_metadata WHERE identity_id=?", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]string)
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, err
		}
		result[key] = value
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r identityRows) ListMatchingMetadata(filters []core.MetadataFilter) ([]core.Identity, error) {
	if len(filters) == 0 {
		return r.List()
	}
	for _, filter := range filters {
		if err := filter.Validate(); err != nil {
			return nil, err
		}
	}
	encoded, err := json.Marshal(filters)
	if err != nil {
		return nil, err
	}
	return scanRows(r.records, `SELECT `+identityColumns+` FROM identities i WHERE i.retired_at_ms IS NULL
		AND NOT EXISTS(SELECT 1 FROM json_each(?1) f WHERE NOT EXISTS(
			SELECT 1 FROM identity_metadata m WHERE m.identity_id=i.id AND m.key=json_extract(f.value,'$.Key') COLLATE BINARY
			AND (json_extract(f.value,'$.Value') IS NULL OR m.value=json_extract(f.value,'$.Value') COLLATE BINARY)))
		ORDER BY i.canonical_name COLLATE BINARY`, func(row scanner) (core.Identity, error) {
		identity, err := readIdentity(row)
		if err != nil {
			return core.Identity{}, err
		}
		return *identity, nil
	}, string(encoded))
}

func (r identityRows) ApplyMetadata(id core.IdentityID, changes []core.MetadataChange) (core.MetadataApplyResult, error) {
	snapshot, err := r.ReadMetadata(id)
	if err != nil {
		return core.MetadataApplyResult{}, err
	}
	next, result, err := core.EvaluateMetadataChanges(snapshot, changes)
	if err != nil || !result.Changed {
		return result, err
	}
	for _, change := range changes {
		if err := r.applyMetadataChange(id, change.Key, snapshot, next); err != nil {
			return core.MetadataApplyResult{}, err
		}
	}
	return result, nil
}

func (r identityRows) applyMetadataChange(id core.IdentityID, key string, snapshot, next map[string]string) error {
	previous, wasPresent := snapshot[key]
	value, present := next[key]
	switch {
	case present && (!wasPresent || previous != value):
		_, err := r.exec(`INSERT INTO identity_metadata(identity_id,key,value) VALUES(?,?,?)
			ON CONFLICT(identity_id,key) DO UPDATE SET value=excluded.value`, id, key, value)
		return err
	case wasPresent && !present:
		_, err := r.exec("DELETE FROM identity_metadata WHERE identity_id=? AND key=?", id, key)
		return err
	default:
		return nil
	}
}
