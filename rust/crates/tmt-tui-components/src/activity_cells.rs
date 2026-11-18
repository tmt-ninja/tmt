use super::{CellGrid, Component, Constraints, HitId, Rect, Size};
use serde::{Deserialize, Serialize};
use tmt_cli_style::theme::Role;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ActivityCellsProps {
    pub values: Vec<Option<u64>>,
    pub selected: bool,
}

/// Activity observations: a dim gap or zero and six foreground glyph levels.
/// Visible cells share the selection underlay when selected.
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
        // The selection surface needs the higher-contrast secondary foreground.
        let quiet = if props.selected {
            Role::Muted
        } else {
            Role::Dim
        };
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
            let (glyph, role) = match value {
                None => ("·", quiet),
                Some(0) => ("▁", quiet),
                Some(count) => {
                    let level = ((u128::from(*count) * 6)
                        .div_ceil(u128::from(maximum))
                        .clamp(1, 6)
                        - 1) as usize;
                    (["▁", "▂", "▃", "▄", "▆", "█"][level], Role::Text)
                }
            };
            grid.text(rect, glyph, role, None);
            if props.selected
                && let Some(mut cell) = grid.get(x, area.y).cloned()
            {
                cell.underlay = Some(Role::Selection);
                grid.set(x, area.y, cell);
            }
        }
        vec![]
    }
}
