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
                    "sectionProgress": {"done": 2, "inProgress": 1, "todo": 1, "unknown": 0, "total": 4},
                    "sections": [
                        {"id": "h1", "title": "Handshake protocol", "level": 2, "done": 1, "total": 1, "state": "done"},
                        {"id": "h2", "title": "Session auth token", "level": 2, "done": 1, "total": 1, "state": "done"},
                        {"id": "h3", "title": "Reconnect prompt", "level": 2, "done": 0, "total": 1, "state": "needs-you"},
                        {"id": "h4", "title": "Exponential backoff", "level": 2, "done": 0, "total": 1, "state": "unchecked"}
                    ],
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
                    "sectionProgress": {"done": 3, "inProgress": 0, "todo": 0, "unknown": 0, "total": 3},
                    "fields": {"owner": {"id": OTHER, "name": "worker"}}}
            },
            {
                "pageId": UNCHECKED, "workNumber": "CORE-88", "title": "Review the event contract",
                "projects": ["Core"], "lastUpdateAtMs": now - 2_401_000,
                "summary": {"status": "unchecked", "todosOmitted": true, "sectionsOmitted": true}
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
fn colab_work_projects_and_rows_do_not_require_order_data() {
    let mut document = owner_list(1_800_000_000_000);
    assert!(document.get("projectOrders").is_none());
    for order_field in [None, Some(json!("opaque additive field"))] {
        if let Some(value) = order_field {
            document["projectOrders"] = value;
        }
        let list = List::decode_output(&serde_json::to_vec(&document).unwrap()).unwrap();
        assert!(list.has_summary);
        assert_eq!(list.projects, ["Colab", "Core"]);
        assert_eq!(
            list.items
                .iter()
                .filter(|item| item.projects.iter().any(|project| project == "Colab"))
                .filter_map(|item| item.number.as_deref())
                .collect::<Vec<_>>(),
            ["COLAB-119", "COLAB-140", "COLAB-143", "COLAB-110"]
        );
    }
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
fn colab_work_renders_now_and_next_in_the_owner_order() {
    let now = 1_800_000_000_000;
    let document = ordered_list(now);
    let mut app = board();
    app.shell.tab = OpsTab::Work;
    app.work.project = Some("Core".into());
    app.work
        .apply(Instant::now(), List::decode(&document).map_err(Into::into));
    key(&mut app, KeyCode::Home);
    key(&mut app, KeyCode::Down);
    key(&mut app, KeyCode::Down);
    let mut terminal = Terminal::new(TestBackend::new(100, 36)).unwrap();
    terminal
        .draw(|frame| crate::board::view::render(frame, &app))
        .unwrap();
    let lines = terminal
        .backend()
        .buffer()
        .content
        .chunks(100)
        .map(|row| row.iter().map(|cell| cell.symbol()).collect::<String>())
        .collect::<Vec<_>>();
    let row = |label| {
        lines
            .iter()
            .position(|line| line.contains(label))
            .unwrap_or_else(|| panic!("Missing {label} in {lines:?}"))
    };
    assert!(row("── Now") < row("✗ COLAB-119"));
    assert!(row("── Next") < row("▸ · CORE-88"));
    assert!(row("▸ · CORE-88") < row("◇ COLAB-143"));
    assert!(row("── No preference") > row("◇ COLAB-143"));
    assert!(row("── No preference") < row("· W-91"));
    assert!(
        lines
            .iter()
            .any(|l| l.contains("More sections in Colab · o open"))
    );
}

fn ordered_list(now: u64) -> Value {
    let mut document = owner_list(now);
    document["pages"][0]["summary"]["todos"][1]["ask"] = Value::Null;
    document["pages"][1]["projects"] = json!(["Core"]);
    document["pages"][1]["summary"]["status"] = json!("unchecked");
    document["projectOrders"] = json!({
        "Core": {"revision": 3, "items": [PAGE, UNCHECKED, format!("{PAGE}:two")]},
        "Colab": {"revision": 1, "items": []}
    });
    document
}

#[test]
fn colab_work_move_confirm_uses_the_visible_neighbor_and_one_revision() {
    let mut app = board();
    app.shell.tab = OpsTab::Work;
    app.work.project = Some("Core".into());
    app.work.apply(
        Instant::now(),
        List::decode(&ordered_list(1_800_000_000_000)).map_err(Into::into),
    );
    let _guard = crate::runner::forbid_commands();
    key(&mut app, KeyCode::Home);
    assert_eq!(key(&mut app, KeyCode::Char('m')), Effect::None);
    assert!(app.menu.is_none(), "the stored Now rank is read-only");
    key(&mut app, KeyCode::Down);
    key(&mut app, KeyCode::Down);
    assert_eq!(key(&mut app, KeyCode::Char('m')), Effect::None);
    let Effect::WorkOrder(first) = key(&mut app, KeyCode::Enter) else {
        panic!("confirming the move must emit one order job");
    };
    assert_eq!(first.key, UNCHECKED);
    assert_eq!(first.revision, 3);
    assert_eq!(first.position, order::Position::Last);
    assert_eq!(key(&mut app, KeyCode::Char('m')), Effect::None);
    assert!(
        app.menu.is_none(),
        "cannot start a second move while saving"
    );
    let selected = app.work.selected.clone();
    app.work.apply_order(OrderReply {
        job: OrderJob::Move(first),
        outcome: order::Outcome::Conflict(Some(order::ProjectOrder {
            revision: 4,
            items: vec![PAGE.into(), format!("{PAGE}:two"), UNCHECKED.into()],
        })),
    });
    assert_eq!(app.work.selected, selected);
    assert_eq!(
        app.work.order_notice.as_ref().unwrap().1,
        "↻ Order changed elsewhere; showing the current order"
    );
    app.work.apply(
        Instant::now(),
        List::decode(&ordered_list(1_800_000_000_000)).map_err(Into::into),
    );
    assert_eq!(key(&mut app, KeyCode::Char('m')), Effect::None);
    let Effect::WorkOrder(revised) = key(&mut app, KeyCode::Enter) else {
        panic!("a new explicit confirmation is required after a conflict");
    };
    assert_eq!(
        revised.revision, 4,
        "a delayed list cannot overwrite the confirmed revision"
    );
    assert_eq!(
        revised.position,
        order::Position::Before(format!("{PAGE}:two"))
    );
    let list = app.work.list.as_ref().unwrap();
    assert_eq!(list.orders["Core"].items[0], PAGE);
}

#[test]
fn colab_work_order_reads_only_the_omitted_selected_project() {
    let mut value = ordered_list(1_800_000_000_000);
    value["projectOrders"]
        .as_object_mut()
        .unwrap()
        .remove("Core");
    value["projectOrdersOmitted"] = json!(["Core"]);
    let mut state = State::default();
    state.apply(Instant::now(), List::decode(&value).map_err(Into::into));
    assert!(state.request_order_show().is_none());
    state.project = Some("Colab".into());
    assert!(state.request_order_show().is_none());
    state.project = Some("Core".into());
    let job = state.request_order_show().unwrap();
    assert!(state.request_order_show().is_none());
    state.apply_order(OrderReply {
        job,
        outcome: order::Outcome::Read(order::ProjectOrder {
            revision: 3,
            items: vec![UNCHECKED.into()],
        }),
    });
    assert_eq!(
        state.list.as_ref().unwrap().orders["Core"].items,
        [UNCHECKED]
    );
    assert!(state.request_order_show().is_none());
}

#[test]
fn colab_work_order_cli_conflict_and_unknown_results_read_once_without_replaying() {
    use crate::{
        core::Core,
        test_support::{Scratch, write_ready_executable},
    };
    use std::fs;

    let scratch = Scratch::new("colab-work-order");
    let executable = scratch.join("tmt");
    let calls = scratch.join("calls");
    let response = scratch.join("response");
    write_ready_executable(
        &executable,
        r#"#!/bin/sh
cd "$(dirname "$0")" || exit 2
printf '%s\n' "$*" >> calls
if [ "$2" = --version ]; then
    cat version
elif [ "$4" = show ]; then
    cat current
else
    cat response
    exit 1
fi
"#,
    );
    fs::write(
        scratch.join("current"),
        json!({"revision":4,"items":[UNCHECKED]}).to_string(),
    )
    .unwrap();
    let core = Core::at(executable);
    let task = OrderMove {
        target: order::Target {
            space: "fixture".into(),
            project: "-Core".into(),
        },
        key: UNCHECKED.into(),
        revision: 3,
        position: order::Position::Before(format!("{PAGE}:two")),
    };
    let move_line = format!(
        "colab work order move --revision 3 --before {PAGE}:two --json -- -Core {UNCHECKED}\n"
    );
    for (response_body, needs_show) in [
        (json!({"error":{"code":"COLAB_ORDER_CONFLICT","message":"Current order: untyped text"}}).to_string(), true),
        (String::new(), true),
        (json!({"error":{"code":"COLAB_INPUT_INVALID","message":"error: unrecognized subcommand 'order'"}}).to_string(), false),
        (json!({"error":{"code":"COLAB_WORK_ITEM_NOT_FOUND","message":"No numbered work item matches."}}).to_string(), false),
    ] {
        fs::write(&calls, "").unwrap();
        fs::write(&response, &response_body).unwrap();
        let reply = run_order(&core, OrderJob::Move(task.clone()));
        let recorded = fs::read_to_string(&calls).unwrap();
        let expected = if needs_show {
            format!("{move_line}colab work order show --json -- -Core\n")
        } else {
            move_line.clone()
        };
        assert_eq!(recorded, expected);
        match reply.outcome {
            order::Outcome::Conflict(Some(order)) | order::Outcome::Uncertain(Some(order)) => {
                assert!(needs_show);
                assert_eq!(order.revision, 4);
                assert_eq!(order.items, [UNCHECKED]);
            }
            order::Outcome::Update => assert!(response_body.contains("unrecognized subcommand")),
            order::Outcome::Refused(message) => assert_eq!(message, "No numbered work item matches."),
            other => panic!("unexpected order outcome: {other:?}"),
        }
    }
    fs::write(
        &response,
        json!({"error":{"code":"COLAB_INPUT_INVALID","message":"Invalid project order input."}})
            .to_string(),
    )
    .unwrap();
    for (version, outdated) in [("0.1.0-alpha.480", true), ("0.1.0-alpha.481", false)] {
        fs::write(&calls, "").unwrap();
        fs::write(scratch.join("version"), format!("colab {version}\n")).unwrap();
        let reply = run_order(&core, OrderJob::Move(task.clone()));
        assert_eq!(
            fs::read_to_string(&calls).unwrap(),
            format!("{move_line}colab --version\n")
        );
        if outdated {
            assert!(matches!(reply.outcome, order::Outcome::Update));
        } else {
            assert!(
                matches!(reply.outcome, order::Outcome::Refused(message) if message == "Invalid project order input.")
            );
        }
    }
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
    assert!(app.searching);
    assert_eq!(key(&mut app, KeyCode::Esc), Effect::None);
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

pub(in crate::board) const SCENES: &[&str] = &[
    "work-projects",
    "work-done",
    "work-stale",
    "agents-work",
    "work-order-all",
    "work-order-project",
    "work-order-conflict",
    "work-view-chip",
    "work-view-collapsed",
    "work-view-save",
    "work-view-manage",
];

pub(in crate::board) fn scene(scene: &str, look: crate::look::Look) -> App {
    let mut app = capture_case("agents", look);
    disable_motion(&mut app);
    app.local_zone = Some(jiff::tz::TimeZone::UTC);
    let mut pages = owner_list(crate::status::now_ms());
    if scene.starts_with("work-order-") {
        pages = ordered_list(crate::status::now_ms());
        app.work
            .apply(Instant::now(), List::decode(&pages).map_err(Into::into));
        key(&mut app, KeyCode::Char('2'));
        if scene != "work-order-all" {
            app.work.project = Some("Core".into());
            key(&mut app, KeyCode::Home);
            key(&mut app, KeyCode::Down);
            key(&mut app, KeyCode::Down);
        }
        if scene == "work-order-conflict" {
            key(&mut app, KeyCode::Char('m'));
            let Effect::WorkOrder(task) = key(&mut app, KeyCode::Enter) else {
                panic!("conflict scene needs a confirmed move");
            };
            app.work.apply_order(OrderReply {
                job: OrderJob::Move(task),
                outcome: order::Outcome::Conflict(Some(order::ProjectOrder {
                    revision: 4,
                    items: vec![PAGE.into(), format!("{PAGE}:two"), UNCHECKED.into()],
                })),
            });
        }
        return app;
    }
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
        if matches!(
            scene,
            "work-view-chip" | "work-view-collapsed" | "work-view-save" | "work-view-manage"
        ) {
            app.view
                .as_mut()
                .unwrap()
                .home
                .as_mut()
                .unwrap()
                .workspace
                .preferences
                .work_views = vec![crate::config::WorkView {
                name: "Remote follow-up".into(),
                project: Some("Colab".into()),
                query: "protocol".into(),
                filter: None,
                detail_collapsed: scene == "work-view-collapsed",
                default: true,
            }];
            app.apply_default_work_view();
            if scene == "work-view-chip" {
                app.work.detail_collapsed = false;
                app.search.clear();
            } else if scene == "work-view-save" {
                app.work.view_draft_name = "Remote follow-up".into();
                app.work.view_draft_default = true;
                key(&mut app, KeyCode::Char('v'));
                key(&mut app, KeyCode::Char('s'));
            } else if scene == "work-view-manage" {
                key(&mut app, KeyCode::Char('v'));
            }
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
        |_, _| Ok(()),
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
        let selected = lines
            .iter()
            .find(|line| line.contains("▸ ✗ COLAB-119"))
            .unwrap();
        let selected_meta = lines
            .iter()
            .find(|line| line.contains("worker") && line.contains("2/4"))
            .unwrap();
        assert!(selected.contains("Large design reads"));
        assert!(!selected_meta.contains("before"));
        assert!(lines.iter().any(|line| line.contains("Detail · COLAB-119")));
        assert!(lines.iter().any(|line| line.contains("2/4 verified")));
        assert!(lines.iter().any(|line| line.contains("← waiting")));
        assert!(lines.iter().any(|line| line.contains("Projects")));
        assert!(lines.iter().any(|line| line.contains("Squad Pulse")));
        let stale = render(&mut terminal, "work-stale");
        assert!(stale.iter().all(|line| !line.contains("⏎ open page")));
        assert!(stale.iter().any(|line| line.contains("Stale ·")));
        assert!(lines.iter().any(|line| line.contains("o / ⏎  Open Colab")));
        assert!(lines[35].contains("⏎ open page") && lines[35].contains("/ search"));
        let agents = render(&mut terminal, "agents-work");
        assert!(
            agents.iter().any(|line| line.contains("sam ○ W-91")),
            "{agents:?}"
        );
    }
}

#[test]
fn colab_work_saved_views_chip_row_dialogs_and_default_reopen() {
    let now: u64 = 1_800_000_000_000;
    let document = owner_list(now);
    let mut app = board();
    app.shell.tab = OpsTab::Work;
    app.work
        .apply(Instant::now(), List::decode(&document).map_err(Into::into));

    let draw = |app: &App| {
        let mut terminal = Terminal::new(TestBackend::new(120, 36)).unwrap();
        terminal
            .draw(|frame| crate::board::view::render(frame, app))
            .unwrap();
        terminal
            .backend()
            .buffer()
            .content
            .chunks(120)
            .map(|row| row.iter().map(|cell| cell.symbol()).collect::<String>())
            .collect::<Vec<_>>()
    };

    // Built-in View chips render and filter by Needs you.
    let lines = draw(&app);
    assert!(
        lines
            .iter()
            .any(|l| l.contains("All (") && l.contains("Needs you (") && l.contains("+ Save"))
    );
    app.apply_work_view_selection(ViewSelection::NeedsYou);
    let needs_lines = draw(&app);
    assert!(needs_lines.iter().any(|l| l.contains("COLAB-140")));
    assert!(!needs_lines.iter().any(|l| l.contains("CORE-88")));

    // `v` opens the Saved Work views List dialog; `s` switches to Save Form dialog; Esc preserves draft.
    key(&mut app, KeyCode::Char('v'));
    assert!(matches!(
        app.work.view_dialog,
        Some(ViewDialog::Manage { .. })
    ));
    key(&mut app, KeyCode::Char('s'));
    assert!(matches!(
        app.work.view_dialog,
        Some(ViewDialog::Save { .. })
    ));
    for ch in "Colab follow-up".chars() {
        key(&mut app, KeyCode::Char(ch));
    }
    key(&mut app, KeyCode::Esc);
    assert!(app.work.view_dialog.is_none());
    assert_eq!(app.work.view_draft_name, "Colab follow-up");

    // Reopening Save dialog retains draft and Enter submits Request::WorkViews.
    key(&mut app, KeyCode::Char('v'));
    key(&mut app, KeyCode::Char('s'));
    app.work.view_draft_default = true;
    let Effect::Act(crate::board::app::Request::WorkViews { next, .. }) =
        key(&mut app, KeyCode::Enter)
    else {
        panic!("submitting Save view dialog must emit Request::WorkViews");
    };
    assert_eq!(next.len(), 1);
    assert_eq!(next[0].name, "Colab follow-up");
    assert!(next[0].default);

    // Default view applies on startup/reopen against a fresh snapshot.
    let mut reopened = board();
    reopened.shell.tab = OpsTab::Work;
    reopened
        .view
        .as_mut()
        .unwrap()
        .home
        .as_mut()
        .unwrap()
        .workspace
        .preferences
        .work_views = vec![crate::config::WorkView {
        name: "Colab follow-up".into(),
        project: Some("Colab".into()),
        query: "protocol".into(),
        filter: None,
        detail_collapsed: true,
        default: true,
    }];
    reopened
        .work
        .apply(Instant::now(), List::decode(&document).map_err(Into::into));
    reopened.apply_default_work_view();
    assert_eq!(reopened.work.project.as_deref(), Some("Colab"));
    assert_eq!(reopened.search.as_str(), "protocol");
    assert!(reopened.work.detail_collapsed);
    assert_eq!(
        reopened.work.active_view,
        ViewSelection::Saved("Colab follow-up".into())
    );
    let reopened_lines = draw(&reopened);
    assert!(
        reopened_lines
            .iter()
            .any(|l| l.contains("Colab follow-up *"))
    );
}

#[test]
fn the_work_views_dialog_follows_the_close_rule() {
    use ratatui::crossterm::event::{MouseButton, MouseEvent, MouseEventKind};
    let mut app = board();
    app.shell.tab = OpsTab::Work;
    key(&mut app, KeyCode::Char('v'));
    key(&mut app, KeyCode::Char('s'));
    key(&mut app, KeyCode::Char('X'));
    let mut terminal = Terminal::new(TestBackend::new(120, 36)).unwrap();
    terminal
        .draw(|frame| crate::board::view::render(frame, &app))
        .unwrap();
    assert!(app.work.view_dialog.is_some());
    app.mouse(
        MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: 0,
            row: 0,
            modifiers: KeyModifiers::NONE,
        },
        Instant::now(),
    );
    assert!(
        app.work.view_dialog.is_none(),
        "outside click closes dialog"
    );
    assert_eq!(app.work.view_draft_name, "X", "draft survives reopen");
}

#[test]
fn colab_work_decodes_sections_and_honest_unknown_progress() {
    let mut document = owner_list(1_800_000_000_000);
    document["pages"][0]["summary"]
        .as_object_mut()
        .unwrap()
        .remove("sectionProgress");
    document["pages"][0]["summary"]["needsYou"] = json!(1);
    document["pages"][0]["summary"]["sections"] = json!([
        {"id": "h1", "title": "Plan", "level": 2, "done": 1, "total": 2, "state": "working"},
        {"id": "h1-sub", "title": "Details", "level": 3, "done": 1, "total": 2, "state": "working"},
        {"id": "h2", "title": "Verify", "level": 2, "done": 0, "total": 1, "state": "unchecked"}
    ]);
    document["pages"][2]["summary"]["sectionsOmitted"] = json!(true);
    let list = List::decode(&document).unwrap();
    let colab_119 = list
        .items
        .iter()
        .find(|item| item.page == PAGE && !item.todo)
        .unwrap();
    assert_eq!(colab_119.needs_you, 1);
    assert_eq!(colab_119.sections.len(), 3);
    // Absent summary.sectionProgress stays None even when sections are present.
    assert_eq!(colab_119.progress, None);
    assert_eq!(list.project_progress("Core"), None);
    assert_eq!(list.project_progress("Colab"), None);

    // Explicit summary.sectionProgress populates progress.
    document["pages"][0]["summary"]["sectionProgress"] =
        json!({"done": 2, "inProgress": 1, "todo": 1, "unknown": 0, "total": 4});
    let list = List::decode(&document).unwrap();
    let colab_119 = list
        .items
        .iter()
        .find(|item| item.page == PAGE && !item.todo)
        .unwrap();
    assert_eq!(colab_119.progress, Some(Progress { done: 2, total: 4 }));
    assert_eq!(
        list.project_progress("Colab"),
        Some(Progress { done: 2, total: 4 })
    );
}

fn long_page_inspector() -> App {
    let now = 1_800_000_000_000;
    let mut document = owner_list(now);
    document["pages"][0]["summary"]["sections"] = json!(
        (1..=24)
            .map(|n| json!({
                "id": format!("heading-{n}"),
                "title": format!("Chapter {n:02}"),
                "level": 2, "done": 0, "total": 1, "state": "unchecked",
            }))
            .collect::<Vec<_>>()
    );
    let mut app = board();
    app.shell.tab = OpsTab::Work;
    app.work
        .apply(Instant::now(), List::decode(&document).map_err(Into::into));
    app
}

#[test]
fn colab_work_short_inspector_keeps_the_keyboard_section_visible() {
    let mut app = long_page_inspector();
    let draw = |app: &App| {
        let mut terminal = Terminal::new(TestBackend::new(120, 24)).unwrap();
        terminal
            .draw(|frame| crate::board::view::render(frame, app))
            .unwrap();
        terminal
            .backend()
            .buffer()
            .content
            .chunks(120)
            .map(|row| {
                row[60..]
                    .iter()
                    .map(|cell| cell.symbol())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let first = draw(&app);
    assert!(first.contains("Chapter 01") && !first.contains("Chapter 24"));
    key(&mut app, KeyCode::Tab);
    for _ in 0..12 {
        key(&mut app, KeyCode::Down);
    }
    let middle = draw(&app);
    assert!(middle.contains("▸ ·  13. Chapter 13"), "{middle}");
    assert!(
        middle.contains("more ↑") && middle.contains("more ↓"),
        "{middle}"
    );
    key(&mut app, KeyCode::End);
    let last = draw(&app);
    assert!(last.contains("▸ ·  24. Chapter 24"), "{last}");
    assert!(
        last.contains("more ↑") && !last.contains("more ↓"),
        "{last}"
    );
    assert!(last.contains("Open Colab"), "{last}");
}

#[test]
fn colab_work_w168_dashboard_search_space_collapse_and_inspector() {
    let now = 1_800_000_000_000;
    let mut document = owner_list(now);
    document["pages"][0]["summary"]["needsYou"] = json!(1);
    document["pages"][0]["summary"]["sections"] = json!([
        {"id": "h1", "title": "Protocol handshake", "level": 2, "done": 1, "total": 1, "state": "done"},
        {"id": "h2", "title": "Reconnect prompt", "level": 2, "done": 0, "total": 1, "state": "needs-you"}
    ]);
    let mut app = board();
    app.shell.tab = OpsTab::Work;
    app.work
        .apply(Instant::now(), List::decode(&document).map_err(Into::into));

    let draw = |app: &App| {
        let mut terminal = Terminal::new(TestBackend::new(120, 36)).unwrap();
        terminal
            .draw(|frame| crate::board::view::render(frame, app))
            .unwrap();
        terminal
            .backend()
            .buffer()
            .content
            .chunks(120)
            .map(|row| row.iter().map(|cell| cell.symbol()).collect::<String>())
            .collect::<Vec<_>>()
    };

    let lines = draw(&app);
    assert!(
        lines
            .iter()
            .any(|l| l.contains("Projects") && l.contains("chapters"))
    );
    assert!(lines.iter().any(|l| l.contains("Squad Pulse")));
    assert!(lines.iter().any(|l| l.contains("Detail · COLAB-119")));
    assert!(lines.iter().any(|l| l.contains("answer in Colab")));
    assert!(lines.iter().any(|l| l.contains("Protocol handshake")));
    assert!(
        lines.iter().any(|l| l.contains("—")),
        "unknown progress renders —"
    );

    // Space collapses the right detail inspector into full-width cards.
    key(&mut app, KeyCode::Char(' '));
    assert!(app.work.detail_collapsed);
    let collapsed = draw(&app);
    assert!(collapsed.iter().any(|l| l.contains("Space detail")));
    key(&mut app, KeyCode::Char(' '));
    assert!(!app.work.detail_collapsed);

    // Tab focuses the Detail Inspector; Down moves section cursor; Esc returns to list.
    key(&mut app, KeyCode::Tab);
    assert!(app.work.inspector_focused);
    key(&mut app, KeyCode::Down);
    assert_eq!(app.work.inspector_cursor, 1);
    key(&mut app, KeyCode::Esc);
    assert!(!app.work.inspector_focused);

    // `/` live search filters cards and Esc clears.
    key(&mut app, KeyCode::Char('/'));
    assert!(app.searching);
    for ch in "W-91".chars() {
        key(&mut app, KeyCode::Char(ch));
    }
    let filtered = draw(&app);
    assert!(filtered.iter().any(|l| l.contains("W-91")));
    assert!(!filtered.iter().any(|l| l.contains("CORE-88")));
    key(&mut app, KeyCode::Esc);
    assert!(!app.searching);
    assert!(app.search.is_empty());

    // `t` jumps to the bound owner's Talk tab in Agents.
    key(&mut app, KeyCode::Home);
    key(&mut app, KeyCode::Char('t'));
    assert_eq!(app.shell.tab, OpsTab::Agents);
    assert_eq!(app.right_tab, crate::board::shell::RightTab::Talk);
}

#[test]
fn colab_work_6809_section_progress_contract_and_narrow_widths() {
    let now: u64 = 1_800_000_000_000;
    let document = json!({
        "spaceId": "fixture",
        "projects": ["ops", "core"],
        "pages": [
            {
                "pageId": PAGE,
                "workNumber": "W-168",
                "title": "Work dashboard",
                "projects": ["ops"],
                "lastUpdateAtMs": now - 240_000,
                "link": "https://example.test/w168",
                "summary": {
                    "status": "needs-you",
                    "needsYou": 1,
                    "sectionProgress": {"done": 2, "inProgress": 1, "todo": 1, "unknown": 0, "total": 4},
                    "fields": {"owner": {"id": MEMBER, "name": "worker"}, "next": "Answer question"}
                }
            },
            {
                "pageId": OTHER,
                "workNumber": "W-169",
                "title": "No sections page",
                "projects": ["core"],
                "lastUpdateAtMs": now - 600_000,
                "link": "https://example.test/w169",
                "summary": {
                    "status": "working",
                    "fields": {"owner": {"id": MEMBER, "name": "worker"}}
                }
            }
        ]
    });
    let list = List::decode(&document).unwrap();
    assert_eq!(
        list.project_progress("ops"),
        Some(Progress { done: 2, total: 4 })
    );
    assert_eq!(list.project_progress("core"), None);

    let mut app = board();
    app.shell.tab = OpsTab::Work;
    app.work.apply(Instant::now(), Ok(list));

    for (width, height, expect_split) in [(100_u16, 36_u16, true), (80_u16, 30_u16, false)] {
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        terminal
            .draw(|frame| crate::board::view::render(frame, &app))
            .unwrap();
        let lines = terminal
            .backend()
            .buffer()
            .content
            .chunks(usize::from(width))
            .map(|row| row.iter().map(|cell| cell.symbol()).collect::<String>())
            .collect::<Vec<_>>();
        assert!(lines.iter().any(|l| l.contains("W-168")));
        assert!(lines.iter().any(|l| l.contains("—")));
        if expect_split {
            assert!(lines.iter().any(|l| l.contains("Detail · W-168")));
            assert!(
                lines
                    .iter()
                    .any(|l| l.contains("More sections in Colab · o open")),
                "sectionProgress without section rows renders muted Colab hint"
            );
        } else {
            assert!(!lines.iter().any(|l| l.contains("Detail · W-168")));
        }
    }
}
