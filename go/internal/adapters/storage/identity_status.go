package storage

import "github.com/tmt-ninja/tmt/go/internal/core"

func (r identityRows) ReadStatus(id core.IdentityID) (*core.IdentityStatus, error) {
	if err := r.requireActive(id); err != nil {
		return nil, err
	}
	var status core.IdentityStatus
	err := r.one("SELECT activity,mood,updated_at_ms,expires_at_ms FROM identity_status WHERE identity_id=?", id).
		Scan(&status.Activity, &status.Mood, &status.UpdatedAtMs, &status.ExpiresAtMs)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := status.Validate(); err != nil {
		return nil, err
	}
	return &status, nil
}

func (r identityRows) PutStatus(id core.IdentityID, status core.IdentityStatus) error {
	if err := status.Validate(); err != nil {
		return err
	}
	if err := r.requireActive(id); err != nil {
		return err
	}
	_, err := r.exec(`INSERT INTO identity_status(identity_id,activity,mood,updated_at_ms,expires_at_ms) VALUES(?,?,?,?,?)
		ON CONFLICT(identity_id) DO UPDATE SET activity=excluded.activity,mood=excluded.mood,
			updated_at_ms=excluded.updated_at_ms,expires_at_ms=excluded.expires_at_ms`, id, status.Activity, status.Mood, status.UpdatedAtMs, status.ExpiresAtMs)
	return err
}

func (r identityRows) RemoveStatus(id core.IdentityID) (bool, error) {
	if err := r.requireActive(id); err != nil {
		return false, err
	}
	return affectedOne(r.exec("DELETE FROM identity_status WHERE identity_id=?", id))
}
