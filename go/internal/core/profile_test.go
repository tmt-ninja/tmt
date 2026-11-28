package core

import (
	"strings"
	"testing"
)

func TestNormalizeProfileContent(t *testing.T) {
	// Non-English text is required to test Unicode whitespace and byte limits.
	for _, tc := range []struct {
		input, want string
		err         error
	}{
		{"\ufeff\ufeff  first\r\nsecond\rthird\n", "\ufeff  first\nsecond\nthird\n", nil},
		{"tab\tline\n", "tab\tline\n", nil},
		{"", "", ErrProfileEmpty},
		{"\t\r\n \u00a0\u1680\u2000\u200a\u2028\u2029\u202f\u205f\u3000\ufeff", "", ErrProfileEmpty},
		{"\u0085", "\u0085", nil},
		{"before\x00after", "", ErrProfileControl},
		{"before\x7fafter", "", ErrProfileControl},
		{"\xff", "", ErrProfileEncoding},
		{strings.Repeat("a", MaxProfileBytes-1) + "\r\n", "", ErrProfileTooLarge},
		{"\ufeff" + strings.Repeat("a", MaxProfileBytes), "", ErrProfileTooLarge},
		{strings.Repeat("😀", MaxProfileBytes/4+1), "", ErrProfileTooLarge},
	} {
		value, err := NormalizeProfileContent(tc.input)
		if value != tc.want || err != tc.err {
			t.Errorf("normalizing %d bytes returned %d bytes and %v, want %d bytes and %v", len(tc.input), len(value), err, len(tc.want), tc.err)
		}
	}
	for _, value := range []string{strings.Repeat("a", MaxProfileBytes), strings.Repeat("😀", MaxProfileBytes/4)} {
		if got, err := NormalizeProfileContent(value); got != value || err != nil {
			t.Errorf("rejected valid profile of exactly %d bytes: %v", MaxProfileBytes, err)
		}
	}
}
