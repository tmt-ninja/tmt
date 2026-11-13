use super::*;
use serde_json::{Value, json};
const MEMBER: &str = "10000000-0000-4000-8000-000000000001";
fn source() -> Value {
    json!({"kind":"base","planId":null,"identityId":null,"revision":1,"slot":null,"defaulted":false})
}
/// Handwritten public wire facts, independent of Core's resolver and storage.
fn document() -> Value {
    let field = |value| json!({"value":value,"source":source()});
    let mut receiving = field(json!({"mode":"batch","intervalMs":1800000}));
    receiving["available"] = true.into();
    json!({"schemaVersion":1,"configurationRevision":0,"receivingRevision":1,
        "observedAtMs":1000,"atMs":1000,"timeZone":"UTC","range":{"startMs":0,"endMs":3000},
        "plans":[],"members":[{"identityId":MEMBER,"name":"worker","activePlans":[],"nextChangeAtMs":2000,"jobs":null,
        "effective":{"state":field(json!("low")),"receiving":receiving,"sending":field(json!("anyone")),
        "routine":field(json!("run")),"talkLimit":field(Value::Null)}}],
        "timeline":[{"startMs":0,"endMs":2000,"planIds":[]},{"startMs":2000,"endMs":3000,"planIds":[]}]})
}
fn ready() -> model::Snapshot {
    model::Snapshot::new(
        model::Overview::decode(document()).unwrap(),
        model::Sending::default(),
        true,
        Ok(None),
    )
    .unwrap()
}
fn state() -> State {
    let mut state = State::default();
    state.query.at_ms = 1000;
    state
}
#[test]
fn overview_uses_one_public_read_for_every_table_and_inspector_fact() {
    let read = state().read();
    let mut calls = Vec::new();
    let observation = read.read_with(|op, input| {
        calls.push((op.to_owned(), input.clone()));
        Ok(match (op, input["view"].as_str()) {
            ("capabilities", _) => {
                json!({"operations":["orchestration.read","orchestration.write"]})
            }
            (_, Some("routes")) => json!({"routes":[],"nextAfter":null}),
            (_, Some("talks")) => json!({"pairs":[]}),
            (_, Some("jobs")) if input["cursor"].is_null() => {
                let mut page = jobs();
                page["nextCursor"] = "c1".into();
                page
            }
            (_, Some("jobs")) => json!({"jobs":[],"nextCursor":null}),
            _ => document(),
        })
    });
    let Observation::Ready(snapshot) = observation else {
        panic!("valid public observation")
    };
    assert!(snapshot.writes);
    assert!(
        snapshot
            .sending
            .routes
            .as_ref()
            .is_some_and(|r| r.is_empty())
    );
    assert_eq!(
        snapshot.document.members[0]
            .effective
            .receiving
            .value
            .as_ref()
            .unwrap()
            .label(),
        "batch 30m"
    );
    assert_eq!(
        calls,
        vec![
            ("capabilities".into(), json!({})),
            (
                "orchestration.read".into(),
                json!({"view":"overview","rangeDays":1,"atMs":1000})
            ),
            (
                "orchestration.read".into(),
                json!({"view":"routes","limit":256})
            ),
            (
                "orchestration.read".into(),
                json!({"view":"talks","limit":256})
            ),
            // Jobs: one list read per page, never a read per job.
            (
                "orchestration.read".into(),
                json!({"view":"jobs","limit":64,"cursor":null})
            ),
            (
                "orchestration.read".into(),
                json!({"view":"jobs","limit":64,"cursor":"c1"})
            ),
        ]
    );
    // Ordered by next run (a held job by its hold's end), then paused; a held job names why.
    let listed = snapshot.jobs.listed().unwrap();
    assert_eq!(
        listed
            .rows
            .iter()
            .map(|job| (job.display_id.as_str(), job.next_ms()))
            .collect::<Vec<_>>(),
        vec![
            ("j2", Some(2000)),
            ("j1", Some(2500)),
            ("j4", Some(2900)),
            ("j3", None)
        ]
    );
    assert!(!listed.more);
    assert!(listed.rows[3].key.is_some() && listed.rows[2].key.is_none());
    // A jobs read that fails, or a job row Core sends that does not read, stays in the Jobs
    // section: the matrix and Talks still show, Jobs names the reason with its retry key, and
    // the job keys answer with that reason.
    let mut bad_row = jobs();
    bad_row["jobs"][0]["state"] = "unknown".into();
    for (failure, reason) in [
        (
            Err(crate::core::SquadError::new(
                "CORE_TIMEOUT",
                "Core timed out.",
            )),
            "Core timed out.",
        ),
        (Ok(bad_row), "Invalid Core job row."),
    ] {
        let mut app = matrix_app();
        let snapshot = observe(|op, input| match input["view"].as_str() {
            Some("jobs") => failure.clone(),
            _ => pair_api(op, input),
        });
        app.orchestration.apply(
            app.orchestration.read(),
            Observation::Ready(Box::new(snapshot)),
        );
        let painted = screen(&app);
        assert!(painted.contains("Who may message whom"), "{reason}");
        assert!(painted.contains("Talks this hour"), "{reason}");
        assert!(
            painted.contains(&format!("✕ Could not read jobs · {reason}")),
            "{reason}"
        );
        assert!(painted.contains("Retry"), "{reason}");
        for _ in 0..2 {
            app.key(ratatui::crossterm::event::KeyEvent::new(
                ratatui::crossterm::event::KeyCode::Tab,
                ratatui::crossterm::event::KeyModifiers::NONE,
            ));
        }
        assert_eq!(app.orchestration.focus(), super::Section::Jobs);
        app.key(ratatui::crossterm::event::KeyEvent::new(
            ratatui::crossterm::event::KeyCode::Char('n'),
            ratatui::crossterm::event::KeyModifiers::NONE,
        ));
        assert!(app.confirm.is_none());
        assert_eq!(
            app.notice.as_deref(),
            Some(format!("Could not read jobs · {reason}").as_str())
        );
    }
    // The range keys change the one overview read's range.
    let mut app = matrix_app();
    for (press, days) in ['7', '0', 'd'].into_iter().zip([7, 30, 1]) {
        app.key(ratatui::crossterm::event::KeyEvent::new(
            ratatui::crossterm::event::KeyCode::Char(press),
            ratatui::crossterm::event::KeyModifiers::NONE,
        ));
        assert_eq!(app.orchestration.read().query.input()["rangeDays"], days);
    }
}
#[test]
fn unsupported_core_is_not_an_empty_or_direct_observation() {
    let observation = state().read().read_with(|op, _| {
        assert_eq!(op, "capabilities");
        Ok(json!({"operations":["responses.timeline"]}))
    });
    assert!(matches!(observation, Observation::Unavailable));
}
#[test]
fn malformed_receiving_or_missing_unlimited_value_is_visible_failure() {
    for field in ["receiving", "talkLimit", "state"] {
        let mut wire = document();
        wire["members"][0]["effective"][field]
            .as_object_mut()
            .unwrap()
            .remove("value");
        let result = model::Overview::decode(wire);
        assert!(result.is_err(), "missing {field} cannot invent a default");
    }
    let mut wire = document();
    wire["members"][0]["effective"]["state"]["value"] = "future-state".into();
    assert!(model::Overview::decode(wire).is_err());
}
#[test]
fn unpublished_receiving_keeps_proposed_separate_from_available() {
    let mut wire = document();
    wire["receivingRevision"] = 0.into();
    let receiving = &mut wire["members"][0]["effective"]["receiving"];
    receiving["available"] = false.into();
    receiving["value"] = Value::Null;
    receiving["proposedValue"] = json!({"mode":"direct"});
    let parsed = model::Overview::decode(wire).unwrap();
    let receiving = &parsed.members[0].effective.receiving;
    assert!(!receiving.available);
    assert!(receiving.value.is_none());
    assert_eq!(receiving.proposed_value.as_ref().unwrap().label(), "direct");
}
#[test]
fn late_query_or_cursor_results_cannot_replace_the_active_observation() {
    let mut state = state();
    let original = state.read();
    state.apply(original.clone(), Observation::Ready(Box::new(ready())));
    state.query.member = "another".into();
    state.apply(original, Observation::Failed("old failure".into()));
    assert!(state.snapshot().is_none());
    assert!(state.failure.is_none());
    let prior = state.read();
    state.observe_cursor(Some(8));
    state.apply(prior, Observation::Ready(Box::new(ready())));
    assert!(state.snapshot().is_none());
}
#[test]
fn failed_refresh_retains_the_same_queries_last_good_data_with_its_error() {
    let mut state = state();
    let read = state.read();
    state.apply(read.clone(), Observation::Ready(Box::new(ready())));
    state.apply(read, Observation::Failed("Core unavailable".into()));
    assert_eq!(state.snapshot().unwrap().document.observed_at_ms, 1000);
    assert_eq!(state.failure.as_deref(), Some("Core unavailable"));
}
#[test]
fn a_slot_boundary_requests_one_new_read_without_a_cursor_change() {
    let mut state = state();
    state.apply(state.read(), Observation::Ready(Box::new(ready())));
    assert!(!state.tick(1999));
    assert!(state.tick(2000));
    assert_eq!(state.query.at_ms, 2000);
    assert!(!state.tick(2001), "the pending boundary read must not spin");
    state.follow_now = false;
    assert!(!state.tick(4000), "a historical selection stays fixed");

    // `[` before the first boundary of the held range reads the previous day once and lands on
    // its last change; with no change there the selection stays, with no further read.
    let day = |start: u64, end: u64, at: u64, timeline: Value| {
        let mut wire = document();
        wire["range"] = json!({"startMs":start,"endMs":end});
        wire["atMs"] = at.into();
        wire["observedAtMs"] = at.into();
        wire["members"][0]["nextChangeAtMs"] = Value::Null;
        wire["timeline"] = timeline;
        model::Snapshot::new(
            model::Overview::decode(wire).unwrap(),
            model::Sending::default(),
            true,
            Ok(None),
        )
        .unwrap()
    };
    let today = || {
        day(
            1000,
            3000,
            1000,
            json!([{"startMs":1000,"endMs":3000,"planIds":[]}]),
        )
    };
    for (earlier, lands_on, note) in [
        (
            json!([{"startMs":1,"endMs":500,"planIds":[]},{"startMs":500,"endMs":1000,"planIds":[]}]),
            500,
            None,
        ),
        (json!([]), 1000, Some("no earlier change")),
    ] {
        let mut state = self::state();
        state.apply(state.read(), Observation::Ready(Box::new(today())));
        let original = state.read();
        assert!(state.step(false), "the edge step asks for the previous day");
        assert_eq!(state.query.at_ms, 999);
        assert!(state.snapshot().is_none(), "one read is pending");
        state.apply(
            state.read(),
            Observation::Ready(Box::new(day(1, 1000, 999, earlier))),
        );
        assert_eq!(state.query.at_ms, lands_on);
        assert_eq!(state.note.as_deref(), note);
        // Landing on a change leaves now; finding none keeps following it, as before the step.
        assert_eq!(state.follow_now, note.is_some());
        if note.is_some() {
            assert!(
                state.read() == original && state.snapshot().is_some(),
                "no further read"
            );
        }
    }
    // A time the person chooses while the edge read is pending wins over that read: a strip
    // click, now or another range drops the pending step.
    let earlier = || {
        day(
            1,
            1000,
            999,
            json!([{"startMs":1,"endMs":500,"planIds":[]}]),
        )
    };
    for choose in [
        (|s: &mut State| s.at(1500)) as fn(&mut State),
        |s| s.now(2500),
        |s| s.range(7),
    ] {
        let mut state = self::state();
        state.apply(state.read(), Observation::Ready(Box::new(today())));
        assert!(state.step(false));
        choose(&mut state);
        let chosen = state.query.clone();
        state.apply(state.read(), Observation::Ready(Box::new(earlier())));
        assert_eq!(state.query, chosen, "the chosen time stays");
        assert!(state.note.is_none());
    }
}
#[test]
fn first_orchestration_demand_does_not_need_a_workspace_snapshot() {
    let mut app = super::super::app::App::default();
    assert!(app.shell.select_digit(
        '3',
        super::super::shell::OpsInputOwner::List,
        &mut app.workspace.selected
    ));
    assert!(app.view.is_none());
    assert!(matches!(
        app.selected_read(),
        Some(super::super::refresh::SelectedRead::Orchestration(_))
    ));
}
#[test]
fn held_rendering_does_no_core_io_and_never_fabricates_jobs_or_routes() {
    let mut app = super::super::app::App::default();
    app.shell.select_digit(
        '3',
        super::super::shell::OpsInputOwner::List,
        &mut app.workspace.selected,
    );
    app.orchestration = state();
    app.orchestration.apply(
        app.orchestration.read(),
        Observation::Ready(Box::new(ready())),
    );
    let _commands = crate::runner::forbid_commands();
    let mut terminal = ratatui::Terminal::new(ratatui::backend::TestBackend::new(160, 36)).unwrap();
    terminal
        .draw(|frame| super::super::view::render(frame, &app))
        .unwrap();
    let text = terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|c| c.symbol())
        .collect::<String>();
    assert!(text.contains("batch 30m"));
    // Jobs arrive with their own section; nothing stands in for them meanwhile.
    assert!(!text.contains("Jobs"), "{text}");
    assert!(!text.contains("0 jobs"));
    // People read names, short times and where a value comes from, never identities or revisions.
    assert!(!text.contains("10000000-"), "{text}");
    assert!(!text.contains("revision"), "{text}");
    assert!(
        text.contains("Orchestration · Thu 00:00 UTC · ● following now"),
        "{text}"
    );
    let rows: Vec<String> = text
        .chars()
        .collect::<Vec<_>>()
        .chunks(160)
        .map(|row| row.iter().collect())
        .collect();
    assert!(
        rows.iter()
            .any(|row| row.contains("State") && row.contains("← Base")),
        "one line per field with its source: {text}"
    );
}

const OTHER: &str = "10000000-0000-4000-8000-000000000002";
/// Two members; `worker` may message only leads, so its route to `peer` is blocked.
fn pair_document() -> Value {
    let mut value = document();
    let mut peer = value["members"][0].clone();
    peer["identityId"] = OTHER.into();
    peer["name"] = "peer".into();
    peer["effective"]["receiving"]["value"] = json!({"mode":"direct"});
    value["members"].as_array_mut().unwrap().push(peer);
    value
}
fn routes() -> Value {
    json!({"routes":[
        {"from":MEMBER,"fromName":"worker","to":OTHER,"toName":"peer","verdict":"blocked","source":source()},
        {"from":OTHER,"fromName":"peer","to":MEMBER,"toName":"worker","verdict":"needs_person","source":source()}
    ],"nextAfter":null})
}
fn talks() -> Value {
    json!({"pairs":[{"members":[
        {"identityId":MEMBER,"name":"worker","talkLimit":{"value":2,"source":source()}},
        {"identityId":OTHER,"name":"peer","talkLimit":{"value":null,"source":source()}}],
        "count":2,"limit":2,"lastAtMs":900,"windowStartMs":0,"state":"held","heldCount":1,"held":[]}]})
}
const JOB_ROOM: &str = "40000000-0000-4000-8000-000000000001";
/// One Core job row as the public `jobs` view lists it; callers patch the state they need.
fn job(number: u64, owner: Option<(&str, &str)>, title: &str, schedule: &str) -> Value {
    let schedule = crate::cron_service::parse_schedule_text(schedule, "Asia/Tokyo", 0)
        .unwrap()
        .document();
    json!({"jobId":format!("30000000-0000-4000-8000-{number:012}"),"displayId":format!("j{number}"),
        "revision":2,"legacy":{"roomId":JOB_ROOM,"cronId":number},
        "target":{"squadRoomId":JOB_ROOM,"identityId":owner.map(|o| o.0),"identityName":owner.map(|o| o.1)},
        "title":title,"messagePreview":format!("{title}: list open PRs, oldest first."),
        "schedule":schedule,"state":if owner.is_some() { "on" } else { "no_owner" },
        "manualPause":null,"heldSlot":null,"routine":null,"nextRunAtMs":null,"lastRun":null})
}
/// The pair's jobs: worker's held by its focus until 2500, peer's ready, a paused one and one
/// made with `tmt orch job` (no Ops key).
fn jobs() -> Value {
    let mut held = job(1, Some((MEMBER, "worker")), "Queue review", "every 30m");
    held["state"] = "held".into();
    held["routine"] = json!({"value":"hold","source":{"kind":"focus","planId":null,"identityId":MEMBER,
        "revision":1,"slot":{"startMs":1000,"endMs":2500},"defaulted":false}});
    held["nextRunAtMs"] = 1800.into();
    held["lastRun"] = json!({"recordedAtMs":900,"acceptance":"queued"});
    let mut ready = job(2, Some((OTHER, "peer")), "UI check", "every 1h");
    ready["nextRunAtMs"] = 2000.into();
    let mut paused = job(3, Some((OTHER, "peer")), "Archive review", "daily 23:30");
    paused["state"] = "paused".into();
    paused["manualPause"] = json!({"by":MEMBER,"atMs":500});
    let mut native = job(
        4,
        Some((MEMBER, "worker")),
        "Weekly report",
        "weekdays 09:00",
    );
    native["legacy"] = Value::Null;
    native["nextRunAtMs"] = 2900.into();
    json!({"schemaVersion":1,"observedAtMs":1000,"configurationRevision":0,
        "jobs":[paused, native, ready, held],"nextCursor":null,"historyCoverage":"recorded_only"})
}
fn observe(
    api: impl FnMut(&str, Value) -> Result<Value, crate::core::SquadError>,
) -> model::Snapshot {
    let Observation::Ready(snapshot) = state().read().read_with(api) else {
        panic!("ready observation")
    };
    *snapshot
}
fn pair_api(op: &str, input: Value) -> Result<Value, crate::core::SquadError> {
    Ok(match (op, input["view"].as_str()) {
        ("capabilities", _) => json!({"operations":["orchestration.read","orchestration.write"]}),
        (_, Some("routes")) => routes(),
        (_, Some("talks")) => talks(),
        (_, Some("jobs")) => jobs(),
        _ => pair_document(),
    })
}
#[test]
fn an_older_core_without_sending_views_reads_them_as_not_available() {
    let snapshot = observe(|op, input| match (op, input["view"].as_str()) {
        ("capabilities", _) => Ok(json!({"operations":["orchestration.read"]})),
        (_, Some("routes" | "talks" | "jobs")) => Err(crate::core::SquadError::new(
            "ORCH_INPUT_INVALID",
            "Invalid orchestration input or calendar selection.",
        )),
        _ => Ok(document()),
    });
    assert!(snapshot.sending.routes.is_none());
    assert!(snapshot.sending.talks.is_none());
    assert!(
        matches!(snapshot.jobs, model::Jobs::Unavailable),
        "no jobs view: not an empty list"
    );
}
#[test]
fn routes_pages_follow_next_after_until_core_says_the_end() {
    let mut pages = Vec::new();
    let snapshot = observe(|op, input| {
        if input["view"] == "routes" {
            pages.push(input["after"].clone());
            return Ok(if input["after"].is_null() {
                json!({"routes":[routes()["routes"][0].clone()],"nextAfter":"k1"})
            } else {
                json!({"routes":[routes()["routes"][1].clone()],"nextAfter":null})
            });
        }
        pair_api(op, input)
    });
    assert_eq!(pages, vec![Value::Null, json!("k1")]);
    assert_eq!(snapshot.sending.routes.as_ref().unwrap().len(), 2);
    assert!(!snapshot.sending.truncated);
}
fn matrix_app() -> super::super::app::App {
    let mut app = super::super::app::App::default();
    app.shell.select_digit(
        '3',
        super::super::shell::OpsInputOwner::List,
        &mut app.workspace.selected,
    );
    app.orchestration = state();
    let snapshot = observe(pair_api);
    app.orchestration.apply(
        app.orchestration.read(),
        Observation::Ready(Box::new(snapshot)),
    );
    app
}
fn screen(app: &super::super::app::App) -> String {
    let mut terminal = ratatui::Terminal::new(ratatui::backend::TestBackend::new(160, 36)).unwrap();
    terminal
        .draw(|frame| super::super::view::render(frame, app))
        .unwrap();
    terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|c| c.symbol())
        .collect()
}
#[test]
fn the_matrix_paints_core_verdicts_and_the_held_pair_without_reads() {
    let app = matrix_app();
    assert_eq!(app.orchestration.target.as_deref(), Some(OTHER));
    let _commands = crate::runner::forbid_commands();
    let text = screen(&app);
    assert!(text.contains("From ↓ To →"));
    assert!(text.contains("✕"));
    assert!(text.contains("◆"));
    assert!(text.contains("◆ held"));
    assert!(text.contains("✕ not sent, explained"));
    for (name, look) in crate::board::home::tests::oracle::looks() {
        let app = captures::case("orchestration-matrix", look);
        let buffer = paint(&app, 160, 36);
        let header = find(&buffer, "From ↓ To →").expect("matrix header");
        let (worker, peer) = (header.1 + 1, header.1 + 2);
        let name_cell = |y| buffer[(header.0, y)].style();
        assert_ne!(
            name_cell(worker),
            name_cell(peer),
            "{name}: selected row is visible"
        );
        let blocked = find_in_row(&buffer, worker, "✕").expect("worker → peer is blocked");
        let held = find_in_row(&buffer, peer, "◆").expect("peer → worker needs a person");
        let selected_cell = buffer[(blocked, worker)].style();
        assert_ne!(
            selected_cell,
            name_cell(worker),
            "{name}: selected cell stands out of its row"
        );
        assert_ne!(
            selected_cell,
            buffer[(held, peer)].style(),
            "{name}: selected cell is unique"
        );
        if let Some(waiting) = look.role(tmt_cli_style::Role::Waiting).fg {
            assert_eq!(buffer[(held, peer)].fg, waiting, "{name}: ◆ is Waiting");
        }
        // A reverse-video selection keeps one foreground; a coloured one keeps the verdict's.
        if look.selection().bg.is_some() {
            let blocked_fg = look.role(tmt_cli_style::Role::Blocked).fg.unwrap();
            assert_eq!(
                buffer[(blocked, worker)].fg,
                blocked_fg,
                "{name}: ✕ is Blocked"
            );
        }
    }
}
fn paint(app: &super::super::app::App, width: u16, height: u16) -> ratatui::buffer::Buffer {
    let mut terminal =
        ratatui::Terminal::new(ratatui::backend::TestBackend::new(width, height)).unwrap();
    terminal
        .draw(|frame| super::super::view::render(frame, app))
        .unwrap();
    terminal.backend().buffer().clone()
}
fn row_text(buffer: &ratatui::buffer::Buffer, y: u16) -> Vec<(u16, String)> {
    (0..buffer.area.width)
        .map(|x| (x, buffer[(x, y)].symbol().to_owned()))
        .collect()
}
/// The first cell of the list column (left of the inspector) where `needle` starts.
fn find(buffer: &ratatui::buffer::Buffer, needle: &str) -> Option<(u16, u16)> {
    (0..buffer.area.height).find_map(|y| {
        find_in_row(buffer, y, needle)
            .filter(|x| *x < buffer.area.width * 45 / 100)
            .map(|x| (x, y))
    })
}
fn find_in_row(buffer: &ratatui::buffer::Buffer, y: u16, needle: &str) -> Option<u16> {
    let cells = row_text(buffer, y);
    let wanted: Vec<String> = needle.chars().map(String::from).collect();
    cells
        .windows(wanted.len())
        .find(|w| w.iter().zip(&wanted).all(|((_, a), b)| a == b))
        .map(|w| w[0].0)
}
/// A list row's selection: the first and second rows that start with these names differ.
fn assert_selected_row_differs(scene: &str, first: &str, second: &str) {
    for (name, look) in crate::board::home::tests::oracle::looks() {
        let buffer = paint(&captures::case(scene, look), 160, 36);
        let a = find(&buffer, first).unwrap_or_else(|| panic!("{scene}: {first}"));
        let b = find(&buffer, second).unwrap_or_else(|| panic!("{scene}: {second}"));
        assert_ne!(
            buffer[a].style(),
            buffer[b].style(),
            "{scene} {name}: the selected row is visible at {a:?} {b:?}\n{}",
            (0..12)
                .map(|y| row_text(&buffer, y)
                    .into_iter()
                    .map(|(_, s)| s)
                    .collect::<String>())
                .collect::<Vec<_>>()
                .join("\n")
        );
    }
}
#[test]
fn the_selected_plan_and_member_rows_are_visible_in_every_look() {
    assert_selected_row_differs(
        "orchestration-plans",
        "Shift B · Night night-*",
        "Quiet hours     everyone",
    );
    assert_selected_row_differs("orchestration-table-selection", "worker", "peer");
    assert_selected_row_differs("orchestration-jobs", "j1 core-1", "j2 gui-1");
    // The plans list says when and for whom in words; the inspector reads Core's matches, its
    // span around the selected time and the next start in the range; the strip names only the
    // selected plan's spans.
    let app = captures::case("orchestration-plans", crate::look::Look::default());
    let painted = screen(&app);
    for text in [
        "weekdays 22:00–06:00",
        "every day 22:00–08:00",
        "Mon Wed 09:00–18:00 · every 2 weeks",
        "○ Shift A · Day   core-1, gui-1",
        "night-1, night-2  (night-*)",
        "state Awake · sending leads only",
        "in effect until Thu 06:00",
        "not in this range · 7 widens",
        "Effect at 23:00 · 2 members",
        "Plans · 3",
        "2 in effect",
    ] {
        assert!(painted.contains(text), "{text}");
    }
    let strip = row_text(&paint(&app, 160, 36), 5)
        .into_iter()
        .map(|(_, s)| s)
        .collect::<String>();
    assert!(
        strip.contains(" Shift B · Night") && !strip.contains("Quiet hours") && strip.contains('·'),
        "{strip}"
    );
    // With the plans list closed, the strip counts plans again.
    let mut app = app;
    app.orchestration.plans = false;
    let strip = row_text(&paint(&app, 160, 36), 5)
        .into_iter()
        .map(|(_, s)| s)
        .collect::<String>();
    assert!(!strip.contains("Shift B") && strip.contains('2'), "{strip}");
}
#[test]
fn allow_once_previews_core_route_allow_until_the_slot_ends_and_only_for_a_blocked_cell() {
    use super::super::app::Effect;
    use super::write::{Step, Task};
    let mut app = matrix_app();
    let key = |c| {
        ratatui::crossterm::event::KeyEvent::new(
            ratatui::crossterm::event::KeyCode::Char(c),
            ratatui::crossterm::event::KeyModifiers::NONE,
        )
    };
    let Some(Effect::Orchestration(Task {
        step: Step::Preview { mutation, .. },
    })) = Some(app.key(key('a')))
    else {
        panic!("allow once starts Core's preview")
    };
    assert_eq!(
        mutation,
        json!({"kind":"route.allow","fromId":MEMBER,"toId":OTHER,"untilMs":2000})
    );
    // The reverse route is held, not blocked: nothing to allow, a notice instead.
    app.orchestration.selected = Some(OTHER.into());
    app.orchestration.target = Some(MEMBER.into());
    assert!(matches!(Some(app.key(key('a'))), Some(Effect::None)));
    let Some(Effect::Orchestration(Task {
        step: Step::Preview { mutation, .. },
    })) = Some(app.key(key('r')))
    else {
        panic!("resume starts Core's preview for a held pair")
    };
    assert_eq!(
        mutation,
        json!({"kind":"talks.resume","aId":OTHER,"bId":MEMBER})
    );
    // `o` on a plan previews `plan.set` with only `enabled` flipped; `e` names the command.
    let mut app = captures::case("orchestration-plans", crate::look::Look::default());
    let plan = app.orchestration.snapshot().unwrap().document.plans[0].clone();
    let Some(Effect::Orchestration(Task {
        step: Step::Preview { title, mutation },
    })) = Some(app.key(key('o')))
    else {
        panic!("o starts Core's preview")
    };
    assert_eq!(title, "Turn off Shift B · Night");
    let mut candidate = plan.clone();
    candidate["enabled"] = false.into();
    assert_eq!(
        mutation,
        json!({"kind":"plan.set","plan":plan["id"],"candidate":candidate})
    );
    assert!(matches!(app.key(key('e')), Effect::None));
    assert_eq!(
        app.notice.as_deref(),
        Some(
            "Edit with tmt orch plan set \"Shift B · Night\" --file plan.json (its current plan: tmt orch plan show \"Shift B · Night\" --json)"
        )
    );
}
#[test]
fn a_confirmed_preview_applies_exactly_it_and_a_conflict_saves_nothing() {
    use super::super::app::Effect;
    use super::write::{Completed, Step, Task};
    let mut app = matrix_app();
    let preview = json!({"mutation":{"kind":"focus.clear","identityId":MEMBER},"configurationRevision":3,
        "previewAtMs":1000,"previewDigest":"d","changes":[{"identityId":MEMBER,"fields":["state"]}]});
    app.finished_orchestration(Completed {
        task: Task {
            step: Step::Preview {
                title: "End worker's focus".into(),
                mutation: json!({}),
            },
        },
        result: Ok(preview.clone()),
    });
    assert_eq!(app.confirm.as_ref().unwrap().title(), "End worker's focus");
    let applied = app.choose(super::super::app::Choice::OrchestrationApply(Box::new(
        preview.clone(),
    )));
    assert!(matches!(
        applied,
        Effect::Orchestration(Task { step: Step::Apply(ref p) }) if **p == preview
    ));
    let effect = app.finished_orchestration(Completed {
        task: Task {
            step: Step::Apply(Box::new(preview)),
        },
        result: Err(crate::core::SquadError::new("ORCH_CONFLICT", "changed")),
    });
    assert!(matches!(effect, Effect::None));
    assert!(
        app.notice
            .as_deref()
            .is_some_and(|n| n.contains("nothing was saved"))
    );
}

#[test]
fn the_footer_is_fitted_from_bound_keys_and_keeps_help_at_every_width() {
    let app = matrix_app();
    for width in [160u16, 100, 80, 60] {
        let mut terminal =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(width, 36)).unwrap();
        terminal
            .draw(|frame| super::super::view::render(frame, &app))
            .unwrap();
        let buffer = terminal.backend().buffer();
        let last: String = (0..width)
            .map(|x| buffer[(x, 35)].symbol().to_owned())
            .collect();
        assert!(last.contains("? help"), "{width}: {last}");
        if width >= 100 {
            assert!(last.contains("a allow once"), "{width}: {last}");
        }
    }
    // The keys are the tab's own scope, listed by help and open to rebinding.
    assert_eq!(
        app.workspace_scope(),
        crate::config::OpsKeyScope::Orchestration
    );
    let bindings = app.bindings();
    assert_eq!(bindings["r"].text, "release-held");
    assert_eq!(bindings["a"].text, "allow-once");
    // Tab moves Who may message whom → Talks → Jobs → back; the footer offers only what the
    // focused section does.
    let mut app = app;
    let tab = ratatui::crossterm::event::KeyEvent::new(
        ratatui::crossterm::event::KeyCode::Tab,
        ratatui::crossterm::event::KeyModifiers::NONE,
    );
    let footer = |app: &super::super::app::App| {
        let buffer = paint(app, 160, 36);
        row_text(&buffer, 35)
            .into_iter()
            .map(|(_, s)| s)
            .collect::<String>()
    };
    let mut seen = Vec::new();
    for _ in 0..3 {
        app.key(tab);
        seen.push(app.orchestration.focus());
    }
    assert_eq!(
        seen,
        vec![
            super::Section::Talks,
            super::Section::Jobs,
            super::Section::Routes
        ]
    );
    app.key(tab);
    app.key(tab);
    let jobs = footer(&app);
    for hint in [
        "↑↓ job",
        "Tab section",
        "p pause",
        "x run now",
        "e edit",
        "n new",
        "? help",
    ] {
        assert!(jobs.contains(hint), "{hint}: {jobs}");
    }
    assert!(
        !jobs.contains("allow once") && !jobs.contains("[ earlier"),
        "{jobs}"
    );
    // ⏎ on a plan shows only the members it applies to, named as such; ⏎ again shows all. A read
    // that no longer lists the plan shows all members with a note.
    let enter = ratatui::crossterm::event::KeyEvent::new(
        ratatui::crossterm::event::KeyCode::Enter,
        ratatui::crossterm::event::KeyModifiers::NONE,
    );
    let mut plans = captures::case("orchestration-plans", crate::look::Look::default());
    let plans_footer = footer(&plans);
    for hint in [
        "↑↓ plan",
        "its members",
        "o on/off",
        "e edit",
        "P members",
        "? help",
    ] {
        assert!(plans_footer.contains(hint), "{hint}: {plans_footer}");
    }
    plans.key(enter);
    assert!(!plans.orchestration.plans);
    let only = screen(&plans);
    assert!(only.contains("members of Shift B · Night"), "{only}");
    let members = |app: &super::super::app::App| {
        let snapshot = app.orchestration.snapshot().unwrap();
        app.orchestration
            .members(snapshot)
            .iter()
            .map(|m| m.name.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(members(&plans), ["night-1", "night-2"]);
    assert!(footer(&plans).contains("all members"));
    plans.key(enter);
    assert_eq!(members(&plans).len(), 12);
    plans.key(enter);
    plans.orchestration.plans = true;
    plans.key(enter);
    let mut snapshot = plans.orchestration.snapshot().unwrap().clone();
    snapshot.document.plans.clear();
    snapshot.plan_rows.clear();
    let read = plans.orchestration.read();
    plans
        .orchestration
        .apply(read, Observation::Ready(Box::new(snapshot)));
    assert!(plans.orchestration.only_plan.is_none());
    assert_eq!(
        plans.orchestration.note.as_deref(),
        Some("that plan is gone · all members")
    );
    // Every section offers at most eight hints, its own keys first: board-wide quit yields
    // before them, and End focus while no focus is active.
    let hints = |line: &str| line.split("  ").filter(|h| !h.trim().is_empty()).count();
    assert!(hints(&jobs) <= 8, "{jobs}");
    app.key(tab);
    let routes = footer(&app);
    assert!(hints(&routes) <= 8, "{routes}");
    for hint in ["↑↓ member", "←→ cell", "a allow once", "f focus", "? help"] {
        assert!(routes.contains(hint), "{hint}: {routes}");
    }
    assert!(
        !routes.contains("q quit") && !routes.contains("end focus"),
        "{routes}"
    );
    app.key(tab);
    let talks = footer(&app);
    assert!(hints(&talks) <= 8 && talks.contains("↑↓ pair"), "{talks}");
}
#[test]
fn job_keys_confirm_pause_and_run_and_leave_a_tmt_orch_job_read_only() {
    use super::super::app::Effect;
    use super::write::{JobOp, Step, Task};
    let mut app = matrix_app();
    let press = |app: &mut super::super::app::App, code| {
        app.key(ratatui::crossterm::event::KeyEvent::new(
            code,
            ratatui::crossterm::event::KeyModifiers::NONE,
        ))
    };
    use ratatui::crossterm::event::KeyCode::{Char, Down, Tab};
    // A confirm applies only through a button it painted.
    let confirm = |app: &mut super::super::app::App| {
        paint(app, 160, 36);
        press(app, Char('y'))
    };
    // Outside Jobs the job keys name where they act.
    assert!(matches!(press(&mut app, Char('p')), Effect::None));
    assert!(
        app.notice
            .as_deref()
            .is_some_and(|n| n.contains("Tab to Jobs"))
    );
    press(&mut app, Tab);
    press(&mut app, Tab);
    // The first job by next run: peer's ready j2. Pause confirms first, then sends exactly it.
    assert!(matches!(press(&mut app, Char('p')), Effect::None));
    assert_eq!(
        app.confirm.as_ref().unwrap().title(),
        "Pause j2 · UI check?"
    );
    let Effect::Orchestration(Task {
        step: Step::Job {
            key, revision, op, ..
        },
    }) = confirm(&mut app)
    else {
        panic!("the confirmed pause runs on the lane")
    };
    assert_eq!((key.id.as_str(), revision, op), ("c2", 2, JobOp::Pause));
    press(&mut app, Char('x'));
    assert_eq!(
        app.confirm.as_ref().unwrap().title(),
        "Run j2 · UI check now?"
    );
    let Effect::Orchestration(Task {
        step: Step::Job { op, .. },
    }) = confirm(&mut app)
    else {
        panic!("the confirmed run runs on the lane")
    };
    assert_eq!(op, JobOp::Run);
    // j1 is next; then j4, made with `tmt orch job`: read-only, with where to change it.
    press(&mut app, Down);
    press(&mut app, Down);
    assert_eq!(app.orchestration.selected_job().unwrap().display_id, "j4");
    assert!(matches!(press(&mut app, Char('x')), Effect::None));
    assert!(app.confirm.is_none());
    assert!(
        app.notice
            .as_deref()
            .is_some_and(|n| n.contains("tmt orch job")),
        "{:?}",
        app.notice
    );
    // A paused job resumes.
    press(&mut app, Down);
    press(&mut app, Char('p'));
    assert_eq!(
        app.confirm.as_ref().unwrap().title(),
        "Resume j3 · Archive review?"
    );
}

#[test]
fn a_confirm_too_tall_for_the_terminal_offers_only_cancel_and_asks_for_room() {
    let app = captures::case("orchestration-preview", crate::look::Look::default());
    let paint = |width, height| {
        let mut terminal =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(width, height)).unwrap();
        terminal
            .draw(|frame| super::super::view::render(frame, &app))
            .unwrap();
        terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|c| c.symbol())
            .collect::<String>()
    };
    let short = paint(60, 8);
    assert!(short.contains("Enlarge to review"), "{short}");
    assert!(!short.contains("Release"), "no action it cannot show");
    let tall = paint(60, 36);
    assert!(
        tall.contains("Release") && tall.contains("restarts."),
        "wrapped body"
    );
}

/// HOME oracle scenes of the Orchestration tab (#5890 review): its own states, painted from the
/// same handwritten public wire facts as the tests above.
pub(in crate::board) mod captures {
    use super::super::write::{Completed, Step, Task};
    use super::*;
    pub(in crate::board) const SCENES: &[&str] = &[
        "orchestration-loading",
        "orchestration-unsupported",
        "orchestration-table",
        "orchestration-matrix",
        "orchestration-plans",
        "orchestration-why",
        "orchestration-preview",
        "orchestration-roster",
        "orchestration-table-selection",
        "orchestration-empty",
        "orchestration-failed",
        "orchestration-refresh-failed",
        "orchestration-week",
        "orchestration-month",
        "orchestration-history",
        "orchestration-jobs",
        "orchestration-jobs-paused",
        "orchestration-plan-members",
    ];
    const WED_23: u64 = 1_794_405_600_000;
    /// Wed 00:00 Asia/Tokyo: the local day every roster range starts from.
    const WED_00: u64 = WED_23 - 23 * HOUR;
    const HOUR: u64 = 3_600_000;
    const DAY: u64 = 24 * HOUR;
    const NIGHT_START: u64 = 1_794_402_000_000;
    const NIGHT_END: u64 = 1_794_430_800_000;
    const NIGHT: &str = "20000000-0000-4000-8000-000000000011";
    const QUIET: &str = "20000000-0000-4000-8000-000000000012";
    const DAY_SHIFT: &str = "20000000-0000-4000-8000-000000000013";
    const ROSTER: [(&str, &str); 12] = [
        ("tmt-tui-lead", "awake"),
        ("core-ops-2", "awake"),
        ("core-1", "low"),
        ("remote-3", "awake"),
        ("remote-4", "focus"),
        ("gui-1", "sleep"),
        ("night-1", "awake"),
        ("night-2", "awake"),
        ("design-2", "low"),
        ("colab-1", "sleep"),
        ("infra-1", "awake"),
        ("tmt-qa-long-member-name", "focus"),
    ];
    fn roster_id(index: usize) -> String {
        format!("10000000-0000-4000-8000-{:012}", index + 101)
    }
    /// A real-shaped squad at Wed 23:00 Asia/Tokyo: night members follow Shift B, one route
    /// is allowed once, one pair is held, and both verdicts appear.
    fn roster_api(op: &str, input: Value) -> Result<Value, crate::core::SquadError> {
        // The selected time and range the board asked for: the fixture's own state stands in for now.
        let at = input["atMs"]
            .as_u64()
            .filter(|at| *at > 1000)
            .unwrap_or(WED_23);
        let days = input["rangeDays"].as_u64().unwrap_or(1);
        let end = WED_00 + days * DAY;
        // Shift B runs 22:00-06:00 on weekdays (the night before the range is clipped to it);
        // Sat and Sun have Quiet hours all day.
        let timeline: Vec<Value> = (0..=days)
            .filter_map(|day| {
                let start = WED_00 + day * DAY;
                // Day 0 is Wednesday, so days 3 and 4 of each week are the weekend.
                let (from, to, plans) = match day % 7 {
                    3 | 4 => (start, start + DAY, json!([QUIET])),
                    _ => (start - 2 * HOUR, start + 6 * HOUR, json!([NIGHT, QUIET])),
                };
                let (from, to) = (from.max(WED_00), to.min(end));
                (from < to).then(|| json!({"startMs":from,"endMs":to,"planIds":plans}))
            })
            .collect();
        let night = json!({"kind":"plan","planId":NIGHT,"identityId":null,"revision":4,
            "slot":{"startMs":NIGHT_START,"endMs":NIGHT_END},"defaulted":false});
        let field = |value: Value, from_plan: bool| json!({"value":value,"source":if from_plan { night.clone() } else { source() }});
        let members: Vec<Value> = ROSTER
            .iter()
            .enumerate()
            .map(|(index, (name, state))| {
                let on_night = name.starts_with("night");
                let mut receiving = field(
                    match index % 3 {
                        0 => json!({"mode":"batch","intervalMs":1800000}),
                        1 => json!({"mode":"direct"}),
                        _ => json!({"mode":"urgent"}),
                    },
                    on_night,
                );
                receiving["available"] = true.into();
                json!({"identityId":roster_id(index),"name":name,
                    "activePlans":if on_night { json!([NIGHT, QUIET]) } else { json!([QUIET]) },
                    "nextChangeAtMs":if on_night { json!(NIGHT_END) } else { Value::Null },"jobs":null,
                    "effective":{"state":field(json!(state), on_night),"receiving":receiving,
                        "sending":field(json!(if on_night { "leads" } else { "anyone" }), on_night),
                        "routine":field(json!("run"), false),"talkLimit":field(json!(20), false)}})
            })
            .collect();
        Ok(match (op, input["view"].as_str()) {
            ("capabilities", _) => {
                json!({"operations":["orchestration.read","orchestration.write"]})
            }
            (_, Some("routes")) => {
                let mut routes = Vec::new();
                for (from, (from_name, _)) in ROSTER.iter().enumerate() {
                    for (to, (to_name, _)) in ROSTER.iter().enumerate() {
                        if from == to {
                            continue;
                        }
                        let (verdict, source) = if from_name.starts_with("night") && to != 0 {
                            if (from_name, to_name) == (&"night-1", &"gui-1") {
                                ("allowed", json!({"kind":"grant","grantUntilMs":NIGHT_END}))
                            } else {
                                ("blocked", night.clone())
                            }
                        } else if (from_name, to_name) == (&"core-ops-2", &"core-1") {
                            ("needs_person", source())
                        } else {
                            ("allowed", source())
                        };
                        routes.push(json!({"from":roster_id(from),"fromName":from_name,
                            "to":roster_id(to),"toName":to_name,"verdict":verdict,"source":source}));
                    }
                }
                json!({"routes":routes,"nextAfter":null})
            }
            (_, Some("jobs")) => roster_jobs(),
            (_, Some("talks")) => {
                let member = |index: usize| {
                    json!({"identityId":roster_id(index),"name":ROSTER[index].0,
                        "talkLimit":{"value":20,"source":source()}})
                };
                json!({"pairs":[
                    {"members":[member(1),member(2)],"count":20,"limit":20,"lastAtMs":WED_23 - 60_000,
                     "windowStartMs":NIGHT_START,"state":"held","heldCount":1,"held":[]},
                    {"members":[member(3),member(4)],"count":7,"limit":20,"lastAtMs":WED_23 - 240_000,
                     "windowStartMs":NIGHT_START,"state":"open","heldCount":0,"held":[]}]})
            }
            _ => json!({"schemaVersion":1,"configurationRevision":9,"receivingRevision":3,
                "observedAtMs":WED_23,"atMs":at,"timeZone":"Asia/Tokyo",
                "range":{"startMs":WED_00,"endMs":end},
                "plans":[
                    {"id":NIGHT,"name":"Shift B · Night","revision":4,
                     "fields":{"state":"awake","sending":"leads"},
                     "schedule":{"kind":"weekly","anchorDate":"2026-11-02","intervalWeeks":1,
                        "weekdays":[1,2,3,4,5],"start":"22:00","end":"06:00","allDay":false},
                     "targets":[{"kind":"pattern","pattern":"night-*"}],"members":[],
                     "enabled":true,"priority":20},
                    {"id":QUIET,"name":"Quiet hours","revision":2,"fields":{"state":"low"},
                     "schedule":{"kind":"daily","start":"22:00","end":"08:00","allDay":false},
                     "targets":[{"kind":"all"}],"members":[],"enabled":true,"priority":10}],
                "members":members,
                "timeline":timeline}),
        })
    }
    /// The squad's jobs as the page's Jobs mock lists them, with an ownerless job and one made
    /// with `tmt orch job`.
    fn roster_jobs() -> Value {
        let owner = |index: usize| Some((ROSTER[index].0, ROSTER[index].0));
        let mut rows = Vec::new();
        let hold = |row: &mut Value, kind: &str, plan: Option<&str>, until: u64| {
            row["state"] = "held".into();
            row["routine"] = json!({"value":"hold","source":{"kind":kind,"planId":plan,"identityId":null,
                "revision":2,"slot":{"startMs":WED_23 - HOUR,"endMs":until},"defaulted":false}});
        };
        let mut j1 = job(1, owner(2), "Queue review", "every 30m");
        hold(&mut j1, "plan", Some(QUIET), WED_00 + 32 * HOUR);
        j1["nextRunAtMs"] = (WED_23 + HOUR / 2).into();
        j1["lastRun"] = json!({"recordedAtMs":WED_23 - 90 * 60_000,"acceptance":"queued"});
        let mut j2 = job(2, owner(5), "UI check", "every 1h");
        hold(&mut j2, "focus", None, WED_23 + 2 * HOUR);
        j2["nextRunAtMs"] = WED_23.into();
        let mut j3 = job(3, owner(6), "Night review", "every 1h");
        j3["nextRunAtMs"] = (WED_23 + HOUR).into();
        let mut j4 = job(4, owner(7), "Queue check", "every 1h");
        j4["nextRunAtMs"] = (WED_23 + HOUR / 2).into();
        let mut j5 = job(5, owner(6), "Archive review", "daily 23:30");
        j5["state"] = "paused".into();
        j5["manualPause"] = json!({"by":roster_id(0),"atMs":WED_23 - DAY});
        let mut j6 = job(6, owner(0), "Status check", "weekdays 09:00");
        j6["nextRunAtMs"] = (WED_00 + 33 * HOUR).into();
        let j7 = job(7, None, "Old digest", "daily 07:00");
        let mut j8 = job(8, owner(10), "Weekly report", "weekdays 10:00");
        j8["legacy"] = Value::Null;
        j8["nextRunAtMs"] = (WED_00 + 34 * HOUR).into();
        rows.extend([j1, j2, j3, j4, j5, j6, j7, j8]);
        for (index, row) in rows.iter_mut().enumerate() {
            // Owners are roster members by UUID, as Core names them.
            if let Some(name) = row["target"]["identityName"].as_str() {
                let at = ROSTER.iter().position(|(n, _)| *n == name).unwrap();
                row["target"]["identityId"] = roster_id(at).into();
            }
            row["revision"] = (index as u64 + 3).into();
        }
        json!({"schemaVersion":1,"observedAtMs":WED_23,"configurationRevision":9,"jobs":rows,
            "nextCursor":null,"historyCoverage":"recorded_only"})
    }
    fn older_core_pair(op: &str, input: Value) -> Result<Value, crate::core::SquadError> {
        match (op, input["view"].as_str()) {
            ("capabilities", _) => Ok(json!({"operations":["orchestration.read"]})),
            (_, Some("routes" | "talks" | "jobs")) => Err(crate::core::SquadError::new(
                "ORCH_INPUT_INVALID",
                "Invalid orchestration input or calendar selection.",
            )),
            _ => Ok(pair_document()),
        }
    }
    /// The roster squad's plans, plus a day shift for two named members that is turned off.
    fn plans_api(op: &str, input: Value) -> Result<Value, crate::core::SquadError> {
        let overview = op == "orchestration.read" && input["view"] == "overview";
        let mut value = roster_api(op, input)?;
        if overview {
            value["plans"].as_array_mut().unwrap().push(json!(
                {"id":DAY_SHIFT,"name":"Shift A · Day","revision":1,"fields":{"state":"awake"},
                 "schedule":{"kind":"weekly","anchorDate":"2026-11-02","intervalWeeks":2,
                    "weekdays":[1,3],"start":"09:00","end":"18:00","allDay":false},
                 "targets":[{"kind":"identity","id":roster_id(2)},{"kind":"identity","id":roster_id(5)}],
                 "members":[],"enabled":false,"priority":5}));
        }
        Ok(value)
    }
    pub(in crate::board) fn case(
        scene: &str,
        look: crate::look::Look,
    ) -> super::super::super::app::App {
        let mut app =
            crate::board::app::workspace::tests::capture_case("idle-alert-overview", look);
        assert!(app.shell.select_digit(
            '3',
            super::super::super::shell::OpsInputOwner::List,
            &mut app.workspace.selected,
        ));
        app.orchestration = state();
        match scene {
            "orchestration-week" => app.orchestration.query.days = 7,
            "orchestration-month" => app.orchestration.query.days = 30,
            "orchestration-history" => {
                // Wed 04:00, inside last night's shift, away from now.
                app.orchestration.query.at_ms = WED_00 + 4 * HOUR;
                app.orchestration.follow_now = false;
            }
            _ => {}
        }
        let observation = match scene {
            "orchestration-loading" => return app,
            "orchestration-unsupported" => Observation::Unavailable,
            "orchestration-table" => Observation::Ready(Box::new(ready())),
            "orchestration-plans" | "orchestration-plan-members" => {
                app.orchestration.read().read_with(plans_api)
            }
            "orchestration-roster"
            | "orchestration-week"
            | "orchestration-month"
            | "orchestration-history"
            | "orchestration-jobs"
            | "orchestration-jobs-paused" => app.orchestration.read().read_with(roster_api),
            "orchestration-table-selection" => {
                Observation::Ready(Box::new(observe(older_core_pair)))
            }
            "orchestration-failed" => Observation::Failed("Core did not answer within 10 s".into()),
            _ => Observation::Ready(Box::new(observe(pair_api))),
        };
        let read = app.orchestration.read();
        app.orchestration.apply(read.clone(), observation);
        match scene {
            "orchestration-plans" | "orchestration-empty" => app.orchestration.plans = true,
            "orchestration-plan-members" => {
                // `⏎` on Shift B in the plans list: the matrix shows its members only.
                app.orchestration.plans = true;
                app.orchestration.plan_selection = Some(NIGHT.into());
                let _ = app.orchestration_bound(crate::action::OpsUiAction::PlanOnly);
            }
            "orchestration-roster" => {
                // Selection away from the first row and column, past the rows a short frame shows.
                app.orchestration.selected = Some(roster_id(6));
                app.orchestration.target = Some(roster_id(4));
            }
            "orchestration-table-selection" => app.orchestration.selected = Some(OTHER.into()),
            "orchestration-jobs" | "orchestration-jobs-paused" => {
                let number = if scene == "orchestration-jobs" { 1 } else { 5 };
                app.orchestration.section = super::super::Section::Jobs;
                app.orchestration.job = Some(format!("30000000-0000-4000-8000-{number:012}"));
                app.orchestration.selected = Some(roster_id(6));
            }
            "orchestration-refresh-failed" => app.orchestration.apply(
                read,
                Observation::Failed("Core did not answer within 10 s".into()),
            ),
            "orchestration-why" => {
                app.orchestration.why = Some((
                    MEMBER.into(),
                    vec![
                        "route blocked · worker may message leads only".into(),
                        "focus set · until 01:00".into(),
                    ],
                ));
            }
            "orchestration-preview" => {
                let preview = json!({"mutation":{"kind":"talks.resume","aId":MEMBER,"bId":OTHER},
                    "configurationRevision":3,"previewAtMs":1000,"previewDigest":"d",
                    "releases":1,"held":[{}]});
                let _ = app.finished_orchestration(Completed {
                    task: Task {
                        step: Step::Preview {
                            title: "Release held worker ⇄ peer".into(),
                            mutation: preview["mutation"].clone(),
                        },
                    },
                    result: Ok(preview),
                });
            }
            _ => {}
        }
        app
    }
}

#[test]
fn orchestration_matrix_more_hint_renders_exact_row_and_column_counts() {
    use super::input::Control;
    let mut app = matrix_app();
    let mut snapshot = observe(pair_api);
    let template = snapshot.document.members[0].clone();
    snapshot.document.members = (0..60)
        .map(|n| {
            let mut member = template.clone();
            member.identity_id = format!("10000000-0000-4000-8000-{n:012}");
            // Long names that share their start and end: cut alike, they would read the same.
            member.name = format!("core-ops-member-{n}-of-the-night-squad");
            member
        })
        .collect();
    app.orchestration.apply(
        app.orchestration.read(),
        Observation::Ready(Box::new(snapshot)),
    );
    let text = screen(&app);
    let hits = app.orchestration.hits.borrow();
    let rows = hits
        .iter()
        .filter_map(|(_, control)| match control {
            Control::Cell(row, _) => Some(row + 1),
            _ => None,
        })
        .max()
        .unwrap();
    let columns = hits
        .iter()
        .filter_map(|(_, control)| match control {
            Control::Cell(_, column) => Some(column + 1),
            _ => None,
        })
        .max()
        .unwrap();
    assert!(rows < 60 && columns < 60);
    // The counts sit in the section rule's note, so the legend stays whole.
    let expected = format!("━ {} more ↓ · {} more → ━", 60 - rows, 60 - columns);
    assert!(text.contains(&expected), "expected {expected}: {text}");
    assert!(text.contains("✕ sender rule · ◆ needs a person"), "{text}");
    // Two different visible names never render as the same text.
    let lines: Vec<String> = text
        .chars()
        .collect::<Vec<_>>()
        .chunks(160)
        .map(|row| row.iter().collect())
        .collect();
    let header = lines.iter().find(|l| l.contains("From ↓ To →")).unwrap();
    let columns: Vec<&str> = header[..header.find('│').unwrap_or(header.len())]
        .split("From ↓ To →")
        .nth(1)
        .unwrap()
        .split_whitespace()
        .collect();
    let distinct: std::collections::BTreeSet<_> = columns.iter().collect();
    assert!(
        columns.len() > 1 && distinct.len() == columns.len(),
        "{header}"
    );
    drop(hits);
    // A strip cell selects the start of its interval, as `[` and `]` would.
    let rect = app
        .orchestration
        .hits
        .borrow()
        .iter()
        .find(|(_, control)| matches!(control, Control::At(2000)))
        .map(|(rect, _)| *rect)
        .expect("a strip cell for the interval at 2000");
    app.orchestration_mouse(ratatui::crossterm::event::MouseEvent {
        kind: ratatui::crossterm::event::MouseEventKind::Down(
            ratatui::crossterm::event::MouseButton::Left,
        ),
        column: rect.x,
        row: rect.y,
        modifiers: ratatui::crossterm::event::KeyModifiers::NONE,
    });
    assert_eq!(app.orchestration.query.at_ms, 2000);
    assert!(!app.orchestration.follow_now);
}
