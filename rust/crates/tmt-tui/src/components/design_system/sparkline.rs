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
    fn measure(p: &Self::Props, c: Constraints) -> Size {
        c.clamp(Size {
            width: p.points.len().min(usize::from(u16::MAX)) as u16,
            height: 1,
        })
    }
    fn render(p: &Self::Props, a: Rect, b: &mut CellGrid) -> Vec<(Rect, HitId)> {
        b.clear(a);
        if a.height == 0 || a.width == 0 || p.points.is_empty() {
            return vec![];
        }
        let max = p.points.iter().flatten().copied().max().unwrap_or(1).max(1);
        let blocks = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
        for x in 0..a.width {
            let point = p.points[usize::from(x) * p.points.len() / usize::from(a.width)];
            let glyph = match point {
                None => "·",
                Some(n) => blocks[((u128::from(n) * 8).div_ceil(u128::from(max))).min(8) as usize],
            };
            b.text(
                Rect {
                    x: a.x.saturating_add(x),
                    y: a.y,
                    width: 1,
                    height: 1,
                },
                glyph,
                p.role.0,
                None,
            );
        }
        vec![]
    }
}
