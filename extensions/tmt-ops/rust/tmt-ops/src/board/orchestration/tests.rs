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
    model::Snapshot::new(model::Overview::decode(document()).unwrap(), true).unwrap()
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
        calls.push((op.to_owned(), input));
        Ok(if op == "capabilities" {
            json!({"operations":["orchestration.read","orchestration.write"]})
        } else {
            document()
        })
    });
    let Observation::Ready(snapshot) = observation else {
        panic!("valid public observation")
    };
    assert!(snapshot.writes);
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
            )
        ]
    );
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
    state.apply(original.clone(), Observation::Ready(ready()));
    state.query.member = "another".into();
    state.apply(original, Observation::Failed("old failure".into()));
    assert!(state.snapshot().is_none());
    assert!(state.failure.is_none());
    let prior = state.read();
    state.observe_cursor(Some(8));
    state.apply(prior, Observation::Ready(ready()));
    assert!(state.snapshot().is_none());
}
#[test]
fn failed_refresh_retains_the_same_queries_last_good_data_with_its_error() {
    let mut state = state();
    let read = state.read();
    state.apply(read.clone(), Observation::Ready(ready()));
    state.apply(read, Observation::Failed("Core unavailable".into()));
    assert_eq!(state.snapshot().unwrap().document.observed_at_ms, 1000);
    assert_eq!(state.failure.as_deref(), Some("Core unavailable"));
}
#[test]
fn a_slot_boundary_requests_one_new_read_without_a_cursor_change() {
    let mut state = state();
    state.apply(state.read(), Observation::Ready(ready()));
    assert!(!state.tick(1999));
    assert!(state.tick(2000));
    assert_eq!(state.query.at_ms, 2000);
    assert!(!state.tick(2001), "the pending boundary read must not spin");
    state.follow_now = false;
    assert!(!state.tick(4000), "a historical selection stays fixed");
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
    app.orchestration
        .apply(app.orchestration.read(), Observation::Ready(ready()));
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
    assert!(text.contains("Routes are not shown yet"));
    assert!(text.contains("Jobs · not available yet"));
    assert!(text.contains("batch 30m"));
    assert!(!text.contains("0 jobs"));
}
