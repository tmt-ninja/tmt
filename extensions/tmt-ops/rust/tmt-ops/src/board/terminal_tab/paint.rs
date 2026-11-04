//! Painting the member frame (#5989): one TMT header row with its menus, the program's screen
//! below it, and the paused or ended dialog over the screen. Colours and marks are the board's
//! own roles; the program's cells are its own (`foreign`).
use super::{
    board::{Dialog, dialog_choices},
    tab::{Caret, Condition, FrameHit, FrameMenu},
};
use crate::{board::app::App, look::Look};
use ratatui::{
    buffer::Buffer,
    layout::Rect,
    style::{Modifier, Style},
    text::{Line, Span},
};
use tmt_cli_style::{Role, foreign};
use tmt_tui::components::{
    strip,
    terminal::{Frame as Screenful, Occupant},
};
use unicode_width::UnicodeWidthStr;

/// The whole board: the header on row 0, the member's screen below, then any menu or dialog.
pub(in crate::board) fn frame(frame: &mut ratatui::Frame, app: &App) {
    let area = frame.area();
    app.terminal.clear_hits();
    if area.height < 2 || area.width < 20 {
        return;
    }
    let buffer = frame.buffer_mut();
    let name = app.terminal_member_name();
    let screen_area = Rect::new(area.x, area.y + 1, area.width, area.height - 1);
    app.terminal.drew(screen_area);
    let view = app.terminal_view();
    let look = app.look();
    match view.and_then(|view| view.screen.as_deref()) {
        Some(screen) => {
            let live = view.is_some_and(|view| view.condition == Condition::Live)
                && app.frame_dialog().is_none();
            cells(buffer, screen_area, screen, !live, look);
            selection(buffer, screen_area, screen, app);
            let caret = live.then(|| caret(screen_area, screen)).flatten();
            app.terminal.place_caret(caret);
            if live && caret.is_none() {
                cursor(buffer, screen_area, screen);
            }
        }
        None => {
            app.terminal.place_caret(None);
            let text = match view.map(|view| &view.condition) {
                None => format!("Looking for {name}'s terminal…"),
                Some(Condition::Connecting { .. }) => format!("Connecting to {name}'s terminal…"),
                Some(condition) => over(condition),
            };
            say(buffer, screen_area, &text, look);
        }
    }
    if let Some(condition) = view
        .map(|view| &view.condition)
        .filter(|condition| condition.ended())
    {
        let last = Rect::new(
            screen_area.x,
            screen_area.bottom() - 1,
            screen_area.width,
            1,
        );
        say(
            buffer,
            last,
            &format!("{} ⏎ tries again.", over(condition)),
            look,
        );
    }
    header(buffer, app, Rect::new(area.x, area.y, area.width, 1), &name);
    if let Some(dialog) = app.frame_dialog() {
        paint_dialog(frame, app, screen_area, dialog, &name);
    } else if let Some(menu) = app.terminal.menu() {
        paint_menu(frame, app, screen_area, menu, &name);
    }
}

/// Why a stream is over, in a few words.
fn over(condition: &Condition) -> String {
    use tmt_pty_protocol::{Eviction, Refusal};
    match condition {
        Condition::Evicted(Eviction::TakenOver) => "Another viewer took over this terminal.".into(),
        Condition::Evicted(Eviction::TooSlow) => "This view fell behind and was dropped.".into(),
        Condition::Refused(refusal) => format!(
            "The terminal would not attach this view ({}).",
            match refusal {
                Refusal::Version => "different protocol version",
                Refusal::Handshake => "bad handshake",
                Refusal::Owner => "not the owner",
                Refusal::Full => "too many viewers",
            }
        ),
        Condition::Lost(reason) => format!("The terminal could not be reached: {reason}."),
        _ => String::new(),
    }
}

/// One piece of the header: its words, their style, and what a click does.
type Piece = (String, Style, Option<FrameHit>);

/// `▌ name  state  Digest N 則待送   ▾成員  ▾工作階段  ▾Checklist N  Colab   …   Ctrl-g 回看板`
fn header(buffer: &mut Buffer, app: &App, row: Rect, name: &str) {
    let look = app.look();
    let bar = look.role(Role::Track);
    buffer.set_style(row, bar);
    let term = app.framed_term().unwrap_or_default();
    let ended = term.ended.is_some()
        || app
            .terminal_view()
            .is_some_and(|view| matches!(view.condition, Condition::Exited(_)));
    let state = if term.paused {
        Role::Blocked
    } else if ended || term.shell {
        Role::Muted
    } else {
        Role::Working
    };
    let mark = look.role(state).patch(bar);
    let plain = look.role(Role::Text).patch(bar);
    let muted = look.role(Role::Muted).patch(bar);
    let button = look.role(Role::Keycap);
    let mut pieces: Vec<Piece> = vec![
        ("▌".into(), mark, None),
        (
            format!(" {name}  "),
            plain.add_modifier(Modifier::BOLD),
            None,
        ),
    ];
    if term.paused {
        pieces.push(("■ 已暫停 ".into(), mark, None));
        pieces.push((" 恢復 ".into(), button, Some(FrameHit::Resume)));
    } else if ended {
        pieces.push(("○ 未連接 · ".into(), mark, None));
        pieces.push((
            " 接續 ".into(),
            button,
            Some(FrameHit::Relaunch(tmt_pty_protocol::RelaunchKind::Resume)),
        ));
        pieces.push(("  ".into(), plain, None));
        pieces.push((
            " 開新的 ".into(),
            button,
            Some(FrameHit::Relaunch(tmt_pty_protocol::RelaunchKind::New)),
        ));
    } else if term.shell {
        pieces.push(("○ shell".into(), mark, None));
    } else {
        pieces.push(("● 已連接".into(), mark, None));
    }
    let held = app.framed_digest_held();
    pieces.push((format!("  Digest {held} 則待送    "), muted, None));
    let open = app.terminal.menu();
    for (label, menu) in [
        ("▾成員".to_owned(), FrameMenu::Members),
        ("▾工作階段".to_owned(), FrameMenu::Session),
        (
            format!("▾Checklist {}", app.framed_checklist_open()),
            FrameMenu::Checklist,
        ),
    ] {
        let style = if open == Some(menu) {
            look.selection()
        } else {
            plain
        };
        pieces.push((label, style, Some(FrameHit::Menu(menu))));
        pieces.push(("   ".into(), plain, None));
    }
    pieces.push((
        "Colab".into(),
        plain.add_modifier(Modifier::UNDERLINED),
        Some(FrameHit::Colab),
    ));
    let back = app.member_back_label();
    let right = format!("{back}  回看板 ");
    let right_width = right.width() as u16;
    let mut x = row.x;
    let limit = row.right().saturating_sub(right_width + 1);
    for (text, style, hit) in pieces {
        let width = text.width() as u16;
        if x + width > limit {
            break;
        }
        buffer.set_string(x, row.y, &text, style);
        if let Some(hit) = hit {
            app.terminal.add_hit(Rect::new(x, row.y, width, 1), hit);
        }
        x += width;
    }
    let at = row.right().saturating_sub(right_width);
    buffer.set_string(at, row.y, &right, plain);
    buffer.set_string(at, row.y, &back, look.role(Role::Keycap));
    app.terminal
        .add_hit(Rect::new(at, row.y, right_width, 1), FrameHit::Back);
}

/// A box with a title over `area`, centred or at `anchor`; returns its inside.
/// A titled box over the screen that owns every cell it covers (`view::overlay_lines`): `body`
/// fills its rows from the top, each fitted to the inside, and the rest stays blank. Returns the
/// inside, where the rows' hits go.
fn boxed(
    frame: &mut ratatui::Frame,
    look: Look,
    area: Rect,
    title: &str,
    body: Vec<Line<'static>>,
) -> Rect {
    let border = look.role(Role::Muted);
    let fill = look.conversation();
    let inner = usize::from(area.width.saturating_sub(4));
    let mut title = crate::board::view::fit(&format!(" {title}"), inner.saturating_sub(1));
    title.truncate(title.trim_end().len());
    title.push(' ');
    let mut lines = vec![Line::from(vec![
        Span::styled("┌─", border),
        Span::styled(title.clone(), look.role(Role::Text)),
        Span::styled("─".repeat(inner + 1 - title.width()), border),
        Span::styled("┐", border),
    ])];
    let rows = usize::from(area.height.saturating_sub(2));
    let mut body = body.into_iter();
    for _ in 0..rows {
        let mut spans = vec![Span::styled("│ ", border)];
        let line = body.next().unwrap_or_default();
        let used = line.width();
        spans.extend(line.spans);
        spans.push(Span::styled(" ".repeat(inner.saturating_sub(used)), fill));
        spans.push(Span::styled(" │", border));
        lines.push(Line::from(spans));
    }
    lines.push(Line::styled(format!("└{}┘", "─".repeat(inner + 2)), border));
    crate::board::view::overlay_lines(frame, area, lines);
    Rect::new(
        area.x + 2,
        area.y + 1,
        area.width.saturating_sub(4),
        area.height.saturating_sub(2),
    )
}

/// One row of a box: `left`, then `right` against the edge, the whole width in `style`.
fn row(left: &str, right: &str, width: usize, style: Style) -> Line<'static> {
    let left = crate::board::view::fit(left, width.saturating_sub(right.width() + 1));
    let gap = width.saturating_sub(left.width() + right.width());
    Line::styled(format!("{left}{}{right}", " ".repeat(gap)), style)
}

fn paint_dialog(frame: &mut ratatui::Frame, app: &App, screen: Rect, dialog: Dialog, name: &str) {
    let look = app.look();
    let (title, text) = match dialog {
        Dialog::Paused => (
            "成員已暫停",
            format!("{name} 收到 Ctrl-Z，已經被暫停。按「恢復」讓它繼續執行。"),
        ),
        Dialog::Ended => (
            "agent 已結束",
            format!(
                "{name} 的 agent 已經結束（{}）。要怎麼繼續？",
                app.framed_term()
                    .and_then(|term| term.ended)
                    .unwrap_or_else(|| "例如按了 Ctrl-C".into())
            ),
        ),
    };
    let choices = dialog_choices(dialog);
    let notice = app.notice.clone().filter(|notice| !notice.is_empty());
    let width = 64.min(screen.width.saturating_sub(2));
    let height = (choices.len() as u16 + 6 + u16::from(notice.is_some())).min(screen.height);
    if width < 24 || height < 6 {
        return;
    }
    let area = Rect::new(
        screen.x + (screen.width - width) / 2,
        screen.y + (screen.height - height) / 2,
        width,
        height,
    );
    let inner = usize::from(width - 4);
    let muted = look.role(Role::Muted);
    let cursor = app.terminal.cursor().min(choices.len() - 1);
    let mut body = vec![row(&text, "", inner, muted), Line::default()];
    for (index, (label, hit, key)) in choices.iter().enumerate() {
        let style = if index == cursor {
            look.selection()
        } else {
            look.role(Role::Text)
        };
        let cap = match (hit, key) {
            (FrameHit::Back, _) => app.member_back_label(),
            (_, Some(letter)) => letter.to_string(),
            _ if index == 0 => "⏎".into(),
            _ => String::new(),
        };
        let mark = if index == cursor { "›" } else { " " };
        body.push(row(
            &format!("{mark} {label}"),
            &format!("{cap} "),
            inner,
            style,
        ));
    }
    if let Some(notice) = &notice {
        body.push(Line::default());
        body.push(row(notice, "", inner, muted));
    }
    let rows = usize::from(height - 2);
    body.resize(rows.saturating_sub(1), Line::default());
    body.push(row(
        "↑↓ 選擇 · ⏎ 確定 · Esc 關閉（資訊列上也可以）",
        "",
        inner,
        muted,
    ));
    let inside = boxed(frame, look, area, title, body);
    for (index, (_, hit, _)) in choices.iter().enumerate() {
        let y = inside.y + 2 + index as u16;
        if y < inside.bottom() {
            app.terminal
                .add_hit(Rect::new(inside.x, y, inside.width, 1), hit.clone());
        }
    }
    app.terminal.add_hit(
        Rect::new(area.right() - 3, area.y, 3, 1),
        FrameHit::Dismiss(dialog),
    );
}

fn paint_menu(frame: &mut ratatui::Frame, app: &App, screen: Rect, menu: FrameMenu, name: &str) {
    let look = app.look();
    let entries = app.menu_entries(menu);
    let title = match menu {
        FrameMenu::Members => "成員".to_owned(),
        FrameMenu::Session => "工作階段".to_owned(),
        FrameMenu::Checklist => format!("Checklist · {name}"),
    };
    let width = 46.min(screen.width);
    let height = (entries.len() as u16 + 3).min(screen.height);
    if width < 8 || height < 3 {
        return;
    }
    let anchor = app
        .terminal
        .menu_anchor(menu)
        .unwrap_or(screen.x)
        .min(screen.right().saturating_sub(width));
    let area = Rect::new(anchor, screen.y, width, height);
    let inner = usize::from(width - 4);
    let cursor = app.terminal.cursor();
    let body = entries
        .iter()
        .enumerate()
        .map(|(index, (label, hit))| {
            let style = match hit {
                None => look.role(Role::Dim),
                Some(_) if index == cursor => look.selection(),
                Some(_) => look.role(Role::Text),
            };
            let mark = if index == cursor { "›" } else { " " };
            row(&format!("{mark} {label}"), "", inner, style)
        })
        .collect();
    let inside = boxed(frame, look, area, &title, body);
    for (index, (_, hit)) in entries.iter().enumerate() {
        let y = inside.y + index as u16;
        if let Some(hit) = hit
            && y < inside.bottom()
        {
            app.terminal
                .add_hit(Rect::new(inside.x, y, inside.width, 1), hit.clone());
        }
    }
}

fn say(buffer: &mut Buffer, area: Rect, text: &str, look: Look) {
    if area.is_empty() {
        return;
    }
    strip::paint_left(
        buffer,
        Rect::new(area.x, area.y, area.width, 1),
        Line::from(Span::styled(
            crate::board::view::fit(text, usize::from(area.width)),
            look.role(Role::Muted),
        )),
    );
}

/// A drag's selection shows as reversed cells, like the terminal's own selection.
fn selection(buffer: &mut Buffer, area: Rect, screen: &Screenful, app: &App) {
    for row in 0..screen.rows.min(area.height) {
        for column in 0..screen.cols.min(area.width) {
            if app.terminal.cell_selected(column, row) {
                buffer[(area.x + column, area.y + row)]
                    .modifier
                    .toggle(Modifier::REVERSED);
            }
        }
    }
}

/// While typing, the real cursor goes where the program's is, shown or hidden as the program has
/// it, when that cell is inside `area`; it then stands in for the reversed cell.
pub(super) fn caret(area: Rect, screen: &Screenful) -> Option<Caret> {
    let (column, row) = screen.caret?;
    (column < area.width && row < area.height).then(|| Caret {
        at: ratatui::layout::Position::new(area.x + column, area.y + row),
        shown: screen.cursor.is_some(),
    })
}

/// Where the program's cursor is, as one reversed cell (not the terminal's own cursor), when the
/// program shows it and the cell is inside `area`. On a cell the program already reversed it
/// shows as the plain cell.
fn cursor(buffer: &mut Buffer, area: Rect, screen: &Screenful) {
    let Some((column, row)) = screen.cursor else {
        return;
    };
    if column < area.width && row < area.height {
        buffer[(area.x + column, area.y + row)]
            .modifier
            .toggle(Modifier::REVERSED);
    }
}

/// The program's cells in `area`: a bigger screen is cut at the edges, a smaller one leaves the
/// rest blank. A wide character that would straddle the edge is not drawn.
pub(in crate::board) fn cells(
    buffer: &mut Buffer,
    area: Rect,
    screen: &Screenful,
    dim: bool,
    look: Look,
) {
    for row in 0..screen.rows.min(area.height) {
        let y = area.y + row;
        let mut column = 0;
        let limit = screen.cols.min(area.width);
        while column < limit {
            let Some(cell) = screen.cell(column, row) else {
                break;
            };
            let width = match cell.occupant {
                Occupant::Wide => 2,
                Occupant::Narrow | Occupant::Continuation => 1,
            };
            if column + width > limit {
                break;
            }
            // Equal neighbours are drawn as one run.
            let mut text = String::new();
            let mut end = column;
            while end < limit {
                let Some(next) = screen.cell(end, row) else {
                    break;
                };
                if next.attr != cell.attr {
                    break;
                }
                let span = match next.occupant {
                    Occupant::Wide => 2,
                    Occupant::Narrow | Occupant::Continuation => 1,
                };
                if end + span > limit {
                    break;
                }
                if next.occupant != Occupant::Continuation {
                    text.push_str(if next.text.is_empty() {
                        " "
                    } else {
                        &next.text
                    });
                }
                end += span;
            }
            let mut style = foreign::style(cell.attr, look.depth);
            if dim {
                style = style.add_modifier(Modifier::DIM);
            }
            buffer.set_string(area.x + column, y, &text, style);
            column = end.max(column + 1);
        }
    }
}
