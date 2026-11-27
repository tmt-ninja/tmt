//! Count and read keeps on the canonical request and captured-final records.
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::super::{
    Storage, StorageError, errors::classify, identities::commit_immediate_transaction,
};

const LIMIT: i64 = 64;

/// Whether a recent_responses row has a live pin from either capture source.
pub(in crate::storage) const CAPTURE_PINNED: &str =
    "(recent_responses.kept_owner_identity_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM request_attempts a
        WHERE a.kept_capture_sequence=recent_responses.sequence
          AND a.keep_reply=1 AND a.keep_removed=0
    ))";

/// Check the person's single budget under the same writer as the marked
/// dispatch or prompt. Keep references retain a result even after its ordinary
/// deadline. Pending exchanges count only while they can still take a final.
pub(in crate::storage) fn room_for_reply(
    db: &Connection,
    person: &str,
    now_ms: u64,
) -> Result<bool, StorageError> {
    let now = super::checked_now(now_ms, "Keep-reply admission time")?;
    // A negative floor preserves valid clocks inside the first acceptance window.
    let acceptance_floor = now - tmt_core::retention::RESPONSE_ACCEPTANCE_WINDOW_MS as i64;
    let pending = request_pending("?2", "?3");
    let count: i64 = db
        .query_row(
            &format!(
                "SELECT
                (SELECT COUNT(*) FROM request_attempts a
                 WHERE a.originator_identity_id=?1 AND a.keep_reply=1 AND a.keep_removed=0
                   AND (
                       EXISTS(SELECT 1 FROM request_responses f WHERE f.request_id=a.request_id)
                       OR EXISTS(SELECT 1 FROM recent_responses r
                                 WHERE r.sequence=a.kept_capture_sequence)
                       OR ({pending})
                   ))
                + (SELECT COUNT(*) FROM recent_responses WHERE kept_owner_identity_id=?1)
                + (SELECT COUNT(*) FROM capture_batches
                   WHERE kept_owner_identity_id=?1 AND closed_ms IS NULL)"
            ),
            params![person, now, acceptance_floor],
            |row| row.get(0),
        )
        .map_err(|error| classify(error, "Count kept and pending replies"))?;
    Ok(count < LIMIT)
}

pub(super) fn request_pending(now: &str, floor: &str) -> String {
    format!(
        "a.withdrawn_at_ms IS NULL AND a.response_submitted_at_ms IS NULL
        AND a.status IN ('sending','sent','queued','uncertain')
        AND (a.expires_at_ms>{now} OR a.prepared_at_ms>{floor})
        AND NOT EXISTS(SELECT 1 FROM request_passthrough p
                       WHERE p.request_id=a.request_id AND p.state IN ('answered','no_answer'))"
    )
}

/// Kept projection joins canonical finals without extending ordinary history.
const PROJECTION: &str = "WITH kept AS (
    SELECT a.request_id AS key,a.recipient_identity_id AS member_id,
           'request' AS source,f.submitted_at_ms AS at_ms,f.body AS body,0 AS truncated
    FROM request_attempts a
    JOIN request_responses f ON f.request_id=a.request_id
    WHERE a.originator_identity_id=?1 AND a.keep_reply=1 AND a.keep_removed=0
    UNION ALL
    SELECT a.request_id,a.recipient_identity_id,'passthrough',r.ended_ms,r.text,r.truncated
    FROM request_attempts a JOIN recent_responses r ON r.sequence=a.kept_capture_sequence
    WHERE a.originator_identity_id=?1 AND a.keep_reply=1 AND a.keep_removed=0
      AND NOT EXISTS(SELECT 1 FROM request_responses f WHERE f.request_id=a.request_id)
    UNION ALL
    SELECT 'rsp_'||sequence,identity_id,'terminal',ended_ms,text,truncated
    FROM recent_responses WHERE kept_owner_identity_id=?1
)";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Cursor {
    pub at_ms: u64,
    pub key: String,
}

impl Storage {
    pub(crate) fn request_has_keep_mark(&self, request: &str) -> Result<bool, StorageError> {
        self.connection()?
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM request_attempts WHERE request_id=?1 AND keep_reply=1)",
                [request],
                |row| row.get(0),
            )
            .map_err(|error| classify(error, "Read the request keep mark"))
    }

    pub(crate) fn list_kept_replies(
        &self,
        person: &str,
        member: Option<&str>,
        before: Option<&Cursor>,
        limit: u32,
    ) -> Result<Value, StorageError> {
        let db = self.connection()?;
        let mut statement = db
            .prepare(&format!(
                "{PROJECTION}
                 SELECT key,member_id,source,at_ms,substr(body,1,160)
                 FROM kept WHERE (?2 IS NULL OR member_id=?2)
                   AND (?3 IS NULL OR (at_ms,key)<(?3,?4))
                 ORDER BY at_ms DESC,key DESC LIMIT ?5"
            ))
            .map_err(|error| classify(error, "Prepare kept-reply list"))?;
        let mut items = statement
            .query_map(
                params![
                    person,
                    member,
                    before
                        .map(|cursor| super::checked_now(cursor.at_ms, "Kept reply cursor"))
                        .transpose()?,
                    before.map(|cursor| cursor.key.as_str()),
                    limit + 1,
                ],
                |row| {
                    Ok(json!({
                        "key": row.get::<_, String>(0)?,
                        "memberId": row.get::<_, String>(1)?,
                        "source": row.get::<_, String>(2)?,
                        "atMs": super::rows::u64_at(row, 3)?,
                        "excerpt": row.get::<_, String>(4)?,
                    }))
                },
            )
            .and_then(Iterator::collect::<Result<Vec<_>, _>>)
            .map_err(|error| classify(error, "Read kept replies"))?;
        let next = if items.len() > limit as usize {
            items.pop();
            items
                .last()
                .map(|row| json!({"atMs": row["atMs"], "key": row["key"]}))
        } else {
            None
        };
        Ok(json!({"items": items, "nextBefore": next}))
    }

    pub(crate) fn show_kept_reply(
        &self,
        person: &str,
        key: &str,
    ) -> Result<Option<Value>, StorageError> {
        self.connection()?
            .query_row(
                &format!("{PROJECTION} SELECT member_id,source,at_ms,body,truncated FROM kept WHERE key=?2"),
                params![person, key],
                |row| {
                    Ok(json!({
                        "key": key,
                        "memberId": row.get::<_, String>(0)?,
                        "source": row.get::<_, String>(1)?,
                        "atMs": super::rows::u64_at(row, 2)?,
                        "text": row.get::<_, String>(3)?,
                        "truncated": row.get::<_, bool>(4)?,
                    }))
                },
            )
            .optional()
            .map_err(|error| classify(error, "Read the kept reply"))
    }

    pub(crate) fn remove_kept_reply(
        &mut self,
        person: &str,
        key: &str,
    ) -> Result<bool, StorageError> {
        commit_immediate_transaction(self, "remove kept reply", |db| {
            let selected = if let Some(sequence) = capture_sequence(key) {
                db.query_row(
                    "UPDATE recent_responses SET kept_owner_identity_id=NULL
                     WHERE sequence=?1 AND kept_owner_identity_id=?2 RETURNING sequence",
                    params![super::checked_now(sequence, "Kept response key")?, person],
                    |row| row.get::<_, Option<i64>>(0),
                )
                .optional()
            } else {
                db.query_row(
                    "UPDATE request_attempts SET keep_removed=1
                     WHERE request_id=?1 AND originator_identity_id=?2
                       AND keep_reply=1 AND keep_removed=0
                       AND (kept_capture_sequence IS NOT NULL
                         OR EXISTS(SELECT 1 FROM request_responses f
                                   WHERE f.request_id=request_attempts.request_id))
                     RETURNING kept_capture_sequence",
                    params![key, person],
                    |row| row.get::<_, Option<i64>>(0),
                )
                .optional()
            }
            .map_err(|error| classify(error, "Remove the kept reply"))?;
            if let Some(Some(sequence)) = selected {
                db.execute(
                    &format!(
                        "DELETE FROM recent_responses
                        WHERE sequence=?1 AND ordinary_dropped=1 AND NOT {CAPTURE_PINNED}"
                    ),
                    [sequence],
                )
                .map_err(|error| classify(error, "Clean up the dropped capture"))?;
            }
            Ok(selected.is_some())
        })
    }
}

pub(crate) fn capture_sequence(key: &str) -> Option<u64> {
    let raw = key.strip_prefix("rsp_")?;
    let sequence: u64 = raw.parse().ok()?;
    (sequence > 0
        && sequence <= tmt_core::limits::MAX_JS_SAFE_INTEGER
        && raw == sequence.to_string())
    .then_some(sequence)
}

pub(in crate::storage) fn mark_terminal(
    db: &Connection,
    person: &str,
    batch: &str,
    now: u64,
) -> Result<(), StorageError> {
    if room_for_reply(db, person, now)? {
        db.execute(
            "UPDATE capture_batches SET kept_owner_identity_id=?1
             WHERE id=?2 AND closed_ms IS NULL
               AND EXISTS (SELECT 1 FROM identities i JOIN identity_metadata m ON m.identity_id=i.id
                           WHERE i.id=?1 AND i.retired_at_ms IS NULL AND m.key=?3 AND m.value=?4)
               AND NOT EXISTS (SELECT 1 FROM capture_entries e WHERE e.batch_id=?2 AND e.kind='input')",
            params![
                person,
                batch,
                tmt_core::identity_metadata::USER_KEY,
                tmt_core::identity_metadata::USER_VALUE,
            ],
        )
        .map_err(|error| classify(error, "Mark the admitted terminal prompt"))?;
    }
    Ok(())
}

pub(in crate::storage) fn pin_terminal(
    db: &Connection,
    batch: &str,
    sequence: u64,
) -> Result<(), StorageError> {
    let owner = db
        .query_row(
            "SELECT kept_owner_identity_id FROM capture_batches
             WHERE id=?1 AND closed_ms IS NULL AND kept_owner_identity_id IS NOT NULL",
            [batch],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| classify(error, "Read the terminal keep reservation"))?;
    if let Some(owner) = owner {
        db.execute(
            "UPDATE recent_responses SET kept_owner_identity_id=?1 WHERE sequence=?2",
            params![owner, super::checked_now(sequence, "Kept response key")?],
        )
        .map_err(|error| classify(error, "Keep the admitted terminal final"))?;
        finish_terminal(db, batch)?;
    }
    Ok(())
}

pub(in crate::storage) fn finish_terminal(
    db: &Connection,
    batch: &str,
) -> Result<(), StorageError> {
    db.execute(
        "UPDATE capture_batches SET kept_owner_identity_id=NULL
         WHERE id=?1 AND kept_owner_identity_id IS NOT NULL",
        [batch],
    )
    .map_err(|error| classify(error, "Release the terminal keep reservation"))?;
    Ok(())
}

/// A leading keep token followed by a nonempty question; leave the actual
/// provider prompt unchanged.
pub fn has_keep_prefix(prompt: &str) -> bool {
    prompt
        .strip_prefix('⚑')
        .or_else(|| prompt.strip_prefix("/keep"))
        .is_some_and(|question| {
            question.starts_with(char::is_whitespace) && !question.trim().is_empty()
        })
}
