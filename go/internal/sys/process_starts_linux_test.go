package sys

import (
	"strings"
	"testing"
)

func TestNativeLinuxStatKeepsTheStartFieldAfterComplexCommand(t *testing.T) {
	const stat = "42 (an ) unusual\n(name)) S " + "1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 12345 20\n"
	state, ticks, ok := parseProcPIDStat(42, []byte(stat))
	if !ok || state != 'S' || ticks != 12345 {
		t.Fatalf("stat start = %c, %d, %v", state, ticks, ok)
	}
	for _, bad := range []string{stat[:len(stat)-15], strings.Replace(stat, "42", "43", 1), strings.Replace(stat, "12345", "-1", 1)} {
		if _, _, ok := parseProcPIDStat(42, []byte(bad)); ok {
			t.Fatalf("admitted invalid stat %q", bad)
		}
	}
}
