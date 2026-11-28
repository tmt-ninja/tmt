package storage

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

var _ ports.CaptureStore = (*Storage)(nil)

const nativeCaptureBindingColumns = `b.id,b.identity_id,b.pane_id,b.server_id,b.socket_path,
	b.server_pid,b.server_start_time,b.pane_pid,b.runtime_state,b.last_transition,
	b.runtime_pid,b.runtime_start_identity,b.observed_provider_session_id,b.launch_owner_pid,
	b.launch_owner_start_identity,b.transport,b.pane_incarnation,b.runtime_start_refusal,b.plain_program`

func readHookReceipt(r records, id core.HookEventID) (*core.HookCaptureReceipt, error) {
	receipt := core.HookCaptureReceipt{EventID: id}
	err := r.one("SELECT identity_id,batch_id,outcome,committed_ms FROM hook_capture_receipts WHERE event_id=?", id).
		Scan(&receipt.IdentityID, &receipt.BatchID, &receipt.Outcome, &receipt.CommittedAtMs)
	return optional(&receipt, err)
}

func (s *Storage) CommitCapture(ctx context.Context, event core.HookCaptureEvent) (core.HookCaptureReceipt, error) {
	if !event.Valid() {
		return core.HookCaptureReceipt{}, errors.New("invalid hook capture event")
	}
	var receipt *core.HookCaptureReceipt
	err := s.transact(ctx, true, func(r records) error {
		var err error
		receipt, err = readHookReceipt(r, event.ID)
		return err
	})
	if err == nil && receipt == nil {
		err = s.transact(ctx, false, func(r records) error {
			var err error
			receipt, err = readHookReceipt(r, event.ID)
			if err != nil || receipt != nil {
				return err
			}
			next := core.HookCaptureReceipt{EventID: event.ID, IdentityID: event.Identity(),
				Outcome: core.HookCaptureNotApplicable, CommittedAtMs: uint64(time.Now().UnixMilli())}
			if c := event.Capture; c != nil {
				next.BatchID = c.Batch
				next.Outcome, err = commitHookFinal(r, c, event.FollowUp.Usage, next.CommittedAtMs)
				if err != nil {
					return err
				}
			}
			_, err = r.exec("INSERT INTO hook_capture_receipts(event_id,identity_id,batch_id,outcome,committed_ms) VALUES(?,?,?,?,?)",
				next.EventID, next.IdentityID, next.BatchID, next.Outcome, next.CommittedAtMs)
			receipt = &next
			return err
		})
	}
	if err != nil {
		return core.HookCaptureReceipt{}, err
	}
	return *receipt, nil
}

func commitHookFinal(r records, c *core.HookPendingCapture, usage bool, now uint64) (core.HookCaptureOutcome, error) {
	identity, err := r.Identities().FindByID(c.Identity)
	if err != nil {
		return "", err
	}
	if identity == nil {
		return core.HookCaptureRetiredIdentity, nil
	}

	var currentBatch *string
	err = r.one("SELECT id FROM capture_batches WHERE identity_id=? AND closed_ms IS NULL", c.Identity).Scan(&currentBatch)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	current, err := currentCapture(r, c, currentBatch)
	if err != nil {
		return "", err
	}

	if c.Batch == nil && c.Admitted != core.HookCaptureCommitted {
		return c.Admitted, recordHookFailure(r, c, current, false)
	}

	// A recorded batch is historical authority only for its own binding and process.
	var batchExists bool
	err = r.one(`SELECT EXISTS(SELECT 1 FROM capture_batches WHERE id=? AND identity_id=? AND binding_id=?
		AND driver=? AND session_id=? AND runtime_pid=? AND runtime_start=? AND provider_turn IS ?)`,
		c.Batch, c.Identity, c.Binding, c.Provider, c.Session, c.PID, c.Start, c.Turn).Scan(&batchExists)
	if err != nil {
		return "", err
	}
	if !batchExists {
		if !c.Provisional {
			return core.HookCaptureMissingBatch, nil
		}
		var closed *uint64
		if !current {
			closed = &c.NowMs
		}
		_, err = r.exec(`INSERT INTO capture_batches(id,identity_id,binding_id,driver,session_id,runtime_pid,runtime_start,provider_turn,created_ms,closed_ms)
			VALUES(?,?,?,?,?,?,?,?,?,?)`, c.Batch, c.Identity, c.Binding, c.Provider, c.Session, c.PID, c.Start, c.Turn, c.NowMs, closed)
		if err != nil {
			return "", err
		}
	}
	duplicate, err := sameHookFinal(r, c, now)
	if err != nil {
		return "", err
	}
	if c.Admitted != core.HookCaptureCommitted {
		return c.Admitted, recordHookFailure(r, c, current, duplicate)
	}
	if duplicate && !c.Continuation {
		return core.HookCaptureDuplicate, nil
	}
	var sequence uint64
	if c.Response != nil && !c.Interrupted {
		sequence, err = appendHookFinal(r, c)
		if err != nil {
			return "", err
		}
	}
	if current {
		if err := settleCurrentCapture(r, c, usage, sequence, now); err != nil {
			return "", err
		}
	}
	return core.HookCaptureCommitted, nil
}

func currentCapture(r records, c *core.HookPendingCapture, batch *string) (bool, error) {
	if !equalOptionalText(batch, c.Batch) && !(c.Provisional && batch == nil) {
		return false, nil
	}
	b, err := r.Bindings().FindByIdentity(c.Identity)
	if err != nil || b == nil {
		return false, err
	}
	s := b.Session
	if b.ID != c.Binding || s.RuntimeState != "running" || s.Runtime == nil || s.Runtime.PID != c.PID ||
		s.Runtime.StartIdentity != c.Start || s.ProviderSessionID == nil || *s.ProviderSessionID != c.Session {
		return false, nil
	}
	var encoded string
	if err := r.one("SELECT json_array("+nativeCaptureBindingColumns+") FROM bindings b WHERE b.identity_id=?", c.Identity).Scan(&encoded); err != nil {
		return false, err
	}
	digest := sha256.Sum256([]byte(encoded))
	return hex.EncodeToString(digest[:]) == c.BindingFingerprint, nil
}

func equalOptionalText(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func sameHookFinal(r records, c *core.HookPendingCapture, now uint64) (bool, error) {
	if c.Batch == nil || c.Response == nil || c.Response.OriginalBytes != uint64(len(c.Response.Text)) {
		return false, nil
	}
	var found bool
	err := r.one(`SELECT EXISTS(SELECT 1 FROM capture_entries e JOIN recent_responses f ON f.sequence=e.response_sequence
		WHERE e.batch_id=? AND e.kind='final' AND f.ordinary_dropped=0 AND f.truncated=0
		  AND f.text=? AND f.original_bytes=? AND f.expires_ms>?)`, c.Batch, c.Response.Text, c.Response.OriginalBytes, now).Scan(&found)
	return found, err
}

func recordHookFailure(r records, c *core.HookPendingCapture, current, duplicate bool) error {
	if (c.Admitted != core.HookCaptureNotApplicable && c.Admitted != core.HookCaptureNoAdmittedStart) ||
		c.Interrupted || c.Response == nil || duplicate {
		return nil
	}
	if c.Batch == nil && !current {
		return nil
	}
	if c.Batch != nil {
		var attributable bool
		if err := r.one("SELECT EXISTS(SELECT 1 FROM bindings WHERE identity_id=? AND id=?)", c.Identity, c.Binding).Scan(&attributable); err != nil || !attributable {
			return err
		}
	}
	_, err := r.exec("INSERT INTO capture_entries(identity_id,batch_id,kind,failure,created_ms) VALUES(?,?,'failure','worker_error',?)",
		c.Identity, c.Batch, c.NowMs)
	return err
}

func appendHookFinal(r records, c *core.HookPendingCapture) (uint64, error) {
	expires, ok := core.RetentionDeadline(c.NowMs, 7)
	if !ok {
		return 0, errors.New("invalid final retention time")
	}
	response := c.Response
	var sequence uint64
	err := r.one(`INSERT INTO recent_responses(identity_id,text,ended_ms,provider,truncated,session_id,expires_ms,original_bytes,kept_owner_identity_id)
		VALUES(?,?,?,?,?,?,?,?,(SELECT kept_owner_identity_id FROM capture_batches WHERE id=? AND closed_ms IS NULL)) RETURNING sequence`,
		c.Identity, response.Text, c.NowMs, c.Provider, response.OriginalBytes > uint64(len(response.Text)), c.Session, expires, response.OriginalBytes, c.Batch).Scan(&sequence)
	if err != nil {
		return 0, err
	}
	if _, err := r.exec("INSERT INTO capture_entries(identity_id,batch_id,kind,response_sequence,created_ms) VALUES(?,?,'final',?,?)",
		c.Identity, c.Batch, sequence, c.NowMs); err != nil {
		return 0, err
	}
	_, err = r.exec("UPDATE capture_batches SET kept_owner_identity_id=NULL WHERE id=? AND closed_ms IS NULL AND kept_owner_identity_id IS NOT NULL", c.Batch)
	if err != nil {
		return 0, err
	}
	return sequence, pruneHookResponses(r, c.Identity, c.NowMs)
}

func settleCurrentCapture(r records, c *core.HookPendingCapture, usage bool, sequence, now uint64) error {
	admitted, err := recordCaptureIdle(r, c)
	if err != nil || !admitted {
		return err
	}
	if c.Continuation {
		if _, err := r.exec(`UPDATE focus_checklists SET confirmed_at_ms=?2 WHERE identity_id=?1 AND projection='full'
			AND opportunity='turn_boundary' AND state IN ('delivered','uncertain') AND confirmed_at_ms IS NULL`, c.Identity, c.NowMs); err != nil {
			return err
		}
	}
	if _, err := r.exec(`UPDATE request_turns SET ended_ms=MAX(?2,started_ms) WHERE ended_ms IS NULL
		AND request_id IN (SELECT request_id FROM request_attempts WHERE recipient_identity_id=?1)`, c.Identity, c.NowMs); err != nil {
		return err
	}
	if err := settleHookPassthrough(r, c, sequence, now); err != nil {
		return err
	}
	// NOT PORTED (#6938, GO1-12): partial usage totals for unmeasured wake turns await UsageStore.
	if !usage || c.Interrupted {
		if _, err := r.exec(`UPDATE wake_turns SET ended_ms=?2 WHERE identity_id=?1 AND started_ms=(
			SELECT started_ms FROM wake_turns WHERE identity_id=?1 AND ended_ms IS NULL AND started_ms<=?2 ORDER BY started_ms DESC LIMIT 1)`, c.Identity, c.NowMs); err != nil {
			return err
		}
	}
	if c.Response == nil || c.Interrupted {
		if _, err := r.exec("UPDATE capture_batches SET kept_owner_identity_id=NULL WHERE id=? AND kept_owner_identity_id IS NOT NULL", c.Batch); err != nil {
			return err
		}
	}
	if c.Interrupted {
		_, err = r.exec("UPDATE capture_batches SET closed_ms=MAX(created_ms,?) WHERE id=? AND closed_ms IS NULL", c.NowMs, c.Batch)
	}
	return err
}

func recordCaptureIdle(r records, c *core.HookPendingCapture) (bool, error) {
	var state *string
	var version *uint16
	err := r.one("SELECT driver_state,driver_state_version FROM identity_session_preferences WHERE identity_id=? AND remembered_harness=? AND provider_session_id=?",
		c.Identity, c.Provider, c.Session).Scan(&state, &version)
	if errors.Is(err, sql.ErrNoRows) || err == nil && (state == nil || version == nil) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal([]byte(*state), &document); err != nil {
		return false, err
	}
	if len(document["activity"]) == 0 {
		return false, nil
	}
	var activity launchActivity
	if err := json.Unmarshal(document["activity"], &activity); err != nil {
		return false, err
	}
	if !safeTime(c.NowMs) || activity.PID != c.PID || activity.Start != c.Start || activity.Session != c.Session ||
		!equalOptionalText(activity.Turn, c.Turn) || c.NowMs < activity.LastActivityMs ||
		(activity.State == "idle" && (!c.Continuation || c.NowMs <= activity.LastActivityMs)) {
		return false, nil
	}
	activity.State, activity.SinceMs, activity.LastActivityMs = "idle", c.NowMs, c.NowMs
	encoded, err := json.Marshal(activity)
	if err != nil {
		return false, err
	}
	document["activity"] = encoded
	delete(document, "noStartupIdle")
	if c.Model != nil && validHookModel(*c.Model) {
		encoded, err = json.Marshal(struct {
			Model        string `json:"model"`
			ObservedAtMs uint64 `json:"observedAtMs"`
		}{*c.Model, c.NowMs})
		if err != nil {
			return false, err
		}
		document["observed"] = encoded
		*version = max(*version, 5)
	}
	encoded, err = json.Marshal(document)
	if err != nil {
		return false, err
	}
	_, err = r.exec("UPDATE identity_session_preferences SET driver_state=?,driver_state_version=? WHERE identity_id=?", string(encoded), *version, c.Identity)
	return err == nil, err
}

func validHookModel(model string) bool {
	if model == "" || len(model) > 128 || model[0] == '-' {
		return false
	}
	for _, ch := range model {
		if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || strings.ContainsRune("-._:/[]@", ch)) {
			return false
		}
	}
	return true
}
