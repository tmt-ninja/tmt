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
/// Two rows of used and saved values.
///
/// `▁▄█·`
///
/// The series is sampled across the width and clipped to two rows.
pub struct StackedBars;
impl Component for StackedBars {
    type Props = StackedBarsProps;
    fn measure(p: &Self::Props, c: Constraints) -> Size {
        c.clamp(Size {
            width: p.points.len().min(usize::from(u16::MAX)) as u16,
            height: 2,
        })
    }
    fn render(p: &Self::Props, a: Rect, b: &mut CellGrid) -> Vec<(Rect, HitId)> {
        b.clear(a);
        if a.width == 0 || a.height == 0 {
            return vec![];
        }
        if p.points.is_empty() {
            b.text(
                a,
                "No aligned used/saved observations yet",
                p.missing_role.0,
                None,
            );
            return vec![];
        }
        let maximum = p
            .points
            .iter()
            .filter_map(|v| v.used?.checked_add(v.saved.unwrap_or(0)))
            .max()
            .unwrap_or(1)
            .max(1);
        let blocks = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
        for y in 0..a.height.min(2) {
            for x in 0..a.width {
                let point = p.points[usize::from(x) * p.points.len() / usize::from(a.width)];
                let rect = Rect {
                    x: a.x.saturating_add(x),
                    y: a.y.saturating_add(y),
                    width: 1,
                    height: 1,
                };
                let (Some(used), Some(saved)) = (point.used, point.saved) else {
                    b.text(rect, "·", p.missing_role.0, None);
                    continue;
                };
                let base = u128::from(1 - y) * 8;
                let height = ((u128::from(used.saturating_add(saved)) * 16)
                    .div_ceil(u128::from(maximum)))
                .saturating_sub(base)
                .min(8) as usize;
                let saved_height = (u128::from(saved) * 16 / u128::from(maximum))
                    .saturating_sub(base)
                    .min(8) as usize;
                let (glyph, fg, bg) = if saved_height > 0 && saved_height < height {
                    (blocks[saved_height], p.saved_role.0, Some(p.used_role.0))
                } else {
                    (
                        blocks[height],
                        if saved_height > 0 {
                            p.saved_role.0
                        } else {
                            p.used_role.0
                        },
                        None,
                    )
                };
                b.text(rect, glyph, fg, bg);
            }
        }
        vec![]
    }
}
