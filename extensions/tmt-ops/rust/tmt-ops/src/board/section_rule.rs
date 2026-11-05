//! SectionRule: one neutral rule, a focused title and an optional right note.
use crate::look::Look;
use ratatui::{
    buffer::Buffer,
    layout::Rect,
    text::{Line, Span},
};
use tmt_cli_style::Role;
use unicode_width::UnicodeWidthStr;

pub(in crate::board) fn plain(title: &str, width: usize) -> String {
    let title = crate::board::notes::single_line(title);
    if title.is_empty() {
        return "─".repeat(width);
    }
    let title = format!("── {title} ");
    let tail = width.saturating_sub(title.width());
    crate::board::view::fit(&format!("{title}{}", "─".repeat(tail)), width)
}

/// Where `line` puts a note of `note_width` cells in `area`, when it fits beside the title.
pub(in crate::board) fn note_area(title: &str, note_width: usize, area: Rect) -> Option<Rect> {
    let heading = format!("── {} ", crate::board::notes::single_line(title));
    if note_width == 0 || heading.width() + note_width + 4 + 1 > usize::from(area.width) {
        return None;
    }
    let width = note_width as u16;
    Some(Rect::new(
        area.right().saturating_sub(3 + width),
        area.y,
        width,
        1,
    ))
}

pub(in crate::board) fn line(
    title: &str,
    note: Line<'static>,
    width: usize,
    focused: bool,
    look: Look,
) -> Line<'static> {
    let title = crate::board::notes::single_line(title);
    let heading = format!("── {title} ");
    let note_width = note.width() + 4;
    if note.width() == 0 || heading.width() + note_width + 1 > width {
        let prefix = "── ".chars().take(width.min(3)).collect::<String>();
        let shown = crate::board::view::fit(
            &format!("{title} "),
            width.saturating_sub(prefix.width()).min(title.width() + 1),
        );
        let fill = width.saturating_sub(prefix.width() + shown.width());
        return Line::from(vec![
            Span::styled(prefix, look.role(Role::Dim)),
            Span::styled(
                shown,
                look.role(if focused { Role::Text } else { Role::Muted }),
            ),
            Span::styled("─".repeat(fill), look.role(Role::Dim)),
        ]);
    }
    let mut spans = vec![
        Span::styled("── ", look.role(Role::Dim)),
        Span::styled(
            format!("{title} "),
            look.role(if focused { Role::Text } else { Role::Muted }),
        ),
        Span::styled(
            "─".repeat(width - heading.width() - note_width),
            look.role(Role::Dim),
        ),
        Span::raw(" "),
    ];
    spans.extend(note.spans);
    spans.push(Span::styled(" ──", look.role(Role::Dim)));
    Line::from(spans)
}

pub(in crate::board) fn paint(
    buffer: &mut Buffer,
    area: Rect,
    title: &str,
    note: Line<'static>,
    focused: bool,
    look: Look,
) {
    tmt_tui::components::strip::paint_left(
        buffer,
        Rect {
            height: area.height.min(1),
            ..area
        },
        line(title, note, usize::from(area.width), focused, look),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notes_yield_to_the_title_and_every_rule_fits() {
        let look = Look::new(tmt_cli_style::Theme::default());
        for width in [0, 1, 8, 40, 85, 103, 148] {
            let row = line(
                "Squads",
                Line::styled("8 squads · 28 agents", look.role(Role::Muted)),
                width,
                true,
                look,
            );
            assert!(row.width() <= width);
            if width >= 40 {
                assert!(row.to_string().ends_with("8 squads · 28 agents ──"));
            }
            assert!(!row.to_string().contains('━'));
        }
        assert_eq!(plain("Timers", 20), "── Timers ──────────");
    }
    #[test]
    fn design_system_rule_matches_board_cells_and_styles() {
        use tmt_cli_style::{Depth, Theme, theme::Base};
        use tmt_tui::components::{
            design_system::{
                CellGrid, Component, Rect as GridRect, SectionRule, SectionRuleProps, Size, Token,
            },
            design_system_ratatui,
        };
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
            for width in [40, 60, 80, 120, 160] {
                for focused in [false, true] {
                    for title in [
                        "",
                        "Saved · 1d",
                        "A long title that fills much of a narrower section rule",
                        "hello\tworld\nagain",
                    ] {
                        for note in [None, Some("0.9% of input")] {
                            let area = Rect::new(0, 0, width, 1);
                            let mut original = Buffer::empty(area);
                            let line = note.map_or_else(Line::default, |value| {
                                Line::from(Span::styled(value.to_owned(), look.role(Role::Muted)))
                            });
                            if title.is_empty() {
                                tmt_tui::components::strip::paint_left(
                                    &mut original,
                                    area,
                                    Line::styled(
                                        plain(title, usize::from(width)),
                                        look.role(Role::Dim),
                                    ),
                                );
                            } else {
                                paint(&mut original, area, title, line, focused, look);
                            }
                            let mut grid = CellGrid::new(Size { width, height: 1 });
                            SectionRule::render(
                                &SectionRuleProps {
                                    title: title.into(),
                                    note: note.map(str::to_owned),
                                    note_role: note.map(|_| Token(Role::Muted)),
                                    focused,
                                },
                                GridRect {
                                    x: 0,
                                    y: 0,
                                    width,
                                    height: 1,
                                },
                                &mut grid,
                            );
                            let mut actual = Buffer::empty(area);
                            design_system_ratatui::paint(
                                &grid,
                                area,
                                &mut actual,
                                &look.theme,
                                look.depth,
                            );
                            assert_eq!(
                                actual, original,
                                "width={width}, title={title:?}, note={note:?}, focused={focused}, look={base:?}/{depth:?}"
                            );
                        }
                    }
                }
            }
        }
    }
}
