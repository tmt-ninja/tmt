//! Driver shares are independent of model shares. Never invent their joint attribution.
use super::{Error, MAX, ModelTotals, Seat, Tokens, Value, invalid, json, provider_id};
use crate::pricing::{Table, Tokens as Priced};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq)]
pub(super) struct DriverTotals {
    driver: String,
    tokens: Tokens,
}

pub(super) fn read(bucket: &Value, totals: Tokens) -> Result<Option<Vec<DriverTotals>>, Error> {
    let Some(value) = bucket.get("byDriver") else {
        return Ok(None);
    };
    let rows = value
        .as_array()
        .filter(|rows| rows.len() <= 4)
        .ok_or_else(|| invalid("driver attribution"))?;
    let mut parsed: Vec<DriverTotals> = Vec::with_capacity(rows.len());
    let mut sum = Tokens::default();
    for row in rows {
        let driver = row["driver"]
            .as_str()
            .filter(|id| provider_id(id))
            .ok_or_else(|| invalid("driver attribution"))?;
        let tokens = Tokens::read(row)
            .filter(|tokens| {
                tokens.cached <= tokens.input
                    && tokens
                        .input
                        .checked_add(tokens.output)
                        .is_some_and(|n| n <= MAX)
            })
            .ok_or_else(|| invalid("driver attribution"))?;
        if parsed
            .last()
            .is_some_and(|old| old.driver.as_str() >= driver)
        {
            return Err(invalid("driver attribution"));
        }
        sum = sum
            .add(tokens)
            .ok_or_else(|| invalid("driver attribution"))?;
        parsed.push(DriverTotals {
            driver: driver.into(),
            tokens,
        });
    }
    totals
        .sub(sum)
        .ok_or_else(|| invalid("driver attribution"))?;
    Ok(Some(parsed))
}

fn cost(seat: &Seat, prices: &Table, at_ms: u64) -> Result<u64, &'static str> {
    let drivers = seat.by_driver.as_deref().unwrap_or_default();
    if drivers.len() != 1 || drivers[0].tokens != seat.totals {
        return Err("driver_model_attribution_unknown");
    }
    let models = seat
        .by_model
        .as_deref()
        .ok_or("model_attribution_unknown")?;
    let input = models
        .iter()
        .try_fold(0u64, |sum, ModelTotals { tokens, .. }| {
            sum.checked_add(tokens.input)
        });
    if input != Some(seat.totals.input) {
        return Err("model_attribution_unknown");
    }
    // The driver row's input cost: model-attributed input at each model's uncached input
    // rate. The full per-class cost is per model (`usage.models`), since a driver share has
    // no class split by model.
    models.iter().try_fold(0u64, |sum, model| {
        let quote = prices
            .quote(
                &model.model_id,
                at_ms,
                Priced::uncached_input(model.tokens.input),
            )
            .map_err(|why| why.reason())?;
        sum.checked_add(quote.usd_micros)
            .filter(|n| *n <= MAX)
            .ok_or("unsafe_cost")
    })
}

#[derive(Default)]
struct Provider {
    tokens: Tokens,
    seats: BTreeSet<String>,
    partial: BTreeSet<String>,
    micros: u64,
    reasons: BTreeSet<&'static str>,
}

/// Totals come from Core's totals read, not rounded series or the latest seat driver.
pub(super) fn section(
    seats: &[Seat],
    prices: &Table,
    at_ms: u64,
) -> Result<(Vec<Value>, Tokens), Error> {
    let mut providers = BTreeMap::<&str, Provider>::new();
    let mut unattributed = Tokens::default();
    for seat in seats {
        let mut attributed = Tokens::default();
        for driver in seat.by_driver.iter().flatten() {
            attributed = attributed
                .add(driver.tokens)
                .ok_or_else(|| invalid("provider total"))?;
            if driver.tokens.is_zero() {
                continue;
            }
            let row = providers.entry(&driver.driver).or_default();
            row.tokens = row
                .tokens
                .add(driver.tokens)
                .filter(|tokens| {
                    tokens
                        .input
                        .checked_add(tokens.output)
                        .is_some_and(|n| n <= MAX)
                })
                .ok_or_else(|| invalid("provider total"))?;
            row.seats.insert(seat.label.id.clone());
            if !seat.complete {
                row.partial.insert(seat.label.id.clone());
            }
            match cost(seat, prices, at_ms) {
                Ok(micros) => match row.micros.checked_add(micros).filter(|n| *n <= MAX) {
                    Some(sum) => row.micros = sum,
                    None => {
                        row.reasons.insert("unsafe_cost");
                    }
                },
                Err(reason) => {
                    row.reasons.insert(reason);
                }
            }
        }
        let rest = seat
            .totals
            .sub(attributed)
            .ok_or_else(|| invalid("driver attribution"))?;
        unattributed = unattributed
            .add(rest)
            .ok_or_else(|| invalid("provider total"))?;
    }
    let rows = providers
        .into_iter()
        .map(|(driver, row)| {
            json!({
                "driver": driver, "totals": row.tokens.json(), "seats": row.seats,
                "partialSeats": row.partial.len(),
                "inputCost": row.reasons.is_empty().then(|| json!({"usdMicros": row.micros})),
                "costUnavailable": row.reasons,
            })
        })
        .collect();
    Ok((rows, unattributed))
}
