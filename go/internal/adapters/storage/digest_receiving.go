package storage

import (
	"context"
	"encoding/json/v2"
	"errors"
	"slices"
	"strings"
	"time"

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
	configured string
	location   *time.Location
}

func (s *Storage) loadDigestCalendar(ctx context.Context) (digestCalendar, error) {
	var cal digestCalendar
	err := s.db.QueryRowContext(ctx, "SELECT COALESCE((SELECT time_zone FROM orchestration_settings WHERE id=1),'')").Scan(&cal.configured)
	if err != nil {
		return cal, err
	}
	if cal.configured == "" {
		cal.location = time.Local
		// Go loads its implicit local zone lazily. Resolve it before a writer.
		_, _ = time.Now().In(cal.location).Zone()
	} else {
		cal.location, _ = time.LoadLocation(cal.configured)
	}
	return cal, nil
}

type digestReceiving struct {
	source     digestReceivingSource
	mode       core.OrchReceivingMode
	nextChange *uint64
	revision   uint64
	zone       string
}

func resolveDigestReceiving(r records, identity *core.Identity, cal digestCalendar, now uint64) (digestReceiving, error) {
	policy, err := readOrchPolicy(r, map[core.IdentityID]core.Name{identity.ID: identity.Name})
	if err != nil || policy.DigestRevision == 0 {
		return digestReceiving{}, err
	}
	var configured string
	if policy.TimeZone != nil {
		configured = *policy.TimeZone
	}
	if cal.location == nil || cal.configured != configured {
		return digestReceiving{}, errors.New("receiving calendar selection changed; retry the operation")
	}
	resolved := digestReceiving{mode: policy.BaseReceiving[identity.ID].Mode, revision: policy.Revision, zone: cal.location.String(),
		source: digestReceivingSource{Kind: "base", IdentityID: &identity.ID, Revision: policy.DigestRevision}}
	for _, plan := range policy.Plans {
		if !plan.Enabled || !digestPlanMatches(plan, identity) {
			continue
		}
		active, slot, next, err := digestPlanSlot(plan.Schedule, cal.location, now)
		if err != nil {
			return digestReceiving{}, err
		}
		resolved.consider(now, next)
		if active {
			source := digestReceivingSource{Kind: "plan", PlanID: &plan.ID, Revision: plan.Revision, Slot: slot}
			resolved.apply(plan.Fields, source)
			source.Kind, source.IdentityID = "member", &identity.ID
			resolved.apply(plan.Members[identity.ID], source)
		}
	}
	for _, focus := range policy.Focus {
		resolved.consider(now, focus.StartMs)
		resolved.consider(now, focus.EndMs)
		if focus.StartMs <= now && now < focus.EndMs {
			resolved.mode = core.OrchReceivingUrgent
			resolved.source = digestReceivingSource{Kind: "focus", IdentityID: &identity.ID, Revision: focus.Revision,
				Slot: &digestJournalSlot{StartMs: focus.StartMs, EndMs: focus.EndMs}, Defaulted: true}
		}
	}
	if !policy.DigestEnabled {
		resolved.mode = core.OrchReceivingDirect
		resolved.source = digestReceivingSource{Kind: "base", Revision: policy.DigestRevision}
	}
	return resolved, nil
}

func (d *digestReceiving) consider(now, when uint64) {
	if when > now && (d.nextChange == nil || when < *d.nextChange) {
		d.nextChange = &when
	}
}

func (d *digestReceiving) apply(f core.OrchPolicyFields, source digestReceivingSource) {
	if f.Receiving != nil {
		d.mode, d.source = f.Receiving.Mode, source
		return
	}
	if f.State == nil {
		return
	}
	source.Defaulted = true
	d.source = source
	switch *f.State {
	case "awake":
		d.mode = core.OrchReceivingDirect
	case "low":
		d.mode = core.OrchReceivingBatch
	case "focus":
		d.mode = core.OrchReceivingUrgent
	case "sleep":
		d.mode = core.OrchReceivingHold
	}
}

func digestPlanMatches(plan core.OrchPlan, identity *core.Identity) bool {
	for _, target := range plan.Targets {
		if target.Kind == "all" || target.Kind == "identity" && target.ID == identity.ID ||
			target.Kind == "pattern" && matchDigestPattern([]rune(target.Pattern), []rune(identity.Name)) {
			return true
		}
	}
	return false
}

func matchDigestPattern(pattern, name []rune) bool {
	i, j, star, retry := 0, 0, -1, 0
	for j < len(name) {
		switch {
		case i < len(pattern) && (pattern[i] == '?' || pattern[i] == name[j]):
			i++
			j++
		case i < len(pattern) && pattern[i] == '*':
			star, retry = i, j
			i++
		case star >= 0:
			retry++
			j, i = retry, star+1
		default:
			return false
		}
	}
	for i < len(pattern) && pattern[i] == '*' {
		i++
	}
	return i == len(pattern)
}

func digestPlanSlot(schedule core.OrchPlanSchedule, location *time.Location, now uint64) (bool, *digestJournalSlot, uint64, error) {
	switch schedule.Kind {
	case "always":
		return true, nil, 0, nil
	case "once":
		switch {
		case now < schedule.StartMs:
			return false, nil, schedule.StartMs, nil
		case now < schedule.EndMs:
			return true, &digestJournalSlot{StartMs: schedule.StartMs, EndMs: schedule.EndMs}, schedule.EndMs, nil
		default:
			return false, nil, 0, nil
		}
	}
	start, end := time.Time{}, time.Time{}
	var err error
	if !schedule.AllDay {
		start, err = time.Parse("15:04", schedule.Start)
		if err != nil {
			return false, nil, 0, errInvalidOrchRow
		}
		end, err = time.Parse("15:04", schedule.End)
		if err != nil || start.Equal(end) {
			return false, nil, 0, errInvalidOrchRow
		}
	}
	var anchor time.Time
	if schedule.Kind == "weekly" {
		anchor, err = time.Parse(time.DateOnly, schedule.AnchorDate)
		if err != nil || anchor.Weekday() != time.Monday || schedule.IntervalWeeks < 1 || schedule.IntervalWeeks > 2 {
			return false, nil, 0, errInvalidOrchRow
		}
	} else if schedule.Kind != "daily" {
		return false, nil, 0, errInvalidOrchRow
	}
	day := time.UnixMilli(int64(now)).In(location)
	civil := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC)
	startMinute, endMinute := start.Hour()*60+start.Minute(), end.Hour()*60+end.Minute()
	next := digestReceiving{}
	var slot *digestJournalSlot
	for offset := -1; offset <= 16; offset++ {
		date := civil.AddDate(0, 0, offset)
		if schedule.Kind == "weekly" {
			weekday := (int(date.Weekday())+6)%7 + 1
			monday := date.Unix() - int64(weekday-1)*86400
			weeks := (monday - anchor.Unix()) / (7 * 86400)
			if !slices.Contains(schedule.Weekdays, weekday) || weeks%int64(schedule.IntervalWeeks) != 0 {
				continue
			}
		}
		endDate := date
		if schedule.AllDay || endMinute < startMinute {
			endDate = date.AddDate(0, 0, 1)
		}
		from := digestCalendarBoundary(date, startMinute, location, false)
		to := digestCalendarBoundary(endDate, endMinute, location, true)
		if to <= from || to <= 0 {
			continue
		}
		if from > 0 && from <= int64(now) && int64(now) < to {
			slot = &digestJournalSlot{StartMs: uint64(from), EndMs: uint64(to)}
		}
		if from > 0 {
			next.consider(now, uint64(from))
		}
		next.consider(now, uint64(to))
	}
	if next.nextChange != nil {
		return slot != nil, slot, *next.nextChange, nil
	}
	return slot != nil, slot, 0, nil
}

func digestCalendarBoundary(day time.Time, minute int, zone *time.Location, end bool) int64 {
	label := day.Add(time.Duration(minute) * time.Minute)
	guess := time.Date(label.Year(), label.Month(), label.Day(), label.Hour(), label.Minute(), 0, 0, zone)
	_, before := guess.Add(-24 * time.Hour).Zone()
	_, after := guess.Add(24 * time.Hour).Zone()
	first := label.Add(-time.Duration(before) * time.Second)
	second := label.Add(-time.Duration(after) * time.Second)
	if before == after {
		return first.UnixMilli()
	}
	firstMatches := first.In(zone).Format("2006-01-02T15:04") == label.Format("2006-01-02T15:04")
	secondMatches := second.In(zone).Format("2006-01-02T15:04") == label.Format("2006-01-02T15:04")
	switch {
	case firstMatches && !secondMatches:
		return first.UnixMilli()
	case secondMatches && !firstMatches:
		return second.UnixMilli()
	case firstMatches && secondMatches:
		if first.After(second) == end {
			return first.UnixMilli()
		}
		return second.UnixMilli()
	}
	// A skipped wall time maps to the transition instant at the end of the gap.
	if first.After(second) {
		first, second = second, first
	}
	_, offset := first.In(zone).Zone()
	low, high := first.Unix(), second.Unix()
	for low < high {
		mid := low + (high-low)/2
		_, seen := time.Unix(mid, 0).In(zone).Zone()
		if seen == offset {
			low = mid + 1
		} else {
			high = mid
		}
	}
	return low * 1000
}
