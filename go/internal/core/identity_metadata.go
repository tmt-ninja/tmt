package core

import (
	"errors"
	"maps"
	"unicode"
	"unicode/utf8"
)

const (
	MaxMetadataEntries    = 64
	MaxMetadataKeyBytes   = 64
	MaxMetadataValueBytes = 1024
)

var (
	ErrIdentityInactive   = errors.New("identity is inactive or missing")
	ErrMetadataEntryLimit = errors.New("identity metadata cannot exceed 64 entries")
	ErrMetadataKey        = errors.New("invalid metadata key")
	ErrMetadataValue      = errors.New("invalid metadata value")
	ErrMetadataChanges    = errors.New("invalid or duplicate metadata changes")
)

type MetadataFilter struct {
	Key   string
	Value *string
}

type MetadataExpectationMode uint8

const (
	MetadataAny MetadataExpectationMode = iota
	MetadataAbsent
	MetadataExact
)

type MetadataExpectation struct {
	Mode  MetadataExpectationMode
	Value string
}

type MetadataChange struct {
	Key    string
	Expect MetadataExpectation
	Value  *string
}

type MetadataApplyResult struct {
	Changed bool
	// A nil value identifies a conflicting key absent from the snapshot.
	Conflicts map[string]*string
}

func ValidateMetadataKey(key string) error {
	if len(key) == 0 || len(key) > MaxMetadataKeyBytes || key[0] < 'a' || key[0] > 'z' {
		return ErrMetadataKey
	}
	for _, c := range key[1:] {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_' || c == '.' || c == '-') {
			return ErrMetadataKey
		}
	}
	return nil
}

func ValidateMetadataValue(value string) error {
	if value == "" || len(value) > MaxMetadataValueBytes || !utf8.ValidString(value) {
		return ErrMetadataValue
	}
	for _, c := range value {
		if unicode.IsControl(c) {
			return ErrMetadataValue
		}
	}
	return nil
}

func (f MetadataFilter) Validate() error {
	if err := ValidateMetadataKey(f.Key); err != nil {
		return err
	}
	if f.Value != nil {
		return ValidateMetadataValue(*f.Value)
	}
	return nil
}

func ValidateMetadataChanges(changes []MetadataChange) error {
	if len(changes) == 0 || len(changes) > MaxMetadataEntries {
		return ErrMetadataChanges
	}
	seen := make(map[string]struct{}, len(changes))
	for _, c := range changes {
		if _, duplicate := seen[c.Key]; duplicate {
			return ErrMetadataChanges
		}
		seen[c.Key] = struct{}{}
		if err := (MetadataFilter{Key: c.Key, Value: c.Value}).Validate(); err != nil {
			return err
		}
		switch c.Expect.Mode {
		case MetadataAny, MetadataAbsent:
			if c.Expect.Value != "" {
				return ErrMetadataChanges
			}
		case MetadataExact:
			if err := ValidateMetadataValue(c.Expect.Value); err != nil {
				return err
			}
		default:
			return ErrMetadataChanges
		}
	}
	return nil
}

// EvaluateMetadataChanges evaluates all expectations against the original
// snapshot. The returned map is a new projection and can be persisted as a delta.
func EvaluateMetadataChanges(snapshot map[string]string, changes []MetadataChange) (map[string]string, MetadataApplyResult, error) {
	if err := ValidateMetadataChanges(changes); err != nil {
		return nil, MetadataApplyResult{}, err
	}
	var result MetadataApplyResult
	for _, change := range changes {
		current, exists := snapshot[change.Key]
		if change.Expect.Mode == MetadataAny || change.Expect.Mode == MetadataAbsent && !exists ||
			change.Expect.Mode == MetadataExact && exists && current == change.Expect.Value {
			continue
		}
		if result.Conflicts == nil {
			result.Conflicts = make(map[string]*string)
		}
		if exists {
			result.Conflicts[change.Key] = &current
		} else {
			result.Conflicts[change.Key] = nil
		}
	}
	if len(result.Conflicts) > 0 {
		return nil, result, nil
	}
	next := make(map[string]string, len(snapshot))
	maps.Copy(next, snapshot)
	for _, change := range changes {
		if change.Value == nil {
			delete(next, change.Key)
		} else {
			next[change.Key] = *change.Value
		}
	}
	if len(next) > MaxMetadataEntries {
		return nil, MetadataApplyResult{}, ErrMetadataEntryLimit
	}
	result.Changed = !maps.Equal(next, snapshot)
	return next, result, nil
}
