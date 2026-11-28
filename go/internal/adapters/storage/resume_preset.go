package storage

import (
	"encoding/json/v2"
	"strings"
	"unicode"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

type resumePreset struct {
	Executable string            `json:"executable"`
	Model      *string           `json:"model"`
	Effort     *string           `json:"effort"`
	Env        map[string]string `json:"env"`
	Binding    string            `json:"binding"`
	OwnerPID   uint64            `json:"owner_pid"`
	OwnerStart string            `json:"owner_start"`
	Harness    *core.DriverName  `json:"harness"`
	Session    *string           `json:"session"`
}

func readResumePreset(document string) *resumePreset {
	var preset resumePreset
	if err := json.Unmarshal([]byte(document), &preset, json.RejectUnknownMembers(true)); err != nil {
		return nil
	}
	if preset.Executable == "" || strings.HasPrefix(preset.Executable, "-") ||
		strings.ContainsFunc(preset.Executable, unicode.IsControl) ||
		!validResumeModel(preset.Model) || !validResumeModel(preset.Effort) ||
		!canonicalBindingID(preset.Binding) || !safeTime(preset.OwnerPID) ||
		!validStart(preset.OwnerStart) || preset.Env == nil || (preset.Harness == nil) != (preset.Session == nil) {
		return nil
	}
	for key, value := range preset.Env {
		if (key != "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE" && key != "CLAUDE_MINI_PCT") ||
			len(value) > 128 || strings.ContainsFunc(value, unicode.IsControl) {
			return nil
		}
	}
	if preset.Harness != nil && (!validResumeToken(string(*preset.Harness)) || !validStart(*preset.Session)) {
		return nil
	}
	return &preset
}

func validResumeModel(value *string) bool {
	if value == nil {
		return true
	}
	if len(*value) < 1 || len(*value) > 128 || (*value)[0] == '-' {
		return false
	}
	for _, c := range []byte(*value) {
		if !strings.ContainsRune("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._:/[]@", rune(c)) {
			return false
		}
	}
	return true
}

func (p resumePreset) matches(selected core.ResumeSession) bool {
	return p.Harness != nil && *p.Harness == selected.Driver && *p.Session == selected.ProviderSession
}

func (p resumePreset) projection() *core.ResumeLaunchPreset {
	return &core.ResumeLaunchPreset{
		Executable: p.Executable, Model: p.Model, Effort: p.Effort, Env: p.Env, Associated: p.Session != nil,
	}
}
