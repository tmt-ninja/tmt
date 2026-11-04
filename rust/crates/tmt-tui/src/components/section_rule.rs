//! One bounded section rule with a left title and optional right-aligned note.
use super::strip;
use ratatui::{buffer::Buffer, layout::Rect, style::Style, text::Line};
use unicode_width::UnicodeWidthStr;

pub struct SectionRule<'a> {
    pub title: &'a str,
    pub note: Option<&'a str>,
    pub style: Style,
}
impl SectionRule<'_> {
    pub fn paint(&self, buffer: &mut Buffer, area: Rect) {
        if area.is_empty() {
            return;
        }
        let left = format!("── {} ", self.title);
        let right = self
            .note
            .map(|n| format!(" {n} ──"))
            .unwrap_or_else(|| "──".into());
        let fill = usize::from(area.width).saturating_sub(left.width() + right.width());
        let text = if fill > 0 {
            format!("{left}{}{right}", "─".repeat(fill))
        } else {
            left
        };
        strip::paint_left(buffer, area, Line::styled(text, self.style));
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn aligns_note_and_clips_at_small_widths() {
        let mut b = Buffer::empty(Rect::new(0, 0, 30, 1));
        SectionRule {
            title: "Saved · 1d",
            note: Some("0.9%"),
            style: Style::default(),
        }
        .paint(&mut b, Rect::new(0, 0, 30, 1));
        let s: String = (0..30).map(|x| b[(x, 0)].symbol()).collect();
        assert!(s.starts_with("── Saved · 1d"));
        assert!(s.ends_with(" 0.9% ──"));
        SectionRule {
            title: "long title",
            note: Some("note"),
            style: Style::default(),
        }
        .paint(&mut b, Rect::new(0, 0, 3, 1));
    }
}
