package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"time"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// OpenExistingCapture opens an exact-schema store for bounded hook commits.
// An absent database is a silent no-op and returns a nil store.
func OpenExistingCapture(ctx context.Context, root home.Root, wait time.Duration) (*Storage, error) {
	if !filepath.IsAbs(root.Dir) || filepath.Clean(root.Database) != filepath.Join(root.Dir, home.DatabaseName) {
		return nil, errors.New("invalid capture database path")
	}
	if wait < 0 || wait > 30*time.Second {
		return nil, errors.New("invalid capture writer wait")
	}
	present, err := existingCaptureDatabase(root.Database)
	if err != nil || !present {
		return nil, err
	}
	params := url.Values{"mode": {"rw"}, "_txlock": {"immediate"},
		"_pragma": {fmt.Sprintf("busy_timeout(%d)", wait.Milliseconds()), "foreign_keys(ON)"}}
	dsn := url.URL{Scheme: "file", Path: root.Database, RawQuery: params.Encode()}
	db, err := sql.Open("sqlite", dsn.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	store := &Storage{db: db, path: root.Database, skipCheckpoint: true}
	if err := store.transact(ctx, true, func(r records) error { return requireCaptureSchema(r.ctx, r.tx) }); err != nil {
		return nil, errors.Join(err, store.Close())
	}
	return store, nil
}

func existingCaptureDatabase(path string) (bool, error) {
	file, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !file.Mode().IsRegular() {
		return false, errors.New("capture database is not a regular file")
	}
	// NOT PORTED (#6938, GO1-06): the public SQLite driver cannot atomically
	// open with NOFOLLOW. Recheck routing at each independent open.
	return true, nil
}

func requireCaptureSchema(ctx context.Context, tx *sql.Tx) error {
	if err := validateHistoryTable(ctx, tx); err != nil {
		return err
	}
	version, err := validateHistory(ctx, tx)
	if err != nil {
		return err
	}
	if version != SchemaVersion {
		return fmt.Errorf("capture requires schema version %d, found %d", SchemaVersion, version)
	}
	return nil
}

// PrepareHookCapture mirrors native hook_queue/capture.rs::prepare: read the
// exact binding and session, preceding activity, and current batch in one
// zero-wait snapshot. Neither a batch nor a receipt is written until commit.
func (s *Storage) PrepareHookCapture(ctx context.Context, p ports.HookCapturePreparation) (*core.HookCaptureEvent, error) {
	present, err := existingCaptureDatabase(s.path)
	if err != nil || !present {
		return nil, err
	}
	params := url.Values{"mode": {"ro"}, "_pragma": {"busy_timeout(0)"}}
	dsn := url.URL{Scheme: "file", Path: s.path, RawQuery: params.Encode()}
	var event *core.HookCaptureEvent
	err = readOnlySQLiteSnapshot(ctx, dsn.String(), func(tx *sql.Tx) error {
		if err := requireCaptureSchema(ctx, tx); err != nil {
			return err
		}
		var err error
		event, err = prepareCaptureEvent(records{ctx: ctx, tx: tx, readOnly: true}, p)
		return err
	})
	if err != nil {
		return nil, err
	}
	return event, nil
}

func prepareCaptureEvent(r records, p ports.HookCapturePreparation) (*core.HookCaptureEvent, error) {
	binding, err := r.Bindings().FindByIdentity(p.Expected.IdentityID)
	if err != nil || binding == nil {
		return nil, err
	}
	session := binding.Session
	if !matchBinding(binding, &p.Expected, false) || session.RuntimeState != "running" ||
		session.LaunchOwner == nil || *session.LaunchOwner != p.Owner ||
		session.Runtime == nil || *session.Runtime != p.Runtime ||
		session.ProviderSessionID == nil || *session.ProviderSessionID != p.ProviderSession {
		return nil, nil
	}
	var remembered, providerSession *string
	var document *string
	var version *uint16
	err = r.one(`SELECT remembered_harness,provider_session_id,driver_state,driver_state_version
		FROM identity_session_preferences WHERE identity_id=?`, binding.IdentityID).
		Scan(&remembered, &providerSession, &document, &version)
	if isNoRows(err) || err == nil && (remembered == nil || providerSession == nil ||
		*remembered != string(p.Driver) || *providerSession != p.ProviderSession) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var activity *launchActivity
	if document != nil && version != nil {
		if state := readDriverState(&core.ResumeDriverState{Version: *version, JSON: *document}); state != nil {
			activity = state.activity
		}
	}
	var batch *string
	err = r.one("SELECT id FROM capture_batches WHERE identity_id=? AND closed_ms IS NULL", binding.IdentityID).Scan(&batch)
	if err != nil && !isNoRows(err) {
		return nil, err
	}
	admitted := captureAdmission(activity, p, batch != nil)
	provisional := batch == nil && admitted == core.HookCaptureCommitted
	if provisional {
		id, err := newStorageUUID()
		if err != nil {
			return nil, err
		}
		batch = &id
	}
	fingerprint, err := captureBindingFingerprint(r, binding.IdentityID)
	if err != nil {
		return nil, err
	}
	id, err := newStorageUUID()
	if err != nil {
		return nil, err
	}
	followUp := p.FollowUp
	if !followUp.Usage || followUp.Transcript != nil && (!utf8.ValidString(*followUp.Transcript) || len(*followUp.Transcript) > 4096) {
		followUp.Usage, followUp.Transcript = false, nil
	}
	event := core.HookCaptureEvent{Version: 1, ID: core.HookEventID(id), FollowUp: followUp,
		Capture: &core.HookPendingCapture{
			Identity: binding.IdentityID, Binding: binding.ID, BindingFingerprint: fingerprint, Batch: batch, Provisional: provisional,
			Provider: string(p.Driver), Session: p.ProviderSession, PID: p.Runtime.PID, Start: p.Runtime.StartIdentity,
			Turn: p.Turn, Model: p.Model, Continuation: p.Continuation, Interrupted: p.Interrupted,
			Response: p.Final, NowMs: p.ObservedAtMs, Admitted: admitted,
		}}
	if !event.Valid() {
		return nil, errors.New("invalid hook capture preparation")
	}
	return &event, nil
}

func captureAdmission(activity *launchActivity, p ports.HookCapturePreparation, hasBatch bool) core.HookCaptureOutcome {
	sameTurn := activity != nil && activity.Session == p.ProviderSession && activity.PID == p.Runtime.PID &&
		activity.Start == p.Runtime.StartIdentity && equalOptionalText(activity.Turn, p.Turn)
	if sameTurn && p.ObservedAtMs >= activity.LastActivityMs {
		if activity.State != "idle" || p.Continuation && p.ObservedAtMs > activity.LastActivityMs {
			return core.HookCaptureCommitted
		}
		if !p.Continuation {
			if p.Final != nil && !p.Interrupted && hasBatch {
				return core.HookCaptureCommitted
			}
			return core.HookCaptureDuplicate
		}
	}
	if !sameTurn && !p.Interrupted {
		return core.HookCaptureNoAdmittedStart
	}
	return core.HookCaptureNotApplicable
}

func newStorageUUID() (string, error) {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", err
	}
	id[6] = (id[6] & 0x0f) | 0x40
	id[8] = (id[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", id[:4], id[4:6], id[6:8], id[8:10], id[10:]), nil
}
