package orchestration

import (
	"context"
	"encoding/base64"
	json "encoding/json/v2"
	"reflect"
	"strconv"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/jobcalendar"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const JobDefaultLimit = 50
const JobMaxLimit = 128

type jobCursor struct {
	Version uint8   `json:"version"`
	After   uint64  `json:"after"`
	Room    *string `json:"room"`
	Owner   *string `json:"owner"`
	Job     *string `json:"job"`
}

func cursorForJobQuery(query core.OrchJobQuery, after uint64) jobCursor {
	return jobCursor{Version: 1, After: after, Room: query.RoomID, Owner: (*string)(query.OwnerID), Job: query.JobID}
}

// AdmitJobs binds a continuation to the same canonical filter tuple.
func AdmitJobs(query core.OrchJobQuery, encoded *string) (core.OrchJobQuery, bool) {
	if query.Limit == 0 || query.Limit > JobMaxLimit {
		return query, false
	}
	for _, id := range []*string{query.RoomID, (*string)(query.OwnerID), query.JobID} {
		if id != nil && !canonicalOrchID(*id) {
			return query, false
		}
	}
	if encoded == nil {
		return query, true
	}
	if len(*encoded) == 0 || len(*encoded) > 512 || query.FullMessage {
		return query, false
	}
	data, err := base64.RawURLEncoding.Strict().DecodeString(*encoded)
	if err != nil || base64.RawURLEncoding.EncodeToString(data) != *encoded {
		return query, false
	}
	var cursor jobCursor
	if !readStrict(data, &cursor) || cursor.After == 0 || !core.ValidJSSafeInteger(cursor.After) ||
		!reflect.DeepEqual(cursor, cursorForJobQuery(query, cursor.After)) {
		return query, false
	}
	query.AfterNumber = cursor.After
	return query, true
}

type JobListView struct {
	SchemaVersion         int      `json:"schemaVersion"`
	ObservedAtMs          uint64   `json:"observedAtMs"`
	ConfigurationRevision uint64   `json:"configurationRevision"`
	Jobs                  []JobRow `json:"jobs"`
	NextCursor            *string  `json:"nextCursor"`
	HistoryCoverage       string   `json:"historyCoverage"`
}

type JobDetailView struct {
	SchemaVersion         int    `json:"schemaVersion"`
	ObservedAtMs          uint64 `json:"observedAtMs"`
	ConfigurationRevision uint64 `json:"configurationRevision"`
	Job                   JobRow `json:"job"`
	HistoryCoverage       string `json:"historyCoverage"`
}

type JobRow struct {
	JobID          string                                     `json:"jobId"`
	DisplayID      string                                     `json:"displayId"`
	Revision       uint64                                     `json:"revision"`
	Legacy         *jobLegacy                                 `json:"legacy"`
	Target         jobTarget                                  `json:"target"`
	Title          *string                                    `json:"title"`
	MessagePreview string                                     `json:"messagePreview"`
	Schedule       jobSchedule                                `json:"schedule"`
	State          string                                     `json:"state"`
	ManualPause    *jobPause                                  `json:"manualPause"`
	HeldSlot       *jobSlot                                   `json:"heldSlot"`
	Routine        *core.OrchEffectiveField[core.OrchRoutine] `json:"routine"`
	NextRunAtMs    *int64                                     `json:"nextRunAtMs"`
	LastRun        *jobLastRun                                `json:"lastRun"`
	RecentRuns     []jobRecentRun                             `json:"recentRuns"`
	Definition     *jobDefinition                             `json:"definition,omitempty"`
}

type jobLegacy struct {
	RoomID string `json:"roomId"`
	CronID uint64 `json:"cronId"`
}

type jobTarget struct {
	RoomID       *string          `json:"squadRoomId"`
	IdentityID   *core.IdentityID `json:"identityId"`
	IdentityName *core.Name       `json:"identityName"`
}

type jobPause struct {
	By   string `json:"by"`
	AtMs int64  `json:"atMs"`
}

type jobSlot struct {
	Revision uint64 `json:"revision"`
	AtMs     int64  `json:"atMs"`
}

type jobDefinition struct {
	OwnerID  *core.IdentityID `json:"ownerIdentityId"`
	RoomID   *string          `json:"squadRoomId"`
	Title    *string          `json:"title"`
	Message  string           `json:"message"`
	Schedule jobSchedule      `json:"schedule"`
	Pause    *jobPause        `json:"pause"`
}

// Keep null from/on in the matching variant and omit fields from other variants.
type jobSchedule struct {
	Kind       core.OrchJobScheduleKind `json:"kind"`
	Zone       string                   `json:"zone"`
	Seconds    *int64                   `json:"seconds,omitzero"`
	AnchorMs   *int64                   `json:"anchorMs,omitzero"`
	From       **string                 `json:"from,omitzero"`
	At         string                   `json:"at,omitempty"`
	On         **string                 `json:"on,omitzero"`
	Expression string                   `json:"expression,omitempty"`
}

func scheduleForJob(rule core.OrchJobSchedule) jobSchedule {
	s := jobSchedule{Kind: rule.Kind, Zone: rule.Zone}
	switch rule.Kind {
	case core.OrchJobEvery:
		s.Seconds, s.AnchorMs, s.From = &rule.Seconds, &rule.AnchorMs, &rule.From
	case core.OrchJobAt:
		s.At, s.On = rule.At, &rule.On
	case core.OrchJobCron:
		s.Expression = rule.Expression
	}
	return s
}

func nextJobRun(schedule jobSchedule, now uint64) (*int64, *core.RequestFailure) {
	encoded, err := json.Marshal(schedule)
	if err != nil {
		return nil, InvalidJob()
	}
	if len(encoded) > 4096 {
		return nil, jobLimit()
	}
	var parsed jobcalendar.Schedule
	if err := parsed.UnmarshalJSON(encoded); err != nil {
		return nil, InvalidJob()
	}
	next, exists, err := parsed.NextAfter(int64(now))
	if err != nil {
		return nil, InvalidJob()
	}
	if next < -core.MaxJSSafeInteger || next > core.MaxJSSafeInteger {
		return nil, jobLimit()
	}
	if !exists {
		return nil, nil
	}
	return &next, nil
}

func InvalidJob() *core.RequestFailure {
	return &core.RequestFailure{Code: "ORCH_INPUT_INVALID", Message: "Invalid job input, calendar or page selection.", Status: 1}
}

func missingJob() *core.RequestFailure {
	return &core.RequestFailure{Code: "ORCH_JOB_NOT_FOUND", Message: "Job was not found.", Status: 3}
}

func jobLimit() *core.RequestFailure {
	return &core.RequestFailure{Code: "ORCH_LIMIT", Message: "Job operation exceeds its bounded expansion.", Status: 1}
}

func jobReadFailure(err error) *core.RequestFailure {
	failure := readFailure(err)
	if failure.Code == "ORCH_STORAGE_UNAVAILABLE" {
		return &core.RequestFailure{Code: failure.Code, Message: "Could not read or change job storage.", Status: 1}
	}
	return failure
}

func ReadJobs(ctx context.Context, reader ports.OrchReader, query core.OrchJobQuery) (JobListView, *core.RequestFailure) {
	page, rows, failure := readJobRows(ctx, reader, query)
	if failure != nil {
		return JobListView{}, failure
	}
	view := JobListView{
		SchemaVersion: 1, ObservedAtMs: query.NowMs, ConfigurationRevision: page.Policy.Revision,
		Jobs: rows, HistoryCoverage: "recorded_only",
	}
	if page.NextAfter != nil {
		encoded, err := json.Marshal(cursorForJobQuery(query, *page.NextAfter))
		if err != nil {
			return JobListView{}, InvalidJob()
		}
		cursor := base64.RawURLEncoding.EncodeToString(encoded)
		view.NextCursor = &cursor
	}
	if failure := boundReadOutput(view); failure != nil {
		return JobListView{}, failure
	}
	return view, nil
}

func ReadJob(ctx context.Context, reader ports.OrchReader, query core.OrchJobQuery) (JobDetailView, *core.RequestFailure) {
	query.FullMessage, query.Limit = true, 1
	page, rows, failure := readJobRows(ctx, reader, query)
	if failure != nil {
		return JobDetailView{}, failure
	}
	view := JobDetailView{
		SchemaVersion: 1, ObservedAtMs: query.NowMs, ConfigurationRevision: page.Policy.Revision,
		Job: rows[0], HistoryCoverage: "recorded_only",
	}
	if failure := boundReadOutput(view); failure != nil {
		return JobDetailView{}, failure
	}
	return view, nil
}

func readJobRows(ctx context.Context, reader ports.OrchReader, query core.OrchJobQuery) (core.OrchJobReadPage, []JobRow, *core.RequestFailure) {
	page, err := reader.ReadJobs(ctx, query)
	if err != nil {
		return core.OrchJobReadPage{}, nil, jobReadFailure(err)
	}
	if query.FullMessage && (len(page.Items) != 1 || page.FullMessage == nil) {
		return core.OrchJobReadPage{}, nil, missingJob()
	}
	calendar, err := LoadCalendar(page.Policy.TimeZone)
	if err != nil {
		return core.OrchJobReadPage{}, nil, readFailure(err)
	}
	rows := make([]JobRow, 0, len(page.Items))
	for _, job := range page.Items {
		row, failure := jobRow(page.Policy, job, page.RecentRuns[job.ID], query.NowMs, calendar)
		if failure != nil {
			return core.OrchJobReadPage{}, nil, failure
		}
		if query.FullMessage {
			row.Definition = &jobDefinition{
				OwnerID: job.OwnerID, RoomID: job.RoomID, Title: job.Title,
				Message: *page.FullMessage, Schedule: row.Schedule, Pause: row.ManualPause,
			}
		}
		rows = append(rows, row)
	}
	return page, rows, nil
}

func jobRow(policy core.OrchPolicySnapshot, job core.OrchJob, runs []core.OrchJobRun, now uint64, calendar Calendar) (JobRow, *core.RequestFailure) {
	row := JobRow{
		JobID: job.ID, DisplayID: "j" + strconv.FormatUint(job.Number, 10), Revision: job.Revision,
		Title: job.Title, MessagePreview: job.MessagePreview, State: "no_owner",
		Target: jobTarget{RoomID: job.RoomID}, Schedule: scheduleForJob(job.Schedule),
		RecentRuns: make([]jobRecentRun, 0, len(runs)),
	}
	if job.Legacy != nil {
		row.Legacy = &jobLegacy{RoomID: job.Legacy.RoomID, CronID: job.Legacy.CronID}
	}
	if job.Pause != nil {
		row.ManualPause = &jobPause{By: job.Pause.By, AtMs: job.Pause.AtMs}
	}
	if job.Pending != nil {
		row.HeldSlot = &jobSlot{Revision: job.Pending.Revision, AtMs: job.Pending.SlotMs}
	}
	if job.OwnerAvailable && job.OwnerID != nil {
		row.Target.IdentityID, row.Target.IdentityName = job.OwnerID, job.OwnerName
		resolved, err := core.ResolveOrchEffective(policy, *job.OwnerID, now, calendar)
		if err != nil {
			return JobRow{}, readFailure(err)
		}
		row.Routine = &resolved.Routine
		if job.Pause != nil {
			row.State = "paused"
		} else {
			next, failure := nextJobRun(row.Schedule, now)
			if failure != nil {
				return JobRow{}, failure
			}
			row.NextRunAtMs, row.State = next, "on"
			if job.Pending != nil || resolved.Routine.Value == core.OrchRoutineHold {
				row.State = "held"
			}
		}
	}
	for _, run := range runs {
		if len(run.Receipt.Items) != 1 {
			return JobRow{}, &core.RequestFailure{Code: "ORCH_STORAGE_UNAVAILABLE", Message: "Could not read or change job storage.", Status: 1}
		}
		item := run.Receipt.Items[0]
		recent := jobRecentRun{ID: run.ID, SlotMs: run.SlotMs, RecordedAtMs: run.RecordedMs, Acceptance: item.Acceptance}
		if row.LastRun == nil {
			row.LastRun = projectLastJobRun(run, item)
		}
		row.RecentRuns = append(row.RecentRuns, recent)
	}
	return row, nil
}
