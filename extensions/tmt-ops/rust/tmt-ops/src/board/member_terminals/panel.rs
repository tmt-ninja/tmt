//! The right panel while a terminal row is selected (#5991, mock 8): the title rule
//! `member · Terminal N · directory`, a status line `shell · running · cols×rows`, the terminal
//! itself, live, and one footer line. `⏎` types into it here; `j` shows it full screen.
use crate::board::{
    app::App,
    section_rule,
    terminal_tab::{paint, tab::Condition},
    workspace::OpsTarget,
};
use ratatui::{Frame, layout::Rect, text::Line};
use tmt_cli_style::Role;
use tmt_tui::components::strip;

pub(in crate::board) fn render(frame: &mut Frame, app: &App, area: Rect) {
    let look = app.look();
    let Some((identity, row)) = app.selected_terminal() else {
        return;
    };
    if area.height < 4 {
        return;
    }
    let member = app
        .workspace_snapshot()
        .and_then(|snapshot| snapshot.roster.members.get(identity))
        .map_or_else(|| "agent".to_owned(), |member| member.name.clone());
    let mut title = format!("{member} · {}", row.title());
    if let Some(directory) = directory(app, identity) {
        title.push_str(" · ");
        title.push_str(&directory);
    }
    let typing = app.terminals.typing() == Some(row.id.as_str());
    section_rule::paint(
        frame.buffer_mut(),
        Rect { height: 1, ..area },
        &title,
        Line::default(),
        typing,
        look,
    );
    let screen_area = Rect::new(area.x, area.y + 2, area.width, area.height - 3);
    let status = Rect::new(area.x, area.y + 1, area.width, 1);
    let footer = Rect::new(area.x, area.bottom() - 1, area.width, 1);
    // The shell's name comes from Core's listing, never from this process's `$SHELL`;
    // without one the line names what it is.
    let state = if row.ended { "ended" } else { "running" };
    let shell = row.shell.as_deref().unwrap_or("shell");
    muted(
        frame,
        status,
        &format!(
            " {shell} · {state} · {}×{}",
            screen_area.width, screen_area.height
        ),
        app,
    );
    let view = (!row.ended).then(|| app.terminal.view(&row.id)).flatten();
    if !row.ended {
        app.terminal.drew(screen_area);
    }
    let buffer = frame.buffer_mut();
    match view.and_then(|view| view.screen.as_deref()) {
        Some(screen) => {
            let live = view.is_some_and(|view| view.condition == Condition::Live);
            paint::cells(buffer, screen_area, screen, !live, look);
            if typing && live {
                let caret = paint::caret(screen_area, screen);
                app.terminal.place_caret(caret);
                if caret.is_none() {
                    paint::cursor(buffer, screen_area, screen);
                }
            }
        }
        None => {
            let text = if row.ended {
                format!(" {} ended.", row.title())
            } else {
                format!(" Connecting to {}…", row.title())
            };
            strip::paint_left(
                buffer,
                Rect {
                    height: 1,
                    ..screen_area
                },
                Line::styled(text, look.role(Role::Muted)),
            );
        }
    }
    let back = app.member_back_label();
    let words = match (row.ended, typing) {
        (true, _) => format!(" {} ended · x removes it", row.title()),
        (false, true) => format!(" Typing into {} · {back} back to list", row.title()),
        (false, false) => format!(" {} live · ⏎ type in · j full screen", row.title()),
    };
    muted(frame, footer, &words, app);
}

fn muted(frame: &mut Frame, area: Rect, text: &str, app: &App) {
    strip::paint_left(
        frame.buffer_mut(),
        area,
        Line::styled(
            crate::board::view::fit(text, usize::from(area.width)),
            app.look().role(Role::Muted),
        ),
    );
}

/// The member's working directory as the board last read it, with the home folder as `~`.
fn directory(app: &App, identity: &str) -> Option<String> {
    let snapshot = app.workspace_snapshot()?;
    let cwd = snapshot.rows.iter().find_map(|(target, row)| {
        matches!(target, OpsTarget::Member { identity_id, .. } if identity_id == identity)
            .then(|| row["pane"]["cwd"].as_str())
            .flatten()
    })?;
    let home = std::env::var("HOME").ok().filter(|home| !home.is_empty());
    Some(
        match home.as_deref().and_then(|home| cwd.strip_prefix(home)) {
            Some(rest) if rest.is_empty() || rest.starts_with('/') => format!("~{rest}"),
            _ => cwd.to_owned(),
        },
    )
}
