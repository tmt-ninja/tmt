//! Public clock projection and manual dispatch contracts; process ownership is in stream tests.
use super::*;
use crate::cron_service::{Mutation, test_support::*};
mod lifecycle;
mod stream;

#[test]
fn clock_status_projection_keeps_full_holder_evidence() {
    let holder = Holder {
        pane: Some("%41".into()),
        pid: 123,
        since_ms: 100,
        expires_ms: 30_100,
        build: None,
    };
    assert_eq!(
        status_document(ClockStatus::Running(holder)),
        json!({"state":"running","pane":"%41","pid":123,"sinceMs":100,"expiresMs":30_100})
    );
    assert_eq!(
        status_document(ClockStatus::NoClock),
        json!({"state":"no clock"})
    );
    assert_eq!(
        status_document(ClockStatus::Unknown),
        json!({"state":"unknown"})
    );
    assert!(
        text(
            &json!({"action":"clock","clock":{"state":"no clock"}}),
            Terminal::PLAIN
        )
        .contains("tmt ops sq cron run")
    );
}

#[test]
fn clock_text_uses_relative_age_without_changing_exact_json_evidence() {
    let since_ms = 100_000;
    let document = json!({"action":"clock","clock":status_document(ClockStatus::Running(Holder {
        pane: Some("%41".into()), pid: 123, since_ms, expires_ms: 400_000, build: None, }))});
    let unchanged = document.clone();
    let text = text_at(&document, Terminal::PLAIN, since_ms + 180_000);
    assert!(
        text.lines()
            .any(|line| line.trim_start().starts_with("since") && line.ends_with("3m ago")),
        "{text}"
    );
    assert!(!text.contains("1970-"));
    assert!(text_at(&document, Terminal::PLAIN, since_ms - 1).contains("just now"));
    assert_eq!(document, unchanged);
    assert_eq!(document["clock"]["sinceMs"], since_ms);
}

#[test]
fn manual_send_preserves_operator_revision_paused_state_and_exact_message() {
    let f = Fixture::new();
    let actor = f.actor(LEAD);
    let created = f.add(&actor, WORKER).unwrap().job.job;
    let paused = f.mutate(&actor, &created, Mutation::Pause).unwrap().job.job;
    let operation = "77777777-7777-4777-8777-777777777777";
    let sent = send_now(
        &f.core,
        &JobKey::of(&paused),
        &actor,
        paused.revision,
        operation,
    )
    .unwrap();
    assert_eq!(sent["job"]["message"], paused.message);
    assert_eq!(sent["dispatch"]["operationId"], operation);
    assert_eq!(f.current_jobs().jobs()[0].pause, paused.pause);
    let model = f.model();
    let request = model["calls"]
        .as_array()
        .unwrap()
        .iter()
        .find(|call| call["request"]["operation"] == "orchestration.job.run")
        .unwrap();
    assert_eq!(request["request"]["identity"], LEAD);
    assert_eq!(request["request"]["input"]["revision"], paused.revision);
    assert_eq!(
        model["dispatches"][operation]["intent"]["input"]["origin"],
        "automation"
    );
    assert_eq!(
        send_now(
            &f.core,
            &JobKey::of(&paused),
            &actor,
            created.revision,
            "88888888-8888-4888-8888-888888888888"
        )
        .unwrap_err()
        .code,
        "SQUAD_CRON_REVISION_CONFLICT"
    );
    assert_eq!(f.model()["dispatches"].as_object().unwrap().len(), 1);
}

#[test]
fn a_lost_manual_response_never_causes_an_automatic_second_run() {
    let f = Fixture::new();
    let actor = f.actor(LEAD);
    let job = f.add(&actor, WORKER).unwrap().job.job;
    f.change_model(|model| model["loseResponse"] = json!(true));
    let operation = "77777777-7777-4777-8777-777777777777";
    assert!(send_now(&f.core, &JobKey::of(&job), &actor, job.revision, operation).is_err());
    let model = f.model();
    assert_eq!(model["dispatches"].as_object().unwrap().len(), 1);
    assert_eq!(model["wakes"].as_array().unwrap().len(), 1);
    assert_eq!(
        model["calls"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|call| call["request"]["operation"] == "orchestration.job.run")
            .count(),
        1
    );
}

#[test]
fn ui_clock_refusal_is_visible_but_unconfirmed_cleanup_never_becomes_success() {
    let mut report = json!({"complete":true,"warnings":[]});
    clock_result(
        &mut report,
        Err(SquadError::new("TICK_CLOCK_RUNNING", "owned elsewhere")),
        false,
    )
    .unwrap();
    assert_eq!(report["complete"], false);
    assert_eq!(report["warnings"][0]["error"]["code"], "TICK_CLOCK_RUNNING");
    let before = report.clone();
    let cleanup = SquadError::new("SQUAD_CRON_CLOCK_CLEANUP_UNCONFIRMED", "not reaped");
    assert_eq!(
        clock_result(&mut report, Err(cleanup.clone()), false).unwrap_err(),
        cleanup
    );
    assert_eq!(report, before);
}

#[test]
fn continuous_clock_restart_is_minute_aligned_and_failure_backoff_is_bounded() {
    let mut restart = Restart::default();
    let mut at = 60_123;
    for minutes in [1, 2, 4, 5, 5] {
        restart.ended(at);
        assert_eq!(restart.after_ms, (at / 60_000 + minutes) * 60_000);
        at = restart.after_ms + 123;
    }
    restart.failures = 0; // A report from the new owner resets consecutive failures.
    restart.ended(at);
    assert_eq!(restart.after_ms, (at / 60_000 + 1) * 60_000);
}
