//! The member frame for the oracle (#5989): a built-in-host member whose published screen is
//! injected, so no socket is involved.
use super::{
    discovery::{Located, MemberTerm},
    stream::StreamEvent,
    tab::{
        FrameMenu,
        tests::{address, built_in, tab},
    },
};
use crate::board::app::{
    App,
    workspace::tests::{MEMBER, board},
};
use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use std::sync::Arc;
use tmt_tui::components::terminal::Screen;

pub(in crate::board) const SCENES: &[&str] = &[
    "frame-connecting",
    "frame-live",
    "frame-reconnecting",
    "frame-paused",
    "frame-ended",
    "frame-ended-dismissed",
    "frame-shell",
    "frame-session-menu",
];

/// A build with colours, a bold word, a wide character and the cursor on the sixth and last row
/// that fits the pane at 100x36.
fn program() -> Arc<tmt_tui::components::terminal::Frame> {
    let mut screen = Screen::new(48, 8);
    screen.feed(
        "\u{1b}[1m$ cargo test\u{1b}[0m\r\n\
         \u{1b}[32m   Compiling\u{1b}[0m tmt-ops v0.1.0\r\n\
         \u{1b}[33mwarning\u{1b}[0m: 你好 \u{1b}[31merror[E0308]\u{1b}[0m\r\n\
         \u{1b}[7m running 3 tests \u{1b}[0m\r\n\
         test a ... \u{1b}[32mok\u{1b}[0m\r\n\
         $ "
        .as_bytes(),
    );
    Arc::new(screen.frame())
}

pub(in crate::board) fn capture_case(scene: &str, look: crate::look::Look) -> App {
    let mut app = built_in(board());
    let view = app.view.as_mut().unwrap();
    view.look = look;
    view.home.as_mut().unwrap().workspace.squad_looks.clear();
    app.terminal = tab().0;
    app.focus = 0;
    app.key(KeyEvent::new(KeyCode::Char('j'), KeyModifiers::NONE));
    assert!(app.framed(), "j opens the frame");
    let term = MemberTerm {
        paused: scene == "frame-paused",
        ended: matches!(scene, "frame-ended" | "frame-ended-dismissed")
            .then(|| "exit 101".to_owned()),
        shell: scene == "frame-shell",
    };
    app.apply_terminal_located(MEMBER, Located::Stream(address("oracle"), term));
    assert!(app.terminal_sync());
    let events: &[StreamEvent] = &match scene {
        "frame-connecting" => vec![],
        "frame-reconnecting" => vec![
            StreamEvent::Screen(program()),
            StreamEvent::Connecting { attempt: 2 },
        ],
        _ => vec![StreamEvent::Screen(program())],
    };
    for event in events {
        app.apply_terminal(1, event.clone());
    }
    match scene {
        "frame-ended-dismissed" => {
            app.key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        }
        "frame-session-menu" => app.terminal.set_menu(Some(FrameMenu::Session)),
        _ => {}
    }
    app
}
