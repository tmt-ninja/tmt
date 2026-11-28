use super::{App, Completed, Page, Task, Value, json, result_message};
use crate::board::{
    app::{Effect, Request},
    workspace::OpsTarget,
};
use ratatui::crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};

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
        let Effect::Standalone(Task::Target(generation, identity)) = open else {
            panic!("resolve the selected worker");
        };
        app.standalone_completed(Completed::Target(
            generation,
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

pub(in crate::board) fn capture_talk_run(state: &str, look: crate::look::Look, width: u16) -> App {
    let mut app = crate::board::app::workspace::tests::board();
    let view = app.view.as_mut().expect("fixture view");
    view.look = look;
    view.home
        .as_mut()
        .expect("fixture workspace")
        .workspace
        .squad_looks
        .clear();
    app.focus_composer();
    let draft = if width == 100 { "！！pwd" } else { "!pwd" };
    app.input.as_mut().expect("Talk composer").text = draft.into();
    if state == "talk-run-marker" {
        return app;
    }

    let Effect::Standalone(Task::Target(generation, identity)) = press(&mut app, KeyCode::Enter)
    else {
        panic!("Talk must resolve the member before running");
    };
    let effect = app.standalone_completed(Completed::Target(
        generation,
        identity.clone(),
        Ok(json!({
            "cwd":"/work/core-ops-spinner",
            "bindingId":"00000000-0000-4000-8000-000000006755",
            "paneIncarnation":"fixture",
        })),
    ));
    let Effect::Standalone(Task::Run(run, request)) = effect else {
        panic!("the matching member must start the submitted command");
    };
    assert_eq!(request["target"]["identityId"], identity.as_str());
    assert_eq!(request["target"]["cwd"], "/work/core-ops-spinner");
    assert_eq!(request["command"], "pwd");
    app.standalone.elapsed.set(12);
    app.standalone
        .progress(run, "/work/core-ops-spinner\n", false, false);
    if state == "talk-run-running" {
        return app;
    }
    let mut finished = result();
    finished["command"] = "pwd".into();
    finished["stdout"] = "/work/core-ops-spinner\n".into();
    if state == "talk-run-failed-stderr" {
        finished["exitCode"] = 101.into();
        finished["endedMs"] = (finished["startedMs"].as_u64().unwrap() + 9_000).into();
        finished["stderr"] = "error: test failed\n".into();
    } else if state == "talk-run-long-scrolled" {
        finished["stdout"] = (1..=100)
            .map(|line| format!("output line {line:03}\n"))
            .collect::<String>()
            .into();
    }
    app.standalone_completed(Completed::Run(run, Ok(finished)));
    if state == "talk-run-long-scrolled" {
        let mut screen =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(width, 36)).unwrap();
        screen
            .draw(|frame| {
                crate::board::view::prepare(&mut app, frame.area());
                crate::board::view::render(frame, &app);
            })
            .unwrap();
        press(&mut app, KeyCode::PageDown);
    }
    assert!(app.input.as_ref().unwrap().text.as_str().is_empty());
    if state == "talk-run-closed" {
        assert_eq!(
            press(&mut app, KeyCode::Esc),
            Effect::Standalone(Task::Discard)
        );
    }
    app
}

pub(in crate::board) fn run_hits(app: &App) -> Value {
    let hits = app.standalone.hits.borrow();
    json!({
        "outer": [hits.outer.x, hits.outer.y, hits.outer.width, hits.outer.height],
        "output": [hits.content.x, hits.content.y, hits.content.width, hits.content.height],
        "buttons": hits.buttons.iter().map(|area|
            area.map(|area| [area.x, area.y, area.width, area.height])).collect::<Vec<_>>(),
    })
}

#[test]
fn talk_run_sends_exact_bounded_output_to_its_original_member() {
    let mut app = capture_talk_run("talk-run-result", crate::look::Look::default(), 160);
    let frozen = app
        .standalone
        .run_recipient
        .as_ref()
        .unwrap()
        .draft
        .draft_key
        .clone()
        .unwrap();
    let Some(Page::Finished { result, .. }) = &mut app.standalone.page else {
        panic!("finished Talk run");
    };
    result["stdout"] = (1..=202)
        .map(|line| format!("row {line:03}\n"))
        .collect::<String>()
        .into();
    result["stderr"] = "\x1b[31merror · ```\x1b[0m\n".into();
    let kept = (4..=202)
        .map(|line| format!("row {line:03}\n"))
        .collect::<String>();
    let expected = format!(
        "! pwd\n✓ exited 0 · 41s\n(3 earlier lines omitted)\n\n~~~\n{kept}stderr · error · ```\n~~~"
    );
    let tight = result_message("pwd", result, 120).unwrap();
    assert!(tight.len() <= 120 && tight.contains("earlier lines omitted"));
    app.input.as_mut().unwrap().text = "a different unsent draft".into();
    app.focus = 0;
    let effect = press(&mut app, KeyCode::Char('s'));
    let Effect::Act(request @ Request::Chat { .. }) = effect else {
        panic!("result is a normal Talk send");
    };
    let Request::Chat {
        sender,
        recipient,
        name,
        text,
        keep_reply,
        ..
    } = &request
    else {
        unreachable!()
    };
    assert_eq!((sender, recipient), (&frozen.0, &frozen.1));
    assert_eq!(text, &expected);
    assert!(!keep_reply);
    assert_eq!(press(&mut app, KeyCode::Char('s')), Effect::None);
    let ticket = app
        .outgoing_ticket(&request)
        .expect("normal outgoing journal ticket");
    assert_eq!(ticket.run, Some(app.standalone.run_id));
    app.finished_send(super::super::conversation::outgoing::Completed {
        ticket: Some(ticket),
        outcome: Ok(crate::send::Accepted {
            request: "request-result".into(),
            disposition: crate::send::Disposition::Sent,
            message_state_label: None,
            can_send_now: false,
            working: false,
            passthrough: true,
            fallback: None,
            warning: None,
        }),
        what: "Message".into(),
        to: name.clone(),
    });
    assert_eq!(
        app.standalone.notice.as_deref(),
        Some(format!("Sent the result to {name}.").as_str())
    );
    assert_eq!(
        app.input.as_ref().unwrap().text.as_str(),
        "a different unsent draft"
    );
    assert_eq!(press(&mut app, KeyCode::Char('s')), Effect::None);
}

#[test]
fn result_output_scrolls_by_visible_rows_and_keeps_the_chrome_fixed() {
    use ratatui::{
        Terminal,
        backend::TestBackend,
        crossterm::event::{MouseEvent, MouseEventKind},
    };

    let mut app = capture_talk_run("talk-run-failed-stderr", crate::look::Look::default(), 160);
    let mut terminal = Terminal::new(TestBackend::new(100, 36)).unwrap();
    let mut paint = |app: &App| {
        terminal
            .draw(|frame| app.standalone.render(frame, app, frame.area()))
            .unwrap();
    };
    paint(&app);
    let compact = app.standalone.outer().height;
    let Some(Page::Finished { result, .. }) = &mut app.standalone.page else {
        panic!("finished Talk run");
    };
    result["stdout"] = (1..=100)
        .map(|line| format!("row {line:03}\n"))
        .collect::<String>()
        .into();
    paint(&app);
    let output = app.standalone.hits.borrow().content;
    assert!(compact < app.standalone.outer().height);
    assert_eq!(app.standalone.scroll, 0);
    press(&mut app, KeyCode::PageDown);
    assert_eq!(app.standalone.scroll, output.height as usize);
    press(&mut app, KeyCode::Down);
    assert_eq!(app.standalone.scroll, output.height as usize + 1);
    press(&mut app, KeyCode::Home);
    assert_eq!(app.standalone.scroll, 0);
    app.standalone_event(&Event::Mouse(MouseEvent {
        kind: MouseEventKind::ScrollDown,
        column: output.x,
        row: output.y,
        modifiers: KeyModifiers::NONE,
    }));
    assert_eq!(app.standalone.scroll, 3);
    press(&mut app, KeyCode::End);
    assert_eq!(app.standalone.scroll, app.standalone.scroll_end.get());
    paint(&app);
    assert_eq!(app.standalone.hits.borrow().content, output);
}

#[test]
fn finished_edit_preserves_the_member_and_waits_for_confirmation() {
    let mut app = capture("run-command-result", crate::look::Look::default());
    let request = app.standalone.request.clone().expect("completed request");
    assert_eq!(
        press(&mut app, KeyCode::Char('e')),
        Effect::Standalone(Task::Discard)
    );
    assert!(app.standalone.editing());
    assert!(!app.standalone.running());
    let Some(Page::Form(form)) = &app.standalone.page else {
        panic!("Edit must reopen the form");
    };
    let target = &form.targets[form.selected];
    assert_eq!(target.input, request["target"]);
    assert_eq!(form.command.as_str(), request["command"].as_str().unwrap());
    press(&mut app, KeyCode::End);
    assert_eq!(press(&mut app, KeyCode::Char('s')), Effect::None);
    let Effect::Standalone(Task::Run(_, edited)) = press(&mut app, KeyCode::Enter) else {
        panic!("only confirmation runs the edited command");
    };
    assert_eq!(edited["target"], request["target"]);
    assert_ne!(edited["command"], request["command"]);

    let mut app = capture("run-command-result", crate::look::Look::default());
    assert!(
        matches!(press(&mut app, KeyCode::Char('r')), Effect::Standalone(Task::Run(_, value)) if value == request)
    );
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
    app.standalone.progress(id, &rows, false, false);
    let tail = paint(&mut app);
    assert!(tail.contains("live row 24"));
    assert!(tail.contains("running 0:12") && tail.contains("Stop"));
    assert!(!tail.contains("Keep in list"));
    press(&mut app, KeyCode::PageUp);
    let scrolled = paint(&mut app);
    assert!(!scrolled.contains("live row 24"));
    app.standalone.progress(id, "live row 25\n", false, false);
    let held = paint(&mut app);
    assert!(!held.contains("live row 24") && !held.contains("live row 25"));
    app.standalone.progress(id + 1, "stale row\n", false, false);
    press(&mut app, KeyCode::End);
    let tail = paint(&mut app);
    assert!(tail.contains("live row 25"));
    assert!(!tail.contains("stale row"));
    press(&mut app, KeyCode::PageUp);
    assert!(!paint(&mut app).contains("live row 25"));
    // A page forward clamps to the fresh end, even before the next paint.
    app.standalone.progress(id, "live row 26\n", false, false);
    press(&mut app, KeyCode::PageDown);
    let advanced = paint(&mut app);
    assert!(advanced.contains("live row 25"));
    assert!(advanced.contains("live row 26"));
    press(&mut app, KeyCode::Down);
    app.standalone.progress(id, "live row 27\n", false, false);
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
    assert!(text.contains("^C stop · Esc hide, keeps running"));

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
fn run_window_result_reports_exit_and_duration_with_enter_to_keep_and_escape_to_close() {
    use ratatui::{Terminal, backend::TestBackend};

    let finished = || capture("run-command-result", crate::look::Look::default());
    let mut app = finished();
    let mut screen = Terminal::new(TestBackend::new(160, 36)).unwrap();
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
    for expected in [
        "exited 0 · 41s",
        "Keep in list",
        "Run again",
        "Edit",
        "k keep · r run again · e edit · Esc close",
    ] {
        assert!(text.contains(expected), "missing {expected:?}");
    }

    assert_eq!(
        press(&mut app, KeyCode::Enter),
        Effect::Standalone(Task::Keep(result()["runId"].as_str().unwrap().into()))
    );
    let mut app = finished();
    assert_eq!(
        press(&mut app, KeyCode::Esc),
        Effect::Standalone(Task::Discard)
    );
    assert!(!app.standalone.shown());
    assert!(app.standalone.page.is_none());
}

#[test]
fn run_result_hints_shorten_from_the_left_and_share_the_button_row() {
    use ratatui::{Terminal, backend::TestBackend};

    let mut app = capture("run-command-result", crate::look::Look::default());
    let Some(Page::Finished { result, .. }) = app.standalone.page.as_mut() else {
        panic!("finished command");
    };
    result["stdout"] = (0..20)
        .map(|number| format!("output row {number:02}\n"))
        .collect::<String>()
        .into();
    let mut screen = Terminal::new(TestBackend::new(100, 36)).unwrap();
    screen
        .draw(|frame| app.standalone.render(frame, &app, frame.area()))
        .unwrap();
    let buffer = screen.backend().buffer();
    let row = |y| {
        (0..100)
            .map(|x| buffer[(x, y)].symbol())
            .collect::<String>()
    };
    let footer = (1..36).find(|y| row(*y).contains("Keep in list")).unwrap();
    assert!(row(footer).contains("e edit · Esc close"));
    assert!(!row(footer).contains("↑↓ scroll"));
    assert!(row(footer - 1).contains("lines · showing"));

    let app = capture_talk_run("talk-run-failed-stderr", crate::look::Look::default(), 100);
    screen
        .draw(|frame| app.standalone.render(frame, &app, frame.area()))
        .unwrap();
    let hits = app.standalone.hits.borrow();
    let buffer = screen.backend().buffer();
    let footer: String = (0..100)
        .map(|x| buffer[(x, hits.buttons[0].unwrap().y)].symbol())
        .collect();
    assert!(footer.contains("s send · Esc close"));
    assert!(!footer.contains("e edit"));
    let (x, y) = (hits.content.x, hits.content.y);
    let track = app.look().role(tmt_cli_style::Role::Track).bg;
    assert_eq!(buffer[(x, y)].symbol(), " ");
    assert_eq!(Some(buffer[(x, y)].bg), track);
    assert_eq!(buffer[(x + 1, y)].symbol(), "/");
}

#[test]
fn kept_output_escape_closes_the_modal_and_keeps_the_row_selected() {
    let mut app = capture("run-command-kept", crate::look::Look::default());
    let selected = app.workspace.selected.clone();
    let Effect::Standalone(Task::Saved(task @ super::SavedTask::Get(_))) =
        press(&mut app, KeyCode::Enter)
    else {
        panic!("Enter opens the selected kept row");
    };
    app.standalone_completed(Completed::Saved(Box::new(task), Ok(result())));
    assert!(matches!(app.standalone.page, Some(Page::Saved(_))));
    let mut screen = ratatui::Terminal::new(ratatui::backend::TestBackend::new(100, 36)).unwrap();
    screen
        .draw(|frame| {
            crate::board::view::prepare(&mut app, frame.area());
            crate::board::view::render(frame, &app);
        })
        .unwrap();

    assert_eq!(press(&mut app, KeyCode::Esc), Effect::None);
    assert!(!app.standalone.shown());
    assert!(app.standalone.page.is_none());
    assert_eq!(app.workspace.selected, selected);
}

#[test]
fn kept_move_escape_cancels_without_saving_the_proposed_placement() {
    let mut app = capture("run-command-kept", crate::look::Look::default());
    let selected = app.workspace.selected.clone();
    let row = app.standalone.saved_rows[0].clone();
    assert_eq!(press(&mut app, KeyCode::Char('m')), Effect::None);
    assert_eq!(press(&mut app, KeyCode::Down), Effect::None);
    assert!(app.standalone.moving());

    assert_eq!(press(&mut app, KeyCode::Esc), Effect::None);
    assert!(!app.standalone.moving());
    assert_eq!(app.workspace.selected, selected);
    assert_eq!(app.standalone.saved_rows[0], row);
}

#[test]
fn unavailable_member_directory_keeps_the_command_form_with_a_tab_hint() {
    use crate::{board::app::workspace::tests::board, core::SquadError};

    let mut app = board();
    app.standalone.launch_directory = Some("/work/local".into());
    let Effect::Standalone(Task::Target(generation, identity)) =
        press(&mut app, KeyCode::Char('！'))
    else {
        panic!("resolve the selected member");
    };
    for ch in "pwd".chars() {
        assert_eq!(press(&mut app, KeyCode::Char(ch)), Effect::None);
    }
    app.standalone_completed(Completed::Target(
        generation,
        identity,
        Err(SquadError::new(
            "SHELL_RUN_UNAVAILABLE",
            "The member's current local directory could not be verified. Nothing was started.",
        )),
    ));

    assert!(app.standalone.shown());
    let Some(Page::Form(form)) = &app.standalone.page else {
        panic!("the refused lookup must keep the form");
    };
    assert!(!form.observing);
    assert_eq!(form.command.as_str(), "pwd");
    let notice = app.standalone.notice.as_deref().expect("target notice");
    assert!(
        notice.contains("worker") && notice.contains("Tab"),
        "{notice}"
    );
    assert_eq!(press(&mut app, KeyCode::Enter), Effect::None);
    assert!(!app.standalone.running());
    assert_eq!(press(&mut app, KeyCode::Tab), Effect::None);
    assert!(
        app.standalone
            .lines()
            .iter()
            .any(|line| line.contains("/work/local"))
    );
}

#[test]
fn cancelled_talk_lookup_cannot_launch_a_new_draft_for_the_same_member() {
    let mut app = crate::board::app::workspace::tests::board();
    app.focus_composer();
    app.input.as_mut().unwrap().text = "!pwd".into();
    let Effect::Standalone(Task::Target(old, member)) = press(&mut app, KeyCode::Enter) else {
        panic!("Talk must resolve a member");
    };
    assert_eq!(press(&mut app, KeyCode::Esc), Effect::None);
    assert_eq!(app.input.as_ref().unwrap().text.as_str(), "!pwd");
    app.input.as_mut().unwrap().text = "！！ls".into();
    let Effect::Standalone(Task::Target(current, same_member)) = press(&mut app, KeyCode::Enter)
    else {
        panic!("the new draft must have its own observation");
    };
    assert_eq!(same_member, member);
    assert_ne!(current, old);
    let target = || {
        json!({
            "cwd":"/work",
            "bindingId":"00000000-0000-4000-8000-000000006755",
            "paneIncarnation":"fixture",
        })
    };
    assert_eq!(
        app.standalone_completed(Completed::Target(old, member.clone(), Ok(target()))),
        Effect::None
    );
    let Effect::Standalone(Task::Run(run, request)) =
        app.standalone_completed(Completed::Target(current, member, Ok(target())))
    else {
        panic!("only the current observation launches");
    };
    assert_eq!(request["command"], "ls");
    app.standalone_completed(Completed::Run(
        run,
        Err(crate::core::SquadError::new(
            "TERMINAL_COMMAND_TARGET_CHANGED",
            "The member's directory changed.",
        )),
    ));
    assert_eq!(app.input.as_ref().unwrap().text.as_str(), "！！ls");
}

#[test]
fn closing_talk_run_restores_the_scrolled_transcript_without_pinning_output() {
    use crate::{
        board::{
            app::workspace::tests::{MEMBER, board},
            scroll::Step,
        },
        config::Pane,
    };
    use ratatui::{Terminal, backend::TestBackend};

    let mut app = board();
    app.view.as_mut().unwrap().replies = vec![json!({
        "recipientId": MEMBER, "requestId": "retained",
        "response": (0..80).map(|n| format!("Retained paragraph {n:02}\n\n")).collect::<String>(),
    })];
    app.focus_composer();
    let mut screen = Terminal::new(TestBackend::new(160, 36)).unwrap();
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
    paint(&mut app);
    app.scroll_pane(Pane::Replies, Step::Top);
    app.scroll_pane(Pane::Replies, Step::Lines(8));
    let before = paint(&mut app);
    let offset = app.scrolls.offset(Pane::Replies);
    assert!(offset > 0);

    app.input.as_mut().unwrap().text = "!pwd".into();
    let Effect::Standalone(Task::Target(generation, member)) = press(&mut app, KeyCode::Enter)
    else {
        panic!("Talk resolves the member");
    };
    let Effect::Standalone(Task::Run(run, _)) = app.standalone_completed(Completed::Target(
        generation,
        member,
        Ok(json!({
            "cwd":"/work", "bindingId":"00000000-0000-4000-8000-000000006755",
            "paneIncarnation":"fixture",
        })),
    )) else {
        panic!("the directory admits the Run");
    };
    let mut done = result();
    done["command"] = "pwd".into();
    done["stdout"] = "private output from the Run window".into();
    app.standalone_completed(Completed::Run(run, Ok(done)));
    assert!(paint(&mut app).contains("private output from the Run window"));
    let dismissed = press(&mut app, KeyCode::Esc);
    assert_eq!(dismissed, Effect::Standalone(Task::Discard));
    let after = paint(&mut app);
    assert_eq!(app.scrolls.offset(Pane::Replies), offset);
    assert!(!after.contains("private output from the Run window"));
    for line in (0..80).map(|n| format!("Retained paragraph {n:02}")) {
        assert_eq!(after.contains(&line), before.contains(&line), "{line}");
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
