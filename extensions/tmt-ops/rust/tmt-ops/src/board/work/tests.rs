use super::*;
use crate::board::{
    app::workspace::tests::{MEMBER, board, capture_case, disable_motion},
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
    let list = List::decode(&owner_list(1_800_000_000_000)).unwrap();
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
    assert_eq!(open[4].status.label(), "· Not checked yet");
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
    assert_eq!(list.items[1].binding(&roster), Err("ambiguous"));
    assert_eq!(
        list.items[3].binding(&roster),
        Err("unbound"),
        "a page never falls back to name"
    );
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
    app.work
        .apply(List::decode(&owner_list(crate::status::now_ms())));
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
    app.work.apply(Err("Colab could not answer.".into()));
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
    app.work
        .apply(List::decode(&owner_list(crate::status::now_ms())));
    if scene == "agents-work" {
        app.workspace.selected = Some(crate::board::workspace::OpsTarget::Member {
            room_id: Some(crate::board::app::workspace::tests::ROOM.into()),
            identity_id: MEMBER.into(),
        });
    } else {
        key(&mut app, KeyCode::Char('2'));
        if scene == "work-done" {
            key(&mut app, KeyCode::Char('p'));
            key(&mut app, KeyCode::Char('c'));
            key(&mut app, KeyCode::Char('d'));
        }
        if scene == "work-stale" {
            app.work.apply(Err("Colab owner list unavailable.".into()));
        }
    }
    app
}

#[test]
fn colab_work_coalesces_refreshes_into_one_trailing_read() {
    let mut state = State::default();
    assert!(state.request());
    state.requested = false;
    assert!(!state.request());
    state.requested = false;
    assert!(!state.request());
    state.apply(List::decode(&owner_list(1_800_000_000_000)));
    assert!(
        state.request(),
        "the latest refresh reads once after delivery"
    );
    state.apply(List::decode(&owner_list(1_800_000_000_000)));
    assert!(!state.request());
}
