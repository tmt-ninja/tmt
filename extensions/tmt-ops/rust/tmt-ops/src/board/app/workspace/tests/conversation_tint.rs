//! The agent whose conversation has focus gets its own row tint and a bold name, on the Squads tree and the flat Agents list.
use super::*;
use crate::board::shell::OpsTab;
use ratatui::{Terminal, backend::TestBackend, buffer::Buffer, style::Modifier};

fn draw(app: &App) -> Buffer {
    let mut terminal = Terminal::new(TestBackend::new(120, 30)).unwrap();
    terminal
        .draw(|frame| crate::board::view::render(frame, app))
        .unwrap();
    terminal.backend().buffer().clone()
}

/// The row whose first word is the member's name, as its y.
fn member_row(buffer: &Buffer) -> u16 {
    (0..buffer.area.height)
        .find(|&y| {
            let line: String = (0..buffer.area.width)
                .map(|x| buffer[(x, y)].symbol())
                .collect();
            line.trim_start().starts_with("├ worker")
                || line.trim_start().starts_with("└ worker")
                || line.trim_start().starts_with("worker")
        })
        .expect("the member's row is drawn")
}

/// The row in conversation has the tint where the terminal draws backgrounds, and otherwise stays
/// reverse video (the bold name, checked by the callers, tells it from the plain selection).
fn tinted(look: &crate::look::Look, plain: &Buffer, py: u16, engaged: &Buffer, ey: u16) {
    match look.role(tmt_cli_style::Role::Conversation).bg {
        Some(tint) => {
            assert_eq!(engaged[(1, ey)].bg, tint);
            assert_ne!(plain[(1, py)].bg, tint);
        }
        None => assert!(engaged[(1, ey)].modifier.contains(Modifier::REVERSED)),
    }
}

fn name_x(buffer: &Buffer, y: u16) -> u16 {
    let line: Vec<&str> = (0..buffer.area.width)
        .map(|x| buffer[(x, y)].symbol())
        .collect();
    line.windows(6)
        .position(|window| window.concat() == "worker")
        .expect("the name is on its row") as u16
}

fn conversation_focused(tab: OpsTab) -> (App, App) {
    let mut rows = board();
    rows.shell.tab = tab;
    let mut conversation = board();
    conversation.shell.tab = tab;
    conversation.focus = 1;
    assert_eq!(conversation.focused(), crate::config::Pane::Replies);
    (rows, conversation)
}

#[test]
fn the_squads_tree_tints_the_row_in_conversation_and_bolds_its_name() {
    let (rows, conversation) = conversation_focused(OpsTab::Agents);
    let look = rows.look();
    let plain = draw(&rows);
    let engaged = draw(&conversation);
    let (py, ey) = (member_row(&plain), member_row(&engaged));
    tinted(&look, &plain, py, &engaged, ey);
    let name = name_x(&engaged, ey);
    assert!(engaged[(name, ey)].modifier.contains(Modifier::BOLD));
    assert!(
        !plain[(name_x(&plain, py), py)]
            .modifier
            .contains(Modifier::BOLD)
    );
}

#[test]
fn the_flat_agents_list_does_the_same() {
    let (mut rows, mut conversation) = conversation_focused(OpsTab::Agents);
    for app in [&mut rows, &mut conversation] {
        app.overview_rows.borrow_mut().clear();
    }
    let look = rows.look();
    let plain = draw(&rows);
    let engaged = draw(&conversation);
    let ey = member_row(&engaged);
    tinted(&look, &plain, member_row(&plain), &engaged, ey);
    let name = name_x(&engaged, ey);
    assert!(engaged[(name, ey)].modifier.contains(Modifier::BOLD));
}

#[test]
fn working_and_idle_rows_keep_their_distinct_styles_in_all_looks() {
    use crate::board::activity::Phase;
    use tmt_cli_style::{Base, Depth, Role, Theme};
    for (base, depth) in [
        (Base::Tmt, Depth::TrueColor),
        (Base::TmtLight, Depth::TrueColor),
        (Base::Terminal, Depth::Ansi16),
        (Base::Tmt, Depth::None),
    ] {
        let mut app = board();
        let look = crate::look::Look {
            theme: Theme::new(base),
            depth,
        };
        let view = app.view.as_mut().unwrap();
        view.look = look;
        let workspace = &mut view.home.as_mut().unwrap().workspace;
        for saved in workspace.squad_looks.values_mut() {
            *saved = look;
        }
        app.workspace.selected = None;
        app.overview_rows.borrow_mut().clear();
        let working = draw(&app);
        let y = member_row(&working);
        let x = name_x(&working, y);
        assert_eq!(
            working[(x, y)].fg,
            look.role(Role::Text).fg.unwrap_or_default()
        );
        let dot = (x..working.area.width)
            .find(|&x| working[(x, y)].symbol() == "●")
            .unwrap();
        assert_eq!(
            working[(dot, y)].fg,
            look.role(Role::Working).fg.unwrap_or_default()
        );
        let workspace = &mut app.view.as_mut().unwrap().home.as_mut().unwrap().workspace;
        workspace
            .roster
            .members
            .get_mut(MEMBER)
            .unwrap()
            .activity
            .phase = Phase::Idle;
        workspace.roster.squads[0]
            .member_states
            .get_mut(MEMBER)
            .unwrap()
            .state = Some("idle".into());
        app.overview_rows.borrow_mut().clear();
        let idle = draw(&app);
        let y = member_row(&idle);
        assert_eq!(
            idle[(name_x(&idle, y), y)].fg,
            look.role(Role::Dim).fg.unwrap_or_default()
        );
    }
}
