use super::{CellGrid, Component, Constraints, HitId, Rect, Size};
use serde::{Deserialize, Serialize};
use tmt_cli_style::theme::Role;
use unicode_width::UnicodeWidthStr;

/// Whether additional content can be reached by scrolling or is truncated.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MoreDirection {
    #[default]
    Down,
    Up,
    Right,
    Truncated,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MoreHintProps {
    pub count: u64,
    #[serde(default)]
    pub direction: MoreDirection,
    pub ascii: bool,
}

/// Additional content: `2 more ↓`, `2 more ↑`, `2 more →`, or `+2 more`.
///
/// Scroll arrows follow the count; truncated content has no navigation arrow.
/// The hint is ellipsized at the available width; ASCII uses `v`, `^` and `>`.
pub struct MoreHint;

impl MoreHint {
    /// The same semantic label for use inside existing styled lines.
    pub fn label(count: u64, direction: MoreDirection, ascii: bool) -> String {
        let arrow = match (direction, ascii) {
            (MoreDirection::Down, false) => "↓",
            (MoreDirection::Down, true) => "v",
            (MoreDirection::Up, false) => "↑",
            (MoreDirection::Up, true) => "^",
            (MoreDirection::Right, false) => "→",
            (MoreDirection::Right, true) => ">",
            (MoreDirection::Truncated, _) => return format!("+{count} more"),
        };
        format!("{count} more {arrow}")
    }
}

impl Component for MoreHint {
    type Props = MoreHintProps;

    fn measure(props: &Self::Props, constraints: Constraints) -> Size {
        let text = Self::label(props.count, props.direction, props.ascii);
        constraints.clamp(Size {
            width: text.width().min(usize::from(u16::MAX)) as u16,
            height: 1,
        })
    }

    fn render(props: &Self::Props, area: Rect, grid: &mut CellGrid) -> Vec<(Rect, HitId)> {
        if area.height == 0 {
            return vec![];
        }
        let label = Self::label(props.count, props.direction, props.ascii);
        let text = super::section_rule::fit(&label, usize::from(area.width));
        let padding = usize::from(area.width).saturating_sub(text.width());
        grid.text(
            area,
            &format!("{text}{}", " ".repeat(padding)),
            Role::Dim,
            None,
        );
        vec![]
    }
}
