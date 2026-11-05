use super::{CellGrid, Component, Constraints, HitId, Rect, Size, Token};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SparklineProps {
    pub points: Vec<Option<u64>>,
    pub role: Token,
}

/// A compact series with dots for missing observations.
///
/// `▁▃█·`
///
/// The series is sampled across the available width.
pub struct Sparkline;

impl Component for Sparkline {
    type Props = SparklineProps;
    fn measure(props: &Self::Props, constraints: Constraints) -> Size {
        constraints.clamp(Size {
            width: props.points.len().min(usize::from(u16::MAX)) as u16,
            height: 1,
        })
    }

    fn render(props: &Self::Props, area: Rect, grid: &mut CellGrid) -> Vec<(Rect, HitId)> {
        grid.clear(area);
        if area.height == 0 || area.width == 0 || props.points.is_empty() {
            return vec![];
        }
        let max = props
            .points
            .iter()
            .flatten()
            .copied()
            .max()
            .unwrap_or(1)
            .max(1);
        let blocks = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
        for x in 0..area.width {
            let point = props.points[usize::from(x) * props.points.len() / usize::from(area.width)];
            let glyph = match point {
                None => "·",
                Some(n) => blocks[((u128::from(n) * 8).div_ceil(u128::from(max))).min(8) as usize],
            };
            grid.text(
                Rect {
                    x: area.x.saturating_add(x),
                    y: area.y,
                    width: 1,
                    height: 1,
                },
                glyph,
                props.role.0,
                None,
            );
        }
        vec![]
    }
}
