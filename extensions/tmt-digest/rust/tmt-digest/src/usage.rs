//! `tmt digest usage report`: Core's public consumption, limit and exchange
//! documents joined once for people and spreadsheets. No store, scheduler or
//! collector: every run reads Core and prints.

mod csv;
mod model;
#[cfg(test)]
mod tests;

use crate::{
    core::{Core, Error},
    status::inventory,
};
use model::{Label, Report, Usage};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

const DAY_MS: u64 = 86_400_000;
/// The longest `--from` lookback: Core's rollup keeps 32 days.
const MAX_FROM_MS: u64 = 32 * DAY_MS;
const SLOT_MS: u64 = 300_000;
// 16 seats x 30 daily buckets with attribution and limits stay far inside the
// 1 MiB a single Core call may return.
const BATCH: usize = 16;
const RESOLVE_BATCH: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Since {
    Day,
    Week,
    Month,
}
impl Since {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "24h" => Ok(Self::Day),
            "7d" => Ok(Self::Week),
            "30d" => Ok(Self::Month),
            _ => Err("Use 24h, 7d or 30d".into()),
        }
    }
    pub fn text(self) -> &'static str {
        match self {
            Self::Day => "24h",
            Self::Week => "7d",
            Self::Month => "30d",
        }
    }
    pub(crate) fn window_ms(self) -> u64 {
        match self {
            Self::Day => DAY_MS,
            Self::Week => 7 * DAY_MS,
            Self::Month => 30 * DAY_MS,
        }
    }
    /// Hourly for a day, daily for longer windows.
    fn buckets(self) -> u64 {
        match self {
            Self::Day => 24,
            Self::Week => 7,
            Self::Month => 30,
        }
    }
}

/// What a report covers: a `--since` window, or the time from an absolute start
/// (Unix milliseconds) to now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Span {
    Since(Since),
    From(u64),
}

/// An RFC 3339 instant with a `Z` or `±HH:MM` offset, in Unix milliseconds.
/// Fractions finer than a millisecond are truncated.
pub fn parse_instant(text: &str) -> Option<u64> {
    let bytes = text.as_bytes();
    if bytes.len() < 20 || !matches!(bytes[10], b'T' | b't') {
        return None;
    }
    let day = crate::pricing::day_start_ms(&text[..10])?;
    let two = |at: usize| -> Option<u64> {
        let part = text.get(at..at + 2)?;
        part.bytes()
            .all(|c| c.is_ascii_digit())
            .then(|| part.parse().ok())?
    };
    if bytes[13] != b':' || bytes[16] != b':' {
        return None;
    }
    let (hour, minute, second) = (two(11)?, two(14)?, two(17)?);
    if hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let mut rest = &text[19..];
    let mut millis = 0;
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits = fraction.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 {
            return None;
        }
        let padded = format!("{:0<3}", &fraction[..digits.min(3)]);
        millis = padded.parse::<u64>().ok()?;
        rest = &fraction[digits..];
    }
    let local = day + ((hour * 60 + minute) * 60 + second) * 1_000 + millis;
    match rest.as_bytes() {
        [b'Z' | b'z'] => Some(local),
        [sign @ (b'+' | b'-'), _, _, b':', _, _] => {
            let (hours, minutes) = (two(text.len() - 5)?, two(text.len() - 2)?);
            if hours > 23 || minutes > 59 {
                return None;
            }
            let offset = (hours * 60 + minutes) * 60_000;
            if *sign == b'+' {
                local.checked_sub(offset)
            } else {
                local.checked_add(offset)
            }
        }
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Table {
    Usage,
    Credits,
    Exchange,
}
impl Table {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "usage" => Ok(Self::Usage),
            "credits" => Ok(Self::Credits),
            "exchange" => Ok(Self::Exchange),
            _ => Err("Use usage, credits or exchange".into()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Json,
    Csv(Table),
}

/// The bytes to print: one JSON document or one CSV table.
pub fn render(span: Span, format: Format) -> Result<String, Error> {
    let now = crate::tick::now_ms()?;
    if let Span::From(start) = span
        && (start > now || now - start > MAX_FROM_MS)
    {
        return Err(Error::new(
            "DIGEST_INPUT_INVALID",
            "--from must be an instant within the last 32 days",
        ));
    }
    let core = Core::discover()?.until(Instant::now() + Duration::from_secs(60));
    let document = execute(&core, span, now)?;
    match format {
        Format::Json => serde_json::to_string(&document)
            .map(|text| text + "\n")
            .map_err(|error| Error::new("DIGEST_OUTPUT_INVALID", error.to_string())),
        Format::Csv(table) => csv::table(&document, table),
    }
}

fn execute(core: &Core, span: Span, now: u64) -> Result<Value, Error> {
    model::document(&collect(core, span, now)?)
}

/// The reads of one report. A `--from` report pins every read to one cut, Digest's
/// clock rounded down to Core's five seconds, so its windows all end together.
#[derive(Clone, Copy)]
struct Reads {
    window_ms: u64,
    max_buckets: u64,
    through_ms: Option<u64>,
}

impl Reads {
    fn of(span: Span, now: u64) -> Self {
        match span {
            Span::Since(since) => Self {
                window_ms: since.window_ms(),
                max_buckets: since.buckets(),
                through_ms: None,
            },
            Span::From(start) => {
                let through = now - now % 5_000;
                let to = through - through % SLOT_MS;
                // At least one slot, so a start inside the newest five minutes is still a
                // window; `window` reports the bounds Core read.
                let window_ms = to
                    .saturating_sub(start.div_ceil(SLOT_MS) * SLOT_MS)
                    .max(SLOT_MS);
                Self {
                    window_ms,
                    max_buckets: window_ms.div_ceil(DAY_MS),
                    through_ms: Some(through),
                }
            }
        }
    }
}

fn warning(section: &str, error: &Error) -> Value {
    json!({"section": section, "code": error.code, "message": error.message})
}

/// Only the roster is required; every other section degrades to unavailable
/// with a warning rather than to zero.
fn collect(core: &Core, span: Span, now: u64) -> Result<Report, Error> {
    let reads = Reads::of(span, now);
    let roster = inventory(&core.json(&["identity", "ls"])?)?;
    let mut labels: BTreeMap<String, Label> = roster
        .into_iter()
        .map(|(id, name)| {
            (
                id.clone(),
                Label {
                    id,
                    name: Some(name),
                    retired: false,
                },
            )
        })
        .collect();
    let mut warnings = Vec::new();

    let flow = match span {
        Span::Since(since) => match core.json(&[
            "x",
            "flow",
            "--since",
            since.text(),
            "--bucket",
            since.text(),
        ]) {
            Ok(flow) => Some(flow),
            Err(error) => {
                warnings.push(warning("exchange", &error));
                None
            }
        },
        // Core's flow takes only its own windows (at most 30 days), never a start.
        Span::From(_) => {
            warnings.push(warning(
                "exchange",
                &Error::new(
                    "DIGEST_WINDOW_UNSUPPORTED",
                    "Message flow is reported only for --since windows",
                ),
            ));
            None
        }
    };
    if let Some(flow) = &flow {
        let outsiders: Vec<String> = model::flow_participants(flow)
            .into_iter()
            .filter(|id| !labels.contains_key(id))
            .collect();
        for batch in outsiders.chunks(RESOLVE_BATCH) {
            match resolve(core, batch) {
                Ok(found) => labels.extend(found),
                Err(error) => warnings.push(warning("labels", &error)),
            }
        }
    }
    let exchange = flow.and_then(|flow| match model::exchange(&flow, &labels) {
        Ok(exchange) => Some(exchange),
        Err(error) => {
            warnings.push(warning("exchange", &error));
            None
        }
    });

    // Retired participants keep their retained rollup, so they are read too.
    let mut seats: Vec<&Label> = labels
        .values()
        .filter(|label| label.name.is_some() || label.retired)
        .collect();
    seats.sort_by(|a, b| (&a.name, &a.id).cmp(&(&b.name, &b.id)));
    let ids: Vec<String> = seats.into_iter().map(|label| label.id.clone()).collect();
    let mut usage = Usage::default();
    for batch in ids.chunks(BATCH) {
        usage.merge(match read(core, reads, batch, &labels) {
            Ok(usage) => usage,
            Err(error) => {
                warnings.push(warning("usage", &error));
                Usage::unreadable(batch, &labels)
            }
        });
    }
    // Account-level limits are preferred whole; an older Core does not know the operation
    // and keeps today's per-seat derivation, as does any failed read.
    usage.accounts = match core.api("consumption.limits", json!({})) {
        Ok(document) => model::accounts(&document),
        Err(error) if error.code == "API_INPUT_INVALID" => None,
        Err(error) => {
            warnings.push(warning("limits", &error));
            None
        }
    };
    let pricing = core
        .data_root()
        .ok()
        .map_or_else(crate::pricing::Resolved::built_in, |root| {
            crate::pricing::Resolved::read_only(&root)
        });
    let spend = match (span, reads.through_ms) {
        (Span::From(start), Some(through)) => {
            Some(spend(core, start, through, &ids, &pricing, &mut warnings))
        }
        _ => None,
    };
    Ok(Report {
        pricing,
        as_of_ms: now,
        since: match span {
            Span::Since(since) => Some(since.text()),
            Span::From(_) => None,
        },
        spend,
        usage,
        exchange,
        warnings,
    })
}

/// Names and retirement for flow participants that are not on the roster.
fn resolve(core: &Core, ids: &[String]) -> Result<BTreeMap<String, Label>, Error> {
    let document = core.api("references.resolve", json!({"identityIds": ids}))?;
    let rows = document["identities"]
        .as_array()
        .filter(|rows| rows.len() == ids.len())
        .ok_or_else(|| {
            Error::new(
                "CORE_RESPONSE_INVALID",
                "Core returned an invalid reference lookup",
            )
        })?;
    Ok(rows
        .iter()
        .zip(ids)
        .map(|(row, id)| {
            let found = row["found"] == true;
            (
                id.clone(),
                Label {
                    id: id.clone(),
                    name: found
                        .then(|| row["name"].as_str().map(str::to_owned))
                        .flatten(),
                    retired: found && row["retired"] == true,
                },
            )
        })
        .collect())
}

/// Two reads of the same window: one bucket for totals with attribution, and
/// the series. Core aggregates both, so no total here is a sum of buckets.
fn read(
    core: &Core,
    reads: Reads,
    ids: &[String],
    labels: &BTreeMap<String, Label>,
) -> Result<Usage, Error> {
    let history = |max_buckets: u64| {
        let mut input = json!({
            "identityIds": ids,
            "windowsMs": [reads.window_ms],
            "maxBuckets": max_buckets,
            "includeRetired": true,
        });
        if let Some(through) = reads.through_ms {
            input["throughMs"] = json!(through);
        }
        core.api("consumption.history", input)
    };
    model::usage(&history(1)?, &history(reads.max_buckets)?, ids, labels)
}

/// The `--from` spend section: the plan's windows for every batch at the pinned cut.
/// A failed batch is a reason on every value, never a zero.
fn spend(
    core: &Core,
    start: u64,
    through: u64,
    ids: &[String],
    pricing: &crate::pricing::Resolved,
    warnings: &mut Vec<Value>,
) -> Value {
    let plan = model::spend::Plan::new(start, through - through % SLOT_MS, pricing.table());
    let mut seats = Vec::new();
    let mut unreadable = false;
    for batch in ids.chunks(BATCH) {
        let answers: Result<Vec<Value>, Error> = plan
            .requests()
            .into_iter()
            .map(|(windows, max_buckets)| {
                core.api(
                    "consumption.history",
                    json!({
                        "identityIds": batch,
                        "windowsMs": windows,
                        "maxBuckets": max_buckets,
                        "includeRetired": true,
                        "throughMs": through,
                    }),
                )
            })
            .collect();
        match answers.and_then(|answers| model::spend::read(&plan, &answers, batch)) {
            Ok(found) => seats.extend(found),
            Err(error) => {
                warnings.push(warning("spend", &error));
                unreadable = true;
            }
        }
    }
    model::spend::section(&plan, &seats, unreadable, pricing.table())
}
