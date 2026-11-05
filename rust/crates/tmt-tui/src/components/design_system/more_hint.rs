use super::{CellGrid, Component, Constraints, HitId, Rect, Size};
use serde::{Deserialize, Serialize};
use tmt_cli_style::theme::Role;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MoreHintProps {
    pub count: u64,
}
/// A count of additional hidden items.
///
/// `2 more`
///
/// The hint is ellipsized at the available width.
pub struct MoreHint;
impl Component for MoreHint {
    type Props = MoreHintProps;
    fn measure(p: &Self::Props, c: Constraints) -> Size {
        c.clamp(Size {
            width: format!("{} more", p.count).len() as u16,
            height: 1,
        })
    }
    fn render(p: &Self::Props, a: Rect, b: &mut CellGrid) -> Vec<(Rect, HitId)> {
        b.clear(a);
        b.text(
            a,
            &super::section_rule::fit(&format!("{} more", p.count), usize::from(a.width)),
            Role::Muted,
            None,
        );
        vec![]
    }
}
