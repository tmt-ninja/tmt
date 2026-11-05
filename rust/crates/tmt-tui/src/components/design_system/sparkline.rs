use super::{CellGrid, Component, Constraints, HitId, Rect, Size};
use serde::{Deserialize, Serialize};
use tmt_cli_style::theme::Role;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SparklineProps {
    pub points: Vec<Option<u64>>,
    /// Shared maximum for the surrounding rows.
    pub scale: u64,
    /// Hide the whole series when its source is unavailable.
    pub unavailable: bool,
}

/// One neutral spark glyph per exact bucket, distributed across the track.
///
/// ` ▁▄█· `
///
/// A track narrower than the bucket count is not painted; callers choose a suitable range.
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
        if area.height == 0
            || props.points.is_empty()
            || usize::from(area.width) < props.points.len()
        {
            return vec![];
        }
        let blocks = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
        let width = usize::from(area.width);
        let count = props.points.len();
        for (index, point) in props.points.iter().enumerate() {
            let glyph = if props.unavailable {
                " "
            } else {
                match point {
                    None => "·",
                    Some(0) => " ",
                    Some(value) => {
                        blocks[(u128::from(*value) * 8)
                            .div_ceil(u128::from(props.scale.max(1)))
                            .clamp(1, 8) as usize]
                    }
                }
            };
            let start = width * index / count;
            let end = width * (index + 1) / count;
            grid.text(
                Rect {
                    x: area.x.saturating_add(start as u16),
                    y: area.y,
                    width: (end - start) as u16,
                    height: 1,
                },
                &glyph.repeat(end - start),
                Role::Muted,
                None,
            );
        }
        vec![]
    }
}
