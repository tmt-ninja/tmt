use super::{CellGrid, Component, Constraints, HitId, Rect, Size};
use serde::{Deserialize, Serialize};
use tmt_cli_style::theme::Role;
use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SectionRuleProps {
    pub title: String,
    pub note: Option<String>,
}
/// A title with an optional right-aligned note.
///
/// `── Saved · 1d ───── 0.9% ──`
///
/// The note drops first; the title is then ellipsized.
pub struct SectionRule;
pub(super) fn fit(text: &str, width: usize) -> String {
    if UnicodeWidthStr::width(text) <= width {
        return text.into();
    }
    if width == 0 {
        return String::new();
    }
    let mut out = String::new();
    let mut used = 0;
    for ch in text.graphemes(true) {
        let w = UnicodeWidthStr::width(ch);
        if used + w >= width {
            break;
        }
        out.push_str(ch);
        used += w;
    }
    out.push('…');
    out
}
impl Component for SectionRule {
    type Props = SectionRuleProps;
    fn measure(props: &Self::Props, constraints: Constraints) -> Size {
        let width = 4
            + UnicodeWidthStr::width(props.title.as_str())
            + props
                .note
                .as_ref()
                .map_or(0, |s| UnicodeWidthStr::width(s.as_str()) + 5);
        constraints.clamp(Size {
            width: width.min(usize::from(u16::MAX)) as u16,
            height: 1,
        })
    }
    fn render(props: &Self::Props, area: Rect, buffer: &mut CellGrid) -> Vec<(Rect, HitId)> {
        buffer.clear(area);
        if area.width == 0 || area.height == 0 {
            return vec![];
        }
        let width = usize::from(area.width);
        let title = format!("── {} ", props.title);
        let title_width = UnicodeWidthStr::width(title.as_str());
        let note = props.note.as_ref().map(|s| format!(" {s} ──"));
        let note = note.filter(|n| title_width + UnicodeWidthStr::width(n.as_str()) < width);
        let text = if title_width >= width {
            fit(&title, width)
        } else {
            let suffix = note.unwrap_or_default();
            let fill = width - title_width - UnicodeWidthStr::width(suffix.as_str());
            format!("{title}{}{suffix}", "─".repeat(fill))
        };
        buffer.text(area, &text, Role::Muted, None);
        vec![]
    }
}
