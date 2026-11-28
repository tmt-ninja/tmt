-- Keep intent stays on the original exchange. Terminal marks and pins stay on
-- the capture batch and final that already own their lifecycle and text.
ALTER TABLE request_attempts
  ADD COLUMN keep_reply INTEGER NOT NULL DEFAULT 0 CHECK (keep_reply IN (0,1));
ALTER TABLE request_attempts
  ADD COLUMN keep_removed INTEGER NOT NULL DEFAULT 0
    CHECK (keep_removed IN (0,1) AND keep_removed <= keep_reply);
ALTER TABLE request_attempts ADD COLUMN kept_capture_sequence INTEGER;
ALTER TABLE capture_batches
  ADD COLUMN kept_owner_identity_id TEXT REFERENCES identities(id);
ALTER TABLE recent_responses
  ADD COLUMN kept_owner_identity_id TEXT REFERENCES identities(id);
ALTER TABLE recent_responses
  ADD COLUMN ordinary_dropped INTEGER NOT NULL DEFAULT 0 CHECK (ordinary_dropped IN (0,1));

CREATE INDEX request_attempts_kept
  ON request_attempts(originator_identity_id, recipient_identity_id)
  WHERE keep_reply = 1 AND keep_removed = 0;
CREATE INDEX request_attempts_kept_capture
  ON request_attempts(kept_capture_sequence)
  WHERE keep_reply = 1 AND keep_removed = 0 AND kept_capture_sequence IS NOT NULL;
CREATE INDEX capture_batches_keep_pending
  ON capture_batches(kept_owner_identity_id)
  WHERE kept_owner_identity_id IS NOT NULL AND closed_ms IS NULL;
CREATE INDEX recent_responses_kept
  ON recent_responses(kept_owner_identity_id, identity_id)
  WHERE kept_owner_identity_id IS NOT NULL;

DROP TRIGGER request_attempts_advances_change_cursor_on_update;
CREATE TRIGGER request_attempts_advances_change_cursor_on_update AFTER UPDATE ON request_attempts
WHEN OLD.attempt_id IS NOT NEW.attempt_id
   OR OLD.request_id IS NOT NEW.request_id
   OR OLD.nonce IS NOT NEW.nonce
   OR OLD.identity_id IS NOT NEW.identity_id
   OR OLD.route_kind IS NOT NEW.route_kind
   OR OLD.server_id IS NOT NEW.server_id
   OR OLD.socket_path IS NOT NEW.socket_path
   OR OLD.server_pid IS NOT NEW.server_pid
   OR OLD.server_start_time IS NOT NEW.server_start_time
   OR OLD.pane_id IS NOT NEW.pane_id
   OR OLD.pane_pid IS NOT NEW.pane_pid
   OR OLD.wait_active IS NOT NEW.wait_active
   OR OLD.status IS NOT NEW.status
   OR OLD.preamble_every IS NOT NEW.preamble_every
   OR OLD.inject_preamble IS NOT NEW.inject_preamble
   OR OLD.cadence_reserved IS NOT NEW.cadence_reserved
   OR OLD.prepared_at_ms IS NOT NEW.prepared_at_ms
   OR OLD.sending_at_ms IS NOT NEW.sending_at_ms
   OR OLD.settled_at_ms IS NOT NEW.settled_at_ms
   OR OLD.wait_released_at_ms IS NOT NEW.wait_released_at_ms
   OR OLD.expires_at_ms IS NOT NEW.expires_at_ms
   OR OLD.response_submitted_at_ms IS NOT NEW.response_submitted_at_ms
   OR OLD.retention_days IS NOT NEW.retention_days
   OR OLD.retention_expires_at_ms IS NOT NEW.retention_expires_at_ms
   OR OLD.originator_kind IS NOT NEW.originator_kind
   OR OLD.originator_identity_id IS NOT NEW.originator_identity_id
   OR OLD.recipient_identity_id IS NOT NEW.recipient_identity_id
   OR OLD.message_text IS NOT NEW.message_text
   OR OLD.message_bytes IS NOT NEW.message_bytes
   OR OLD.message_expires_at_ms IS NOT NEW.message_expires_at_ms
   OR OLD.attention_revision IS NOT NEW.attention_revision
   OR OLD.attention_acknowledged_revision IS NOT NEW.attention_acknowledged_revision
   OR OLD.recipient_attention_revision IS NOT NEW.recipient_attention_revision
   OR OLD.recipient_attention_acknowledged_revision IS NOT NEW.recipient_attention_acknowledged_revision
   OR OLD.request_kind IS NOT NEW.request_kind
   OR OLD.room_id IS NOT NEW.room_id
   OR OLD.wake_state IS NOT NEW.wake_state
   OR OLD.host IS NOT NEW.host
   OR OLD.withdrawn_at_ms IS NOT NEW.withdrawn_at_ms
   OR OLD.withdrawal_reason IS NOT NEW.withdrawal_reason
   OR OLD.origin IS NOT NEW.origin
   OR OLD.remote_ref IS NOT NEW.remote_ref
   OR OLD.remote_target_id IS NOT NEW.remote_target_id
   OR OLD.remote_target_name IS NOT NEW.remote_target_name
   OR OLD.remote_sender_name IS NOT NEW.remote_sender_name
   OR OLD.thread_root_request_id IS NOT NEW.thread_root_request_id
   OR OLD.keep_reply IS NOT NEW.keep_reply
   OR OLD.keep_removed IS NOT NEW.keep_removed
   OR OLD.kept_capture_sequence IS NOT NEW.kept_capture_sequence
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; INSERT INTO room_request_changes (request_id, room_id, change_seq) SELECT NEW.request_id, NEW.room_id, (SELECT value FROM change_cursor WHERE id = 1) WHERE NEW.room_id IS NOT NULL ON CONFLICT (request_id) DO UPDATE SET room_id = excluded.room_id, change_seq = excluded.change_seq; DELETE FROM room_request_changes WHERE request_id = OLD.request_id AND OLD.request_id IS NOT NEW.request_id; END;

DROP TRIGGER capture_batches_advances_change_cursor_on_update;
CREATE TRIGGER capture_batches_advances_change_cursor_on_update AFTER UPDATE ON capture_batches
WHEN OLD.id IS NOT NEW.id OR OLD.identity_id IS NOT NEW.identity_id OR OLD.binding_id IS NOT NEW.binding_id OR OLD.driver IS NOT NEW.driver OR OLD.session_id IS NOT NEW.session_id OR OLD.runtime_pid IS NOT NEW.runtime_pid OR OLD.runtime_start IS NOT NEW.runtime_start OR OLD.provider_turn IS NOT NEW.provider_turn OR OLD.created_ms IS NOT NEW.created_ms OR OLD.closed_ms IS NOT NEW.closed_ms
   OR OLD.kept_owner_identity_id IS NOT NEW.kept_owner_identity_id
BEGIN UPDATE change_cursor SET value=value+1 WHERE id=1; END;

DROP TRIGGER recent_responses_advances_change_cursor_on_update;
CREATE TRIGGER recent_responses_advances_change_cursor_on_update AFTER UPDATE ON recent_responses
WHEN OLD.sequence IS NOT NEW.sequence OR OLD.identity_id IS NOT NEW.identity_id OR OLD.text IS NOT NEW.text OR OLD.ended_ms IS NOT NEW.ended_ms OR OLD.provider IS NOT NEW.provider OR OLD.truncated IS NOT NEW.truncated OR OLD.session_id IS NOT NEW.session_id OR OLD.expires_ms IS NOT NEW.expires_ms OR OLD.original_bytes IS NOT NEW.original_bytes
   OR OLD.kept_owner_identity_id IS NOT NEW.kept_owner_identity_id
   OR OLD.ordinary_dropped IS NOT NEW.ordinary_dropped
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;
