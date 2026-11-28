//! Spend per billing vendor since an absolute start, and its 3, 6 and 24 hour pace
//! (#4283): Core's per-model rollup deltas priced at the rates in effect, over all four
//! classes. Every window ends at one pinned cut. A value is a sum of segments between
//! consecutive starts, each inside one rate period, so a dated rate is never applied
//! across its boundary. Missing evidence is a reason, never a zero or a guessed split.

use super::{Tokens, invalid, number};
use crate::{
    core::Error,
    pricing::{self, Table},
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

const ROLLUP_SLOT_MS: u64 = 300_000;
/// The shortest window Core serves from the rollup that is a whole number of slots.
/// A start nearer the cut is summed from this window's five-minute series instead,
/// so every value reads the same tier and ends at the same instant.
const RECENT_MS: u64 = 3_900_000;
const RECENT_SLOTS: u64 = RECENT_MS / ROLLUP_SLOT_MS;
/// The pace windows, ending at the cut.
pub const PACE_MS: [u64; 3] = [10_800_000, 21_600_000, 86_400_000];
/// Core takes at most three distinct windows per request.
const WINDOWS_PER_REQUEST: usize = 3;

/// The windows one report reads, all ending at `to_ms`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plan {
    pub requested_from_ms: u64,
    pub from_ms: u64,
    pub to_ms: u64,
    /// Ascending: the spend start, the pace starts and every rate start between the
    /// earliest of them and the cut.
    starts: Vec<u64>,
}

impl Plan {
    /// `to_ms` is the rollup's last closed slot at the pinned cut. The spend start is
    /// rounded up to a slot, so no spend from before the request is claimed.
    pub fn new(requested_from_ms: u64, to_ms: u64, table: &Table) -> Self {
        let from_ms = requested_from_ms
            .div_ceil(ROLLUP_SLOT_MS)
            .saturating_mul(ROLLUP_SLOT_MS)
            .min(to_ms);
        let mut starts: BTreeSet<u64> = PACE_MS
            .iter()
            .map(|window| to_ms.saturating_sub(*window))
            .chain([from_ms])
            .collect();
        let earliest = *starts.first().expect("a start");
        starts.extend(
            table
                .rate_starts()
                .into_iter()
                .filter(|start| (earliest + 1..to_ms).contains(start)),
        );
        Self {
            requested_from_ms,
            from_ms,
            to_ms,
            starts: starts.into_iter().collect(),
        }
    }

    /// The earliest start: every value lies after it.
    pub fn earliest_ms(&self) -> u64 {
        self.starts[0]
    }

    /// Starts read as their own window, ascending.
    fn direct(&self) -> Vec<u64> {
        self.starts
            .iter()
            .copied()
            .filter(|start| self.to_ms - start >= RECENT_MS)
            .collect()
    }

    fn recent(&self) -> bool {
        self.starts
            .iter()
            .any(|start| self.to_ms - start < RECENT_MS && *start < self.to_ms)
    }

    /// `consumption.history` inputs for one batch, without identities and cut:
    /// `(windowsMs, maxBuckets)`.
    pub fn requests(&self) -> Vec<(Vec<u64>, u64)> {
        let windows: Vec<u64> = self
            .direct()
            .into_iter()
            .map(|start| self.to_ms - start)
            .collect();
        let mut requests: Vec<(Vec<u64>, u64)> = windows
            .chunks(WINDOWS_PER_REQUEST)
            .map(|chunk| (chunk.to_vec(), 1))
            .collect();
        if self.recent() {
            requests.push((vec![RECENT_MS], RECENT_SLOTS));
        }
        requests
    }
}

/// One model's share of a window.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Share {
    tokens: Tokens,
    cache_write: Option<u64>,
}

impl Share {
    fn add(self, other: Self) -> Option<Self> {
        Some(Self {
            tokens: self.tokens.add(other.tokens)?,
            cache_write: self
                .cache_write
                .zip(other.cache_write)
                .map(|(a, b)| a.checked_add(b))
                .unwrap_or(None),
        })
    }
    /// None when the later window holds more than the earlier one: a split Core dropped.
    fn sub(self, other: Self) -> Option<Self> {
        Some(Self {
            tokens: self.tokens.sub(other.tokens)?,
            cache_write: match (self.cache_write, other.cache_write) {
                (Some(a), Some(b)) => Some(a.checked_sub(b)?),
                _ => None,
            },
        })
    }
}

/// One seat's evidence for the window from a start to the cut.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Aggregate {
    models: BTreeMap<String, Share>,
    /// Tokens no model row covers.
    unattributed: bool,
    complete: bool,
    /// Core keeps nothing before this instant for the seat.
    retained_from_ms: u64,
}

impl Aggregate {
    fn empty(to_ms: u64) -> Self {
        Self {
            complete: true,
            retained_from_ms: to_ms,
            ..Self::default()
        }
    }

    fn absorb(&mut self, bucket: &Value) -> Result<(), Error> {
        let totals = Tokens::read(bucket).ok_or_else(|| invalid("consumption bucket"))?;
        let mut held = Tokens::default();
        for row in super::models(bucket, totals)?.into_iter().flatten() {
            held = held
                .add(row.tokens)
                .ok_or_else(|| invalid("consumption attribution"))?;
            let share = Share {
                tokens: row.tokens,
                cache_write: row.cache_write,
            };
            let entry = self.models.entry(row.model_id).or_insert(Share {
                cache_write: Some(0),
                ..Share::default()
            });
            *entry = entry
                .add(share)
                .ok_or_else(|| invalid("consumption attribution"))?;
        }
        self.unattributed |= totals != held;
        self.complete &= bucket["complete"] == true;
        Ok(())
    }
}

/// One seat's aggregates by start; None for an identity Core did not find.
pub struct SeatEvidence(Option<BTreeMap<u64, Aggregate>>);

fn window_of(identity: &Value, window_ms: u64, to_ms: u64) -> Result<&Value, Error> {
    identity["windows"]
        .as_array()
        .and_then(|windows| {
            windows
                .iter()
                .find(|w| number(&w["windowMs"]) == Some(window_ms))
        })
        .filter(|window| number(&window["toMs"]) == Some(to_ms))
        .ok_or_else(|| invalid("consumption window"))
}

/// A seat with no evidence at all is incomplete coverage, not a retention limit.
fn retained(window: &Value) -> Result<u64, Error> {
    if window["availableFromMs"].is_null() {
        return Ok(0);
    }
    number(&window["retainedFromMs"]).ok_or_else(|| invalid("consumption window"))
}

/// Reads one batch's answers to `plan.requests()`, in order, into each seat's evidence.
pub fn read(plan: &Plan, answers: &[Value], ids: &[String]) -> Result<Vec<SeatEvidence>, Error> {
    let requests = plan.requests();
    if answers.len() != requests.len() {
        return Err(invalid("consumption history"));
    }
    let answers: Vec<&Vec<Value>> = answers
        .iter()
        .map(|answer| super::identity(answer, ids))
        .collect::<Result<_, _>>()?;
    let mut seats = Vec::with_capacity(ids.len());
    for index in 0..ids.len() {
        if answers.iter().any(|answer| answer[index]["found"] != true) {
            seats.push(SeatEvidence(None));
            continue;
        }
        let mut by_start = BTreeMap::new();
        for ((windows, max), answer) in requests.iter().zip(&answers) {
            let identity = &answer[index];
            if *max == RECENT_SLOTS {
                let window = window_of(identity, RECENT_MS, plan.to_ms)?;
                let buckets = window["buckets"]
                    .as_array()
                    .ok_or_else(|| invalid("consumption series"))?;
                let retained_from_ms = retained(window)?;
                for start in plan
                    .starts
                    .iter()
                    .filter(|start| plan.to_ms - **start < RECENT_MS && **start < plan.to_ms)
                {
                    let mut aggregate = Aggregate {
                        retained_from_ms,
                        ..Aggregate::empty(plan.to_ms)
                    };
                    for bucket in buckets {
                        let from = number(&bucket["fromMs"])
                            .ok_or_else(|| invalid("consumption series"))?;
                        if from >= *start {
                            aggregate.absorb(bucket)?;
                        }
                    }
                    if window["availableFromMs"].is_null() {
                        aggregate.complete = false;
                    }
                    by_start.insert(*start, aggregate);
                }
                continue;
            }
            for window_ms in windows {
                let window = window_of(identity, *window_ms, plan.to_ms)?;
                let mut aggregate = Aggregate {
                    retained_from_ms: retained(window)?,
                    ..Aggregate::empty(plan.to_ms)
                };
                match window["buckets"].as_array().map(Vec::as_slice) {
                    Some([bucket]) => aggregate.absorb(bucket)?,
                    _ => return Err(invalid("consumption history")),
                }
                if window["availableFromMs"].is_null() {
                    aggregate.complete = false;
                }
                by_start.insert(plan.to_ms - window_ms, aggregate);
            }
        }
        // A start at the cut is an empty window.
        for start in &plan.starts {
            by_start
                .entry(*start)
                .or_insert_with(|| Aggregate::empty(plan.to_ms));
        }
        seats.push(SeatEvidence(Some(by_start)));
    }
    Ok(seats)
}

/// One reported value as it is built up.
#[derive(Default)]
struct Spent {
    usd_micros: Option<u64>,
    reasons: BTreeSet<&'static str>,
    models: BTreeSet<String>,
}

impl Spent {
    fn new() -> Self {
        Self {
            usd_micros: Some(0),
            ..Self::default()
        }
    }
    fn json(&self) -> Value {
        let complete = self.reasons.is_empty();
        json!({
            "usdMicros": self.usd_micros,
            "complete": complete,
            "lowerBound": self.usd_micros.is_some() && !complete,
            "reasons": self.reasons,
        })
    }
}

/// Every provider's value for the window from `start` to the cut.
fn values(
    plan: &Plan,
    start: u64,
    seats: &[SeatEvidence],
    shared: &[&'static str],
    table: &Table,
) -> BTreeMap<&'static str, Spent> {
    let mut values: BTreeMap<&'static str, Spent> = pricing::PROVIDERS
        .iter()
        .map(|(provider, _)| (*provider, Spent::new()))
        .collect();
    let mut everyone: BTreeSet<&'static str> = shared.iter().copied().collect();
    let segments: Vec<(u64, Option<u64>)> = plan
        .starts
        .iter()
        .enumerate()
        .filter(|(_, from)| **from >= start)
        .map(|(index, from)| (*from, plan.starts.get(index + 1).copied()))
        .collect();
    for SeatEvidence(evidence) in seats {
        let Some(by_start) = evidence else { continue };
        let whole = &by_start[&start];
        if !whole.complete {
            everyone.insert("coverage_partial");
        }
        if whole.retained_from_ms > start {
            everyone.insert("before_retention");
        }
        if whole.unattributed {
            everyone.insert("unattributed");
        }
        for (from, next) in &segments {
            let later = next.map(|next| &by_start[&next]);
            // A later window holding a model the earlier one lacks: a dropped split.
            for model in later.into_iter().flat_map(|later| later.models.keys()) {
                if !by_start[from].models.contains_key(model) {
                    match pricing::provider_of(model) {
                        Some(provider) => {
                            let value = values.get_mut(provider).expect("every provider");
                            value.reasons.insert("attribution_split_dropped");
                            value.models.insert(model.clone());
                        }
                        None => {
                            everyone.insert("unmapped_model");
                        }
                    }
                }
            }
            for (model, share) in &by_start[from].models {
                let provider = pricing::provider_of(model);
                let segment = match later.and_then(|later| later.models.get(model)) {
                    Some(after) => share.sub(*after),
                    None => Some(*share),
                };
                let Some(provider) = provider else {
                    if segment.is_none_or(|segment| !segment.tokens.is_zero()) {
                        everyone.insert("unmapped_model");
                    }
                    continue;
                };
                let value = values.get_mut(provider).expect("every provider");
                let Some(segment) = segment else {
                    value.reasons.insert("attribution_split_dropped");
                    value.models.insert(model.clone());
                    continue;
                };
                if segment.tokens.is_zero() {
                    continue;
                }
                value.models.insert(model.clone());
                let tokens = pricing::Tokens {
                    input: segment.tokens.input,
                    cached: segment.tokens.cached,
                    cache_write: segment.cache_write,
                    output: segment.tokens.output,
                };
                match table.quote(model, *from, tokens) {
                    Ok(quote) => {
                        if quote.lower_bound {
                            value.reasons.insert(pricing::CACHE_WRITE_UNREPORTED);
                        }
                        value.usd_micros = value
                            .usd_micros
                            .and_then(|sum| sum.checked_add(quote.usd_micros))
                            .filter(|sum| *sum <= super::MAX);
                        if value.usd_micros.is_none() {
                            value.reasons.insert(pricing::Unpriced::Unsafe.reason());
                        }
                    }
                    Err(unpriced) => {
                        value.usd_micros = None;
                        value.reasons.insert(unpriced.reason());
                    }
                }
            }
        }
    }
    for value in values.values_mut() {
        value.reasons.extend(everyone.iter().copied());
    }
    values
}

/// The report's `spend` section. `shared` are reasons that reach every value, such as a
/// failed batch (`usage_unreadable`) or retired seats that could not be listed.
pub fn section(
    plan: &Plan,
    seats: &[SeatEvidence],
    shared: &[&'static str],
    table: &Table,
) -> Value {
    let total = values(plan, plan.from_ms, seats, shared, table);
    let paces: Vec<(u64, BTreeMap<&'static str, Spent>)> = PACE_MS
        .iter()
        .map(|window| {
            let start = plan.to_ms.saturating_sub(*window);
            (*window, values(plan, start, seats, shared, table))
        })
        .collect();
    let providers: Vec<Value> = total
        .iter()
        .map(|(provider, value)| {
            let pace: Vec<Value> = paces
                .iter()
                .map(|(window, values)| {
                    let mut entry = values[provider].json();
                    entry["windowMs"] = json!(window);
                    entry["fromMs"] = json!(plan.to_ms.saturating_sub(*window));
                    entry["toMs"] = json!(plan.to_ms);
                    entry
                })
                .collect();
            json!({
                "provider": provider,
                "fromMs": plan.from_ms,
                "toMs": plan.to_ms,
                "models": value.models,
                "total": value.json(),
                "pace": pace,
            })
        })
        .collect();
    json!({
        "requestedFromMs": plan.requested_from_ms,
        "fromMs": plan.from_ms,
        "toMs": plan.to_ms,
        "providers": providers,
    })
}

#[cfg(test)]
pub(crate) mod tests;
