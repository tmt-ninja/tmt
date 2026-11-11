//! Digest window controls, aligned TOK bars and totals over admitted, held evidence.
use super::{metrics, model};
use crate::{
    board::{
        app::{App, Choice},
        buttons::Button,
        usage_report::View,
    },
    config::SavingsUnit,
    labels::digest::SavingsSummary,
};
use ratatui::{
    Frame,
    layout::Rect,
    style::{Modifier, Style},
    text::{Line, Span},
};
use tmt_cli_style::{Role, grid::Align};
use tmt_tui::components::strip;
use unicode_width::UnicodeWidthStr;

pub(super) fn height(_app: &App, _width: u16, available: u16) -> u16 {
    if available >= 18 { 8 } else { 3.min(available) }
}

/// One unit's amount without its coverage: a conflict names itself, missing is `—`.
fn amount(summary: &SavingsSummary, unit: SavingsUnit) -> String {
    let (value, _, conflict) = crate::board::savings::savings_value(summary, unit);
    let value = conflict
        .map(str::to_owned)
        .or(value)
        .unwrap_or_else(|| "—".into());
    value.trim_end_matches(" at list price").to_owned()
}

/// One bucket is observed usage plus estimated avoided input, with saved at its base.
#[derive(Clone)]
pub(in crate::board) struct Bucket {
    pub used: Option<u64>,
    pub saved: Option<u64>,
}
pub(super) fn capture_buckets(app: &App, ids: &[&str]) -> Vec<Bucket> {
    let Some(report) = metrics::report(app) else {
        return Vec::new();
    };
    let Some(first) = ids
        .iter()
        .find_map(|id| report.seat(id)?.window_series.as_ref())
    else {
        let count = match app.digest_window() {
            crate::config::DigestWindow::Day => 24,
            crate::config::DigestWindow::Week => 7,
            crate::config::DigestWindow::Month => 30,
        };
        return vec![
            Bucket {
                used: None,
                saved: None
            };
            count
        ];
    };
    let status = app
        .labels
        .digest()
        .filter(|(_, stale)| !*stale)
        .map(|(status, _)| status);
    (0..first.points.len())
        .map(|i| {
            let from = first.from_ms + i as u64 * first.bucket_ms;
            let mut used = Some(0u64);
            let mut saved = Some(0u64);
            for id in ids {
                // No usage source contributes nothing; the aggregate's coverage
                // marker still makes that missing evidence visible.
                if report.seat(id).is_none() {
                    continue;
                }
                let point = report
                    .seat(id)
                    .and_then(|seat| seat.window_series.as_ref())
                    .filter(|series| {
                        series.from_ms == first.from_ms && series.bucket_ms == first.bucket_ms
                    })
                    .and_then(|series| series.points.get(i));
                used = used
                    .zip(point.filter(|p| p.complete))
                    .and_then(|(sum, p)| sum.checked_add(p.tokens));
                let value = status
                    .and_then(|status| status.members.get(*id))
                    .and_then(|member| member.savings.as_ref());
                let value = value
                    .filter(|s| s.window == app.digest_window())
                    .and_then(|s| s.series.as_ref())
                    .and_then(|points| {
                        points.iter().find(|point| {
                            point.from_ms == from && point.to_ms == from + first.bucket_ms
                        })
                    });
                saved = saved
                    .zip(
                        value
                            .filter(|point| point.complete)
                            .and_then(|point| point.tokens),
                    )
                    .and_then(|(sum, n)| sum.checked_add(n));
            }
            Bucket { used, saved }
        })
        .collect()
}

pub(super) fn paint(frame: &mut Frame, app: &App, area: Rect) {
    if area.is_empty() {
        return;
    }
    super::allowance::forget(app);
    status_row(frame, app, Rect { height: 1, ..area });
    let rows = app.workspace_rows();
    let ids = rows.iter().filter_map(metrics::id).collect::<Vec<_>>();
    let sum = super::savings(app);
    let totals = if app.digest_cost {
        format!(
            "Window list-price equivalent · saved {} · not a bill",
            amount(&sum, SavingsUnit::Cost)
        )
    } else {
        format!(
            "TOK {} · saved {} · saved % {}",
            metrics::token_text(metrics::tokens(metrics::report(app), &ids)),
            amount(&sum, SavingsUnit::Tokens),
            sum.percent
                .value
                .map_or("unavailable".into(), crate::board::savings::percent_text)
        )
    };
    let line = |frame: &mut Frame, y: u16, text: String, role: Role| {
        if y < area.height {
            paint_text(
                frame,
                app,
                Rect::new(area.x, area.y + y, area.width, 1),
                text,
                role,
            );
        }
    };
    if area.height < 8 {
        line(frame, 1, totals, Role::Text);
        return;
    }
    line(
        frame,
        1,
        format!(
            "█ used TOK{}  ▄ saved input (estimate) · {}",
            if metrics::tokens(metrics::report(app), &ids).is_some_and(|(_, partial)| partial) {
                " ≥"
            } else {
                ""
            },
            if app.digest_cost {
                "$ window totals; chart stays TOK"
            } else {
                "TOK"
            }
        ),
        Role::Muted,
    );
    let buckets = super::chart_buckets(app);
    let each = app.digest_each.max(1);
    let each = if buckets.len().is_multiple_of(each) {
        each
    } else {
        1
    };
    let grouped = buckets
        .chunks(each)
        .map(|chunk| Bucket {
            used: chunk
                .iter()
                .try_fold(0u64, |sum, p| sum.checked_add(p.used?)),
            saved: chunk
                .iter()
                .try_fold(0u64, |sum, p| sum.checked_add(p.saved?)),
        })
        .collect::<Vec<_>>();
    let side = if area.width >= 120 { 40 } else { 0 };
    crate::board::spark_row::stacked(
        frame.buffer_mut(),
        Rect::new(
            area.x,
            area.y + 2,
            area.width - side - u16::from(side > 0),
            2,
        ),
        &grouped
            .iter()
            .map(|p| (p.used, p.saved))
            .collect::<Vec<_>>(),
        app.look(),
    );
    if side > 0 {
        let texts = [
            format!(
                "used {}",
                metrics::token_text(metrics::tokens(metrics::report(app), &ids))
            ),
            format!(
                "saved {} · {}",
                amount(&sum, SavingsUnit::Tokens),
                sum.percent
                    .value
                    .map_or("unavailable".into(), crate::board::savings::percent_text)
            ),
        ];
        for (i, text) in texts.into_iter().enumerate() {
            paint_text(
                frame,
                app,
                Rect::new(area.right() - side, area.y + 2 + i as u16, side, 1),
                text,
                Role::Text,
            );
        }
    }
    let chart_width = area.width - side - u16::from(side > 0);
    let (start, middle) = match app.digest_window() {
        crate::config::DigestWindow::Day => ("−24h", "−12h"),
        crate::config::DigestWindow::Week => ("−7d", "−3.5d"),
        crate::config::DigestWindow::Month => ("−30d", "−15d"),
    };
    let end = "now";
    let width = usize::from(chart_width);
    let start_width = start.width();
    let end_width = end.width();
    if width > start_width + end_width {
        let mut labels = vec![(0, start), (width - end_width, end)];
        let mid_x = width.saturating_sub(middle.width()) / 2;
        if mid_x > start_width && mid_x + middle.width() < width - end_width {
            labels.push((mid_x, middle));
        }
        for (x, label) in labels {
            paint_text(
                frame,
                app,
                Rect::new(area.x + x as u16, area.y + 4, label.width() as u16, 1),
                label.into(),
                Role::Muted,
            );
        }
    }
    line(frame, 5, totals, Role::Text);
    super::allowance::paint_inline(frame, app, Rect::new(area.x, area.y + 6, area.width, 1));
    line(
        frame,
        7,
        "Saved = avoided input · estimate, not a bill".into(),
        Role::Muted,
    );
}
fn paint_text(frame: &mut Frame, app: &App, area: Rect, text: String, role: Role) {
    use ds::Component;
    use tmt_tui::components::design_system as ds;
    super::paint_grid(frame, app, area, |grid| {
        ds::Text::render(
            &ds::TextProps {
                spans: vec![ds::TextSpan {
                    text: crate::board::view::fit(&text, usize::from(area.width)),
                    role: ds::Token(role),
                    bold: false,
                }],
            },
            ds::Rect {
                x: 0,
                y: 0,
                width: area.width,
                height: 1,
            },
            grid,
        );
    });
}
fn status_row(frame: &mut Frame, app: &App, area: Rect) {
    let look = app.look();
    let window = format!("{} ▾", app.digest_window().label());
    let chip = |label: &str| label.width() as u16 + 2;
    let native = if app.digest_window() == crate::config::DigestWindow::Day {
        "h"
    } else {
        "d"
    };
    let each = format!("{}{} per bar ▾", app.digest_each.max(1), native);
    let unit = if app.digest_cost { "$ ▾" } else { "TOK ▾" };
    let right = "Range ".width() as u16 + chip(&window) + chip(&each) + chip(unit) + 4;
    let start = area.right().saturating_sub(right).max(area.x);
    let mut x = start;
    let text = |frame: &mut Frame, x: &mut u16, text: &str| {
        strip::paint_left(
            frame.buffer_mut(),
            Rect::new(*x, area.y, area.right().saturating_sub(*x), 1),
            Line::styled(text.to_owned(), look.role(Role::Muted)),
        );
        *x = x.saturating_add(text.width() as u16);
    };
    let button = |frame: &mut Frame, x: &mut u16, label: &str, choice: Choice| {
        let rect = crate::board::buttons::paint(
            app,
            frame.buffer_mut(),
            Rect::new(*x, area.y, area.right().saturating_sub(*x), 1),
            &[Button::secondary(label)],
            Align::Left,
            None,
        )[0];
        if let Some(rect) = rect {
            app.workspace_strip_hits.borrow_mut().push((rect, choice));
            *x = rect.right();
        }
    };
    text(frame, &mut x, "Range ");
    button(frame, &mut x, &window, Choice::DigestWindowMenu);
    x = x.saturating_add(3);
    button(frame, &mut x, &each, Choice::DigestBarsMenu);
    button(frame, &mut x, unit, Choice::SavingsUnit);

    let left = Rect::new(area.x, area.y, start.saturating_sub(area.x + 2), 1);
    let mut parts: Vec<(String, Role, Option<Choice>)> = Vec::new();
    // Health comes before the optional fields so a short row keeps it.
    if let Some(notice) = model::tick_notice(&app.labels) {
        parts.push((notice, Role::Waiting, None));
    }
    if app.labels.digest().is_none() {
        parts.push(("unavailable".into(), Role::Muted, None));
    }
    if app.loading() {
        parts.push(("Loading workspace…".into(), Role::Muted, None));
    }
    let usage = match app.usage_report.view_for(app.digest_range()) {
        View::Loading => "Usage loading…",
        View::Failed(_) => "Usage unavailable",
        View::Report(_) if app.usage_report.refresh_error(app.digest_range()).is_some() => {
            "Usage stale · refresh failed"
        }
        _ => "",
    };
    if !usage.is_empty() {
        parts.push((usage.into(), Role::Text, None));
    }
    if let Some((status, stale)) = app.labels.digest() {
        if stale {
            parts.push(("stale".into(), Role::Waiting, None));
        }
        if let Some(global) = status.global.as_ref() {
            parts.push((global.text.clone(), Role::Text, None));
        }
        parts.push((format!("{} held", super::held_text(app)), Role::Text, None));
        if let Some(tick) = status.tick {
            let zone = app.local_zone.clone().unwrap_or(jiff::tz::TimeZone::UTC);
            let at = model::observation_clock(tick.last_at_ms, crate::status::now_ms(), &zone);
            parts.push((format!("tick {at}"), Role::Muted, None));
        }
    }
    // The supplier's own switch text usually names Digest already; the row names it once.
    let named = parts
        .iter()
        .any(|(text, _, choice)| choice.is_some() && text.starts_with("Digest"));
    let lead = if named { "" } else { "Digest: " };
    let mut spans = vec![Span::styled(lead, strong(app))];
    let mut used = lead.width();
    let mut first = true;
    for (text, role, choice) in parts {
        let gap = if first { 0 } else { 3 };
        if used + gap + text.width() > usize::from(left.width) {
            continue;
        }
        if gap > 0 {
            spans.push(Span::styled(" · ", look.role(Role::Muted)));
        }
        if let Some(choice) = choice {
            app.workspace_strip_hits.borrow_mut().push((
                Rect::new(left.x + (used + gap) as u16, left.y, text.width() as u16, 1),
                choice,
            ));
        }
        used += gap + text.width();
        first = false;
        spans.push(Span::styled(text, look.role(role)));
    }
    strip::paint_left(frame.buffer_mut(), left, Line::from(spans));
}

/// Values read as bright bold text; states keep their mark and word, never a colour.
fn strong(app: &App) -> Style {
    app.look().role(Role::Text).add_modifier(Modifier::BOLD)
}
