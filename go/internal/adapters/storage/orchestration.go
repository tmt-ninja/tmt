package storage

import (
	"context"
	"database/sql"
	"encoding/json/v2"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

var _ ports.OrchReader = (*Storage)(nil)

var errInvalidOrchRow = errors.New("invalid stored orchestration data")

func (s *Storage) SchemaVersion(ctx context.Context) (uint64, error) {
	var version uint64
	err := s.transact(ctx, true, func(r records) error {
		return r.one("SELECT COALESCE(MAX(version), 0) FROM _migrations").Scan(&version)
	})
	return version, err
}

func (s *Storage) WakeAdmissionMs(ctx context.Context) (uint64, error) {
	var next uint64
	err := s.transact(ctx, true, func(r records) error {
		clock, err := digestWakeClock(r)
		next = clock.NextAdmissionMs
		return err
	})
	return next, err
}

const orchSnapshotMemberLimit = 256

func (s *Storage) ReadPolicySnapshot(ctx context.Context, q core.OrchSnapshotQuery) (core.OrchSnapshotPage, error) {
	var normalized *string
	if q.MemberQuery != nil {
		name := core.NormalizeName(*q.MemberQuery)
		normalized = &name
	}
	var page core.OrchSnapshotPage
	err := s.transact(ctx, true, func(r records) error {
		type member struct {
			id   core.IdentityID
			name core.Name
		}
		members, err := scanRows(r, `SELECT id,name FROM identities WHERE retired_at_ms IS NULL
			AND (?1 IS NULL OR instr(canonical_name,?1)>0)
			ORDER BY CASE WHEN ?1 IS NOT NULL AND substr(canonical_name,1,length(?1))=?1 THEN 0 ELSE 1 END,
			canonical_name COLLATE BINARY LIMIT ?2`, func(row scanner) (member, error) {
			var m member
			err := row.Scan(&m.id, &m.name)
			return m, err
		}, normalized, orchSnapshotMemberLimit+1)
		if err != nil {
			return err
		}
		if len(members) > orchSnapshotMemberLimit {
			return orchReadLimit()
		}
		identities := make(map[core.IdentityID]core.Name, len(members))
		page.IdentityIDs = make([]core.IdentityID, 0, len(members))
		for _, m := range members {
			identities[m.id] = m.name
			page.IdentityIDs = append(page.IdentityIDs, m.id)
		}
		page.Policy, err = readOrchPolicy(r, identities)
		return err
	})
	if err != nil {
		return core.OrchSnapshotPage{}, err
	}
	return page, nil
}

func (s *Storage) ReadPlans(ctx context.Context) (core.OrchPlansPage, error) {
	var page core.OrchPlansPage
	err := s.transact(ctx, true, func(r records) error {
		if err := r.one("SELECT COALESCE((SELECT revision FROM orchestration_settings WHERE id=1),0)").
			Scan(&page.Revision); err != nil {
			return err
		}
		var err error
		page.Plans, err = orchPlans(r)
		return err
	})
	if err != nil {
		return core.OrchPlansPage{}, err
	}
	return page, nil
}

func (s *Storage) ReadJobs(ctx context.Context, q core.OrchJobQuery) (core.OrchJobReadPage, error) {
	if q.Limit == 0 || q.Limit > 128 || !safeTime(q.NowMs) || !core.ValidJSSafeInteger(q.AfterNumber) ||
		q.FullMessage && q.JobID == nil || !optionalOrchID(q.RoomID) || !optionalOrchID(q.OwnerID) || !optionalOrchID(q.JobID) {
		return core.OrchJobReadPage{}, errors.New("invalid orchestration job query")
	}
	calendar, err := s.loadDigestCalendar(ctx)
	if err != nil {
		return core.OrchJobReadPage{}, err
	}
	var page core.OrchJobReadPage
	err = s.transact(ctx, true, func(r records) error {
		var err error
		page.Items, err = orchJobs(r, q)
		if err != nil {
			return err
		}
		if len(page.Items) > int(q.Limit) {
			page.Items = page.Items[:q.Limit]
			next := page.Items[len(page.Items)-1].Number
			page.NextAfter = &next
		}
		owners := make(map[core.IdentityID]core.Name)
		for _, job := range page.Items {
			if job.OwnerID != nil && job.OwnerName != nil {
				owners[*job.OwnerID] = *job.OwnerName
			}
		}
		page.Policy, err = readOrchPolicy(r, owners)
		if err != nil {
			return err
		}
		page.RecentRuns = make(map[string][]core.OrchJobRun)
		delivery := deliveryProjector{r: r, now: q.NowMs, calendar: calendar}
		for _, job := range page.Items {
			runs, err := orchJobRuns(&delivery, job.ID)
			if err != nil {
				return err
			}
			if len(runs) > 0 {
				page.RecentRuns[job.ID] = runs
			}
		}
		if q.FullMessage {
			err = r.one("SELECT message FROM orchestration_jobs WHERE id=? AND removed=0", *q.JobID).Scan(&page.FullMessage)
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
		}
		return err
	})
	if err != nil {
		return core.OrchJobReadPage{}, err
	}
	return page, nil
}

func optionalOrchID[T ~string](s *T) bool { return s == nil || core.ValidUUID(string(*s)) }

func orchJobs(r records, q core.OrchJobQuery) ([]core.OrchJob, error) {
	rows, err := r.query(`SELECT j.id,j.number,j.revision,j.owner_id,
		CASE WHEN i.retired_at_ms IS NULL THEN i.name END,j.room_id,j.title,substr(j.message,1,256),j.schedule,
		j.pause_by,j.pause_ms,j.pending_revision,j.pending_ms,l.room_id,l.cron_id,i.retired_at_ms IS NOT NULL,
		i.id IS NOT NULL AND i.retired_at_ms IS NULL AND (j.room_id IS NULL OR EXISTS(
			SELECT 1 FROM office_meeting_rooms room JOIN office_meeting_members m ON room.room_id=m.room_id
			WHERE room.room_id=j.room_id AND room.retired=0 AND m.identity_id=j.owner_id))
		FROM orchestration_jobs j LEFT JOIN orchestration_job_legacy l ON l.job_id=j.id
		LEFT JOIN identities i ON i.id=j.owner_id
		WHERE j.removed=0 AND (?1 IS NULL OR j.room_id=?1) AND (?2 IS NULL OR j.owner_id=?2)
			AND (?3 IS NULL OR j.id=?3) AND j.number>?4 ORDER BY j.number LIMIT ?5`,
		q.RoomID, q.OwnerID, q.JobID, q.AfterNumber, int(q.Limit)+1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	jobs := make([]core.OrchJob, 0, q.Limit)
	for rows.Next() {
		job, err := decodeOrchJob(rows)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}

func decodeOrchJob(row scanner) (core.OrchJob, error) {
	var job core.OrchJob
	var schedule []byte
	var pauseBy, legacyRoom *string
	var pauseMs, pendingMs *int64
	var pendingRevision, legacyID *uint64
	err := row.Scan(&job.ID, &job.Number, &job.Revision, &job.OwnerID, &job.OwnerName, &job.RoomID, &job.Title,
		&job.MessagePreview, &schedule, &pauseBy, &pauseMs, &pendingRevision, &pendingMs, &legacyRoom, &legacyID,
		&job.OwnerRetired, &job.OwnerAvailable)
	if err != nil {
		return job, err
	}
	if !core.ValidUUID(job.ID) || !optionalOrchID(job.RoomID) || !optionalOrchID(job.OwnerID) ||
		!safeTime(job.Number) || !safeTime(job.Revision) ||
		(pauseBy == nil) != (pauseMs == nil) || (pendingRevision == nil) != (pendingMs == nil) || (legacyRoom == nil) != (legacyID == nil) {
		return job, errInvalidOrchRow
	}
	if err := json.Unmarshal(schedule, &job.Schedule, json.RejectUnknownMembers(true)); err != nil || !validOrchJobSchedule(job.Schedule) {
		return job, errInvalidOrchRow
	}
	switch {
	case pauseBy != nil:
		job.Pause = &core.OrchJobPause{By: *pauseBy, AtMs: *pauseMs}
	case job.OwnerID == nil:
		return job, errInvalidOrchRow
	}
	if pendingRevision != nil {
		job.Pending = &core.OrchJobPending{Revision: *pendingRevision, SlotMs: *pendingMs}
	}
	if legacyRoom != nil {
		if !core.ValidUUID(*legacyRoom) || !safeTime(*legacyID) {
			return job, errInvalidOrchRow
		}
		job.Legacy = &core.OrchJobLegacy{RoomID: *legacyRoom, CronID: *legacyID}
	}
	if len(job.MessagePreview) > 256 {
		end := 256
		for !utf8.RuneStart(job.MessagePreview[end]) {
			end--
		}
		job.MessagePreview = job.MessagePreview[:end]
	}
	return job, nil
}

func validOrchJobSchedule(s core.OrchJobSchedule) bool {
	if s.Zone == "" {
		return false
	}
	switch s.Kind {
	case core.OrchJobEvery:
		return s.Seconds > 0 && s.AnchorMs >= -core.MaxJSSafeInteger && s.AnchorMs <= core.MaxJSSafeInteger && s.At == "" && s.On == nil && s.Expression == ""
	case core.OrchJobAt:
		return s.At != "" && s.Seconds == 0 && s.AnchorMs == 0 && s.From == nil && s.Expression == ""
	case core.OrchJobCron:
		return s.Expression != "" && s.Seconds == 0 && s.AnchorMs == 0 && s.From == nil && s.At == "" && s.On == nil
	default:
		return false
	}
}

func orchJobRuns(delivery *deliveryProjector, id string) ([]core.OrchJobRun, error) {
	r := delivery.r
	rows, err := r.query(`SELECT j.id,j.revision,j.slot_ms,j.recorded_ms,j.operation_id,d.receipt
		FROM orchestration_job_runs j LEFT JOIN office_dispatch_operations d ON d.operation_id=j.operation_id
		WHERE j.job_id=? ORDER BY j.id DESC LIMIT 5`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var runs []core.OrchJobRun
	for rows.Next() {
		var run core.OrchJobRun
		var operation string
		var receipt []byte
		if err := rows.Scan(&run.ID, &run.Revision, &run.SlotMs, &run.RecordedMs, &operation, &receipt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(receipt, &run.Receipt, json.RejectUnknownMembers(true)); err != nil ||
			!validOrchDispatchReceipt(run.Receipt, operation) || !safeTime(run.ID) || !safeTime(run.Revision) ||
			!safeTime(run.RecordedMs) || run.SlotMs < -core.MaxJSSafeInteger || run.SlotMs > core.MaxJSSafeInteger {
			return nil, errInvalidOrchRow
		}
		runs = append(runs, run)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(runs) > 0 {
		runs[0].Request, err = orchJobRequest(delivery, runs[0].Receipt.Items[0].RequestID)
	}
	return runs, err
}

func validOrchDispatchReceipt(receipt core.OrchDispatchReceipt, operation string) bool {
	if receipt.OperationID != operation || !core.ValidUUID(operation) || !safeTime(receipt.CreatedAtMs) || len(receipt.Items) != 1 {
		return false
	}
	item := receipt.Items[0]
	requestUUID, hasPrefix := strings.CutPrefix(string(item.RequestID), "req_")
	if !core.ValidUUID(string(item.RecipientID)) || !hasPrefix || !core.ValidUUID(requestUUID) {
		return false
	}
	switch item.Acceptance {
	case core.OrchDispatchQueued, core.OrchDispatchRestricted, core.OrchDispatchUnavailable, core.OrchDispatchHeld:
		return true
	default:
		return false
	}
}

func orchJobRequest(delivery *deliveryProjector, id core.RequestID) (*core.OrchJobRequest, error) {
	r, now := delivery.r, delivery.now
	attempt, err := r.Requests().FindByID(id)
	if err != nil || attempt == nil {
		return nil, err
	}
	policy, err := deliveryPolicy(r, id)
	if err != nil {
		return nil, err
	}
	final, err := projectFinal(r, *attempt, policy.mode, now)
	if err != nil {
		return nil, err
	}
	view, err := delivery.project(*attempt)
	if err != nil {
		return nil, err
	}
	return &core.OrchJobRequest{
		Attempt: *attempt, Final: final, DeliveryView: view,
		Urgent: policy.urgent, DigestKind: policy.kind, Mode: policy.mode,
	}, nil
}
