use super::{CellGrid, Component, Constraints, HitId, Rect, Size};
use serde::{Deserialize, Serialize};
use tmt_cli_style::theme::Role;
use unicode_width::UnicodeWidthStr;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TotalColumn {
    pub heading: String,
    pub value: String,
    pub priority: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TotalsTableProps {
    pub columns: Vec<TotalColumn>,
}

/// Column-aligned labels and values, per Digest spec f21e67b7 §4.
///
/// `TOK  saved` / `10k     4k`
///
/// Lower-priority columns drop whole; values are never split.
pub struct TotalsTable;

impl Component for TotalsTable {
    type Props = TotalsTableProps;
    fn measure(props: &Self::Props, constraints: Constraints) -> Size {
        let width: usize = props
            .columns
            .iter()
            .map(|item| {
                UnicodeWidthStr::width(item.heading.as_str())
                    .max(UnicodeWidthStr::width(item.value.as_str()))
                    + 1
            })
            .sum();
        constraints.clamp(Size {
            width: width.saturating_sub(1).min(usize::from(u16::MAX)) as u16,
            height: 2,
        })
    }

    fn render(props: &Self::Props, area: Rect, grid: &mut CellGrid) -> Vec<(Rect, HitId)> {
        grid.clear(area);
        if area.height == 0 {
            return vec![];
        }
        let width = |i: usize| {
            UnicodeWidthStr::width(props.columns[i].heading.as_str())
                .max(UnicodeWidthStr::width(props.columns[i].value.as_str()))
        };
        let mut ids: Vec<usize> = (0..props.columns.len()).collect();
        while ids
            .iter()
            .map(|i| width(*i) + 1)
            .sum::<usize>()
            .saturating_sub(1)
            > usize::from(area.width)
            && !ids.is_empty()
        {
            let remove = ids
                .iter()
                .enumerate()
                .max_by_key(|(_, i)| (props.columns[**i].priority, **i))
                .unwrap()
                .0;
            ids.remove(remove);
        }
        let mut x = area.x;
        for i in ids {
            let col = &props.columns[i];
            let column_width = width(i) as u16;
            let heading = format!(
                "{}{}",
                " ".repeat(
                    usize::from(column_width)
                        .saturating_sub(UnicodeWidthStr::width(col.heading.as_str()))
                ),
                col.heading
            );
            let value = format!(
                "{}{}",
                " ".repeat(
                    usize::from(column_width)
                        .saturating_sub(UnicodeWidthStr::width(col.value.as_str()))
                ),
                col.value
            );
            grid.text(
                Rect {
                    x,
                    y: area.y,
                    width: column_width,
                    height: 1,
                },
                &heading,
                Role::Muted,
                None,
            );
            if area.height > 1 {
                grid.text(
                    Rect {
                        x,
                        y: area.y.saturating_add(1),
                        width: column_width,
                        height: 1,
                    },
                    &value,
                    Role::Text,
                    None,
                );
            }
            x = x.saturating_add(column_width).saturating_add(1);
        }
        vec![]
    }
}
