//! Divider: one neutral vertical separator, optionally joined to a top rule.
use crate::look::Look;
use ratatui::{buffer::Buffer, layout::Rect, text::Line};
use tmt_cli_style::Role;

pub(in crate::board) fn paint(buffer: &mut Buffer, area: Rect, join: bool, look: Look) {
    paint_with_glyphs(buffer, area, join, false, look);
}

pub(in crate::board) fn paint_with_glyphs(
    buffer: &mut Buffer,
    area: Rect,
    join: bool,
    ascii: bool,
    look: Look,
) {
    if area.width == 0 {
        return;
    }
    for y in area.y..area.bottom() {
        tmt_tui::components::strip::paint_left(
            buffer,
            Rect::new(area.x, y, 1, 1),
            Line::styled(
                match (ascii, join && y == area.y) {
                    (true, true) => "+",
                    (true, false) => "|",
                    (false, true) => "┬",
                    (false, false) => "│",
                },
                look.role(Role::Dim),
            ),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn joined_separator_is_one_cell_and_clips_to_the_buffer() {
        let mut buffer = Buffer::empty(Rect::new(0, 0, 4, 3));
        paint(&mut buffer, Rect::new(2, 1, 7, 7), true, Look::default());
        assert_eq!(buffer[(2, 1)].symbol(), "┬");
        assert_eq!(buffer[(2, 2)].symbol(), "│");
        assert_eq!(buffer[(1, 1)].symbol(), " ");
        assert_eq!(buffer[(3, 1)].symbol(), " ");
    }
}
