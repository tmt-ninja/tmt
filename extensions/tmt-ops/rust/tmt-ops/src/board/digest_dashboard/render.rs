use super::{metrics, table};
use crate::board::{app::App, exchange_matrix};
use crate::config::Pane;
use ratatui::{Frame, layout::Rect, text::Line};
use tmt_cli_style::Role;
use tmt_tui::components::strip;

pub(super) fn pane_frame(
    frame: &mut Frame,
    app: &App,
    area: Rect,
    pane: Pane,
    title: &str,
) -> Rect {
    pane_frame_with_note(frame, app, area, pane, title, None)
}

pub(super) fn pane_frame_with_note(
    frame: &mut Frame,
    app: &App,
    area: Rect,
    pane: Pane,
    title: &str,
    note: Option<&str>,
) -> Rect {
    use ds::Component;
    use tmt_tui::components::design_system as ds;
    if area.is_empty() {
        return area;
    }
    super::paint_grid(frame, app, Rect { height: 1, ..area }, |grid| {
        ds::PaneRule::render(
            &ds::PaneRuleProps {
                title: title.into(),
                note: note.map(str::to_owned),
                note_role: None,
                focused: app.focused() == pane,
                ascii: matches!(
                    app.cron_glyphs,
                    crate::board::overview::cron_counts::GlyphSet::Ascii
                ),
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
    content_area(area)
}

/// Retain the original pane content rectangle and its pointer/scroll geometry.
pub(super) fn content_area(area: Rect) -> Rect {
    crate::board::pane_chrome::content_area(area)
}

/// Summary and content share the same placement owner as focus and pointer input.
pub(in crate::board) fn render(frame: &mut Frame, app: &App, area: Rect) {
    let _rows = app.workspace_frame_rows();
    if let Some(inline) = &app.digest_inline {
        inline.visible.set(false);
    }
    let band_height = super::summary::height(app, area.width, area.height);
    super::summary::paint(
        frame,
        app,
        Rect {
            height: band_height,
            ..area
        },
    );
    let top = band_height;
    let body = Rect::new(
        area.x,
        area.y.saturating_add(top),
        area.width,
        area.height.saturating_sub(top),
    );
    app.conversation.borrow_mut().area = body;
    let placement = app.digest_placement(body);
    use crate::action::ResizeBoundary as Boundary;
    app.pane_resize.record_panes(
        placement,
        Boundary::DigestColumns,
        Boundary::DigestRows,
        94,
        frame.area(),
    );
    if let Some(list) = placement.list {
        table::paint(frame, app, list);
    }
    app.conversation.borrow_mut().pane = placement.conversation;
    if let Some(side) = placement.conversation {
        let wide = placement
            .list
            .is_some_and(|list| list.y == side.y && list.x != side.x);
        let details = app.digest_panels().side_shown();
        let side = if details {
            let inside = pane_frame(frame, app, side, Pane::Replies, &super::details::title(app));
            if wide && side.width > 2 && side.height > 2 {
                let ascii = matches!(
                    app.cron_glyphs,
                    crate::board::overview::cron_counts::GlyphSet::Ascii
                );
                let style = app.look().role(Role::Dim);
                if app.focused() != Pane::Replies {
                    frame.buffer_mut()[(side.x, side.y)]
                        .set_symbol(if ascii { "+" } else { "┬" })
                        .set_style(style);
                }
                for y in side.y + 1..side.bottom() {
                    frame.buffer_mut()[(side.x, y)]
                        .set_symbol(if ascii { "|" } else { "│" })
                        .set_style(style);
                }
            }
            inside
        } else {
            side
        };
        if wide {
            let matrix_height = 6.min(side.height / 3);
            matrix(
                frame,
                app,
                Rect {
                    height: matrix_height,
                    ..side
                },
                !details,
            );
            if details {
                detail(
                    frame,
                    app,
                    Rect::new(
                        side.x,
                        side.y + matrix_height,
                        side.width,
                        side.height - matrix_height,
                    ),
                );
            }
        } else {
            let matrix_height = if details {
                7.min(side.height / 3)
            } else {
                side.height
            };
            matrix(
                frame,
                app,
                Rect {
                    height: matrix_height,
                    ..side
                },
                !details,
            );
            if details {
                detail(
                    frame,
                    app,
                    Rect::new(
                        side.x,
                        side.y + matrix_height,
                        side.width,
                        side.height - matrix_height,
                    ),
                );
            }
        }
    }
}
fn matrix(frame: &mut Frame, app: &App, area: Rect, chrome: bool) {
    let title = format!("Exchanges · {}", app.digest_window().label());
    let inside = if chrome {
        pane_frame_with_note(frame, app, area, Pane::Replies, &title, Some("messages"))
    } else {
        if !area.is_empty() {
            use ds::Component;
            use tmt_tui::components::design_system as ds;
            super::paint_grid(frame, app, Rect { height: 1, ..area }, |grid| {
                ds::SectionRule::render(
                    &ds::SectionRuleProps {
                        title: title.clone(),
                        note: Some("messages".into()),
                        note_role: None,
                        focused: false,
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
        Rect::new(
            area.x.saturating_add(u16::from(area.width > 0)),
            area.y.saturating_add(u16::from(area.height > 0)),
            area.width.saturating_sub(2),
            area.height.saturating_sub(1),
        )
    };
    if inside.is_empty() {
        return;
    }
    let ranked = super::exchange_participants(app);
    let selected = app
        .workspace
        .selected
        .as_ref()
        .and_then(|target| match target {
            crate::board::workspace::OpsTarget::Member { identity_id, .. } => {
                Some(identity_id.as_str())
            }
            _ => None,
        });
    let report = metrics::report(app);
    let empty = if ranked.is_empty() {
        Some("No agents observed")
    } else if report
        .and_then(|report| report.exchange.as_ref())
        .is_some_and(|traffic| traffic.maximum == 0)
    {
        Some("No exchanges in this range")
    } else {
        None
    };
    if let Some(text) = empty {
        strip::paint_left(
            frame.buffer_mut(),
            Rect {
                height: 1,
                ..inside
            },
            Line::styled(text, app.look().role(Role::Muted)),
        );
    } else {
        use ds::Component;
        use tmt_tui::components::design_system as ds;
        let traffic = report.and_then(|report| report.exchange.as_ref());
        let Some(props) = exchange_matrix::digest_props(inside, &ranked, selected, traffic) else {
            return;
        };
        super::paint_grid(frame, app, inside, |grid| {
            ds::TotalsTable::render(
                &props,
                ds::Rect {
                    x: 0,
                    y: 0,
                    width: inside.width,
                    height: inside.height,
                },
                grid,
            );
        });
    }
}
fn detail(frame: &mut Frame, app: &App, area: Rect) {
    let mut inside = area;
    if inside.is_empty() {
        return;
    }
    // Impact ends with the way to its basis, kept in view below the scrolled amounts.
    if inside.height > 2 {
        let row = Rect::new(inside.x, inside.bottom() - 1, inside.width, 1);
        if let Some(rect) = crate::board::buttons::paint(
            app,
            frame.buffer_mut(),
            row,
            &[crate::board::buttons::Button::secondary(BASIS)],
            tmt_cli_style::grid::Align::Left,
            None,
        )[0]
        {
            app.workspace_strip_hits
                .borrow_mut()
                .push((rect, crate::board::app::Choice::DigestBasis));
            if let Some(pricing) = app
                .labels
                .digest()
                .and_then(|(status, _)| status.pricing.as_ref())
            {
                let x = rect.right().saturating_add(2);
                if x < row.right() {
                    strip::paint_left(
                        frame.buffer_mut(),
                        Rect::new(x, row.y, row.right() - x, 1),
                        Line::styled(
                            format!("prices as of {}", pricing.as_of),
                            app.look().role(Role::Muted),
                        ),
                    );
                }
            }
        }
        inside.height -= 1;
    }
    let lines = detail_lines(
        app,
        inside.width,
        inside.height,
        crate::status::now_ms(),
        app.selected_row(),
    );
    if let Some(inline) = &app.digest_inline {
        let focused = inline
            .lines()
            .into_iter()
            .find(|line| line.starts_with('▸'));
        let visible = focused
            .and_then(|line| {
                let wrapped = crate::board::notes::wrap(&line, usize::from(inside.width));
                let start = lines.windows(wrapped.len().max(1)).position(|block| {
                    block
                        .iter()
                        .map(ToString::to_string)
                        .eq(wrapped.iter().cloned())
                })?;
                app.scrolls.reveal_range(
                    Pane::Replies,
                    start..start + wrapped.len(),
                    inside,
                    lines.len(),
                );
                let offset = app.scrolls.offset(Pane::Replies);
                let height = crate::board::scroll::Scrolls::viewport(inside, lines.len());
                Some(start >= offset && start + wrapped.len() <= offset + height)
            })
            .unwrap_or(false);
        inline.visible.set(visible);
    }
    app.scrolls.show_paint(
        frame,
        Pane::Replies,
        inside,
        lines.len(),
        app.look(),
        |frame, viewport, offset| {
            use ds::Component;
            use tmt_tui::components::design_system as ds;
            super::paint_grid(frame, app, viewport, |grid| {
                for (y, line) in lines
                    .iter()
                    .skip(offset)
                    .take(usize::from(viewport.height))
                    .enumerate()
                {
                    let text = line.to_string();
                    if let Some(title) = text
                        .strip_prefix("── ")
                        .and_then(|text| text.strip_suffix(" ──"))
                    {
                        let (title, note) = title
                            .split_once(" | ")
                            .map_or((title, None), |(title, note)| {
                                (title, Some(note.to_owned()))
                            });
                        ds::SectionRule::render(
                            &ds::SectionRuleProps {
                                title: title.into(),
                                note,
                                note_role: None,
                                focused: false,
                            },
                            ds::Rect {
                                x: 0,
                                y: y as u16,
                                width: viewport.width,
                                height: 1,
                            },
                            grid,
                        );
                        continue;
                    }
                    if paint_mode_chips(app, grid, y as u16, viewport.width, &text) {
                        continue;
                    }
                    if paint_trend(app, grid, y as u16, viewport.width, &text) {
                        continue;
                    }
                    if let Some(props) = model_gauge(app, &text) {
                        ds::Gauge::render(
                            &props,
                            ds::Rect {
                                x: 0,
                                y: y as u16,
                                width: viewport.width,
                                height: 1,
                            },
                            grid,
                        );
                        continue;
                    }
                    ds::Text::render(
                        &ds::TextProps {
                            spans: vec![ds::TextSpan {
                                text: line.to_string(),
                                role: ds::Token(Role::Text),
                                bold: false,
                            }],
                        },
                        ds::Rect {
                            x: 0,
                            y: y as u16,
                            width: viewport.width,
                            height: 1,
                        },
                        grid,
                    );
                }
            });
        },
    );
    if !inside.is_empty()
        && let Some(target) = app.row_target(app.selected)
    {
        app.frame_clocks
            .borrow_mut()
            .push(crate::board::view::ClockSurface::DigestDetails {
                target,
                width: inside.width,
                height: inside.height,
            });
    }
}

fn paint_mode_chips(
    app: &App,
    grid: &mut tmt_tui::components::design_system::CellGrid,
    y: u16,
    width: u16,
    line: &str,
) -> bool {
    use ds::Component;
    use tmt_tui::components::design_system as ds;
    let compact =
        line.starts_with("Delivery ·") && line.contains("mode Auto Interval Off Use default");
    if !compact
        && !line.starts_with("mode Auto Interval Off Use default")
        && !line.trim_start_matches(['▸', ' ']).starts_with("mode ")
    {
        return false;
    }
    let inline = app.digest_inline.as_ref();
    let selected = inline.map(|edit| edit.mode).or_else(|| {
        let id = app.selected_row()?.get("id")?.as_str()?;
        let member = app.labels.digest()?.0.members.get(id)?;
        Some(match member.mode {
            crate::labels::digest::Mode::Auto => 0,
            crate::labels::digest::Mode::Interval => 1,
            crate::labels::digest::Mode::Off => 2,
        })
    });
    ds::ChipRow::render(
        &ds::ChipRowProps {
            label: if compact {
                "Delivery · mode "
            } else {
                "mode "
            }
            .into(),
            chips: ["Auto", "Interval", "Off", "Use default"]
                .into_iter()
                .enumerate()
                .map(|(id, label)| ds::Chip {
                    id: id as u64,
                    label: label.into(),
                    gap: " ".into(),
                    enabled: true,
                })
                .collect(),
            selected,
            cursor: inline.filter(|edit| edit.field == 0).map(|edit| edit.mode),
            active: inline.is_some_and(|edit| edit.field == 0),
        },
        ds::Rect {
            x: 0,
            y,
            width,
            height: 1,
        },
        grid,
    );
    true
}

fn paint_trend(
    app: &App,
    grid: &mut tmt_tui::components::design_system::CellGrid,
    y: u16,
    width: u16,
    line: &str,
) -> bool {
    use ds::Component;
    use tmt_tui::components::design_system as ds;
    use unicode_width::UnicodeWidthStr;
    let (saved, total) = if let Some(total) = line.strip_prefix("used trend ") {
        (false, total)
    } else if let Some(total) = line.strip_prefix("saved trend ") {
        (true, total)
    } else {
        return false;
    };
    let rows = app.workspace_rows();
    let Some(row) = rows
        .iter()
        .find(|row| Some(&row.target) == app.workspace.selected.as_ref())
    else {
        return false;
    };
    let ids = metrics::identities(row, &rows);
    let buckets = super::summary::capture_buckets(app, &ids);
    let values = buckets
        .iter()
        .map(|point| if saved { point.saved } else { point.used })
        .collect::<Vec<_>>();
    let label = if saved { "saved" } else { "used" };
    let right = (total.width() as u16).min(width.saturating_sub(6));
    grid.text(
        ds::Rect {
            x: 0,
            y,
            width: 5.min(width),
            height: 1,
        },
        label,
        Role::Muted,
        None,
    );
    let available = width.saturating_sub(7 + right);
    if available >= values.len() as u16 && !values.is_empty() {
        let scale = values.iter().flatten().copied().max().unwrap_or(1);
        ds::Sparkline::render(
            &ds::SparklineProps {
                points: values,
                scale,
                unavailable: false,
            },
            ds::Rect {
                x: 6,
                y,
                width: available,
                height: 1,
            },
            grid,
        );
    }
    grid.text(
        ds::Rect {
            x: width - right,
            y,
            width: right,
            height: 1,
        },
        total,
        Role::Text,
        None,
    );
    true
}

/// Turn an admitted model row into the matching component without inventing attribution.
fn model_gauge(app: &App, line: &str) -> Option<tmt_tui::components::design_system::GaugeProps> {
    use tmt_tui::components::design_system as ds;
    let (name, _) = line.split_once(" · ")?;
    let rows = app.workspace_rows();
    let row = rows
        .iter()
        .find(|row| Some(&row.target) == app.workspace.selected.as_ref())?;
    let ids = metrics::identities(row, &rows);
    let report = metrics::report(app)?;
    let mut amount = 0u64;
    let mut found = false;
    for id in &ids {
        if let Some(models) = report.seat(id).and_then(|seat| seat.model_totals.as_ref()) {
            for (model, value) in models {
                if model == name {
                    amount = amount.checked_add(*value)?;
                    found = true;
                }
            }
        }
    }
    let (total, partial) = metrics::tokens(Some(report), &ids)?;
    let total = u64::try_from(total).ok()?;
    found.then(|| ds::GaugeProps {
        label: name.into(),
        label_width: 18,
        numerator: amount,
        denominator: total,
        total: Some(format!(
            "{}{}",
            crate::source::tokens(u128::from(amount)),
            if partial { " partial" } else { "" }
        )),
        filled_role: ds::Token(Role::Text),
        rest_role: ds::Token(Role::Muted),
    })
}

const BASIS: &str = "Estimate basis…";

pub(super) fn detail_lines(
    app: &App,
    width: u16,
    height: u16,
    now_ms: u64,
    row: Option<&serde_json::Value>,
) -> Vec<Line<'static>> {
    let mut lines = super::details::panel(app, now_ms, row);
    // Keep the evidence in the basis view; short panels prioritise the interactive sections.
    if height < 20 {
        lines.retain(|line| !line.starts_with("Status observed:"));
    }
    let lines = if height <= 10 && width >= 60 && app.digest_inline.is_none() {
        compact_detail_lines(lines, usize::from(width))
    } else {
        lines
    };
    lines
        .into_iter()
        .flat_map(|text| {
            crate::board::notes::wrap(&crate::board::notes::sanitize(&text), usize::from(width))
        })
        .map(|text| Line::styled(text, app.look().role(Role::Text)))
        .collect()
}
/// Put each section's first value in view, keeping the remaining full values scrollable.
fn compact_detail_lines(lines: Vec<String>, width: usize) -> Vec<String> {
    use unicode_width::UnicodeWidthStr;
    let mut groups: Vec<(String, Vec<String>)> = Vec::new();
    for line in lines {
        if line.starts_with("── ") && line.ends_with(" ──") {
            groups.push((line.trim_matches('─').trim().to_owned(), Vec::new()));
        } else if let Some((_, items)) = groups.last_mut() {
            items.push(line);
        } else {
            groups.push((String::new(), vec![line]));
        }
    }
    let mut front = Vec::new();
    let mut remainder = Vec::new();
    for (heading, mut items) in groups {
        let priority = heading == "Delivery"
            || heading.starts_with("Delivery |")
            || heading.starts_with("Saved ·")
            || heading.starts_with("Models ·");
        if priority {
            let first = if heading.starts_with("Saved ·")
                && items.len() >= 2
                && items[0].starts_with("used trend ")
                && items[1].starts_with("saved trend ")
            {
                Some(format!(
                    "used {} · saved {}",
                    items[0].trim_start_matches("used trend "),
                    items[1].trim_start_matches("saved trend ")
                ))
            } else if items.is_empty() {
                None
            } else {
                Some(items.remove(0))
            };
            match first {
                Some(value) if heading.width() + 3 + value.width() <= width => {
                    front.push(format!("{} · {value}", heading.replace(" | ", " · ")))
                }
                Some(value) => {
                    front.push(heading.replace(" | ", " · "));
                    front.push(value);
                }
                None => front.push(heading.replace(" | ", " · ")),
            }
        }
        if !items.is_empty() {
            if !heading.is_empty() {
                items[0] = format!("{} · {}", heading.replace(" | ", " · "), items[0]);
            }
            remainder.extend(items);
        } else if !priority && !heading.is_empty() {
            remainder.push(heading.replace(" | ", " · "));
        }
    }
    front.extend(remainder);
    front
}

/// Clock evidence uses the same visible wrapped projection as paint.
pub(in crate::board) fn details_clock_mark(
    app: &App,
    target: &crate::board::app::RowTarget,
    width: u16,
    height: u16,
    now_ms: u64,
) -> String {
    let lines = detail_lines(app, width, height, now_ms, app.target_row(target));
    let viewport =
        crate::board::scroll::Scrolls::viewport(Rect::new(0, 0, width, height), lines.len());
    let offset = app
        .scrolls
        .offset(Pane::Replies)
        .min(lines.len().saturating_sub(viewport));
    lines
        .into_iter()
        .skip(offset)
        .take(viewport)
        .map(|line| line.to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

/// The status-row and Impact `Estimate basis…` buttons open the Evidence modal over the board.
pub(in crate::board) fn open_basis(app: &mut App) -> crate::board::app::Effect {
    app.open_estimate_basis()
}
