//! Jump to latest (#5920): while the reader is scrolled away from the bottom, a boxed button
//! sits over the bottom-right of the body, `↓ Jump to latest · N new` with `End` on its lower
//! edge. It covers content without moving a line; a click does what End does. N counts the
//! messages painted since the reader left the bottom. A body too small for the box gets one
//! line, `↓ Latest · End`.
use super::Session;
use crate::look::Look;
use ratatui::{
    Frame,
    layout::Rect,
    text::{Line, Span},
};
use tmt_cli_style::Role;
use unicode_width::UnicodeWidthStr;

/// Messages painted now that were not painted when the reader left the bottom.
pub(super) fn new_messages(session: &Session) -> usize {
    let (Some(seen), Some(rendered)) = (&session.seen, &session.rendered) else {
        return 0;
    };
    rendered
        .timeline_entries
        .iter()
        .filter(|entry| !seen.contains(*entry))
        .count()
}

/// Paints the button over the finished frame, after the copy surfaces were read, so a
/// selection copies the text beneath it.
pub(in crate::board) fn paint_over(frame: &mut Frame, app: &crate::board::app::App) {
    let mut state = app.conversation.borrow_mut();
    let state = &mut *state;
    state.jump_hit = None;
    // Never over a menu or dialog, nor for a reader this frame did not paint.
    if app.modal_open() || app.menu.is_some() || !app.scrolls.visible(super::Pane::Replies) {
        return;
    }
    state.jump_hit = state
        .response_area
        .zip(
            state
                .active
                .as_ref()
                .and_then(|key| state.sessions.get(key)),
        )
        .filter(|(body, session)| {
            // Only a reader whose last line is below the viewport.
            session.rendered.as_ref().is_some_and(|rendered| {
                let content = rendered.mapped.lines.len();
                app.scrolls
                    .offset(super::Pane::Replies)
                    .saturating_add(crate::board::scroll::Scrolls::viewport(*body, content))
                    < content
            })
        })
        .and_then(|(body, session)| paint(frame, new_messages(session), body, app.look()));
}

/// Paints the button for a reader scrolled away from the bottom; returns where a click lands.
fn paint(frame: &mut Frame, new: usize, body: Rect, look: Look) -> Option<Rect> {
    if body.is_empty() {
        return None;
    }
    let label = if new > 0 {
        format!("Jump to latest · {new} new")
    } else {
        "Jump to latest".to_owned()
    };
    let inner = 2 + label.width() as u16; // "↓ " before the label
    let width = inner + 4;
    let border = look.role(Role::Dim);
    if body.height >= 4 && body.width >= width + 2 {
        let area = Rect::new(body.right() - width - 1, body.bottom() - 3, width, 3);
        let rule = |n: u16| "─".repeat(usize::from(n));
        let lines = [
            Line::styled(format!("╭{}╮", rule(width - 2)), border),
            Line::from(vec![
                Span::styled("│ ", border),
                Span::styled("↓ ", look.role(Role::Accent)),
                Span::styled(label, look.role(Role::Text)),
                Span::styled(" │", border),
            ]),
            Line::from(vec![
                Span::styled("╰─ ", border),
                Span::styled("End", look.role(Role::Text)),
                Span::styled(format!(" {}╯", rule(width - 8)), border),
            ]),
        ];
        crate::board::view::overlay_lines(frame, area, lines.into());
        return Some(area);
    }
    let short = Line::from(vec![
        Span::styled(" ↓ ", look.role(Role::Accent)),
        Span::styled("Latest · End ", look.role(Role::Text)),
    ]);
    let width = short.width() as u16;
    if body.width < width {
        return None;
    }
    let area = Rect::new(body.right() - width, body.bottom() - 1, width, 1);
    crate::board::view::overlay_lines(frame, area, vec![short.style(look.selection())]);
    Some(area)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::{Terminal, backend::TestBackend};

    fn shown(width: u16, height: u16, new: usize) -> (Vec<String>, Option<Rect>) {
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        let mut hit = None;
        terminal
            .draw(|frame| {
                let body = frame.area();
                hit = paint(frame, new, body, Look::default());
            })
            .unwrap();
        let buffer = terminal.backend().buffer();
        let rows = (0..height)
            .map(|y| {
                (0..width)
                    .map(|x| buffer[(x, y)].symbol())
                    .collect::<String>()
                    .trim_end()
                    .to_owned()
            })
            .collect();
        (rows, hit)
    }

    #[test]
    fn the_button_counts_new_messages_and_names_end_on_its_lower_edge() {
        let (rows, hit) = shown(60, 8, 3);
        assert_eq!(
            rows[5..],
            [
                "                               ╭──────────────────────────╮",
                "                               │ ↓ Jump to latest · 3 new │",
                "                               ╰─ End ────────────────────╯",
            ]
        );
        assert_eq!(hit, Some(Rect::new(31, 5, 28, 3)));
        let (rows, _) = shown(60, 8, 0);
        assert_eq!(
            rows[6].trim(),
            "│ ↓ Jump to latest │",
            "no count without new messages"
        );
    }

    #[test]
    fn a_small_body_gets_one_line_and_a_tiny_one_none() {
        let (rows, hit) = shown(24, 3, 3);
        assert_eq!(rows[2], "         ↓ Latest · End");
        assert_eq!(hit, Some(Rect::new(8, 2, 16, 1)));
        assert_eq!(shown(10, 3, 3).1, None);
    }
}
