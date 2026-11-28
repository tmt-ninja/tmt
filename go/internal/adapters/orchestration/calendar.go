package orchestration

import (
	"slices"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/jobcalendar"
)

const maxCalendarTimestampMs = 253_402_207_200_999

// Calendar resolves orchestration wall times in one preloaded IANA zone.
type Calendar struct{ location *time.Location }

var _ core.OrchCalendar = Calendar{}

func LoadCalendar(configured *string) (Calendar, error) {
	var name string
	if configured == nil {
		var err error
		name, err = jobcalendar.LocalZone()
		if err != nil {
			return Calendar{}, core.ErrOrchZone
		}
	} else {
		name = *configured
	}
	if name == "" || name == "Local" {
		return Calendar{}, core.ErrOrchZone
	}
	location, err := time.LoadLocation(name)
	if err != nil {
		return Calendar{}, core.ErrOrchZone
	}
	return Calendar{location: location}, nil
}

func (c Calendar) Name() string { return c.location.String() }

func (c Calendar) ParseAt(value string) (uint64, error) {
	if len(value) == 16 && value[10] == ' ' {
		label, err := time.Parse("2006-01-02 15:04", value)
		if err != nil || label.Format("2006-01-02 15:04") != value {
			return 0, core.ErrOrchInput
		}
		matches, _ := c.wall(label)
		if len(matches) != 1 {
			return 0, core.ErrOrchInput
		}
		return calendarMillis(matches[0])
	}
	instant, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return 0, core.ErrOrchInput
	}
	return calendarMillis(instant)
}

func (c Calendar) DayAt(atMs uint64) (int32, error) {
	if atMs == 0 || atMs > maxCalendarTimestampMs {
		return 0, core.ErrOrchInput
	}
	year, month, day := time.UnixMilli(int64(atMs)).In(c.location).Date()
	civil := time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
	return int32(civil.Unix() / 86_400), nil
}

func (c Calendar) Boundary(day int32, minute uint16, end bool) (uint64, error) {
	if minute >= 24*60 {
		return 0, core.ErrOrchInput
	}
	label := time.Unix(int64(day)*86_400+int64(minute)*60, 0).UTC()
	matches, gapEnd := c.wall(label)
	if len(matches) == 0 {
		if gapEnd.IsZero() {
			return 0, core.ErrOrchZone
		}
		return calendarMillis(gapEnd)
	}
	if end {
		return calendarMillis(matches[len(matches)-1])
	}
	return calendarMillis(matches[0])
}

// wall yields either the matching instants in order or the first instant
// after a gap. A fold can give two instants for the same civil label.
func (c Calendar) wall(label time.Time) ([]time.Time, time.Time) {
	y, m, d := label.Date()
	guess := time.Date(y, m, d, label.Hour(), label.Minute(), 0, 0, c.location)
	_, before := guess.Add(-24 * time.Hour).Zone()
	_, after := guess.Add(24 * time.Hour).Zone()
	first := label.Add(-time.Duration(before) * time.Second)
	last := label.Add(-time.Duration(after) * time.Second)
	if last.Before(first) {
		first, last = last, first
	}
	var matches []time.Time
	for _, candidate := range slices.Compact([]time.Time{first, last}) {
		local := candidate.In(c.location)
		year, month, day := local.Date()
		if year == y && month == m && day == d && local.Hour() == label.Hour() &&
			local.Minute() == label.Minute() && local.Second() == 0 {
			matches = append(matches, candidate)
		}
	}
	if len(matches) != 0 || first.Equal(last) {
		return matches, time.Time{}
	}
	_, crossing := first.In(c.location).ZoneBounds()
	if crossing.IsZero() || crossing.After(last) {
		return nil, time.Time{}
	}
	return nil, crossing
}

func (c Calendar) Range(atMs uint64, days uint8) (core.OrchTimeSlot, error) {
	if days != 1 && days != 7 && days != 30 {
		return core.OrchTimeSlot{}, core.ErrOrchInput
	}
	day, err := c.DayAt(atMs)
	if err != nil {
		return core.OrchTimeSlot{}, err
	}
	from, err := c.Boundary(day, 0, false)
	if err != nil {
		return core.OrchTimeSlot{}, err
	}
	to, err := c.Boundary(day+int32(days), 0, true)
	if err != nil {
		return core.OrchTimeSlot{}, err
	}
	return core.OrchTimeSlot{StartMs: from, EndMs: to}, nil
}

func (c Calendar) FormatMs(value uint64) string {
	instant := time.UnixMilli(int64(value)).In(c.location)
	_, offset := instant.Zone()
	layout := "2006-01-02T15:04:05.999-07:00"
	if offset%60 != 0 {
		layout += ":00"
	}
	return instant.Format(layout) + "[" + c.Name() + "]"
}

func calendarMillis(instant time.Time) (uint64, error) {
	ms := instant.UnixMilli()
	if ms <= 0 || ms > maxCalendarTimestampMs {
		return 0, core.ErrOrchInput
	}
	return uint64(ms), nil
}
