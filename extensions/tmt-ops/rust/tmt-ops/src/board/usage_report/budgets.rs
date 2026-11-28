//! Narrow consumer of Digest's public spend projection. Digest owns pricing.
use crate::{
    board::limits::{BudgetQuote, PaceQuote, QuotedSpend},
    core::Core,
};
use serde_json::Value;
use std::{collections::BTreeSet, time::Duration};

pub(in crate::board) type Vendors = BTreeSet<String>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct SpendReport {
    pub providers: Vec<BudgetQuote>,
    pub pricing: Option<crate::labels::digest::Pricing>,
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
    pub(in crate::board) fn decode(
        document: &Value,
        start: u64,
        vendors: &Vendors,
    ) -> Result<Self, String> {
        let malformed = || "Invalid Digest spend report.".to_owned();
        let spend = &document["spend"];
        let from_ms = spend["fromMs"].as_u64().ok_or_else(malformed)?;
        let to_ms = spend["toMs"].as_u64().ok_or_else(malformed)?;
        let rows = spend["providers"].as_array().ok_or_else(malformed)?;
        if document["version"] != 1
            || document.get("since") != Some(&Value::Null)
            || spend["requestedFromMs"] != start
            || from_ms > to_ms
        {
            return Err(malformed());
        }
        let providers = vendors
            .iter()
            .map(|vendor| {
                let mut matches = rows.iter().filter(|row| row["provider"] == vendor.as_str());
                let row = matches.next()?;
                if matches.next().is_some() {
                    return None;
                }
                provider(row, vendor, from_ms, to_ms)
            })
            .collect::<Option<_>>()
            .ok_or_else(malformed)?;
        Ok(Self {
            providers,
            pricing: crate::labels::digest::Pricing::parse(&document["pricing"]),
        })
    }
}

#[derive(Debug)]
pub(in crate::board) struct Delivery {
    pub start: u64,
    pub vendors: Vendors,
    pub result: Result<SpendReport, String>,
}

pub(super) fn read(core: &Core, start: u64, vendors: &Vendors) -> Result<SpendReport, String> {
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
    SpendReport::decode(&document, start, vendors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{Scratch, write_ready_executable};
    use serde_json::json;

    #[test]
    fn budget_reader_consumes_the_landed_spend_vector() {
        let vector: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../tmt-digest/contracts/vectors/usage-report-v1.json"
        )))
        .unwrap();
        let case = vector["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["name"] == "spend from a period start")
            .unwrap();
        let start = case["requestedFromMs"].as_u64().unwrap();
        let scratch = Scratch::new("budget-spend");
        let document = json!({"version": 1, "since": null, "spend": case["expected"]});
        std::fs::write(scratch.join("spend.json"), document.to_string()).unwrap();
        let core = scratch.join("core");
        write_ready_executable(
            &core,
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$(dirname \"$0\")/argv\"\nexec cat \"$(dirname \"$0\")/spend.json\"\n",
        );
        let vendors = ["anthropic", "google", "openai"]
            .into_iter()
            .map(str::to_owned)
            .collect();
        let report = read(&Core::at(core), start, &vendors).unwrap();
        assert_eq!(
            std::fs::read_to_string(scratch.join("argv")).unwrap(),
            "digest\nusage\nreport\n--from\n2026-11-29T00:00:00.001Z\n--json\n",
        );
        let [anthropic, google, openai] = report.providers.as_slice() else {
            panic!("expected all three billing vendors");
        };
        assert_eq!(anthropic.total.usd_micros, None);
        assert!(
            anthropic
                .total
                .reasons
                .iter()
                .any(|reason| reason == "no_price")
        );
        assert_eq!(google.total.usd_micros, Some(6_000_000));
        assert!(google.total.lower_bound && !google.total.complete);
        assert_eq!(
            google
                .pace
                .iter()
                .map(|pace| pace.spend.usd_micros)
                .collect::<Vec<_>>(),
            [Some(0), Some(4_000_000), Some(6_000_000)]
        );
        assert_eq!(openai.total.usd_micros, Some(0));
        assert!(openai.total.lower_bound);

        let mut document = document;
        document["spend"]["providers"]
            .as_array_mut()
            .unwrap()
            .push(json!({"provider": "future_vendor"}));
        assert_eq!(SpendReport::decode(&document, start, &vendors), Ok(report));
        document["spend"]["providers"][1]["total"]["reasons"] =
            json!(["retired_unread", "future_reason_id"]);
        let report = SpendReport::decode(&document, start, &vendors).unwrap();
        let quote = &report.providers[1];
        assert!(!quote.total.complete);
        assert_eq!(quote.total.reasons, ["retired_unread", "future_reason_id"]);
        let forecast = crate::board::limits::budget_forecast(
            500_000_000,
            start,
            quote.to_ms + 86_400_000,
            quote.to_ms,
            Some(quote),
        );
        assert!(forecast.left_is_upper_bound);
        assert_eq!(forecast.lines, [crate::board::limits::Outcome::Unknown; 4]);
    }
}
