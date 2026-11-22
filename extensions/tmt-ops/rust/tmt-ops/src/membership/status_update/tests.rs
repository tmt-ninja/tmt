use super::*;
use crate::cron_service::test_support::{Fixture, USER, WORKER};
fn fixture() -> Fixture {
    let fixture = Fixture::new();
    fixture.change_model(|model|model["members"][2]["metadata"]=json!({"squad.product.pending":"approve","squad.product.state":"blocked","squad.product.task":"review","squad.other.pending":"unrelated"}));
    fixture
}
fn preview(fixture: &Fixture) -> Preview {
    read(
        &fixture.core,
        &Target {
            squad: "product".into(),
            identity: WORKER.into(),
            actor: USER.into(),
        },
    )
    .unwrap()
}
fn submit(preview: Preview) -> Submit {
    Submit {
        preview,
        state: Some("working".into()),
        reason: "Approval recorded".into(),
    }
}
fn calls(fixture: &Fixture, operation: &str) -> usize {
    fixture.model()["calls"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|call| call["request"]["operation"] == operation)
        .count()
}
#[test]
fn exact_selected_fields_apply_before_one_uuid_announcement() {
    let fixture = fixture();
    let outcome = apply(&fixture.core, &submit(preview(&fixture)));
    let Outcome::Applied {
        intent,
        notification: Ok(_),
    } = outcome
    else {
        panic!("{outcome:?}")
    };
    assert!(intent.accepted);
    let model = fixture.model();
    assert_eq!(
        model["members"][2]["metadata"],
        json!({"squad.product.state":"working","squad.product.pending":"approve","squad.product.task":"review","squad.other.pending":"unrelated"})
    );
    let notice = &model["notices"][0];
    assert_eq!(notice["identity"], USER);
    assert_eq!(notice["input"]["recipientIds"], json!([WORKER]));
    assert_eq!(notice["input"]["kind"], "announcement");
    assert_eq!(
        notice["input"]["message"],
        "Ben updated board status for product/worker\nstate: blocked → working\nReason: Approval recorded"
    );
    let sequence: Vec<_> = model["calls"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|call| call["request"]["operation"].as_str())
        .collect();
    assert!(
        sequence.iter().position(|op| *op == "identity.meta.apply")
            < sequence.iter().position(|op| *op == "dispatch.create")
    );
}
#[test]
fn conflict_keeps_state_refreshes_raw_preview_and_never_notifies() {
    let fixture = fixture();
    let draft = submit(preview(&fixture));
    fixture.change_model(|model| {
        model["members"][2]["metadata"]["squad.product.state"] = json!("review")
    });
    let outcome = apply(&fixture.core, &draft);
    let Outcome::Conflict(Ok(current)) = outcome else {
        panic!("{outcome:?}")
    };
    assert_eq!(current.state.as_deref(), Some("review"));
    assert_eq!(calls(&fixture, "dispatch.create"), 0);
    assert_eq!(calls(&fixture, "identity.meta.apply"), 1);
    assert!(matches!(
        apply(&fixture.core, &submit(current)),
        Outcome::Applied {
            notification: Ok(_),
            ..
        }
    ));
}
#[test]
fn notification_retry_has_frozen_intent_and_never_reapplies_metadata() {
    let fixture = fixture();
    let opening = preview(&fixture);
    fixture.change_model(|model| model["noticeFailure"] = json!(true));
    let outcome = apply(&fixture.core, &submit(opening.clone()));
    let Outcome::Applied {
        intent,
        notification: Err(_),
    } = outcome
    else {
        panic!("{outcome:?}")
    };
    assert!(!intent.accepted);
    let frozen = intent.input.clone();
    assert_eq!(calls(&fixture, "identity.meta.apply"), 1);
    fixture.change_model(|model| model["noticeFailure"] = json!(false));
    let Outcome::Applied {
        intent,
        notification: Ok(_),
    } = retry(&fixture.core, &opening, intent)
    else {
        panic!("retry failed")
    };
    assert_eq!(intent.input, frozen);
    assert_eq!(calls(&fixture, "identity.meta.apply"), 1);
    assert_eq!(fixture.model()["notices"].as_array().unwrap().len(), 1);
    assert!(matches!(
        retry(&fixture.core, &opening, intent),
        Outcome::Applied {
            notification: Ok(_),
            ..
        }
    ));
    assert_eq!(fixture.model()["notices"].as_array().unwrap().len(), 1);
    assert_eq!(calls(&fixture, "dispatch.create"), 2);
}
#[test]
fn refused_notification_context_keeps_applied_status_and_frozen_intent() {
    for changed in ["actor", "room", "retired"] {
        let fixture = fixture();
        let opening = preview(&fixture);
        fixture.change_model(|model| model["noticeFailure"] = json!(true));
        let Outcome::Applied { intent, .. } = apply(&fixture.core, &submit(opening.clone())) else {
            panic!("metadata must be applied before context changes")
        };
        let frozen = intent.clone();
        let metadata = fixture.model()["members"][2]["metadata"].clone();
        let applies = calls(&fixture, "identity.meta.apply");
        let dispatches = calls(&fixture, "dispatch.create");
        match changed {
            "actor" => fixture.change_model(|model| model["user"] = json!(WORKER)),
            "room" => fixture.change_model(|model| model["room"] = json!("different")),
            "retired" => fixture.change_model(|model| model["retired"] = json!([WORKER])),
            _ => unreachable!(),
        }
        let Outcome::Applied {
            intent,
            notification: Err(notice),
        } = retry(&fixture.core, &opening, intent)
        else {
            panic!("context refusal must retain the applied outcome")
        };
        assert!(notice.contains("status remains applied"), "{notice}");
        assert!(notice.contains("action refused"), "{notice}");
        assert!(!notice.to_lowercase().contains("nothing applied"));
        assert_eq!(intent, frozen);
        assert_eq!(fixture.model()["members"][2]["metadata"], metadata);
        assert_eq!(calls(&fixture, "identity.meta.apply"), applies);
        assert_eq!(calls(&fixture, "dispatch.create"), dispatches);
    }
}
#[test]
fn lost_apply_output_never_notifies_or_offers_mutation_replay() {
    let fixture = fixture();
    let draft = submit(preview(&fixture));
    fixture.change_model(|model| model["loseApplyResponse"] = json!(true));
    assert!(matches!(apply(&fixture.core, &draft), Outcome::Unknown(_)));
    assert_eq!(calls(&fixture, "dispatch.create"), 0);
    assert_eq!(
        fixture.model()["members"][2]["metadata"]["squad.product.state"],
        "working"
    );
}
#[test]
fn lost_notification_output_recovers_accepted_operation_without_repeat() {
    let fixture = fixture();
    let opening = preview(&fixture);
    fixture.change_model(|model| {
        model["loseAnnouncementResponse"] = json!(true);
        model["dispatchShowFailure"] = json!(true);
    });
    let Outcome::Applied {
        intent,
        notification: Err(_),
    } = apply(&fixture.core, &submit(opening.clone()))
    else {
        panic!("must retain uncertain notice")
    };
    assert!(intent.recover);
    let operation = intent.operation.clone();
    fixture.change_model(|model| model["dispatchShowFailure"] = json!(false));
    let Outcome::Applied {
        intent,
        notification: Ok(_),
    } = retry(&fixture.core, &opening, intent)
    else {
        panic!("must recover")
    };
    assert!(intent.accepted);
    assert_eq!(intent.operation, operation);
    assert_eq!(calls(&fixture, "dispatch.create"), 1);
    assert_eq!(calls(&fixture, "identity.meta.apply"), 1);
    assert_eq!(fixture.model()["notices"].as_array().unwrap().len(), 1);
}
#[test]
fn namespace_room_actor_and_retired_uuid_changes_refuse_before_apply() {
    for field in ["namespace", "key", "room", "actor", "retired"] {
        let fixture = fixture();
        let mut opening = preview(&fixture);
        match field {
            "namespace" => opening.namespace = "squad.other.".into(),
            "key" => opening.key = "squad.other.state".into(),
            "room" => fixture.change_model(|model| model["room"] = json!("different")),
            "actor" => opening.target.actor = WORKER.into(),
            "retired" => fixture.change_model(|model| model["retired"] = json!([WORKER])),
            _ => unreachable!(),
        }
        assert!(
            matches!(apply(&fixture.core, &submit(opening)), Outcome::Refused(_)),
            "{field}"
        );
        assert_eq!(calls(&fixture, "identity.meta.apply"), 0);
        assert_eq!(calls(&fixture, "dispatch.create"), 0);
    }
}
#[test]
fn state_updates_require_an_explicit_replacement_and_compare_absence() {
    let fixture = fixture();
    let opening = preview(&fixture);
    for raw in ["", "bad\nvalue"] {
        let mut draft = submit(opening.clone());
        draft.preview.state = Some(raw.into());
        assert!(
            matches!(apply(&fixture.core,&draft),Outcome::Refused(message) if message.contains("Unsupported"))
        );
    }
    let mut draft = submit(opening);
    draft.state = None;
    assert!(matches!(apply(&fixture.core, &draft), Outcome::Refused(_)));
    assert_eq!(calls(&fixture, "identity.meta.apply"), 0);
    assert_eq!(
        fixture.model()["members"][2]["metadata"]["squad.product.state"],
        "blocked"
    );
    let mut absent = preview(&fixture);
    absent.state = None;
    let changes = Submit {
        preview: absent,
        state: Some("done".into()),
        reason: "explicit choice".into(),
    }
    .changes()
    .unwrap()
    .0;
    assert_eq!(
        changes,
        json!([{"key":"squad.product.state","expect":"absent","then":{"set":"done"}}])
            .as_array()
            .unwrap()
            .clone()
    );
}

#[test]
fn retired_metadata_changes_do_not_conflict_with_a_state_replacement() {
    let fixture = fixture();
    let draft = submit(preview(&fixture));
    fixture.change_model(|model| {
        model["members"][2]["metadata"]["squad.product.pending"] = json!("intervening");
    });
    assert!(matches!(
        apply(&fixture.core, &draft),
        Outcome::Applied { .. }
    ));
    assert_eq!(
        fixture.model()["members"][2]["metadata"]["squad.product.pending"],
        "intervening"
    );
    assert_eq!(calls(&fixture, "identity.meta.apply"), 1);
}

#[test]
fn replacing_state_with_the_same_value_never_writes_or_notifies() {
    let fixture = fixture();
    let mut draft = submit(preview(&fixture));
    draft.state = draft.preview.state.clone();
    assert!(matches!(apply(&fixture.core, &draft), Outcome::Refused(_)));
    assert_eq!(calls(&fixture, "identity.meta.apply"), 0);
    assert_eq!(calls(&fixture, "dispatch.create"), 0);
}
