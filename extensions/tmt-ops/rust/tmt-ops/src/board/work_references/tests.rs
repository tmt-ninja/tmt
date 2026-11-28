use super::*;
use crate::board::{
    app::App,
    app::workspace::tests::{MEMBER, ROOM, board, capture_case, disable_motion},
};
use serde_json::json;

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

pub(in crate::board) fn agents_work(look: crate::look::Look) -> App {
    let mut app = capture_case("agents", look);
    disable_motion(&mut app);
    app.local_zone = Some(jiff::tz::TimeZone::UTC);
    let mut pages = owner_list(crate::status::now_ms());
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
    app.work.apply(
        Instant::now(),
        Snapshot::decode(&pages).map_err(|_| ReadFailure::Unavailable),
    );
    app
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
    let snapshot = Snapshot::decode(&body).unwrap();
    let (binding, count) = snapshot.bindings(&roster)[MEMBER];
    assert_eq!(binding.chip(count), "✗ COLAB-119 +1");
    let mut duplicate = roster.members[MEMBER].clone();
    duplicate.id = DONE.into();
    roster.members.insert(DONE.into(), duplicate);
    let (binding, count) = snapshot.bindings(&roster)[MEMBER];
    assert_eq!(binding.chip(count), "✗ COLAB-119");
}

#[test]
fn colab_open_requires_the_exact_block_and_falls_back_only_for_html_pages() {
    use crate::{
        core::Core,
        test_support::{Scratch, write_ready_executable},
    };
    use std::fs;

    let scratch = Scratch::new("colab-work-open");
    let executable = scratch.join("tmt");
    let calls = scratch.join("calls");
    let response = scratch.join("response");
    let page_link = "https://example.test/colab/p/33333333";
    let page_response = json!({"pageId": PAGE, "running": true, "link": page_link});
    fs::write(scratch.join("page"), page_response.to_string()).unwrap();
    write_ready_executable(
        &executable,
        r#"#!/bin/sh
cd "$(dirname "$0")" || exit 2
printf '%s\n' "$*" >> calls
case "$4" in
    --block=*) cat response; [ ! -f refuse ];;
    *) cat page;;
esac
"#,
    );
    let core = Core::at(executable);
    let target = OpenTarget {
        page: PAGE.into(),
        block: Some("chapter".into()),
    };
    let block_call = format!("colab open {PAGE} --block=chapter --json\n");
    let anchor = format!("{page_link}#anchor=block-chapter");
    fs::write(
        &response,
        json!({"pageId": PAGE, "running": true, "link": anchor}).to_string(),
    )
    .unwrap();
    assert_eq!(
        open_link(&core, &target),
        Ok((anchor, "Opened Colab block."))
    );
    assert_eq!(fs::read_to_string(&calls).unwrap(), block_call);

    fs::write(&calls, "").unwrap();
    fs::write(&response, page_response.to_string()).unwrap();
    assert_eq!(
        open_link(&core, &target),
        Err("Colab did not confirm the selected block.".into())
    );
    assert_eq!(fs::read_to_string(&calls).unwrap(), block_call);

    fs::write(scratch.join("refuse"), "").unwrap();
    for (code, message, expected, expected_calls) in [
        (
            "COLAB_BLOCK_NOT_FOUND",
            "Colab refused this block.",
            Err("Colab refused this block.".into()),
            block_call.clone(),
        ),
        (
            "COLAB_INPUT_INVALID",
            "The --block ID is invalid.",
            Err("The --block ID is invalid.".into()),
            block_call.clone(),
        ),
        (
            "COLAB_NOT_STRUCTURED",
            "Colab refused this block.",
            Ok((page_link.into(), "Opened Colab page.")),
            format!("{block_call}colab open {PAGE} --json\n"),
        ),
        (
            "COLAB_INPUT_INVALID",
            "error: unexpected argument '--block' found\n\nUsage: tmt colab open <page>",
            Ok((
                page_link.into(),
                "Opened the page; this Colab cannot open a section",
            )),
            format!("{block_call}colab open {PAGE} --json\n"),
        ),
    ] {
        fs::write(&calls, "").unwrap();
        fs::write(
            &response,
            json!({"error":{"code":code,"message":message}}).to_string(),
        )
        .unwrap();
        assert_eq!(open_link(&core, &target), expected);
        assert_eq!(fs::read_to_string(&calls).unwrap(), expected_calls);
    }
}

#[test]
fn colab_work_rate_limits_normal_reads_and_coalesces_explicit_refreshes() {
    let mut state = State::default();
    let now = Instant::now();
    let delivered =
        || Snapshot::decode(&owner_list(1_800_000_000_000)).map_err(|_| ReadFailure::Unavailable);
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
            Snapshot::decode(&owner_list(1_800_000_000_000)).map_err(|_| ReadFailure::Unavailable),
        );
        assert!(state.request(later + Duration::from_secs(60)));
    }
}
