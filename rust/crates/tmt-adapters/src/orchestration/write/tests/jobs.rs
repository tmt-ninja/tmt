//! Public job mutation controls, including the writer admission race.
use super::*;
use tmt_core::orchestration::jobs::{JobError, JobPause};
fn candidate(owner: &str, message: &str) -> Value {
    json!({"ownerIdentityId":owner,"squadRoomId":null,"title":"Reminder","message":message,"schedule":{"kind":"every","zone":"UTC","seconds":10,"anchorMs":0}})
}
fn add(s: &mut Storage, owner: &str) -> Value {
    let p = preview_for(
        s,
        json!({"kind":"job.add","candidate":candidate(owner,"hello")}),
    );
    serde_json::from_slice(&orchestration_write(s, apply_query(&p), || NOW).unwrap()).unwrap()
}
fn action(s: &mut Storage, kind: &str, id: &str, revision: u64) -> Value {
    let mut m = json!({"kind":kind,"jobId":id,"revision":revision});
    if kind == "job.pause" {
        m["by"] = json!("person");
    }
    let p = preview_for(s, m);
    serde_json::from_slice(&orchestration_write(s, apply_query(&p), || NOW).unwrap()).unwrap()
}
#[test]
fn job_preview_writes_nothing_and_consented_apply_preserves_large_exact_input() {
    let (d, mut s, owner) = fixture();
    let before = cursor(&d);
    let text = format!("  {}\0雪\r\n", "λ".repeat(30_000));
    let p = preview_for(
        &mut s,
        json!({"kind":"job.add","candidate":candidate(&owner,&text)}),
    );
    assert_eq!(cursor(&d), before);
    assert!(p["before"].is_null());
    assert_eq!(p["after"]["message"], text);
    let mut refused = json!({"phase":"apply","mutation":p["mutation"],"expectedConfigurationRevision":p["configurationRevision"],"previewAtMs":p["previewAtMs"],"previewDigest":p["previewDigest"],"consent":false});
    assert!(decode_orch_write(&serde_json::to_vec(&refused).unwrap()).is_err());
    refused["mutation"]["candidate"]["unexpected"] = json!(true);
    assert!(decode_orch_write(&serde_json::to_vec(&refused).unwrap()).is_err());
    let result: Value =
        serde_json::from_slice(&orchestration_write(&mut s, apply_query(&p), || NOW).unwrap())
            .unwrap();
    let id = result["job"]["id"].as_str().unwrap();
    assert_eq!(s.orchestration_job(id).unwrap().unwrap().message, text);
    assert_eq!(result["job"]["revision"], 1);
    assert!(result["job"]["manualPause"].is_null());
    assert_eq!(
        s.orchestration_snapshot(None).unwrap().snapshot.revision,
        p["configurationRevision"].as_u64().unwrap() + 1
    );
    let db = rusqlite::Connection::open(d.path.join("state.db")).unwrap();
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM orchestration_decisions", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0,
        "configuration does not fabricate run outcomes"
    );
}
#[test]
fn pause_is_sticky_idempotent_and_resume_is_explicit() {
    let (_d, mut s, owner) = fixture();
    let job = add(&mut s, &owner);
    let id = job["job"]["id"].as_str().unwrap();
    let paused = action(&mut s, "job.pause", id, 1);
    assert_eq!(paused["job"]["revision"], 2);
    assert_eq!(
        paused["job"]["manualPause"],
        json!({"by":"person","atMs":NOW})
    );
    let revision = s.orchestration_snapshot(None).unwrap().snapshot.revision;
    let again = action(&mut s, "job.pause", id, 2);
    assert_eq!(again["job"], paused["job"]);
    assert_eq!(
        s.orchestration_snapshot(None).unwrap().snapshot.revision,
        revision
    );
    let resumed = action(&mut s, "job.resume", id, 2);
    assert_eq!(resumed["job"]["revision"], 3);
    assert!(resumed["job"]["manualPause"].is_null());
    let stale = json!({"kind":"job.rm","jobId":id,"revision":1});
    let e = orchestration_write(
        &mut s,
        query(json!({"phase":"preview","mutation":stale})),
        || NOW,
    )
    .unwrap_err();
    assert_eq!((e.code(), e.exit()), ("ORCH_CONFLICT", 5));
}
#[test]
fn another_configuration_or_an_observed_hold_invalidates_the_preview() {
    let (d, mut s, owner) = fixture();
    let job = add(&mut s, &owner);
    let id = job["job"]["id"].as_str().unwrap();
    let m = json!({"kind":"job.pause","jobId":id,"revision":1,"by":"person"});
    let p = preview_for(&mut s, m.clone());
    let mut other = Storage::open(d.path.join("state.db")).unwrap();
    add(&mut other, &owner);
    let e = orchestration_write(&mut s, apply_query(&p), || NOW).unwrap_err();
    assert_eq!(e.code(), "ORCH_CONFLICT");
    let p = preview_for(&mut s, m);
    let fence = s.job_write_fence(Some(id)).unwrap();
    let db = rusqlite::Connection::open(d.path.join("state.db")).unwrap();
    db.execute(
        "UPDATE orchestration_jobs SET pending_revision=revision,pending_ms=1000 WHERE id=?",
        [id],
    )
    .unwrap();
    let e = orchestration_write(&mut s, apply_query(&p), || NOW).unwrap_err();
    assert_eq!(e.code(), "ORCH_CONFLICT");
    // This is the race after the service's readback but before writer admission.
    assert!(matches!(
        s.change_job_fenced(id, 1, Some(&fence), |job| {
            job.pause = Some(JobPause {
                by: "stale".into(),
                at_ms: 1000,
            });
            Ok(())
        }),
        Err(crate::storage::JobStoreError::Job(JobError::Conflict))
    ));
    let current = s.orchestration_job(id).unwrap().unwrap();
    assert!(current.pause.is_none());
    assert_eq!(current.pending.unwrap().at_ms, 1000);
    other.close().unwrap();
}
#[test]
fn owner_retirement_or_failed_configuration_commit_leaves_no_job() {
    let (d, mut s, owner) = fixture();
    let p = preview_for(
        &mut s,
        json!({"kind":"job.add","candidate":candidate(&owner,"hello")}),
    );
    let db = rusqlite::Connection::open(d.path.join("state.db")).unwrap();
    db.execute(
        "UPDATE identities SET retired_at_ms=? WHERE id=?",
        rusqlite::params![NOW as i64, owner],
    )
    .unwrap();
    let e = orchestration_write(&mut s, apply_query(&p), || NOW).unwrap_err();
    assert_eq!(e.code(), "ORCH_JOB_NO_OWNER");
    db.execute(
        "UPDATE identities SET retired_at_ms=NULL WHERE id=?",
        [&owner],
    )
    .unwrap();
    db.execute_batch("CREATE TRIGGER fail_job_configuration BEFORE UPDATE ON orchestration_settings BEGIN SELECT RAISE(ABORT,'injected configuration failure'); END;").unwrap();
    let before = cursor(&d);
    assert!(orchestration_write(&mut s, apply_query(&p), || NOW).is_err());
    assert_eq!(
        cursor(&d),
        before,
        "job and cursor roll back with configuration"
    );
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM orchestration_jobs", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    db.execute_batch("DROP TRIGGER fail_job_configuration")
        .unwrap();
    orchestration_write(&mut s, apply_query(&p), || NOW).unwrap();
}
#[test]
fn explicit_no_owner_stays_paused_and_reassignment_does_not_implicitly_resume() {
    let (_d, mut s, owner) = fixture();
    let mut c = candidate(&owner, "preserved");
    c["ownerIdentityId"] = Value::Null;
    let p = preview_for(&mut s, json!({"kind":"job.add","candidate":c}));
    let r: Value =
        serde_json::from_slice(&orchestration_write(&mut s, apply_query(&p), || NOW).unwrap())
            .unwrap();
    let id = r["job"]["id"].as_str().unwrap();
    assert_eq!(r["job"]["manualPause"]["by"], "no owner");
    let p = preview_for(
        &mut s,
        json!({"kind":"job.set","jobId":id,"revision":1,"candidate":candidate(&owner,"preserved")}),
    );
    let r: Value =
        serde_json::from_slice(&orchestration_write(&mut s, apply_query(&p), || NOW).unwrap())
            .unwrap();
    assert_eq!(r["job"]["definition"]["ownerIdentityId"], owner);
    assert_eq!(r["job"]["manualPause"]["by"], "no owner");
    action(&mut s, "job.resume", id, 2);
    let removed = action(&mut s, "job.rm", id, 3);
    assert_eq!(removed["removed"], true);
    assert!(s.orchestration_job(id).unwrap().is_none());
}
