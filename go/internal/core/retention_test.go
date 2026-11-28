package core

import (
	"math"
	"testing"
)

func TestNumericLimits(t *testing.T) {
	if MaxObserverTimeoutSeconds != 86_400 || MaxTimerDelayMs != 2_147_483_647 ||
		MaxCaptureLines != 2_147_483_647 || MaxJSSafeInteger != 9_007_199_254_740_991 {
		t.Fatal("cross-runtime limits changed")
	}
	for _, value := range []float64{math.SmallestNonzeroFloat64, 1, MaxObserverTimeoutSeconds} {
		if !ValidObserverTimeoutSeconds(value) {
			t.Errorf("rejected timeout %g", value)
		}
	}
	for _, value := range []float64{0, -0.001, MaxObserverTimeoutSeconds + 0.001, math.NaN(), math.Inf(1), math.Inf(-1)} {
		if ValidObserverTimeoutSeconds(value) {
			t.Errorf("accepted timeout %g", value)
		}
	}
	for _, value := range []float64{0, 0.5, MaxTimerDelayMs} {
		if !ValidTimerDelayMs(value) {
			t.Errorf("rejected delay %g", value)
		}
	}
	for _, value := range []float64{-0.001, MaxTimerDelayMs + 0.001, math.NaN(), math.Inf(1), math.Inf(-1)} {
		if ValidTimerDelayMs(value) {
			t.Errorf("accepted delay %g", value)
		}
	}
	if !ValidCaptureLines(0) || !ValidCaptureLines(MaxCaptureLines) ||
		ValidCaptureLines(MaxCaptureLines+1) || ValidCaptureLines(math.MaxUint64) {
		t.Error("incorrect capture line boundary")
	}
	if !ValidJSSafeInteger(0) || !ValidJSSafeInteger(MaxJSSafeInteger) ||
		ValidJSSafeInteger(MaxJSSafeInteger+1) || ValidJSSafeInteger(math.MaxUint64) {
		t.Error("incorrect exact integer boundary")
	}
}

func TestCheckedDeadline(t *testing.T) {
	for _, tc := range []struct {
		anchor, delta, want uint64
		ok                  bool
	}{
		{1, 0, 1, true},
		{MaxJSSafeInteger - 1, 1, MaxJSSafeInteger, true},
		{MaxJSSafeInteger, 1, 0, false},
		{MaxJSSafeInteger + 1, 0, 0, false},
		{0, 1, 0, false},
		{1, math.MaxUint64, 0, false},
	} {
		got, ok := CheckedDeadline(tc.anchor, tc.delta)
		if got != tc.want || ok != tc.ok {
			t.Errorf("CheckedDeadline(%d, %d) = (%d, %t), want (%d, %t)", tc.anchor, tc.delta, got, ok, tc.want, tc.ok)
		}
	}
}

func TestRetentionDeadline(t *testing.T) {
	for _, tc := range []struct {
		anchor, days, want uint64
		ok                 bool
	}{
		{1, 1, 86_400_001, true},
		{1, 3650, 315_360_000_001, true},
		{1, 0, 0, false},
		{1, 3651, 0, false},
		{1, math.MaxUint64, 0, false},
		{MaxJSSafeInteger - RetentionDayMs, 1, MaxJSSafeInteger, true},
		{MaxJSSafeInteger - RetentionDayMs + 1, 1, 0, false},
	} {
		got, ok := RetentionDeadline(tc.anchor, tc.days)
		if got != tc.want || ok != tc.ok {
			t.Errorf("RetentionDeadline(%d, %d) = (%d, %t), want (%d, %t)", tc.anchor, tc.days, got, ok, tc.want, tc.ok)
		}
	}
}

func TestResponseDeadlinePassed(t *testing.T) {
	const prepared = 100
	const ordinary = prepared + ResponseAcceptanceWindowMs
	for _, tc := range []struct {
		now, prepared, expires uint64
		want                   bool
	}{
		{ordinary - 1, prepared, 200, false},
		{ordinary, prepared, 200, true},
		{ordinary, prepared, ordinary + 1, false},
		{ordinary + 1, prepared, ordinary + 1, true},
		{prepared - 1, prepared, 1, false},
		{MaxJSSafeInteger, MaxJSSafeInteger - 10, MaxJSSafeInteger, false},
	} {
		if got := ResponseDeadlinePassed(tc.now, tc.prepared, tc.expires); got != tc.want {
			t.Errorf("ResponseDeadlinePassed(%d, %d, %d) = %t, want %t", tc.now, tc.prepared, tc.expires, got, tc.want)
		}
	}
}
