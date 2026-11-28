//go:build darwin || linux

package runtime

import "testing"

func TestPSV1Observation(t *testing.T) {
	expected := Incarnation{42, "ps-v1:Sat Jan 1 00:00:00 2000"}
	for _, tc := range []struct {
		output string
		state  State
		match  State
	}{
		{"Sat Jan  1 00:00:00 2000 S+", Alive, Alive},
		{"Sat Jan  1 00:00:00 2000 T", Suspended, Unknown},
		{"Sat Jan  1 00:00:00 2000 t", Suspended, Unknown},
		{"Sun Jan  2 00:00:00 2000 T", Suspended, Gone},
		{"Sat Jan  1 00:00:00 2000 Z", Gone, Gone},
		{"Sat Jan  1 00:00:00 2000 ?E", Gone, Gone},
		{"Sat Jan  1 00:00:00 2000 X", Gone, Gone},
		{"Sat Jan  1 00:00:00 2000 ?", Unknown, Unknown},
		{"Sat Jan  1 00:00:00 2000 S\nSat Jan  1 00:00:00 2000 R", Unknown, Unknown},
		{"Sat Jan  1 00:00:00 2000 S\xff", Unknown, Unknown},
		{"", Unknown, Unknown},
	} {
		got := parse(expected.PID, []byte(tc.output))
		if got.State != tc.state || got.Match(expected) != tc.match {
			t.Errorf("parse(%q) = %+v, match %v", tc.output, got, got.Match(expected))
		}
		if tc.match == Alive && got.Incarnation != expected {
			t.Errorf("start token = %q, want %q", got.Incarnation.Start, expected.Start)
		}
	}
}
