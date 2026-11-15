-- Measured wake-up turns and the recipient's phase when Digest held a message (#6453).
-- One row per main-session turn that carried at least one handed-over request
-- (`request_turns`), written by the hook transaction that admits its boundaries. At the start
-- it keeps the identity's usage bucket as the start read left it (`baseline`, JSON), so the
-- tokens already in that bucket are not counted; at the end it keeps the measured sum of the
-- identity's fine usage buckets over the turn. `measured` is 1 only when both boundaries
-- carried a usage read and every bucket in between is present, complete, gap-free,
-- continuous and covered; otherwise the sum is partial and never shown as exact. A row whose
-- turn never ended is closed unmeasured by the next turn start. Paged on demand by
-- `digest.wakeTurns`, so it advances no cursor. Kept 30 days after it ended.
CREATE TABLE wake_turns (
  identity_id TEXT NOT NULL REFERENCES identities(id),
  started_ms INTEGER NOT NULL CHECK (typeof(started_ms) = 'integer' AND started_ms BETWEEN 1 AND 9007199254740991),
  ended_ms INTEGER CHECK (ended_ms IS NULL OR (typeof(ended_ms) = 'integer' AND ended_ms BETWEEN started_ms AND 9007199254740991)),
  baseline TEXT CHECK (baseline IS NULL OR length(CAST(baseline AS BLOB)) <= 4096),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR (typeof(input_tokens) = 'integer' AND input_tokens BETWEEN 0 AND 9007199254740991)),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR (typeof(output_tokens) = 'integer' AND output_tokens BETWEEN 0 AND 9007199254740991)),
  cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR (typeof(cached_input_tokens) = 'integer' AND cached_input_tokens BETWEEN 0 AND input_tokens)),
  models TEXT CHECK (models IS NULL OR length(CAST(models AS BLOB)) <= 4096),
  measured INTEGER NOT NULL DEFAULT 0 CHECK (measured IN (0,1)),
  CHECK (ended_ms IS NOT NULL OR measured = 0),
  CHECK ((input_tokens IS NULL) = (output_tokens IS NULL) AND (input_tokens IS NULL) = (cached_input_tokens IS NULL)),
  PRIMARY KEY (identity_id, started_ms)
);
CREATE INDEX wake_turns_by_end ON wake_turns(ended_ms) WHERE ended_ms IS NOT NULL;
-- The recipient's driver activity phase when Digest held the message: `working` means it
-- would have joined a running turn. Null is unknown (no verified driver activity), as are
-- references held before this migration.
ALTER TABLE focus_items ADD COLUMN phase_at_arrival TEXT
  CHECK (phase_at_arrival IS NULL OR phase_at_arrival IN ('working', 'waiting', 'idle'));
DROP TRIGGER focus_items_advances_change_cursor_on_update;
CREATE TRIGGER focus_items_advances_change_cursor_on_update AFTER UPDATE ON focus_items
WHEN OLD.sequence IS NOT NEW.sequence
  OR OLD.identity_id IS NOT NEW.identity_id
  OR OLD.request_id IS NOT NEW.request_id
  OR OLD.kind IS NOT NEW.kind
  OR OLD.source IS NOT NEW.source
  OR OLD.created_at_ms IS NOT NEW.created_at_ms
  OR OLD.checklist_id IS NOT NEW.checklist_id
  OR OLD.context_tokens_at_arrival IS NOT NEW.context_tokens_at_arrival
  OR OLD.context_observed_at_ms IS NOT NEW.context_observed_at_ms
  OR OLD.phase_at_arrival IS NOT NEW.phase_at_arrival
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;
