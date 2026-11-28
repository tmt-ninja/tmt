package storage

import (
	"context"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

var _ ports.DigestWakeStore = (*Storage)(nil)

func digestWakeClock(r records) (core.DigestWakeClock, error) {
	var clock core.DigestWakeClock
	err := r.one("SELECT next_admission_ms,scan_after_identity_id FROM orchestration_wake_clock WHERE id=1").
		Scan(&clock.NextAdmissionMs, &clock.ScanAfterIdentityID)
	if isNoRows(err) {
		err = nil
	}
	return clock, err
}

func (s *Storage) WakeCandidates(ctx context.Context, limit uint64) (core.DigestWakeCandidates, error) {
	if limit == 0 || limit > 256 {
		return core.DigestWakeCandidates{}, digestInvalid()
	}
	var page core.DigestWakeCandidates
	err := s.transact(ctx, true, func(r records) error {
		var err error
		page.Clock, err = digestWakeClock(r)
		if err != nil {
			return err
		}
		page.IdentityIDs, err = scanRows(r, `SELECT w.identity_id FROM orchestration_pending_wakes w JOIN identities i ON i.id=w.identity_id
			WHERE i.retired_at_ms IS NULL AND (?1 IS NULL OR w.identity_id>?1) ORDER BY w.identity_id COLLATE BINARY LIMIT ?2`,
			func(row scanner) (core.IdentityID, error) {
				var id core.IdentityID
				err := row.Scan(&id)
				if err == nil && !core.ValidUUID(string(id)) {
					err = errDigestEvidence
				}
				return id, err
			}, page.Clock.ScanAfterIdentityID, limit)
		return err
	})
	if err != nil {
		return core.DigestWakeCandidates{}, err
	}
	return page, nil
}

func (s *Storage) WakePending(ctx context.Context, id core.IdentityID) (bool, error) {
	var pending bool
	err := s.transact(ctx, true, func(r records) error {
		return r.one("SELECT EXISTS(SELECT 1 FROM orchestration_pending_wakes WHERE identity_id=?)", id).Scan(&pending)
	})
	return err == nil && pending, err
}

func (s *Storage) AdvanceWakeScan(ctx context.Context, after *core.IdentityID) error {
	return s.transact(ctx, false, func(r records) error {
		var active bool
		if after != nil {
			if err := r.one("SELECT EXISTS(SELECT 1 FROM identities WHERE id=? AND retired_at_ms IS NULL)", *after).Scan(&active); err != nil {
				return err
			}
		}
		if !active {
			after = nil
		}
		clock, err := digestWakeClock(r)
		if err != nil {
			return err
		}
		if after == nil && clock.ScanAfterIdentityID == nil {
			return nil
		}
		_, err = r.exec(`INSERT INTO orchestration_wake_clock(id,next_admission_ms,scan_after_identity_id) VALUES(1,0,?)
			ON CONFLICT(id) DO UPDATE SET scan_after_identity_id=excluded.scan_after_identity_id
			WHERE scan_after_identity_id IS NOT excluded.scan_after_identity_id`, after)
		return err
	})
}

func (s *Storage) WakeReleased(ctx context.Context, q core.DigestDueQuery) (bool, error) {
	if !safeTime(q.NowMs) {
		return false, digestInvalid()
	}
	cal, err := s.loadDigestCalendar(ctx)
	if err != nil {
		return false, err
	}
	var released bool
	err = s.transact(ctx, false, func(r records) error {
		marker, err := readDigestWakeMarker(r, q.IdentityID)
		if err != nil || marker == nil || marker.checklist != nil {
			return err
		}
		identity, err := r.Identities().FindByID(q.IdentityID)
		if err != nil {
			return err
		}
		user, err := digestIsUser(r, q.IdentityID)
		if err != nil {
			return err
		}
		if identity == nil || user {
			return clearUnclaimedWake(r, q.IdentityID)
		}
		classes, err := eligibleDigestWakeClasses(r, q.IdentityID, marker.classes, q.NowMs)
		if err != nil {
			return err
		}
		if classes == 0 {
			return clearUnclaimedWake(r, q.IdentityID)
		}
		receiving, err := resolveDigestReceiving(r, identity, cal, q.NowMs)
		if err != nil || receiving.mode == "" {
			return err
		}
		allowed, err := releasedDigestClasses(r, q.IdentityID, receiving.mode, q.NowMs)
		released = classes&allowed != 0
		return err
	})
	return err == nil && released, err
}

func clearUnclaimedWake(r records, id core.IdentityID) error {
	_, err := r.exec("DELETE FROM orchestration_pending_wakes WHERE identity_id=? AND checklist_id IS NULL", id)
	return err
}

func releasedDigestClasses(r records, id core.IdentityID, mode core.OrchReceivingMode, now uint64) (uint8, error) {
	legacy, err := digestPolicy(r, id)
	if err != nil {
		return 0, err
	}
	if legacy != nil && legacy.UntilMs > now {
		switch mode {
		case core.OrchReceivingHold:
			return 0, nil
		case core.OrchReceivingUrgent:
			return digestUrgentClass, nil
		}
	}
	return digestAllClasses, nil
}
