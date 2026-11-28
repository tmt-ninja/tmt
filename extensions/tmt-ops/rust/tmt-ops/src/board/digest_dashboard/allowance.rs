//! The allowance tile of the Digest summary: each provider's weekly window, what is left,
//! whether this rate runs it out before the reset, and when it resets. Numbers come from
//! `limits::allowance`; this file only places them.
use crate::board::{
    app::App,
    limits::{Outcome, Provider, Row, Spent},
    usage_report::{View, model::Seat},
};
use ratatui::{
    Frame,
    layout::{Position, Rect},
};
use std::{cell::Cell, collections::BTreeMap};
use tmt_cli_style::Role;
use tmt_tui::components::design_system as ds;
use unicode_width::UnicodeWidthStr;

/// Tokens each provider's members spent over the last 3 h and 24 h, from the usage report the
/// Digest tab already holds: one 24-cell hourly series per seat, a seat counted for the driver
/// its member is on now. Nothing is read for this; a missing or stale report, a seat with no
/// known driver or an incomplete cell leaves the provider out, never as zero.
fn spent(app: &App, now: u64) -> BTreeMap<Provider, Spent> {
    let View::Report(report) = app.usage_report.view_for(app.digest_range()) else {
        return BTreeMap::new();
    };
    let Some(view) = app.view.as_ref() else {
        return BTreeMap::new();
    };
    let drivers: BTreeMap<&str, &str> = view
        .home_rate
        .iter()
        .filter(|(_, rate)| rate.settings.enabled)
        .filter_map(|(name, _)| app.home_meter(name))
        .flat_map(|meter| {
            let rate = meter.history();
            report
                .seats
                .iter()
                .filter_map(|seat| seat.who.id.as_deref())
                .filter_map(|id| Some((id, rate.current_driver_of(id)?)))
                .collect::<Vec<_>>()
        })
        .collect();
    // A provider with any seat lacking a usable series has no honest total.
    let mut totals: BTreeMap<&str, Option<Spent>> = BTreeMap::new();
    for seat in &report.seats {
        let Some(driver) = seat.who.id.as_deref().and_then(|id| drivers.get(id)) else {
            continue;
        };
        let entry = totals
            .entry(driver)
            .or_insert(Some(Spent { last_3h: 0, day: 0 }));
        *entry = entry.and_then(|total| seat_spent(seat, now).map(|spent| total.plus(spent)));
    }
    totals
        .into_iter()
        .filter_map(|(driver, spent)| Some((Provider::from_driver(driver)?, spent?)))
        .collect()
}

/// One seat's tokens over the last 3 h and 24 h, only from a fresh series of complete cells.
fn seat_spent(seat: &Seat, now: u64) -> Option<Spent> {
    const HOUR: u64 = 3_600_000;
    let ends = seat.series.from_ms.checked_add(24 * HOUR)?;
    if seat.series.is_empty() || now.saturating_sub(ends) >= 2 * HOUR {
        return None;
    }
    let points: Vec<_> = seat.series.iter().collect();
    if points.len() != 24 || points.iter().any(|point| !point.complete) {
        return None;
    }
    let sum = |from: usize| points[from..].iter().map(|point| point.tokens).sum::<u64>();
    Some(Spent {
        last_3h: sum(21),
        day: sum(0),
    })
}

fn rows(app: &App, now: u64) -> Vec<Row> {
    let spent = spent(app, now);
    app.limits.as_deref().map_or_else(Vec::new, |standings| {
        // Tokens are counted per driver, never per account: with several accounts of one driver
        // there is no honest per-account spend, and one account reads as the plain driver.
        crate::board::limits::rows(standings, now, &|provider| {
            if provider.names_account() {
                None
            } else {
                spent.get(&provider.plain()).copied()
            }
        })
    })
}

/// Where the tile painted and how far it is scrolled. Paint records the rows and the area;
/// the wheel over that area moves the offset, clamped to the rows the tile holds.
#[derive(Default)]
pub(in crate::board) struct Scroll {
    area: Cell<Rect>,
    offset: Cell<usize>,
    hidden: Cell<usize>,
}

impl Scroll {
    /// Moves the rows when `point` is over the painted tile; false elsewhere.
    pub(in crate::board) fn wheel(&self, point: Position, down: bool) -> bool {
        if !self.area.get().contains(point) {
            return false;
        }
        let offset = self.offset.get();
        self.offset.set(if down {
            (offset + 1).min(self.hidden.get())
        } else {
            offset.saturating_sub(1)
        });
        true
    }
}

/// A frame that paints no allowance leaves no wheel target behind.
pub(super) fn forget(app: &App) {
    app.digest_allowance.area.set(Rect::default());
}

/// One fitted allowance line; wheel changes the leading provider when several do not fit.
pub(super) fn paint_inline(frame: &mut Frame, app: &App, area: Rect) {
    let rows = rows(app, crate::status::now_ms());
    let scroll = &app.digest_allowance;
    scroll.area.set(area);
    scroll.hidden.set(rows.len().saturating_sub(1));
    scroll
        .offset
        .set(scroll.offset.get().min(scroll.hidden.get()));
    let zone = app.local_zone.clone().unwrap_or(jiff::tz::TimeZone::UTC);
    let span = |text: String, role, bold| {
        (
            ds::TextSpan {
                text,
                role: ds::Token(role),
                bold,
            },
            false,
        )
    };
    let mut spans = vec![span("Allowance ".into(), Role::Muted, false)];
    if rows.is_empty() {
        spans.push(span("unavailable".into(), Role::Muted, false));
    } else {
        for (i, row) in rows.iter().skip(scroll.offset.get()).enumerate() {
            if i > 0 {
                spans.push((
                    ds::TextSpan {
                        text: " · ".into(),
                        role: ds::Token(Role::Text),
                        bold: false,
                    },
                    true,
                ));
            }
            spans.extend(tile_row(
                row,
                &zone,
                matches!(
                    app.cron_glyphs,
                    crate::board::overview::cron_counts::GlyphSet::Ascii
                ),
            ));
        }
    }
    use ds::Component;
    super::paint_grid(frame, app, area, |grid| {
        let mut x = 0u16;
        for (mut span, unstyled) in spans {
            let remaining = usize::from(area.width.saturating_sub(x));
            let clipped = span.text.width() > remaining;
            if clipped {
                // A partially visible provider segment is less useful than a single marker.
                span.text = if remaining > 0 {
                    "…".into()
                } else {
                    String::new()
                };
            }
            let width = area
                .width
                .saturating_sub(x)
                .min(span.text.width().min(u16::MAX as usize) as u16);
            if width == 0 {
                break;
            }
            let rect = ds::Rect {
                x,
                y: 0,
                width,
                height: 1,
            };
            if unstyled {
                // The original separator inherits the foreground from the board.
                grid.text_with(rect, &span.text, None, None, false);
            } else {
                ds::Text::render(&ds::TextProps { spans: vec![span] }, rect, grid);
            }
            x += width;
            if clipped {
                break;
            }
        }
    });
}

fn tile_row(row: &Row, zone: &jiff::tz::TimeZone, ascii: bool) -> Vec<(ds::TextSpan, bool)> {
    let span = |text: String, role, bold| {
        (
            ds::TextSpan {
                text,
                role: ds::Token(role),
                bold,
            },
            false,
        )
    };
    let label = format!("{} ", row.provider.label());
    let Some(weekly) = &row.weekly else {
        return vec![
            span(label, Role::Text, false),
            span("—".into(), Role::Dim, false),
            span("  no recent reading".into(), Role::Muted, false),
        ];
    };
    let (outlook, runs_out) = match weekly.worst() {
        Outcome::RunsOut(at) => (
            format!(
                "{} runs out {}",
                if ascii { "x" } else { "✗" },
                clock(at, zone)
            ),
            true,
        ),
        Outcome::Lasts(_) => ("lasts past reset".into(), false),
        Outcome::Unknown => ("—".into(), false),
    };
    let mut parts = vec![
        span(label, Role::Text, false),
        span(format!("{:.0}%", weekly.left), Role::Text, true),
        (
            ds::TextSpan {
                text: " · ".into(),
                role: ds::Token(Role::Text),
                bold: false,
            },
            true,
        ),
        span(
            outlook,
            if runs_out { Role::Waiting } else { Role::Text },
            false,
        ),
    ];
    if !runs_out {
        parts.push(span(
            format!("  resets {}", clock(weekly.resets_at_ms, zone)),
            Role::Muted,
            false,
        ));
    }
    parts
}

fn clock(at_ms: u64, zone: &jiff::tz::TimeZone) -> String {
    i64::try_from(at_ms)
        .ok()
        .and_then(|ms| jiff::Timestamp::from_millisecond(ms).ok())
        .map_or_else(
            || "—".into(),
            |time| {
                let zoned = time.to_zoned(zone.clone());
                // Two letters, as the weekday of a reset or an empty time reads best short.
                let day: String = zoned.strftime("%a").to_string().chars().take(2).collect();
                format!("{day} {}", zoned.strftime("%H:%M"))
            },
        )
}

struct BudgetRow<'a> {
    budget: &'a crate::config::AllowanceBudget,
    forecast: crate::board::limits::BudgetForecast,
    report: Option<&'a Result<crate::board::usage_report::budgets::SpendReport, String>>,
    quote: Option<&'a crate::board::limits::BudgetQuote>,
    start: u64,
    resets: u64,
}

fn budget_count(app: &App) -> usize {
    app.workspace_snapshot()
        .map_or(0, |snapshot| snapshot.allowance_budgets.len())
}

fn budget_rows(app: &App, now: u64) -> impl Iterator<Item = BudgetRow<'_>> {
    let zone = app.local_zone.clone().unwrap_or(jiff::tz::TimeZone::UTC);
    app.workspace_snapshot()
        .into_iter()
        .flat_map(|snapshot| &snapshot.allowance_budgets)
        .filter_map(move |budget| {
            use crate::board::limits::{budget_forecast, budget_period};
            let (start, resets) = budget_period(budget.period, now, &zone)?;
            let report = app.usage_report.budget(start);
            let quote = report
                .and_then(|report| report.as_ref().ok())
                .and_then(|report| {
                    report
                        .providers
                        .iter()
                        .find(|row| row.provider == budget.provider)
                });
            Some(BudgetRow {
                budget,
                forecast: budget_forecast(budget.limit_usd_micros, start, resets, now, quote),
                report,
                quote,
                start,
                resets,
            })
        })
}

const BUDGET_COLUMNS: [u16; 10] = [20, 21, 12, 11, 16, 16, 16, 16, 7, 16];
const WIDE_BUDGET: u16 = 151;

pub(super) fn budget_height(app: &App, width: u16, available: u16) -> u16 {
    let count = budget_count(app);
    if count == 0 {
        return 0;
    }
    let heading = u16::from(width >= WIDE_BUDGET);
    let height = u16::try_from(count)
        .unwrap_or(u16::MAX)
        .saturating_add(heading);
    let height = height.min(available);
    if height > heading { height } else { 0 }
}

fn money(micros: u128, upper_bound: bool) -> String {
    let cents = if upper_bound {
        micros.div_ceil(10_000)
    } else {
        (micros + 5_000) / 10_000
    };
    if cents % 100 == 0 {
        format!("${}", cents / 100)
    } else {
        format!("${}.{:02}", cents / 100, cents % 100)
    }
}

fn dollars(value: Option<u64>) -> String {
    value.map_or_else(|| "—".into(), |micros| money(u128::from(micros), false))
}

fn dated(at: u64, zone: &jiff::tz::TimeZone) -> String {
    i64::try_from(at)
        .ok()
        .and_then(|ms| jiff::Timestamp::from_millisecond(ms).ok())
        .map_or_else(
            || "—".into(),
            |at| {
                at.to_zoned(zone.clone())
                    .strftime("%b %d %H:%M")
                    .to_string()
            },
        )
}

fn outcome(value: Outcome, zone: &jiff::tz::TimeZone, ascii: bool) -> (String, Role) {
    match value {
        Outcome::RunsOut(at) => (
            format!("{} {}", if ascii { "x" } else { "✗" }, dated(at, zone)),
            Role::Waiting,
        ),
        Outcome::Lasts(micros) => (dollars(Some(micros.round() as u64)), Role::Text),
        Outcome::Unknown => ("—".into(), Role::Dim),
    }
}

impl BudgetRow<'_> {
    fn left(&self) -> String {
        match self.forecast.left_usd_micros {
            Some(micros) if self.forecast.left_is_upper_bound => {
                format!("≤ {}", money(u128::from(micros), true))
            }
            value => dollars(value),
        }
    }

    fn need(&self) -> String {
        self.forecast.need_usd_micros_per_hour.map_or_else(
            || "—".into(),
            |micros| {
                if self.forecast.left_is_upper_bound {
                    format!("≤ {}", money(micros.ceil() as u128, true))
                } else {
                    money(micros.round() as u128, false)
                }
            },
        )
    }

    fn plan(&self) -> String {
        use crate::config::BudgetPeriod;
        let period = match self.budget.period {
            BudgetPeriod::Week => "week",
            BudgetPeriod::Month => "month",
        };
        format!(
            "{} {}/{period}",
            self.budget.provider,
            dollars(Some(self.budget.limit_usd_micros))
        )
    }
}

pub(super) fn paint_budgets(frame: &mut Frame, app: &App, area: Rect) {
    if area.is_empty() {
        return;
    }
    let zone = app.local_zone.clone().unwrap_or(jiff::tz::TimeZone::UTC);
    let ascii = matches!(
        app.cron_glyphs,
        crate::board::overview::cron_counts::GlyphSet::Ascii
    );
    let wide = area.width >= WIDE_BUDGET;
    super::paint_grid(frame, app, area, |grid| {
        let text = |grid: &mut ds::CellGrid, y, x, width: u16, value: &str, role| {
            grid.text_with(
                ds::Rect {
                    x,
                    y,
                    width,
                    height: 1,
                },
                &crate::board::view::fit(value, width.saturating_sub(1).into()),
                Some(role),
                None,
                false,
            );
        };
        let mut y = 0;
        if wide {
            let mut x = 0;
            for (width, title) in BUDGET_COLUMNS.into_iter().zip([
                "SOURCE", "PLAN", "LEFT", "NEED/h", "3 h", "6 h", "24 h", "phase", "tokens",
                "RESETS",
            ]) {
                text(grid, y, x, width, title, Role::Muted);
                x += width;
            }
            y += 1;
        }
        for row in budget_rows(app, crate::status::now_ms()).take(usize::from(area.height - y)) {
            if wide {
                let [h3, h6, h24, phase] =
                    row.forecast.lines.map(|line| outcome(line, &zone, ascii));
                let fields = [
                    (row.budget.name.clone(), Role::Text),
                    (row.plan(), Role::Muted),
                    (row.left(), Role::Text),
                    (row.need(), Role::Text),
                    h3,
                    h6,
                    h24,
                    phase,
                    (String::new(), Role::Text),
                    (dated(row.resets, &zone), Role::Muted),
                ];
                let mut x = 0;
                for (width, (value, role)) in BUDGET_COLUMNS.into_iter().zip(fields) {
                    text(grid, y, x, width, &value, role);
                    x += width;
                }
            } else if row.forecast.left_usd_micros.is_none() {
                let suffix = " · spend unknown";
                let name = crate::board::view::fit(
                    &row.budget.name,
                    usize::from(area.width).saturating_sub(suffix.width() + 1),
                );
                text(
                    grid,
                    y,
                    0,
                    area.width,
                    &format!("{}{suffix}", name.trim_end()),
                    Role::Muted,
                );
            } else {
                let (projection, role) = outcome(
                    crate::board::limits::worst(row.forecast.lines),
                    &zone,
                    ascii,
                );
                let figures = format!("{} left · {}/h needed · ", row.left(), row.need());
                let projection_width = u16::try_from(projection.width()).unwrap_or(u16::MAX);
                let fields = figures
                    .width()
                    .saturating_add(usize::from(projection_width) + 2);
                let label = crate::board::view::fit(
                    &row.budget.name,
                    usize::from(area.width).saturating_sub(fields),
                );
                let prefix = format!("{} {figures}", label.trim_end());
                let prefix_width = u16::try_from(prefix.width())
                    .unwrap_or(u16::MAX)
                    .min(area.width);
                text(
                    grid,
                    y,
                    0,
                    prefix_width.saturating_add(1).min(area.width),
                    &prefix,
                    Role::Text,
                );
                text(
                    grid,
                    y,
                    prefix_width,
                    area.width - prefix_width,
                    &projection,
                    role,
                );
            }
            y += 1;
        }
    });
}

fn budget_prices<'a>(
    row: &'a BudgetRow<'a>,
) -> impl Iterator<Item = &'a crate::labels::digest::PricedModel> {
    row.report
        .and_then(|report| report.as_ref().ok())
        .and_then(|report| report.pricing.as_ref())
        .into_iter()
        .flat_map(|pricing| &pricing.models)
        .filter(move |model| {
            row.quote
                .is_some_and(|quote| quote.models.contains(&model.model_id))
        })
}

pub(super) fn budget_sources(app: &App, now: u64) -> Vec<String> {
    budget_rows(app, now)
        .flat_map(|row| {
            budget_prices(&row)
                .map(|model| model.source.clone())
                .collect::<Vec<_>>()
        })
        .collect()
}

pub(super) fn readable_reasons(reasons: &[String]) -> String {
    let labels = reasons.iter().map(|id| match id.as_str() {
        "no_price" => "no price",
        "class_price_missing" => "token class price missing",
        "unsafe_cost" => "unsafe cost",
        "cache_write_unreported" => "cache writes unreported",
        "attribution_split_dropped" => "model attribution split dropped",
        "coverage_partial" => "coverage partial",
        "before_retention" => "before retained history",
        "unmapped_model" => "unmapped model",
        "retired_unread" => "retired members unread",
        "usage_unreadable" => "usage unreadable",
        _ => id,
    });
    crate::board::notes::sanitize(&labels.collect::<Vec<_>>().join(", "))
}

pub(super) fn budget_details(app: &App, now: u64) -> Vec<String> {
    let zone = app.local_zone.clone().unwrap_or(jiff::tz::TimeZone::UTC);
    let ascii = matches!(
        app.cron_glyphs,
        crate::board::overview::cron_counts::GlyphSet::Ascii
    );
    let mut lines = Vec::new();
    for row in budget_rows(app, now) {
        lines.push(format!("{} · {}", row.budget.name, row.plan()));
        lines.push(format!(
            "All {} usage on this machine; other machines not included. List-price estimate.",
            row.budget.provider
        ));
        lines.push(format!(
            "Period: {}–{}",
            dated(row.start, &zone),
            dated(row.resets, &zone)
        ));
        if let Some(prices) = row
            .report
            .and_then(|report| report.as_ref().ok())
            .and_then(|report| report.pricing.as_ref())
        {
            lines.push(format!(
                "Digest list-price table {} · as of {}{}",
                prices.version,
                prices.as_of,
                prices
                    .origin
                    .map_or_else(String::new, |origin| format!(" · {origin}"))
            ));
            for price in budget_prices(&row) {
                let effective = price
                    .effective_from
                    .as_ref()
                    .map_or_else(String::new, |day| format!(" from {day}"));
                lines.push(format!(
                    "{}{} · {}",
                    price.model_id, effective, price.source
                ));
            }
        }
        lines.push(format!("LEFT {} · NEED/h {}", row.left(), row.need()));
        for (label, projection) in ["3 h", "6 h", "24 h", "phase"]
            .into_iter()
            .zip(row.forecast.lines)
        {
            lines.push(format!("{label}: {}", outcome(projection, &zone, ascii).0));
        }
        if let Some(quote) = row.quote {
            lines.push(format!(
                "Observed {}–{}",
                dated(quote.from_ms, &zone),
                dated(quote.to_ms, &zone)
            ));
            if !quote.total.reasons.is_empty() {
                lines.push(format!("Spend: {}", readable_reasons(&quote.total.reasons)));
            }
            for pace in &quote.pace {
                if !pace.spend.reasons.is_empty() {
                    lines.push(format!(
                        "{} h pace: {}",
                        pace.window_ms / 3_600_000,
                        readable_reasons(&pace.spend.reasons)
                    ));
                }
            }
        } else if let Some(Err(message)) = row.report {
            lines.push(format!(
                "Spend unavailable: {}",
                crate::board::notes::sanitize(message)
            ));
        }
    }
    lines
}
