package orchestration

import (
	"testing"
	"time"
)

func TestGapClampsAndFoldEnclosesBothOccurrences(t *testing.T) {
	zone := "America/New_York"
	calendar, err := LoadCalendar(&zone)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		day, expectedUTC string
		minute           uint16
		end              bool
	}{
		{"2026-03-08", "2026-03-08T07:00:00Z", 150, false},
		{"2026-11-01", "2026-11-01T05:30:00Z", 90, false},
		{"2026-11-01", "2026-11-01T06:30:00Z", 90, true},
	} {
		day, _ := time.Parse(time.DateOnly, tc.day)
		want, err := calendar.ParseAt(tc.expectedUTC)
		if err != nil {
			t.Fatal(err)
		}
		got, err := calendar.Boundary(int32(day.Unix()/86_400), tc.minute, tc.end)
		if err != nil || got != want {
			t.Errorf("boundary %s minute %d end=%t: %d, %v; want %d", tc.day, tc.minute, tc.end, got, err, want)
		}
	}
	for _, local := range []string{"2026-03-08 02:30", "2026-11-01 01:30"} {
		if _, err := calendar.ParseAt(local); err == nil {
			t.Errorf("ambiguous local time admitted: %q", local)
		}
	}
}

func TestLocalDaysAndNonHourGapAreNotFixedDurations(t *testing.T) {
	zone := "Australia/Lord_Howe"
	calendar, err := LoadCalendar(&zone)
	if err != nil {
		t.Fatal(err)
	}
	day, _ := time.Parse(time.DateOnly, "2026-10-04")
	want, err := calendar.ParseAt("2026-10-03T15:30:00Z")
	if err != nil {
		t.Fatal(err)
	}
	got, err := calendar.Boundary(int32(day.Unix()/86_400), 135, false)
	if err != nil || got != want {
		t.Fatalf("half-hour gap = %d, %v; want %d", got, err, want)
	}
	at, err := calendar.ParseAt("2026-10-04T00:00:00+10:30")
	if err != nil {
		t.Fatal(err)
	}
	window, err := calendar.Range(at, 1)
	if err != nil || window.EndMs-window.StartMs != 23*3_600_000+1_800_000 {
		t.Fatalf("local day = %+v, %v", window, err)
	}
	missing := "not/a-zone"
	if _, err := LoadCalendar(&missing); err == nil {
		t.Fatal("unknown zone admitted")
	}
}
