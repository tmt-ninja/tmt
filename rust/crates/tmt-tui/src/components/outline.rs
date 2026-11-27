//! A single-line frame with a styled title in its top edge. It keeps
//! what is already drawn inside it: unlike `Modal`, it does not clear or fill,
//! so it frames panes of a base layer rather than an overlay.
use ratatui::{
    buffer::Buffer,
    layout::{Alignment, Rect},
    style::Style,
    symbols::border,
    text::{Line, Span},
    widgets::{Block, Borders, Widget},
};
use tmt_cli_style::table::escape;

/// Border geometry for `Outline`; flat framing changes paint alone.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OutlineFrame {
    Square,
    Rounded,
    Thick,
    Flat,
}

pub(super) type Frame = OutlineFrame;

pub(super) fn frame_block(frame: OutlineFrame) -> Block<'static> {
    frame_block_with_ascii(frame, false)
}

fn frame_block_with_ascii(frame: OutlineFrame, ascii: bool) -> Block<'static> {
    let block = Block::new().borders(Borders::ALL);
    if ascii {
        return match frame {
            OutlineFrame::Thick => block.border_set(border::Set {
                top_left: "+",
                top_right: "+",
                bottom_left: "+",
                bottom_right: "+",
                vertical_left: "#",
                vertical_right: "#",
                horizontal_top: "=",
                horizontal_bottom: "=",
            }),
            OutlineFrame::Flat => block.border_set(border::Set {
                top_left: "-",
                top_right: "-",
                bottom_left: "-",
                bottom_right: "-",
                vertical_left: " ",
                vertical_right: " ",
                horizontal_top: "-",
                horizontal_bottom: "-",
            }),
            OutlineFrame::Square | OutlineFrame::Rounded => block.border_set(border::Set {
                top_left: "+",
                top_right: "+",
                bottom_left: "+",
                bottom_right: "+",
                vertical_left: "|",
                vertical_right: "|",
                horizontal_top: "-",
                horizontal_bottom: "-",
            }),
        };
    }
    match frame {
        OutlineFrame::Square => block,
        OutlineFrame::Rounded => block.border_set(border::ROUNDED),
        OutlineFrame::Thick => block.border_set(border::THICK),
        OutlineFrame::Flat => block.border_set(border::Set {
            top_left: "─",
            top_right: "─",
            bottom_left: "─",
            bottom_right: "─",
            vertical_left: " ",
            vertical_right: " ",
            ..border::PLAIN
        }),
    }
}

fn escaped_line<'a>(line: &Line<'_>) -> Line<'a> {
    Line::from(
        line.spans
            .iter()
            .map(|span| Span::styled(escape(&span.content), span.style))
            .collect::<Vec<_>>(),
    )
}

#[derive(Debug, Clone)]
pub struct Outline<'a> {
    /// Spans keep their own style over `title_style`; an empty title draws none.
    pub title: Line<'a>,
    pub border: Style,
    pub title_style: Style,
}

impl Outline<'_> {
    /// The area inside the border.
    pub fn inner(&self, area: Rect) -> Rect {
        Block::bordered().inner(area)
    }

    pub fn paint(&self, area: Rect, buffer: &mut Buffer) {
        self.paint_frame(area, buffer, OutlineFrame::Square, None, false);
    }

    /// Rounded corners (`╭─╮` / `╰─╯`), with the same inner and title areas.
    pub fn paint_rounded(&self, area: Rect, buffer: &mut Buffer) {
        self.paint_frame(area, buffer, OutlineFrame::Rounded, None, false);
    }

    /// Heavy corners (`┏━┓` / `┗━┛`), with the same inner and title areas.
    pub fn paint_thick(&self, area: Rect, buffer: &mut Buffer) {
        self.paint_frame(area, buffer, OutlineFrame::Thick, None, false);
    }

    /// Horizontal rules and blank side slots, with the same inner and title areas.
    pub fn paint_flat(&self, area: Rect, buffer: &mut Buffer) {
        self.paint_frame(area, buffer, OutlineFrame::Flat, None, false);
    }

    /// Paint a chosen frame with an optional right-aligned top-border note.
    pub fn paint_noted(
        &self,
        area: Rect,
        buffer: &mut Buffer,
        frame: OutlineFrame,
        note: Option<&Line<'_>>,
        ascii: bool,
    ) {
        self.paint_frame(area, buffer, frame, note, ascii);
    }

    fn paint_frame(
        &self,
        area: Rect,
        buffer: &mut Buffer,
        frame: OutlineFrame,
        note: Option<&Line<'_>>,
        ascii: bool,
    ) {
        let mut block = frame_block_with_ascii(frame, ascii)
            .border_style(self.border)
            .title_style(self.title_style);
        if !self.title.spans.is_empty() {
            // Titles carry user data (names): shown escaped, never interpreted.
            block = block.title(escaped_line(&self.title));
        }
        if let Some(note) = note
            && !note.spans.is_empty()
        {
            block = block.title_top(escaped_line(note).alignment(Alignment::Right));
        }
        block.render(area.intersection(buffer.area), buffer);
    }
}

#[cfg(test)]
mod tests;
