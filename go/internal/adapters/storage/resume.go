package storage

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json/v2"
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const resumeFenceVersion = 1

var errInvalidResumeRow = errors.New("invalid stored resume evidence")

func (r bindingRows) ReadResume(id core.IdentityID) (*core.ResumeSnapshot, error) {
	identity, err := (identityRows{r.records}).FindByID(id)
	if err != nil || identity == nil {
		return nil, err
	}
	prior, err := r.FindByIdentity(id)
	if err != nil {
		return nil, err
	}
	snapshot, err := r.readResumePreferences(*identity)
	if err != nil {
		return nil, err
	}
	snapshot.PriorBinding = prior
	return snapshot, nil
}

func (r bindingRows) readResumePreferences(identity core.Identity) (*core.ResumeSnapshot, error) {
	snapshot := &core.ResumeSnapshot{Identity: identity}
	id := identity.ID
	var remembered *core.DriverName
	var mode *core.ResumeRuntimeMode
	var session, document *string
	var channel *bool
	var version *uint16
	var stale, pending *uint64
	err := r.one(`SELECT preferred_harness, remembered_harness, runtime_mode, provider_session_id,
		channel, driver_state_version, driver_state, stale_at_ms, resume_pending_at_ms
		FROM identity_session_preferences WHERE identity_id=?`, id).
		Scan(&snapshot.PreferredDriver, &remembered, &mode, &session, &channel, &version, &document, &stale, &pending)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if snapshot.PreferredDriver != nil && !validResumeToken(string(*snapshot.PreferredDriver)) {
		return nil, errInvalidResumeRow
	}
	if remembered != nil || mode != nil || session != nil {
		if remembered == nil || mode == nil || session == nil || !validResumeToken(string(*remembered)) ||
			!validResumeToken(string(*mode)) || !validStart(*session) {
			return nil, errInvalidResumeRow
		}
		selected := &core.ResumeSession{
			Driver: *remembered, Mode: *mode, ProviderSession: *session, Channel: channel,
			StaleAtMs: stale, PendingAtMs: pending,
		}
		if version != nil || document != nil {
			if version == nil || *version == 0 || document == nil || len(*document) == 0 || len(*document) > 4096 ||
				!utf8.ValidString(*document) || strings.ContainsFunc(*document, unicode.IsControl) {
				return nil, errInvalidResumeRow
			}
			selected.State = &core.ResumeDriverState{Version: *version, JSON: *document}
		}
		snapshot.Selected = selected
	}

	snapshot.Fence, err = r.resumeFence(snapshot)
	return snapshot, err
}

func validResumeToken(value string) bool {
	if len(value) == 0 || len(value) > 64 || value[0] < 'a' || value[0] > 'z' {
		return false
	}
	for _, c := range []byte(value) {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

// Resume reads an identity rather than a binding ID. Reservation and
// activation can replace the binding without invalidating this saved fence.
func (r bindingRows) resumeFence(snapshot *core.ResumeSnapshot) (core.ResumeFence, error) {
	sources := [...]string{
		"SELECT * FROM identity_session_preferences WHERE identity_id=?",
		"SELECT * FROM identity_resume_records WHERE identity_id=? ORDER BY harness",
		"SELECT key,value FROM identity_metadata WHERE identity_id=? AND (key='resume.launch' OR key GLOB 'resume.driver.*') ORDER BY key",
	}
	var values [len(sources)][][]any
	for i, source := range sources {
		rows, err := fingerprintRows(r.records, source, snapshot.Identity.ID)
		if err != nil {
			return core.ResumeFence{}, err
		}
		values[i] = rows
	}
	selected := snapshot.Selected
	for _, row := range values[2] {
		key, keyOK := row[0].(string)
		doc, docOK := row[1].(string)
		if !keyOK || !docOK {
			return core.ResumeFence{}, errInvalidResumeRow
		}
		if key != "resume.launch" && (selected == nil || key != "resume.driver."+string(selected.Driver)) {
			continue
		}
		preset := readResumePreset(doc)
		if preset == nil {
			continue
		}
		if key == "resume.launch" {
			// NOT PORTED (#6938, GO1-17): use readable driver state to
			// refresh the displayed model of an associated preset.
			snapshot.LaunchPreset = preset.projection()
		}
		if selected != nil && preset.matches(*selected) {
			selected.HasMatchingPreset = true
		}
	}
	encoded, err := json.Marshal([]any{"tmt-resume-fence", resumeFenceVersion, values})
	if err != nil {
		return core.ResumeFence{}, err
	}
	return core.ResumeFence{Version: resumeFenceVersion, Digest: sha256.Sum256(encoded)}, nil
}

func (r bindingRows) VerifyResume(expected core.ResumeSnapshot) error {
	current, err := r.ReadResume(expected.Identity.ID)
	if err != nil {
		return err
	}
	if current == nil || current.Identity != expected.Identity ||
		!matchBinding(current.PriorBinding, expected.PriorBinding, false) || current.Fence != expected.Fence {
		return resumeDrift()
	}
	return currentResumeRefusal(current)
}

func (r bindingRows) launchIntentFingerprint(intent ports.LaunchIntent, binding core.Binding) (string, error) {
	if intent.Resume == nil {
		return launchPreferencesFingerprint(r.records, binding.ID)
	}
	if err := r.verifyResumeLaunch(intent); err != nil {
		return "", err
	}
	// A resume intent has a distinct persisted digest. Replaying it as a
	// fresh intent cannot bypass the saved session and preset checks.
	return encodeResumeFence(intent.Resume.Fence), nil
}

func encodeResumeFence(fence core.ResumeFence) string {
	return hex.EncodeToString(fence.Digest[:])
}

func (r bindingRows) matchingResumeObservation(observation ports.LaunchActivityObservation, storedDigest string) (bool, error) {
	identity, err := (identityRows{r.records}).FindByID(observation.Expected.IdentityID)
	if err != nil || identity == nil {
		return false, err
	}
	snapshot, err := r.readResumePreferences(*identity)
	if err != nil {
		return false, err
	}
	selected := snapshot.Selected
	return encodeResumeFence(snapshot.Fence) == storedDigest && selected != nil &&
		selected.Driver == core.DriverClaude && selected.ProviderSession == observation.ProviderSession &&
		currentResumeRefusal(snapshot) == nil, nil
}

func (r bindingRows) verifyResumeLaunch(intent ports.LaunchIntent) error {
	expected := intent.Resume
	identity, err := (identityRows{r.records}).FindByID(intent.Expected.IdentityID)
	if err != nil {
		return err
	}
	if identity == nil || identity.ID != expected.IdentityID || intent.Driver != expected.Driver {
		return resumeDrift()
	}
	current, err := r.readResumePreferences(*identity)
	if err != nil {
		return err
	}
	selected := current.Selected
	if current.Fence != expected.Fence || selected == nil || selected.Driver != expected.Driver ||
		selected.ProviderSession != expected.ProviderSession {
		return resumeDrift()
	}
	return currentResumeRefusal(current)
}

func resumeDrift() *core.RequestFailure {
	return &core.RequestFailure{
		Code: "RUNTIME_CONFLICT", Status: 5, Reason: "resume_drift",
		Message: "The identity changed before resume. No new agent was launched; check the old pane and retry.",
	}
}

func currentResumeRefusal(snapshot *core.ResumeSnapshot) error {
	name, selected := snapshot.Identity.Name, snapshot.Selected
	if selected == nil {
		return &core.RequestFailure{
			Code: "RESUME_UNAVAILABLE", Status: 1, Reason: "no_remembered_session",
			Message: fmt.Sprintf("%s has no remembered session to resume. Start fresh with: tmt run %s", name, name),
		}
	}
	result := core.RequestFailure{Code: "RESUME_UNSUPPORTED", Status: 1}
	switch {
	case selected.StaleAtMs != nil:
		result.Code = "RESUME_UNAVAILABLE"
		result.Reason = "session_stale"
		result.Message = fmt.Sprintf("%s's remembered %s session looked gone when it was last resumed. "+
			"Forget it with: tmt resume --forget %s; try it once more with: tmt resume --retry %s. "+
			"Start fresh from its notes: tmt resume --new -- %s", name, selected.Driver, name, name, resumeCommandWord(string(name)))
	case selected.PendingAtMs != nil:
		result.Code = "RESUME_UNAVAILABLE"
		result.Reason = "session_pending"
		result.Message = "The remembered session has an unconfirmed resume."
	case selected.Channel != nil && *selected.Channel:
		result.Reason = "channel_enrolled"
		result.Message = "The remembered session requires a provider channel."
	case selected.HasMatchingPreset:
		result.Reason = "launch_preset"
		result.Message = "The remembered session requires a saved launch preset."
	case selected.Driver != core.DriverClaude && selected.Driver != core.DriverCodex:
		result.Reason = "unsupported_driver"
		result.Message = fmt.Sprintf("The %s driver cannot resume %s's remembered session. Start fresh with: tmt run %s", selected.Driver, name, name)
	case !supportsResumeMode(*selected):
		result.Reason = "unsupported_mode"
		result.Message = fmt.Sprintf("The %s mode cannot resume %s's remembered session.", selected.Mode, name)
	case !core.ValidUUID(strings.ToLower(selected.ProviderSession)):
		result.Code = "RESUME_UNAVAILABLE"
		result.Reason = "invalid_session"
		result.Message = fmt.Sprintf("%s's remembered %s session is not one its driver can resume. Start fresh with: tmt run %s",
			name, selected.Driver, name)
	default:
		return nil
	}
	return &result
}

func supportsResumeMode(session core.ResumeSession) bool {
	switch session.Driver {
	case core.DriverClaude:
		return session.Mode == "default"
	case core.DriverCodex:
		return session.Mode == "shared" || session.Mode == "embedded"
	default:
		return false
	}
}

func resumeCommandWord(value string) string {
	const safe = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._"
	if value != "" && !strings.ContainsFunc(value, func(c rune) bool { return !strings.ContainsRune(safe, c) }) {
		return value
	}
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}
