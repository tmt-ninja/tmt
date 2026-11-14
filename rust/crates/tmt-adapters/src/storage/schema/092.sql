-- Which identity each usage write touched, stamped with the usage cursor value it moved to
-- (#6364), so `consumption.changes` answers only the identities changed since a cursor.
-- A change marker, not a record: no foreign key, and reads join identities. Kept apart
-- from `identities` so a sampler tick never writes the identity row. Writes and their
-- frequency are unchanged; each usage trigger now stamps after its cursor increment.
CREATE TABLE usage_changes (
  identity_id TEXT PRIMARY KEY CHECK (length(identity_id) BETWEEN 1 AND 64),
  usage_seq INTEGER NOT NULL CHECK (typeof(usage_seq) = 'integer' AND usage_seq >= 1)
);
CREATE INDEX usage_changes_by_seq ON usage_changes(usage_seq);
-- Changes up to this cursor value carry no stamp; an older cursor must reset.
CREATE TABLE usage_floor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL CHECK (typeof(value) = 'integer' AND value >= 0)
);
INSERT INTO usage_floor (id, value) SELECT 1, value FROM usage_cursor WHERE id = 1;
DROP TRIGGER consumption_sources_advances_usage_cursor_on_insert;
CREATE TRIGGER consumption_sources_advances_usage_cursor_on_insert AFTER INSERT ON consumption_sources
BEGIN UPDATE usage_cursor SET value = value + 1 WHERE id = 1; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (NEW.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; END;
DROP TRIGGER consumption_sources_advances_usage_cursor_on_update;
CREATE TRIGGER consumption_sources_advances_usage_cursor_on_update AFTER UPDATE ON consumption_sources
WHEN OLD.identity_id IS NOT NEW.identity_id OR OLD.binding_id IS NOT NEW.binding_id OR OLD.driver IS NOT NEW.driver OR OLD.session IS NOT NEW.session OR OLD.locator IS NOT NEW.locator OR OLD.sampled_at_ms IS NOT NEW.sampled_at_ms OR OLD.latest IS NOT NEW.latest
BEGIN UPDATE usage_cursor SET value = value + 1 WHERE id = 1; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (NEW.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (OLD.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; END;
DROP TRIGGER consumption_sources_advances_usage_cursor_on_delete;
CREATE TRIGGER consumption_sources_advances_usage_cursor_on_delete AFTER DELETE ON consumption_sources
BEGIN UPDATE usage_cursor SET value = value + 1 WHERE id = 1; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (OLD.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; END;
DROP TRIGGER consumption_buckets_advances_usage_cursor_on_insert;
CREATE TRIGGER consumption_buckets_advances_usage_cursor_on_insert AFTER INSERT ON consumption_buckets
BEGIN UPDATE usage_cursor SET value = value + 1 WHERE id = 1; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (NEW.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; END;
DROP TRIGGER consumption_buckets_advances_usage_cursor_on_update;
CREATE TRIGGER consumption_buckets_advances_usage_cursor_on_update AFTER UPDATE ON consumption_buckets
WHEN OLD.identity_id IS NOT NEW.identity_id OR OLD.from_ms IS NOT NEW.from_ms OR OLD.input_tokens IS NOT NEW.input_tokens OR OLD.output_tokens IS NOT NEW.output_tokens OR OLD.cached_input_tokens IS NOT NEW.cached_input_tokens OR OLD.covered_ms IS NOT NEW.covered_ms OR OLD.complete IS NOT NEW.complete OR OLD.gap IS NOT NEW.gap OR OLD.discontinuous IS NOT NEW.discontinuous OR OLD.sampled_at_ms IS NOT NEW.sampled_at_ms OR OLD.latest IS NOT NEW.latest OR OLD.details IS NOT NEW.details
BEGIN UPDATE usage_cursor SET value = value + 1 WHERE id = 1; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (NEW.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (OLD.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; END;
DROP TRIGGER consumption_buckets_advances_usage_cursor_on_delete;
CREATE TRIGGER consumption_buckets_advances_usage_cursor_on_delete AFTER DELETE ON consumption_buckets
BEGIN UPDATE usage_cursor SET value = value + 1 WHERE id = 1; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (OLD.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; END;
DROP TRIGGER consumption_tier5m_advances_usage_cursor_on_insert;
CREATE TRIGGER consumption_tier5m_advances_usage_cursor_on_insert AFTER INSERT ON consumption_tier5m
BEGIN UPDATE usage_cursor SET value = value + 1 WHERE id = 1; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (NEW.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; END;
DROP TRIGGER consumption_tier5m_advances_usage_cursor_on_update;
CREATE TRIGGER consumption_tier5m_advances_usage_cursor_on_update AFTER UPDATE ON consumption_tier5m
WHEN OLD.identity_id IS NOT NEW.identity_id OR OLD.from_ms IS NOT NEW.from_ms OR OLD.input_tokens IS NOT NEW.input_tokens OR OLD.output_tokens IS NOT NEW.output_tokens OR OLD.cached_input_tokens IS NOT NEW.cached_input_tokens OR OLD.covered_ms IS NOT NEW.covered_ms OR OLD.complete IS NOT NEW.complete OR OLD.gap IS NOT NEW.gap OR OLD.discontinuous IS NOT NEW.discontinuous OR OLD.sampled_at_ms IS NOT NEW.sampled_at_ms OR OLD.limits IS NOT NEW.limits OR OLD.details IS NOT NEW.details OR OLD.credits IS NOT NEW.credits OR OLD.service_tier IS NOT NEW.service_tier
BEGIN UPDATE usage_cursor SET value = value + 1 WHERE id = 1; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (NEW.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (OLD.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; END;
DROP TRIGGER consumption_tier5m_advances_usage_cursor_on_delete;
CREATE TRIGGER consumption_tier5m_advances_usage_cursor_on_delete AFTER DELETE ON consumption_tier5m
BEGIN UPDATE usage_cursor SET value = value + 1 WHERE id = 1; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (OLD.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; END;
DROP TRIGGER consumption_family_advances_usage_cursor_on_insert;
CREATE TRIGGER consumption_family_advances_usage_cursor_on_insert AFTER INSERT ON consumption_family
BEGIN UPDATE usage_cursor SET value = value + 1 WHERE id = 1; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (NEW.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; END;
DROP TRIGGER consumption_family_advances_usage_cursor_on_update;
CREATE TRIGGER consumption_family_advances_usage_cursor_on_update AFTER UPDATE ON consumption_family
WHEN OLD.identity_id IS NOT NEW.identity_id OR OLD.session IS NOT NEW.session OR OLD.scan IS NOT NEW.scan OR OLD.edge IS NOT NEW.edge OR OLD.closed IS NOT NEW.closed OR OLD.warm IS NOT NEW.warm
BEGIN UPDATE usage_cursor SET value = value + 1 WHERE id = 1; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (NEW.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (OLD.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; END;
DROP TRIGGER consumption_family_advances_usage_cursor_on_delete;
CREATE TRIGGER consumption_family_advances_usage_cursor_on_delete AFTER DELETE ON consumption_family
BEGIN UPDATE usage_cursor SET value = value + 1 WHERE id = 1; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (OLD.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; END;
DROP TRIGGER consumption_family_files_advances_usage_cursor_on_insert;
CREATE TRIGGER consumption_family_files_advances_usage_cursor_on_insert AFTER INSERT ON consumption_family_files
BEGIN UPDATE usage_cursor SET value = value + 1 WHERE id = 1; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (NEW.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; END;
DROP TRIGGER consumption_family_files_advances_usage_cursor_on_update;
CREATE TRIGGER consumption_family_files_advances_usage_cursor_on_update AFTER UPDATE ON consumption_family_files
WHEN OLD.identity_id IS NOT NEW.identity_id OR OLD.file IS NOT NEW.file OR OLD.child IS NOT NEW.child OR OLD.parent IS NOT NEW.parent OR OLD.base IS NOT NEW.base OR OLD.state IS NOT NEW.state OR OLD.touched_ms IS NOT NEW.touched_ms
BEGIN UPDATE usage_cursor SET value = value + 1 WHERE id = 1; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (NEW.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (OLD.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; END;
DROP TRIGGER consumption_family_files_advances_usage_cursor_on_delete;
CREATE TRIGGER consumption_family_files_advances_usage_cursor_on_delete AFTER DELETE ON consumption_family_files
BEGIN UPDATE usage_cursor SET value = value + 1 WHERE id = 1; INSERT INTO usage_changes (identity_id, usage_seq) VALUES (OLD.identity_id, (SELECT value FROM usage_cursor WHERE id = 1)) ON CONFLICT (identity_id) DO UPDATE SET usage_seq = excluded.usage_seq; END;
