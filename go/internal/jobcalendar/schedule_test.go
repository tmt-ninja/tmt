package jobcalendar

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func strPtr(s string) *string { return &s }

func parseMS(t *testing.T, text string) int64 {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, text)
	if err != nil {
		t.Fatalf("time.Parse(%q) failed: %v", text, err)
	}
	return parsed.UnixMilli()
}

func mustCron(t *testing.T, expr, zone string) *Schedule {
	t.Helper()
	s, err := Parse(Cron(expr), zone, 0)
	if err != nil {
		t.Fatalf("Parse(Cron(%q), %q) failed: %v", expr, zone, err)
	}
	return s
}

func TestFiveFieldTableCoversNamesListsRangesStepsAndDayAlternatives(t *testing.T) {
	cases := []struct {
		pattern string
		after   string
		next    string
	}{
		{"*/15 * * * *", "2026-10-03T00:00:00Z", "2026-10-03T00:15:00Z"},
		{"5,35 8-10/2 * * *", "2026-10-03T08:05:00Z", "2026-10-03T08:35:00Z"},
		{"0 9 * JAN-MAR MON-FRI", "2026-03-31T09:00:00Z", "2027-01-01T09:00:00Z"},
		{"0 9 13 * fri", "2026-10-08T09:00:00Z", "2026-10-09T09:00:00Z"},
		{"0 9 13 * fri", "2026-10-12T09:00:00Z", "2026-10-13T09:00:00Z"},
		{"0 0 * * 7", "2026-10-03T00:00:00Z", "2026-10-04T00:00:00Z"},
		{"0 0 * * 0", "2026-10-03T00:00:00Z", "2026-10-04T00:00:00Z"},
		{"0 0 29 feb *", "2025-03-01T00:00:00Z", "2028-02-29T00:00:00Z"},
		{"0 0 */2 * mon", "2026-10-04T00:00:00Z", "2026-10-05T00:00:00Z"},
		{"*/100 * * * *", "2026-10-03T00:00:00Z", "2026-10-03T01:00:00Z"},
	}
	for _, tc := range cases {
		got, ok, err := mustCron(t, tc.pattern, "UTC").NextAfter(parseMS(t, tc.after))
		if err != nil {
			t.Errorf("%q: NextAfter error: %v", tc.pattern, err)
			continue
		}
		want := parseMS(t, tc.next)
		if !ok || got != want {
			t.Errorf("%q after %s: got (%d, %v), want (%d, true)", tc.pattern, tc.after, got, ok, want)
		}
	}

	got, ok, err := mustCron(t, "0 0 31 feb *", "UTC").NextAfter(parseMS(t, "2026-01-01T00:00:00Z"))
	if err != nil || ok || got != 0 {
		t.Errorf("impossible date 31 feb: got (%d, %v, %v), want (0, false, nil)", got, ok, err)
	}
}

func TestMalformedAndNonstandardPatternsAreRejectedWithoutPanics(t *testing.T) {
	badCron := []string{
		"",
		"@daily",
		"0 0 * *",
		"0 0 0 * * *",
		"60 * * * *",
		"* 24 * * *",
		"0 0 0 * *",
		"0 0 * 13 *",
		"0 0 * * 8",
		"0 0 * * MON#2",
		"0 0 L * *",
		"0 0 ? * mon",
		"*/0 * * * *",
		"0/2 * * * *",
		"1-0 * * * *",
		"0, * * * *",
		"0 0 * JAX *",
		"*/-1 * * * *",
		"0 0 * * 四",
		"0 0 * * ,mon",
		"0 0 * * 1--2",
	}
	for _, expr := range badCron {
		if _, err := Parse(Cron(expr), "UTC", 0); err == nil {
			t.Errorf("Parse(Cron(%q)) succeeded, want error", expr)
		}
	}

	badDurations := []string{
		"",
		"0s",
		"-1m",
		"1.5h",
		"1",
		"1ms",
		"1é",
		"9日",
		"9223372036854775807d",
	}
	for _, value := range badDurations {
		if _, err := Parse(Every(value, nil), "UTC", 0); err == nil {
			t.Errorf("Parse(Every(%q)) succeeded, want error", value)
		}
	}

	badTimes := []string{"9:00", "24:00", "09:60", "09:0x", "００:00"}
	for _, value := range badTimes {
		if _, err := Parse(At(value, nil), "UTC", 0); err == nil {
			t.Errorf("Parse(At(%q)) succeeded, want error", value)
		}
	}

	if _, err := Parse(Cron("* * * * *"), "Mars/Nowhere", 0); err == nil {
		t.Errorf("Parse with unknown timezone succeeded, want error")
	}
}

func TestLocalDaysAndHalfHourDSTGapsAreNotUTCCalendarDays(t *testing.T) {
	weekdays, err := Parse(At("09:00", strPtr("weekdays")), "Asia/Tokyo", 0)
	if err != nil {
		t.Fatalf("Parse weekdays failed: %v", err)
	}
	got, ok, err := weekdays.NextAfter(parseMS(t, "2026-10-02T00:00:00Z"))
	if err != nil || !ok || got != parseMS(t, "2026-10-05T00:00:00Z") {
		t.Errorf("Tokyo weekdays: got (%d, %v, %v), want %d", got, ok, err, parseMS(t, "2026-10-05T00:00:00Z"))
	}

	selected, err := Parse(At("10:00", strPtr("mon,thu")), "Asia/Kolkata", 0)
	if err != nil {
		t.Fatalf("Parse mon,thu failed: %v", err)
	}
	got, ok, err = selected.NextAfter(parseMS(t, "2026-10-05T04:30:00Z"))
	if err != nil || !ok || got != parseMS(t, "2026-10-08T04:30:00Z") {
		t.Errorf("Kolkata mon,thu: got (%d, %v, %v), want %d", got, ok, err, parseMS(t, "2026-10-08T04:30:00Z"))
	}

	gap := mustCron(t, "15 2 * * *", "Australia/Lord_Howe")
	got, ok, err = gap.NextAfter(parseMS(t, "2026-10-02T15:45:00Z"))
	if err != nil || !ok || got != parseMS(t, "2026-10-04T15:15:00Z") {
		t.Errorf("Lord_Howe half-hour DST gap (Oct 4 02:15 does not exist): got (%d, %v, %v), want %d",
			got, ok, err, parseMS(t, "2026-10-04T15:15:00Z"))
	}
}

func TestFixedTimesSkipSpringGapsAndChooseOnlyFirstFallOccurrence(t *testing.T) {
	spring := mustCron(t, "30 2 * * *", "America/New_York")
	got, ok, err := spring.NextAfter(parseMS(t, "2026-03-07T07:30:00Z"))
	if err != nil || !ok || got != parseMS(t, "2026-03-09T06:30:00Z") {
		t.Errorf("NY spring gap: got (%d, %v, %v), want %d", got, ok, err, parseMS(t, "2026-03-09T06:30:00Z"))
	}

	fall := mustCron(t, "30 1 * * *", "America/New_York")
	fallCases := []struct {
		after string
		want  string
	}{
		{"2026-11-01T04:00:00Z", "2026-11-01T05:30:00Z"},
		{"2026-11-01T05:30:00Z", "2026-11-02T06:30:00Z"},
		{"2026-11-01T06:00:00Z", "2026-11-02T06:30:00Z"},
	}
	for _, tc := range fallCases {
		got, ok, err := fall.NextAfter(parseMS(t, tc.after))
		if err != nil || !ok || got != parseMS(t, tc.want) {
			t.Errorf("NY fall fold after %s: got (%d, %v, %v), want %d",
				tc.after, got, ok, err, parseMS(t, tc.want))
		}
	}
}

func TestElapsedIntervalsKeepOneAnchorAcrossDSTAndSkipPastSlots(t *testing.T) {
	schedule, err := Parse(Every("3h", strPtr("00:00")), "America/New_York", parseMS(t, "2026-03-08T05:00:00Z"))
	if err != nil {
		t.Fatalf("Parse every 3h from 00:00 failed: %v", err)
	}
	got, ok, err := schedule.NextAfter(parseMS(t, "2026-03-08T05:00:00Z"))
	if err != nil || !ok || got != parseMS(t, "2026-03-08T08:00:00Z") {
		t.Errorf("every 3h first: got (%d, %v, %v), want %d", got, ok, err, parseMS(t, "2026-03-08T08:00:00Z"))
	}
	got, ok, err = schedule.NextAfter(parseMS(t, "2026-03-08T12:34:56Z"))
	if err != nil || !ok || got != parseMS(t, "2026-03-08T14:00:00Z") {
		t.Errorf("every 3h skip past: got (%d, %v, %v), want %d", got, ok, err, parseMS(t, "2026-03-08T14:00:00Z"))
	}

	fromGap, err := Parse(Every("1h", strPtr("02:30")), "America/New_York", parseMS(t, "2026-03-08T05:00:00Z"))
	if err != nil {
		t.Fatalf("Parse every 1h from 02:30 failed: %v", err)
	}
	got, ok, err = fromGap.NextAfter(parseMS(t, "2026-03-08T05:00:00Z"))
	if err != nil || !ok || got != parseMS(t, "2026-03-09T06:30:00Z") {
		t.Errorf("every 1h from gap: got (%d, %v, %v), want %d", got, ok, err, parseMS(t, "2026-03-09T06:30:00Z"))
	}

	every, err := Parse(Every("1h", nil), "America/New_York", parseMS(t, "2026-11-01T05:30:00Z"))
	if err != nil {
		t.Fatalf("Parse every 1h failed: %v", err)
	}
	got, ok, err = every.NextAfter(parseMS(t, "2026-11-01T05:30:00Z"))
	if err != nil || !ok || got != parseMS(t, "2026-11-01T06:30:00Z") {
		t.Errorf("every 1h across fall fold: got (%d, %v, %v), want %d", got, ok, err, parseMS(t, "2026-11-01T06:30:00Z"))
	}
}

func TestPersistedSchedulesPreserveZoneAnchorAndReadableForm(t *testing.T) {
	inputs := []struct {
		label string
		input ScheduleInput
		want  string
	}{
		{"every", Every("30m", strPtr("09:00")), "every 30m from 09:00 · Asia/Tokyo"},
		{"at", At("09:00", strPtr("weekdays")), "weekdays 09:00 · Asia/Tokyo"},
		{"cron", Cron("0 */3 * * *"), "cron 0 */3 * * * · Asia/Tokyo"},
	}
	for _, tc := range inputs {
		schedule, err := Parse(tc.input, "Asia/Tokyo", parseMS(t, "2026-10-03T08:12:00Z"))
		if err != nil {
			t.Fatalf("%s: Parse failed: %v", tc.label, err)
		}
		restored, err := FromDocument(schedule.Document())
		if err != nil {
			t.Fatalf("%s: FromDocument failed: %v", tc.label, err)
		}
		if !schedule.Equal(restored) {
			t.Errorf("%s: restored schedule differs: got %+v, want %+v", tc.label, restored, schedule)
		}

		// Also verify JSON round-trip preserves exact int64 anchors.
		raw, err := json.Marshal(schedule)
		if err != nil {
			t.Fatalf("%s: json.Marshal failed: %v", tc.label, err)
		}
		var roundTripped Schedule
		if err := json.Unmarshal(raw, &roundTripped); err != nil {
			t.Fatalf("%s: json.Unmarshal failed: %v", tc.label, err)
		}
		if !schedule.Equal(&roundTripped) {
			t.Errorf("%s: JSON round-trip differs: got %+v, want %+v", tc.label, &roundTripped, schedule)
		}

		after := parseMS(t, "2026-10-04T08:12:00Z")
		n1, ok1, err1 := schedule.NextAfter(after)
		n2, ok2, err2 := restored.NextAfter(after)
		if err1 != nil || err2 != nil || ok1 != ok2 || n1 != n2 {
			t.Errorf("%s: NextAfter mismatch: (%d,%v,%v) vs (%d,%v,%v)", tc.label, n1, ok1, err1, n2, ok2, err2)
		}
		if got := schedule.Readable(); got != tc.want || !strings.HasSuffix(got, "Asia/Tokyo") {
			t.Errorf("%s: Readable() = %q, want %q", tc.label, got, tc.want)
		}
	}
}
