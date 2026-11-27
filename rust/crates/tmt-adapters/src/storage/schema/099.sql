-- Widen the opaque driver_state cap from 1024 to 4096 bytes (#5307) across
-- remembered preferences, retained resume records, and launch observations,
-- preserving every stored row, constraint, index, and change-cursor trigger.

CREATE TABLE identity_session_preferences_v99 (
  identity_id TEXT NOT NULL PRIMARY KEY REFERENCES identities(id) ON DELETE CASCADE,
  preferred_harness TEXT,
  remembered_harness TEXT,
  runtime_mode TEXT,
  provider_session_id TEXT,
  driver_state TEXT
    CHECK (driver_state IS NULL OR (typeof(driver_state) = 'text'
      AND length(CAST(driver_state AS BLOB)) BETWEEN 1 AND 4096)),
  driver_state_version INTEGER
    CHECK (driver_state_version IS NULL OR (typeof(driver_state_version) = 'integer'
      AND driver_state_version BETWEEN 1 AND 65535))
    CHECK ((driver_state IS NULL) = (driver_state_version IS NULL))
    CHECK (driver_state IS NULL OR remembered_harness IS NOT NULL),
  stale_at_ms INTEGER
    CHECK (stale_at_ms IS NULL OR (typeof(stale_at_ms) = 'integer'
      AND stale_at_ms BETWEEN 0 AND 9007199254740991 AND remembered_harness IS NOT NULL)),
  resume_pending_at_ms INTEGER
    CHECK (resume_pending_at_ms IS NULL OR (typeof(resume_pending_at_ms) = 'integer'
      AND resume_pending_at_ms BETWEEN 0 AND 9007199254740991 AND remembered_harness IS NOT NULL)),
  channel INTEGER
    CHECK (channel IS NULL OR (typeof(channel) = 'integer' AND channel IN (0, 1) AND preferred_harness IS NOT NULL)),
  CHECK ((remembered_harness IS NULL AND runtime_mode IS NULL AND provider_session_id IS NULL)
    OR (remembered_harness IS NOT NULL AND runtime_mode IS NOT NULL AND provider_session_id IS NOT NULL))
);
INSERT INTO identity_session_preferences_v99 (
  identity_id, preferred_harness, remembered_harness, runtime_mode, provider_session_id,
  driver_state, driver_state_version, stale_at_ms, resume_pending_at_ms, channel
)
SELECT
  identity_id, preferred_harness, remembered_harness, runtime_mode, provider_session_id,
  driver_state, driver_state_version, stale_at_ms, resume_pending_at_ms, channel
FROM identity_session_preferences;
DROP TABLE identity_session_preferences;
ALTER TABLE identity_session_preferences_v99 RENAME TO identity_session_preferences;
CREATE TRIGGER identity_session_preferences_advances_change_cursor_on_insert AFTER INSERT ON identity_session_preferences
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;
CREATE TRIGGER identity_session_preferences_advances_change_cursor_on_update AFTER UPDATE ON identity_session_preferences
WHEN OLD.channel IS NOT NEW.channel
   OR OLD.identity_id IS NOT NEW.identity_id
   OR OLD.preferred_harness IS NOT NEW.preferred_harness
   OR OLD.remembered_harness IS NOT NEW.remembered_harness
   OR OLD.runtime_mode IS NOT NEW.runtime_mode
   OR OLD.provider_session_id IS NOT NEW.provider_session_id
   OR OLD.driver_state IS NOT NEW.driver_state
   OR OLD.driver_state_version IS NOT NEW.driver_state_version
   OR OLD.stale_at_ms IS NOT NEW.stale_at_ms
   OR OLD.resume_pending_at_ms IS NOT NEW.resume_pending_at_ms
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;
CREATE TRIGGER identity_session_preferences_advances_change_cursor_on_delete AFTER DELETE ON identity_session_preferences
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;

CREATE TABLE identity_resume_records_v99 (
  identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  harness TEXT NOT NULL,
  runtime_mode TEXT NOT NULL,
  provider_session_id TEXT NOT NULL,
  driver_state_version INTEGER,
  driver_state TEXT,
  stale_at_ms INTEGER CHECK (stale_at_ms IS NULL OR stale_at_ms BETWEEN 0 AND 9007199254740991),
  resume_pending_at_ms INTEGER CHECK (resume_pending_at_ms IS NULL OR resume_pending_at_ms BETWEEN 0 AND 9007199254740991),
  channel INTEGER CHECK (channel IS NULL OR channel IN (0,1)),
  PRIMARY KEY (identity_id,harness),
  CHECK ((driver_state IS NULL) = (driver_state_version IS NULL)),
  CHECK (driver_state IS NULL OR (driver_state_version BETWEEN 1 AND 65535
    AND length(CAST(driver_state AS BLOB)) BETWEEN 1 AND 4096))
);
INSERT INTO identity_resume_records_v99 (
  identity_id, harness, runtime_mode, provider_session_id,
  driver_state_version, driver_state, stale_at_ms, resume_pending_at_ms, channel
)
SELECT
  identity_id, harness, runtime_mode, provider_session_id,
  driver_state_version, driver_state, stale_at_ms, resume_pending_at_ms, channel
FROM identity_resume_records;
DROP TABLE identity_resume_records;
ALTER TABLE identity_resume_records_v99 RENAME TO identity_resume_records;
CREATE TRIGGER identity_resume_records_advances_change_cursor_on_insert
AFTER INSERT ON identity_resume_records
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;
CREATE TRIGGER identity_resume_records_advances_change_cursor_on_update
AFTER UPDATE ON identity_resume_records
WHEN OLD.identity_id IS NOT NEW.identity_id OR OLD.harness IS NOT NEW.harness
 OR OLD.runtime_mode IS NOT NEW.runtime_mode OR OLD.provider_session_id IS NOT NEW.provider_session_id
 OR OLD.driver_state_version IS NOT NEW.driver_state_version OR OLD.driver_state IS NOT NEW.driver_state
 OR OLD.stale_at_ms IS NOT NEW.stale_at_ms OR OLD.resume_pending_at_ms IS NOT NEW.resume_pending_at_ms
 OR OLD.channel IS NOT NEW.channel
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;
CREATE TRIGGER identity_resume_records_advances_change_cursor_on_delete
AFTER DELETE ON identity_resume_records
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;

CREATE TABLE launch_observations_v99 (
  binding_id TEXT NOT NULL REFERENCES bindings(id) ON DELETE CASCADE,
  preferences_fingerprint TEXT NOT NULL CHECK (length(preferences_fingerprint)=64 AND preferences_fingerprint NOT GLOB '*[^0-9a-f]*'),
  owner_pid INTEGER NOT NULL CHECK (typeof(owner_pid)='integer' AND owner_pid BETWEEN 1 AND 9007199254740991),
  owner_start TEXT NOT NULL CHECK (length(CAST(owner_start AS BLOB)) BETWEEN 1 AND 256),
  driver TEXT NOT NULL CHECK (length(driver) BETWEEN 1 AND 64 AND driver GLOB '[a-z]*' AND driver NOT GLOB '*[^a-z0-9_-]*'),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER NOT NULL CHECK (typeof(expires_at_ms)='integer' AND expires_at_ms BETWEEN created_at_ms AND 9007199254740991),
  status TEXT NOT NULL DEFAULT 'intent' CHECK (status IN ('intent','pending','admitted','settled')),
  provider_pid INTEGER CHECK (provider_pid IS NULL OR (typeof(provider_pid)='integer' AND provider_pid BETWEEN 1 AND 9007199254740991)),
  provider_transition TEXT CHECK (provider_transition IS NULL OR provider_transition IN ('started','resumed','cleared','compacted','forked','ended')),
  provider_start TEXT CHECK (provider_start IS NULL OR length(CAST(provider_start AS BLOB)) BETWEEN 1 AND 256),
  provider_session TEXT CHECK (provider_session IS NULL OR length(CAST(provider_session AS BLOB)) BETWEEN 1 AND 256),
  runtime_mode TEXT CHECK (runtime_mode IS NULL OR (length(runtime_mode) BETWEEN 1 AND 64 AND runtime_mode GLOB '[a-z]*' AND runtime_mode NOT GLOB '*[^a-z0-9_-]*')),
  driver_state_version INTEGER,
  driver_state TEXT CHECK (driver_state IS NULL OR (driver_state_version BETWEEN 1 AND 65535 AND length(CAST(driver_state AS BLOB)) BETWEEN 1 AND 4096)),
  observed_at_ms INTEGER CHECK (observed_at_ms IS NULL OR (typeof(observed_at_ms)='integer' AND observed_at_ms BETWEEN created_at_ms AND expires_at_ms)),
  step TEXT CHECK (step IS NULL OR step IN ('input','decode','driver_admission','host_discovery','pane_snapshot','provider_verification','storage','context')),
  reason TEXT CHECK (reason IS NULL OR reason IN ('in_progress','not_admitted','worker_error','budget_timeout','spawn_failed','launch_ended','conflict')),
  detail TEXT CHECK (detail IS NULL OR detail IN (
    'refused:lifecycle:SessionStart',
    'refused:lifecycle:SessionEnd',
    'refused:prompt:UserPromptSubmit',
    'refused:turn:Stop',
    'refused:turn:Interrupt',
    'refused:activity_session:Notification',
    'refused:activity_session:PostToolUse',
    'refused:activity_session:PostToolUseFailure',
    'refused:unknown',
    'host_unsupported',
    'stopped:turn:Stop:observer_owns_stop',
    'stopped:turn:Stop:unbound_session',
    'stopped:turn:Stop:not_current',
    'stopped:turn:Stop:no_admitted_start',
    'stopped:turn:Interrupt:observer_owns_stop',
    'stopped:turn:Interrupt:unbound_session',
    'stopped:turn:Interrupt:not_current',
    'stopped:prompt:UserPromptSubmit:unbound_session',
    'stopped:prompt:UserPromptSubmit:not_current',
    'stopped:activity_session:Notification:activity_missing',
    'stopped:activity_session:Notification:unbound_session',
    'stopped:activity_session:Notification:not_current',
    'stopped:activity_session:PostToolUse:activity_missing',
    'stopped:activity_session:PostToolUse:not_waiting',
    'stopped:activity_session:PostToolUse:unbound_session',
    'stopped:activity_session:PostToolUse:not_current',
    'stopped:activity_session:PostToolUseFailure:activity_missing',
    'stopped:activity_session:PostToolUseFailure:not_waiting',
    'stopped:activity_session:PostToolUseFailure:unbound_session',
    'stopped:activity_session:PostToolUseFailure:not_current',
    'stopped:unknown:activity_missing',
    'stopped:unknown:not_waiting',
    'stopped:unknown:observer_owns_stop',
    'stopped:unknown:unbound_session',
    'stopped:unknown:not_current',
    'digest_stop:worker_spawn',
    'digest_stop:worker_timeout',
    'digest_stop:worker_error',
    'digest_stop:worker_stderr',
    'digest_stop:capture_failed',
    'digest_stop:launch:argument',
    'digest_stop:launch:host',
    'digest_stop:launch:caller',
    'digest_stop:launch:caller_probe',
    'digest_stop:launch:binding',
    'digest_stop:launch:process',
    'digest_stop:launch:session',
    'digest_stop:launch:remembered',
    'digest_stop:launch:endpoint',
    'digest_stop:launch:owner',
    'digest_stop:launch:owner_probe',
    'digest_stop:launch:owner_not_live',
    'digest_stop:launch:deadline',
    'digest_stop:notice_unavailable',
    'digest_stop:handoff_invalid',
    'digest_stop:checklist_changed',
    'digest_stop:worker_exit',
    'digest_stop:worker_signal',
    'digest_stop:worker_io',
    'digest_stop:worker_output_limit',
    'digest_stop:worker:config',
    'digest_stop:worker:serialize',
    'digest_stop:worker:output',
    'digest_stop:worker:open:error',
    'digest_stop:worker:open:busy',
    'digest_stop:worker:ingest:error',
    'digest_stop:worker:ingest:busy',
    'digest_stop:worker:fitting:error',
    'digest_stop:worker:fitting:busy',
    'digest_stop:worker:claim:error',
    'digest_stop:worker:claim:busy',
    'digest_stop:worker:render:error',
    'digest_stop:worker:render:busy',
    'digest_stop:worker:close:error',
    'digest_stop:worker:close:busy',
    'digest_stop:launch:caller:config',
    'digest_stop:launch:caller:host',
    'digest_stop:launch:caller:pane',
    'digest_stop:launch:caller:storage',
    'digest_stop:launch:caller:storage_busy',
    'digest_stop:launch:caller:process',
    'digest_stop:launch:continuation:owner_probe',
    'digest_stop:launch:continuation:open:error',
    'digest_stop:launch:continuation:open:busy',
    'digest_stop:launch:continuation:write:error',
    'digest_stop:launch:continuation:write:busy',
    'digest_stop:launch:continuation:close:error',
    'digest_stop:launch:continuation:close:busy',
    'digest_stop:launch:continuation:read:error',
    'digest_stop:launch:continuation:read:busy',
    'digest_empty:active_claim',
    'digest_empty:due_unclaimable',
    'digest_empty:claim_nothing'
  )),
  CHECK ((driver_state IS NULL) = (driver_state_version IS NULL)),
  CHECK ((step IS NULL) = (reason IS NULL)),
  CHECK ((status='pending') = (provider_pid IS NOT NULL)),
  PRIMARY KEY (binding_id,owner_pid,owner_start),
  CHECK ((provider_pid IS NULL) = (provider_start IS NULL)
     AND (provider_pid IS NULL) = (provider_transition IS NULL)
     AND (provider_pid IS NULL) = (provider_session IS NULL)
     AND (provider_pid IS NULL) = (runtime_mode IS NULL)
     AND (provider_pid IS NULL) = (observed_at_ms IS NULL))
);
INSERT INTO launch_observations_v99 (
  binding_id, preferences_fingerprint, owner_pid, owner_start, driver,
  created_at_ms, expires_at_ms, status, provider_pid, provider_transition,
  provider_start, provider_session, runtime_mode, driver_state_version,
  driver_state, observed_at_ms, step, reason, detail
)
SELECT
  binding_id, preferences_fingerprint, owner_pid, owner_start, driver,
  created_at_ms, expires_at_ms, status, provider_pid, provider_transition,
  provider_start, provider_session, runtime_mode, driver_state_version,
  driver_state, observed_at_ms, step, reason, detail
FROM launch_observations;
DROP TABLE launch_observations;
ALTER TABLE launch_observations_v99 RENAME TO launch_observations;
CREATE INDEX launch_observations_expiry ON launch_observations(expires_at_ms);
CREATE TRIGGER launch_observations_advances_change_cursor_on_insert
AFTER INSERT ON launch_observations
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;
CREATE TRIGGER launch_observations_advances_change_cursor_on_update
AFTER UPDATE ON launch_observations
WHEN OLD.binding_id IS NOT NEW.binding_id
 OR OLD.preferences_fingerprint IS NOT NEW.preferences_fingerprint
 OR OLD.owner_pid IS NOT NEW.owner_pid
 OR OLD.owner_start IS NOT NEW.owner_start
 OR OLD.driver IS NOT NEW.driver
 OR OLD.created_at_ms IS NOT NEW.created_at_ms
 OR OLD.expires_at_ms IS NOT NEW.expires_at_ms
 OR OLD.status IS NOT NEW.status
 OR OLD.provider_pid IS NOT NEW.provider_pid
 OR OLD.provider_transition IS NOT NEW.provider_transition
 OR OLD.provider_start IS NOT NEW.provider_start
 OR OLD.provider_session IS NOT NEW.provider_session
 OR OLD.runtime_mode IS NOT NEW.runtime_mode
 OR OLD.driver_state IS NOT NEW.driver_state
 OR OLD.driver_state_version IS NOT NEW.driver_state_version
 OR OLD.observed_at_ms IS NOT NEW.observed_at_ms
 OR OLD.step IS NOT NEW.step
 OR OLD.reason IS NOT NEW.reason
 OR OLD.detail IS NOT NEW.detail
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;
CREATE TRIGGER launch_observations_advances_change_cursor_on_delete
AFTER DELETE ON launch_observations
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;
