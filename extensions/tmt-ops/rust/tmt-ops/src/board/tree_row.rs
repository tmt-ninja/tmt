//! One dense squad/member row with neutral, full-row selection.
use crate::{
    board::workspace::{OpsTarget, OpsTreeRow, columns::AgentsField},
    look::Look,
};
use ratatui::{
    buffer::Buffer,
    layout::Rect,
    style::{Modifier, Style},
    text::{Line, Span},
};
use tmt_cli_style::{Role, grid::Align};
use tmt_tui::{components::strip, style::TextFlow};
use unicode_width::UnicodeWidthStr;

/// Where the agent's name sits among the spans of its cell: pin, branch, lead mark, name.
const NAME_SPAN: usize = 3;

pub(in crate::board) struct Row<'a> {
    pub source: &'a OpsTreeRow,
    pub expanded: bool,
    pub last: bool,
    /// A member that owns terminals folds them: `▾`/`▸` before its name.
    pub folds: bool,
    pub state: Line<'static>,
    pub state_primary_width: Option<usize>,
    pub tokens: String,
    pub session: String,
    pub model: String,
    pub timers: Option<u32>,
    pub selected: bool,
    pub unread: bool,
    /// Focus is in this agent's conversation: the row takes the conversation tint and a bold name.
    pub in_conversation: bool,
    pub query: &'a str,
}
#[derive(Default)]
pub(in crate::board) struct Painted {
    pub state: Option<Rect>,
    pub task: Option<Rect>,
    pub timers: Option<Rect>,
    pub model: Option<Rect>,
    /// The TOK figure, whichever unit it shows: a click switches the unit.
    pub tokens: Option<Rect>,
}

fn style(look: Look, row: &Row<'_>, value: Style) -> Style {
    let idle = row
        .source
        .activity
        .as_ref()
        .is_some_and(|member| member.activity.phase == crate::board::activity::Phase::Idle);
    let value = if idle
        && !row.selected
        && !row.unread
        && (value == look.role(Role::Text) || value == look.role(Role::Muted))
    {
        look.role(Role::Dim)
    } else {
        value
    };
    if row.in_conversation {
        let mut style = look
            .conversation()
            .patch(look.row_span(true, value, false))
            .remove_modifier(Modifier::BOLD);
        // The state words were already painted with the selection background; the tint wins.
        style.bg = look.conversation().bg;
        style
    } else {
        selection(look, row.selected, value)
    }
}

fn selection(look: Look, selected: bool, value: Style) -> Style {
    if selected {
        look.selection()
            .patch(look.row_span(true, value, false))
            .remove_modifier(Modifier::BOLD)
    } else {
        value
    }
}

/// A group row that reads as one line across every column (the Hidden group):
/// the gutter, the fold mark and `spans`, with the selection style when chosen.
pub(in crate::board) fn paint_line(
    buffer: &mut Buffer,
    area: Rect,
    expanded: bool,
    spans: Vec<(String, Style)>,
    selected: bool,
    look: Look,
) {
    let mut line = vec![
        Span::styled(" ", selection(look, selected, look.role(Role::Text))),
        Span::styled(
            if expanded { "▾ " } else { "▸ " },
            selection(look, selected, look.role(Role::Muted)),
        ),
    ];
    line.extend(
        spans
            .into_iter()
            .map(|(text, style)| Span::styled(text, selection(look, selected, style))),
    );
    let width: usize = line.iter().map(Span::width).sum();
    line.push(Span::styled(
        " ".repeat(usize::from(area.width).saturating_sub(width)),
        selection(look, selected, look.role(Role::Text)),
    ));
    strip::paint_left(buffer, area, Line::from(line));
}

/// One of a member's terminals, under the member's row (#5991): the tree line, `Terminal N`, and
/// `● running` or a grey `○ ended` in STATE. It has no tokens, session, model or timers.
pub(in crate::board) struct TerminalRow<'a> {
    pub source: &'a OpsTreeRow,
    pub ended: bool,
    /// The last terminal under its member: `└` rather than `├`.
    pub last: bool,
    /// Its member has a sibling below: the member's line goes on (`│`).
    pub trunk: bool,
    pub selected: bool,
    /// The tree's colour for a live member.
    pub live: Style,
}

pub(in crate::board) fn paint_terminal(
    buffer: &mut Buffer,
    area: Rect,
    slots: &[(AgentsField, Rect)],
    row: &TerminalRow<'_>,
    look: Look,
) {
    let base = selection(look, row.selected, look.role(Role::Text));
    for y in area.y..area.bottom() {
        strip::paint_left(
            buffer,
            Rect::new(area.x, y, area.width, 1),
            Line::styled(" ".repeat(usize::from(area.width)), base),
        );
    }
    let (dot, word, style) = if row.ended {
        ("○", "ended", look.role(Role::Muted))
    } else {
        ("●", "running", row.live)
    };
    for (field, slot) in slots {
        let cell = Rect::new(slot.x, area.y, slot.width, area.height.min(1)).intersection(area);
        if cell.is_empty() {
            continue;
        }
        let line = match field {
            AgentsField::Agent => {
                // The member's own indent, then its line and this terminal's branch.
                let indent = "  ".repeat(usize::from(row.source.depth.saturating_sub(2)));
                let branch = format!(
                    "{indent}{}{}",
                    if row.trunk { "  │ " } else { "    " },
                    if row.last { "└ " } else { "├ " }
                );
                let name_width = usize::from(cell.width).saturating_sub(1 + branch.width());
                Line::from(vec![
                    Span::styled(" ", look.role(Role::Muted)),
                    Span::styled(branch, look.role(Role::Text)),
                    Span::styled(
                        crate::board::view::fit(&row.source.title, name_width),
                        look.role(if row.ended { Role::Muted } else { Role::Text }),
                    ),
                ])
            }
            AgentsField::State => Line::from(vec![
                Span::styled(dot, style),
                Span::styled(format!(" {word}"), look.role(Role::Muted)),
            ]),
            _ => continue,
        };
        let line = Line::from(
            line.spans
                .into_iter()
                .map(|span| {
                    let style = selection(look, row.selected, span.style);
                    span.style(style)
                })
                .collect::<Vec<_>>(),
        );
        strip::paint_left(buffer, cell, line);
    }
}

pub(in crate::board) fn paint(
    buffer: &mut Buffer,
    area: Rect,
    slots: &[(AgentsField, Rect)],
    row: &Row<'_>,
    look: Look,
) -> Painted {
    let base = style(look, row, look.role(Role::Text));
    for y in area.y..area.bottom() {
        strip::paint_left(
            buffer,
            Rect::new(area.x, y, area.width, 1),
            Line::styled(" ".repeat(usize::from(area.width)), base),
        );
    }
    let mut painted = Painted::default();
    for (field, slot) in slots {
        let cell = Rect::new(slot.x, area.y, slot.width, area.height.min(1)).intersection(area);
        if cell.is_empty() {
            continue;
        }
        let fit = |value: &str, align| {
            tmt_tui::text::fit_line(value, cell.width, TextFlow::Truncate, align)
        };
        let mut line = match field {
            AgentsField::Agent => {
                let member = matches!(row.source.target, OpsTarget::Member { .. });
                // Rows inside the Hidden group sit one level further in.
                let indent = "  ".repeat(usize::from(
                    row.source.depth.saturating_sub(u8::from(member)),
                ));
                let branch = if member {
                    match (row.last, row.folds, row.expanded) {
                        (true, false, _) => "  └ ",
                        (false, false, _) => "  ├ ",
                        (true, true, true) => "  └ ▾ ",
                        (true, true, false) => "  └ ▸ ",
                        (false, true, true) => "  ├ ▾ ",
                        (false, true, false) => "  ├ ▸ ",
                    }
                } else if row.expanded {
                    "▾ "
                } else {
                    "▸ "
                };
                let branch = format!("{indent}{branch}");
                let name_width = usize::from(cell.width)
                    .saturating_sub(1 + branch.width() + usize::from(row.source.lead));
                // Keep the leading gutter aligned with the squad tree.
                Line::from(vec![
                    Span::styled(" ", look.role(Role::Muted)),
                    Span::styled(branch, look.role(Role::Text)),
                    Span::styled(
                        if row.source.lead { "*" } else { "" },
                        look.role(Role::Muted),
                    ),
                    Span::styled(
                        crate::board::view::fit(
                            &crate::board::notes::single_line(&row.source.title),
                            name_width,
                        ),
                        look.role(Role::Text),
                    ),
                ])
            }
            AgentsField::State => {
                let primary = row
                    .state_primary_width
                    .unwrap_or(row.state.width())
                    .min(usize::from(cell.width)) as u16;
                painted.state = (primary > 0).then_some(Rect::new(cell.x, cell.y, primary, 1));
                let task = row.state.width().min(usize::from(cell.width)) as u16 - primary;
                painted.task = (task > 0).then_some(Rect::new(cell.x + primary, cell.y, task, 1));
                let mut state = row.state.clone();
                if state.width() > usize::from(cell.width) {
                    let prefix = state
                        .spans
                        .iter()
                        .take(state.spans.len().saturating_sub(1))
                        .map(Span::width)
                        .sum::<usize>();
                    if let Some(last) = state.spans.last_mut() {
                        last.content = crate::board::view::fit(
                            &last.content,
                            usize::from(cell.width).saturating_sub(prefix),
                        )
                        .into();
                    }
                }
                state
            }
            AgentsField::Session => {
                Line::styled(fit(&row.session, Align::Left), look.role(Role::Muted))
            }
            AgentsField::Tokens => {
                painted.tokens = Some(cell);
                Line::styled(
                    fit(&row.tokens, Align::Right),
                    look.role(if row.tokens == "—" {
                        Role::Dim
                    } else {
                        Role::Text
                    }),
                )
            }
            AgentsField::Cron => {
                if row.timers.is_some() {
                    painted.timers = Some(cell);
                }
                Line::styled(
                    fit(
                        &row.timers.map_or_else(|| "—".into(), |n| n.to_string()),
                        Align::Center,
                    ),
                    look.role(Role::Muted),
                )
            }
            AgentsField::Model => {
                painted.model = Some(cell);
                Line::styled(fit(&row.model, Align::Left), look.role(Role::Muted))
            }
        };
        line.style = style(look, row, line.style);
        for span in &mut line.spans {
            span.style = style(look, row, span.style);
        }
        if matches!(field, AgentsField::State) && !row.selected && !row.unread {
            if let Some(mark) = line.spans.first_mut() {
                mark.style = mark.style.remove_modifier(Modifier::DIM);
            }
            for span in &mut line.spans {
                if span.style.fg == look.role(Role::Blocked).fg
                    && look.role(Role::Blocked).fg.is_some()
                {
                    span.style = span.style.remove_modifier(Modifier::DIM);
                }
            }
        }
        if row.in_conversation
            && matches!(field, AgentsField::Agent)
            && let Some(name) = line.spans.get_mut(NAME_SPAN)
        {
            name.style = name.style.add_modifier(Modifier::BOLD);
        }
        strip::paint_left(
            buffer,
            cell,
            crate::board::search_field::highlight_line(line, row.query),
        );
    }
    painted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_rows_preserve_attention_and_selected_styles() {
        use crate::board::activity::Phase;
        use crate::board::app::workspace::tests::{MEMBER, board};
        for (base, depth) in [
            (tmt_cli_style::Base::Tmt, tmt_cli_style::Depth::TrueColor),
            (
                tmt_cli_style::Base::TmtLight,
                tmt_cli_style::Depth::TrueColor,
            ),
            (tmt_cli_style::Base::Terminal, tmt_cli_style::Depth::Ansi16),
            (tmt_cli_style::Base::Tmt, tmt_cli_style::Depth::None),
        ] {
            let mut app = board();
            app.view
                .as_mut()
                .unwrap()
                .home
                .as_mut()
                .unwrap()
                .workspace
                .roster
                .members
                .get_mut(MEMBER)
                .unwrap()
                .activity
                .phase = Phase::Idle;
            let rows = app.workspace_rows();
            let source = rows.iter().find(|row| matches!(&row.target, OpsTarget::Member { identity_id, .. } if identity_id == MEMBER)).unwrap();
            let look = Look {
                theme: tmt_cli_style::Theme::new(base),
                depth,
            };
            for (selected, unread, role) in [
                (false, false, Role::Waiting),
                (false, false, Role::Blocked),
                (false, true, Role::Unread),
                (true, false, Role::Muted),
            ] {
                let row = Row {
                    source,
                    expanded: false,
                    last: true,
                    folds: false,
                    state: Line::from(vec![
                        Span::styled("!", look.role(role)),
                        Span::styled(" blocked", look.role(Role::Blocked)),
                    ]),
                    state_primary_width: Some(1),
                    tokens: "1".into(),
                    session: String::new(),
                    model: String::new(),
                    timers: None,
                    selected,
                    unread,
                    in_conversation: false,
                    query: "",
                };
                let mut buffer = Buffer::empty(Rect::new(0, 0, 30, 1));
                paint(
                    &mut buffer,
                    Rect::new(0, 0, 30, 1),
                    &[
                        (AgentsField::Agent, Rect::new(0, 0, 15, 1)),
                        (AgentsField::State, Rect::new(15, 0, 15, 1)),
                    ],
                    &row,
                    look,
                );
                let mark = &buffer[(15, 0)];
                assert_eq!(
                    mark.fg,
                    style(look, &row, look.role(role)).fg.unwrap_or_default(),
                    "{base:?} {role:?}"
                );
                assert!(!mark.modifier.contains(Modifier::DIM), "{base:?} {role:?}");
                if !selected && !unread {
                    assert!(
                        !buffer[(17, 0)].modifier.contains(Modifier::DIM),
                        "blocked word: {base:?}"
                    );
                }
                if selected || unread {
                    assert_eq!(
                        buffer[(5, 0)].fg,
                        style(look, &row, look.role(Role::Text))
                            .fg
                            .unwrap_or_default(),
                        "{base:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn lead_mark_uses_the_name_budget_and_model_text_is_muted_and_ellipsized() {
        use crate::board::workspace::OpsObservation;
        let source = OpsTreeRow {
            target: OpsTarget::Member {
                room_id: None,
                identity_id: "member".into(),
            },
            title: "a-very-long-agent-name".into(),
            depth: 1,
            lead: true,
            state: None,
            presence: None,
            usage: None,
            activity: None,
            count: None,
            observation: OpsObservation::Complete,
        };
        let look = Look {
            theme: tmt_cli_style::Theme::new(tmt_cli_style::Base::Tmt),
            depth: tmt_cli_style::Depth::TrueColor,
        };
        let area = Rect::new(0, 0, 34, 1);
        let slots = [
            (AgentsField::Agent, Rect::new(0, 0, 25, 1)),
            (AgentsField::Model, Rect::new(26, 0, 8, 1)),
        ];
        let mut buffer = Buffer::empty(area);
        paint(
            &mut buffer,
            area,
            &slots,
            &Row {
                source: &source,
                expanded: false,
                last: false,
                folds: false,
                state: Line::default(),
                state_primary_width: None,
                tokens: "—".into(),
                session: String::new(),
                model: "gpt-6.1-sol".into(),
                timers: None,
                selected: false,
                unread: false,
                in_conversation: false,
                query: "",
            },
            look,
        );
        assert_eq!(buffer[(5, 0)].symbol(), "*");
        assert_eq!(buffer[(5, 0)].fg, look.role(Role::Muted).fg.unwrap());
        assert_eq!(buffer[(24, 0)].symbol(), "…");
        assert_eq!(buffer[(25, 0)].symbol(), " ");
        assert_eq!(buffer[(33, 0)].symbol(), "…");
        assert_eq!(buffer[(26, 0)].fg, look.role(Role::Muted).fg.unwrap());
    }

    #[test]
    fn selected_rows_fill_every_cell_without_bold_words() {
        let app = crate::board::app::workspace::tests::board();
        let rows = app.workspace_rows();
        let source = rows
            .iter()
            .find(|row| matches!(row.target, OpsTarget::Member { .. }))
            .unwrap();
        let look = Look {
            theme: tmt_cli_style::Theme::new(tmt_cli_style::Base::Tmt),
            depth: tmt_cli_style::Depth::TrueColor,
        };
        let area = Rect::new(0, 0, 70, 2);
        let slots = [
            (AgentsField::Agent, Rect::new(0, 0, 25, 1)),
            (AgentsField::State, Rect::new(26, 0, 16, 1)),
            (AgentsField::Tokens, Rect::new(43, 0, 7, 1)),
            (AgentsField::Cron, Rect::new(53, 0, 3, 1)),
        ];
        let mut buffer = Buffer::empty(area);
        let painted = paint(
            &mut buffer,
            area,
            &slots,
            &Row {
                source,
                expanded: false,
                last: true,
                folds: false,
                state: crate::board::state_cell::unread(
                    crate::board::unread::Count {
                        total: 2,
                        more: false,
                    },
                    look,
                )
                .unwrap(),
                state_primary_width: Some(10),
                tokens: "12.3K".into(),
                session: String::new(),
                model: "gpt-6.1-sol".into(),
                timers: Some(0),
                selected: true,
                unread: false,
                in_conversation: false,
                query: "",
            },
            look,
        );
        look.selected_words(&mut buffer, &[painted.state.unwrap()], true);
        for cell in &buffer.content {
            assert_eq!(cell.bg, look.selection().bg.unwrap());
            assert!(!cell.modifier.contains(Modifier::BOLD));
        }
        assert_eq!(buffer[(26, 0)].fg, look.role(Role::Unread).fg.unwrap());
        assert_eq!(buffer[(54, 0)].symbol(), "0");
        assert_eq!(buffer[(0, 0)].symbol(), " ");
    }

    #[test]
    fn the_row_in_conversation_has_its_own_tint_and_a_bold_name_and_keeps_state_colours() {
        let app = crate::board::app::workspace::tests::board();
        let rows = app.workspace_rows();
        let source = rows
            .iter()
            .find(|row| matches!(row.target, OpsTarget::Member { .. }))
            .unwrap();
        let area = Rect::new(0, 0, 70, 1);
        let slots = [
            (AgentsField::Agent, Rect::new(0, 0, 25, 1)),
            (AgentsField::State, Rect::new(26, 0, 16, 1)),
        ];
        for (base, depth) in [
            (tmt_cli_style::Base::Tmt, tmt_cli_style::Depth::TrueColor),
            (
                tmt_cli_style::Base::TmtLight,
                tmt_cli_style::Depth::TrueColor,
            ),
            (tmt_cli_style::Base::Terminal, tmt_cli_style::Depth::Ansi16),
            (tmt_cli_style::Base::Tmt, tmt_cli_style::Depth::None),
        ] {
            let look = Look {
                theme: tmt_cli_style::Theme::new(base),
                depth,
            };
            let paint_row = |selected, in_conversation| {
                let mut buffer = Buffer::empty(area);
                let painted = paint(
                    &mut buffer,
                    area,
                    &slots,
                    &Row {
                        source,
                        expanded: false,
                        last: true,
                        folds: false,
                        state: crate::board::state_cell::unread(
                            crate::board::unread::Count {
                                total: 2,
                                more: false,
                            },
                            look,
                        )
                        .unwrap(),
                        state_primary_width: Some(10),
                        tokens: "—".into(),
                        session: String::new(),
                        model: String::new(),
                        timers: None,
                        selected,
                        unread: false,
                        in_conversation,
                        query: "",
                    },
                    look,
                );
                look.selected_words(&mut buffer, &[painted.state.unwrap()], true);
                buffer
            };
            let plain = paint_row(true, false);
            let engaged = paint_row(true, true);
            // The name is bold, the plain selection's is not.
            assert!(engaged[(6, 0)].modifier.contains(Modifier::BOLD));
            assert!(!plain[(6, 0)].modifier.contains(Modifier::BOLD));
            // The state mark keeps its colour.
            assert_eq!(engaged[(26, 0)].fg, plain[(26, 0)].fg);
            if let Some(tint) = look.role(Role::Conversation).bg {
                assert_ne!(Some(tint), look.role(Role::Selection).bg);
                for cell in &engaged.content {
                    assert_eq!(cell.bg, tint);
                }
            } else {
                // No background colours: reverse video, and the bold name tells it from selection.
                assert!(engaged[(40, 0)].modifier.contains(Modifier::REVERSED));
            }
        }
    }
}
