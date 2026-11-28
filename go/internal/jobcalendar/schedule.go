package jobcalendar

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Error reports an invalid schedule, time zone, or persisted schedule document.
type Error struct {
	Message string
}

func newError(message string) *Error {
	return &Error{Message: message}
}

func (e *Error) Error() string {
	return e.Message
}

// InputKind identifies which schedule form a ScheduleInput describes.
type InputKind uint8

const (
	KindEvery InputKind = iota
	KindAt
	KindCron
)

// ScheduleInput is the parsed user or API input to Schedule.Parse.
type ScheduleInput struct {
	Kind       InputKind
	Duration   string
	From       *string
	Time       string
	On         *string
	Expression string
}

// Every constructs a fixed-interval schedule input.
func Every(duration string, from *string) ScheduleInput {
	return ScheduleInput{Kind: KindEvery, Duration: duration, From: from}
}

// At constructs a wall-clock daily/weekday/day-list schedule input.
func At(timeText string, on *string) ScheduleInput {
	return ScheduleInput{Kind: KindAt, Time: timeText, On: on}
}

// Cron constructs a five-field cron schedule input.
func Cron(expression string) ScheduleInput {
	return ScheduleInput{Kind: KindCron, Expression: expression}
}

type ruleKind uint8

const (
	ruleEvery ruleKind = iota
	ruleCalendar
)

type rule struct {
	kind     ruleKind
	seconds  int64
	anchorMs int64
	from     *string
	pattern  pattern
	at       *string
	on       *string
}

// Schedule is a validated, stateless job calendar.
// The zone is captured by name; later clock hosts do not reinterpret a job.
type Schedule struct {
	zone string
	rule rule
}

// jiff::Timestamp millisecond bounds (years -9999 through +9999).
const (
	minTimestampMs int64 = -377705023201000
	maxTimestampMs int64 = 253402207200999
)

func validateTimestamp(ms int64) error {
	if ms < minTimestampMs || ms > maxTimestampMs {
		return newError(fmt.Sprintf("Timestamp %d is out of range.", ms))
	}
	return nil
}

func loadZone(name string) (*time.Location, error) {
	if name == "" || name == "Local" {
		return nil, newError(fmt.Sprintf("Time zone %s: invalid time zone name", name))
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, newError(fmt.Sprintf("Time zone %s: %v", name, err))
	}
	return loc, nil
}

// LocalZone returns the system's named IANA time zone.
func LocalZone() (string, error) {
	if tz := os.Getenv("TZ"); tz != "" {
		clean := strings.TrimPrefix(tz, ":")
		if _, err := loadZone(clean); err == nil {
			return clean, nil
		}
	}
	if name := time.Local.String(); name != "" && name != "Local" {
		if _, err := loadZone(name); err == nil {
			return name, nil
		}
	}
	if target, err := filepath.EvalSymlinks("/etc/localtime"); err == nil {
		if _, after, ok := strings.Cut(filepath.ToSlash(target), "zoneinfo/"); ok && after != "" {
			if _, err := loadZone(after); err == nil {
				return after, nil
			}
		}
	}
	return "", newError("The clock needs a named local time zone.")
}

type civilDate struct {
	year  int
	month time.Month
	day   int
}

func (d civilDate) next() civilDate {
	t := time.Date(d.year, d.month, d.day+1, 0, 0, 0, 0, time.UTC)
	return civilDate{year: t.Year(), month: t.Month(), day: t.Day()}
}

func (d civilDate) weekday() time.Weekday {
	return time.Date(d.year, d.month, d.day, 0, 0, 0, 0, time.UTC).Weekday()
}

// fixed resolves a wall-clock (date, hour, minute) in loc.
// No fixed-time catch-up through a DST gap (returns ok=false), and no second occurrence in a fold
// (always selects the earlier instant).
func fixed(loc *time.Location, date civilDate, hour, minute int) (int64, bool, error) {
	t := time.Date(date.year, date.month, date.day, hour, minute, 0, 0, loc)
	y, m, d := t.Date()
	if y != date.year || m != date.month || d != date.day || t.Hour() != hour || t.Minute() != minute || t.Second() != 0 {
		return 0, false, nil
	}
	// If t landed on the later side of a fall-back fold, step back by the offset delta to
	// guarantee the earlier occurrence.
	start, _ := t.ZoneBounds()
	if !start.IsZero() && !t.Before(start) {
		_, curOff := t.Zone()
		_, prevOff := start.Add(-time.Second).Zone()
		if prevOff > curOff {
			earlier := t.Add(-time.Duration(prevOff-curOff) * time.Second)
			ey, em, ed := earlier.Date()
			if ey == date.year && em == date.month && ed == date.day && earlier.Hour() == hour && earlier.Minute() == minute && earlier.Second() == 0 {
				t = earlier
			}
		}
	}
	ms := t.UnixMilli()
	if err := validateTimestamp(ms); err != nil {
		return 0, false, err
	}
	return ms, true, nil
}

func parseTimeText(text string) (int, int, error) {
	if len(text) != 5 || text[2] != ':' {
		return 0, 0, newError("Use HH:MM (00:00 through 23:59).")
	}
	for i := 0; i < 5; i++ {
		if i != 2 && (text[i] < '0' || text[i] > '9') {
			return 0, 0, newError("Use HH:MM (00:00 through 23:59).")
		}
	}
	hour := int(text[0]-'0')*10 + int(text[1]-'0')
	minute := int(text[3]-'0')*10 + int(text[4]-'0')
	if hour > 23 || minute > 59 {
		return 0, 0, newError("Use HH:MM (00:00 through 23:59).")
	}
	return hour, minute, nil
}

func parseDuration(text string) (int64, error) {
	for i := 0; i < len(text); i++ {
		if text[i] > 127 {
			return 0, newError("Use a positive whole duration with s, m, h or d.")
		}
	}
	if len(text) < 2 {
		return 0, newError("Use a positive whole duration with s, m, h or d.")
	}
	digits := text[:len(text)-1]
	unit := text[len(text)-1]
	var scale int64
	switch unit {
	case 's':
		scale = 1
	case 'm':
		scale = 60
	case 'h':
		scale = 3600
	case 'd':
		scale = 86400
	default:
		scale = 0
	}
	for i := 0; i < len(digits); i++ {
		if digits[i] < '0' || digits[i] > '9' {
			return 0, newError("Use a positive whole duration with s, m, h or d.")
		}
	}
	if scale == 0 {
		return 0, newError("Duration is zero or out of range.")
	}
	n, err := strconv.ParseInt(digits, 10, 64)
	if err != nil || n <= 0 {
		return 0, newError("Duration is zero or out of range.")
	}
	if n > math.MaxInt64/scale {
		return 0, newError("Duration is zero or out of range.")
	}
	seconds := n * scale
	if seconds <= 0 || seconds > math.MaxInt64/1000 {
		return 0, newError("Duration is zero or out of range.")
	}
	return seconds, nil
}

func cloneStringPtr(p *string) *string {
	if p == nil {
		return nil
	}
	s := *p
	return &s
}

func equalStringPtr(a, b *string) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

// Parse validates input in zoneName at nowMs and returns a Schedule.
func Parse(input ScheduleInput, zoneName string, nowMs int64) (*Schedule, error) {
	loc, err := loadZone(zoneName)
	if err != nil {
		return nil, err
	}
	if err := validateTimestamp(nowMs); err != nil {
		return nil, err
	}
	var r rule
	switch input.Kind {
	case KindEvery:
		seconds, err := parseDuration(input.Duration)
		if err != nil {
			return nil, err
		}
		anchorMs := nowMs
		if input.From != nil {
			hour, minute, err := parseTimeText(*input.From)
			if err != nil {
				return nil, err
			}
			zoned := time.UnixMilli(nowMs).In(loc)
			day := civilDate{year: zoned.Year(), month: zoned.Month(), day: zoned.Day()}
			for {
				anchor, ok, err := fixed(loc, day, hour, minute)
				if err != nil {
					return nil, err
				}
				if ok {
					anchorMs = anchor
					break
				}
				day = day.next()
				if day.year > 9999 {
					return nil, newError("Date out of range.")
				}
			}
		}
		r = rule{
			kind:     ruleEvery,
			seconds:  seconds,
			anchorMs: anchorMs,
			from:     cloneStringPtr(input.From),
		}
	case KindAt:
		hour, minute, err := parseTimeText(input.Time)
		if err != nil {
			return nil, err
		}
		var days string
		switch {
		case input.On == nil:
			days = "*"
		case *input.On == "weekdays":
			days = "mon-fri"
		case *input.On != "" && validDayList(*input.On):
			days = *input.On
		default:
			return nil, newError("--on accepts weekdays or comma-separated day names (mon,thu).")
		}
		pat, err := parsePattern(fmt.Sprintf("%d %d * * %s", minute, hour, days))
		if err != nil {
			return nil, err
		}
		atCopy := input.Time
		r = rule{
			kind:    ruleCalendar,
			pattern: pat,
			at:      &atCopy,
			on:      cloneStringPtr(input.On),
		}
	case KindCron:
		pat, err := parsePattern(input.Expression)
		if err != nil {
			return nil, err
		}
		r = rule{
			kind:    ruleCalendar,
			pattern: pat,
		}
	default:
		return nil, newError("Unknown schedule kind.")
	}
	return &Schedule{zone: zoneName, rule: r}, nil
}

func validDayList(s string) bool {
	for _, part := range strings.Split(s, ",") {
		found := false
		for _, day := range dayNames {
			if strings.EqualFold(part, day) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// Zone returns the schedule's IANA time zone name.
func (s *Schedule) Zone() string {
	return s.zone
}

// Equal reports whether two schedules are identical.
func (s *Schedule) Equal(other *Schedule) bool {
	if s == nil || other == nil {
		return s == other
	}
	return s.zone == other.zone &&
		s.rule.kind == other.rule.kind &&
		s.rule.seconds == other.rule.seconds &&
		s.rule.anchorMs == other.rule.anchorMs &&
		equalStringPtr(s.rule.from, other.rule.from) &&
		s.rule.pattern == other.rule.pattern &&
		equalStringPtr(s.rule.at, other.rule.at) &&
		equalStringPtr(s.rule.on, other.rule.on)
}

// NextAfter returns the next strictly future slot after afterMs.
// The caller chooses the current window; this function never reads an old run or reconstructs
// missed executions. Returns (0, false, nil) when no future slot exists.
func (s *Schedule) NextAfter(afterMs int64) (int64, bool, error) {
	if err := validateTimestamp(afterMs); err != nil {
		return 0, false, err
	}
	switch s.rule.kind {
	case ruleEvery:
		period := new(big.Int).Mul(big.NewInt(s.rule.seconds), big.NewInt(1000))
		anchor := big.NewInt(s.rule.anchorMs)
		diff := new(big.Int).Sub(big.NewInt(afterMs), anchor)
		q := new(big.Int)
		r := new(big.Int)
		q.DivMod(diff, period, r)
		steps := new(big.Int).Add(q, big.NewInt(1))
		if steps.Sign() < 0 {
			steps.SetInt64(0)
		}
		nextBig := new(big.Int).Add(anchor, new(big.Int).Mul(steps, period))
		if !nextBig.IsInt64() {
			return 0, false, nil
		}
		next := nextBig.Int64()
		if err := validateTimestamp(next); err != nil {
			return 0, false, nil
		}
		return next, true, nil

	case ruleCalendar:
		loc, err := loadZone(s.zone)
		if err != nil {
			return 0, false, err
		}
		zoned := time.UnixMilli(afterMs).In(loc)
		date := civilDate{year: zoned.Year(), month: zoned.Month(), day: zoned.Day()}
		// One Gregorian cycle (400 years = 146097 days) covers every possible
		// month/day/weekday combination, without unbounded search for impossible dates.
		for i := 0; i <= 146097; i++ {
			if s.rule.pattern.dateMatches(date) {
				for hour := 0; hour <= 23; hour++ {
					if !s.rule.pattern.hours.contains(uint8(hour)) {
						continue
					}
					for minute := 0; minute <= 59; minute++ {
						if !s.rule.pattern.minutes.contains(uint8(minute)) {
							continue
						}
						slot, ok, err := fixed(loc, date, hour, minute)
						if err != nil {
							return 0, false, err
						}
						if ok && slot > afterMs {
							return slot, true, nil
						}
					}
				}
			}
			if date.year == 9999 && date.month == time.December && date.day == 31 {
				break
			}
			date = date.next()
		}
		return 0, false, nil
	}
	return 0, false, nil
}

// Document returns the canonical JSON-compatible persistence map for the schedule.
func (s *Schedule) Document() map[string]any {
	switch s.rule.kind {
	case ruleEvery:
		var from any
		if s.rule.from != nil {
			from = *s.rule.from
		}
		return map[string]any{
			"kind":     "every",
			"zone":     s.zone,
			"seconds":  s.rule.seconds,
			"anchorMs": s.rule.anchorMs,
			"from":     from,
		}
	case ruleCalendar:
		if s.rule.at != nil {
			var on any
			if s.rule.on != nil {
				on = *s.rule.on
			}
			return map[string]any{
				"kind": "at",
				"zone": s.zone,
				"at":   *s.rule.at,
				"on":   on,
			}
		}
		return map[string]any{
			"kind":       "cron",
			"zone":       s.zone,
			"expression": s.rule.pattern.expression,
		}
	}
	return nil
}

// MarshalJSON encodes the schedule as its canonical document JSON.
func (s *Schedule) MarshalJSON() ([]byte, error) {
	return json.Marshal(s.Document())
}

// UnmarshalJSON decodes a schedule from its canonical document JSON.
func (s *Schedule) UnmarshalJSON(data []byte) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	var doc map[string]any
	if err := dec.Decode(&doc); err != nil {
		return newError(err.Error())
	}
	parsed, err := FromDocument(doc)
	if err != nil {
		return err
	}
	*s = *parsed
	return nil
}

// FromDocument validates and restores a Schedule from a persisted document map.
func FromDocument(doc map[string]any) (*Schedule, error) {
	text := func(key string) (string, error) {
		v, ok := doc[key]
		if !ok {
			return "", newError(fmt.Sprintf("Missing schedule %s.", key))
		}
		s, ok := v.(string)
		if !ok {
			return "", newError(fmt.Sprintf("Missing schedule %s.", key))
		}
		return s, nil
	}
	nullable := func(key string) (*string, error) {
		v, ok := doc[key]
		if !ok || v == nil {
			return nil, nil
		}
		s, ok := v.(string)
		if !ok {
			return nil, newError(fmt.Sprintf("Missing schedule %s.", key))
		}
		return &s, nil
	}
	int64Field := func(key string) (int64, error) {
		v, ok := doc[key]
		if !ok || v == nil {
			return 0, newError(fmt.Sprintf("Missing schedule %s.", key))
		}
		switch n := v.(type) {
		case int64:
			return n, nil
		case int:
			return int64(n), nil
		case json.Number:
			parsed, err := n.Int64()
			if err != nil {
				return 0, newError(fmt.Sprintf("Missing schedule %s.", key))
			}
			return parsed, nil
		case float64:
			if math.Trunc(n) != n || math.IsNaN(n) || math.IsInf(n, 0) {
				return 0, newError(fmt.Sprintf("Missing schedule %s.", key))
			}
			return int64(n), nil
		default:
			return 0, newError(fmt.Sprintf("Missing schedule %s.", key))
		}
	}

	zoneName, err := text("zone")
	if err != nil {
		return nil, err
	}
	kind, err := text("kind")
	if err != nil {
		return nil, err
	}
	switch kind {
	case "every":
		rawSeconds, err := int64Field("seconds")
		if err != nil {
			return nil, err
		}
		anchorMs, err := int64Field("anchorMs")
		if err != nil {
			return nil, err
		}
		seconds, err := parseDuration(fmt.Sprintf("%ds", rawSeconds))
		if err != nil {
			return nil, err
		}
		if err := validateTimestamp(anchorMs); err != nil {
			return nil, err
		}
		if _, err := loadZone(zoneName); err != nil {
			return nil, err
		}
		from, err := nullable("from")
		if err != nil {
			return nil, err
		}
		if from != nil {
			if _, _, err := parseTimeText(*from); err != nil {
				return nil, err
			}
		}
		// A stored elapsed anchor is already a UTC instant. Validate its inputs
		// without deriving it again from local wall time.
		return &Schedule{
			zone: zoneName,
			rule: rule{
				kind:     ruleEvery,
				seconds:  seconds,
				anchorMs: anchorMs,
				from:     cloneStringPtr(from),
			},
		}, nil
	case "at":
		at, err := text("at")
		if err != nil {
			return nil, err
		}
		on, err := nullable("on")
		if err != nil {
			return nil, err
		}
		return Parse(At(at, on), zoneName, 0)
	case "cron":
		expr, err := text("expression")
		if err != nil {
			return nil, err
		}
		return Parse(Cron(expr), zoneName, 0)
	default:
		return nil, newError("Unknown schedule kind.")
	}
}

// Readable formats the schedule for human display.
func (s *Schedule) Readable() string {
	var text string
	switch s.rule.kind {
	case ruleEvery:
		units := []struct {
			divisor int64
			unit    string
		}{
			{86400, "d"},
			{3600, "h"},
			{60, "m"},
			{1, "s"},
		}
		var number int64
		var unit string
		for _, u := range units {
			if s.rule.seconds%u.divisor == 0 {
				number = s.rule.seconds / u.divisor
				unit = u.unit
				break
			}
		}
		if s.rule.from != nil {
			text = fmt.Sprintf("every %d%s from %s", number, unit, *s.rule.from)
		} else {
			text = fmt.Sprintf("every %d%s", number, unit)
		}
	case ruleCalendar:
		if s.rule.at != nil {
			prefix := "daily"
			if s.rule.on != nil {
				prefix = *s.rule.on
			}
			text = fmt.Sprintf("%s %s", prefix, *s.rule.at)
		} else {
			text = fmt.Sprintf("cron %s", s.rule.pattern.expression)
		}
	}
	return fmt.Sprintf("%s · %s", text, s.zone)
}

var (
	monthNames = []string{"jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"}
	dayNames   = []string{"sun", "mon", "tue", "wed", "thu", "fri", "sat"}
)

type field struct {
	bits uint64
	star bool
}

func parseField(text string, minVal, maxVal uint8, names []string) (field, error) {
	parseNumber := func(part string) (uint8, error) {
		for i, name := range names {
			if strings.EqualFold(name, part) {
				v := uint8(i) + minVal
				if v >= minVal && v <= maxVal {
					return v, nil
				}
			}
		}
		if len(part) > 0 && allASCIIDigits(part) {
			parsed, err := strconv.ParseUint(part, 10, 8)
			if err == nil {
				v := uint8(parsed)
				if v >= minVal && v <= maxVal {
					return v, nil
				}
			}
		}
		return 0, newError(fmt.Sprintf("Invalid cron field %s.", text))
	}

	var bits uint64
	for _, item := range strings.Split(text, ",") {
		rangePart, stepPart, hasSlash := strings.Cut(item, "/")
		step := 1
		if hasSlash {
			if len(stepPart) == 0 || !allASCIIDigits(stepPart) {
				return field{}, newError("Invalid cron step.")
			}
			parsed, err := strconv.Atoi(stepPart)
			if err != nil || parsed <= 0 {
				return field{}, newError("Invalid cron step.")
			}
			step = parsed
		}

		var start, end uint8
		if rangePart == "*" {
			start, end = minVal, maxVal
		} else if startStr, endStr, hasDash := strings.Cut(rangePart, "-"); hasDash {
			var err error
			start, err = parseNumber(startStr)
			if err != nil {
				return field{}, err
			}
			end, err = parseNumber(endStr)
			if err != nil {
				return field{}, err
			}
		} else {
			if hasSlash {
				return field{}, newError("Use */N or A-B/N for cron steps.")
			}
			n, err := parseNumber(rangePart)
			if err != nil {
				return field{}, err
			}
			start, end = n, n
		}
		if start > end {
			return field{}, newError("Cron ranges must ascend.")
		}
		for n := int(start); n <= int(end); n += step {
			bit := uint8(n)
			if maxVal == 7 && bit == 7 {
				bit = 0
			}
			bits |= uint64(1) << bit
		}
	}
	return field{
		bits: bits,
		star: strings.HasPrefix(text, "*"),
	}, nil
}

func (f field) contains(v uint8) bool {
	return f.bits&(uint64(1)<<v) != 0
}

func allASCIIDigits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

type pattern struct {
	expression string
	minutes    field
	hours      field
	days       field
	months     field
	weekdays   field
}

func parsePattern(text string) (pattern, error) {
	if len(text) > 256 {
		return pattern{}, newError("Cron expressions are at most 256 bytes.")
	}
	words := strings.Fields(text)
	if len(words) != 5 {
		return pattern{}, newError("Cron needs five fields: minute hour day month weekday.")
	}
	minutes, err := parseField(words[0], 0, 59, nil)
	if err != nil {
		return pattern{}, err
	}
	hours, err := parseField(words[1], 0, 23, nil)
	if err != nil {
		return pattern{}, err
	}
	days, err := parseField(words[2], 1, 31, nil)
	if err != nil {
		return pattern{}, err
	}
	months, err := parseField(words[3], 1, 12, monthNames)
	if err != nil {
		return pattern{}, err
	}
	weekdays, err := parseField(words[4], 0, 7, dayNames)
	if err != nil {
		return pattern{}, err
	}
	return pattern{
		expression: strings.Join(words, " "),
		minutes:    minutes,
		hours:      hours,
		days:       days,
		months:     months,
		weekdays:   weekdays,
	}, nil
}

func (p pattern) dateMatches(date civilDate) bool {
	if !p.months.contains(uint8(date.month)) {
		return false
	}
	dom := p.days.contains(uint8(date.day))
	dow := p.weekdays.contains(uint8(date.weekday()))
	// Vixie day rule: with a leading star in either field both match;
	// otherwise restricted day-of-month/day-of-week are alternatives.
	if p.days.star || p.weekdays.star {
		return dom && dow
	}
	return dom || dow
}
