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
const NAME_SPAN: usize = 5;

/// The same three-cell label chip is used in the tree and label menus.
pub(in crate::board) fn label_chip(label: &crate::config::BoardLabel, look: Look) -> Span<'static> {
    role_chip(
        &label.glyph,
        crate::look::role(&label.color).expect("validated label role"),
        look,
    )
}

pub(in crate::board) fn role_chip(glyph: &str, role: Role, look: Look) -> Span<'static> {
    let fill = tmt_cli_style::theme::screen::fill(
        &look.theme,
        role,
        look.depth,
        tmt_cli_style::theme::screen::Fill::Solid,
    );
    let style = if look.depth == tmt_cli_style::Depth::None || fill.bg.is_none() {
        Style::new().add_modifier(Modifier::REVERSED)
    } else if !matches!(fill.bg, Some(ratatui::style::Color::Rgb(..))) {
        let mut style = look.role(role);
        style.bg = None;
        style
            .add_modifier(Modifier::REVERSED)
            .remove_modifier(Modifier::DIM)
    } else {
        fill.remove_modifier(Modifier::DIM | Modifier::REVERSED)
    };
    let text = if glyph.width() == 1 {
        format!(" {} ", glyph)
    } else {
        format!("{} ", glyph)
    };
    Span::styled(text, style)
}

pub(in crate::board) struct Row<'a> {
    pub source: &'a OpsTreeRow,
    /// None means no slot; Some(None) reserves an empty slot.
    pub label: Option<Option<&'a crate::config::BoardLabel>>,
    pub expanded: bool,
    pub last: bool,
    /// A member that owns terminals folds them: `▾`/`▸` before its name.
    pub folds: bool,
    pub state: Line<'static>,
    pub state_primary_width: Option<usize>,
    pub state_attention: Vec<bool>,
    pub tokens: String,
    pub tokens_bold: bool,
    pub minute: String,
    pub minute_bold: bool,
    pub session: String,
    pub timers: Option<u32>,
    pub selected: bool,
    pub unread: bool,
    /// Focus is in this agent's conversation: the row takes the conversation tint and a bold name.
    pub in_conversation: bool,
    pub query: &'a str,
}
#[derive(Default)]
pub(in crate::board) struct Painted {
    pub label: Option<Rect>,
    pub state: Option<Rect>,
    pub task: Option<Rect>,
    pub timers: Option<Rect>,
    /// The TOK figure, whichever unit it shows: a click switches the unit.
    pub tokens: Option<Rect>,
}

fn style(look: Look, row: &Row<'_>, value: Style, attention: bool) -> Style {
    let idle = row
        .source
        .activity
        .as_ref()
        .is_some_and(|member| member.activity.phase == crate::board::activity::Phase::Idle);
    let value = if idle
        && !row.selected
        && !row.unread
        && !attention
        && (value == look.role(Role::Text) || value == look.role(Role::Muted))
    {
        look.role(Role::Dim)
    } else {
        value
    };
    let result = if row.in_conversation {
        let mut style = look
            .conversation()
            .patch(look.row_span(true, value, false))
            .remove_modifier(Modifier::BOLD);
        // The state words were already painted with the selection background; the tint wins.
        style.bg = look.conversation().bg;
        style
    } else {
        look.selected(row.selected, value)
    };
    if idle && !row.selected && !row.unread && attention {
        result.remove_modifier(Modifier::DIM)
    } else {
        result
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
        Span::styled(" ", look.selected(selected, look.role(Role::Text))),
        Span::styled(
            if expanded { "▾ " } else { "▸ " },
            look.selected(selected, look.role(Role::Muted)),
        ),
    ];
    line.extend(
        spans
            .into_iter()
            .map(|(text, style)| Span::styled(text, look.selected(selected, style))),
    );
    let width: usize = line.iter().map(Span::width).sum();
    line.push(Span::styled(
        " ".repeat(usize::from(area.width).saturating_sub(width)),
        look.selected(selected, look.role(Role::Text)),
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
    let base = look.selected(row.selected, look.role(Role::Text));
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
                    let style = look.selected(row.selected, span.style);
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
    let base = style(look, row, look.role(Role::Text), false);
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
                let offset = 1 + branch.width();
                let show_label =
                    member && row.label.is_some() && offset + 4 <= usize::from(cell.width);
                if show_label {
                    painted.label = Some(Rect::new(cell.x + offset as u16, cell.y, 3, 1));
                }
                let name_width = usize::from(cell.width).saturating_sub(
                    1 + branch.width() + usize::from(row.source.lead) + 4 * usize::from(show_label),
                );
                // Keep the leading gutter aligned with the squad tree.
                Line::from(vec![
                    Span::styled(" ", look.role(Role::Muted)),
                    Span::styled(branch, look.role(Role::Text)),
                    Span::raw(match row.label {
                        Some(Some(label)) if show_label => {
                            if label.glyph.width() == 1 {
                                format!(" {} ", label.glyph)
                            } else {
                                format!("{} ", label.glyph)
                            }
                        }
                        Some(None) if show_label => "   ".into(),
                        _ => String::new(),
                    }),
                    Span::raw(if show_label { " " } else { "" }),
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
            AgentsField::Activity => Line::styled("", look.role(Role::Muted)),
            AgentsField::PerMinute => Line::styled(
                fit(&row.minute, Align::Right),
                look.role(if row.minute == "—" {
                    Role::Dim
                } else {
                    Role::Text
                }),
            ),
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
        };
        line.style = style(look, row, line.style, false);
        for (index, span) in line.spans.iter_mut().enumerate() {
            let attention = matches!(field, AgentsField::State)
                && row.state_attention.get(index).copied().unwrap_or(false);
            span.style = style(look, row, span.style, attention);
        }
        if matches!(field, AgentsField::Agent)
            && let Some(Some(label)) = row.label
            && let Some(span) = line.spans.get_mut(2)
        {
            span.style = label_chip(label, look).style;
        }
        if (matches!(field, AgentsField::PerMinute) && row.minute_bold)
            || (matches!(field, AgentsField::Tokens) && row.tokens_bold)
        {
            line.style = line.style.add_modifier(Modifier::BOLD);
            for span in &mut line.spans {
                span.style = span.style.add_modifier(Modifier::BOLD);
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
                (false, false, Role::Muted),
                (false, false, Role::Waiting),
                (false, false, Role::Blocked),
                (false, true, Role::Unread),
                (true, false, Role::Muted),
            ] {
                let row = Row {
                    source,
                    label: None,
                    expanded: false,
                    last: true,
                    folds: false,
                    state: Line::from(vec![
                        Span::styled("!", look.role(role)),
                        Span::styled(" blocked", look.role(Role::Blocked)),
                    ]),
                    state_primary_width: Some(1),
                    state_attention: vec![
                        matches!(role, Role::Waiting | Role::Blocked | Role::Unread),
                        true,
                    ],
                    tokens: "1".into(),
                    tokens_bold: false,
                    minute: "—".into(),
                    minute_bold: false,
                    session: String::new(),

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
                    style(
                        look,
                        &row,
                        look.role(role),
                        matches!(role, Role::Waiting | Role::Blocked | Role::Unread)
                    )
                    .fg
                    .unwrap_or_default(),
                    "{base:?} {role:?}"
                );
                if role == Role::Muted && !selected && depth == tmt_cli_style::Depth::Ansi16 {
                    assert!(
                        mark.modifier.contains(Modifier::DIM),
                        "plain idle: {base:?}"
                    );
                } else {
                    assert!(!mark.modifier.contains(Modifier::DIM), "{base:?} {role:?}");
                }
                if !selected && !unread {
                    assert!(
                        !buffer[(17, 0)].modifier.contains(Modifier::DIM),
                        "blocked word: {base:?}"
                    );
                }
                if selected || unread {
                    assert_eq!(
                        buffer[(5, 0)].fg,
                        style(look, &row, look.role(Role::Text), false)
                            .fg
                            .unwrap_or_default(),
                        "{base:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn lead_mark_uses_the_name_budget() {
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
        let slots = [(AgentsField::Agent, Rect::new(0, 0, 25, 1))];
        let mut buffer = Buffer::empty(area);
        paint(
            &mut buffer,
            area,
            &slots,
            &Row {
                source: &source,
                label: None,
                expanded: false,
                last: false,
                folds: false,
                state: Line::default(),
                state_primary_width: None,
                state_attention: Vec::new(),
                tokens: "—".into(),
                tokens_bold: false,
                minute: "—".into(),
                minute_bold: false,
                session: String::new(),

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
    }

    #[test]
    fn a_chip_is_never_partially_painted_or_clickable() {
        let app = crate::board::app::workspace::tests::board();
        let rows = app.workspace_rows();
        let source = rows
            .iter()
            .find(|row| matches!(row.target, OpsTarget::Member { .. }))
            .unwrap();
        let label = crate::config::WorkspaceLabels::default()
            .definitions
            .remove(0);
        let row = Row {
            source,
            label: Some(Some(&label)),
            expanded: false,
            last: true,
            folds: false,
            state: Line::default(),
            state_primary_width: None,
            state_attention: Vec::new(),
            tokens: String::new(),
            tokens_bold: false,
            minute: String::new(),
            minute_bold: false,
            session: String::new(),
            timers: None,
            selected: false,
            unread: false,
            in_conversation: false,
            query: "",
        };
        let area = Rect::new(0, 0, 7, 1);
        let mut buffer = Buffer::empty(area);
        let painted = paint(
            &mut buffer,
            area,
            &[(AgentsField::Agent, area)],
            &row,
            Look::default(),
        );
        assert!(painted.label.is_none());
        assert!(!buffer.content.iter().any(|cell| cell.symbol() == "P"));
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
                label: None,
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
                state_attention: vec![true, false],
                tokens: "12.3K".into(),
                tokens_bold: false,
                minute: "—".into(),
                minute_bold: false,
                session: String::new(),

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
                        label: None,
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
                        state_attention: vec![true, false],
                        tokens: "—".into(),
                        tokens_bold: false,
                        minute: "—".into(),
                        minute_bold: false,
                        session: String::new(),

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
