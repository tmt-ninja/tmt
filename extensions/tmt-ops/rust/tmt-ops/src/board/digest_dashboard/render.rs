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
    use ds::Component;
    use tmt_tui::components::design_system as ds;
    if area.is_empty() {
        return area;
    }
    super::paint_grid(frame, app, Rect { height: 1, ..area }, |grid| {
        ds::PaneRule::render(
            &ds::PaneRuleProps {
                title: title.into(),
                note: None,
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

/// One title row, with the rest of the pane available to its existing content owner.
pub(super) fn content_area(area: Rect) -> Rect {
    Rect::new(
        area.x,
        area.y.saturating_add(u16::from(area.height > 0)),
        area.width,
        area.height.saturating_sub(1),
    )
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
        if wide {
            let matrix_height = 9.min(side.height / 3);
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
    let inside = if chrome {
        pane_frame(frame, app, area, Pane::Replies, "Exchanges · talk + reply")
    } else {
        if !area.is_empty() {
            use ds::Component;
            use tmt_tui::components::design_system as ds;
            super::paint_grid(frame, app, Rect { height: 1, ..area }, |grid| {
                ds::SectionRule::render(
                    &ds::SectionRuleProps {
                        title: "Exchanges · talk + reply".into(),
                        note: None,
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
    let mut inside = pane_frame(frame, app, area, Pane::Replies, &super::details::title(app));
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

const BASIS: &str = "Estimate basis…";

pub(super) fn detail_lines(
    app: &App,
    width: u16,
    height: u16,
    now_ms: u64,
    row: Option<&serde_json::Value>,
) -> Vec<Line<'static>> {
    let lines = super::details::panel(app, now_ms, row);
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
/// Keep full words and values while putting short section summaries in fewer rows.
fn compact_detail_lines(lines: Vec<String>, width: usize) -> Vec<String> {
    use unicode_width::UnicodeWidthStr;
    let mut out: Vec<String> = Vec::new();
    for line in lines {
        let heading = line.starts_with("── ") && line.ends_with(" ──");
        let text = if heading {
            line.trim_matches('─').trim().to_owned()
        } else {
            line
        };
        if !heading {
            if let Some(previous) = out.last_mut() {
                if previous.width() + 3 + text.width() <= width {
                    previous.push_str(" · ");
                    previous.push_str(&text);
                    continue;
                }
            }
        }
        out.push(text);
    }
    out
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
