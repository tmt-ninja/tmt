package core

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	MaxStatusActivityBytes = 160
	MaxStatusMoodBytes     = 32
	DefaultStatusTTLms     = 3_600_000
	MinStatusTTLms         = 1000
	MaxStatusTTLms         = 86_400_000
)

var (
	ErrStatusActivity = errors.New("invalid identity status activity")
	ErrStatusMood     = errors.New("invalid identity status mood")
	ErrStatusDuration = errors.New("invalid identity status duration")
	ErrStatusClock    = errors.New("invalid identity status timestamp")
)

type IdentityStatus struct {
	Activity                 string
	Mood                     *string
	UpdatedAtMs, ExpiresAtMs uint64
}

func NewIdentityStatus(activity string, mood *string, nowMs, ttlMs uint64) (IdentityStatus, error) {
	if ttlMs < MinStatusTTLms || ttlMs > MaxStatusTTLms {
		return IdentityStatus{}, ErrStatusDuration
	}
	expires, ok := CheckedDeadline(nowMs, ttlMs)
	if !ok {
		return IdentityStatus{}, ErrStatusClock
	}
	status := IdentityStatus{Activity: activity, Mood: mood, UpdatedAtMs: nowMs, ExpiresAtMs: expires}
	if err := status.Validate(); err != nil {
		return IdentityStatus{}, err
	}
	return status, nil
}

func (status IdentityStatus) Validate() error {
	if !validStatusText(status.Activity, MaxStatusActivityBytes) {
		return ErrStatusActivity
	}
	if status.Mood != nil && !validStatusText(*status.Mood, MaxStatusMoodBytes) {
		return ErrStatusMood
	}
	if status.UpdatedAtMs == 0 || !ValidJSSafeInteger(status.ExpiresAtMs) || status.ExpiresAtMs < status.UpdatedAtMs {
		return ErrStatusClock
	}
	ttl := status.ExpiresAtMs - status.UpdatedAtMs
	if ttl < MinStatusTTLms || ttl > MaxStatusTTLms {
		return ErrStatusClock
	}
	return nil
}

func (status IdentityStatus) Stale(nowMs uint64) bool {
	return nowMs < status.UpdatedAtMs || nowMs >= status.ExpiresAtMs
}

func validStatusText(text string, maxBytes int) bool {
	return len(text) <= maxBytes && utf8.ValidString(text) && strings.TrimSpace(text) != "" &&
		!strings.ContainsFunc(text, unicode.IsControl)
}
