//! A member's terminals for the oracle (#5991, mocks 8 and 9): the fixture's built-in member with
//! one idle and one busy terminal listed, the first selected with its screen injected, and the
//! close confirm of the busy one. No socket is involved.
use super::{Completed, List, Listed};
use crate::board::{
    app::{
        App,
        workspace::tests::{MEMBER, board},
    },
    terminal_tab::{
        stream::StreamEvent,
        tab::tests::{built_in, tab},
    },
};
use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use std::{path::PathBuf, sync::Arc};
use tmt_tui::components::terminal::Screen;

pub(in crate::board) const SCENES: &[&str] = &[
    "terminals-panel",
    "terminals-panel-focused",
    "terminals-panel-selected",
    "terminals-panel-switching",
    "terminals-close-confirm",
    "terminals-row-roles",
];

fn listed(n: u8, busy: bool) -> Listed {
    Listed {
        id: format!("term_{}", format!("{n:02x}").repeat(16)),
        socket: PathBuf::from(format!("/nonexistent/tmt-terminal/term_{n}.sock")),
        busy,
        created_ms: u64::from(n),
        shell: Some("zsh".into()),
        program: busy.then(|| "cargo".into()),
    }
}

pub(in crate::board) fn listed_rows(app: &mut App) {
    app.terminals.finished(
        Completed::Listed(vec![(
            MEMBER.into(),
            List::Terminals(vec![listed(1, false), listed(2, true)]),
        )]),
        0,
    );
}

/// A shell that ran `git status` and a passing test, as mock 8 shows.
fn shell() -> Arc<tmt_tui::components::terminal::Frame> {
    let mut screen = Screen::new(62, 12);
    screen.feed(
        "\u{1b}[36mcore-ops-spinner\u{1b}[0m \u{276f} git status\r\n\
         On branch fix/spinner\r\n\
         \u{1b}[31m        modified:   src/board/header/spinner.rs\u{1b}[0m\r\n\
         \u{1b}[36mcore-ops-spinner\u{1b}[0m \u{276f} cargo test -p tmt-ops header::spinner\r\n\
         \u{1b}[32m    Finished\u{1b}[0m `test` profile [unoptimized] in 8.41s\r\n\
         test result: \u{1b}[32mok\u{1b}[0m. 12 passed; 0 failed\r\n\
         \u{1b}[36mcore-ops-spinner\u{1b}[0m \u{276f} "
            .as_bytes(),
    );
    Arc::new(screen.frame())
}

/// A build still running, as mock 9 shows under the confirm.
fn building() -> Arc<tmt_tui::components::terminal::Frame> {
    let mut screen = Screen::new(62, 12);
    screen.feed(
        "\u{1b}[36mcore-ops-spinner\u{1b}[0m \u{276f} cargo build -p tmt-ops\r\n\
         \u{1b}[32m   Compiling\u{1b}[0m tmt-tui v0.42.0\r\n\
         \u{1b}[32m   Compiling\u{1b}[0m tmt-ops v0.42.0\r\n\
         \u{1b}[36m    Building\u{1b}[0m [=======>   ] 371/398: tmt-ops"
            .as_bytes(),
    );
    Arc::new(screen.frame())
}

pub(in crate::board) fn capture_case(scene: &str, look: crate::look::Look) -> App {
    let mut app = built_in(board());
    let target = app
        .workspace
        .selected
        .clone()
        .expect("the fixture's member");
    let view = app.view.as_mut().unwrap();
    view.look = look;
    let workspace = &mut view.home.as_mut().unwrap().workspace;
    workspace.squad_looks.clear();
    workspace.rows.get_mut(&target).unwrap()["pane"]["cwd"] = "/work/core-ops-spinner".into();
    app.terminal = tab().0;
    app.focus = 0;
    listed_rows(&mut app);
    if scene == "terminals-row-roles" {
        app.terminals.finished(
            Completed::Listed(vec![(
                MEMBER.into(),
                List::Terminals(vec![listed(1, false)]),
            )]),
            0,
        );
    }
    let pick = if scene == "terminals-close-confirm" {
        2
    } else {
        1
    };
    app.workspace.selected = super::target(&target, &listed(pick, false).id);
    assert!(
        app.selected_terminal().is_some(),
        "the terminal row is selected"
    );
    assert!(app.terminal_sync(), "the selected terminal's stream opens");
    if scene != "terminals-close-confirm" {
        app.apply_terminal(1, StreamEvent::Screen(shell()));
        if scene == "terminals-panel-switching" {
            app.workspace.selected = super::target(&target, &listed(2, true).id);
            assert!(app.terminal_sync(), "Terminal 2 replaces the old stream");
        }
        if scene == "terminals-panel-focused" {
            app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        }
    } else {
        app.apply_terminal(1, StreamEvent::Screen(building()));
        app.key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE));
    }
    app
}

/// Capture an actual drag over the rendered screen at the oracle's dimensions.
pub(in crate::board) fn capture_at(
    scene: &str,
    look: crate::look::Look,
    width: u16,
    height: u16,
) -> App {
    let mut app = capture_case(scene, look);
    if scene != "terminals-panel-selected" {
        return app;
    }
    let mut terminal =
        ratatui::Terminal::new(ratatui::backend::TestBackend::new(width, height)).unwrap();
    terminal
        .draw(|frame| {
            crate::board::view::prepare(&mut app, frame.area());
            crate::board::view::render(frame, &app);
        })
        .unwrap();
    let buffer = terminal.backend().buffer();
    let (x, y) = (0..height)
        .find_map(|y| {
            (0..width)
                .find(|x| {
                    let text: String = (*x..width).map(|x| buffer[(x, y)].symbol()).collect();
                    text.starts_with("On branch")
                })
                .map(|x| (x, y))
        })
        .expect("terminal fixture has a visible branch line");
    use ratatui::crossterm::event::{MouseButton, MouseEvent, MouseEventKind};
    let now = std::time::Instant::now();
    for (kind, column) in [
        (MouseEventKind::Down(MouseButton::Left), x),
        (MouseEventKind::Drag(MouseButton::Left), x + 9),
        (MouseEventKind::Up(MouseButton::Left), x + 9),
    ] {
        app.mouse(
            MouseEvent {
                kind,
                column,
                row: y,
                modifiers: KeyModifiers::NONE,
            },
            now,
        );
    }
    app
}
