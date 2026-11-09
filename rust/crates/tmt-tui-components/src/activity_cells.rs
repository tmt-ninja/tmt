use super::{CellGrid, Component, Constraints, HeatLevel, HitId, Rect, Size};
use serde::{Deserialize, Serialize};
use tmt_cli_style::theme::Role;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ActivityCellsProps {
    pub values: Vec<Option<u64>>,
    pub selected: bool,
}

/// Hourly observations: `· ▁▄█` (missing, zero and six neutral levels).
/// Cells past the available width are omitted; selected missing/zero cells retain selection.
pub struct ActivityCells;

impl Component for ActivityCells {
    type Props = ActivityCellsProps;
    fn measure(props: &Self::Props, constraints: Constraints) -> Size {
        constraints.clamp(Size {
            width: props.values.len().min(u16::MAX as usize) as u16,
            height: 1,
        })
    }
    fn render(props: &Self::Props, area: Rect, grid: &mut CellGrid) -> Vec<(Rect, HitId)> {
        grid.clear(area);
        if area.height == 0 {
            return vec![];
        }
        let maximum = props.values.iter().flatten().copied().max().unwrap_or(0);
        for (index, value) in props
            .values
            .iter()
            .take(usize::from(area.width))
            .enumerate()
        {
            let x = area.x.saturating_add(index as u16);
            let rect = Rect {
                x,
                y: area.y,
                width: 1,
                height: area.height.min(1),
            };
            match value {
                None | Some(0) => {
                    grid.text(
                        rect,
                        if value.is_none() { "·" } else { " " },
                        if props.selected {
                            Role::Text
                        } else {
                            Role::Dim
                        },
                        None,
                    );
                    if props.selected
                        && let Some(mut cell) = grid.get(x, area.y).cloned()
                    {
                        cell.underlay = Some(Role::Selection);
                        grid.set(x, area.y, cell);
                    }
                }
                Some(count) => {
                    let level = ((u128::from(*count) * 6)
                        .div_ceil(u128::from(maximum.max(*count)))
                        .clamp(1, 6)
                        - 1) as u8;
                    grid.text(
                        rect,
                        ["▁", "▂", "▃", "▄", "▆", "█"][usize::from(level)],
                        Role::Text,
                        None,
                    );
                    if let Some(mut cell) = grid.get(x, area.y).cloned() {
                        cell.heat_level = HeatLevel::try_from(level).ok();
                        grid.set(x, area.y, cell);
                    }
                }
            }
        }
        vec![]
    }
}
