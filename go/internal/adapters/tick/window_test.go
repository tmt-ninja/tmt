package tick

import "testing"

func TestClockWindowUsesOneAdmissionAcrossRollback(t *testing.T) {
	w, err := NewWindow(120_500, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, step := range []struct {
		at    uint64
		admit bool
	}{
		{120_500, true}, {120_501, false}, {60_000, false}, {179_999, false},
		{180_000, true}, {0, false}, {180_000, false}, {240_000, true},
	} {
		if got := w.BeginMinute(step.at); got != step.admit {
			t.Errorf("time %d admitted = %t, want %t", step.at, got, step.admit)
		}
	}
}

func TestClockWindowBoundsObservationAcrossStallAndRestart(t *testing.T) {
	for _, foreground := range []bool{false, true} {
		w, err := NewWindow(600_000, foreground)
		if err != nil {
			t.Fatal(err)
		}
		start := int64(540_000)
		if foreground {
			start = 600_000
		}
		for _, step := range []struct {
			at    uint64
			after int64
		}{
			{600_000, start}, {601_000, 600_000}, {1_200_000, 900_000},
			{1_000_000, 1_000_000}, {1_000_001, 1_000_000},
		} {
			if got, err := w.Observe(step.at); err != nil || got != step.after {
				t.Errorf("foreground=%v time %d: after %d, want %d, err %v", foreground, step.at, got, step.after, err)
			}
		}
	}
}
