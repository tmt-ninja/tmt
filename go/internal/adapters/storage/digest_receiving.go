package storage

import (
	"context"
	"encoding/json/v2"
	"errors"
	"slices"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/orchestration"
	"github.com/tmt-ninja/tmt/go/internal/core"
)

type digestReceivingDocument struct {
	Enabled          bool                         `json:"enabled"`
	DefaultReceiving core.OrchReceiving           `json:"defaultReceiving"`
	Members          []core.DigestReceivingMember `json:"members"`
}

func normalizeDigestReceiving(d *digestReceivingDocument) bool {
	if !validOrchReceiving(d.DefaultReceiving, true) || len(d.Members) > 256 {
		return false
	}
	slices.SortFunc(d.Members, func(a, b core.DigestReceivingMember) int {
		return strings.Compare(string(a.IdentityID), string(b.IdentityID))
	})
	for i, m := range d.Members {
		if !core.ValidUUID(string(m.IdentityID)) || !validOrchReceiving(m.Receiving, true) ||
			i > 0 && d.Members[i-1].IdentityID == m.IdentityID {
			return false
		}
	}
	return true
}

func readDigestReceiving(r records) (uint64, digestReceivingDocument, error) {
	var revision uint64
	var raw []byte
	var document digestReceivingDocument
	err := r.one("SELECT revision,settings FROM digest_receiving_settings WHERE id=1").Scan(&revision, &raw)
	if isNoRows(err) {
		return 0, document, nil
	}
	if err != nil {
		return 0, document, err
	}
	if json.Unmarshal(raw, &document, json.RejectUnknownMembers(true)) != nil || !normalizeDigestReceiving(&document) {
		return 0, document, errInvalidOrchRow
	}
	return revision, document, nil
}

func (s *Storage) SyncReceiving(ctx context.Context, q core.DigestReceivingWrite) (uint64, error) {
	d := digestReceivingDocument{Enabled: q.Enabled, DefaultReceiving: q.Default, Members: slices.Clone(q.Members)}
	if !core.ValidJSSafeInteger(q.ExpectedRevision) || !normalizeDigestReceiving(&d) {
		return 0, requestFailure("ORCH_INVALID", "Invalid orchestration configuration.", 1)
	}
	var revision uint64
	err := s.transact(ctx, false, func(r records) error {
		current, old, err := readDigestReceiving(r)
		if err != nil {
			return err
		}
		if current != q.ExpectedRevision {
			return requestFailure("ORCH_CONFLICT", "Orchestration configuration changed.", 5)
		}
		revision = current
		if current != 0 && old.Enabled == d.Enabled && old.DefaultReceiving == d.DefaultReceiving && slices.Equal(old.Members, d.Members) {
			return nil
		}
		if current >= core.MaxJSSafeInteger {
			return requestFailure("ORCH_LIMIT", "Orchestration limit was reached.", 1)
		}
		encoded, err := json.Marshal(d)
		if err != nil {
			return err
		}
		revision = current + 1
		_, err = r.exec(`INSERT INTO digest_receiving_settings(id,revision,settings) VALUES(1,?,?)
			ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,settings=excluded.settings`, revision, string(encoded))
		return err
	})
	if err != nil {
		return 0, err
	}
	return revision, nil
}

type digestCalendar struct {
	configured *string
	calendar   orchestration.Calendar
	loadErr    error
}

func (s *Storage) loadDigestCalendar(ctx context.Context) (digestCalendar, error) {
	var cal digestCalendar
	if err := s.db.QueryRowContext(ctx, "SELECT (SELECT time_zone FROM orchestration_settings WHERE id=1)").
		Scan(&cal.configured); err != nil {
		return cal, err
	}
	// Zone discovery and loading happen before the caller's writer. Only a
	// published receiving policy needs the resolved calendar.
	cal.calendar, cal.loadErr = orchestration.LoadCalendar(cal.configured)
	return cal, nil
}

type digestReceiving struct {
	source     core.OrchSource
	mode       core.OrchReceivingMode
	intervalMs uint64
	nextChange *uint64
	revision   uint64
	zone       string
}

func resolveDigestReceiving(r records, identity *core.Identity, cal digestCalendar, now uint64) (digestReceiving, error) {
	policy, err := readOrchPolicy(r, map[core.IdentityID]core.Name{identity.ID: identity.Name})
	if err != nil || policy.DigestRevision == 0 {
		return digestReceiving{}, err
	}
	if !equalOptionalText(policy.TimeZone, cal.configured) {
		return digestReceiving{}, errors.New("receiving calendar selection changed; retry the operation")
	}
	if cal.loadErr != nil {
		return digestReceiving{}, cal.loadErr
	}
	effective, err := core.ResolveOrchEffective(policy, identity.ID, now, cal.calendar)
	if err != nil {
		return digestReceiving{}, err
	}
	return digestReceiving{
		source: effective.Receiving.Source, mode: effective.Receiving.Value.Mode,
		intervalMs: effective.Receiving.Value.IntervalMs, nextChange: effective.NextChangeAtMs,
		revision: policy.Revision, zone: cal.calendar.Name(),
	}, nil
}

func (d *digestReceiving) consider(now, when uint64) {
	if when > now && (d.nextChange == nil || when < *d.nextChange) {
		d.nextChange = &when
	}
}
