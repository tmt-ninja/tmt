use super::{CellGrid, Component, Constraints, HitId, Rect, Size, Token};
use serde::{Deserialize, Serialize};
use tmt_cli_style::theme::Role;
use unicode_width::UnicodeWidthStr;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TotalsColumn {
    pub header: String,
    pub width: u16,
    pub role: Token,
    pub right_aligned: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TotalsRow {
    pub values: Vec<String>,
    pub selected: bool,
    pub id: Option<HitId>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TotalsTableProps {
    pub columns: Vec<TotalsColumn>,
    pub rows: Vec<TotalsRow>,
}

/// Whole aligned columns of caller-formatted totals or matrix values.
/// `TOK     saved` / `840M     7.8M`
/// Columns that do not fit, including a value wider than its column, are omitted.
pub struct TotalsTable;

impl Component for TotalsTable {
    type Props = TotalsTableProps;

    fn measure(props: &Self::Props, constraints: Constraints) -> Size {
        let width = props
            .columns
            .iter()
            .map(|c| usize::from(c.width))
            .sum::<usize>()
            + props.columns.len().saturating_sub(1);
        constraints.clamp(Size {
            width: width.min(u16::MAX as usize) as u16,
            height: (props.rows.len() + 1).min(u16::MAX as usize) as u16,
        })
    }

    fn render(props: &Self::Props, area: Rect, grid: &mut CellGrid) -> Vec<(Rect, HitId)> {
        grid.clear(area);
        let mut x = area.x;
        let end = area.x.saturating_add(area.width);
        for (index, column) in props.columns.iter().enumerate() {
            let header = super::text::single_line(&column.header);
            let fits_values = UnicodeWidthStr::width(header.as_str()) <= usize::from(column.width)
                && props.rows.iter().all(|row| {
                    row.values.get(index).is_none_or(|v| {
                        UnicodeWidthStr::width(super::text::single_line(v).as_str())
                            <= usize::from(column.width)
                    })
                });
            if !fits_values || column.width > end.saturating_sub(x) {
                continue;
            }
            let header_offset = if column.right_aligned {
                column
                    .width
                    .saturating_sub(UnicodeWidthStr::width(header.as_str()) as u16)
            } else {
                0
            };
            grid.text(
                Rect {
                    x: x + header_offset,
                    y: area.y,
                    width: column.width - header_offset,
                    height: area.height.min(1),
                },
                &header,
                Role::Muted,
                None,
            );
            for (row_index, row) in props
                .rows
                .iter()
                .enumerate()
                .take(usize::from(area.height.saturating_sub(1)))
            {
                if let Some(value) = row.values.get(index) {
                    let value = super::text::single_line(value);
                    let offset = if column.right_aligned {
                        column
                            .width
                            .saturating_sub(UnicodeWidthStr::width(value.as_str()) as u16)
                    } else {
                        0
                    };
                    grid.text(
                        Rect {
                            x: x + offset,
                            y: area.y.saturating_add(row_index as u16 + 1),
                            width: column.width - offset,
                            height: 1,
                        },
                        &value,
                        column.role.0,
                        None,
                    );
                }
            }
            x = x.saturating_add(column.width).saturating_add(1);
        }
        let mut hits = Vec::new();
        for (index, row) in props
            .rows
            .iter()
            .enumerate()
            .take(usize::from(area.height.saturating_sub(1)))
        {
            let y = area.y.saturating_add(index as u16 + 1);
            if row.selected {
                for x in area.x..end.min(grid.size().width) {
                    if let Some(mut cell) = grid.get(x, y).cloned() {
                        cell.underlay = Some(Role::Selection);
                        grid.set(x, y, cell);
                    }
                }
            }
            if y < grid.size().height
                && let Some(id) = row.id
            {
                let width = end.min(grid.size().width).saturating_sub(area.x);
                if width > 0 {
                    hits.push((
                        Rect {
                            x: area.x,
                            y,
                            width,
                            height: 1,
                        },
                        id,
                    ));
                }
            }
        }
        hits
    }
}
