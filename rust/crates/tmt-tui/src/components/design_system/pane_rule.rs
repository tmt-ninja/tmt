use super::{CellGrid, Component, Constraints, HitId, Rect, Size};
use serde::{Deserialize, Serialize};
use tmt_cli_style::theme::Role;
use unicode_width::UnicodeWidthStr;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PaneRuleProps {
    pub title: String,
    pub note: Option<String>,
    pub focused: bool,
}
/// A focus-aware pane title rule.
///
/// `▸━ Agents ━━━━━━━━━━━━━━━━━`
///
/// The note drops first; the title is then ellipsized.
pub struct PaneRule;
impl Component for PaneRule {
    type Props = PaneRuleProps;
    fn measure(p: &Self::Props, c: Constraints) -> Size {
        super::SectionRule::measure(
            &super::SectionRuleProps {
                title: p.title.clone(),
                note: p.note.clone(),
            },
            c,
        )
    }
    fn render(p: &Self::Props, a: Rect, b: &mut CellGrid) -> Vec<(Rect, HitId)> {
        b.clear(a);
        if a.width == 0 || a.height == 0 {
            return vec![];
        }
        let (prefix, line) = if p.focused {
            ("▸━ ", "━")
        } else {
            ("── ", "─")
        };
        let left = format!("{prefix}{} ", p.title);
        let lw = UnicodeWidthStr::width(left.as_str());
        let width = usize::from(a.width);
        let suffix = p
            .note
            .as_ref()
            .map(|n| format!(" {n} {line}{line}"))
            .filter(|n| lw + UnicodeWidthStr::width(n.as_str()) < width)
            .unwrap_or_default();
        let text = if lw > width {
            super::section_rule::fit(&left, width)
        } else {
            format!(
                "{left}{}{suffix}",
                line.repeat(width - lw - UnicodeWidthStr::width(suffix.as_str()))
            )
        };
        b.text(
            a,
            &text,
            if p.focused { Role::Accent } else { Role::Muted },
            None,
        );
        vec![]
    }
}
