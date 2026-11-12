//! Shared content-free exchange matrix. Hosts supply ranked UUID identities and
//! retain focus, navigation and effects; this component owns only projection/paint.
use super::usage_report::model::Traffic;
use crate::look::Look;
use ratatui::{
    buffer::Buffer,
    layout::Rect,
    text::{Line, Span},
};
use std::collections::{BTreeMap, BTreeSet};
use tmt_cli_style::{Role, theme::screen};
use tmt_tui::components::strip;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct ExchangeParticipant {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct CellHit {
    pub area: Rect,
    pub sender: String,
    pub recipient: String,
}

/// Zero and missing observations have no fill; six positive levels share the
/// same bounded style helper as hourly activity. Arithmetic never overflows.
pub(in crate::board) fn level(count: u64, maximum: u64) -> Option<u8> {
    (count > 0).then(|| {
        ((u128::from(count) * 6)
            .div_ceil(u128::from(maximum.max(count)))
            .clamp(1, 6)
            - 1) as u8
    })
}

pub(in crate::board) fn participants(
    ranked: &[ExchangeParticipant],
    selected: Option<&str>,
    maximum: usize,
) -> Vec<ExchangeParticipant> {
    let mut seen = BTreeSet::new();
    let mut result: Vec<_> = ranked
        .iter()
        .filter(|row| seen.insert(&row.id))
        .take(maximum)
        .cloned()
        .collect();
    if maximum > 0
        && let Some(selected) = selected.and_then(|id| ranked.iter().find(|row| row.id == id))
        && !result.iter().any(|row| row.id == selected.id)
    {
        result.pop();
        result.push(selected.clone());
    }
    result
}

/// Paint only complete cells and return their clipped, exact UUID geometry.
/// How many agents a host shows and whether each row ends with its total.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::board) struct Options {
    pub limit: usize,
    /// A trailing `sum` column: what the row's agent sent to everyone else.
    pub sum: bool,
}

/// What `sender` sent to anyone but itself, from the whole observed window.
fn sent(traffic: &Traffic, sender: &str) -> u64 {
    traffic
        .recipients_of(Some(sender))
        .iter()
        .filter(|flow| flow.recipient.as_deref() != Some(sender))
        .map(|flow| flow.count)
        .fold(0u64, u64::saturating_add)
}

/// Busiest first: messages sent plus received in the window, then name, then id.
/// Without traffic the order stays as given.
pub(in crate::board) fn by_traffic(
    mut participants: Vec<ExchangeParticipant>,
    traffic: Option<&Traffic>,
) -> Vec<ExchangeParticipant> {
    let Some(traffic) = traffic else {
        return participants;
    };
    // Score the held flow once, not once per sort comparison. Missing endpoints
    // still contribute to a known peer; self messages never count as exchanges.
    let mut totals: BTreeMap<&str, u64> = BTreeMap::new();
    for flow in traffic.flows() {
        if flow.sender == flow.recipient {
            continue;
        }
        for id in [flow.sender.as_deref(), flow.recipient.as_deref()]
            .into_iter()
            .flatten()
        {
            let total = totals.entry(id).or_default();
            *total = total.saturating_add(flow.count);
        }
    }
    let total = |id: &str| totals.get(id).copied().unwrap_or(0);
    participants.sort_by(|a, b| {
        total(&b.id)
            .cmp(&total(&a.id))
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.id.cmp(&b.id))
    });
    participants
}

/// `text` cut to `width` cells from its left, behind a `…`, so its tail stays.
fn fit_tail(text: &str, width: usize) -> String {
    use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};
    if text.width() <= width {
        return text.to_owned();
    }
    let mut tail = Vec::new();
    let mut used = 1;
    for c in text.chars().rev() {
        let cells = c.width().unwrap_or(0);
        if used + cells > width {
            break;
        }
        used += cells;
        tail.push(c);
    }
    let tail: String = tail.into_iter().rev().collect();
    if width == 0 {
        String::new()
    } else {
        format!("…{tail}")
    }
}

fn slot_layout(area: Rect, traffic: Option<&Traffic>, options: Options) -> (u16, u16, usize) {
    let minimum = traffic
        .map_or(0, |value| value.maximum)
        .to_string()
        .len()
        .max(5) as u16
        + 1;
    let name = 12u16.min(area.width / 3);
    let slots = usize::from(area.width.saturating_sub(name) / minimum)
        .saturating_sub(usize::from(options.sum))
        .min(options.limit)
        .min(usize::from(area.height.saturating_sub(1)));
    (name, minimum, slots)
}

fn value_cells(width: u16, name: u16, slots: usize, extra: u16, minimum: u16) -> u16 {
    if slots == 0 {
        minimum
    } else {
        (width.saturating_sub(name) / (slots as u16 + extra)).max(minimum)
    }
}

fn labels_need_numbers(rows: &[ExchangeParticipant], width: usize) -> bool {
    let abbreviated: Vec<_> = rows
        .iter()
        .map(|row| fit_tail(&super::notes::single_line(&row.name), width))
        .collect();
    abbreviated.iter().collect::<BTreeSet<_>>().len() != abbreviated.len()
}

fn numbered_label(numbered: bool, index: usize, name: &str) -> String {
    if numbered {
        format!("{} {name}", index + 1)
    } else {
        name.to_owned()
    }
}

/// Compact Digest projection: the board retains focus and hit handling.
pub(in crate::board) fn digest_props(
    area: Rect,
    ranked: &[ExchangeParticipant],
    selected: Option<&str>,
    traffic: Option<&Traffic>,
) -> Option<tmt_tui::components::design_system::TotalsTableProps> {
    use tmt_tui::components::design_system as ds;
    let (name_cap, minimum, slots) = slot_layout(
        area,
        traffic,
        Options {
            limit: 4,
            sum: true,
        },
    );
    let rows = participants(ranked, selected, slots);
    if rows.is_empty() {
        return None;
    }
    let value_limit = value_cells(area.width, name_cap, rows.len(), 1, minimum).saturating_sub(1);
    let numbered = labels_need_numbers(&rows, usize::from(value_limit));
    let label = |index: usize, name: &str| numbered_label(numbered, index, name);
    use unicode_width::UnicodeWidthStr;
    let name_width = rows
        .iter()
        .enumerate()
        .map(|(index, row)| label(index, &row.name).width())
        .max()
        .unwrap_or(0)
        .max("from\\to".width())
        .min(usize::from(name_cap)) as u16;
    let mut columns = vec![ds::TotalsColumn {
        header: crate::board::view::fit("from\\to", usize::from(name_width)),
        width: name_width,
        role: ds::Token(Role::Text),
        right_aligned: false,
    }];
    columns.extend(rows.iter().enumerate().map(|(index, row)| {
        let header = fit_tail(&label(index, &row.name), usize::from(value_limit));
        let count_width = traffic.map_or(0, |value| value.maximum).to_string().len();
        let width = header.width().max(count_width).max(1) as u16;
        ds::TotalsColumn {
            header,
            width,
            role: ds::Token(Role::Text),
            right_aligned: true,
        }
    }));
    let sum_width = rows
        .iter()
        .map(|row| traffic.map_or(1, |traffic| sent(traffic, &row.id).to_string().len()))
        .max()
        .unwrap_or(1)
        .max(3) as u16;
    columns.push(ds::TotalsColumn {
        header: "sum".into(),
        width: sum_width,
        role: ds::Token(Role::Text),
        right_aligned: true,
    });
    let values = rows
        .iter()
        .enumerate()
        .map(|(index, sender)| {
            let mut values = vec![crate::board::view::fit(
                &label(index, &sender.name),
                usize::from(name_width),
            )];
            values.extend(rows.iter().map(|recipient| {
                if sender.id == recipient.id {
                    String::new()
                } else {
                    traffic.map_or_else(
                        || "—".into(),
                        |traffic| match traffic.count(&sender.id, &recipient.id).unwrap_or(0) {
                            0 => "·".into(),
                            count => count.to_string(),
                        },
                    )
                }
            }));
            values.push(traffic.map_or_else(
                || "—".into(),
                |traffic| sent(traffic, &sender.id).to_string(),
            ));
            ds::TotalsRow {
                values,
                selected: false,
                id: None,
            }
        })
        .collect();
    Some(ds::TotalsTableProps {
        columns,
        rows: values,
    })
}

/// Missing traffic is `—`, observed zero is `·`, and self is a blank cell.
pub(in crate::board) fn paint_with(
    buffer: &mut Buffer,
    area: Rect,
    ranked: &[ExchangeParticipant],
    selected: Option<&str>,
    traffic: Option<&Traffic>,
    look: Look,
    options: Options,
) -> Vec<CellHit> {
    let maximum = traffic.map_or(0, |traffic| traffic.maximum);
    let (name_cells, minimum_cell, slots) = slot_layout(area, traffic, options);
    let value_cells = value_cells(
        area.width,
        name_cells,
        slots,
        u16::from(options.sum),
        minimum_cell,
    );
    let rows = participants(ranked, selected, slots);
    if rows.is_empty() || area.height == 0 {
        return Vec::new();
    }
    let fit = |text: &str, width: u16| {
        super::view::fit(&super::notes::single_line(text), usize::from(width))
    };
    // A column name sits over its right-aligned numbers, in the cell less its trailing gap, and
    // keeps its tail when cut: sibling names differ at the end.
    let value_width = usize::from(value_cells.saturating_sub(1));
    let column = |text: &str| {
        let text = super::notes::single_line(text);
        let cut = fit_tail(&text, value_width);
        format!("{cut:>value_width$} ")
    };
    let numbered = labels_need_numbers(&rows, value_width);
    let label = |index: usize, name: &str| numbered_label(numbered, index, name);
    let mut header = vec![Span::styled(
        fit("from\\to", name_cells),
        look.role(Role::Muted),
    )];
    for (index, row) in rows.iter().enumerate() {
        header.push(Span::styled(
            column(&label(index, &row.name)),
            look.role(Role::Muted),
        ));
    }
    if options.sum {
        header.push(Span::styled(column("sum"), look.role(Role::Muted)));
    }
    strip::paint_left(buffer, Rect { height: 1, ..area }, Line::from(header));
    let mut hits = Vec::new();
    for (row_index, sender) in rows.iter().enumerate() {
        let y = area.y + row_index as u16 + 1;
        strip::paint_left(
            buffer,
            Rect::new(area.x, y, name_cells, 1),
            Line::styled(
                fit(&label(row_index, &sender.name), name_cells),
                look.role(Role::Text),
            ),
        );
        for (column, recipient) in rows.iter().enumerate() {
            let cell = Rect::new(
                area.x + name_cells + column as u16 * value_cells,
                y,
                value_cells,
                1,
            )
            .intersection(area);
            let count =
                traffic.map(|traffic| traffic.count(&sender.id, &recipient.id).unwrap_or(0));
            let same = sender.id == recipient.id;
            let text = if same {
                String::new()
            } else {
                match count {
                    None => "—".into(),
                    Some(0) => "·".into(),
                    Some(n) => n.to_string(),
                }
            };
            let style = if same {
                look.role(Role::Dim)
            } else {
                count.and_then(|n| level(n, maximum)).map_or_else(
                    || look.role(Role::Text),
                    |level| screen::neutral_ramp(&look.theme, look.depth, level),
                )
            };
            strip::paint_left(
                buffer,
                cell,
                Line::styled(
                    format!(
                        "{:>width$} ",
                        text,
                        width = usize::from(cell.width.saturating_sub(1))
                    ),
                    style,
                ),
            );
            if !same && cell.width == value_cells {
                hits.push(CellHit {
                    area: cell,
                    sender: sender.id.clone(),
                    recipient: recipient.id.clone(),
                });
            }
        }
        if options.sum {
            let cell = Rect::new(
                area.x + name_cells + rows.len() as u16 * value_cells,
                y,
                value_cells,
                1,
            )
            .intersection(area);
            let text = traffic.map_or("—".to_owned(), |traffic| {
                sent(traffic, &sender.id).to_string()
            });
            strip::paint_left(
                buffer,
                cell,
                Line::styled(
                    format!(
                        "{:>width$} ",
                        text,
                        width = usize::from(cell.width.saturating_sub(1))
                    ),
                    look.role(Role::Text),
                ),
            );
        }
    }
    hits
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn top_five_keeps_selection_and_deduplicates_uuid_occurrences() {
        let mut rows: Vec<_> = (0..8)
            .map(|i| ExchangeParticipant {
                id: i.to_string(),
                name: format!("seat{i}"),
            })
            .collect();
        rows.insert(1, rows[0].clone());
        let result = participants(&rows, Some("7"), 5);
        assert_eq!(
            result.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            ["0", "1", "2", "3", "7"]
        );
        assert!(participants(&rows, Some("7"), 0).is_empty());
        for step in 1..=6 {
            assert_eq!(level(step, 6), Some(step as u8 - 1));
        }
        assert_eq!(level(0, 0), None);
        assert_eq!(level(u64::MAX, u64::MAX), Some(5));
    }

    fn seat(id: &str, name: &str) -> ExchangeParticipant {
        ExchangeParticipant {
            id: id.into(),
            name: name.into(),
        }
    }

    fn flow(pairs: &[(&str, &str, u64)]) -> Traffic {
        let pairs: Vec<_> = pairs
            .iter()
            .map(|(from, to, count)| (Some(*from), Some(*to), *count))
            .collect();
        flow_between(&pairs)
    }

    /// Like `flow`, with endpoints the report could not identify (`None`).
    fn flow_between(pairs: &[(Option<&str>, Option<&str>, u64)]) -> Traffic {
        use crate::board::usage_report::model::{Pair, Who};
        let who = |id: Option<&str>| Who {
            id: id.map(str::to_owned),
            name: None,
            retired: false,
        };
        Traffic::from_pairs(
            0,
            1,
            pairs.iter().map(|(from, to, count)| Pair {
                sender: who(*from),
                recipient: who(*to),
                kind: "talk".into(),
                count: *count,
            }),
        )
        .unwrap()
    }

    #[test]
    fn long_names_keep_their_tail_behind_an_ellipsis() {
        assert_eq!(fit_tail("agent-00001", 8), "…t-00001");
        assert_eq!(fit_tail("worker", 8), "worker");
        assert_eq!(fit_tail("agent-00001", 0), "");
    }

    #[test]
    fn busiest_first_by_sent_plus_received_then_name_then_id() {
        let traffic = flow(&[("b", "c", 5), ("c", "a", 2), ("a", "a", 99)]);
        let ranked = by_traffic(
            vec![
                seat("a", "zed"),
                seat("b", "bob"),
                seat("c", "cy"),
                seat("d", "amy"),
            ],
            Some(&traffic),
        );
        // c: 5 + 2, b: 5, a: 2 (its message to itself is not traffic), d: 0.
        assert_eq!(
            ranked.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            ["c", "b", "a", "d"]
        );
        let kept = by_traffic(vec![seat("b", "x"), seat("a", "y")], None);
        assert_eq!(kept[0].id, "b", "without traffic the given order stays");
    }

    #[test]
    fn traffic_scores_keep_saturation_unknown_endpoints_and_name_uuid_ties() {
        let traffic = flow_between(&[
            (Some("a"), Some("b"), u64::MAX),
            (Some("b"), Some("c"), 1),
            (Some("d"), Some("d"), u64::MAX),
            (None, Some("c"), u64::MAX),
        ]);
        let ranked = by_traffic(
            vec![
                seat("d", "aaa"),
                seat("b", "same"),
                seat("a", "same"),
                seat("c", "zzz"),
            ],
            Some(&traffic),
        );
        assert_eq!(
            ranked.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
            ["a", "b", "c", "d"]
        );
        let zero = by_traffic(
            vec![seat("b", "same"), seat("a", "same"), seat("c", "aaa")],
            Some(&flow(&[])),
        );
        assert_eq!(
            zero.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
            ["c", "a", "b"]
        );
    }

    #[test]
    fn sent_leaves_out_messages_to_oneself() {
        let traffic = flow(&[("a", "b", 3), ("a", "c", 4), ("a", "a", 50)]);
        assert_eq!(sent(&traffic, "a"), 7);
        assert_eq!(sent(&traffic, "b"), 0);
    }
}
