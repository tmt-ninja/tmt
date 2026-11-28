//! Spend from a start: windows, segments at rate starts, pace and every reason, against a
//! small Core simulator that answers each request from dated token events.

use super::*;
use crate::pricing::{built_in, day_start_ms};

const SEAT: &str = "10000000-0000-4000-8000-000000000001";
const HOUR: u64 = 3_600_000;

/// Tokens at an instant: `(at, model or None for unattributed, input, cached, write, output)`.
pub(crate) type Event = (u64, Option<&'static str>, u64, u64, Option<u64>, u64);

#[derive(Clone)]
pub(crate) struct Seat {
    pub(crate) id: &'static str,
    events: Vec<Event>,
    complete: bool,
    available_from: Option<u64>,
}

pub(crate) fn seat(events: Vec<Event>) -> Seat {
    Seat {
        id: SEAT,
        events,
        complete: true,
        available_from: Some(0),
    }
}

fn bucket(seat: &Seat, from: u64, to: u64) -> Value {
    let mut totals = [0u64; 3];
    let mut rows: BTreeMap<&str, (u64, u64, Option<u64>, u64)> = BTreeMap::new();
    for (at, model, input, cached, write, output) in &seat.events {
        if !(from..to).contains(at) {
            continue;
        }
        totals[0] += input;
        totals[1] += cached;
        totals[2] += output;
        if let Some(model) = model {
            let row = rows.entry(model).or_insert((0, 0, Some(0), 0));
            row.0 += input;
            row.1 += cached;
            row.2 = row.2.zip(*write).map(|(a, b)| a + b);
            row.3 += output;
        }
    }
    let by_model: Vec<Value> = rows
        .iter()
        .map(|(model, (input, cached, write, output))| {
            let mut row = json!({"modelId": model, "inputTokens": input,
                "cachedInputTokens": cached, "outputTokens": output});
            if let Some(write) = write {
                row["cacheWriteTokens"] = json!(write);
            }
            row
        })
        .collect();
    let mut bucket = json!({"fromMs": from, "toMs": to, "inputTokens": totals[0],
        "cachedInputTokens": totals[1], "outputTokens": totals[2],
        "coveredMs": if seat.complete { to - from } else { 0 },
        "complete": seat.complete, "gap": !seat.complete, "discontinuous": false});
    if !by_model.is_empty() {
        bucket["byModel"] = json!(by_model);
    }
    bucket
}

/// Core's answer to one request: each window ends at the cut, with `max` buckets.
pub(crate) fn answer(plan: &Plan, seats: &[Seat], windows: &[u64], max: u64) -> Value {
    let identities: Vec<Value> = seats
        .iter()
        .map(|seat| {
            let windows: Vec<Value> = windows
                .iter()
                .map(|window| {
                    let from = plan.to_ms - window;
                    let width = window / max;
                    let buckets: Vec<Value> = (0..max)
                        .map(|n| bucket(seat, from + n * width, from + (n + 1) * width))
                        .collect();
                    json!({"windowMs": window, "fromMs": from, "toMs": plan.to_ms,
                        "bucketMs": width, "resolutionMs": 300_000,
                        "availableFromMs": seat.available_from,
                        "retainedFromMs": seat.available_from.map(|at| at.max(plan.to_ms - 32 * 24 * HOUR)),
                        "buckets": buckets})
                })
                .collect();
            json!({"id": seat.id, "found": true, "windows": windows})
        })
        .collect();
    json!({"identities": identities})
}

fn report(plan: &Plan, seats: &[Seat], unreadable: bool) -> Value {
    let ids: Vec<String> = seats.iter().map(|seat| seat.id.to_owned()).collect();
    let answers: Vec<Value> = plan
        .requests()
        .iter()
        .map(|(windows, max)| answer(plan, seats, windows, *max))
        .collect();
    let evidence = read(plan, &answers, &ids).unwrap();
    section(
        plan,
        &evidence,
        if unreadable {
            &["usage_unreadable"]
        } else {
            &[]
        },
        built_in(),
    )
}

fn provider<'a>(section: &'a Value, name: &str) -> &'a Value {
    section["providers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["provider"] == name)
        .unwrap()
}

fn day(date: &str) -> u64 {
    day_start_ms(date).unwrap()
}

#[test]
fn a_start_is_rounded_up_and_every_window_ends_at_the_cut() {
    let to = day("2026-12-05") + 10 * HOUR;
    let plan = Plan::new(day("2026-11-25") + 1, to, built_in());
    assert_eq!(plan.from_ms, day("2026-11-25") + 300_000);
    // The spend start, the three pace starts and Gemini's 2026-12-01 rate start, each read
    // as its own window, at most three per request; none is near the cut.
    let requests = plan.requests();
    let windows: Vec<u64> = requests.iter().flat_map(|(w, _)| w.clone()).collect();
    assert_eq!(
        windows,
        vec![
            to - plan.from_ms,
            to - day("2026-12-01"),
            86_400_000,
            21_600_000,
            10_800_000
        ]
    );
    assert!(requests.iter().all(|(w, max)| w.len() <= 3 && *max == 1));
}

#[test]
fn spend_is_priced_per_segment_on_each_side_of_a_rate_start() {
    let boundary = day("2026-12-01");
    let to = boundary + 10 * HOUR;
    let plan = Plan::new(boundary - 2 * 24 * HOUR, to, built_in());
    let seats = [seat(vec![
        // gemini-4-argon: $2 per million input before 2026-12-01, $4 from it.
        (
            boundary - HOUR,
            Some("gemini-4-argon"),
            1_000_000,
            0,
            Some(0),
            0,
        ),
        (
            boundary + HOUR,
            Some("gemini-4-argon"),
            1_000_000,
            0,
            Some(0),
            0,
        ),
        // Claude without a cache-write count: a floor at the input rate.
        (
            to - 2 * HOUR,
            Some("claude-opus-5-5"),
            1_000_000,
            0,
            None,
            100_000,
        ),
    ])];
    let section = report(&plan, &seats, false);
    let google = provider(&section, "google");
    assert_eq!(
        google["total"],
        json!({"usdMicros": 6_000_000, "complete": true, "lowerBound": false, "reasons": []})
    );
    assert_eq!(google["models"], json!(["gemini-4-argon"]));
    // $4 x 1M input + $20 x 0.1M output, a floor.
    assert_eq!(
        provider(&section, "anthropic")["total"],
        json!({"usdMicros": 6_000_000, "complete": false, "lowerBound": true,
            "reasons": ["cache_write_unreported"]})
    );
    // A vendor with nothing recorded is a measured zero.
    assert_eq!(
        provider(&section, "openai")["total"],
        json!({"usdMicros": 0, "complete": true, "lowerBound": false, "reasons": []})
    );
    assert_eq!(
        (section["fromMs"].clone(), section["toMs"].clone()),
        (json!(plan.from_ms), json!(to))
    );
}

#[test]
fn pace_windows_hold_only_their_own_spend() {
    let to = day("2026-12-10") + 12 * HOUR;
    let plan = Plan::new(to - 5 * 24 * HOUR, to, built_in());
    let seats = [seat(vec![
        (to - 2 * HOUR, Some("gpt-6.2-sol"), 1_000_000, 0, Some(0), 0),
        (to - 5 * HOUR, Some("gpt-6.2-sol"), 1_000_000, 0, Some(0), 0),
        (
            to - 3 * 24 * HOUR,
            Some("gpt-6.2-sol"),
            1_000_000,
            0,
            Some(0),
            0,
        ),
    ])];
    let section = report(&plan, &seats, false);
    let openai = provider(&section, "openai");
    let spent: Vec<(Value, Value)> = openai["pace"]
        .as_array()
        .unwrap()
        .iter()
        .map(|pace| (pace["windowMs"].clone(), pace["usdMicros"].clone()))
        .collect();
    assert_eq!(
        spent,
        vec![
            (json!(10_800_000), json!(2_000_000)),
            (json!(21_600_000), json!(4_000_000)),
            (json!(86_400_000), json!(4_000_000)),
        ]
    );
    assert_eq!(openai["total"]["usdMicros"], json!(6_000_000));
}

#[test]
fn a_start_inside_the_newest_hour_reads_the_five_minute_series() {
    let to = day("2026-12-10") + 12 * HOUR;
    let plan = Plan::new(to - 20 * 60_000, to, built_in());
    assert!(plan.requests().contains(&(vec![3_900_000], 13)));
    let seats = [seat(vec![
        (
            to - 10 * 60_000,
            Some("gpt-6.2-sol"),
            1_000_000,
            0,
            Some(0),
            0,
        ),
        (
            to - 30 * 60_000,
            Some("gpt-6.2-sol"),
            1_000_000,
            0,
            Some(0),
            0,
        ),
    ])];
    let section = report(&plan, &seats, false);
    let openai = provider(&section, "openai");
    assert_eq!(openai["total"]["usdMicros"], json!(2_000_000));
    assert_eq!(openai["pace"][0]["usdMicros"], json!(4_000_000));
    // A start at the cut is an empty, complete window.
    let empty = Plan::new(to, to, built_in());
    assert_eq!(
        provider(&report(&empty, &seats, false), "openai")["total"],
        json!({"usdMicros": 0, "complete": true, "lowerBound": false, "reasons": []})
    );
}

#[test]
fn missing_evidence_is_a_reason_on_the_values_it_can_reach() {
    let to = day("2026-12-10") + 12 * HOUR;
    let plan = Plan::new(to - 5 * 24 * HOUR, to, built_in());
    let reasons = |seats: &[Seat], unreadable: bool, name: &str| {
        provider(&report(&plan, seats, unreadable), name)["total"].clone()
    };
    // Tokens no model row covers, or a model no vendor prefix names, could be anyone's.
    for (event, reason) in [
        ((to - HOUR, None, 10, 0, Some(0), 0), "unattributed"),
        (
            (to - HOUR, Some("o4-mini"), 10, 0, Some(0), 0),
            "unmapped_model",
        ),
    ] {
        for name in ["anthropic", "google", "openai"] {
            assert_eq!(
                reasons(&[seat(vec![event])], false, name),
                json!({"usdMicros": 0, "complete": false, "lowerBound": true, "reasons": [reason]}),
                "{reason} {name}"
            );
        }
    }
    // An unpriced model has no figure for its vendor only.
    let unpriced = [seat(vec![(to - HOUR, Some("claude-x"), 10, 0, Some(0), 0)])];
    assert_eq!(
        reasons(&unpriced, false, "anthropic"),
        json!({"usdMicros": null, "complete": false, "lowerBound": false, "reasons": ["no_price"]})
    );
    assert_eq!(reasons(&unpriced, false, "google")["complete"], json!(true));
    // Partial coverage, a start before retention, a failed batch.
    let mut partial = seat(vec![]);
    partial.complete = false;
    let mut late = seat(vec![]);
    late.available_from = Some(to - 24 * HOUR);
    for (seats, unreadable, reason) in [
        (vec![partial], false, "coverage_partial"),
        (vec![late], false, "before_retention"),
        (vec![seat(vec![])], true, "usage_unreadable"),
    ] {
        assert_eq!(
            reasons(&seats, unreadable, "openai"),
            json!({"usdMicros": 0, "complete": false, "lowerBound": true, "reasons": [reason]}),
            "{reason}"
        );
    }
}

#[test]
fn a_later_window_holding_more_than_an_earlier_one_is_a_dropped_split() {
    let to = day("2026-12-10") + 12 * HOUR;
    let plan = Plan::new(to - 5 * 24 * HOUR, to, built_in());
    let seats = [seat(vec![(
        to - HOUR,
        Some("gpt-6.2-sol"),
        1_000_000,
        0,
        Some(0),
        0,
    )])];
    let ids = vec![SEAT.to_owned()];
    let mut answers: Vec<Value> = plan
        .requests()
        .iter()
        .map(|(windows, max)| answer(&plan, &seats, windows, *max))
        .collect();
    // Core dropped the split of the longest window (more than four models in it).
    let longest = &mut answers[0]["identities"][0]["windows"][0]["buckets"][0];
    longest.as_object_mut().unwrap().remove("byModel");
    let section = section(
        &plan,
        &read(&plan, &answers, &ids).unwrap(),
        &[],
        built_in(),
    );
    let openai = provider(&section, "openai");
    assert_eq!(
        openai["total"]["reasons"],
        json!(["attribution_split_dropped", "unattributed"])
    );
    // The pace windows' own splits are whole.
    assert_eq!(openai["pace"][0]["complete"], json!(true));
}

#[test]
fn every_model_id_prefix_names_its_billing_vendor() {
    for (model, vendor) in [
        ("claude-opus-5-5", Some("anthropic")),
        ("gemini-4-argon-high", Some("google")),
        ("gpt-6.2-astra", Some("openai")),
        ("codex-auto-review", Some("openai")),
        ("o4-mini", None),
    ] {
        assert_eq!(crate::pricing::provider_of(model), vendor, "{model}");
    }
}
