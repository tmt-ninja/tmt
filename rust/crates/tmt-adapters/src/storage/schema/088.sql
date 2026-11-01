-- One ordered seek per direction of a two-party conversation (#5862): the person's DM read and its
-- counts no longer scan every request that has no room.
CREATE INDEX request_history_pair ON request_attempts
  (recipient_identity_id, originator_identity_id, prepared_at_ms DESC, request_id DESC)
  WHERE room_id IS NULL;
