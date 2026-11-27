//! Each model's list-price cost over the window, and each family line's total. Rates are
//! per model, so a model row is the honest unit; a line is priced only when every model
//! in it is, and a floor anywhere below makes the total a floor.
use super::{Error, MAX, Seat, Tokens, UNATTRIBUTED, Value, invalid, json, line_of};
use crate::pricing::{self, Table};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default)]
struct Cost {
    micros: u64,
    lower_bound: bool,
    reasons: BTreeSet<&'static str>,
}

impl Cost {
    fn add(&mut self, quote: Result<pricing::Quote, pricing::Unpriced>) {
        match quote {
            Ok(quote) => match self
                .micros
                .checked_add(quote.usd_micros)
                .filter(|n| *n <= MAX)
            {
                Some(sum) => {
                    self.micros = sum;
                    self.lower_bound |= quote.lower_bound;
                }
                None => {
                    self.reasons.insert("unsafe_cost");
                }
            },
            Err(why) => {
                self.reasons.insert(why.reason());
            }
        }
    }

    fn merge(&mut self, other: &Self) {
        match self.micros.checked_add(other.micros).filter(|n| *n <= MAX) {
            Some(sum) => self.micros = sum,
            None => {
                self.reasons.insert("unsafe_cost");
            }
        }
        self.lower_bound |= other.lower_bound;
        self.reasons.extend(&other.reasons);
    }

    /// `cost` and `costUnavailable`: null with every reason when any share is unpriced.
    fn fields(&self, row: &mut Value) {
        row["cost"] = if self.reasons.is_empty() {
            json!({"usdMicros": self.micros, "lowerBound": self.lower_bound})
        } else {
            Value::Null
        };
        row["costUnavailable"] = json!(self.reasons);
    }
}

#[derive(Default)]
struct Model {
    line: &'static str,
    tokens: Tokens,
    /// None once any seat's row lacked the count.
    cache_write: Option<u64>,
    seats: BTreeSet<String>,
    partial: BTreeSet<String>,
    cost: Cost,
}

/// The `usage.models` rows, ascending by model id, and each line's cost by line name.
pub(super) fn section(
    seats: &[Seat],
    prices: &Table,
    at_ms: u64,
) -> Result<(Vec<Value>, BTreeMap<&'static str, Value>), Error> {
    let mut models = BTreeMap::<&str, Model>::new();
    for seat in seats {
        for model in seat.by_model.iter().flatten() {
            let row = models.entry(&model.model_id).or_insert_with(|| Model {
                line: line_of(&model.model_id),
                cache_write: Some(0),
                ..Model::default()
            });
            row.tokens = row
                .tokens
                .add(model.tokens)
                .ok_or_else(|| invalid("model total"))?;
            row.cache_write = row
                .cache_write
                .zip(model.cache_write)
                .map(|(sum, count)| sum.checked_add(count).filter(|n| *n <= MAX))
                .map(|sum| sum.ok_or_else(|| invalid("model total")))
                .transpose()?;
            row.seats.insert(seat.label.id.clone());
            if !seat.complete {
                row.partial.insert(seat.label.id.clone());
            }
            // Each seat's share is quoted on its own, so one seat's unreported cache writes
            // make only its own share a floor.
            row.cost.add(prices.quote(
                &model.model_id,
                at_ms,
                pricing::Tokens {
                    input: model.tokens.input,
                    cached: model.tokens.cached,
                    cache_write: model.cache_write,
                    output: model.tokens.output,
                },
            ));
        }
    }
    let mut lines = BTreeMap::<&'static str, Cost>::new();
    let mut rows = Vec::with_capacity(models.len());
    for (model_id, model) in &models {
        lines.entry(model.line).or_default().merge(&model.cost);
        let mut totals = model.tokens.json();
        totals["cacheWrite"] = json!(model.cache_write);
        let mut row = json!({"modelId": model_id, "line": model.line, "totals": totals,
            "seats": model.seats, "partialSeats": model.partial.len()});
        model.cost.fields(&mut row);
        rows.push(row);
    }
    let mut unattributed = Cost::default();
    unattributed.reasons.insert(UNATTRIBUTED);
    let line_costs = lines
        .iter()
        .map(|(name, cost)| (*name, cost))
        .chain([(UNATTRIBUTED, &unattributed)])
        .map(|(name, cost)| {
            let mut fields = json!({});
            cost.fields(&mut fields);
            (name, fields)
        })
        .collect();
    Ok((rows, line_costs))
}
