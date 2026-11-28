package storage

// This independently versioned queue schema is the native hook_queue.rs
// schema. It is not part of the main database migration inventory.
const hookQueueVersion = 3

const hookQueueSchema = `CREATE TABLE IF NOT EXISTS hook_writes(sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,identity_id TEXT,provisional_batch TEXT,kind TEXT NOT NULL CHECK(kind='capture'),enqueued_ms INTEGER NOT NULL CHECK(enqueued_ms>=0),committed INTEGER NOT NULL DEFAULT 0 CHECK(committed IN (0,1)),payload TEXT NOT NULL CHECK(length(CAST(payload AS BLOB))<=131072)) STRICT;
CREATE INDEX IF NOT EXISTS hook_writes_identity_pending ON hook_writes(identity_id,committed,sequence);
CREATE INDEX IF NOT EXISTS hook_writes_provisional_batch ON hook_writes(provisional_batch);
CREATE TABLE IF NOT EXISTS invalid_hook_writes(event_id TEXT PRIMARY KEY NOT NULL,quarantined_ms INTEGER NOT NULL) STRICT;
CREATE INDEX IF NOT EXISTS invalid_hook_writes_retention ON invalid_hook_writes(quarantined_ms,event_id);
CREATE TABLE IF NOT EXISTS provisional_batches(turn_key TEXT PRIMARY KEY NOT NULL,batch_id TEXT NOT NULL,created_ms INTEGER NOT NULL) STRICT;
CREATE INDEX IF NOT EXISTS provisional_batches_retention ON provisional_batches(created_ms,turn_key);
CREATE TABLE IF NOT EXISTS hook_retention_scan(id INTEGER PRIMARY KEY CHECK(id=1),receipt_ms INTEGER NOT NULL,receipt_id TEXT NOT NULL,batch_ms INTEGER NOT NULL,batch_key TEXT NOT NULL) STRICT;
INSERT OR IGNORE INTO hook_retention_scan VALUES(1,-1,'',-1,'');
PRAGMA user_version=3;`
