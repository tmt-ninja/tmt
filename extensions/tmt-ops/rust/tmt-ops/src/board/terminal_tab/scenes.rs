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
    "frame-members-menu",
    "frame-checklist-menu",
];

/// A build with colours, a bold word, a wide character and the cursor on the sixth and last row
/// that fits the pane at 100x36. `你好` is wide-glyph test data, not UI text.
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
    if scene == "frame-members-menu" {
        add_roster(&mut view.home.as_mut().unwrap().workspace.roster);
    }
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
        "frame-members-menu" => {
            app.frame_act(super::tab::FrameHit::Menu(FrameMenu::Members));
        }
        "frame-checklist-menu" => {
            crate::board::conversation_checklist::tests::admit_empty(&mut app);
            let key = app.framed_checklist_key().expect("the framed member's list");
            let now = std::time::Instant::now();
            let task = app.notes.offer(Some(&key), now).expect("a read of that list");
            use crate::checklist::model::Completion::{Complete, Open};
            app.notes.finished(
                crate::board::conversation_checklist::tests::reading_titled(
                    &task,
                    &[
                        ("Fix the startup test", Open),
                        ("Review the lifecycle cleanup", Open),
                        ("Answer the Digest question", Open),
                        ("Rebase on main", Complete),
                        ("Record the oracle", Complete),
                    ],
                ),
                now,
            );
            app.frame_act(super::tab::FrameHit::Menu(FrameMenu::Checklist));
        }
        _ => {}
    }
    app
}

/// Four more members in the fixture's squad, one per state the Members menu marks.
fn add_roster(roster: &mut crate::board::workspace::OpsRoster) {
    use crate::board::{
        activity::{ObservedActivity, Phase},
        workspace::{OpsMember, OpsMembershipState},
    };
    for (n, name, phase, waiting, state) in [
        (1, "reviewer", Phase::Working, true, None),
        (2, "builder", Phase::Working, false, Some("blocked")),
        (3, "planner", Phase::Idle, false, None),
        (4, "scribe", Phase::Ended, false, None),
    ] {
        let id = format!("44444444-4444-4444-8444-44444444440{n}");
        roster.members.insert(
            id.clone(),
            OpsMember {
                id: id.clone(),
                name: name.into(),
                state: state.map(str::to_owned),
                waiting,
                presence: Some(true),
                usage: None,
                activity: ObservedActivity {
                    phase,
                    ..Default::default()
                },
            },
        );
        let squad = &mut roster.squads[0];
        squad.members.push(id.clone());
        squad.member_states.insert(
            id,
            OpsMembershipState {
                state: state.map(str::to_owned),
                waiting,
                rank: None,
                idle_over: false,
            },
        );
    }
}
