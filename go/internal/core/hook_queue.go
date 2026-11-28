package core

import (
	"encoding/hex"
	"strings"
	"unicode"
	"unicode/utf8"
)

type HookEventID string

type HookCaptureOutcome string

const (
	HookCaptureCommitted       HookCaptureOutcome = "committed"
	HookCaptureDuplicate       HookCaptureOutcome = "duplicate"
	HookCaptureNotApplicable   HookCaptureOutcome = "not_applicable"
	HookCaptureNoAdmittedStart HookCaptureOutcome = "no_admitted_start"
	HookCaptureRetiredIdentity HookCaptureOutcome = "retired_identity"
	HookCaptureMissingBatch    HookCaptureOutcome = "missing_batch"
)

type HookCaptureEvent struct {
	Version         uint8                `json:"version"`
	ID              HookEventID          `json:"id"`
	Capture         *HookPendingCapture  `json:"capture"`
	DiagnosticFence *HookDiagnosticFence `json:"diagnostic_fence"`
	FollowUp        HookCaptureFollowUp  `json:"follow_up"`
}

type HookDiagnosticFence struct {
	Batch *string `json:"batch"`
}

type HookPendingCapture struct {
	Identity           IdentityID         `json:"identity"`
	Binding            BindingID          `json:"binding"`
	BindingFingerprint string             `json:"binding_fingerprint"`
	Batch              *string            `json:"batch"`
	Provisional        bool               `json:"provisional"`
	Provider           string             `json:"provider"`
	Session            string             `json:"session"`
	PID                uint64             `json:"pid"`
	Start              string             `json:"start"`
	Turn               *string            `json:"turn"`
	Continuation       bool               `json:"continuation"`
	Model              *string            `json:"model"`
	Interrupted        bool               `json:"interrupted"`
	Response           *HookFinalText     `json:"response"`
	NowMs              uint64             `json:"now_ms"`
	Admitted           HookCaptureOutcome `json:"admitted"`
}

type HookFinalText struct {
	Text          string `json:"text"`
	OriginalBytes uint64 `json:"original_bytes"`
}

type HookCaptureFollowUp struct {
	Usage      bool                 `json:"usage"`
	Transcript *string              `json:"transcript"`
	Learning   *HookCaptureLearning `json:"learning"`
}

type HookCaptureLearning struct {
	Launch   HookCaptureLaunch `json:"launch"`
	Provider string            `json:"provider"`
	Step     *string           `json:"step"`
	Detail   *string           `json:"detail"`
	Failure  *string           `json:"failure"`
}

type HookCaptureLaunch struct {
	IdentityID   IdentityID `json:"identity_id"`
	BindingID    BindingID  `json:"binding_id"`
	OwnerPID     uint64     `json:"owner_pid"`
	OwnerStart   string     `json:"owner_start"`
	StartupInput bool       `json:"startup_input,omitempty"`
}

func (e HookCaptureEvent) Identity() *IdentityID {
	if e.Capture != nil {
		return &e.Capture.Identity
	}
	if e.FollowUp.Learning != nil {
		return &e.FollowUp.Learning.Launch.IdentityID
	}
	return nil
}

func (e HookCaptureEvent) Valid() bool {
	if e.Version != 1 || !ValidUUID(string(e.ID)) || (e.Capture == nil) == (e.DiagnosticFence == nil) {
		return false
	}
	if learning := e.FollowUp.Learning; learning != nil {
		launch := learning.Launch
		if !ValidUUID(string(launch.IdentityID)) || !ValidUUID(string(launch.BindingID)) || !validHookProcess(launch.OwnerPID, launch.OwnerStart) {
			return false
		}
	}
	if e.Capture == nil {
		return e.FollowUp.Learning != nil && (e.DiagnosticFence.Batch == nil || ValidUUID(*e.DiagnosticFence.Batch))
	}
	c := e.Capture
	_, fingerprintErr := hex.DecodeString(c.BindingFingerprint)
	return ValidUUID(string(c.Identity)) && c.Binding != "" && len(c.BindingFingerprint) == 64 && fingerprintErr == nil &&
		validHookProcess(c.PID, c.Start) && validHookToken(c.Session) && ValidJSSafeInteger(c.NowMs) &&
		(c.Turn == nil || validHookToken(*c.Turn)) &&
		(!c.Provisional || c.Batch != nil && ValidUUID(*c.Batch)) &&
		(c.Response == nil || c.Response.valid()) && c.Admitted.admission()
}

func validHookProcess(pid uint64, start string) bool {
	return pid > 0 && ValidJSSafeInteger(pid) && validHookToken(start)
}

func validHookToken(value string) bool {
	return len(value) > 0 && len(value) <= 256 && utf8.ValidString(value) &&
		strings.TrimSpace(value) != "" && !strings.ContainsFunc(value, unicode.IsControl)
}

func (f HookFinalText) valid() bool {
	n := len(f.Text)
	return n > 0 && n <= 16384 && utf8.ValidString(f.Text) && f.OriginalBytes >= uint64(n) && (f.OriginalBytes == uint64(n) || n >= 16381) && ValidJSSafeInteger(f.OriginalBytes)
}

func (o HookCaptureOutcome) admission() bool {
	switch o {
	case HookCaptureCommitted, HookCaptureDuplicate, HookCaptureNotApplicable, HookCaptureNoAdmittedStart:
		return true
	default:
		return false
	}
}

func ValidUUID(value string) bool {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return false
	}
	decoded, err := hex.DecodeString(strings.ReplaceAll(value, "-", ""))
	return err == nil && len(decoded) == 16 && strings.ToLower(value) == value
}

type HookQueueEntry struct {
	Event     HookCaptureEvent
	Sequence  uint64
	Committed bool
}

type HookCaptureReceipt struct {
	EventID       HookEventID
	IdentityID    *IdentityID
	BatchID       *string
	Outcome       HookCaptureOutcome
	CommittedAtMs uint64
}

type HookPublicationStatus string

const (
	HookPublicationQueued      HookPublicationStatus = "queued"
	HookPublicationRecorded    HookPublicationStatus = "recorded"
	HookPublicationUnpublished HookPublicationStatus = "unpublished"
	HookPublicationUnknown     HookPublicationStatus = "unknown"
)

type HookPublication struct {
	Status  HookPublicationStatus
	Receipt *HookCaptureReceipt
}
