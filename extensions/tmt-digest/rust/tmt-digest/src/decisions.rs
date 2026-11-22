//! `tmt digest decisions`: the tick decisions Digest recorded, listed as they
//! were, or with `--report` the savings those deliveries made. Nothing is
//! delivered here; only `--recompute` estimates, and says so.

mod report;
use report::Recompute;

/// What the command prints: the recorded decisions, or the savings report.
pub enum Mode {
    List,
    Report(Option<Alternative>),
}

/// An interval to recompute with; the flush count defaults to the configured one.
pub struct Alternative {
    pub interval_ms: u64,
    pub flush_count: Option<u64>,
}

use crate::{
    core::{Core, Error},
    history::{Decision, Store},
    settings::DigestConfig,
    status::inventory,
    usage::Since,
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

pub fn execute(since: Since, mode: Mode) -> Result<Value, Error> {
    let core = Core::discover()?.until(Instant::now() + Duration::from_secs(15));
    let root = core.data_root()?;
    let now = crate::tick::now_ms()?;
    // Names are a courtesy: a roster that cannot be read leaves them null.
    let names: BTreeMap<String, String> = core
        .json(&["identity", "ls"])
        .and_then(|roster| inventory(&roster))
        .map(|rows| rows.into_iter().collect())
        .unwrap_or_default();
    let from = now.saturating_sub(since.window_ms());
    let mut store = Store::open(&root, false)?;
    let Mode::Report(alternative) = mode else {
        let decisions = match &mut store {
            Some(store) => store.decisions(from, now)?,
            None => vec![],
        };
        return Ok(document(since, now, &decisions, &names));
    };
    let recompute = alternative
        .map(|alternative| -> Result<Recompute, Error> {
            Ok(Recompute {
                interval_ms: alternative.interval_ms,
                flush_count: match alternative.flush_count {
                    Some(count) => count,
                    None => u64::try_from(DigestConfig::load(&core.settings_path()?)?.flush_count)
                        .map_err(|_| {
                            Error::new("DIGEST_SETTINGS_INVALID", "flushCount must be positive")
                        })?,
                },
            })
        })
        .transpose()?;
    // A report is a read: a valid cached table, else the built-in one. It never fetches or
    // writes the cache; Status is the only refresher (#6752).
    let prices = crate::pricing::Resolved::read_only(&root);
    let wake_turns = wake_turns(&core, from, now);
    let (settlements, decisions, coverage) = match &mut store {
        Some(store) => (
            store.settlements(from, now)?,
            store.decisions(from.saturating_sub(120_000), now.saturating_add(120_000))?,
            store.coverage(from, now)?,
        ),
        None => Default::default(),
    };
    Ok(report::document(&report::Input {
        since: since.text(),
        from_ms: from,
        through_ms: now,
        settlements: &settlements,
        decisions: &decisions,
        coverage: &coverage,
        names: &names,
        recompute,
        wake_turns: wake_turns.as_deref(),
        prices: &prices,
    }))
}

/// Every measured wake-up turn that ended in the window, or none when Core cannot answer
/// (an older Core without `digest.wakeTurns` among them): the report then says so.
fn wake_turns(core: &Core, from: u64, through: u64) -> Option<Vec<report::wake::WakeTurn>> {
    let mut turns: Vec<report::wake::WakeTurn> = vec![];
    let mut cursor = from;
    // Pages overlap at their last end time, so a turn seen twice is kept once.
    for _ in 0..64 {
        let page = core
            .api(
                "digest.wakeTurns",
                json!({"fromMs": cursor, "throughMs": through}),
            )
            .ok()?;
        let (page, more) = report::wake::parse(&page).ok()?;
        let last = page.last().map(|turn| turn.ended_at_ms);
        for turn in page {
            let seen = turn.ended_at_ms == cursor
                && turns
                    .iter()
                    .rev()
                    .take_while(|old| old.ended_at_ms == cursor)
                    .any(|old| *old == turn);
            if !seen {
                turns.push(turn);
            }
        }
        match last {
            Some(last) if more && last > cursor => cursor = last,
            Some(_) if more => return None,
            _ => return Some(turns),
        }
    }
    None
}

fn document(
    since: Since,
    now: u64,
    decisions: &[Decision],
    names: &BTreeMap<String, String>,
) -> Value {
    json!({
        "version": 1,
        "since": since.text(),
        "fromMs": now.saturating_sub(since.window_ms()),
        "throughMs": now,
        "decisions": decisions.iter().map(|decision| json!({
            "atMs": decision.at_ms,
            "identityId": decision.identity_id,
            "name": names.get(&decision.identity_id),
            "mode": decision.mode(),
            "intervalMs": decision.interval_ms,
            "flushCount": decision.flush_count,
            "rule": decision.rule.text(),
            "heldCount": decision.held_count,
            "oldestHeldAgeMs": decision.oldest_held_age_ms,
            "outcome": decision.outcome,
        })).collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests;
