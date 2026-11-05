//! StateCell: the state glyph owns attention colour; `activity::Label` owns the words.
use crate::look::Look;
use ratatui::text::Span;
use tmt_cli_style::Role;

pub(in crate::board) fn glyph(state: Option<&str>) -> &'static str {
    match state {
        Some("working") => "●",
        Some("waiting") => "◆",
        Some("blocked") => "✗",
        Some("review") => "◐",
        Some("idle") => "◌",
        Some("offline" | "ended") => "○",
        // A plain program, not an agent (#5769).
        Some("shell") => "▪",
        _ => "?",
    }
}
pub(in crate::board) fn mark(state: Option<&str>, look: Look) -> Span<'static> {
    Span::styled(
        glyph(state),
        look.role(match state {
            Some("waiting") => Role::Waiting,
            Some("blocked") => Role::Blocked,
            _ => Role::Muted,
        }),
    )
}
/// The idle alert's over mark. It reuses the cron glyph, so a time or the word
/// `idle` always follows it; the attention colour is the only thing it adds.
pub(in crate::board) fn over(
    glyphs: super::overview::cron_counts::GlyphSet,
    look: Look,
) -> Span<'static> {
    use super::overview::cron_counts::GlyphSet;
    Span::styled(
        match glyphs {
            GlyphSet::Unicode => "◷",
            GlyphSet::Ascii => "!",
        },
        look.role(Role::Waiting),
    )
}
/// The same unread mark on tables, strips and global attention.
pub(in crate::board) fn unread_mark(
    count: super::unread::Count,
    look: Look,
) -> Option<Span<'static>> {
    (count.total > 0).then(|| Span::styled("●", look.role(Role::Unread)))
}

/// Shared unread override: colour belongs to the glyph alone.
pub(in crate::board) fn unread(
    count: super::unread::Count,
    look: Look,
) -> Option<ratatui::text::Line<'static>> {
    Some(ratatui::text::Line::from(vec![
        unread_mark(count, look)?,
        Span::styled(format!(" {}", count.label()?), look.role(Role::Muted)),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_attention_marks_use_attention_roles() {
        let look = Look::new(tmt_cli_style::Theme::default());
        for state in [
            Some("working"),
            Some("idle"),
            Some("ended"),
            Some("waiting"),
            Some("blocked"),
            None,
        ] {
            let role = match state {
                Some("waiting") => Role::Waiting,
                Some("blocked") => Role::Blocked,
                _ => Role::Muted,
            };
            assert_eq!(mark(state, look).style, look.role(role));
        }
        assert_eq!(glyph(Some("ended")), "○");
        assert_eq!(glyph(Some("shell")), "▪");
        assert_eq!(mark(Some("shell"), look).style, look.role(Role::Muted));
        assert_eq!(glyph(None), "?");
    }
}

#[cfg(test)]
mod unread_tests {
    use super::*;
    #[test]
    fn unread_words_are_neutral_and_zero_is_not_a_state_even_with_a_partial_page() {
        let mut look = Look::default();
        let count = crate::board::unread::Count {
            total: 2,
            more: true,
        };
        let line = unread(count, look).unwrap();
        assert_eq!(line.to_string(), "● 2+ unread");
        assert_eq!(line.spans[0].style, look.role(Role::Unread));
        assert_eq!(line.spans[1].style, look.role(Role::Muted));
        assert!(
            unread(
                crate::board::unread::Count {
                    total: 0,
                    more: true
                },
                look
            )
            .is_none()
        );
        look.depth = tmt_cli_style::Depth::None;
        let plain = unread(count, look).unwrap();
        assert_eq!(plain.to_string(), "● 2+ unread");
        assert!(
            plain
                .spans
                .iter()
                .all(|span| span.style.fg.is_none() && span.style.bg.is_none())
        );
    }
}

#[cfg(test)]
mod design_system_parity {
    use super::*;
    use ratatui::{buffer::Buffer, layout::Rect};
    use tmt_cli_style::{Depth, Theme, theme::Base};
    use tmt_tui::components::{
        design_system::{CellGrid, Component, Mark, MarkProps, MarkState, Rect as GridRect, Size},
        design_system_ratatui,
    };

    #[test]
    fn mark_matches_each_board_state_and_look() {
        for (base, depth) in [
            (Base::Tmt, Depth::TrueColor),
            (Base::TmtLight, Depth::TrueColor),
            (Base::Terminal, Depth::Ansi16),
            (Base::Tmt, Depth::None),
        ] {
            let look = Look {
                theme: Theme::new(base),
                depth,
            };
            for (name, state) in [
                ("working", MarkState::Working),
                ("waiting", MarkState::Waiting),
                ("blocked", MarkState::Blocked),
                ("review", MarkState::Review),
                ("idle", MarkState::Idle),
                ("offline", MarkState::Offline),
                ("ended", MarkState::Ended),
                ("shell", MarkState::Shell),
            ] {
                let expected = mark(Some(name), look);
                let mut grid = CellGrid::new(Size {
                    width: 8,
                    height: 1,
                });
                Mark::render(
                    &MarkProps {
                        state,
                        label: "state".into(),
                        emphasis: false,
                    },
                    GridRect {
                        x: 0,
                        y: 0,
                        width: 8,
                        height: 1,
                    },
                    &mut grid,
                );
                let mut actual = Buffer::empty(Rect::new(0, 0, 8, 1));
                design_system_ratatui::paint(&grid, actual.area, &mut actual, &look.theme, depth);
                let mut reference = Buffer::empty(Rect::new(0, 0, 8, 1));
                reference[(0, 0)]
                    .set_symbol(expected.content.as_ref())
                    .set_style(expected.style);
                assert_eq!(
                    actual[(0, 0)],
                    reference[(0, 0)],
                    "{name} {base:?}/{depth:?}"
                );
            }
        }
    }
}
