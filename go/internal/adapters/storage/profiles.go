package storage

import (
	"fmt"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type profileRows struct{ records }

var _ ports.ProfileRepo = profileRows{}

func profileTable(kind core.ProfileKind) (string, error) {
	switch kind {
	case core.ProfileRole:
		return "role_profiles", nil
	case core.ProfilePreamble:
		return "identity_preambles", nil
	default:
		return "", fmt.Errorf("unknown profile kind %q", kind)
	}
}

func scanProfile(row scanner) (core.TextProfile, error) {
	var p core.TextProfile
	var stamp string
	if err := row.Scan(&p.IdentityID, &p.Content, &stamp); err != nil {
		return p, err
	}
	updated, err := time.Parse(time.RFC3339Nano, stamp)
	if err != nil || updated.UnixMilli() <= 0 || !safeTime(uint64(updated.UnixMilli())) {
		return p, fmt.Errorf("invalid stored profile update time")
	}
	p.UpdatedAtMs = uint64(updated.UnixMilli())
	return p, nil
}

func (r profileRows) Get(kind core.ProfileKind, id core.IdentityID) (*core.TextProfile, error) {
	table, err := profileTable(kind)
	if err != nil {
		return nil, err
	}
	p, err := scanProfile(r.one("SELECT p.identity_id, p.content, p.updated_at FROM "+table+` p
		JOIN identities i ON i.id = p.identity_id WHERE i.retired_at_ms IS NULL AND i.id = ?`, id))
	return optional(&p, err)
}

func (r profileRows) List(kind core.ProfileKind) ([]core.TextProfile, error) {
	table, err := profileTable(kind)
	if err != nil {
		return nil, err
	}
	return scanRows(r.records, "SELECT p.identity_id, p.content, p.updated_at FROM "+table+` p
		JOIN identities i ON i.id = p.identity_id WHERE i.retired_at_ms IS NULL
		ORDER BY i.canonical_name COLLATE BINARY`, scanProfile)
}

func (r profileRows) Put(kind core.ProfileKind, id core.IdentityID, content string, nowMs uint64) (*core.TextProfile, error) {
	table, err := profileTable(kind)
	if err != nil {
		return nil, err
	}
	content, err = core.NormalizeProfileContent(content)
	if err != nil {
		return nil, err
	}
	timestamp, err := storedTimestamp(nowMs)
	if err != nil {
		return nil, err
	}
	changed, err := affectedOne(r.exec("INSERT INTO "+table+` (identity_id, content, updated_at)
		SELECT id, ?, ? FROM identities WHERE id = ? AND retired_at_ms IS NULL
		ON CONFLICT(identity_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
		content, timestamp, id))
	if err != nil || !changed {
		return nil, err
	}
	return &core.TextProfile{IdentityID: id, Content: content, UpdatedAtMs: nowMs}, nil
}

func (r profileRows) Remove(kind core.ProfileKind, id core.IdentityID) (bool, error) {
	table, err := profileTable(kind)
	if err != nil {
		return false, err
	}
	return affectedOne(r.exec("DELETE FROM "+table+` WHERE identity_id = ?
		AND EXISTS (SELECT 1 FROM identities WHERE id = ? AND retired_at_ms IS NULL)`, id, id))
}
