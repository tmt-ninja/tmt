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
    if available >= 18 { 6 } else { 3.min(available) }
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
    // A source that reports no usage does not erase every observed agent's
    // buckets. Totals still expose the missing coverage as partial.
    let ids: Vec<_> = ids
        .iter()
        .copied()
        .filter(|id| report.seat(id).is_some())
        .collect();
    let Some(first) = ids
        .iter()
        .find_map(|id| report.seat(id)?.window_series.as_ref())
    else {
        return Vec::new();
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
            for id in &ids {
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
            strip::paint_left(
                frame.buffer_mut(),
                Rect::new(area.x, area.y + y, area.width, 1),
                Line::styled(
                    crate::board::view::fit(&text, usize::from(area.width)),
                    app.look().role(role),
                ),
            );
        }
    };
    if area.height < 6 {
        line(frame, 1, totals, Role::Text);
        return;
    }
    strip::paint_left(
        frame.buffer_mut(),
        Rect::new(area.x, area.y + 1, area.width, 1),
        Line::from(vec![
            Span::styled("█", app.look().role(Role::Text)),
            Span::styled(" used  ", app.look().role(Role::Muted)),
            Span::styled("█", app.look().role(Role::Accent)),
            Span::styled(" saved", app.look().role(Role::Muted)),
        ]),
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
    let inset = if area.width >= 100 { 10 } else { 0 };
    let side = if area.width >= 100 { 40 } else { 0 };
    let chart_width = area
        .width
        .saturating_sub(inset + side + u16::from(side > 0))
        .min(72);
    let points = grouped
        .iter()
        .map(|p| (p.used, p.saved))
        .collect::<Vec<_>>();
    tmt_tui::components::StackedBars {
        points: &points,
        used: app.look().role(Role::Text),
        saved: app.look().role(Role::Accent),
        unknown: app.look().role(Role::Dim),
        empty: app.look().role(Role::Muted),
        single_cell: true,
    }
    .paint(
        frame.buffer_mut(),
        Rect::new(area.x + inset, area.y + 2, chart_width, 2),
    );
    if side > 0 {
        let used = metrics::token_text(metrics::tokens(metrics::report(app), &ids));
        let saved = amount(
            &sum,
            if app.digest_cost {
                SavingsUnit::Cost
            } else {
                SavingsUnit::Tokens
            },
        );
        let percent = sum
            .percent
            .value
            .map_or("—".into(), crate::board::savings::percent_text);
        let money = amount(&sum, SavingsUnit::Cost);
        let columns = [
            ("TOK", used.as_str()),
            ("saved", saved.as_str()),
            ("saved %", percent.as_str()),
            ("≈ $ saved", money.as_str()),
        ];
        tmt_tui::components::TotalsTable {
            columns: &columns,
            header: app.look().role(Role::Muted),
            value: app.look().role(Role::Text),
            value_row: 2,
        }
        .paint(
            frame.buffer_mut(),
            Rect::new(
                area.x + inset + chart_width + 1,
                area.y + 1,
                area.right()
                    .saturating_sub(area.x + inset + chart_width + 1),
                3,
            ),
        );
    }
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
            strip::paint_left(
                frame.buffer_mut(),
                Rect::new(
                    area.x + inset + x as u16,
                    area.y + 4,
                    label.width() as u16,
                    1,
                ),
                Line::styled(label, app.look().role(Role::Muted)),
            );
        }
    }
    let definition = "saved = context the agents did not reread (estimate, list price)";
    let definition_width = definition.width() as u16;
    let allowance_width = if area.width >= 150 {
        area.width.saturating_sub(definition_width + 2)
    } else {
        area.width
    };
    super::allowance::paint_inline(
        frame,
        app,
        Rect::new(area.x, area.y + 5, allowance_width, 1),
    );
    if allowance_width < area.width {
        strip::paint_left(
            frame.buffer_mut(),
            Rect::new(
                area.x + allowance_width + 2,
                area.y + 5,
                definition_width,
                1,
            ),
            Line::styled(definition, app.look().role(Role::Muted)),
        );
    }
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
    let right = "Range ".width() as u16 + chip(&window) + chip(&each) + 9 + 4;
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
    let chips = [
        tmt_tui::components::Chip {
            label: "TOK",
            selected: !app.digest_cost,
            focused: false,
        },
        tmt_tui::components::Chip {
            label: "$",
            selected: app.digest_cost,
            focused: false,
        },
    ];
    let hits = tmt_tui::components::ChipRow {
        idle: look.role(Role::Muted),
        selected: look.selection(),
        focused: look.selection(),
    }
    .paint(
        frame.buffer_mut(),
        Rect::new(x, area.y, area.right().saturating_sub(x), 1),
        &chips,
    );
    for (index, hit) in hits.into_iter().enumerate() {
        if index == usize::from(!app.digest_cost)
            && let Some(rect) = hit
        {
            app.workspace_strip_hits
                .borrow_mut()
                .push((rect, Choice::SavingsUnit));
        }
    }

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
            let text = global.text.strip_prefix("Digest: ").unwrap_or(&global.text);
            let text = if text == "on (auto)" {
                "on · auto"
            } else {
                text
            };
            parts.push((
                format!("{} {text}", if global.enabled { "●" } else { "○" }),
                Role::Text,
                None,
            ));
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
    let lead = if named { "" } else { "Digest  " };
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
