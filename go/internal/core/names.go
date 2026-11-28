package core

import (
	"errors"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"
)

// NameLimit counts Unicode scalar values after trimming and NFKC.
const NameLimit = 64

var (
	ErrNameEmptyOrControl = errors.New("Identity name must not be empty or contain control characters.")
	ErrNamePaneTarget     = errors.New("Identity name must not look like a pane target.")
	ErrNameTooLong        = errors.New("Identity name must be at most 64 characters.")
)

// ValidatedName preserves the display spelling and its case-insensitive key.
type ValidatedName struct {
	display   Name
	canonical string
}

func (n ValidatedName) DisplayName() Name     { return n.display }
func (n ValidatedName) CanonicalName() string { return n.canonical }

// NOT PORTED (#6938, GO1-01): ICU normalization without stream-safe joiner insertion.
func TargetText(value string) string {
	return norm.NFKC.String(strings.TrimFunc(value, ecmascriptSpace))
}

func NormalizeName(value string) string {
	return lowercaseName(TargetText(value))
}

// NOT PORTED (#6938, GO1-02): ICU final-sigma context beyond 30 case-ignorable runes.
func lowercaseName(target string) string {
	return cases.Lower(language.Und).String(target)
}

func IsPaneTarget(value string) bool {
	return isPaneTargetText(TargetText(value))
}

// ValidateName checks a new name against the built-in target grammars and
// applies the length limit. Existing identities may retain older names.
func ValidateName(value string) (ValidatedName, error) {
	return validateName(value, true)
}

func ValidateExistingName(value string) (ValidatedName, error) {
	return validateName(value, false)
}

func validateName(value string, newName bool) (ValidatedName, error) {
	display := strings.TrimFunc(value, ecmascriptSpace)
	if display == "" || !utf8.ValidString(display) || strings.ContainsFunc(display, func(r rune) bool {
		return r < 0x20 || r == 0x7f
	}) {
		return ValidatedName{}, ErrNameEmptyOrControl
	}
	target := TargetText(display)
	canonical := lowercaseName(target)
	if isTmuxTarget(canonical) {
		return ValidatedName{}, ErrNamePaneTarget
	}
	if newName {
		if isPaneTargetText(target) || IsPaneTarget(canonical) {
			return ValidatedName{}, ErrNamePaneTarget
		}
		if utf8.RuneCountInString(target) > NameLimit {
			return ValidatedName{}, ErrNameTooLong
		}
	}
	return ValidatedName{display: Name(display), canonical: canonical}, nil
}

// NOT PORTED (#6938, GO1-03): registered external host target grammars are out of scope for phase 1.
func isPaneTargetText(value string) bool {
	if isTmuxTarget(value) {
		return true
	}
	suffix, ok := strings.CutPrefix(value, "pty_")
	if !ok || len(suffix) == 0 || len(suffix) > 64 {
		return false
	}
	for _, b := range []byte(suffix) {
		if !(b >= '0' && b <= '9' || b >= 'a' && b <= 'z') {
			return false
		}
	}
	return true
}

func isTmuxTarget(value string) bool {
	if id, ok := strings.CutPrefix(value, "%"); ok && isASCIIDigits(id) {
		return true
	}
	if session, pane, ok := strings.Cut(value, ":"); ok {
		return session != "" && !strings.ContainsFunc(session, ecmascriptSpace) && isWindowPane(pane)
	}
	return isWindowPane(value)
}

func isWindowPane(value string) bool {
	window, pane, ok := strings.Cut(value, ".")
	return ok && isASCIIDigits(window) && isASCIIDigits(pane)
}

func isASCIIDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// CommandWord quotes one shell argument for a command shown in a hint.
func CommandWord(value string) string {
	if value != "" && !strings.ContainsFunc(value, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("-._", r))
	}) {
		return value
	}
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}
