use super::{CellGrid, Component, Constraints, HitId, Rect, Size};
use serde::{Deserialize, Serialize};
use tmt_cli_style::theme::Role;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MoreHintProps {
    pub count: u64,
    pub ascii: bool,
}

/// The scroll owner's count of additional hidden items.
///
/// `2 more ↓`
///
/// The hint is ellipsized at the available width; ASCII uses `v`.
pub struct MoreHint;

impl Component for MoreHint {
    type Props = MoreHintProps;

    fn measure(props: &Self::Props, constraints: Constraints) -> Size {
        constraints.clamp(Size {
            width: format!("{} more ↓", props.count).chars().count() as u16,
            height: 1,
        })
    }

    fn render(props: &Self::Props, area: Rect, grid: &mut CellGrid) -> Vec<(Rect, HitId)> {
        if area.height == 0 {
            return vec![];
        }
        let text = format!(
            "{} more {}",
            props.count,
            if props.ascii { "v" } else { "↓" }
        );
        let text = super::section_rule::fit(&text, usize::from(area.width));
        let padding = usize::from(area.width)
            .saturating_sub(unicode_width::UnicodeWidthStr::width(text.as_str()));
        grid.text(
            area,
            &format!("{text}{}", " ".repeat(padding)),
            Role::Dim,
            None,
        );
        vec![]
    }
}
