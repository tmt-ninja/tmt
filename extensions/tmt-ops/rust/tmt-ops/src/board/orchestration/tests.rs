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
    assert!(text.contains("routes are not available on this Core"));
    assert!(text.contains("Jobs · not available yet"));
    assert!(text.contains("batch 30m"));
    assert!(!text.contains("0 jobs"));
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
        _ => pair_document(),
    })
}
#[test]
fn an_older_core_without_sending_views_reads_them_as_not_available() {
    let snapshot = observe(|op, input| match (op, input["view"].as_str()) {
        ("capabilities", _) => Ok(json!({"operations":["orchestration.read"]})),
        (_, Some("routes" | "talks")) => Err(crate::core::SquadError::new(
            "ORCH_INPUT_INVALID",
            "Invalid orchestration input or calendar selection.",
        )),
        _ => Ok(document()),
    });
    assert!(snapshot.sending.routes.is_none());
    assert!(snapshot.sending.talks.is_none());
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
    assert!(text.contains("worker ⇄ peer 2/2 ◆ held"));
    assert!(text.contains("Result · not sent, explained"));
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
    ];
    fn plans_api(op: &str, input: Value) -> Result<Value, crate::core::SquadError> {
        if op == "orchestration.read" && input["view"] == "overview" {
            let mut value = pair_document();
            value["plans"] = json!([
                {"id":"20000000-0000-4000-8000-000000000001","name":"Night shift","revision":3,
                 "fields":{},"schedule":{},"targets":[],"members":[],"enabled":true,"priority":10},
                {"id":"20000000-0000-4000-8000-000000000002","name":"Review week","revision":1,
                 "fields":{},"schedule":{},"targets":[],"members":[],"enabled":false,"priority":5}
            ]);
            return Ok(value);
        }
        pair_api(op, input)
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
        let observation = match scene {
            "orchestration-loading" => return app,
            "orchestration-unsupported" => Observation::Unavailable,
            "orchestration-table" => Observation::Ready(Box::new(ready())),
            "orchestration-plans" => Observation::Ready(Box::new(observe(plans_api))),
            _ => Observation::Ready(Box::new(observe(pair_api))),
        };
        app.orchestration
            .apply(app.orchestration.read(), observation);
        match scene {
            "orchestration-plans" => app.orchestration.plans = true,
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
