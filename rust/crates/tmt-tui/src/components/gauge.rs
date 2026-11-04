//! A bounded proportion bar with a dotted remainder.
use super::strip;
use ratatui::{
    buffer::Buffer,
    layout::Rect,
    style::Style,
    text::{Line, Span},
};
pub struct Gauge {
    pub numerator: u64,
    pub denominator: u64,
    pub filled: Style,
    pub rest: Style,
}
impl Gauge {
    pub fn paint(&self, b: &mut Buffer, area: Rect) {
        if area.is_empty() {
            return;
        }
        let n = if self.denominator == 0 {
            0
        } else {
            (u128::from(self.numerator.min(self.denominator)) * u128::from(area.width)
                / u128::from(self.denominator)) as usize
        };
        strip::paint_left(
            b,
            area,
            Line::from(vec![
                Span::styled("█".repeat(n), self.filled),
                Span::styled("·".repeat(usize::from(area.width) - n), self.rest),
            ]),
        );
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_and_zero_denominator() {
        let a = Rect::new(0, 0, 4, 1);
        let mut b = Buffer::empty(a);
        Gauge {
            numerator: 1,
            denominator: 2,
            filled: Style::default(),
            rest: Style::default(),
        }
        .paint(&mut b, a);
        assert_eq!(
            (0..4).map(|x| b[(x, 0)].symbol()).collect::<String>(),
            "██··"
        );
        Gauge {
            numerator: 1,
            denominator: 0,
            filled: Style::default(),
            rest: Style::default(),
        }
        .paint(&mut b, a);
        assert_eq!(b[(0, 0)].symbol(), "·");
    }
}
