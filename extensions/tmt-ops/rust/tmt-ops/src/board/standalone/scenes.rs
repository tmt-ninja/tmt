use super::{App, Completed, Page, Task, json};
use crate::board::{app::Effect, workspace::OpsTarget};
use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

pub(in crate::board) const SCENES: &[&str] = &[
    "run-command",
    "run-command-running",
    "run-command-result",
    "run-command-kept",
    "run-command-moving",
];

const TERMINAL: &str = "00000000-0000-4000-8000-000000000675";

pub(in crate::board) fn press(app: &mut App, code: KeyCode) -> Effect {
    app.key(KeyEvent::new(code, KeyModifiers::NONE))
}

pub(in crate::board) fn result() -> serde_json::Value {
    let ended = crate::status::now_ms().saturating_sub(120_000);
    json!({
        "runId":"00000000-0000-4000-8000-000000006754",
        "terminalId":TERMINAL,
        "revision":1,
        "placement":{"kind":"local"},
        "command":"make test",
        "cwd":"/work/core-ops-spinner",
        "startedMs":ended.saturating_sub(41_000),
        "endedMs":ended,
        "exitCode":0,
        "signal":null,
        "timedOut":false,
        "truncated":false,
        "stdout":"cargo test -p tmt-ops header::spinner\ntest result: ok. 12 passed; 0 failed\n",
        "stderr":""
    })
}

pub(in crate::board) fn capture(scene: &str, look: crate::look::Look) -> App {
    let mut app = crate::board::app::workspace::tests::board();
    let view = app.view.as_mut().expect("fixture view");
    view.look = look;
    view.home
        .as_mut()
        .expect("fixture workspace")
        .workspace
        .squad_looks
        .clear();
    let local = matches!(scene, "run-command-kept" | "run-command-moving");
    if local {
        app.workspace.selected = Some(OpsTarget::Pool);
    }
    app.standalone.launch_directory = Some("/work/core-ops-spinner".into());
    let open = press(&mut app, KeyCode::Char('!'));
    if local {
        assert_eq!(open, Effect::None);
    } else {
        let Effect::Standalone(Task::Target(identity)) = open else {
            panic!("resolve the selected worker");
        };
        app.standalone_completed(Completed::Target(
            identity,
            Ok(json!({
                "cwd":"/work/core-ops-spinner", "bindingId":"00000000-0000-4000-8000-000000006755",
                "paneIncarnation":"fixture",
            })),
        ));
    }
    for ch in "make test".chars() {
        press(&mut app, KeyCode::Char(ch));
    }
    if scene == "run-command" {
        return app;
    }
    let Effect::Standalone(Task::Run(run, _)) = press(&mut app, KeyCode::Enter) else {
        panic!("expected a standalone run");
    };
    if scene == "run-command-running" {
        app.standalone.elapsed.set(12);
        app.standalone.progress(
            run,
            "cargo test -p tmt-ops header::spinner\n   Compiling tmt-ops v0.1.0-dev\n",
            false,
        );
        return app;
    }
    app.standalone_completed(Completed::Run(run, Ok(result())));
    if scene == "run-command-result" {
        return app;
    }
    assert!(matches!(
        press(&mut app, KeyCode::Enter),
        Effect::Standalone(Task::Keep(_))
    ));
    app.standalone_completed(Completed::Keep(Ok(result())));
    let target = OpsTarget::SavedTerminal(TERMINAL.into());
    let index = app
        .workspace_rows()
        .iter()
        .position(|row| row.target == target)
        .expect("kept row");
    app.selected = index;
    app.workspace.selected = Some(target);
    app.workspace_reconcile();
    app.standalone_completed(Completed::Saved(
        Box::new(super::SavedTask::Preview(TERMINAL.into(), 1)),
        Ok(result()),
    ));
    if scene == "run-command-moving" {
        assert_eq!(press(&mut app, KeyCode::Char('m')), Effect::None);
        press(&mut app, KeyCode::Down);
        assert!(app.standalone.moving());
    }
    assert!(!matches!(app.standalone.page, Some(Page::Finished { .. })));
    app
}

#[test]
fn standalone_command_kept_row_opens_retained_output_and_can_move() {
    use super::SavedTask;
    let mut app = capture("run-command-kept", crate::look::Look::default());
    assert!(app.workspace_selected_member().is_none());
    assert_eq!(
        press(&mut app, KeyCode::Enter),
        Effect::Standalone(Task::Saved(SavedTask::Get(TERMINAL.into())))
    );
    app.standalone_completed(Completed::Saved(
        Box::new(SavedTask::Get(TERMINAL.into())),
        Ok(result()),
    ));
    let mut screen = ratatui::Terminal::new(ratatui::backend::TestBackend::new(100, 36)).unwrap();
    screen
        .draw(|frame| {
            crate::board::view::prepare(&mut app, frame.area());
            crate::board::view::render(frame, &app);
        })
        .unwrap();
    let screen = screen.backend().buffer();
    let output = (0..36).any(|y| {
        (0..100)
            .map(|x| screen[(x, y)].symbol())
            .collect::<String>()
            .contains("test result: ok. 12 passed; 0 failed")
    });
    assert!(
        output,
        "the retained stdout is visible in the result dialog"
    );
    assert_eq!(press(&mut app, KeyCode::Esc), Effect::None);

    assert_eq!(press(&mut app, KeyCode::Char('m')), Effect::None);
    press(&mut app, KeyCode::Down);
    let Effect::Standalone(Task::Saved(task @ SavedTask::Move(_, _))) =
        press(&mut app, KeyCode::Enter)
    else {
        panic!("drop must move the saved terminal");
    };
    let mut moved = result();
    moved["revision"] = 2.into();
    moved["placement"] =
        json!({"kind":"room", "roomId": crate::board::app::workspace::tests::ROOM});
    app.standalone_completed(Completed::Saved(Box::new(task), Ok(moved)));
    let rows = app.workspace_rows();
    let saved = rows
        .iter()
        .find(|row| row.target == OpsTarget::SavedTerminal(TERMINAL.into()))
        .expect("moved terminal");
    let room = rows
        .iter()
        .find(|row| {
            row.target == OpsTarget::Squad(crate::board::app::workspace::tests::ROOM.into())
        })
        .expect("destination room");
    assert_eq!(saved.depth, room.depth + 1);
}

#[test]
fn running_output_follows_the_tail_until_scrolled_then_yields_to_the_final_result() {
    let mut app = capture("run-command-running", crate::look::Look::default());
    let mut screen = ratatui::Terminal::new(ratatui::backend::TestBackend::new(100, 36)).unwrap();
    let mut paint = |app: &mut App| {
        screen
            .draw(|frame| {
                crate::board::view::prepare(app, frame.area());
                crate::board::view::render(frame, app);
            })
            .unwrap();
        screen
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>()
    };
    let id = app.standalone.run_id;
    let rows: String = (1..=24)
        .map(|index| format!("live row {index:02}\n"))
        .collect();
    app.standalone.progress(id, &rows, false);
    let tail = paint(&mut app);
    assert!(tail.contains("live row 24"));
    assert!(tail.contains("running 0:12") && tail.contains("Stop"));
    assert!(!tail.contains("Keep in list"));
    press(&mut app, KeyCode::PageUp);
    let scrolled = paint(&mut app);
    assert!(!scrolled.contains("live row 24"));
    app.standalone.progress(id, "live row 25\n", false);
    assert_eq!(paint(&mut app), scrolled);
    app.standalone.progress(id + 1, "stale row\n", false);
    press(&mut app, KeyCode::End);
    let tail = paint(&mut app);
    assert!(tail.contains("live row 25"));
    assert!(!tail.contains("stale row"));
    press(&mut app, KeyCode::PageUp);
    assert!(!paint(&mut app).contains("live row 25"));
    // Output is delivered before the next paint, while the held viewport still
    // has its old end. One page forward must stop at row 25.
    app.standalone.progress(id, "live row 26\n", false);
    press(&mut app, KeyCode::PageDown);
    let advanced = paint(&mut app);
    assert!(advanced.contains("live row 25"));
    assert!(!advanced.contains("live row 26"));
    press(&mut app, KeyCode::Down);
    app.standalone.progress(id, "live row 27\n", false);
    assert!(paint(&mut app).contains("live row 27"));
    app.standalone_completed(Completed::Run(id, Ok(result())));
    let finished = paint(&mut app);
    assert!(finished.contains("Keep in list") && finished.contains("Run again"));
    assert!(finished.contains("test result: ok. 12 passed; 0 failed"));
    assert!(!finished.contains("live row 27"));
}

#[test]
fn standalone_command_form_and_running_screen_show_content_with_their_buttons() {
    for (scene, expected) in [
        (
            "run-command",
            [
                "In  worker",
                "/work/core-ops-spinner",
                "! make test",
                "Cancel",
                "Run",
            ],
        ),
        (
            "run-command-running",
            [
                "running 0:12",
                "/work/core-ops-spinner",
                "! make test",
                "Stop",
                "Compiling tmt-ops",
            ],
        ),
    ] {
        let mut app = capture(scene, crate::look::Look::default());
        let mut screen =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(100, 36)).unwrap();
        screen
            .draw(|frame| {
                crate::board::view::prepare(&mut app, frame.area());
                crate::board::view::render(frame, &app);
            })
            .unwrap();
        let screen = screen.backend().buffer();
        let text: String = (0..36)
            .flat_map(|y| (0..100).map(move |x| screen[(x, y)].symbol()))
            .collect();
        for word in expected {
            assert!(text.contains(word), "{scene} must show {word:?}");
        }
    }
}

#[test]
fn run_window_is_centered_and_escape_leaves_the_run_stoppable() {
    use ratatui::{Terminal, backend::TestBackend};

    let mut app = capture("run-command-running", crate::look::Look::default());
    let mut screen = Terminal::new(TestBackend::new(100, 36)).unwrap();
    screen
        .draw(|frame| app.standalone.render(frame, &app, frame.area()))
        .unwrap();
    let outer = app.standalone.outer();
    assert!(!outer.is_empty());
    assert!(u16::abs_diff(2 * outer.x + outer.width, 100) <= 1);
    assert!(u16::abs_diff(2 * outer.y + outer.height, 36) <= 1);
    let text: String = screen
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect();
    assert!(text.contains("worker · /work/core-ops-spinner"));
    assert!(text.contains("Stop"));

    assert_eq!(press(&mut app, KeyCode::Esc), Effect::None);
    assert!(!app.standalone.shown());
    assert!(app.standalone.running());
    assert_eq!(press(&mut app, KeyCode::Char('!')), Effect::None);
    assert!(app.standalone.shown());
    assert_eq!(
        app.key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL)),
        Effect::Standalone(Task::Stop)
    );
}

#[test]
fn run_window_result_reports_exit_and_duration_and_defaults_to_close() {
    use ratatui::{Terminal, backend::TestBackend};

    for close in [KeyCode::Enter, KeyCode::Esc] {
        let mut app = capture("run-command-result", crate::look::Look::default());
        let mut screen = Terminal::new(TestBackend::new(100, 36)).unwrap();
        screen
            .draw(|frame| app.standalone.render(frame, &app, frame.area()))
            .unwrap();
        let text: String = screen
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect();
        for expected in ["✓ exited 0 after 41s", "Keep in list", "Run again", "Close"] {
            assert!(text.contains(expected), "missing {expected:?}");
        }

        assert_eq!(
            press(&mut app, close),
            Effect::Standalone(Task::Discard),
            "{close:?} closes the finished run"
        );
        assert!(!app.standalone.shown());
        assert!(app.standalone.page.is_none());
    }
}

#[test]
fn standalone_command_follows_a_pool_member_into_its_visible_squad() {
    use crate::board::app::workspace::tests::{MEMBER, ROOM};
    let mut app = capture("run-command-kept", crate::look::Look::default());
    let mut moved_member = result();
    moved_member["placement"] = json!({"kind":"member", "identityId":MEMBER, "roomId":null});
    app.standalone_completed(Completed::Keep(Ok(moved_member)));
    let rows = app.workspace_rows();
    let parent = OpsTarget::Member {
        room_id: Some(ROOM.into()),
        identity_id: MEMBER.into(),
    };
    let member = rows
        .iter()
        .position(|row| row.target == parent)
        .expect("visible member");
    assert_eq!(
        rows[member + 1].target,
        OpsTarget::SavedTerminal(TERMINAL.into())
    );
    assert_eq!(rows[member + 1].depth, rows[member].depth + 1);
    assert!(
        rows.iter()
            .all(|row| row.target != OpsTarget::LocalTerminals)
    );
}
