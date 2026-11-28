//! Narrow consumer of Digest's public spend projection. Digest owns pricing.
use crate::{
    board::limits::{BudgetQuote, PaceQuote, QuotedSpend},
    core::Core,
};
use serde_json::Value;
use std::time::Duration;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct SpendReport {
    pub providers: Vec<BudgetQuote>,
}

fn strings(value: &Value) -> Option<Vec<String>> {
    value
        .as_array()?
        .iter()
        .map(|item| item.as_str().map(str::to_owned))
        .collect()
}

fn amount(value: &Value) -> Option<QuotedSpend> {
    let usd_micros = match value.get("usdMicros")? {
        Value::Null => None,
        number => Some(number.as_u64().filter(|n| *n <= 9_007_199_254_740_991)?),
    };
    let reasons = strings(&value["reasons"])?;
    let complete = value["complete"].as_bool()?;
    let lower_bound = value["lowerBound"].as_bool()?;
    if complete != reasons.is_empty() || lower_bound != (!complete && usd_micros.is_some()) {
        return None;
    }
    Some(QuotedSpend {
        usd_micros,
        complete,
        lower_bound,
        reasons,
    })
}

fn pace(value: &Value) -> Option<PaceQuote> {
    Some(PaceQuote {
        window_ms: value["windowMs"].as_u64()?,
        from_ms: value["fromMs"].as_u64()?,
        to_ms: value["toMs"].as_u64()?,
        spend: amount(value)?,
    })
}

fn provider(row: &Value, vendor: &str, from_ms: u64, to_ms: u64) -> Option<BudgetQuote> {
    if row["provider"] != vendor || row["fromMs"] != from_ms || row["toMs"] != to_ms {
        return None;
    }
    let pace = row["pace"]
        .as_array()?
        .iter()
        .map(pace)
        .collect::<Option<Vec<_>>>()?;
    Some(BudgetQuote {
        provider: vendor.into(),
        from_ms,
        to_ms,
        models: strings(&row["models"])?,
        total: amount(&row["total"])?,
        pace,
    })
}

impl SpendReport {
    pub(in crate::board) fn decode(document: &Value, start: u64) -> Result<Self, String> {
        let malformed = || "Invalid Digest spend report.".to_owned();
        let spend = &document["spend"];
        let from_ms = spend["fromMs"].as_u64().ok_or_else(malformed)?;
        let to_ms = spend["toMs"].as_u64().ok_or_else(malformed)?;
        let rows = spend["providers"].as_array().ok_or_else(malformed)?;
        if document["version"] != 1
            || document.get("since") != Some(&Value::Null)
            || spend["requestedFromMs"] != start
            || from_ms > to_ms
            || rows.len() != 3
        {
            return Err(malformed());
        }
        let providers = rows
            .iter()
            .zip(["anthropic", "google", "openai"])
            .map(|(row, vendor)| provider(row, vendor, from_ms, to_ms))
            .collect::<Option<_>>()
            .ok_or_else(malformed)?;
        Ok(Self { providers })
    }
}

#[derive(Debug)]
pub(in crate::board) struct Delivery {
    pub start: u64,
    pub result: Result<SpendReport, String>,
}

pub(super) fn read(core: &Core, start: u64) -> Result<SpendReport, String> {
    let timestamp = i64::try_from(start)
        .ok()
        .and_then(|millis| jiff::Timestamp::from_millisecond(millis).ok())
        .ok_or("Invalid budget period start.")?;
    let document = core
        .json_within(
            &[
                "digest",
                "usage",
                "report",
                "--from",
                &timestamp.to_string(),
            ],
            // Digest bounds its own reads to 60 seconds.
            Duration::from_secs(65),
        )
        .map_err(|error| error.message)?;
    SpendReport::decode(&document, start)
}
