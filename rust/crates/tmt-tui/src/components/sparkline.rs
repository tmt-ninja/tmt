//! One glyph per observation; unknown is distinct from observed zero.
use super::strip;
use ratatui::{
    buffer::Buffer,
    layout::Rect,
    style::Style,
    text::{Line, Span},
};
pub struct Sparkline<'a> {
    pub values: &'a [Option<u64>],
    pub observed: Style,
    pub unknown: Style,
}
impl Sparkline<'_> {
    pub fn paint(&self, b: &mut Buffer, area: Rect) {
        let max = self
            .values
            .iter()
            .flatten()
            .copied()
            .max()
            .unwrap_or(0)
            .max(1);
        let spans = self
            .values
            .iter()
            .map(|v| match v {
                None => Span::styled("·", self.unknown),
                Some(0) => Span::styled(" ", self.observed),
                Some(n) => {
                    let i = (u128::from(*n) * 8).div_ceil(u128::from(max)).min(8) as usize;
                    Span::styled(
                        [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"][i],
                        self.observed,
                    )
                }
            })
            .collect::<Vec<_>>();
        strip::paint_left(b, area, Line::from(spans));
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_zero_and_positive_are_distinct() {
        let a = Rect::new(0, 0, 3, 1);
        let mut b = Buffer::empty(a);
        Sparkline {
            values: &[None, Some(0), Some(8)],
            observed: Style::default(),
            unknown: Style::default(),
        }
        .paint(&mut b, a);
        assert_eq!(
            (0..3).map(|x| b[(x, 0)].symbol()).collect::<String>(),
            "· █"
        );
    }
}
