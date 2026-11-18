use super::*;
use crate::board::{
    app::workspace::tests::{MEMBER, ROOM, board, capture_case, disable_motion},
    app::{App, Effect},
    shell::OpsTab,
};
use ratatui::{
    Terminal,
    backend::TestBackend,
    crossterm::event::{KeyCode, KeyEvent, KeyModifiers},
};
use serde_json::{Value, json};

const PAGE: &str = "33333333-3333-4333-8333-333333333333";
const OTHER: &str = "44444444-4444-4444-8444-444444444444";
const DONE: &str = "55555555-5555-4555-8555-555555555555";
const UNCHECKED: &str = "66666666-6666-4666-8666-666666666666";

fn owner_list(now: u64) -> Value {
    json!({
        "spaceId": "fixture",
        "projects": ["Colab", "Core"],
        "pages": [
            {
                "pageId": PAGE, "workNumber": "COLAB-119",
                "title": "Large \u{1b}[31mdesign reads",
                "projects": ["Colab", "Core"], "lastUpdateAtMs": now - 91_020_000,
                "link": "https://example.test/page",
                "summary": {
                    "status": "blocked", "blockedSinceMs": now - 91_020_000,
                    "fields": {
                        "owner": {"id": MEMBER, "name": "worker-before-rename"},
                        "next": "Different next step",
                        "blocked": "Waiting \u{1b}]0;escape\u{7}for the protocol decision"
                    },
                    "todos": [
                        {"id": "one", "number": "COLAB-140", "text": "Answer the scope questions",
                            "assignee": "worker", "checked": false, "ask": "needs-you"},
                        {"id": "two", "number": "COLAB-143", "text": "Fix the mockup toolbar",
                            "assignee": "worker", "checked": false, "ask": "sent"},
                        {"id": "three", "text": "Unnumbered", "assignee": "worker", "checked": false},
                        {"id": "four", "number": "COLAB-144", "text": "Unassigned", "checked": false}
                    ]
                }
            },
            {
                "pageId": OTHER, "workNumber": "W-91", "title": "Check the setup example",
                "lastUpdateAtMs": now - 301_000,
                "summary": {"status": "waiting-ci",
                    "fields": {"owner": {"id": OTHER, "name": "worker"}}}
            },
            {
                "pageId": UNCHECKED, "workNumber": "CORE-88", "title": "Review the event contract",
                "projects": ["Core"], "lastUpdateAtMs": now - 2_401_000,
                "summary": {"status": "unchecked", "todosOmitted": true}
            },
            {
                "pageId": DONE, "workNumber": "COLAB-110", "title": "Document page names",
                "projects": ["Colab"], "lastUpdateAtMs": now - 121_000,
                "summary": {"status": "done", "doneAtMs": now - 121_000, "release": "alpha.470"}
            }
        ]
    })
}

#[test]
fn colab_work_preserves_published_status_sanitizes_and_ranks_items() {
    let mut document = owner_list(1_800_000_000_000);
    document["pages"][0]["summary"]["sections"] = json!([
        {"id":"h1","title":"Plan","level":2,"done":0,"total":2,"state":"not-started"}
    ]);
    document["pages"][2]["summary"]["sectionsOmitted"] = json!(true);
    let list = List::decode_output(&serde_json::to_vec(&document).unwrap()).unwrap();
    let open: Vec<_> = list
        .items
        .iter()
        .filter(|item| item.status != Status::Done)
        .collect();
    assert_eq!(
        open.iter()
            .map(|item| item.number.as_deref().unwrap())
            .collect::<Vec<_>>(),
        ["COLAB-119", "COLAB-140", "COLAB-143", "W-91", "CORE-88"]
    );
    assert_eq!(open[0].title, "Large design reads");
    assert_eq!(
        open[0].next.as_deref(),
        Some("Waiting for the protocol decision")
    );
    assert_eq!(open[1].status, Status::NeedsYou);
    assert_eq!(open[2].status, Status::Working);
    assert_eq!(open[4].status.label(), "Not checked yet");
    assert_eq!(open[1].next, None);
    assert_eq!(open[1].parent.as_deref(), Some("in COLAB-119"));
    assert_eq!(list.omitted, 1);
    assert_eq!(list.missing, 0);
    assert_eq!(open[1].page, PAGE);
    assert_eq!(open[1].key, format!("{PAGE}:one"));
}

#[test]
fn colab_work_binds_page_uuid_and_only_unique_exact_todo_names() {
    let app = board();
    let mut roster = super::super::workspace::OpsRoster {
        members: app.workspace_snapshot().unwrap().roster.members.clone(),
        ..Default::default()
    };
    let mut body = owner_list(1_800_000_000_000);
    body["pages"][0]["summary"]["todos"][1]["assignee"] = json!("worker\u{1b}[0m");
    let list = List::decode(&body).unwrap();
    let bound = list.bindings(&roster);
    assert_eq!(bound[MEMBER].0.page, PAGE);
    assert_eq!(bound[MEMBER].1, 2, "page plus the exact name only");
    let mut duplicate = roster.members[MEMBER].clone();
    duplicate.id = DONE.into();
    roster.members.insert(DONE.into(), duplicate);
    let bound = list.bindings(&roster);
    assert_eq!(bound[MEMBER].1, 1, "only the page UUID still matches");
    assert_eq!(
        bound.len(),
        1,
        "an unmatched page cannot guess from an owner name"
    );
    assert_eq!(list.items[0].owner_name(Some(&roster)), Some("worker"));
    assert_eq!(list.items[0].owner_name(None), Some("worker-before-rename"));
    assert_eq!(list.items[1].owner_name(Some(&roster)), Some("worker"));
}

#[test]
fn colab_work_distinguishes_empty_partial_and_out_of_budget_lists() {
    let empty = List::decode_output(br#"{"spaceId":"fixture","pages":[]}"#).unwrap();
    assert_eq!(empty.missing, 0);
    assert!(empty.items.is_empty() && !empty.has_summary);
    let partial = List::decode(&json!({"spaceId":"fixture","pages":[{"pageId":PAGE}]})).unwrap();
    assert_eq!(partial.missing, 1);
    assert!(partial.items.is_empty() && !partial.has_summary);
    assert!(List::decode_output(&vec![b' '; 2 * 1024 * 1024 + 1]).is_err());
}

fn key(app: &mut App, code: KeyCode) -> Effect {
    app.key(KeyEvent::new(code, KeyModifiers::NONE))
}

#[test]
fn colab_work_key_dispatch_does_not_open_from_stale_or_unlinked_rows() {
    let mut app = board();
    let selected = app.workspace.selected.clone();
    app.work.apply(
        Instant::now(),
        List::decode(&owner_list(crate::status::now_ms())).map_err(Into::into),
    );
    let _guard = crate::runner::forbid_commands();
    assert_eq!(key(&mut app, KeyCode::Char('2')), Effect::None);
    assert_eq!(app.shell.tab, OpsTab::Work);
    assert_eq!(key(&mut app, KeyCode::Char('/')), Effect::None);
    assert!(!app.searching);
    assert_eq!(
        key(&mut app, KeyCode::Enter),
        Effect::OpenWorkPage(PAGE.into())
    );
    assert_eq!(key(&mut app, KeyCode::Down), Effect::None);
    assert_eq!(
        key(&mut app, KeyCode::Enter),
        Effect::OpenWorkPage(PAGE.into())
    );
    assert_eq!(key(&mut app, KeyCode::End), Effect::None);
    assert_eq!(
        key(&mut app, KeyCode::Enter),
        Effect::None,
        "no admitted page link"
    );
    assert_eq!(key(&mut app, KeyCode::Home), Effect::None);
    assert_eq!(key(&mut app, KeyCode::Char('r')), Effect::Refresh);
    let mut terminal = Terminal::new(TestBackend::new(100, 36)).unwrap();
    terminal
        .draw(|frame| crate::board::view::render(frame, &app))
        .unwrap();
    assert!(
        app.work
            .hits
            .borrow()
            .iter()
            .any(|(_, hit)| matches!(hit, surface::Hit::Open(_)))
    );
    app.work
        .apply(Instant::now(), Err("Colab could not answer.".into()));
    assert_eq!(key(&mut app, KeyCode::Enter), Effect::None);
    terminal
        .draw(|frame| crate::board::view::render(frame, &app))
        .unwrap();
    assert!(
        !app.work
            .hits
            .borrow()
            .iter()
            .any(|(_, hit)| matches!(hit, surface::Hit::Open(_)))
    );
    assert_eq!(key(&mut app, KeyCode::Char('1')), Effect::None);
    assert_eq!(app.workspace.selected, selected);
}

pub(in crate::board) const SCENES: &[&str] =
    &["work-projects", "work-done", "work-stale", "agents-work"];

pub(in crate::board) fn scene(scene: &str, look: crate::look::Look) -> App {
    let mut app = capture_case("agents", look);
    disable_motion(&mut app);
    app.local_zone = Some(jiff::tz::TimeZone::UTC);
    let mut pages = owner_list(crate::status::now_ms());
    if scene == "agents-work" {
        use crate::board::workspace::OpsTarget;
        let snapshot = &mut app.view.as_mut().unwrap().home.as_mut().unwrap().workspace;
        let mut member = snapshot.roster.members[MEMBER].clone();
        member.id = OTHER.into();
        member.name = "sam".into();
        snapshot.roster.members.insert(OTHER.into(), member);
        snapshot
            .roster
            .squads
            .iter_mut()
            .find(|squad| squad.room_id == ROOM)
            .unwrap()
            .members
            .push(OTHER.into());
        snapshot.rows.insert(
            OpsTarget::Member {
                room_id: Some(ROOM.into()),
                identity_id: OTHER.into(),
            },
            json!({"id": OTHER, "name": "sam", "state": "working", "presence": "active"}),
        );
        pages["pages"][1]["summary"]["fields"]["owner"]["name"] = json!("sam");
        app.workspace.selected = Some(OpsTarget::Member {
            room_id: Some(ROOM.into()),
            identity_id: MEMBER.into(),
        });
        app.workspace_reconcile();
    } else {
        app.work
            .apply(Instant::now(), List::decode(&pages).map_err(Into::into));
        key(&mut app, KeyCode::Char('2'));
        if scene == "work-done" {
            key(&mut app, KeyCode::Char('p'));
            key(&mut app, KeyCode::Char('c'));
            key(&mut app, KeyCode::Char('d'));
        }
        if scene == "work-stale" {
            app.work
                .apply(Instant::now(), Err("Colab owner list unavailable.".into()));
        }
    }
    if scene == "agents-work" {
        app.work
            .apply(Instant::now(), List::decode(&pages).map_err(Into::into));
    }
    app
}

#[test]
fn colab_work_rate_limits_normal_reads_and_coalesces_explicit_refreshes() {
    let mut state = State::default();
    let now = Instant::now();
    let delivered = || List::decode(&owner_list(1_800_000_000_000)).map_err(Into::into);
    assert!(state.request(now));
    state.apply(now + Duration::from_secs(2), delivered());
    for seconds in [5, 10, 15, 59, 60, 61] {
        assert!(!state.request(now + Duration::from_secs(seconds)));
    }
    assert!(state.request(now + Duration::from_secs(62)));
    state.refresh();
    state.refresh();
    assert!(!state.request(now + Duration::from_secs(63)));
    state.apply(now + Duration::from_secs(63), delivered());
    assert!(state.request(now + Duration::from_secs(63)));
    state.apply(now + Duration::from_secs(63), delivered());
    assert!(!state.request(now + Duration::from_secs(64)));
}

#[test]
fn colab_work_pauses_for_missing_or_old_colab_until_explicit_refresh() {
    let now = Instant::now();
    for unavailable in [ReadFailure::NotInstalled, ReadFailure::UpdateNeeded] {
        let mut state = State::default();
        assert!(state.request(now));
        state.apply(now, Err(unavailable));
        let later = now + Duration::from_secs(600);
        assert!(!state.request(later));
        state.refresh();
        assert!(state.request(later));
        state.apply(
            later,
            List::decode(&owner_list(1_800_000_000_000)).map_err(Into::into),
        );
        assert!(state.request(later + Duration::from_secs(60)));
    }
}

#[test]
fn colab_work_uses_opt_in_and_pauses_only_for_the_legacy_option_refusal() {
    use crate::{
        core::Core,
        test_support::{Scratch, write_ready_executable},
    };
    use std::fs;

    let scratch = Scratch::new("colab-work-option");
    let executable = scratch.join("tmt");
    let response = scratch.join("response");
    write_ready_executable(
        &executable,
        r#"#!/bin/sh
cd "$(dirname "$0")" || exit 2
[ "$#" -eq 4 ] && [ "$1" = colab ] && [ "$2" = ls ] && [ "$3" = --work ] && [ "$4" = --json ] || exit 2
cat response
exit 1
"#,
    );
    let core = Core::at(executable);
    fs::write(
        &response,
        json!({"error":{
            "code":"COLAB_INPUT_INVALID",
            "message":"error: unexpected argument '--work' found\n\nUsage: tmt colab ls [OPTIONS]\n\nFor more information, try '--help'.\n"
        }})
        .to_string(),
    )
    .unwrap();
    let now = Instant::now();
    let mut state = State::default();
    let legacy = read(&core);
    assert!(matches!(&legacy, Err(ReadFailure::UpdateNeeded)));
    assert!(state.request(now));
    state.apply(now, legacy);
    assert_eq!(
        state.notice.as_deref(),
        Some("Update Colab · Work requires the owner-summary list.")
    );
    let later = now + Duration::from_secs(600);
    assert!(!state.request(later));
    state.refresh();
    assert!(state.request(later));

    fs::write(
        &response,
        json!({"error":{"code":"COLAB_INPUT_INVALID","message":"Owner space is invalid."}})
            .to_string(),
    )
    .unwrap();
    let other = read(&core);
    assert!(matches!(
        &other,
        Err(ReadFailure::Unavailable(message))
            if message == "Colab Work unavailable · Owner space is invalid."
    ));
    state.apply(later, other);
    assert!(state.request(later + Duration::from_secs(60)));
}

#[test]
fn colab_work_reads_once_across_workspace_snapshot_applies() {
    use crate::board::{BoardEvent, app::tests::snapshot, session};
    use std::{
        cell::Cell,
        sync::{atomic::AtomicUsize, mpsc::channel},
    };

    let mut app = board();
    let (tx, rx) = channel();
    let work_reads = Cell::new(0);
    tx.send(BoardEvent::WorkRead {
        result: List::decode(&owner_list(1_800_000_000_000)).map_err(Into::into),
        cancellation: crate::runner::Cancellation::default(),
    })
    .unwrap();
    for _ in 0..4 {
        let mut next = snapshot(crate::board::ALL, json!([]));
        next.view = Ok(board().view.take().unwrap());
        tx.send(BoardEvent::Snapshot {
            snapshot: Box::new(next),
            cancellation: crate::runner::Cancellation::default(),
        })
        .unwrap();
    }
    tx.send(BoardEvent::InputClosed).unwrap();
    session(
        &mut app,
        &AtomicUsize::new(0),
        &rx,
        |_, _, _, _| {},
        |_, _| {},
        |_| {},
        |job| panic!("unexpected action {job:?}"),
        |_| {},
        |_| {},
        || Ok(()),
        || Ok(()),
        None,
        |_| Ok(()),
        |_| {},
        || work_reads.set(work_reads.get() + 1),
    )
    .unwrap();
    assert_eq!(work_reads.get(), 1);
}

#[test]
fn colab_work_captures_align_headings_and_show_bound_chips() {
    let _guard = crate::runner::forbid_commands();
    let look = crate::look::Look::default();
    for width in [100, 160] {
        let mut terminal = Terminal::new(TestBackend::new(width, 36)).unwrap();
        let render = |terminal: &mut Terminal<TestBackend>, scene_name| {
            let app = scene(scene_name, look);
            terminal
                .draw(|frame| crate::board::view::render(frame, &app))
                .unwrap();
            terminal
                .backend()
                .buffer()
                .content
                .chunks(usize::from(width))
                .map(|row| row.iter().map(|cell| cell.symbol()).collect::<String>())
                .collect::<Vec<_>>()
        };
        let lines = render(&mut terminal, "work-projects");
        let heading = lines
            .iter()
            .find(|line| line.contains("NUMBER") && line.contains("STATUS"))
            .unwrap();
        let selected = lines
            .iter()
            .find(|line| line.contains("› COLAB-119"))
            .unwrap();
        assert_eq!(heading.find("NUMBER"), Some(3));
        assert_eq!(heading.find("STATUS"), Some(17));
        assert_eq!(
            selected.find("✗ Blocked").map(|x| x - ("›".len() - 1)),
            Some(17)
        );
        assert!(heading.contains("AGE ") && !heading.contains("AGE…"));
        assert!(selected.contains("worker") && !selected.contains("before"));
        assert!(lines.iter().any(|line| line.contains("in COLAB-119")));
        let stale = render(&mut terminal, "work-stale");
        assert!(stale.iter().all(|line| !line.contains("⏎ open page")));
        assert!(lines.iter().all(|line| !line.trim_start().starts_with('·')));
        assert!(lines[34].contains("⏎ open page"));
        assert!(lines[35].contains("⏎ open page") && lines[35].contains("c recently done"));
        let agents = render(&mut terminal, "agents-work");
        assert!(
            agents.iter().any(|line| line.contains("sam ○ W-91")),
            "{agents:?}"
        );
    }
}
