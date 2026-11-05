//! Native adapter: resolve semantic roles only at the terminal boundary.
use super::design_system::CellGrid;
use ratatui::{buffer::Buffer, layout::Rect as NativeRect, style::Style};
use tmt_cli_style::theme::Role;

/// Copy a pure grid into an existing buffer with the caller's palette.
pub fn paint(grid: &CellGrid, area: NativeRect, buffer: &mut Buffer, role: impl Fn(Role) -> Style) {
    let size = grid.size();
    for y in 0..size.height.min(area.height) {
        for x in 0..size.width.min(area.width) {
            let Some(cell) = grid.get(x, y) else {
                continue;
            };
            let at = (area.x.saturating_add(x), area.y.saturating_add(y));
            if !buffer
                .area
                .contains(ratatui::layout::Position::new(at.0, at.1))
            {
                continue;
            }
            let mut style = role(cell.fg);
            if let Some(bg) = cell.bg {
                style = style.bg(role(bg).fg.unwrap_or_default());
            }
            let target = &mut buffer[at];
            target.reset();
            if !cell.continuation {
                target.set_symbol(&cell.glyph);
            }
            target.set_style(style);
        }
    }
}

#[cfg(test)]
mod tests;
