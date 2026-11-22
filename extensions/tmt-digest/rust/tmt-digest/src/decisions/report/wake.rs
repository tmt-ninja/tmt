//! Measured wake-up turns (#6453): what one delivered wake-up cost the member, from Core's
//! `digest.wakeTurns`, and what the held messages that arrived while their member was idle
//! would have cost delivered one by one. Core measures tokens; only this report prices them,
//! from its own price table, and a model without a price row stays unpriced, never guessed.

use crate::{
    core::Error,
    pricing::{Resolved, Table},
};
use serde_json::{Value, json};

/// One ended turn that carried at least one handed-over request.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WakeTurn {
    pub identity_id: String,
    pub ended_at_ms: u64,
    pub measured: bool,
    /// Input plus output tokens; none when Core kept no sum.
    pub tokens: Option<u64>,
    pub input_tokens: Option<u64>,
    /// Input tokens per model; none when the split is unknown.
    pub by_model: Option<Vec<(String, u64)>>,
}

fn invalid() -> Error {
    Error::new(
        "CORE_RESPONSE_INVALID",
        "Core returned an invalid wake-turn page",
    )
}

/// The turns of one `digest.wakeTurns` page, and whether more follow.
pub fn parse(page: &Value) -> Result<(Vec<WakeTurn>, bool), Error> {
    let number = |value: &Value| value.as_u64().ok_or_else(invalid);
    let mut turns = vec![];
    for turn in page["turns"].as_array().ok_or_else(invalid)? {
        let tokens = &turn["tokens"];
        let (tokens, input) = if tokens.is_null() {
            (None, None)
        } else {
            let input = number(&tokens["inputTokens"])?;
            let output = number(&tokens["outputTokens"])?;
            (
                Some(input.checked_add(output).ok_or_else(invalid)?),
                Some(input),
            )
        };
        let by_model = match &turn["byModel"] {
            Value::Null => None,
            rows => Some(
                rows.as_array()
                    .ok_or_else(invalid)?
                    .iter()
                    .map(|row| {
                        Ok((
                            row["modelId"].as_str().ok_or_else(invalid)?.to_owned(),
                            number(&row["inputTokens"])?,
                        ))
                    })
                    .collect::<Result<Vec<_>, Error>>()?,
            ),
        };
        turns.push(WakeTurn {
            identity_id: turn["identityId"].as_str().ok_or_else(invalid)?.to_owned(),
            ended_at_ms: number(&turn["endedAtMs"])?,
            measured: turn["measured"].as_bool().ok_or_else(invalid)?,
            tokens,
            input_tokens: input,
            by_model,
        });
    }
    Ok((turns, page["more"].as_bool().ok_or_else(invalid)?))
}

/// The turn's API-equivalent cost in USD micros, or why it has none.
fn cost(turn: &WakeTurn, prices: &Table) -> Result<u64, &'static str> {
    let rows = turn.by_model.as_ref().ok_or("unattributed")?;
    // A share no model claims cannot be priced without guessing its model.
    if Some(rows.iter().map(|(_, input)| *input).sum::<u64>()) != turn.input_tokens {
        return Err("unattributed");
    }
    rows.iter().try_fold(0u64, |total, (model, input)| {
        let quote = prices
            .quote(model, turn.ended_at_ms, *input)
            .ok_or("no_price")?;
        Ok(total.saturating_add(quote["usdMicros"].as_u64().ok_or("no_price")?))
    })
}

/// Count, rounded mean and nearest-rank median, or null without values.
fn stats(values: &mut [u64]) -> Value {
    if values.is_empty() {
        return Value::Null;
    }
    values.sort_unstable();
    let count = values.len() as u64;
    let sum: u128 = values.iter().map(|value| u128::from(*value)).sum();
    json!({
        "count": count,
        "mean": u64::try_from((sum + u128::from(count) / 2) / u128::from(count)).unwrap_or(u64::MAX),
        "median": median(values),
    })
}

fn median(sorted: &[u64]) -> u64 {
    sorted[sorted.len().div_ceil(2) - 1]
}

/// The arrival phases of one member's delivered messages.
#[derive(Default, Clone, Copy)]
pub struct Arrivals {
    pub working: u64,
    pub waiting: u64,
    pub idle: u64,
    pub unknown: u64,
    /// Delivered checklists whose every message has a known phase, and their idle arrivals.
    pub known_deliveries: u64,
    pub known_idle: u64,
}

impl Arrivals {
    pub fn add(&mut self, phases: &[Option<&str>]) {
        let mut known = true;
        let mut idle = 0;
        for phase in phases {
            match phase {
                Some("working") => self.working += 1,
                Some("waiting") => self.waiting += 1,
                Some("idle") => {
                    self.idle += 1;
                    idle += 1;
                }
                _ => {
                    self.unknown += 1;
                    known = false;
                }
            }
        }
        if known {
            self.known_deliveries += 1;
            self.known_idle += idle;
        }
    }

    pub fn merge(&mut self, other: &Self) {
        self.working += other.working;
        self.waiting += other.waiting;
        self.idle += other.idle;
        self.unknown += other.unknown;
        self.known_deliveries += other.known_deliveries;
        self.known_idle += other.known_idle;
    }

    /// Wake-ups a member that was idle would have taken one by one, less the deliveries that
    /// woke it instead. Negative when Digest added wake-ups. Messages that arrived while it was
    /// working or waiting would have joined that turn, so they save nothing.
    fn measured_saved(&self) -> Option<i64> {
        (self.known_deliveries > 0).then(|| self.known_idle as i64 - self.known_deliveries as i64)
    }
}

/// The wake-up and arrival figures for one member or the total.
pub fn figures(turns: Option<&[&WakeTurn]>, arrivals: &Arrivals, prices: &Table) -> Value {
    let measured_saved = arrivals.measured_saved();
    let mut value = json!({
        "measuredSaved": measured_saved,
        "measuredSavedBasis": {
            "deliveries": arrivals.known_deliveries,
            "idleArrivals": arrivals.known_idle,
        },
        "arrivals": {
            "idle": arrivals.idle, "working": arrivals.working,
            "waiting": arrivals.waiting, "unknown": arrivals.unknown,
        },
    });
    let Some(turns) = turns else {
        value["wakeUps"] = Value::Null;
        value["avoidedCost"] =
            json!({"usdMicros": null, "reason": "wake_turns_unavailable", "estimate": true});
        return value;
    };
    let (mut measured, mut partial, mut costs) = (vec![], vec![], vec![]);
    let mut reason = "no_measured_turn";
    let mut unpriced = std::collections::BTreeSet::new();
    for turn in turns {
        match (turn.measured, turn.tokens) {
            (true, Some(tokens)) => {
                measured.push(tokens);
                match cost(turn, prices) {
                    Ok(micros) => costs.push(micros),
                    Err(why) => {
                        if reason != "no_price" {
                            reason = why;
                        }
                        unpriced.extend(
                            turn.by_model
                                .iter()
                                .flatten()
                                .filter(|(model, input)| {
                                    prices.quote(model, turn.ended_at_ms, *input).is_none()
                                })
                                .map(|(model, _)| model.clone()),
                        );
                    }
                }
            }
            (_, Some(tokens)) => partial.push(tokens),
            _ => {}
        }
    }
    // Priced only when every measured wake-up had a price: a median of some turns is never
    // stretched over turns whose model has none (#6794).
    let every_turn_priced = !measured.is_empty() && costs.len() == measured.len();
    costs.sort_unstable();
    let median_cost = (!costs.is_empty()).then(|| median(&costs));
    value["wakeUps"] = json!({
        "delivered": turns.len(),
        "measured": measured.len(),
        "tokensPerWake": {"measured": stats(&mut measured), "partial": stats(&mut partial)},
        "costPerWake": {
            "medianUsdMicros": median_cost,
            "priced": costs.len(),
            "reason": if median_cost.is_some() { Value::Null } else { reason.into() },
        },
    });
    value["avoidedCost"] = match (measured_saved, median_cost.filter(|_| every_turn_priced)) {
        (Some(saved), Some(cost)) => json!({
            "usdMicros": saved.saturating_mul(i64::try_from(cost).unwrap_or(i64::MAX)),
            "estimate": true,
        }),
        (None, _) => json!({"usdMicros": null, "reason": "no_known_arrivals", "estimate": true}),
        (_, None) => json!({"usdMicros": null, "reason": reason, "estimate": true,
            "unpricedModels": unpriced}),
    };
    value
}

/// The report's avoided cost: the sum over the members whose own cost is known, never a median
/// stretched over members whose wake-ups had no price (#6794). Every member with a measured
/// saving other than zero is listed as `covered`, or as `unpriced` with its saved wake-ups, the
/// models that had no price and why, and no cost.
pub fn total_cost(members: &[Value], turns_available: bool) -> Value {
    if !turns_available {
        return json!({"usdMicros": null, "reason": "wake_turns_unavailable", "estimate": true,
            "covered": [], "unpriced": []});
    }
    let (mut covered, mut unpriced, mut sum, mut known) = (vec![], vec![], 0i64, false);
    for member in members {
        let Some(saved) = member["measuredSaved"].as_i64() else {
            continue;
        };
        known = true;
        if saved == 0 {
            continue;
        }
        let cost = &member["avoidedCost"];
        match cost["usdMicros"].as_i64() {
            Some(micros) => {
                sum = sum.saturating_add(micros);
                covered.push(json!({"id": member["id"], "name": member["name"],
                    "measuredSaved": saved, "usdMicros": micros}));
            }
            None => unpriced.push(json!({"id": member["id"], "name": member["name"],
                "measuredSaved": saved,
                "models": cost.get("unpricedModels").cloned().unwrap_or_else(|| json!([])),
                "reason": cost["reason"]})),
        }
    }
    let usd = if !known {
        json!({"usdMicros": null, "reason": "no_known_arrivals"})
    } else if covered.is_empty() && !unpriced.is_empty() {
        let no_price = unpriced.iter().any(|row| row["reason"] == "no_price");
        json!({"usdMicros": null,
            "reason": if no_price { json!("no_price") } else { unpriced[0]["reason"].clone() }})
    } else {
        json!({"usdMicros": sum})
    };
    let mut value = json!({"estimate": true, "covered": covered, "unpriced": unpriced});
    for (key, field) in usd.as_object().into_iter().flatten() {
        value[key] = field.clone();
    }
    value
}

/// How every wake-up figure is made, stated once in the report.
/// The rules, and the price table in use: its version, date, basis and where it came from (`cached`
/// or `built-in`; a report never fetches), with the time a cached table was fetched.
pub fn method(prices: &Resolved) -> Value {
    let pricing = prices.document();
    json!({
        "measuredTurn": "Core's sum of the member's own 5-second usage buckets over the first turn after a hand-over; measured only when both turn boundaries carried a usage read and continuous complete reads cover the span between them, otherwise counted as partial",
        "tokens": "input plus output tokens; reasoning tokens are not in the usage record and are not counted",
        "cost": "API-equivalent: each model's input tokens at its listed rate; a model without a price row stays unpriced (no_price), and a share no model claims stays unpriced (unattributed)",
        "pricing": {"version": pricing["version"], "asOf": pricing["asOf"], "basis": pricing["basis"],
            "origin": pricing["origin"], "fetchedAtMs": pricing["fetchedAtMs"]},
        "measuredSaved": "held messages that arrived while their member was idle, less the deliveries of those checklists; counted only for checklists whose every message has a known arrival phase; messages that arrived while it was working or waiting would have joined that turn",
        "turnsSaved": "upper bound: every held message counted as its own wake-up",
        "avoidedCost": "estimate: measuredSaved times the member's median measured cost per wake-up, only when every measured wake-up had a price; the total is the sum over those members, with the members it covers and those without a price listed",
        "limits": [
            "A 5-second bucket cannot be split: the start bucket's earlier tokens are taken out, so a turn shorter than its reads may read as partial.",
            "Members whose driver reports no activity have unknown arrival phases and no measuredSaved.",
            "History before wake-up measurement has no measured turns.",
        ],
    })
}
