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

func (r identityRows) Rename(expected core.Identity, next core.ValidatedName, nowMs uint64) (*core.Identity, error) {
	current, err := r.FindByID(expected.ID)
	if err != nil || current == nil || *current != expected {
		return nil, err
	}
	if next.DisplayName() == "" {
		return nil, core.ErrNameEmptyOrControl
	}
	if current.Name == next.DisplayName() {
		return current, nil
	}
	timestamp, err := storedTimestamp(nowMs)
	if err != nil {
		return nil, err
	}
	ok, err := affectedOne(r.exec(`UPDATE identities SET name = ?, canonical_name = ?, auto_named = 0, updated_at = ?
		WHERE id = ? AND retired_at_ms IS NULL`, next.DisplayName(), next.CanonicalName(), timestamp, expected.ID))
	if err != nil || !ok {
		return nil, err
	}
	return r.FindByID(expected.ID)
}

func (r identityRows) Retire(expected core.Identity, expectedBinding *core.Binding, removeContent bool, nowMs uint64) (bool, error) {
	if !safeTime(nowMs) {
		return false, fmt.Errorf("invalid retirement timestamp")
	}
	identity, err := r.FindByID(expected.ID)
	if err != nil || identity == nil || *identity != expected {
		return false, err
	}
	bindings := bindingRows{r.records}
	binding, err := bindings.FindByIdentity(expected.ID)
	if err != nil || !matchBinding(binding, expectedBinding, false) {
		return false, err
	}
	reserved, err := bindings.FindReservationByIdentity(expected.ID)
	if err != nil || reserved != nil {
		return false, err
	}
	if binding != nil {
		ok, err := bindings.Detach(*binding)
		if err != nil || !ok {
			return false, requiredMutation(ok, err, "binding changed during retirement")
		}
	}
	for _, statement := range []string{
		"DELETE FROM identity_resume_records WHERE identity_id = ?",
		`UPDATE identity_session_preferences SET remembered_harness = NULL, runtime_mode = NULL,
			provider_session_id = NULL, driver_state_version = NULL, driver_state = NULL, stale_at_ms = NULL,
			resume_pending_at_ms = NULL, channel = NULL WHERE identity_id = ?`,
		"DELETE FROM capture_entries WHERE identity_id = ?",
		"DELETE FROM capture_floor WHERE identity_id = ?",
		"DELETE FROM capture_batches WHERE identity_id = ?",
		`DELETE FROM recent_responses WHERE identity_id = ? AND kept_owner_identity_id IS NULL
			AND NOT EXISTS (SELECT 1 FROM request_attempts a WHERE a.kept_capture_sequence = recent_responses.sequence
				AND a.keep_reply = 1 AND a.keep_removed = 0)`,
		"UPDATE recent_responses SET ordinary_dropped = 1 WHERE identity_id = ?",
		"DELETE FROM recent_response_floor WHERE identity_id = ?",
	} {
		if _, err := r.exec(statement, expected.ID); err != nil {
			return false, err
		}
	}
	if removeContent {
		for _, statement := range []string{
			"DELETE FROM identity_metadata WHERE identity_id = ?",
			"DELETE FROM role_profiles WHERE identity_id = ?",
			"DELETE FROM identity_preambles WHERE identity_id = ?",
		} {
			if _, err := r.exec(statement, expected.ID); err != nil {
				return false, err
			}
		}
	}
	ok, err := affectedOne(r.exec("UPDATE identities SET retired_at_ms = ? WHERE id = ? AND retired_at_ms IS NULL", nowMs, expected.ID))
	if err != nil || !ok {
		return false, requiredMutation(ok, err, "identity changed during retirement")
	}
	_, err = r.exec("UPDATE identity_hooks SET state = 'pending' WHERE identity_id = ? AND state = 'registered'", expected.ID)
	return err == nil, err
}
