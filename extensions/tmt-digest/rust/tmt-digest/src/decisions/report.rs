//! The savings report: what the delivered digests saved against delivering every
//! message on its own, and optionally what another interval would have done. Only
//! arrival and settlement times are used, so every recomputed figure is an estimate.

use crate::{
    history::{ChecklistSettlement, Coverage, Decision},
    pricing::Resolved,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub mod wake;
use wake::{Arrivals, WakeTurn};

pub const METHOD: &str = "arrival-batching-v1";
/// A delivery is matched to the tick's decision row written just after it settled.
const MATCH_MS: u64 = 120_000;
const UNRECORDED: &str = "unrecorded";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Recompute {
    pub interval_ms: u64,
    pub flush_count: u64,
}

pub struct Input<'a> {
    pub since: &'a str,
    pub from_ms: u64,
    pub through_ms: u64,
    pub settlements: &'a [(String, ChecklistSettlement)],
    pub decisions: &'a [Decision],
    pub coverage: &'a BTreeMap<String, Coverage>,
    pub names: &'a BTreeMap<String, String>,
    pub recompute: Option<Recompute>,
    /// Core's measured wake-up turns in the window; none when Core could not answer.
    pub wake_turns: Option<&'a [WakeTurn]>,
    pub prices: &'a Resolved,
}

#[derive(Default)]
struct Excluded {
    not_delivered: u64,
    incomplete: u64,
    clock: u64,
}

#[derive(Default)]
struct Tally {
    messages: u64,
    deliveries: u64,
    by_rule: BTreeMap<&'static str, u64>,
    delays: Vec<u64>,
    /// Each member's own arrival order, for the recomputed batches.
    arrivals: Vec<u64>,
    excluded: Excluded,
    recomputed_deliveries: u64,
    recomputed_delays: Vec<u64>,
    /// The arrival phases of the delivered messages (#6453).
    phases: Arrivals,
}

pub fn document(input: &Input<'_>) -> Value {
    // Settlements arrive grouped by member, so one pass keeps one rule pool each.
    let mut members: BTreeMap<&str, Tally> = BTreeMap::new();
    let mut pools: BTreeMap<&str, Vec<(u64, &'static str, bool)>> = BTreeMap::new();
    for (id, checklist) in input.settlements {
        let pool = pools
            .entry(id)
            .or_insert_with(|| delivered_rules(input.decisions, id));
        tally(members.entry(id).or_default(), checklist, pool);
    }
    let mut total = Tally::default();
    let mut rows = vec![];
    for (id, mut member) in members {
        if let Some(recompute) = input.recompute {
            member.arrivals.sort_unstable();
            let (deliveries, delays) = batch(&member.arrivals, recompute);
            member.recomputed_deliveries = deliveries;
            member.recomputed_delays = delays;
        }
        rows.push(member_json(id, &member, input));
        merge(&mut total, member);
    }
    let mut summary = with_wake(
        figures(&total, input.recompute.is_some()),
        None,
        &total,
        input,
    );
    summary["avoidedCost"] = wake::total_cost(&rows, input.wake_turns.is_some());
    let mut document = json!({
        "version": 1,
        "since": input.since,
        "fromMs": input.from_ms,
        "throughMs": input.through_ms,
        "baseline": "each message delivered on its own; turnsSaved is an upper bound, because a busy agent may combine queued messages anyway",
        "delayBasis": "settled minus arrival",
        "members": rows,
        "total": summary,
        "wakeMethod": wake::method(input.prices),
    });
    if let Some(recompute) = input.recompute {
        document["recompute"] = json!({
            "method": METHOD, "intervalMs": recompute.interval_ms,
            "flushCount": recompute.flush_count, "estimate": true,
            "notes": [
                "Estimated from arrival times only: Core's readiness wait is not modelled, so a recomputed delay is a lower bound.",
                "Use it to compare intervals, not as a prediction."
            ],
        });
    }
    document
}

/// The member's delivered decision rows by time, each usable once.
fn delivered_rules(decisions: &[Decision], id: &str) -> Vec<(u64, &'static str, bool)> {
    decisions
        .iter()
        .filter(|row| row.identity_id == id && row.outcome == Some("delivered"))
        .map(|row| (row.at_ms, row.rule.text(), false))
        .collect()
}

fn tally(
    member: &mut Tally,
    checklist: &ChecklistSettlement,
    rules: &mut [(u64, &'static str, bool)],
) {
    if checklist.outcome != "delivered" {
        member.excluded.not_delivered += 1;
        return;
    }
    let (Some(settled), Some(sealed)) = (checklist.settled_at_ms, checklist.sealed_count) else {
        member.excluded.incomplete += 1;
        return;
    };
    // Every message's arrival is needed, both to count the batch and to time it.
    if !checklist.membership_complete
        || checklist.next_item_after.is_some()
        || checklist.items.len() as u64 != sealed
    {
        member.excluded.incomplete += 1;
        return;
    }
    if checklist
        .items
        .iter()
        .any(|item| item.created_at_ms > settled)
    {
        member.excluded.clock += 1;
        return;
    }
    member.messages += sealed;
    member.deliveries += 1;
    for item in &checklist.items {
        member.delays.push(settled - item.created_at_ms);
        member.arrivals.push(item.created_at_ms);
    }
    member.phases.add(
        &checklist
            .items
            .iter()
            .map(|item| item.phase_at_arrival.as_deref())
            .collect::<Vec<_>>(),
    );
    let rule = rules
        .iter_mut()
        .find(|(at, _, used)| {
            !*used && *at >= checklist.claimed_at_ms && *at <= settled.saturating_add(MATCH_MS)
        })
        .map(|entry| {
            entry.2 = true;
            entry.1
        })
        .unwrap_or(UNRECORDED);
    *member.by_rule.entry(rule).or_default() += 1;
}

/// A batch starts at the first unsent arrival and is delivered when its oldest
/// message has waited the interval, or when the flush count is reached, taking
/// everything that arrived by then. Returns the batches and each message's delay.
fn batch(arrivals: &[u64], recompute: Recompute) -> (u64, Vec<u64>) {
    let (mut index, mut deliveries, mut delays) = (0, 0, Vec::with_capacity(arrivals.len()));
    while index < arrivals.len() {
        let due = arrivals[index].saturating_add(recompute.interval_ms);
        let counted = usize::try_from(recompute.flush_count)
            .ok()
            .and_then(|count| count.checked_sub(1))
            .and_then(|offset| arrivals.get(index.saturating_add(offset)));
        let at = counted.map_or(due, |counted| due.min(*counted));
        while index < arrivals.len() && arrivals[index] <= at {
            delays.push(at - arrivals[index]);
            index += 1;
        }
        deliveries += 1;
    }
    (deliveries, delays)
}

fn merge(total: &mut Tally, member: Tally) {
    total.messages += member.messages;
    total.deliveries += member.deliveries;
    for (rule, count) in member.by_rule {
        *total.by_rule.entry(rule).or_default() += count;
    }
    total.delays.extend(member.delays);
    total.excluded.not_delivered += member.excluded.not_delivered;
    total.excluded.incomplete += member.excluded.incomplete;
    total.excluded.clock += member.excluded.clock;
    total.recomputed_deliveries += member.recomputed_deliveries;
    total.recomputed_delays.extend(member.recomputed_delays);
    total.phases.merge(&member.phases);
}

/// Nearest-rank median, 90th percentile and maximum, or null with no messages.
fn delay(values: &[u64]) -> Value {
    if values.is_empty() {
        return Value::Null;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let rank = |percent: usize| sorted[(sorted.len() * percent).div_ceil(100).max(1) - 1];
    json!({"median": rank(50), "p90": rank(90), "max": sorted[sorted.len() - 1]})
}

fn figures(tally: &Tally, recomputed: bool) -> Value {
    let mut by_rule: serde_json::Map<String, Value> = tally
        .by_rule
        .iter()
        .map(|(rule, count)| ((*rule).to_owned(), json!(count)))
        .collect();
    let mut value = json!({
        "messages": tally.messages,
        "baseline": {"deliveries": tally.messages},
        "actual": {
            "deliveries": tally.deliveries,
            "delayMs": delay(&tally.delays),
            "byRule": Value::Object(std::mem::take(&mut by_rule)),
        },
        "turnsSaved": tally.messages.saturating_sub(tally.deliveries),
        "excluded": {
            "notDelivered": tally.excluded.not_delivered,
            "incomplete": tally.excluded.incomplete,
            "clock": tally.excluded.clock,
        },
    });
    if recomputed {
        value["recomputed"] = json!({
            "deliveries": tally.recomputed_deliveries,
            "delayMs": delay(&tally.recomputed_delays),
            "turnsSaved": tally.messages.saturating_sub(tally.recomputed_deliveries),
        });
    }
    value
}

/// The figures with the member's (or, for `None`, every member's) measured wake-up turns.
fn with_wake(mut value: Value, id: Option<&str>, tally: &Tally, input: &Input<'_>) -> Value {
    let turns = input.wake_turns.map(|turns| {
        turns
            .iter()
            .filter(|turn| id.is_none_or(|id| turn.identity_id == id))
            .collect::<Vec<_>>()
    });
    let wake = wake::figures(turns.as_deref(), &tally.phases, input.prices.table());
    for (key, field) in wake.as_object().into_iter().flatten() {
        value[key] = field.clone();
    }
    value
}

fn member_json(id: &str, tally: &Tally, input: &Input<'_>) -> Value {
    let mut value = with_wake(
        figures(tally, input.recompute.is_some()),
        Some(id),
        tally,
        input,
    );
    value["id"] = json!(id);
    value["name"] = json!(input.names.get(id));
    value["coverage"] = match input.coverage.get(id) {
        Some(coverage) => {
            let starts = input.from_ms.max(coverage.started).max(coverage.raw_from);
            json!({
                "startsAtMs": starts,
                "collectedThroughMs": coverage.through,
                "complete": starts == input.from_ms && coverage.gap.is_none(),
                "gap": coverage.gap,
            })
        }
        None => Value::Null,
    };
    value
}

#[cfg(test)]
mod tests;
