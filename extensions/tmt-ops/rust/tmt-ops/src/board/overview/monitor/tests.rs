use super::*;
use crate::{
    board::{
        app::Effect,
        app::workspace::tests::{MEMBER, ROOM},
        shell::OpsTab,
        workspace::{OpsMember, OpsMembershipState, OpsObservation},
    },
    config::OpsKeyScope,
};
use ratatui::{
    Terminal,
    backend::TestBackend,
    buffer::Buffer,
    crossterm::event::{KeyCode, KeyEvent, KeyModifiers},
};
use serde_json::json;
const OTHER: &str = "33333333-3333-4333-8333-333333333333";
const BLOCKED: &str = "44444444-4444-4444-8444-444444444444";

#[test]
fn section_counts_use_singular_for_one_and_preserve_filtered_and_partial_counts() {
    for count in [0, 1, 2] {
        let mut app = crate::board::app::workspace::tests::populated_board(count, count);
        app.shell.tab = OpsTab::Agents;

        {
            app.search.clear();
            app.workspace.selected = None;
            app.workspace_reconcile();
            let buffer = paint(&mut app, 103, 51);
            let shown = text(&buffer);
            if count == 1 {
                assert!(shown.contains("1 squad · 1 agent"), "{shown}");
                assert!(!shown.contains("1 squads") && !shown.contains("1 agents"));
            } else {
                assert!(shown.contains(&format!("{count} agents")), "{shown}");
            }
            app.search = "agent-00000".into();
            app.workspace_reconcile();
            app.overview_rows.borrow_mut().clear();
            let filtered = text(&paint(&mut app, 103, 51));
            assert!(
                filtered.contains(if count > 0 { "1 of 1" } else { "0 of 0" }),
                "{filtered}"
            );
            if count == 1 {
                app.view
                    .as_mut()
                    .unwrap()
                    .home
                    .as_mut()
                    .unwrap()
                    .workspace
                    .roster
                    .observation = OpsObservation::Partial;
                app.overview_rows.borrow_mut().clear();
                let partial = text(&paint(&mut app, 103, 51));
                assert!(partial.contains("~1 of ~1"), "{partial}");
                app.view
                    .as_mut()
                    .unwrap()
                    .home
                    .as_mut()
                    .unwrap()
                    .workspace
                    .roster
                    .observation = OpsObservation::Complete;
            }
            app.workspace.query.clear();
        }
    }
}

#[test]
fn agents_omit_the_waiting_note_when_none_are_waiting() {
    let mut app = board();
    let snapshot = &mut app.view.as_mut().unwrap().home.as_mut().unwrap().workspace;
    for member in snapshot.roster.members.values_mut() {
        member.waiting = false;
    }
    for squad in &mut snapshot.roster.squads {
        for state in squad.member_states.values_mut() {
            state.waiting = false;
        }
    }
    app.overview_rows.borrow_mut().clear();
    let buffer = paint(&mut app, 103, 51);
    let line: String = buffer
        .content
        .chunks(103)
        .find(|row| {
            row.iter()
                .map(|cell| cell.symbol())
                .collect::<String>()
                .contains("3 agents")
        })
        .unwrap()
        .iter()
        .map(|cell| cell.symbol())
        .collect();
    assert!(line.trim_end().ends_with("3 agents"));
    assert!(!line.contains("need you first") && !line.contains('◆'));
}

#[test]
fn search_counts_keep_the_admitted_denominator_in_the_squad_tree() {
    let _no_commands = crate::runner::forbid_commands();
    let mut app = board();
    select_squad(&mut app);
    for (query, expected) in [("worker", "1 of 1"), ("no-such-agent", "0 of 0")] {
        app.search = query.into();
        app.overview_rows.borrow_mut().clear();
        app.workspace_reconcile();
        let buffer = paint(&mut app, 103, 51);
        let lines: Vec<String> = buffer
            .content
            .chunks(103)
            .map(|row| row.iter().map(|cell| cell.symbol()).collect())
            .collect();
        assert!(
            lines
                .iter()
                .any(|line| line.contains(expected) && line.contains('×')),
            "{lines:?}"
        );
    }
}

/// The squads tree with its first squad selected, as the Squads chip leaves it for a squad.
fn select_squad(app: &mut App) {
    app.workspace.selected = Some(OpsTarget::Squad(ROOM.into()));
    app.workspace_reconcile();
}
fn board() -> App {
    let mut app = crate::board::app::workspace::tests::board();
    app.shell.tab = OpsTab::Agents;

    let snapshot = &mut app.view.as_mut().unwrap().home.as_mut().unwrap().workspace;
    for member in snapshot.roster.members.values_mut() {
        member.waiting = false;
    }
    for squad in &mut snapshot.roster.squads {
        for member in squad.member_states.values_mut() {
            member.waiting = false;
        }
    }
    let now = crate::status::now_ms();
    for (id, name, state, waiting, age) in [
        (MEMBER, "worker", "working", true, 1_000),
        (OTHER, "waiting-other", "idle", true, 2_000),
        (BLOCKED, "blocked-only", "blocked", false, 0),
    ] {
        snapshot.roster.members.insert(
            id.into(),
            OpsMember {
                id: id.into(),
                name: name.into(),
                state: Some(state.into()),
                waiting,
                presence: Some(true),
                usage: None,
                activity: Default::default(),
            },
        );
        snapshot.roster.squads[0].members.push(id.into());
        snapshot.roster.squads[0].member_states.insert(
            id.into(),
            OpsMembershipState {
                state: Some(state.into()),
                waiting,
                ..Default::default()
            },
        );
        snapshot.rows.insert(OpsTarget::Member{room_id:Some(ROOM.into()),identity_id:id.into()},json!({"id":id,"name":name,"state":state,"presence":"active","pending":null,"fields":{"task":format!("task for {name}")},"waitingOnYou":if waiting{json!([{"requestId":format!("q-{id}"),"preparedAtMs":now-age,"preview":format!("Approve {name}?")}])}else{json!([])}}));
    }
    snapshot.roster.squads[0].members.sort();
    snapshot.roster.squads[0].members.dedup();
    snapshot.shell_counts = snapshot.roster.shell_counts();
    app.overview_rows.borrow_mut().clear();
    app.workspace_reconcile();
    app
}
fn press(app: &mut App, code: KeyCode) -> Effect {
    app.key(KeyEvent::new(code, KeyModifiers::NONE))
}
fn paint(app: &mut App, width: u16, height: u16) -> Buffer {
    let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
    terminal
        .draw(|frame| {
            crate::board::view::prepare(app, frame.area());
            crate::board::view::render(frame, app);
        })
        .unwrap();
    terminal.backend().buffer().clone()
}
fn text(buffer: &Buffer) -> String {
    buffer
        .content
        .chunks(usize::from(buffer.area.width))
        .map(|row| row.iter().map(|cell| cell.symbol()).collect::<String>())
        .collect::<Vec<_>>()
        .join("\n")
}
#[test]
fn search_keeps_a_hidden_uuid_and_authored_filter_bindings_win() {
    let mut app = board();
    let selected = app.workspace.selected.clone();
    app.search = "not present".into();
    app.workspace_reconcile();
    assert!(app.workspace_rows().is_empty());
    assert_eq!(app.workspace.selected, selected);
    assert!(!app.workspace_selection_visible());
    press(&mut app, KeyCode::Enter);
    assert!(app.input.is_none());
    assert_eq!(app.workspace.selected, selected);
    app.view
        .as_mut()
        .unwrap()
        .home
        .as_mut()
        .unwrap()
        .workspace
        .keys
        .get_mut(&OpsKeyScope::Member)
        .unwrap()
        .insert("v".into(), crate::action::Action::parse("search").unwrap());
    press(&mut app, KeyCode::Char('v'));
    assert!(app.searching);
}
#[test]
fn authored_sort_changes_only_the_layer_order_and_retains_the_selected_uuid() {
    let mut app = board();
    let selected = app.workspace.selected.clone();
    let preferences = app.workspace_snapshot().unwrap().preferences.clone();
    let keys = app
        .view
        .as_mut()
        .unwrap()
        .home
        .as_mut()
        .unwrap()
        .workspace
        .keys
        .get_mut(&OpsKeyScope::Member)
        .unwrap();
    keys.insert("g".into(), crate::action::Action::parse("sort").unwrap());
    keys.insert(
        "G".into(),
        crate::action::Action::parse("reverse-sort").unwrap(),
    );
    assert_eq!(press(&mut app, KeyCode::Char('g')), Effect::None);
    assert_eq!(
        app.workspace_order().agents,
        crate::config::OpsSort::Attention
    );
    assert_eq!(press(&mut app, KeyCode::Char('G')), Effect::None);
    assert!(app.workspace_order().reversed);
    assert_eq!(app.workspace.selected, selected);
    assert_eq!(app.workspace_snapshot().unwrap().preferences, preferences);
}
#[test]
fn refreshed_and_hidden_frames_revoke_the_previous_row_hits() {
    let mut app = board();
    paint(&mut app, 103, 51);
    assert!(
        !app.hits
            .borrow()
            .iter()
            .filter_map(|hit| hit.row())
            .collect::<Vec<_>>()
            .is_empty()
    );
    app.search = "missing".into();
    app.workspace_reconcile();
    paint(&mut app, 60, 18);
    assert!(app.hits.borrow().iter().all(|hit| hit.row().is_none()));
    assert!(text(&paint(&mut app, 103, 51)).contains("No matching agents"));
}
#[test]
fn missing_sources_stay_unknown_instead_of_claiming_zero_waiting() {
    let mut app = board();
    let snapshot = &mut app.view.as_mut().unwrap().home.as_mut().unwrap().workspace;
    for member in snapshot.roster.members.values_mut() {
        member.waiting = false;
    }
    for squad in &mut snapshot.roster.squads {
        for state in squad.member_states.values_mut() {
            state.waiting = false;
        }
        squad.observation = OpsObservation::Unavailable;
    }
    snapshot.roster.observation = OpsObservation::Unavailable;
    snapshot.roster.membership_complete = false;
    app.overview_rows.borrow_mut().clear();
    let shown = text(&paint(&mut app, 103, 51));
    assert!(shown.contains("~3 agents") || shown.contains("3 agents"));
    assert!(!shown.contains("need you first"));
    assert!(shown.contains("AGENT"));
    // No Needs you section; the words may still read on a waiting request or state cell.
    assert!(
        !shown
            .lines()
            .any(|line| line.trim().starts_with("Needs you")),
        "{shown}"
    );
    assert!(!shown.contains("◆ 0 need you"));
}
#[test]
fn final_primary_sections_replace_the_legacy_summaries_and_recent_table() {
    let mut app = board();

    let squads = text(&paint(&mut app, 103, 51));
    for required in ["Squads", "SQUAD / AGENT", "TOK 1h", "MODEL", "/  Search"] {
        assert!(squads.contains(required), "{required}");
    }

    let agents = text(&paint(&mut app, 103, 51));
    for required in ["AGENT", "SQUAD", "STATE", "TOK 1h", "MODEL"] {
        assert!(agents.contains(required), "{required}");
    }
    for retired in [
        "Recent exchanges",
        "Digest status unavailable",
        "state unknown",
        "f needs you",
        "open chat",
    ] {
        assert!(
            !squads.contains(retired) && !agents.contains(retired),
            "retired {retired}"
        );
    }
    // The retired Needs you section had a title line; the state word reads mid-line in a row.
    for shown in [&squads, &agents] {
        assert!(
            !shown
                .lines()
                .any(|line| line.trim().starts_with("Needs you")),
            "retired Needs you section"
        );
    }
    for shown in [&squads, &agents] {
        assert!(!shown.split_whitespace().any(|word| word == "MODE"));
    }
}

#[test]
fn squad_tree_has_no_filter_chips_or_default_f_action() {
    let mut app = board();
    select_squad(&mut app);
    let before = app.workspace.selected.clone();
    press(&mut app, KeyCode::Char('f'));
    assert_eq!(app.workspace.selected, before);
    paint(&mut app, 103, 51);
    let rendered = paint(&mut app, 103, 51);
    assert!(!rendered.content.chunks(103).any(|row| {
        row.iter()
            .map(|cell| cell.symbol())
            .collect::<String>()
            .contains("Pinned")
    }));
}

#[test]
fn squad_message_target_is_only_its_current_observed_lead() {
    let mut app = board();
    select_squad(&mut app);
    assert!(
        app.workspace_message_target().is_none(),
        "no lead means no recipient"
    );
    app.view
        .as_mut()
        .unwrap()
        .home
        .as_mut()
        .unwrap()
        .workspace
        .roster
        .squads[0]
        .lead = Some(MEMBER.into());
    app.overview_rows.borrow_mut().clear();
    let target = app.workspace_message_target().expect("observed lead");
    let OpsTarget::Member {
        room_id: Some(room),
        identity_id: lead,
    } = &target
    else {
        panic!("canonical room member")
    };
    let snapshot = app.workspace_snapshot().unwrap();
    assert_eq!(
        snapshot
            .roster
            .squads
            .iter()
            .find(|s| &s.room_id == room)
            .unwrap()
            .lead
            .as_ref(),
        Some(lead)
    );
    assert_eq!(
        app.conversation_target(),
        Some(crate::board::app::RowTarget::Workspace(target.clone()))
    );
    app.view
        .as_mut()
        .unwrap()
        .home
        .as_mut()
        .unwrap()
        .workspace
        .rows
        .remove(&target);
    assert!(
        app.workspace_message_target().is_none(),
        "missing lead evidence cannot retarget to a neighbor"
    );
    assert!(app.conversation_target().is_none());
}

#[test]
fn filtered_section_counts_follow_the_current_squads_or_agents_mode() {
    let mut app = crate::board::app::workspace::tests::populated_board(8, 28);
    app.shell.tab = OpsTab::Agents;

    app.search = "squad-00".into();
    app.workspace_reconcile();

    let squads = text(&paint(&mut app, 103, 51));
    assert!(squads.contains("1 of 1"), "{squads}");
    app.search = "agent-00000".into();
    app.workspace_reconcile();

    let agents = text(&paint(&mut app, 103, 51));
    assert!(agents.contains("1 of 1"), "{agents}");
}
