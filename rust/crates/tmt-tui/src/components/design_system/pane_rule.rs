use super::{
    CellGrid, Component, Constraints, HitId, Rect, SectionRule, SectionRuleProps, Size, Token,
};
use serde::{Deserialize, Serialize};
use tmt_cli_style::theme::Role;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PaneRuleProps {
    pub title: String,
    pub note: Option<String>,
    pub note_role: Option<Token>,
    pub focused: bool,
    pub ascii: bool,
}

/// An unboxed pane control rule, with a bold focus marker.
///
/// `▸━ Agents ━━━━━━━━━ / Search ━━`
///
/// The note drops first; the title is then ellipsized.
pub struct PaneRule;

impl Component for PaneRule {
    type Props = PaneRuleProps;

    fn measure(props: &Self::Props, constraints: Constraints) -> Size {
        SectionRule::measure(
            &SectionRuleProps {
                title: props.title.clone(),
                note: props.note.clone(),
                note_role: props.note_role,
                focused: false,
            },
            constraints,
        )
    }

    fn render(props: &Self::Props, area: Rect, grid: &mut CellGrid) -> Vec<(Rect, HitId)> {
        SectionRule::render(
            &SectionRuleProps {
                title: props.title.clone(),
                note: props.note.clone(),
                note_role: props.note_role,
                focused: false,
            },
            area,
            grid,
        );
        if !props.focused || area.width == 0 || area.height == 0 {
            return vec![];
        }
        let Some(first) = grid.get(area.x, area.y) else {
            return vec![];
        };
        if first.glyph != "─" {
            return vec![];
        }
        let end = area.x.saturating_add(area.width).min(grid.size().width);
        for x in area.x..end {
            let Some(mut cell) = grid.get(x, area.y).cloned() else {
                continue;
            };
            if x == area.x {
                cell.glyph = if props.ascii { ">" } else { "▸" }.into();
                cell.underlay = cell.fg;
                cell.fg = Some(Role::Text);
                cell.bold = true;
            } else if cell.glyph == "─" {
                cell.glyph = "━".into();
                cell.underlay = cell.fg;
                cell.fg = Some(Role::Text);
            }
            grid.set(x, area.y, cell);
        }
        vec![]
    }
}
