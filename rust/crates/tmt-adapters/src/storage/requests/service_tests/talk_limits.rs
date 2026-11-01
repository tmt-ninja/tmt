//! Sending rules and talk limits in the preparation transaction (#4892).
use super::digest::request;
use super::support::{Fixture, NOW_MS, count_rows, service};
use rusqlite::Connection;
use tmt_core::{
    identity::{Lifetime, create_or_resolve},
    operation::new_operation_id,
    request::{
        AttemptStatus, Originator, PreparedRequest, RequestError, RequestOrigin,
        digest::DeliveryPolicy,
    },
};

const PLAN: &str = "11111111-1111-4111-8111-111111111111";

fn identity(f: &mut Fixture, name: &str) -> String {
    create_or_resolve(&mut f.storage, name, Lifetime::Saved)
        .unwrap()
        .identity
        .id
}

/// A target (the fixture owner) and two agents, with one always-on plan for everyone.
fn world(fields: &str) -> (Fixture, Connection, String, String) {
    let mut f = Fixture::new();
    let a = identity(&mut f, "Agent A");
    let b = identity(&mut f, "Agent B");
    let db = Connection::open(&f.database).unwrap();
    db.execute("INSERT INTO orchestration_settings VALUES(1,1,'UTC')", [])
        .unwrap();
    db.execute(
        "INSERT INTO orchestration_plans(id,name,revision,priority,enabled,schedule,fields) VALUES(?1,'Rules',1,1,1,'{\"kind\":\"always\"}',?2)",
        [PLAN, fields],
    )
    .unwrap();
    db.execute(
        "INSERT INTO orchestration_plan_targets VALUES(?1,0,'{\"kind\":\"all\"}')",
        [PLAN],
    )
    .unwrap();
    (f, db, a, b)
}

fn send(
    f: &mut Fixture,
    from: &str,
    to: &str,
) -> Result<PreparedRequest, RequestError<crate::storage::StorageError>> {
    send_as(f, from, to, RequestOrigin::Person)
}

fn send_as(
    f: &mut Fixture,
    from: &str,
    to: &str,
    origin: RequestOrigin,
) -> Result<PreparedRequest, RequestError<crate::storage::StorageError>> {
    let id = format!("req_{}", new_operation_id());
    let mut input = request(to, Some(from), &id);
    input.origin = origin;
    service(f).prepare_delivery(
        input,
        format!("attempt-{id}"),
        7,
        DeliveryPolicy::default(),
        None,
    )
}

fn decisions(db: &Connection, reason: &str) -> i64 {
    db.query_row(
        "SELECT COUNT(*) FROM orchestration_decisions WHERE reason=?",
        [reason],
        |r| r.get(0),
    )
    .unwrap()
}

#[test]
fn a_restricted_route_stores_nothing_until_a_grant_lets_it_through() {
    let (mut f, db, a, b) = world("{\"sending\":\"paused\"}");
    let before = count_rows(&f.database, "request_attempts");
    assert!(matches!(
        send(&mut f, &a, &b),
        Err(RequestError::RouteRestricted(_))
    ));
    assert_eq!(count_rows(&f.database, "request_attempts"), before);
    db.execute(
        "INSERT INTO orchestration_route_grants(from_id,to_id,until_ms,granted_by) VALUES(?1,?2,?3,NULL)",
        rusqlite::params![a, b, (NOW_MS + 1000) as i64],
    )
    .unwrap();
    assert!(!send(&mut f, &a, &b).unwrap().held_for_person);
    // A grant is one ordered route, and it ends.
    assert!(matches!(
        send(&mut f, &b, &a),
        Err(RequestError::RouteRestricted(_))
    ));
    f.set_now(NOW_MS + 1000);
    assert!(matches!(
        send(&mut f, &a, &b),
        Err(RequestError::RouteRestricted(_))
    ));
}

#[test]
fn leads_receive_under_a_leads_rule_until_retired() {
    let (mut f, db, a, b) = world("{\"sending\":\"leads\"}");
    assert!(matches!(
        send(&mut f, &a, &b),
        Err(RequestError::RouteRestricted(_))
    ));
    db.execute("INSERT INTO orchestration_leads VALUES(?)", [&b])
        .unwrap();
    assert!(send(&mut f, &a, &b).is_ok());
    db.execute(
        "UPDATE identities SET retired_at_ms=? WHERE id=?",
        rusqlite::params![NOW_MS as i64, b],
    )
    .unwrap();
    assert!(matches!(
        send(&mut f, &a, &b),
        Err(RequestError::RouteRestricted(_))
    ));
}

#[test]
fn exempt_senders_and_kinds_pass_a_paused_rule() {
    let (mut f, _db, a, b) = world("{\"sending\":\"paused\",\"talkLimit\":1}");
    // Jobs (automation), anonymous senders and the user person are never checked.
    for _ in 0..3 {
        assert!(send_as(&mut f, &a, &b, RequestOrigin::Automation).is_ok());
    }
    let id = format!("req_{}", new_operation_id());
    let mut anonymous = request(&b, None, &id);
    anonymous.originator = Originator::Unknown;
    assert!(
        service(&mut f)
            .prepare_delivery(
                anonymous,
                format!("attempt-{id}"),
                7,
                DeliveryPolicy::default(),
                None
            )
            .is_ok()
    );
    // A request to the user person is never checked.
    _db.execute(
        "INSERT INTO identity_metadata(identity_id,key,value) VALUES(?1,'user','true')",
        [&b],
    )
    .unwrap();
    assert!(send(&mut f, &a, &b).is_ok());
}

#[test]
fn the_limit_holds_both_directions_and_resume_restarts_the_window() {
    let (mut f, db, a, b) = world("{\"talkLimit\":2}");
    assert!(!send(&mut f, &a, &b).unwrap().held_for_person);
    assert!(!send(&mut f, &b, &a).unwrap().held_for_person);
    let first = send(&mut f, &a, &b).unwrap();
    let second = send(&mut f, &b, &a).unwrap();
    assert!(first.held_for_person && second.held_for_person);
    let attempt = service(&mut f)
        .get_attempt(&first.attempt_id)
        .unwrap()
        .unwrap();
    assert_eq!(attempt.status, AttemptStatus::Prepared);
    assert_eq!(decisions(&db, "talk_limit"), 2);
    let held: Vec<_> = f
        .storage
        .orchestration_held(&a, &b)
        .unwrap()
        .into_iter()
        .map(|h| h.request_id)
        .collect();
    assert_eq!(held.len(), 2);
    assert!(matches!(
        service(&mut f).resume_pair(&a, &b, None, &held[..1]),
        Err(RequestError::HeldChanged)
    ));
    f.set_now(NOW_MS + 10);
    let released = service(&mut f).resume_pair(&b, &a, None, &held).unwrap();
    assert_eq!(released.len(), 2);
    assert!(f.storage.orchestration_held(&a, &b).unwrap().is_empty());
    assert_eq!(decisions(&db, "talk_resumed"), 2);
    let attempt = service(&mut f)
        .get_attempt(&first.attempt_id)
        .unwrap()
        .unwrap();
    assert_ne!(attempt.status, AttemptStatus::Prepared);
    // The window restarted at the resume: two more pass before the next hold.
    assert!(!send(&mut f, &a, &b).unwrap().held_for_person);
    assert!(!send(&mut f, &a, &b).unwrap().held_for_person);
    assert!(send(&mut f, &a, &b).unwrap().held_for_person);
    let talks = f.storage.orchestration_talks(NOW_MS + 10).unwrap();
    assert_eq!(talks.len(), 1);
    assert_eq!((talks[0].count, talks[0].held.len()), (2, 1));
    assert_eq!(talks[0].window_start_ms, NOW_MS + 10);
}

#[test]
fn an_unresumed_hold_expires_unsent_once_and_resume_skips_it() {
    let (mut f, db, a, b) = world("{\"talkLimit\":1}");
    send(&mut f, &a, &b).unwrap();
    let held = send(&mut f, &a, &b).unwrap();
    assert!(held.held_for_person);
    let expires = service(&mut f)
        .get_attempt(&held.attempt_id)
        .unwrap()
        .unwrap()
        .expires_at_ms;
    assert!(expires <= NOW_MS + tmt_core::orchestration::sending::ORCH_HOLD_MS);
    f.set_now(expires);
    service(&mut f).cleanup().unwrap();
    service(&mut f).cleanup().unwrap();
    let status: String = db
        .query_row(
            "SELECT status FROM request_attempts WHERE request_id=?",
            [&held.request_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(status, "definitely_failed");
    assert_eq!(decisions(&db, "talk_hold_expired"), 1);
    let ids = vec![held.request_id.clone()];
    assert!(
        service(&mut f)
            .resume_pair(&a, &b, None, &ids)
            .unwrap()
            .is_empty()
    );
}
