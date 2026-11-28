package core

import (
	"errors"
	"strings"
	"unicode/utf8"
)

const MaxProfileBytes = 65_536

var (
	ErrProfileTooLarge = errors.New("Content must not exceed 65536 bytes.")
	ErrProfileControl  = errors.New("Content must not contain control characters.")
	ErrProfileEmpty    = errors.New("Content must not be empty or whitespace-only.")
	ErrProfileEncoding = errors.New("Content must be valid UTF-8.")
)

var profileLineEndings = strings.NewReplacer("\r\n", "\n", "\r", "\n")

// NormalizeProfileContent validates the original byte length, normalizes line
// endings, and strips one leading BOM. Other meaningful whitespace is retained.
func NormalizeProfileContent(value string) (string, error) {
	if len(value) > MaxProfileBytes {
		return "", ErrProfileTooLarge
	}
	if !utf8.ValidString(value) {
		return "", ErrProfileEncoding
	}
	value = strings.TrimPrefix(profileLineEndings.Replace(value), "\ufeff")
	for _, r := range value {
		if (r < 0x20 && r != '\t' && r != '\n') || r == 0x7f {
			return "", ErrProfileControl
		}
	}
	if strings.TrimFunc(value, ecmascriptSpace) == "" {
		return "", ErrProfileEmpty
	}
	return value, nil
}

// ProfileKind distinguishes two independent identity-owned text records.
type ProfileKind string

const (
	ProfileRole     ProfileKind = "role"
	ProfilePreamble ProfileKind = "preamble"
)

type TextProfile struct {
	IdentityID  IdentityID
	Content     string
	UpdatedAtMs uint64
}
