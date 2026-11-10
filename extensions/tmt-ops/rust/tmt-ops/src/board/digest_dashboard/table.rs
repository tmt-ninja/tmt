//! Fixed Digest metric tracks with whole-window activity and explicit missing evidence.
use super::metrics;
use crate::board::{
    app::{App, Hit, HitTarget},
    view::fit,
    workspace::OpsTreeRow,
};
use crate::config::{Pane, SavingsUnit};
use crate::labels::digest::SavingsSummary;
use ratatui::{Frame, layout::Rect};
use std::rc::Rc;
use tmt_cli_style::Role;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Field {
    Agent,
    State,
    Activity,
    Tokens,
    Percent,
    /// The supplier's saved token estimate for the selected window.
    Saved,
    Held,
    Mode,
}

/// Columns a pane may leave out for width, in the order the hint names them.
const OPTIONAL: [(Field, &str); 3] = [
    (Field::Activity, "activity"),
    (Field::Percent, "saved percent"),
    (Field::Mode, "mode"),
];

pub(super) fn tracks(width: u16, unit: SavingsUnit) -> Vec<(Field, u16)> {
    use Field::*;
    let _ = unit; // The unit affects window totals, never the list's fixed columns.
    let mut fields = vec![(Agent, 14u16), (State, 12u16)];
    if width >= 76 {
        fields.push((Activity, if width >= 112 { 24 } else { 12 }));
    }
    fields.extend([(Tokens, 7), (Saved, 7), (Percent, 8), (Held, 6), (Mode, 8)]);

    // Agent names yield first. Metrics are either whole or omitted.
    fields[0].1 = fields[0]
        .1
        .saturating_sub(span(&fields).saturating_sub(width));
    let mut used = 0;
    fields.retain(|(_, w)| {
        let fits = *w > 0 && used + *w <= width;
        if fits {
            used += *w + 1;
        }
        fits
    });
    fields
}

/// Cells the tracks take with one-cell gaps.
fn span(fields: &[(Field, u16)]) -> u16 {
    fields
        .iter()
        .map(|(_, w)| w + 1)
        .sum::<u16>()
        .saturating_sub(1)
}

/// Names the columns `width` leaves out and the width that shows them all, or counts them when
/// the names do not fit `room`; `None` when none is missing. A unit choice is not a missing
/// column: the totals unit never changes the list.
pub(super) fn narrow_hint(width: u16, unit: SavingsUnit, room: usize) -> Option<String> {
    let shown = tracks(width, unit);
    let all = tracks(u16::MAX, unit);
    let missing: Vec<_> = OPTIONAL
        .iter()
        .filter(|(field, _)| {
            all.iter().any(|(other, _)| other == field)
                && !shown.iter().any(|(other, _)| other == field)
        })
        .map(|(_, name)| *name)
        .collect();
    let (last, rest) = missing.split_last()?;
    let names = if rest.is_empty() {
        (*last).to_owned()
    } else {
        format!("{} and {last}", rest.join(", "))
    };
    let named = format!("Widen to {} columns for {names}.", span(&all));
    if unicode_width::UnicodeWidthStr::width(named.as_str()) <= room || rest.is_empty() {
        Some(named)
    } else {
        Some(format!(
            "Widen to {} columns for {} more columns.",
            span(&all),
            missing.len()
        ))
    }
}
/// The width the table's tracks fit in this frame; `None` while the list is not painted.
#[cfg(test)]
pub(super) fn painted_width(app: &App) -> Option<u16> {
    app.digest_placement(app.conversation.borrow().area)
        .list
        .map(crate::board::pane_chrome::content_area)
        .filter(|inside| !inside.is_empty())
        .map(|inside| inside.width)
}
fn selection_underlay(grid: &mut tmt_tui::components::design_system::CellGrid, width: u16) {
    for x in 0..width {
        if let Some(mut cell) = grid.get(x, 0).cloned() {
            cell.underlay = Some(Role::Selection);
            grid.set(x, 0, cell);
        }
    }
}
pub(super) fn paint(frame: &mut Frame, app: &App, area: Rect) {
    let mut inside = super::render::pane_frame(frame, app, area, Pane::Rows, "Agents by TOK");
    if inside.is_empty() {
        return;
    }
    let unit = app.savings_unit();
    let fields = tracks(inside.width, unit);
    let columns = fields
        .iter()
        .map(|(field, width)| {
            let caption = match field {
                Field::Agent => "AGENT",
                Field::State => "STATE",
                Field::Activity => "ACTIVITY",
                Field::Tokens => "TOK",
                Field::Percent => "SAVED %",
                Field::Saved => "SAVED",
                Field::Held => "HELD",
                Field::Mode => "MODE",
            };
            tmt_tui::components::design_system::TotalsColumn {
                header: fit(caption, usize::from(*width)),
                width: *width,
                role: tmt_tui::components::design_system::Token(Role::Text),
                right_aligned: false,
            }
        })
        .collect();
    {
        use ds::Component;
        use tmt_tui::components::design_system as ds;
        super::paint_grid(
            frame,
            app,
            Rect::new(inside.x, inside.y, inside.width, 1),
            |grid| {
                ds::TotalsTable::render(
                    &ds::TotalsTableProps {
                        columns,
                        rows: vec![],
                    },
                    ds::Rect {
                        x: 0,
                        y: 0,
                        width: inside.width,
                        height: 1,
                    },
                    grid,
                );
            },
        );
    }
    inside.y += 1;
    inside.height -= 1;
    let rows = app.workspace_rows();
    // A percent is never marked as a bound, so a partial one names its coverage here.
    let coverage = Some(super::savings(app))
        .filter(|sum| sum.percent.value.is_some() && sum.percent.included < sum.total)
        .map(|sum| {
            format!(
                "SAVED % covers {} of {} agents",
                sum.percent.included, sum.total
            )
        });
    let notes = coverage.unwrap_or_default();
    // A narrow pane drops whole columns and names what is omitted.
    let room = usize::from(inside.width)
        .saturating_sub(unicode_width::UnicodeWidthStr::width(notes.as_str()))
        .saturating_sub(if notes.is_empty() { 0 } else { 3 });
    let footer = [
        Some(format!("· = no observation · blank = 0 · {notes}")),
        narrow_hint(inside.width, unit, room),
    ]
    .into_iter()
    .flatten()
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(" · ");
    if inside.height > 1 && !footer.is_empty() {
        use ds::Component;
        use tmt_tui::components::design_system as ds;
        super::paint_grid(
            frame,
            app,
            Rect::new(inside.x, inside.bottom() - 1, inside.width, 1),
            |grid| {
                ds::Text::render(
                    &ds::TextProps {
                        spans: vec![ds::TextSpan {
                            text: fit(&footer, usize::from(inside.width)),
                            role: ds::Token(Role::Muted),
                        }],
                    },
                    ds::Rect {
                        x: 0,
                        y: 0,
                        width: inside.width,
                        height: 1,
                    },
                    grid,
                );
            },
        );
        inside.height -= 1;
    }
    let report = metrics::report(app);
    {
        let mut starts = app.row_starts.borrow_mut();
        starts.clear();
        starts.extend(0..rows.len());
    }
    if app.follow
        && let Some(index) = rows
            .iter()
            .position(|row| Some(&row.target) == app.workspace.selected.as_ref())
    {
        app.scrolls
            .reveal_range(Pane::Rows, index..index + 1, inside, rows.len());
    }
    app.scrolls.show_paint(
        frame,
        Pane::Rows,
        inside,
        rows.len().max(1),
        app.look(),
        |frame, viewport, offset| {
            for (index, row) in rows
                .iter()
                .enumerate()
                .skip(offset)
                .take(usize::from(viewport.height))
            {
                let cell = Rect::new(
                    viewport.x,
                    viewport.y + (index - offset) as u16,
                    viewport.width,
                    1,
                );
                let selected = Some(&row.target) == app.workspace.selected.as_ref();
                use ds::Component;
                use tmt_tui::components::design_system as ds;
                let mut state = None;
                super::paint_grid(frame, app, cell, |grid| {
                    let row_ids = metrics::identities(row, &rows);
                    let reading = metrics::tokens(report, &row_ids);
                    // Tokens and percent read one supplied summary per row.
                    let row_saved = fields
                        .iter()
                        .any(|(field, _)| matches!(field, Field::Saved | Field::Percent))
                        .then(|| row_savings(app, row, &row_ids));
                    let mut x = cell.x;
                    for (field, width) in &fields {
                        let slot = Rect::new(x, cell.y, *width, 1).intersection(cell);
                        x += width + 1;
                        if slot.width != *width {
                            continue;
                        }
                        if matches!(field, Field::State)
                            && let Some(label) = app.activity_label(row)
                        {
                            state = Some((slot, label));
                            continue;
                        }
                        if matches!(
                            field,
                            Field::Activity | Field::Tokens | Field::Saved | Field::Percent
                        ) && report.is_some_and(|report| {
                            row_ids.iter().all(|id| {
                                report.seat(id).is_none()
                                    && report
                                        .unavailable
                                        .iter()
                                        .any(|missing| missing.who.id.as_deref() == Some(*id))
                            })
                        }) {
                            if matches!(field, Field::Activity)
                                || !fields.iter().any(|(f, _)| matches!(f, Field::Activity))
                                    && matches!(field, Field::Tokens)
                            {
                                let end = fields
                                    .iter()
                                    .scan(cell.x, |x, (f, w)| {
                                        let start = *x;
                                        *x += *w + 1;
                                        Some((f, start + w))
                                    })
                                    .filter(|(f, _)| {
                                        matches!(
                                            f,
                                            Field::Activity
                                                | Field::Tokens
                                                | Field::Saved
                                                | Field::Percent
                                        )
                                    })
                                    .map(|(_, end)| end)
                                    .max()
                                    .unwrap_or(slot.right());
                                ds::Text::render(
                                    &ds::TextProps {
                                        spans: vec![ds::TextSpan {
                                            text: "no usage source".into(),
                                            role: ds::Token(Role::Dim),
                                        }],
                                    },
                                    ds::Rect {
                                        x: slot.x - cell.x,
                                        y: 0,
                                        width: end.min(cell.right()).saturating_sub(slot.x),
                                        height: 1,
                                    },
                                    grid,
                                );
                            }
                            continue;
                        }
                        if matches!(field, Field::Activity) {
                            let values = metrics::activity(report, &row_ids);
                            let each = values.len().div_ceil(usize::from(slot.width).max(1)).max(1);
                            let values = values
                                .chunks(each)
                                .map(|values| {
                                    values
                                        .iter()
                                        .try_fold(0u64, |sum, n| sum.checked_add((*n)?))
                                })
                                .collect::<Vec<_>>();
                            ds::ActivityCells::render(
                                &ds::ActivityCellsProps { values, selected },
                                ds::Rect {
                                    x: slot.x - cell.x,
                                    y: 0,
                                    width: slot.width,
                                    height: 1,
                                },
                                grid,
                            );
                        } else {
                            let text = match (field, &row_saved) {
                                (Field::Saved, Some(summary)) => {
                                    saved(summary, SavingsUnit::Tokens)
                                }
                                (Field::Percent, Some(summary)) => {
                                    saved(summary, SavingsUnit::Percent)
                                }
                                _ => value(app, row, *field, reading, &row_ids),
                            };
                            // Numeric tracks never show a clipped amount.
                            let text =
                                if matches!(field, Field::Tokens | Field::Percent | Field::Saved)
                                    && unicode_width::UnicodeWidthStr::width(text.as_str())
                                        > usize::from(*width)
                                {
                                    "—".into()
                                } else {
                                    fit(
                                        &crate::board::notes::single_line(&text),
                                        usize::from(*width),
                                    )
                                };
                            ds::Text::render(
                                &ds::TextProps {
                                    spans: vec![ds::TextSpan {
                                        text,
                                        role: ds::Token(Role::Text),
                                    }],
                                },
                                ds::Rect {
                                    x: slot.x - cell.x,
                                    y: 0,
                                    width: slot.width,
                                    height: 1,
                                },
                                grid,
                            );
                        }
                    }
                    if selected {
                        selection_underlay(grid, cell.width);
                    }
                });
                if let Some((slot, label)) = state {
                    crate::board::workspace::columns::paint_activity(
                        frame.buffer_mut(),
                        app,
                        row,
                        &label,
                        slot,
                        selected,
                    );
                }
                app.hits.borrow_mut().push(Hit {
                    x: cell.x,
                    y: cell.y,
                    width: cell.width,
                    target: HitTarget::Row(index),
                });
            }
        },
    );
}
fn value(
    app: &App,
    row: &OpsTreeRow,
    field: Field,
    reading: Option<(u128, bool)>,
    ids: &[&str],
) -> String {
    match field {
        Field::Agent => row.title.clone(),
        Field::State => "—".into(),
        Field::Activity => unreachable!(),
        Field::Tokens => metrics::token_text(reading),
        Field::Percent => unreachable!("percent reads the supplied savings summary"),
        Field::Saved => unreachable!(),
        Field::Held if metrics::id(row).is_none() => {
            metrics::held(app, ids).map_or("—".into(), |count| format!("{count} held"))
        }
        Field::Mode => metrics::mode(app, metrics::id(row)),
        Field::Held => metrics::held(app, ids).map_or("—".into(), |count| count.to_string()),
    }
}

/// A member's own estimate is one status lookup; `all` reads the sum the summary tiles show.
fn row_savings(app: &App, row: &OpsTreeRow, ids: &[&str]) -> Rc<SavingsSummary> {
    if metrics::id(row).is_some() {
        Rc::new(metrics::savings(app, ids))
    } else {
        super::savings(app)
    }
}

/// One unit's amount: missing or uncombinable values read `—`, a known zero reads `0`, and a
/// sum that leaves members out reads as a lower bound, like TOK. A percent is a ratio, not a
/// sum, so it is never marked as a bound.
pub(super) fn saved(summary: &SavingsSummary, unit: SavingsUnit) -> String {
    let (amount, included) = match unit {
        SavingsUnit::Tokens => (
            summary
                .tokens
                .map(|tokens| crate::source::tokens(u128::from(tokens))),
            summary.included,
        ),
        SavingsUnit::Percent => {
            return summary
                .percent
                .value
                .map_or("—".into(), crate::board::savings::percent_text);
        }
        SavingsUnit::Cost => (
            summary.cost.value.map(crate::board::savings::usd_compact),
            summary.cost.included,
        ),
    };
    amount.map_or("—".into(), |amount| {
        let bound = if included < summary.total { "≥" } else { "" };
        format!("{bound}{amount}")
    })
}
