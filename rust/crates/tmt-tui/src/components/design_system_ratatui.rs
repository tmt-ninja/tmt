//! Native adapter: resolve semantic roles only at the terminal boundary.
use super::design_system::{CellGrid, ChipSurface};
use ratatui::{buffer::Buffer, layout::Rect as NativeRect};
use tmt_cli_style::{
    Depth, Theme,
    theme::{
        Role,
        screen::{self, ChipKind, ChipState},
    },
};

/// Copy a pure grid into an existing buffer with the caller's palette.
pub fn paint(grid: &CellGrid, area: NativeRect, buffer: &mut Buffer, theme: &Theme, depth: Depth) {
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
            let role = |role: Role| screen::style(theme, role, depth);
            let mut style = match cell.chip_surface {
                Some(surface) => screen::chip(
                    theme,
                    ChipKind::Secondary,
                    match surface {
                        ChipSurface::Idle => ChipState::Idle,
                        ChipSurface::Hot => ChipState::Hot,
                        ChipSurface::Disabled => ChipState::Disabled,
                    },
                    depth,
                ),
                None => {
                    let base = cell.underlay.map(role).unwrap_or_default();
                    base.patch(cell.fg.map(role).unwrap_or_default())
                }
            };
            if cell.bold {
                style = style.add_modifier(ratatui::style::Modifier::BOLD);
            }
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
