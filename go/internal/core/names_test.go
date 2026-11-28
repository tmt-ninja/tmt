package core

import (
	"strings"
	"testing"
)

func TestNormalizeName(t *testing.T) {
	// Non-English text is required for Unicode compatibility coverage.
	for _, tc := range []struct{ input, want string }{
		{" Ａlice ", "alice"},
		{"\ufeffAlice\ufeff", "alice"},
		{"\u0085Alice\u0085", "\u0085alice\u0085"},
		{"ΟΣ", "ος"},
		{"ΟΣΑ", "οσα"},
		{"AΣ\u0301", "aς\u0301"},
		{"AΣ\u0301A", "aσ\u0301a"},
		{"Σ", "σ"},
		{"İIı", "i\u0307iı"},
		{"Straße", "straße"},
		{"STRASSE", "strasse"},
		{"ẞ", "ß"},
		{"\U00016ea0\U00016ea1", "\U00016ebb\U00016ebc"},
		{"E\u0301", "é"},
		{"KÅﬃ", "kåffi"},
		{"\u00a0\u2007ALICE\u202f", "alice"},
		{"\u200bALICE\u200b", "\u200balice\u200b"},
	} {
		if got := NormalizeName(tc.input); got != tc.want {
			t.Errorf("NormalizeName(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestNameDisplayAndWhitespace(t *testing.T) {
	name, err := ValidateName("\ufeff Ａlice \u2028")
	if err != nil || name.DisplayName() != "Ａlice" || name.CanonicalName() != "alice" {
		t.Fatalf("validated display and key = %+v, %v", name, err)
	}
	for _, r := range "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff" {
		if got := NormalizeName(string(r) + "ALICE" + string(r)); got != "alice" {
			t.Errorf("failed to trim %U: %q", r, got)
		}
		if _, err := ValidateName(string(r)); err != ErrNameEmptyOrControl {
			t.Errorf("ValidateName(%U) = %v", r, err)
		}
		if IsPaneTarget("a" + string(r) + "b:1.2") {
			t.Errorf("accepted interior whitespace %U in a session name", r)
		}
	}
	if _, err := ValidateName("\u0085"); err != nil {
		t.Errorf("rejected NEL: %v", err)
	}
	for r := rune(0); r < 0x20; r++ {
		if _, err := ValidateName("a" + string(r) + "b"); err != ErrNameEmptyOrControl {
			t.Errorf("ValidateName(a%Ub) = %v", r, err)
		}
	}
	for _, value := range []string{"", "a\x7fb", "\x00Alice", strings.Repeat("a", 100) + "\x00"} {
		if _, err := ValidateName(value); err != ErrNameEmptyOrControl {
			t.Errorf("ValidateName(%q) = %v", value, err)
		}
	}
}

func TestNamePaneTargetReservation(t *testing.T) {
	for _, target := range []string{
		"%14", "10.3", "session:2.1", "％１４", "１０.３", "session：２.１", " %0014 ", "a\u0085b:2.1",
	} {
		if !IsPaneTarget(target) {
			t.Errorf("target missed: %q", target)
		}
		for _, validate := range []func(string) (ValidatedName, error){ValidateName, ValidateExistingName} {
			if _, err := validate(target); err != ErrNamePaneTarget {
				t.Errorf("validating target %q as name: %v", target, err)
			}
		}
	}
	for _, name := range []string{
		"backend", "%", "%1a", "%١", "١.٢", "-1.2", "1.-2", "1.2.3", ":1.2", "a:b:1.2",
		"a b:1.2", "a\ufeffb:1.2", "1.", ".2", "repo/branch", "w1:p2", "W1:P2", "ｗ１:ｐ２",
		"pty_", "pty_abc-123", "pty_" + strings.Repeat("a", 65),
	} {
		if IsPaneTarget(name) {
			t.Errorf("recognized name %q as a target", name)
		}
		if _, err := ValidateExistingName(name); err != nil {
			t.Errorf("rejected existing name %q: %v", name, err)
		}
		if len(name) <= NameLimit {
			if _, err := ValidateName(name); err != nil {
				t.Errorf("rejected new name %q: %v", name, err)
			}
		}
	}
	if !IsPaneTarget("pty_abc123") || IsPaneTarget("PTY_ABC123") {
		t.Fatal("PTY target syntax must be case-sensitive")
	}
	for _, name := range []string{"pty_abc123", "PTY_ABC123", "ＰＴＹ＿ＡＢＣ１２３", "pty_" + strings.Repeat("a", 64)} {
		if _, err := ValidateName(name); err != ErrNamePaneTarget {
			t.Errorf("new name %q must be reserved: %v", name, err)
		}
		if _, err := ValidateExistingName(name); err != nil {
			t.Errorf("rejected existing name %q: %v", name, err)
		}
	}
}

func TestNameLengthAfterNormalization(t *testing.T) {
	for _, name := range []string{
		strings.Repeat("a", NameLimit),
		"\u3000" + strings.Repeat("a", NameLimit) + "\ufeff",
		strings.Repeat("é", NameLimit),
		strings.Repeat("\U00016ea0", NameLimit),
		strings.Repeat("e\u0301", NameLimit),
		strings.Repeat("ﬃ", 21),
	} {
		if _, err := ValidateName(name); err != nil {
			t.Errorf("rejected name within length limit: %q: %v", name, err)
		}
	}
	for _, name := range []string{
		strings.Repeat("a", NameLimit+1),
		strings.Repeat("e\u0301", NameLimit+1),
		strings.Repeat("ﬃ", 22),
	} {
		if _, err := ValidateName(name); err != ErrNameTooLong {
			t.Errorf("validating long name %q: %v", name, err)
		}
	}
	held := strings.Repeat("a", 65_536)
	got, err := ValidateExistingName(held)
	if err != nil || got.DisplayName() != Name(held) || got.CanonicalName() != held {
		t.Fatalf("failed to preserve legacy name of %d bytes: %v", len(held), err)
	}
}

func TestCommandWord(t *testing.T) {
	for _, tc := range []struct{ input, want string }{
		{"go-1_ID.2", "go-1_ID.2"},
		{"", "''"},
		{"a b", "'a b'"},
		{"a'b", "'a'\\''b'"},
		{"a$HOME", "'a$HOME'"},
	} {
		if got := CommandWord(tc.input); got != tc.want {
			t.Errorf("CommandWord(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestNameNormalizationKnownICUDivergences(t *testing.T) {
	// NOT PORTED (#6938): x/text inserts a combining grapheme joiner to limit
	// the non-starter run. ICU NFKC leaves all 31 marks adjacent.
	marks := strings.Repeat("\u0301", 30)
	if got, want := TargetText("B"+marks+"\u0301"), "B"+marks+"\u034f\u0301"; got != want {
		t.Errorf("stream-safe NFKC returned %q, want %q", got, want)
	}

	// NOT PORTED (#6938): x/text caps the final-sigma lookahead. ICU sees the
	// cased A after the joiners and produces medial sigma (σ).
	joiners := strings.Repeat("\u200d", 31)
	if got, want := NormalizeName("AΣ"+joiners+"A"), "aς"+joiners+"a"; got != want {
		t.Errorf("bounded final-sigma lookahead returned %q, want %q", got, want)
	}
}
