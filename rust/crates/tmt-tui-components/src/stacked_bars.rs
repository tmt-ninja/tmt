use super::{CellGrid, Component, Constraints, HitId, Rect, Size, Token};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct StackedPoint {
    pub used: Option<u64>,
    pub saved: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StackedBarsProps {
    pub points: Vec<StackedPoint>,
    pub used_role: Token,
    pub saved_role: Token,
    pub missing_role: Token,
}

/// Two rows of used values, with saved as the bottom portion of each bar.
///
/// `▁▄█·`
///
/// The series is sampled across the width and clipped to two rows.
pub struct StackedBars;

impl Component for StackedBars {
    type Props = StackedBarsProps;
    fn measure(props: &Self::Props, constraints: Constraints) -> Size {
        constraints.clamp(Size {
            width: props.points.len().min(usize::from(u16::MAX)) as u16,
            height: 2,
        })
    }

    fn render(props: &Self::Props, area: Rect, grid: &mut CellGrid) -> Vec<(Rect, HitId)> {
        grid.clear(area);
        if area.width == 0 || area.height == 0 {
            return vec![];
        }
        if props.points.is_empty() {
            grid.text(
                area,
                "No aligned used/saved observations yet",
                props.missing_role.0,
                None,
            );
            return vec![];
        }
        let maximum = props
            .points
            .iter()
            .filter_map(|item| match (item.used, item.saved) {
                (Some(used), Some(saved)) if saved <= used => Some(used),
                _ => None,
            })
            .max()
            .unwrap_or(1)
            .max(1);
        let blocks = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
        for y in 0..area.height.min(2) {
            for x in 0..area.width {
                let point =
                    props.points[usize::from(x) * props.points.len() / usize::from(area.width)];
                let rect = Rect {
                    x: area.x.saturating_add(x),
                    y: area.y.saturating_add(y),
                    width: 1,
                    height: 1,
                };
                let (Some(used), Some(saved)) = (point.used, point.saved) else {
                    grid.text(rect, "·", props.missing_role.0, None);
                    continue;
                };
                if saved > used {
                    grid.text(rect, "·", props.missing_role.0, None);
                    continue;
                }
                let base = u128::from(1 - y) * 8;
                let height = ((u128::from(used) * 16).div_ceil(u128::from(maximum)))
                    .saturating_sub(base)
                    .min(8) as usize;
                let saved_height = (u128::from(saved) * 16 / u128::from(maximum))
                    .saturating_sub(base)
                    .min(8) as usize;
                let (glyph, fg, bg) = if saved_height > 0 && saved_height < height {
                    (
                        blocks[saved_height],
                        props.saved_role.0,
                        Some(props.used_role.0),
                    )
                } else {
                    (
                        blocks[height],
                        if saved_height > 0 {
                            props.saved_role.0
                        } else {
                            props.used_role.0
                        },
                        None,
                    )
                };
                grid.text(rect, glyph, fg, bg);
            }
        }
        vec![]
    }
}
