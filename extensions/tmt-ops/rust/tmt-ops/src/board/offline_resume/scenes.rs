//! The offline-resume ask for the oracle (#6438): as it opens, while Resume all runs, and with a
//! result on every row. Core is never called; the capture and the answers are injected.
use super::{Captured, Completed, Kind, Task};
use crate::{
    board::app::{App, workspace::tests::board},
    core::SquadError,
};
use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

pub(in crate::board) const SCENES: &[&str] = &[
    "offline-resume-ask",
    "offline-resume-pending",
    "offline-resume-results",
];

const MEMBERS: [(&str, &str, &str); 4] = [
    (
        "11111111-1111-4111-8111-111111111111",
        "core-1",
        "resumable",
    ),
    (
        "22222222-2222-4222-8222-222222222222",
        "night-1",
        "resumable",
    ),
    (
        "33333333-3333-4333-8333-333333333333",
        "gui-2",
        "no_remembered_session",
    ),
    (
        "44444444-4444-4444-8444-444444444444",
        "docs-1",
        "folder_missing",
    ),
];

fn answer(app: &mut App, member: usize, kind: Kind, result: Result<(), SquadError>) {
    app.offline_resume_done(Completed {
        task: Task::Relaunch {
            identity: MEMBERS[member].0.into(),
            kind,
        },
        result: result.map(|()| Vec::new()),
    });
}

fn press(app: &mut App, code: KeyCode) {
    app.key(KeyEvent::new(code, KeyModifiers::NONE));
}

pub(in crate::board) fn capture_case(scene: &str, look: crate::look::Look) -> App {
    let mut app = board();
    let view = app.view.as_mut().unwrap();
    view.look = look;
    // The fixture's squad carries its own look; the scene shows the one asked for.
    view.home.as_mut().unwrap().workspace.squad_looks.clear();
    assert_eq!(app.offline_resume_start(), Some(Task::Preview));
    app.offline_resume_done(Completed {
        task: Task::Preview,
        result: Ok(MEMBERS
            .iter()
            .map(|(identity, name, action)| Captured {
                identity: (*identity).into(),
                name: (*name).into(),
                action: (*action).into(),
            })
            .collect()),
    });
    match scene {
        "offline-resume-ask" => {}
        "offline-resume-pending" => {
            press(&mut app, KeyCode::Char('a'));
            assert!(app.offline_resume_offer().is_some(), "core-1 starts");
        }
        "offline-resume-results" => {
            press(&mut app, KeyCode::Char('a'));
            app.offline_resume_offer();
            answer(&mut app, 0, Kind::Resume, Ok(()));
            app.offline_resume_offer();
            answer(
                &mut app,
                1,
                Kind::Resume,
                Err(SquadError::new(
                    "TERMINAL_RELAUNCH_REFUSED",
                    "night-1 has no recorded folder in the built-in capture; nothing started",
                )),
            );
            press(&mut app, KeyCode::Down);
            press(&mut app, KeyCode::Down);
            press(&mut app, KeyCode::Char('n'));
            app.offline_resume_offer();
            answer(&mut app, 2, Kind::New, Ok(()));
            press(&mut app, KeyCode::Up);
        }
        other => panic!("unknown offline-resume scene {other}"),
    }
    app
}
