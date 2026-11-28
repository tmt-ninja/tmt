package storage

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	jsonv2 "encoding/json/v2"
	"errors"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func (r bindingRows) ObserveLaunchActivity(observation ports.LaunchActivityObservation) (bool, error) {
	if !validLaunchObservation(observation) {
		return false, nil
	}
	current, err := r.FindByIdentity(observation.Expected.IdentityID)
	if err != nil || !matchBinding(current, &observation.Expected, false) {
		return false, err
	}
	switch current.Session.RuntimeState {
	case "running":
		session := current.Session
		if session.Runtime == nil || *session.Runtime != observation.Runtime ||
			session.LaunchOwner == nil || *session.LaunchOwner != observation.Owner || session.PlainProgram != nil {
			return false, nil
		}
		if session.ProviderSessionID == nil {
			return r.adoptLateLaunchSession(observation)
		}
		if *session.ProviderSessionID != observation.ProviderSession {
			return false, nil
		}
		return r.observeAdmitted(observation)
	case "unknown", "ended":
		return r.stageLaunchActivity(observation)
	default:
		return false, nil
	}
}

func validLaunchObservation(observation ports.LaunchActivityObservation) bool {
	return safeTime(observation.ObservedAtMs) && safeTime(observation.Owner.PID) && validStart(observation.Owner.StartIdentity) &&
		safeTime(observation.Runtime.PID) && validStart(observation.Runtime.StartIdentity) &&
		validStart(observation.ProviderSession) &&
		(observation.Transition == core.LaunchTransitionStarted || observation.Transition == core.LaunchTransitionResumed)
}

func (r bindingRows) stageLaunchActivity(observation ports.LaunchActivityObservation) (bool, error) {
	binding, owner, now := observation.Expected.ID, observation.Owner, observation.ObservedAtMs
	var storedDigest string
	err := r.one(`SELECT preferences_fingerprint FROM launch_observations
		WHERE binding_id = ?1 AND owner_pid = ?2 AND owner_start = ?3 AND driver = ?4 AND status = 'intent'
			AND created_at_ms <= ?5 AND expires_at_ms > ?5`, binding, owner.PID, owner.StartIdentity, core.DriverClaude, now).
		Scan(&storedDigest)
	if isNoRows(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	matches, err := r.launchObservationMatchesPreferences(observation, storedDigest)
	if err != nil || !matches {
		return false, err
	}
	encoded, version, err := initialActivityDocument(make(map[string]json.RawMessage), observation)
	if err != nil {
		return false, err
	}
	return affectedOne(r.exec(`UPDATE launch_observations SET status = 'pending', provider_pid = ?1,
		provider_start = ?2, provider_session = ?3, runtime_mode = 'default', observed_at_ms = ?4,
		provider_transition = ?5, driver_state = ?6, driver_state_version = ?7, step = NULL, reason = NULL, detail = NULL
		WHERE binding_id = ?8 AND owner_pid = ?9 AND owner_start = ?10 AND driver = ?11 AND status = 'intent'
			AND preferences_fingerprint = ?12 AND created_at_ms <= ?4 AND expires_at_ms > ?4`,
		observation.Runtime.PID, observation.Runtime.StartIdentity, observation.ProviderSession, now,
		observation.Transition, encoded, version, binding, owner.PID, owner.StartIdentity, core.DriverClaude, storedDigest))
}

func (r bindingRows) launchObservationMatchesPreferences(observation ports.LaunchActivityObservation, storedDigest string) (bool, error) {
	digest, err := launchPreferencesFingerprint(r.records, observation.Expected.ID)
	if err != nil || digest == storedDigest {
		return err == nil, err
	}
	return r.matchingResumeObservation(observation, storedDigest)
}

// Like native continue_awaiting_session, adoption is restricted to the
// exact launch-owned process and the same preferences under the writer.
func (r bindingRows) adoptLateLaunchSession(observation ports.LaunchActivityObservation) (bool, error) {
	binding, owner, now := observation.Expected, observation.Owner, observation.ObservedAtMs
	stored, err := r.findLaunchIntent(ports.LaunchIntent{Expected: binding, Owner: owner})
	if err != nil || stored == nil || stored.driver != core.DriverClaude || stored.status != "admitted" ||
		now < stored.starts || now >= stored.expires {
		return false, err
	}
	matches, err := r.launchObservationMatchesPreferences(observation, stored.digest)
	if err != nil || !matches {
		return false, err
	}

	// Native remember carries state forward within the same driver.
	var old *string
	var version *uint16
	err = r.one(`SELECT driver_state, driver_state_version FROM identity_session_preferences
		WHERE identity_id=? AND remembered_harness=?`, binding.IdentityID, core.DriverClaude).Scan(&old, &version)
	if err != nil && !isNoRows(err) {
		return false, err
	}
	document, previous, valid := loadActivityDocument(old, version)
	if !valid || previous != nil && previous.LastActivityMs > now {
		return false, nil
	}
	encoded, next, err := initialActivityDocument(document, observation)
	if err != nil {
		return false, err
	}
	changed, err := affectedOne(r.exec(`UPDATE bindings SET observed_provider_session_id=?1, last_transition=?2
		WHERE id=?3 AND identity_id=?4 AND observed_provider_session_id IS NULL`,
		observation.ProviderSession, observation.Transition, binding.ID, binding.IdentityID))
	if err != nil || !changed {
		return false, err
	}
	mode := "default"
	stored.mode, stored.session, stored.driverState, stored.version = &mode, &observation.ProviderSession, &encoded, &next
	err = r.rememberLaunch(binding.IdentityID, core.DriverClaude, *stored)
	return err == nil, err
}

// The fingerprint matches the native ordered JSON arrays of stored preference
// and resume rows. Include inactive harnesses and NULL values in the fence.
func launchPreferencesFingerprint(r records, binding core.BindingID) (string, error) {
	sources := [...]string{
		"SELECT p.* FROM identity_session_preferences p JOIN bindings b ON b.identity_id = p.identity_id WHERE b.id = ?",
		"SELECT r.* FROM identity_resume_records r JOIN bindings b ON b.identity_id = r.identity_id WHERE b.id = ? ORDER BY r.harness",
	}
	values := make([][][]any, 0, len(sources))
	for _, source := range sources {
		rows, err := fingerprintRows(r, source, binding)
		if err != nil {
			return "", err
		}
		values = append(values, rows)
	}
	encoded, err := jsonv2.Marshal(values)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}

func fingerprintRows(r records, query string, id any) ([][]any, error) {
	rows, err := r.query(query, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	result := [][]any{}
	for rows.Next() {
		row, destinations := make([]any, len(columns)), make([]any, len(columns))
		for i := range row {
			destinations[i] = &row[i]
		}
		if err := rows.Scan(destinations...); err != nil {
			return nil, err
		}
		for _, value := range row {
			switch value.(type) {
			case nil, string, int64:
			default:
				return nil, errors.New("invalid stored launch preference value")
			}
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

type launchActivity struct {
	Session        string  `json:"session"`
	PID            uint64  `json:"pid"`
	Start          string  `json:"start"`
	State          string  `json:"state"`
	Turn           *string `json:"turn"`
	SinceMs        uint64  `json:"sinceMs"`
	LastActivityMs uint64  `json:"lastActivityMs"`
}

func initialActivityDocument(document map[string]json.RawMessage, observation ports.LaunchActivityObservation) (string, uint16, error) {
	runtime, session := observation.Runtime, observation.ProviderSession
	if observation.InitialIdle {
		return activityDocument(document, launchActivity{
			Session: session, PID: runtime.PID, Start: runtime.StartIdentity, State: "idle",
			SinceMs: observation.ObservedAtMs, LastActivityMs: observation.ObservedAtMs,
		})
	}
	return storeLaunchActivity(document, "noStartupIdle", 6, struct {
		Session string `json:"session"`
		PID     uint64 `json:"pid"`
		Start   string `json:"start"`
	}{session, runtime.PID, runtime.StartIdentity})
}

func activityDocument(document map[string]json.RawMessage, activity launchActivity) (string, uint16, error) {
	delete(document, "noStartupIdle")
	version := uint16(3)
	if document["observed"] != nil {
		version = 5
	} else if document["consumption"] != nil {
		version = 4
	}
	return storeLaunchActivity(document, "activity", version, activity)
}

func storeLaunchActivity(document map[string]json.RawMessage, field string, version uint16, data any) (string, uint16, error) {
	encoded, err := json.Marshal(data)
	if err != nil {
		return "", 0, err
	}
	document[field] = encoded
	encoded, err = json.Marshal(document)
	if err != nil {
		return "", 0, err
	}
	if len(encoded) > 4096 {
		return "", 0, errors.New("launch activity exceeds the driver state limit")
	}
	return string(encoded), version, nil
}

func loadActivityDocument(raw *string, version *uint16) (map[string]json.RawMessage, *launchActivity, bool) {
	document := make(map[string]json.RawMessage)
	if raw == nil {
		return document, nil, true
	}
	if version == nil || *version < 1 || *version > 6 ||
		json.Unmarshal([]byte(*raw), &document) != nil || document == nil {
		return nil, nil, false
	}
	activity := document["activity"]
	if activity == nil {
		return document, nil, true
	}
	var previous launchActivity
	if json.Unmarshal(activity, &previous) != nil {
		return nil, nil, false
	}
	return document, &previous, true
}

func (r bindingRows) observeAdmitted(observation ports.LaunchActivityObservation) (bool, error) {
	var old *string
	var version *uint16
	err := r.one(`SELECT driver_state, driver_state_version FROM identity_session_preferences
		WHERE identity_id = ? AND remembered_harness = ? AND provider_session_id = ?`,
		observation.Expected.IdentityID, core.DriverClaude, observation.ProviderSession).Scan(&old, &version)
	if isNoRows(err) {
		return false, nil
	}
	if err != nil || !observation.InitialIdle {
		return err == nil, err
	}
	document, previous, valid := loadActivityDocument(old, version)
	if !valid {
		return false, nil
	}
	if previous != nil && ((previous.PID == observation.Runtime.PID && previous.Start == observation.Runtime.StartIdentity) ||
		previous.LastActivityMs >= observation.ObservedAtMs) {
		// Existing matching activity outranks a replay of startup.
		return true, nil
	}
	encoded, next, err := initialActivityDocument(document, observation)
	if err != nil {
		return false, err
	}
	return affectedOne(r.exec(`UPDATE identity_session_preferences SET driver_state = ?1, driver_state_version = ?2
		WHERE identity_id = ?3 AND remembered_harness = ?4 AND provider_session_id = ?5
			AND driver_state IS ?6 AND driver_state_version IS ?7`,
		encoded, next, observation.Expected.IdentityID, core.DriverClaude, observation.ProviderSession, old, version))
}
