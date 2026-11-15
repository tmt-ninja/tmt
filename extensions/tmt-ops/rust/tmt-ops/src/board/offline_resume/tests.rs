use super::*;
use crate::board::app::{Overlay, workspace::tests::board};
use ratatui::crossterm::event::{KeyEvent, KeyModifiers};

const CORE: &str = "11111111-1111-4111-8111-111111111111";
const NIGHT: &str = "22222222-2222-4222-8222-222222222222";
const GUI: &str = "33333333-3333-4333-8333-333333333333";
const DOCS: &str = "44444444-4444-4444-8444-444444444444";
const LIVE: &str = "55555555-5555-4555-8555-555555555555";

fn member(identity: &str, name: &str, action: &str) -> Captured {
    Captured {
        identity: identity.into(),
        name: name.into(),
        action: action.into(),
    }
}

/// A board whose capture read answered with these members.
fn captured(members: Vec<Captured>) -> App {
    let mut app = board();
    assert_eq!(app.offline_resume_start(), Some(Task::Preview));
    app.offline_resume_done(Completed {
        task: Task::Preview,
        result: Ok(members),
    });
    app
}

fn opened() -> App {
    captured(vec![
        member(CORE, "core-1", "resumable"),
        member(NIGHT, "night-1", "stale_requires_retry"),
        member(GUI, "gui-2", "no_remembered_session"),
        member(DOCS, "docs-1", "folder_missing"),
        member(LIVE, "live-1", "live"),
    ])
}

fn press(app: &mut App, code: KeyCode) -> Effect {
    app.key(KeyEvent::new(code, KeyModifiers::NONE))
}

fn screen(app: &App, width: u16) -> String {
    let mut terminal =
        ratatui::Terminal::new(ratatui::backend::TestBackend::new(width, 30)).unwrap();
    terminal
        .draw(|frame| crate::board::view::render(frame, app))
        .unwrap();
    let buffer = terminal.backend().buffer();
    (0..buffer.area.height)
        .map(|y| {
            (0..buffer.area.width)
                .map(|x| buffer[(x, y)].symbol())
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn answer(app: &mut App, identity: &str, kind: Kind, result: Result<(), SquadError>) {
    app.offline_resume_done(Completed {
        task: Task::Relaunch {
            identity: identity.into(),
            kind,
        },
        result: result.map(|()| Vec::new()),
    });
}

fn now(app: &App, identity: &str) -> Option<Now> {
    app.offline_resume
        .dialog
        .as_ref()?
        .rows
        .iter()
        .find(|row| row.member.identity == identity)
        .map(|row| row.now.clone())
}

#[test]
fn the_offline_resume_dialog_follows_the_close_rule() {
    crate::board::home::tests::dialog_dismiss::assert_close_rule(
        &mut opened(),
        &mut opened(),
        Overlay::OfflineResume,
    );
}

#[test]
fn it_lists_only_the_offline_members_the_capture_names() {
    let app = opened();
    assert_eq!(app.overlay(), Some(Overlay::OfflineResume));
    let text = screen(&app, 120);
    for name in ["core-1", "night-1", "gui-2", "docs-1"] {
        assert!(text.contains(name), "{name} is listed:\n{text}");
    }
    assert!(!text.contains("live-1"), "a running member is not:\n{text}");
    assert!(text.contains("folder missing"), "{text}");
}

#[test]
fn no_offline_member_or_a_failed_read_asks_nothing_and_the_read_is_once() {
    let app = captured(vec![member(LIVE, "live-1", "live")]);
    assert_eq!(app.overlay(), None);

    let mut app = board();
    assert_eq!(app.offline_resume_start(), Some(Task::Preview));
    app.offline_resume_done(Completed {
        task: Task::Preview,
        result: Err(SquadError::new("WORKSPACE_SNAPSHOT_NOT_FOUND", "none")),
    });
    assert_eq!(app.overlay(), None);
    assert_eq!(app.offline_resume_start(), None, "never read again");

    let mut app = opened();
    press(&mut app, KeyCode::Esc);
    assert_eq!(app.overlay(), None, "Esc is Not now");
    assert_eq!(
        app.offline_resume_start(),
        None,
        "and it does not ask again"
    );
}

#[test]
fn enter_resumes_and_the_row_waits_for_core_without_holding_the_board() {
    let mut app = opened();
    press(&mut app, KeyCode::Enter);
    assert_eq!(
        app.offline_resume_offer(),
        Some(Task::Relaunch {
            identity: CORE.into(),
            kind: Kind::Resume
        })
    );
    assert!(screen(&app, 120).contains("Resuming…"));
    assert_eq!(app.offline_resume_offer(), None, "one relaunch at a time");
    answer(&mut app, CORE, Kind::Resume, Ok(()));
    assert!(screen(&app, 120).contains("✓ Resumed"));
}

#[test]
fn each_row_offers_only_what_its_action_allows() {
    let mut app = opened();
    // gui-2 has no session to resume: Enter does nothing, n starts a new one.
    press(&mut app, KeyCode::Down);
    press(&mut app, KeyCode::Down);
    press(&mut app, KeyCode::Enter);
    assert_eq!(now(&app, GUI), Some(Now::Idle));
    press(&mut app, KeyCode::Char('n'));
    assert_eq!(now(&app, GUI), Some(Now::Queued(Kind::New)));
    // docs-1 has no folder: nothing starts it.
    press(&mut app, KeyCode::Down);
    press(&mut app, KeyCode::Enter);
    press(&mut app, KeyCode::Char('n'));
    assert_eq!(now(&app, DOCS), Some(Now::Idle));
}

#[test]
fn resume_all_keeps_a_result_per_row() {
    let mut app = opened();
    press(&mut app, KeyCode::Char('a'));
    assert_eq!(now(&app, GUI), Some(Now::Idle), "no session: skipped");
    assert_eq!(now(&app, DOCS), Some(Now::Idle), "no folder: skipped");
    let Some(Task::Relaunch { identity, .. }) = app.offline_resume_offer() else {
        panic!("the first row starts");
    };
    assert_eq!(identity, CORE);
    assert_eq!(now(&app, NIGHT), Some(Now::Queued(Kind::Resume)));
    let pending = screen(&app, 120);
    assert!(
        !pending.contains("a resume all"),
        "no second batch while one runs:\n{pending}"
    );
    answer(&mut app, CORE, Kind::Resume, Ok(()));
    assert!(
        matches!(app.offline_resume_offer(), Some(Task::Relaunch { identity, .. }) if identity == NIGHT)
    );
    answer(
        &mut app,
        NIGHT,
        Kind::Resume,
        Err(SquadError::new(
            "TERMINAL_RELAUNCH_REFUSED",
            "no recorded folder for night-1",
        )),
    );
    let text = screen(&app, 120);
    assert!(text.contains("✓ Resumed"), "{text}");
    assert!(text.contains("✗ no recorded folder for night-1"), "{text}");
    // The refused row is Core's answer: neither key starts it again.
    press(&mut app, KeyCode::Down);
    let text = screen(&app, 120);
    assert!(
        !text.contains("⏎ resume") && !text.contains("n new session"),
        "{text}"
    );
    press(&mut app, KeyCode::Enter);
    assert!(matches!(now(&app, NIGHT), Some(Now::Failed(_))));
}

#[test]
fn a_long_refusal_wraps_whole_under_its_reason_at_60_columns() {
    let mut app = opened();
    press(&mut app, KeyCode::Enter);
    app.offline_resume_offer();
    let message = "core-1 has no recorded folder in the built-in capture; nothing started";
    answer(
        &mut app,
        CORE,
        Kind::Resume,
        Err(SquadError::new("TERMINAL_RELAUNCH_REFUSED", message)),
    );
    let text = screen(&app, 60);
    assert!(
        !text
            .lines()
            .any(|line| line.starts_with('│') && line.contains('…')),
        "{text}"
    );
    let words: String = text
        .lines()
        .filter(|line| line.contains("✗") || line.starts_with("│              "))
        .flat_map(|line| {
            line.trim_matches(|c| c == '│' || c == ' ')
                .split_whitespace()
        })
        .collect::<Vec<_>>()
        .join(" ");
    assert!(words.contains(message), "{words}\n{text}");
}

#[test]
fn a_member_core_cannot_relaunch_here_leaves_the_list() {
    let mut app = opened();
    press(&mut app, KeyCode::Enter);
    app.offline_resume_offer();
    answer(
        &mut app,
        CORE,
        Kind::Resume,
        Err(SquadError::new(
            "TERMINAL_RELAUNCH_UNSUPPORTED",
            "another host",
        )),
    );
    assert_eq!(now(&app, CORE), None);
    assert!(!screen(&app, 120).contains("core-1"));
}

#[test]
fn a_hidden_dialog_keeps_its_results_and_enter_on_the_row_reopens_it() {
    let mut app = opened();
    press(&mut app, KeyCode::Enter);
    app.offline_resume_offer();
    press(&mut app, KeyCode::Esc);
    answer(&mut app, CORE, Kind::Resume, Ok(()));
    assert_eq!(now(&app, CORE), Some(Now::Done(Kind::Resume)));
    assert_eq!(app.offline_resume_row(NIGHT), Some(Effect::None));
    assert_eq!(app.overlay(), Some(Overlay::OfflineResume));
    assert_eq!(app.offline_resume_row(LIVE), None, "not captured: as today");
}

#[test]
fn a_narrow_dialog_keeps_esc_among_its_keys() {
    let app = opened();
    let text = screen(&app, 60);
    assert!(text.contains("esc not now"), "{text}");
}

/// The fixture's member, offline after a reboot, as the capture names it.
fn offline_member(action: &str) -> App {
    let mut app = board();
    let target = app
        .workspace
        .selected
        .clone()
        .expect("the fixture's member");
    let view = app.view.as_mut().unwrap();
    let row = view
        .home
        .as_mut()
        .unwrap()
        .workspace
        .rows
        .get_mut(&target)
        .unwrap();
    row["presence"] = "offline".into();
    let identity = row["id"].as_str().unwrap().to_owned();
    assert_eq!(app.offline_resume_start(), Some(Task::Preview));
    app.offline_resume_done(Completed {
        task: Task::Preview,
        result: Ok(vec![member(&identity, "worker", action)]),
    });
    press(&mut app, KeyCode::Esc);
    app
}

#[test]
fn talk_still_queues_to_a_captured_offline_member_and_j_reopens_only_what_can_start() {
    let mut app = offline_member("resumable");
    press(&mut app, KeyCode::Enter);
    assert_ne!(app.overlay(), Some(Overlay::OfflineResume));
    assert!(app.input.is_some(), "Enter opens the composer, as before");

    let mut app = offline_member("resumable");
    press(&mut app, KeyCode::Char('j'));
    assert_eq!(
        app.overlay(),
        Some(Overlay::OfflineResume),
        "j offers the relaunch"
    );

    // A refused row is Core's answer: j goes on to what it does today.
    let mut app = offline_member("resumable");
    let identity = app.offline_resume.dialog.as_ref().unwrap().rows[0]
        .member
        .identity
        .clone();
    app.offline_resume_row(&identity);
    press(&mut app, KeyCode::Enter);
    app.offline_resume_offer();
    answer(
        &mut app,
        &identity,
        Kind::Resume,
        Err(SquadError::new(
            "TERMINAL_RELAUNCH_REFUSED",
            "no recorded folder",
        )),
    );
    press(&mut app, KeyCode::Esc);
    press(&mut app, KeyCode::Char('j'));
    assert_ne!(app.overlay(), Some(Overlay::OfflineResume));

    let mut app = offline_member("folder_missing");
    press(&mut app, KeyCode::Char('j'));
    assert_ne!(app.overlay(), Some(Overlay::OfflineResume));
}
