//! Measured wake-up turns (#6453): the tokens of each main-session turn that carried a
//! handed-over request, summed from the identity's own 5-second usage buckets by the hook
//! transaction that admits the turn's boundaries. Nothing here reads a transcript.
use super::{BUCKET_MS, Bucket, Details, FINE, ModelUsage, integer, invalid, optional_integer};
use crate::storage::{Storage, StorageError, errors::classify};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tmt_core::limits::MAX_JS_SAFE_INTEGER;

/// As long as Digest keeps its decision history.
pub const WAKE_TURN_RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
/// The most turns one `digest.wakeTurns` page carries.
pub const MAX_WAKE_TURNS: usize = 1_000;

/// The start bucket as the turn's start read left it: what was already there is not the turn's.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Baseline {
    input_tokens: u64,
    output_tokens: u64,
    cached_input_tokens: u64,
    covered_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    models: Option<Vec<ModelUsage>>,
}

fn slot(ms: u64) -> u64 {
    ms / BUCKET_MS * BUCKET_MS
}

fn ms(value: u64, what: &str) -> Result<i64, StorageError> {
    i64::try_from(value)
        .ok()
        .filter(|value| *value as u64 <= MAX_JS_SAFE_INTEGER)
        .ok_or_else(|| {
            StorageError::new(
                crate::storage::StorageErrorCode::Corrupt,
                format!("{what} is outside the supported clock range"),
            )
        })
}

/// A main turn that carried at least one handed-over request started at `now`. `read` says the
/// start event carried a usage read, so the baseline is the bucket after it. A turn still open
/// lost its end, so it closes unmeasured here.
pub(in crate::storage) fn open(
    db: &Connection,
    identity: &str,
    now: u64,
    read: bool,
) -> Result<(), StorageError> {
    let now_i64 = ms(now, "Wake turn start")?;
    db.execute(
        "UPDATE wake_turns SET ended_ms=MAX(?2,started_ms),measured=0 WHERE identity_id=?1 AND ended_ms IS NULL",
        params![identity, now_i64],
    )
    .map_err(|e| classify(e, "Close a wake turn that lost its end"))?;
    let baseline = if read {
        let bucket = Bucket::read(db, FINE, identity, slot(now))?;
        Some(
            serde_json::to_string(&Baseline {
                input_tokens: bucket.input,
                output_tokens: bucket.output,
                cached_input_tokens: bucket.cached,
                covered_ms: bucket.covered,
                models: bucket.details.by_model,
            })
            .map_err(|_| invalid())?,
        )
    } else {
        None
    };
    db.execute(
        "INSERT INTO wake_turns(identity_id,started_ms,baseline) VALUES(?1,?2,?3) ON CONFLICT DO NOTHING",
        params![identity, now_i64, baseline],
    )
    .map_err(|e| classify(e, "Open a wake turn"))?;
    Ok(())
}

/// The open turn of `identity` ended at `now`. `read` says the end event carried a usage read,
/// so every token of the turn is in its buckets.
pub(in crate::storage) fn close(
    db: &Connection,
    identity: &str,
    now: u64,
    read: bool,
) -> Result<(), StorageError> {
    let open: Option<(u64, Option<String>)> = db
        .query_row(
            "SELECT started_ms,baseline FROM wake_turns WHERE identity_id=? AND ended_ms IS NULL ORDER BY started_ms DESC LIMIT 1",
            [identity],
            |row| Ok((integer(row, 0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| classify(e, "Read the open wake turn"))?;
    let Some((started, baseline)) = open else {
        return Ok(());
    };
    let ended = now.max(started);
    let baseline: Option<Baseline> = baseline
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| invalid())?;
    let mut statement = db
        .prepare("SELECT input_tokens,output_tokens,cached_input_tokens,covered_ms,complete,gap,discontinuous,sampled_at_ms,latest,details,from_ms FROM consumption_buckets WHERE identity_id=?1 AND from_ms BETWEEN ?2 AND ?3 ORDER BY from_ms")
        .map_err(|e| classify(e, "Read a wake turn's usage"))?;
    let buckets = statement
        .query_map(
            params![
                identity,
                ms(slot(started), "Wake turn start")?,
                ms(slot(ended), "Wake turn end")?
            ],
            |row| Bucket::from_row(row, integer(row, 10)?),
        )
        .map_err(|e| classify(e, "Read a wake turn's usage"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| classify(e, "Read a wake turn's usage"))?;
    let (mut input, mut output, mut cached, mut covered) = (0u64, 0u64, 0u64, 0u64);
    let mut details = Details::default();
    let mut clean = true;
    for bucket in &buckets {
        input = input.checked_add(bucket.input).ok_or_else(invalid)?;
        output = output.checked_add(bucket.output).ok_or_else(invalid)?;
        cached = cached.checked_add(bucket.cached).ok_or_else(invalid)?;
        covered = covered.checked_add(bucket.covered).ok_or_else(invalid)?;
        details.merge(&bucket.details)?;
        clean &= !bucket.incomplete && !bucket.gap && !bucket.discontinuous;
    }
    let start = baseline.as_ref();
    let less = |total: u64, base: Option<u64>| total.checked_sub(base.unwrap_or(0));
    let counts = (
        less(input, start.map(|b| b.input_tokens)),
        less(output, start.map(|b| b.output_tokens)),
        less(cached, start.map(|b| b.cached_input_tokens)),
        less(covered, start.map(|b| b.covered_ms)),
    );
    let models = details
        .by_model
        .filter(|rows| !rows.is_empty())
        .and_then(|rows| subtract(rows, start.and_then(|b| b.models.as_deref())));
    let (input, output, cached, covered, consistent) = match counts {
        (Some(input), Some(output), Some(cached), Some(covered)) if cached <= input => {
            (input, output, cached, covered, true)
        }
        // A bucket pruned or rewritten under a long turn: what is left is no measurement.
        _ => (0, 0, 0, 0, false),
    };
    let every_slot = buckets.len() as u64 == (slot(ended) - slot(started)) / BUCKET_MS + 1;
    let measured =
        read && start.is_some() && consistent && clean && every_slot && covered >= ended - started;
    let models = models
        .map(|rows| serde_json::to_string(&rows))
        .transpose()
        .map_err(|_| invalid())?;
    db.execute(
        "UPDATE wake_turns SET ended_ms=?3,input_tokens=?4,output_tokens=?5,cached_input_tokens=?6,models=?7,measured=?8
         WHERE identity_id=?1 AND started_ms=?2",
        params![
            identity,
            ms(started, "Wake turn start")?,
            ms(ended, "Wake turn end")?,
            consistent.then_some(input as i64),
            consistent.then_some(output as i64),
            consistent.then_some(cached as i64),
            models,
            measured
        ],
    )
    .map_err(|e| classify(e, "Close a wake turn"))?;
    db.execute(
        "DELETE FROM wake_turns WHERE rowid IN (SELECT rowid FROM wake_turns WHERE ended_ms<? ORDER BY ended_ms LIMIT 256)",
        [ms(ended.saturating_sub(WAKE_TURN_RETENTION_MS), "Wake turn retention")?],
    )
    .map_err(|e| classify(e, "Prune wake turns"))?;
    Ok(())
}

/// The turn's own share per model, or none when the start bucket's split cannot be taken out
/// exactly: an unattributed share is unknown, never moved to another model.
fn subtract(mut rows: Vec<ModelUsage>, base: Option<&[ModelUsage]>) -> Option<Vec<ModelUsage>> {
    for old in base.unwrap_or_default() {
        let row = rows.iter_mut().find(|row| row.model_id == old.model_id)?;
        row.input_tokens = row.input_tokens.checked_sub(old.input_tokens)?;
        row.output_tokens = row.output_tokens.checked_sub(old.output_tokens)?;
        row.cached_input_tokens = row
            .cached_input_tokens
            .checked_sub(old.cached_input_tokens)?;
        row.cache_write_tokens = None;
    }
    rows.retain(|row| row.input_tokens != 0 || row.output_tokens != 0);
    for row in &mut rows {
        row.cache_write_tokens = None;
    }
    Some(rows)
}

impl Storage {
    /// Ended wake turns whose end falls in `[from_ms, through_ms]`, oldest first, with the
    /// requests each carried. Read-only. `ids` limits the identities; empty means all.
    pub fn wake_turns(
        &self,
        ids: &[String],
        from_ms: u64,
        through_ms: u64,
        limit: usize,
    ) -> Result<Value, StorageError> {
        if from_ms > through_ms || !(1..=MAX_WAKE_TURNS).contains(&limit) {
            return Err(invalid());
        }
        let db = self.connection()?;
        let filter = serde_json::to_string(ids).map_err(|_| invalid())?;
        let mut statement = db
            .prepare(
                "SELECT w.identity_id,w.started_ms,w.ended_ms,w.input_tokens,w.output_tokens,w.cached_input_tokens,w.models,w.measured,
                   (SELECT json_group_array(t.request_id) FROM request_turns t JOIN request_attempts a ON a.request_id=t.request_id
                    WHERE a.recipient_identity_id=w.identity_id AND t.started_ms=w.started_ms)
                 FROM wake_turns w
                 WHERE w.ended_ms BETWEEN ?1 AND ?2
                   AND (json_array_length(?3)=0 OR w.identity_id IN (SELECT value FROM json_each(?3)))
                 ORDER BY w.ended_ms,w.identity_id LIMIT ?4",
            )
            .map_err(|e| classify(e, "Read wake turns"))?;
        let rows = statement
            .query_map(
                params![
                    ms(from_ms, "Wake turn range")?,
                    ms(through_ms, "Wake turn range")?,
                    filter,
                    limit as i64 + 1
                ],
                |row| {
                    let models: Option<String> = row.get(6)?;
                    let requests: String = row.get(8)?;
                    Ok((
                        row.get::<_, String>(0)?,
                        integer(row, 1)?,
                        integer(row, 2)?,
                        optional_integer(row, 3)?,
                        optional_integer(row, 4)?,
                        optional_integer(row, 5)?,
                        models,
                        row.get::<_, bool>(7)?,
                        requests,
                    ))
                },
            )
            .map_err(|e| classify(e, "Read wake turns"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| classify(e, "Read wake turns"))?;
        let more = rows.len() > limit;
        let mut turns = Vec::with_capacity(rows.len().min(limit));
        for (identity, started, ended, input, output, cached, models, measured, requests) in
            rows.into_iter().take(limit)
        {
            let models: Option<Vec<ModelUsage>> = models
                .as_deref()
                .map(serde_json::from_str)
                .transpose()
                .map_err(|_| invalid())?;
            let requests: Vec<String> = serde_json::from_str(&requests).map_err(|_| invalid())?;
            turns.push(json!({
                "identityId": identity, "startedAtMs": started, "endedAtMs": ended,
                "requestIds": requests, "measured": measured,
                "tokens": input.zip(output).zip(cached).map(|((input, output), cached)| json!({
                    "inputTokens": input, "outputTokens": output, "cachedInputTokens": cached})),
                "byModel": models,
            }));
        }
        Ok(json!({"fromMs": from_ms, "throughMs": through_ms, "turns": turns, "more": more}))
    }
}
