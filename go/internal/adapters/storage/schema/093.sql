-- Threads and room change positions (#6407, #6375).
-- A reply names its thread root: the request it answers, or that request's own root, so
-- threads stay one level. Existing rows have none. The root ID survives the root's
-- retention; admission alone requires a readable root.
ALTER TABLE request_attempts ADD COLUMN thread_root_request_id TEXT
  CHECK (thread_root_request_id IS NULL OR length(thread_root_request_id) BETWEEN 1 AND 128);
CREATE INDEX request_thread_root ON request_attempts(thread_root_request_id)
  WHERE thread_root_request_id IS NOT NULL;
-- One row per room-scoped request, stamped with the change cursor value its latest write
-- moved to, so `requests.list {roomId, since}` counts only what changed. A marker, not a
-- record: it goes with its request when retention purges it.
CREATE TABLE room_request_changes (
  request_id TEXT PRIMARY KEY CHECK (length(request_id) BETWEEN 1 AND 128),
  room_id TEXT NOT NULL CHECK (length(room_id) BETWEEN 1 AND 64),
  change_seq INTEGER NOT NULL CHECK (typeof(change_seq) = 'integer' AND change_seq >= 1)
);
CREATE INDEX room_request_changes_by_room ON room_request_changes(room_id, change_seq);
-- Changes up to this cursor value carry no stamp; an older position must reset.
CREATE TABLE room_change_floor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL CHECK (typeof(value) = 'integer' AND value >= 0)
);
INSERT INTO room_change_floor (id, value) SELECT 1, value FROM change_cursor WHERE id = 1;
DROP TRIGGER request_attempts_advances_change_cursor_on_insert;
CREATE TRIGGER request_attempts_advances_change_cursor_on_insert AFTER INSERT ON request_attempts
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; INSERT INTO room_request_changes (request_id, room_id, change_seq) SELECT NEW.request_id, NEW.room_id, (SELECT value FROM change_cursor WHERE id = 1) WHERE NEW.room_id IS NOT NULL ON CONFLICT (request_id) DO UPDATE SET room_id = excluded.room_id, change_seq = excluded.change_seq; END;
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
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; INSERT INTO room_request_changes (request_id, room_id, change_seq) SELECT NEW.request_id, NEW.room_id, (SELECT value FROM change_cursor WHERE id = 1) WHERE NEW.room_id IS NOT NULL ON CONFLICT (request_id) DO UPDATE SET room_id = excluded.room_id, change_seq = excluded.change_seq; DELETE FROM room_request_changes WHERE request_id = OLD.request_id AND OLD.request_id IS NOT NEW.request_id; END;
DROP TRIGGER request_attempts_advances_change_cursor_on_delete;
CREATE TRIGGER request_attempts_advances_change_cursor_on_delete AFTER DELETE ON request_attempts
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; DELETE FROM room_request_changes WHERE request_id = OLD.request_id; END;
DROP TRIGGER request_responses_advances_change_cursor_on_insert;
CREATE TRIGGER request_responses_advances_change_cursor_on_insert AFTER INSERT ON request_responses
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; INSERT INTO room_request_changes (request_id, room_id, change_seq) SELECT NEW.request_id, (SELECT room_id FROM request_attempts WHERE request_id = NEW.request_id), (SELECT value FROM change_cursor WHERE id = 1) WHERE (SELECT room_id FROM request_attempts WHERE request_id = NEW.request_id) IS NOT NULL ON CONFLICT (request_id) DO UPDATE SET room_id = excluded.room_id, change_seq = excluded.change_seq; END;
DROP TRIGGER request_responses_advances_change_cursor_on_update;
CREATE TRIGGER request_responses_advances_change_cursor_on_update AFTER UPDATE ON request_responses
WHEN OLD.request_id IS NOT NEW.request_id
   OR OLD.attempt_id IS NOT NEW.attempt_id
   OR OLD.route_kind IS NOT NEW.route_kind
   OR OLD.route_recipient_identity_id IS NOT NEW.route_recipient_identity_id
   OR OLD.server_id IS NOT NEW.server_id
   OR OLD.socket_path IS NOT NEW.socket_path
   OR OLD.server_pid IS NOT NEW.server_pid
   OR OLD.server_start_time IS NOT NEW.server_start_time
   OR OLD.pane_id IS NOT NEW.pane_id
   OR OLD.pane_pid IS NOT NEW.pane_pid
   OR OLD.body IS NOT NEW.body
   OR OLD.body_bytes IS NOT NEW.body_bytes
   OR OLD.submitted_at_ms IS NOT NEW.submitted_at_ms
   OR OLD.response_expires_at_ms IS NOT NEW.response_expires_at_ms
   OR OLD.host IS NOT NEW.host
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; INSERT INTO room_request_changes (request_id, room_id, change_seq) SELECT NEW.request_id, (SELECT room_id FROM request_attempts WHERE request_id = NEW.request_id), (SELECT value FROM change_cursor WHERE id = 1) WHERE (SELECT room_id FROM request_attempts WHERE request_id = NEW.request_id) IS NOT NULL ON CONFLICT (request_id) DO UPDATE SET room_id = excluded.room_id, change_seq = excluded.change_seq; END;
DROP TRIGGER request_responses_advances_change_cursor_on_delete;
CREATE TRIGGER request_responses_advances_change_cursor_on_delete AFTER DELETE ON request_responses
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; INSERT INTO room_request_changes (request_id, room_id, change_seq) SELECT OLD.request_id, (SELECT room_id FROM request_attempts WHERE request_id = OLD.request_id), (SELECT value FROM change_cursor WHERE id = 1) WHERE (SELECT room_id FROM request_attempts WHERE request_id = OLD.request_id) IS NOT NULL ON CONFLICT (request_id) DO UPDATE SET room_id = excluded.room_id, change_seq = excluded.change_seq; END;
