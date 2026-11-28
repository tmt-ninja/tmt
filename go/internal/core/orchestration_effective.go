package core

import (
	"cmp"
	"errors"
	"maps"
	"slices"
	"time"
)

const (
	OrchMaxPlans       = 128
	OrchMaxMembers     = 256
	OrchMaxTransitions = 4096
)

var (
	ErrOrchInput  = errors.New("invalid orchestration input or calendar selection")
	ErrOrchLimit  = errors.New("orchestration query exceeds its bounded expansion")
	ErrOrchZone   = errors.New("a named IANA time zone could not be resolved")
	ErrOrchMember = errors.New("orchestration member was not found or is retired")
)

// OrchCalendar maps local dates (civil days since 1970-01-01) and their wall
// clock boundaries. The resolver does not acquire a clock or a time zone.
type OrchCalendar interface {
	DayAt(atMs uint64) (int32, error)
	Boundary(day int32, minute uint16, end bool) (uint64, error)
}

type OrchEffectiveField[T any] struct {
	Value  T          `json:"value"`
	Source OrchSource `json:"source"`
}

type OrchEffective struct {
	State          OrchEffectiveField[OrchState]
	Receiving      OrchEffectiveField[OrchReceiving]
	Sending        OrchEffectiveField[OrchSending]
	Routine        OrchEffectiveField[OrchRoutine]
	TalkLimit      OrchEffectiveField[*uint32]
	ActivePlans    []string
	NextChangeAtMs *uint64
}

type OrchTimelineInterval struct {
	StartMs uint64   `json:"startMs"`
	EndMs   uint64   `json:"endMs"`
	PlanIDs []string `json:"planIds"`
}

// NormalizeOrchSchedule turns daily into weekly and aligns weekly anchors to
// their Monday, matching the canonical plan document.
func NormalizeOrchSchedule(schedule OrchPlanSchedule) (OrchPlanSchedule, error) {
	switch schedule.Kind {
	case "always":
		return OrchPlanSchedule{Kind: "always"}, nil
	case "once":
		if schedule.StartMs == 0 || schedule.StartMs >= schedule.EndMs || !ValidJSSafeInteger(schedule.EndMs) {
			return OrchPlanSchedule{}, ErrOrchInput
		}
		return OrchPlanSchedule{Kind: "once", StartMs: schedule.StartMs, EndMs: schedule.EndMs}, nil
	case "daily":
		schedule.Kind = "weekly"
		schedule.AnchorDate = "1969-12-29"
		schedule.IntervalWeeks = 1
		schedule.Weekdays = []int{1, 2, 3, 4, 5, 6, 7}
	case "weekly":
		day, err := time.Parse(time.DateOnly, schedule.AnchorDate)
		if err != nil || day.Format(time.DateOnly) != schedule.AnchorDate {
			return OrchPlanSchedule{}, ErrOrchInput
		}
		schedule.AnchorDate = day.AddDate(0, 0, -((int(day.Weekday()) + 6) % 7)).Format(time.DateOnly)
	default:
		return OrchPlanSchedule{}, ErrOrchInput
	}
	start, startOK := orchClockMinute(schedule.Start)
	end, endOK := orchClockMinute(schedule.End)
	if (schedule.IntervalWeeks != 1 && schedule.IntervalWeeks != 2) ||
		len(schedule.Weekdays) == 0 || len(schedule.Weekdays) > 7 || !startOK || !endOK ||
		(!schedule.AllDay && start == end) {
		return OrchPlanSchedule{}, ErrOrchInput
	}
	var days [8]bool
	for _, weekday := range schedule.Weekdays {
		if weekday < 1 || weekday > 7 || days[weekday] {
			return OrchPlanSchedule{}, ErrOrchInput
		}
		days[weekday] = true
	}
	return schedule, nil
}

func orchClockMinute(value string) (uint16, bool) {
	clock, err := time.Parse("15:04", value)
	return uint16(clock.Hour()*60 + clock.Minute()), err == nil && clock.Format("15:04") == value
}

func orchSlots(raw OrchPlanSchedule, window OrchTimeSlot, calendar OrchCalendar) ([]OrchTimeSlot, error) {
	schedule, err := NormalizeOrchSchedule(raw)
	if err != nil {
		return nil, err
	}
	switch schedule.Kind {
	case "always":
		return []OrchTimeSlot{window}, nil
	case "once":
		if schedule.StartMs < window.EndMs && schedule.EndMs > window.StartMs {
			return []OrchTimeSlot{{StartMs: schedule.StartMs, EndMs: schedule.EndMs}}, nil
		}
		return nil, nil
	}
	first, err := calendar.DayAt(window.StartMs)
	if err != nil {
		return nil, err
	}
	last, err := calendar.DayAt(window.EndMs)
	if err != nil {
		return nil, err
	}
	first--
	if last-first > 33 {
		return nil, ErrOrchLimit
	}

	anchorDate, err := time.Parse(time.DateOnly, schedule.AnchorDate)
	if err != nil {
		return nil, ErrOrchInput
	}
	anchor := int32(anchorDate.Unix() / 86_400)
	start, _ := orchClockMinute(schedule.Start)
	end, _ := orchClockMinute(schedule.End)
	if schedule.AllDay {
		start, end = 0, 0
	}
	var slots []OrchTimeSlot
	for day := first; day <= last; day++ {
		weekday := ((day+3)%7+7)%7 + 1
		monday := day - (weekday - 1)
		if !slices.Contains(schedule.Weekdays, int(weekday)) ||
			((monday-anchor)/7)%int32(schedule.IntervalWeeks) != 0 {
			continue
		}
		endDay := day
		if schedule.AllDay || end < start {
			endDay++
		}
		from, err := calendar.Boundary(day, start, false)
		if err != nil {
			return nil, err
		}
		to, err := calendar.Boundary(endDay, end, true)
		if err != nil {
			return nil, err
		}
		if from < to && from < window.EndMs && to > window.StartMs {
			slots = append(slots, OrchTimeSlot{StartMs: from, EndMs: to})
		}
	}
	return slots, nil
}

func orchPlanMatches(plan OrchPlan, id IdentityID, name Name) bool {
	for _, target := range plan.Targets {
		if target.Kind == "all" || target.Kind == "identity" && target.ID == id ||
			target.Kind == "pattern" && orchPatternMatches([]rune(target.Pattern), []rune(name)) {
			return true
		}
	}
	return false
}

func orchPatternMatches(pattern, name []rune) bool {
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

func (p *OrchEffective) apply(fields OrchPolicyFields, source OrchSource) {
	if fields.State != nil {
		p.State = OrchEffectiveField[OrchState]{*fields.State, source}
		receiving := OrchReceiving{Mode: OrchReceivingDirect}
		routine := OrchRoutineRun
		switch *fields.State {
		case "low":
			receiving = OrchReceiving{Mode: OrchReceivingBatch, IntervalMs: 1_800_000}
		case "focus":
			receiving.Mode, routine = OrchReceivingUrgent, OrchRoutineHold
		case "sleep":
			receiving.Mode, routine = OrchReceivingHold, OrchRoutineHold
		}
		defaulted := source
		defaulted.Defaulted = true
		p.Receiving = OrchEffectiveField[OrchReceiving]{receiving, defaulted}
		p.Routine = OrchEffectiveField[OrchRoutine]{routine, defaulted}
	}
	if fields.Receiving != nil {
		p.Receiving = OrchEffectiveField[OrchReceiving]{*fields.Receiving, source}
	}
	if fields.Sending != nil {
		p.Sending = OrchEffectiveField[OrchSending]{*fields.Sending, source}
	}
	if fields.Routine != nil {
		p.Routine = OrchEffectiveField[OrchRoutine]{*fields.Routine, source}
	}
	if fields.TalkLimitPresent {
		p.TalkLimit = OrchEffectiveField[*uint32]{fields.TalkLimit, source}
	}
}

func (p *OrchEffective) consider(now, boundary uint64) {
	if boundary > now && (p.NextChangeAtMs == nil || boundary < *p.NextChangeAtMs) {
		p.NextChangeAtMs = &boundary
	}
}

// ResolveOrchEffective evaluates the current policy at an explicit instant.
func ResolveOrchEffective(snapshot OrchPolicySnapshot, id IdentityID, atMs uint64, calendar OrchCalendar) (OrchEffective, error) {
	if len(snapshot.Plans) > OrchMaxPlans || len(snapshot.Identities) > OrchMaxMembers {
		return OrchEffective{}, ErrOrchLimit
	}
	name, ok := snapshot.Identities[id]
	if !ok {
		return OrchEffective{}, ErrOrchMember
	}
	base := OrchSource{Kind: OrchSourceBase}
	direct := OrchReceiving{Mode: OrchReceivingDirect}
	result := OrchEffective{
		State:       OrchEffectiveField[OrchState]{"awake", base},
		Receiving:   OrchEffectiveField[OrchReceiving]{direct, base},
		Sending:     OrchEffectiveField[OrchSending]{"anyone", base},
		Routine:     OrchEffectiveField[OrchRoutine]{OrchRoutineRun, base},
		TalkLimit:   OrchEffectiveField[*uint32]{nil, base},
		ActivePlans: []string{},
	}
	if receiving, ok := snapshot.BaseReceiving[id]; ok {
		source := OrchSource{Kind: OrchSourceBase, IdentityID: &id, Revision: snapshot.DigestRevision}
		result.Receiving = OrchEffectiveField[OrchReceiving]{receiving, source}
	}

	day, err := calendar.DayAt(atMs)
	if err != nil {
		return OrchEffective{}, err
	}
	horizon, err := calendar.Boundary(day+16, 0, false)
	if err != nil {
		return OrchEffective{}, err
	}
	plans := slices.Clone(snapshot.Plans)
	slices.SortFunc(plans, func(a, b OrchPlan) int { return cmp.Compare(a.Priority, b.Priority) })
	priorities := make(map[int32]bool, len(plans))
	for _, plan := range plans {
		if !plan.Enabled || !orchPlanMatches(plan, id, name) {
			continue
		}
		if priorities[plan.Priority] {
			return OrchEffective{}, ErrOrchInput
		}
		priorities[plan.Priority] = true
		slots, err := orchSlots(plan.Schedule, OrchTimeSlot{StartMs: atMs, EndMs: horizon}, calendar)
		if err != nil {
			return OrchEffective{}, err
		}
		if plan.Schedule.Kind == "once" {
			result.consider(atMs, plan.Schedule.StartMs)
		}
		active := plan.Schedule.Kind == "always"
		var activeSlot *OrchTimeSlot
		if !active {
			for _, slot := range slots {
				result.consider(atMs, slot.StartMs)
				result.consider(atMs, slot.EndMs)
				if activeSlot == nil && slot.StartMs <= atMs && atMs < slot.EndMs {
					activeSlot = &slot
				}
			}
		}
		if active || activeSlot != nil {
			result.ActivePlans = append(result.ActivePlans, plan.ID)
			source := OrchSource{Kind: OrchSourcePlan, PlanID: &plan.ID, Revision: plan.Revision, Slot: activeSlot}
			result.apply(plan.Fields, source)
			source.Kind, source.IdentityID = OrchSourceMember, &id
			result.apply(plan.Members[id], source)
		}
	}
	for _, focus := range snapshot.Focus {
		if focus.IdentityID != id {
			continue
		}
		result.consider(atMs, focus.StartMs)
		result.consider(atMs, focus.EndMs)
		if focus.StartMs <= atMs && atMs < focus.EndMs {
			state := OrchState("focus")
			source := OrchSource{Kind: OrchSourceFocus, IdentityID: &id, Revision: focus.Revision,
				Slot: &OrchTimeSlot{StartMs: focus.StartMs, EndMs: focus.EndMs}}
			result.apply(OrchPolicyFields{State: &state}, source)
		}
	}
	if snapshot.DigestRevision > 0 && !snapshot.DigestEnabled {
		source := OrchSource{Kind: OrchSourceBase, Revision: snapshot.DigestRevision}
		result.Receiving = OrchEffectiveField[OrchReceiving]{direct, source}
	}
	return result, nil
}

// OrchTimeline expands bounded plan transitions for the snapshot's selected members.
func OrchTimeline(snapshot OrchPolicySnapshot, window OrchTimeSlot, calendar OrchCalendar) ([]OrchTimelineInterval, error) {
	type planSlot struct {
		id string
		OrchTimeSlot
	}
	if len(snapshot.Plans) > OrchMaxPlans || len(snapshot.Identities) > OrchMaxMembers {
		return nil, ErrOrchLimit
	}
	boundaries := map[uint64]bool{window.StartMs: true, window.EndMs: true}
	var slots []planSlot
	for _, plan := range snapshot.Plans {
		if !plan.Enabled {
			continue
		}
		matches := false
		for id, name := range snapshot.Identities {
			if orchPlanMatches(plan, id, name) {
				matches = true
				break
			}
		}
		if !matches {
			continue
		}
		expanded, err := orchSlots(plan.Schedule, window, calendar)
		if err != nil {
			return nil, err
		}
		for _, slot := range expanded {
			boundaries[max(slot.StartMs, window.StartMs)] = true
			boundaries[min(slot.EndMs, window.EndMs)] = true
			if len(boundaries) > OrchMaxTransitions {
				return nil, ErrOrchLimit
			}
			slots = append(slots, planSlot{id: plan.ID, OrchTimeSlot: slot})
		}
	}
	points := slices.Sorted(maps.Keys(boundaries))
	intervals := make([]OrchTimelineInterval, 0, len(points)-1)
	for i := 1; i < len(points); i++ {
		start := points[i-1]
		ids := []string{}
		for _, slot := range slots {
			if slot.StartMs <= start && start < slot.EndMs {
				ids = append(ids, slot.id)
			}
		}
		slices.Sort(ids)
		intervals = append(intervals, OrchTimelineInterval{StartMs: start, EndMs: points[i], PlanIDs: slices.Compact(ids)})
	}
	return intervals, nil
}
