//! Two-row stacked used/saved bars. The caller supplies all styles and data.
use super::strip;
use ratatui::{
    buffer::Buffer,
    layout::Rect,
    style::Style,
    text::{Line, Span},
};
pub struct StackedBars<'a> {
    pub points: &'a [(Option<u64>, Option<u64>)],
    pub used: Style,
    pub saved: Style,
    pub unknown: Style,
    pub empty: Style,
    /// Use one cell per bucket, spaced across the plot rather than repeating it.
    pub single_cell: bool,
}
impl StackedBars<'_> {
    pub fn paint(&self, buffer: &mut Buffer, area: Rect) {
        if area.is_empty() {
            return;
        }
        if self.points.is_empty() {
            strip::paint_left(
                buffer,
                Rect { height: 1, ..area },
                Line::styled("No aligned used/saved observations yet", self.empty),
            );
            return;
        }
        let maximum = self
            .points
            .iter()
            .filter_map(|(u, s)| (*u)?.checked_add(s.unwrap_or(0)))
            .max()
            .unwrap_or(1)
            .max(1);
        for row in 0..area.height.min(2) {
            let base = u128::from(1 - row) * 8;
            let spans = (0..area.width)
                .map(|x| {
                    if self.single_cell && self.points.len() < usize::from(area.width) {
                        let index = ((usize::from(x) + 1) * self.points.len() - 1)
                            / usize::from(area.width);
                        let start = usize::from(area.width) * index / self.points.len();
                        let end = usize::from(area.width) * (index + 1) / self.points.len();
                        if usize::from(x) != start + (end - start) / 2 {
                            return Span::raw(" ");
                        }
                    }
                    let index = if self.single_cell && self.points.len() < usize::from(area.width) {
                        ((usize::from(x) + 1) * self.points.len() - 1) / usize::from(area.width)
                    } else {
                        usize::from(x) * self.points.len() / usize::from(area.width)
                    };
                    let (used, saved) = self.points[index];
                    let (Some(used), Some(saved)) = (used, saved) else {
                        return Span::styled("·", self.unknown);
                    };
                    let height = (u128::from(used.saturating_add(saved)) * 16)
                        .div_ceil(u128::from(maximum))
                        .saturating_sub(base)
                        .min(8) as usize;
                    let saved_height = ((u128::from(saved) * 16) / u128::from(maximum))
                        .saturating_sub(base)
                        .min(8) as usize;
                    let blocks = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
                    if saved_height > 0 && saved_height < height {
                        Span::styled(
                            blocks[saved_height],
                            self.saved.bg(self.used.fg.unwrap_or_default()),
                        )
                    } else {
                        Span::styled(
                            blocks[height],
                            if saved_height > 0 {
                                self.saved
                            } else {
                                self.used
                            },
                        )
                    }
                })
                .collect::<Vec<_>>();
            strip::paint_left(
                buffer,
                Rect::new(area.x, area.y + row, area.width, 1),
                Line::from(spans),
            );
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::style::Color;
    #[test]
    fn partial_boundary_and_unknown_are_distinct() {
        let a = Rect::new(0, 0, 2, 2);
        let mut b = Buffer::empty(a);
        StackedBars {
            points: &[(Some(14), Some(2)), (None, Some(0))],
            used: Style::default().fg(Color::White),
            saved: Style::default().fg(Color::Blue),
            unknown: Style::default(),
            empty: Style::default(),
            single_cell: false,
        }
        .paint(&mut b, a);
        assert_eq!(b[(0, 1)].symbol(), "▂");
        assert_eq!(b[(0, 1)].fg, Color::Blue);
        assert_eq!(b[(0, 1)].bg, Color::White);
        assert_eq!(b[(1, 1)].symbol(), "·");
    }

    #[test]
    fn single_cell_buckets_do_not_repeat_when_track_is_wider() {
        let area = Rect::new(0, 0, 5, 2);
        let mut buffer = Buffer::empty(area);
        StackedBars {
            points: &[(Some(1), Some(0)), (Some(2), Some(0))],
            used: Style::default(),
            saved: Style::default(),
            unknown: Style::default(),
            empty: Style::default(),
            single_cell: true,
        }
        .paint(&mut buffer, area);
        let visible = (0..5).filter(|&x| buffer[(x, 1)].symbol() != " ").count();
        assert_eq!(visible, 2);
    }
}
