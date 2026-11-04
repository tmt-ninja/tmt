//! Stateless selectable chips; the caller owns focus and activation.
use super::strip;
use ratatui::{buffer::Buffer, layout::Rect, style::Style};
use tmt_cli_style::grid::Align;

pub struct Chip<'a> {
    pub label: &'a str,
    pub selected: bool,
    pub focused: bool,
}
pub struct ChipRow {
    pub idle: Style,
    pub selected: Style,
    pub focused: Style,
}
impl ChipRow {
    pub fn paint(&self, buffer: &mut Buffer, area: Rect, chips: &[Chip<'_>]) -> Vec<Option<Rect>> {
        let pieces: Vec<_> = chips
            .iter()
            .map(|c| {
                (
                    c.label,
                    if c.focused {
                        self.focused
                    } else if c.selected {
                        self.selected
                    } else {
                        self.idle
                    },
                )
            })
            .collect();
        strip::paint_chips(buffer, area, &pieces, Align::Left)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::style::Color;
    #[test]
    fn focused_chip_has_style_and_clipped_chips_have_no_hit() {
        let area = Rect::new(0, 0, 6, 1);
        let mut b = Buffer::empty(area);
        let row = ChipRow {
            idle: Style::default(),
            selected: Style::default(),
            focused: Style::default().fg(Color::Red),
        };
        let hits = row.paint(
            &mut b,
            area,
            &[
                Chip {
                    label: "A",
                    selected: false,
                    focused: true,
                },
                Chip {
                    label: "Long",
                    selected: false,
                    focused: false,
                },
            ],
        );
        assert!(hits[0].is_some() && hits[1].is_none());
        assert_eq!(b[(1, 0)].fg, Color::Red);
    }
}
