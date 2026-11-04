//! Two rows of caller-supplied column labels and values.
use super::strip;
use ratatui::{buffer::Buffer, layout::Rect, style::Style, text::Line};
use unicode_width::UnicodeWidthStr;
pub struct TotalsTable<'a> {
    pub columns: &'a [(&'a str, &'a str)],
    pub header: Style,
    pub value: Style,
    /// Distance in rows from the header to the values.
    pub value_row: u16,
}
impl TotalsTable<'_> {
    pub fn paint(&self, b: &mut Buffer, area: Rect) {
        if area.is_empty() {
            return;
        }
        let mut head = String::new();
        let mut values = String::new();
        for (index, (h, v)) in self.columns.iter().enumerate() {
            if index > 0 {
                head.push_str("  ");
                values.push_str("  ");
            }
            let width = h.width().max(v.width());
            head.push_str(&" ".repeat(width - h.width()));
            head.push_str(h);
            values.push_str(&" ".repeat(width - v.width()));
            values.push_str(v);
        }
        strip::paint_left(
            b,
            Rect { height: 1, ..area },
            Line::styled(head, self.header),
        );
        if self.value_row > 0 && self.value_row < area.height {
            strip::paint_left(
                b,
                Rect::new(area.x, area.y + self.value_row, area.width, 1),
                Line::styled(values, self.value),
            );
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn aligns_headers_and_values() {
        let a = Rect::new(0, 0, 14, 2);
        let mut b = Buffer::empty(a);
        TotalsTable {
            columns: &[("TOK", "42"), ("saved", "3")],
            header: Style::default(),
            value: Style::default(),
            value_row: 1,
        }
        .paint(&mut b, a);
        let row = |y| (0..14).map(|x| b[(x, y)].symbol()).collect::<String>();
        assert!(row(0).starts_with("TOK  saved"));
        assert!(row(1).starts_with(" 42      3"));
    }
}
