//! The numbers of the Digest Allowance block: how fast a weekly window empties
//! over several spans, what each rate leaves at the reset, and the even burn
//! that would last exactly until it. Pure; the clock is a parameter, so painting
//! runs no timer and reads nothing.
use super::{Provider, Reading, Standing, estimate};

const HOUR_MS: u64 = 3_600_000;
/// Samples spanning less than this say nothing about a rate.
const MIN_SPAN_MS: u64 = HOUR_MS;
/// A reset time later than this starts a new cycle; less is rounding in the
/// source's own countdown.
const NEW_CYCLE_MS: u64 = 30 * 60_000;

/// One projection line of the block: the rate it holds to the reset.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Line {
    Hours3,
    Hours6,
    Hours24,
    /// The last 3 h of tokens at the points the last 24 h cost per token.
    Tokens,
    /// The average since the window last refilled.
    SinceReset,
}

impl Line {
    pub const ALL: [Self; 5] = [
        Self::Hours3,
        Self::Hours6,
        Self::Hours24,
        Self::Tokens,
        Self::SinceReset,
    ];
}

/// Percent of the weekly window used per hour, for the lines read off the
/// sampled history. `None` where the history does not cover the span.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Rates {
    hours3: Option<f64>,
    hours6: Option<f64>,
    hours24: Option<f64>,
    since_reset: Option<f64>,
}

impl Rates {
    /// Rates for a test that needs no history behind them.
    #[cfg(test)]
    pub(in crate::board) fn measured(
        hours3: Option<f64>,
        hours6: Option<f64>,
        hours24: Option<f64>,
        since_reset: Option<f64>,
    ) -> Self {
        Self {
            hours3,
            hours6,
            hours24,
            since_reset,
        }
    }

    /// Percent per hour the last 3 h of tokens would burn at the points per token the last 24 h
    /// cost: `None` without a 24 h rate to calibrate on or without tokens spent in them. Both
    /// token counts are the usage report's input + output, so the unit cancels.
    pub fn tokens(&self, spent: Option<Spent>) -> Option<f64> {
        let spent = spent.filter(|spent| spent.day > 0)?;
        let points_per_token = self.hours24? * 24.0 / spent.day as f64;
        Some(spent.last_3h as f64 / 3.0 * points_per_token)
    }

    pub fn get(&self, line: Line) -> Option<f64> {
        match line {
            Line::Hours3 => self.hours3,
            Line::Hours6 => self.hours6,
            Line::Hours24 => self.hours24,
            // Needs the tokens spent, which sampled history does not hold: see `tokens`.
            Line::Tokens => None,
            Line::SinceReset => self.since_reset,
        }
    }
}

/// Tokens (input + output) the members on one provider spent over the last 3 h and over
/// the last 24 h, from complete hourly cells only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Spent {
    pub last_3h: u64,
    pub day: u64,
}

impl Spent {
    pub fn plus(self, other: Self) -> Self {
        Self {
            last_3h: self.last_3h.saturating_add(other.last_3h),
            day: self.day.saturating_add(other.day),
        }
    }
}

/// The readings of the window's current cycle: back from the newest until the
/// window refilled or a new cycle began.
fn cycle(history: &[Reading]) -> &[Reading] {
    let Some(_) = history.last() else {
        return history;
    };
    let mut start = history.len() - 1;
    for (index, pair) in history.windows(2).enumerate().rev() {
        let (older, newer) = (&pair[0], &pair[1]);
        let refilled = older.weekly.left < newer.weekly.left;
        let next_cycle = newer.weekly.resets_at_ms > older.weekly.resets_at_ms + NEW_CYCLE_MS;
        if refilled || next_cycle {
            break;
        }
        start = index;
    }
    &history[start..]
}

/// Endpoint rate of `readings` when they span at least `minimum` milliseconds.
fn rate(readings: &[Reading], minimum: u64) -> Option<f64> {
    let (first, newest) = (readings.first()?, readings.last()?);
    let span = newest.observed_at_ms.checked_sub(first.observed_at_ms)?;
    (span >= minimum)
        .then(|| (first.weekly.left - newest.weekly.left).max(0.0) / (span as f64 / HOUR_MS as f64))
}

/// The measured rates of one provider's sampled history.
pub(super) fn rates(history: &[Reading]) -> Rates {
    let cycle = cycle(history);
    let Some(newest) = cycle.last() else {
        return Rates::default();
    };
    // A span line needs the history to cover at least half of it, and never less
    // than an hour, so a few close samples are not read as a rate.
    let over = |span: u64| {
        let from = cycle
            .iter()
            .position(|reading| newest.observed_at_ms - reading.observed_at_ms <= span)?;
        rate(&cycle[from..], MIN_SPAN_MS.max(span / 2))
    };
    Rates {
        hours3: over(3 * HOUR_MS),
        hours6: over(6 * HOUR_MS),
        hours24: over(24 * HOUR_MS),
        since_reset: rate(cycle, MIN_SPAN_MS),
    }
}

/// What one line leaves when its rate holds to the reset.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Outcome {
    /// No rate to hold, or no window to hold it against.
    Unknown,
    /// Amount still left at the reset, in the projection’s units.
    Lasts(f64),
    /// The window empties first, at this time.
    RunsOut(u64),
}

impl Outcome {
    /// Orders outcomes worst first: the earliest empty time, then the least left.
    fn severity(self) -> Option<(u8, f64)> {
        match self {
            Self::Unknown => None,
            Self::RunsOut(at) => Some((0, at as f64)),
            Self::Lasts(left) => Some((1, left)),
        }
    }
}

/// Project an amount spent at `rate` per hour from `now_ms` to the reset.
/// The starting amount and rate share the same unit.
pub fn project(left: f64, resets_in_ms: u64, now_ms: u64, rate: Option<f64>) -> Outcome {
    let Some(rate) = rate.filter(|rate| rate.is_finite() && *rate >= 0.0) else {
        return Outcome::Unknown;
    };
    let remaining = left - rate * (resets_in_ms as f64 / HOUR_MS as f64);
    if rate > 0.0 && remaining <= 0.0 {
        Outcome::RunsOut(now_ms.saturating_add((left / rate * HOUR_MS as f64) as u64))
    } else {
        Outcome::Lasts(remaining.max(0.0))
    }
}

/// A value from Digest's `spend` section. A floor and its reasons can be
/// displayed in Details, but cannot establish a balance or rate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct QuotedSpend {
    pub usd_micros: Option<u64>,
    pub complete: bool,
    pub lower_bound: bool,
    pub reasons: Vec<String>,
}

impl QuotedSpend {
    fn complete_micros(&self) -> Option<u64> {
        if self.complete && !self.lower_bound && self.reasons.is_empty() {
            self.usd_micros
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PaceQuote {
    pub window_ms: u64,
    pub from_ms: u64,
    pub to_ms: u64,
    pub spend: QuotedSpend,
}

/// One row of Digest's `spend.providers[]`, with the actual closed cut.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BudgetQuote {
    pub provider: String,
    pub from_ms: u64,
    pub to_ms: u64,
    pub models: Vec<String>,
    pub total: QuotedSpend,
    pub pace: Vec<PaceQuote>,
}

impl BudgetQuote {
    fn pace_per_hour(&self, hours: u64) -> Option<f64> {
        let window_ms = hours * HOUR_MS;
        let pace = self.pace.iter().find(|pace| pace.window_ms == window_ms)?;
        if pace.to_ms != self.to_ms || pace.to_ms.checked_sub(pace.from_ms) != Some(window_ms) {
            return None;
        }
        Some(pace.spend.complete_micros()? as f64 / hours as f64)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct BudgetForecast {
    pub left_usd_micros: Option<u64>,
    pub left_is_upper_bound: bool,
    pub need_usd_micros_per_hour: Option<f64>,
    /// Dollar projections in 3 h, 6 h, 24 h and phase order, in USD micros.
    pub lines: [Outcome; 4],
}

pub(crate) fn budget_forecast(
    limit_usd_micros: u64,
    period_start_ms: u64,
    period_end_ms: u64,
    now_ms: u64,
    quote: Option<&BudgetQuote>,
) -> BudgetForecast {
    let unknown = BudgetForecast {
        left_usd_micros: None,
        left_is_upper_bound: false,
        need_usd_micros_per_hour: None,
        lines: [Outcome::Unknown; 4],
    };
    if !(period_start_ms..period_end_ms).contains(&now_ms) {
        return unknown;
    }
    let Some(quote) = quote.filter(|quote| {
        quote.from_ms >= period_start_ms && (quote.from_ms..=now_ms).contains(&quote.to_ms)
    }) else {
        return unknown;
    };
    let remaining_ms = period_end_ms - now_ms;
    let remaining_hours = remaining_ms as f64 / HOUR_MS as f64;
    if let Some(spend) = quote.total.usd_micros.filter(|_| quote.total.lower_bound) {
        let left = limit_usd_micros.saturating_sub(spend);
        return BudgetForecast {
            left_usd_micros: Some(left),
            left_is_upper_bound: true,
            need_usd_micros_per_hour: Some(left as f64 / remaining_hours),
            ..unknown
        };
    }
    let Some(spend) = quote
        .total
        .complete_micros()
        .filter(|_| quote.from_ms == period_start_ms)
    else {
        return unknown;
    };
    let left = limit_usd_micros.saturating_sub(spend);
    let observed_ms = quote.to_ms - quote.from_ms;
    let phase = (observed_ms > 0).then(|| spend as f64 / (observed_ms as f64 / HOUR_MS as f64));
    let lines = [
        quote.pace_per_hour(3),
        quote.pace_per_hour(6),
        quote.pace_per_hour(24),
        phase,
    ]
    .map(|pace| project(left as f64, remaining_ms, now_ms, pace));
    BudgetForecast {
        left_usd_micros: Some(left),
        left_is_upper_bound: false,
        need_usd_micros_per_hour: Some(left as f64 / remaining_hours),
        lines,
    }
}

/// Calendar bounds in the board zone, including daylight-saving transitions.
pub(in crate::board) fn budget_period(
    period: crate::config::BudgetPeriod,
    now_ms: u64,
    zone: &jiff::tz::TimeZone,
) -> Option<(u64, u64)> {
    use crate::config::BudgetPeriod;
    use jiff::{Span, Timestamp};
    let date = Timestamp::from_millisecond(i64::try_from(now_ms).ok()?)
        .ok()?
        .to_zoned(zone.clone())
        .date();
    let start = match period {
        BudgetPeriod::Week => date
            .checked_sub(Span::new().days(date.weekday().to_monday_zero_offset()))
            .ok()?,
        BudgetPeriod::Month => date.first_of_month(),
    };
    let duration = match period {
        BudgetPeriod::Week => Span::new().days(7),
        BudgetPeriod::Month => Span::new().months(1),
    };
    let boundary = |day: jiff::civil::Date| {
        u64::try_from(
            zone.to_zoned(day.at(0, 0, 0, 0))
                .ok()?
                .timestamp()
                .as_millisecond(),
        )
        .ok()
    };
    Some((
        boundary(start)?,
        boundary(start.checked_add(duration).ok()?)?,
    ))
}

/// A weekly window as of now, with its projection lines.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Weekly {
    pub left: f64,
    pub resets_at_ms: u64,
    pub lines: [Outcome; 5],
}

impl Weekly {
    /// The worst of the lines, for a row with no room for all five.
    pub fn worst(&self) -> Outcome {
        worst(self.lines)
    }
}

pub(in crate::board) fn worst(lines: impl IntoIterator<Item = Outcome>) -> Outcome {
    lines
        .into_iter()
        .filter_map(|outcome| outcome.severity().map(|key| (key, outcome)))
        .min_by(|(a, _), (b, _)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
        .map_or(Outcome::Unknown, |(_, outcome)| outcome)
}

/// One source of the block. `weekly` is `None` while no usable reading stands.
#[derive(Debug, Clone, PartialEq)]
pub struct Row {
    pub provider: Provider,
    pub weekly: Option<Weekly>,
}

/// The rows of `standings`: every provider that has been sampled, in the shown
/// order.
pub fn rows(
    standings: &[Standing],
    now_ms: u64,
    spent: &dyn Fn(&Provider) -> Option<Spent>,
) -> Vec<Row> {
    standings
        .iter()
        .filter(|standing| standing.latest.is_some())
        .map(|standing| Row {
            provider: standing.provider.clone(),
            weekly: weekly(standing, now_ms, spent(&standing.provider)),
        })
        .collect()
}

fn weekly(standing: &Standing, now_ms: u64, spent: Option<Spent>) -> Option<Weekly> {
    let estimate::Outlook::Known(figures) = standing.outlook(now_ms) else {
        return None;
    };
    let left = figures.weekly;
    let lines = Line::ALL.map(|line| {
        let rate = match line {
            Line::Tokens => standing.rates.tokens(spent),
            line => standing.rates.get(line),
        };
        project(left.percent, left.resets_in_ms, now_ms, rate)
    });
    Some(Weekly {
        left: left.percent,
        resets_at_ms: now_ms.saturating_add(left.resets_in_ms),
        lines,
    })
}

#[cfg(test)]
mod tests;
