use super::{CellGrid, Component, Constraints, HitId, Rect, Size, Token};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MarkProps {
    pub glyph: String,
    pub label: String,
    pub role: Token,
}
/// A semantic mark and its word.
///
/// `● working`
///
/// The text is ellipsized at the available width.
pub struct Mark;
impl Component for Mark {
    type Props = MarkProps;
    fn measure(p: &Self::Props, c: Constraints) -> Size {
        use unicode_width::UnicodeWidthStr;
        c.clamp(Size {
            width: (UnicodeWidthStr::width(p.glyph.as_str())
                + 1
                + UnicodeWidthStr::width(p.label.as_str()))
            .min(usize::from(u16::MAX)) as u16,
            height: 1,
        })
    }
    fn render(p: &Self::Props, a: Rect, b: &mut CellGrid) -> Vec<(Rect, HitId)> {
        b.clear(a);
        b.text(
            a,
            &super::section_rule::fit(&format!("{} {}", p.glyph, p.label), usize::from(a.width)),
            p.role.0,
            None,
        );
        vec![]
    }
}
