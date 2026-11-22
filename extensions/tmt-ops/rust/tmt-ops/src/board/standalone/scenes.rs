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
    json!({
        "runId":"00000000-0000-4000-8000-000000006754",
        "terminalId":TERMINAL,
        "revision":1,
        "placement":{"kind":"local"},
        "command":"make test",
        "cwd":"/work/core-ops-spinner",
        "startedMs":1_000,
        "endedMs":42_000,
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
    app.workspace.selected = Some(OpsTarget::Pool);
    app.standalone.launch_directory = Some("/work/core-ops-spinner".into());
    assert_eq!(press(&mut app, KeyCode::Char('!')), Effect::None);
    for ch in "make test".chars() {
        press(&mut app, KeyCode::Char(ch));
    }
    if scene == "run-command" {
        return app;
    }
    assert!(matches!(
        press(&mut app, KeyCode::Enter),
        Effect::Standalone(Task::Run(_))
    ));
    if scene == "run-command-running" {
        return app;
    }
    app.standalone_completed(Completed::Run(Ok(result())));
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
        SavedTask::Get(TERMINAL.into()),
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
    app.standalone_completed(Completed::Saved(task, Ok(moved)));
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
