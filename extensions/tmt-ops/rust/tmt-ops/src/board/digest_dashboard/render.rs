use super::{metrics, table};
use crate::board::{app::App, exchange_matrix};
use crate::config::Pane;
use ratatui::{Frame, layout::Rect, text::Line};
use tmt_cli_style::Role;
use tmt_tui::components::strip;

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
        let folded = details && !wide;
        let side = if details {
            let title = super::details::title(app);
            let title = if folded {
                format!("{title} · Exchanges")
            } else {
                title
            };
            let inside = pane_frame_with_note(
                frame,
                app,
                side,
                Pane::Replies,
                &title,
                folded.then_some("messages"),
            );
            if wide && side.width > 2 && side.height > 2 {
                let ascii = matches!(
                    app.cron_glyphs,
                    crate::board::overview::cron_counts::GlyphSet::Ascii
                );
                let focused = app.focused() == Pane::Replies;
                crate::board::divider::paint_with_glyphs(
                    frame.buffer_mut(),
                    Rect::new(
                        side.x,
                        side.y + u16::from(focused),
                        1,
                        side.height - u16::from(focused),
                    ),
                    !focused,
                    ascii,
                    app.look(),
                );
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
                false,
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
                (if folded { 5 } else { 6 }).min(side.height.saturating_sub(3))
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
                folded,
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
fn matrix(frame: &mut Frame, app: &App, area: Rect, chrome: bool, folded: bool) {
    let title = format!("Exchanges · {}", app.digest_window().label());
    let inside = if chrome {
        pane_frame_with_note(frame, app, area, Pane::Replies, &title, Some("messages"))
    } else {
        if !area.is_empty() && !folded {
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
        let heading_height = u16::from(area.height > 0 && !folded);
        Rect::new(
            area.x.saturating_add(u16::from(area.width > 0)),
            area.y.saturating_add(heading_height),
            area.width.saturating_sub(2),
            area.height.saturating_sub(heading_height),
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
                    use super::details::PanelRow;
                    let area = ds::Rect {
                        x: 0,
                        y: y as u16,
                        width: viewport.width,
                        height: 1,
                    };
                    match line {
                        PanelRow::Rule { title, note } => {
                            ds::SectionRule::render(
                                &ds::SectionRuleProps {
                                    title: title.clone(),
                                    note: note.clone(),
                                    note_role: None,
                                    focused: false,
                                },
                                area,
                                grid,
                            );
                        }
                        PanelRow::ModeChips {
                            text,
                            selected,
                            cursor,
                        } => {
                            paint_mode_chips(
                                grid,
                                y as u16,
                                viewport.width,
                                text,
                                *selected,
                                *cursor,
                            );
                        }
                        PanelRow::Trend { saved, total } => {
                            paint_trend(app, grid, y as u16, viewport.width, *saved, total);
                        }
                        PanelRow::Model {
                            name,
                            amount,
                            total,
                            partial,
                        } => {
                            if let (Ok(numerator), Ok(denominator)) =
                                (u64::try_from(*amount), u64::try_from(*total))
                            {
                                ds::Gauge::render(
                                    &ds::GaugeProps {
                                        label: name.clone(),
                                        label_width: 18,
                                        numerator,
                                        denominator,
                                        total: Some(format!(
                                            "{}{}",
                                            crate::source::tokens(*amount),
                                            if *partial { " partial" } else { "" }
                                        )),
                                        filled_role: ds::Token(Role::Text),
                                        rest_role: ds::Token(Role::Muted),
                                    },
                                    area,
                                    grid,
                                );
                            } else {
                                grid.text(area, &line.to_string(), Role::Text, None);
                            }
                        }
                        PanelRow::Text(text) => {
                            ds::Text::render(
                                &ds::TextProps {
                                    spans: vec![ds::TextSpan {
                                        text: text.clone(),
                                        role: ds::Token(Role::Text),
                                        bold: false,
                                    }],
                                },
                                area,
                                grid,
                            );
                        }
                    }
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
    grid: &mut tmt_tui::components::design_system::CellGrid,
    y: u16,
    width: u16,
    line: &str,
    selected: Option<usize>,
    cursor: Option<usize>,
) {
    use ds::Component;
    use tmt_tui::components::design_system as ds;
    let compact = line.starts_with("Delivery ·");
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
            cursor,
            active: cursor.is_some(),
        },
        ds::Rect {
            x: 0,
            y,
            width,
            height: 1,
        },
        grid,
    );
}

fn paint_trend(
    app: &App,
    grid: &mut tmt_tui::components::design_system::CellGrid,
    y: u16,
    width: u16,
    saved: bool,
    total: &str,
) {
    use ds::Component;
    use tmt_tui::components::design_system as ds;
    use unicode_width::UnicodeWidthStr;
    let rows = app.workspace_rows();
    let Some(row) = rows
        .iter()
        .find(|row| Some(&row.target) == app.workspace.selected.as_ref())
    else {
        return;
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
}

const BASIS: &str = "Estimate basis…";

pub(super) fn detail_lines(
    app: &App,
    width: u16,
    height: u16,
    now_ms: u64,
    row: Option<&serde_json::Value>,
) -> Vec<super::details::PanelRow> {
    use super::details::PanelRow;
    let mut lines = super::details::panel(app, now_ms, row);
    if height < 20 {
        lines.retain(
            |line| !matches!(line, PanelRow::Text(text) if text.starts_with("Status observed:")),
        );
    }
    let lines = if height <= 10 && width >= 60 && app.digest_inline.is_none() {
        compact_detail_lines(lines, usize::from(width))
    } else {
        lines
    };
    lines
        .into_iter()
        .flat_map(|line| match line {
            PanelRow::Text(text) => {
                use unicode_width::UnicodeWidthStr;
                let wrapped = if text.starts_with("held ") && text.width() > usize::from(width) {
                    if let Some((first, last)) = text.split_once(" · last ") {
                        let mut lines =
                            crate::board::notes::wrap(&format!("{first} · …"), usize::from(width));
                        lines.extend(crate::board::notes::wrap(
                            &format!("last {last}"),
                            usize::from(width),
                        ));
                        lines
                    } else {
                        crate::board::notes::wrap(
                            &crate::board::notes::sanitize(&text),
                            usize::from(width),
                        )
                    }
                } else {
                    crate::board::notes::wrap(
                        &crate::board::notes::sanitize(&text),
                        usize::from(width),
                    )
                };
                wrapped.into_iter().map(PanelRow::Text).collect::<Vec<_>>()
            }
            other => vec![other],
        })
        .collect()
}

/// Put each section's first value in view, keeping the remainder scrollable.
fn compact_detail_lines(
    lines: Vec<super::details::PanelRow>,
    width: usize,
) -> Vec<super::details::PanelRow> {
    use super::details::PanelRow;
    use unicode_width::UnicodeWidthStr;
    let mut groups: Vec<(String, Option<String>, Vec<PanelRow>)> = Vec::new();
    for line in lines {
        match line {
            PanelRow::Rule { title, note } => groups.push((title, note, Vec::new())),
            other => {
                if let Some((_, _, items)) = groups.last_mut() {
                    items.push(other);
                } else {
                    groups.push((String::new(), None, vec![other]));
                }
            }
        }
    }
    let mut front = Vec::new();
    let mut remainder = Vec::new();
    for (title, note, mut items) in groups {
        if title == "Delivery"
            && let Some(note) = &note
        {
            let mode = note.split(" · ").next().unwrap_or("unavailable");
            if let Some(index) = items
                .iter()
                .position(|item| matches!(item, PanelRow::Text(text) if text.starts_with("held ")))
            {
                let PanelRow::Text(held) = items.remove(index) else {
                    unreachable!()
                };
                let (summary, last) = held
                    .split_once(" · last ")
                    .map_or((held.as_str(), None), |(summary, last)| {
                        (summary, Some(last))
                    });
                front.push(PanelRow::Text(format!("Delivery · {mode} · {summary}")));
                items.retain(|item| !matches!(item, PanelRow::ModeChips { text, .. } if text.starts_with("mode Auto Interval Off Use default")));
                if let Some(last) = last {
                    items.insert(0, PanelRow::Text(format!("last {last}")));
                }
                remainder.extend(items);
                continue;
            }
        }
        let heading = match &note {
            Some(note) => format!("{title} · {note}"),
            None => title.clone(),
        };
        let priority =
            title == "Delivery" || title.starts_with("Saved ·") || title.starts_with("Models ·");
        if priority {
            let first = if title.starts_with("Saved ·") && items.len() >= 2 {
                match (&items[0], &items[1]) {
                    (
                        PanelRow::Trend {
                            saved: false,
                            total: used,
                        },
                        PanelRow::Trend {
                            saved: true,
                            total: saved,
                        },
                    ) => Some(format!("used {used} · saved {saved}")),
                    _ => {
                        if items.is_empty() {
                            None
                        } else {
                            Some(items.remove(0).to_string())
                        }
                    }
                }
            } else if items.is_empty() {
                None
            } else {
                Some(items.remove(0).to_string())
            };
            match first {
                Some(value) if heading.width() + 3 + value.width() <= width => {
                    front.push(PanelRow::Text(format!("{heading} · {value}")))
                }
                Some(value) => {
                    front.push(PanelRow::Text(heading.clone()));
                    front.push(PanelRow::Text(value));
                }
                None => front.push(PanelRow::Text(heading.clone())),
            }
        }
        if !items.is_empty() {
            if !heading.is_empty() && !priority {
                items[0] = PanelRow::Text(format!("{heading} · {}", items[0]));
            }
            remainder.extend(items);
        } else if !priority && !heading.is_empty() {
            remainder.push(PanelRow::Text(heading));
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

#[cfg(test)]
mod typed_row_tests {
    use super::*;
    use crate::board::digest_dashboard::details::PanelRow;

    #[test]
    fn messages_that_resemble_markup_stay_text() {
        for text in [
            "── timer ──",
            "mode Auto Interval Off Use default",
            "used trend 100",
            "model · 50% · 100",
        ] {
            let rows = compact_detail_lines(vec![PanelRow::Text(text.into())], 80);
            assert!(matches!(&rows[0], PanelRow::Text(value) if value == text));
        }
    }
}
