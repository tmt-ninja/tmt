//! Persisted pre-cutover slot identity; Core owns current scheduling.
use sha2::{Digest, Sha256};

/// The operation excludes actor, clock and revision so changed slot intent conflicts.
pub fn operation_id(room_id: &str, job_id: &str, slot_ms: i64) -> String {
    let mut hash = Sha256::new();
    // This historical domain is persisted as dispatch identity. Renaming it
    // would replay already accepted slots after an upgrade.
    hash.update(b"tmt-squad-cron-slot-v1\0");
    for value in [room_id.as_bytes(), job_id.as_bytes()] {
        hash.update((value.len() as u64).to_be_bytes());
        hash.update(value);
    }
    hash.update(slot_ms.to_be_bytes());
    crate::operation::uuid_v8(&hash.finalize())
}

#[cfg(test)]
mod tests;
