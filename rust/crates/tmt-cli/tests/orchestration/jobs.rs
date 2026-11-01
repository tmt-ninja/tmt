//! Real CLI job management shares the public read/consent/write boundaries.
use super::*;
fn definition(owner: &str, message: &str) -> Value {
    json!({"ownerIdentityId":owner,"squadRoomId":null,"title":"Standup","message":message,"schedule":{"kind":"every","zone":"UTC","seconds":10,"anchorMs":0}})
}
#[test]
fn job_help_preview_exact_message_and_cli_api_reads_are_causal() {
    let mut f = Fixture::new();
    let help = f.run(&["orch", "job", "--help"], None);
    assert!(help.status.success());
    assert!(String::from_utf8(help.stdout).unwrap().contains("reassign"));
    assert!(!f.db().exists());
    let owner = f.seed();
    let path = f.root.join("job.json");
    let message = "  hello\0雪\r\n";
    fs::write(&path, definition(&owner, message).to_string()).unwrap();
    let path = path.to_str().unwrap();
    let before = cursor(&f.db());
    let p = f.json(&["orch", "job", "add", "--file", path, "--json"], None);
    assert_eq!(p["requiresConsent"], true);
    assert_eq!(cursor(&f.db()), before);
    let human = f.run(&["orch", "job", "add", "--file", path], None);
    assert!(human.status.success());
    assert!(
        String::from_utf8(human.stdout)
            .unwrap()
            .contains("Job preview")
    );
    assert_eq!(cursor(&f.db()), before);
    let saved = f.json(
        &["orch", "job", "add", "--file", path, "--yes", "--json"],
        None,
    );
    let id = saved["job"]["id"].as_str().unwrap();
    assert_eq!(saved["configurationRevision"], 5);
    let before = cursor(&f.db());
    let shown = f.json(&["orch", "job", "show", "j1", "--json"], None);
    assert_eq!(shown["job"]["jobId"], id);
    assert_eq!(shown["job"]["definition"]["message"], message);
    assert!(shown["job"]["lastRun"].is_null());
    let mut cli = f.json(&["orch", "job", "ls", "--owner", "Night-1", "--json"], None);
    let mut api=f.json(&["api"],Some(json!({"version":1,"operation":"orchestration.read","input":{"view":"jobs","ownerIdentityId":owner,"limit":50}})));
    cli.as_object_mut().unwrap().remove("observedAtMs");
    api.as_object_mut().unwrap().remove("observedAtMs");
    assert_eq!(cli, api);
    assert_eq!(cursor(&f.db()), before);
}
#[test]
fn cli_pause_reassign_resume_remove_preserves_sticky_pause_and_non_reused_ids() {
    let mut f = Fixture::new();
    let owner = f.seed();
    let path = f.root.join("job.json");
    fs::write(&path, definition(&owner, "message").to_string()).unwrap();
    let file = path.to_str().unwrap();
    f.json(
        &["orch", "job", "add", "--file", file, "--yes", "--json"],
        None,
    );
    let mut s = Storage::open(f.db()).unwrap();
    let other = create_or_resolve(&mut s, "Day-1", Lifetime::Saved)
        .unwrap()
        .identity;
    s.close().unwrap();
    let paused = f.json(&["orch", "job", "pause", "j1", "--yes", "--json"], None);
    assert_eq!(paused["job"]["manualPause"]["by"], "manual");
    let reassigned = f.json(
        &["orch", "job", "reassign", "j1", "Day-1", "--yes", "--json"],
        None,
    );
    assert_eq!(reassigned["job"]["definition"]["ownerIdentityId"], other.id);
    assert_eq!(
        reassigned["job"]["manualPause"],
        paused["job"]["manualPause"]
    );
    let resumed = f.json(&["orch", "job", "resume", "j1", "--yes", "--json"], None);
    assert!(resumed["job"]["manualPause"].is_null());
    let removed = f.json(&["orch", "job", "rm", "j1", "--yes", "--json"], None);
    assert_eq!(removed["removed"], true);
    let missing = f.run(&["orch", "job", "show", "j1", "--json"], None);
    assert_eq!(missing.status.code(), Some(3));
    assert!(missing.stderr.is_empty());
    let error: Value = serde_json::from_slice(&missing.stdout).unwrap();
    assert_eq!(error["error"]["code"], "ORCH_JOB_NOT_FOUND");
    let next = f.json(
        &["orch", "job", "add", "--file", file, "--yes", "--json"],
        None,
    );
    assert_eq!(next["job"]["displayId"], "j2");
    let link = f.root.join("job-link.json");
    std::os::unix::fs::symlink(&path, &link).unwrap();
    let before = cursor(&f.db());
    let bad = f.run(
        &[
            "orch",
            "job",
            "add",
            "--file",
            link.to_str().unwrap(),
            "--yes",
            "--json",
        ],
        None,
    );
    assert!(!bad.status.success());
    assert_eq!(cursor(&f.db()), before);
}

#[test]
fn manual_send_is_one_canonical_automated_request_without_resuming_or_consuming_hold() {
    let mut f = Fixture::new();
    let owner = f.seed();
    let path = f.root.join("job.json");
    fs::write(&path, definition(&owner, "send exactly once").to_string()).unwrap();
    let saved = f.json(
        &[
            "orch",
            "job",
            "add",
            "--file",
            path.to_str().unwrap(),
            "--yes",
            "--json",
        ],
        None,
    );
    let id = saved["job"]["id"].as_str().unwrap();
    f.json(&["orch", "job", "pause", "j1", "--yes", "--json"], None);
    let db = Connection::open(f.db()).unwrap();
    db.execute(
        "UPDATE orchestration_jobs SET pending_revision=revision,pending_ms=1000 WHERE id=?",
        [id],
    )
    .unwrap();
    let operation = "55555555-5555-4555-8555-555555555555";
    let preview = f.json(
        &[
            "orch",
            "job",
            "send",
            "j1",
            "--identity",
            "Night-1",
            "--operation-id",
            operation,
            "--json",
        ],
        None,
    );
    assert_eq!(preview["requiresConsent"], true);
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM request_attempts", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    let argv = [
        "orch",
        "job",
        "send",
        "j1",
        "--identity",
        "Night-1",
        "--operation-id",
        operation,
        "--yes",
        "--json",
    ];
    let first = f.json(&argv, None);
    let replay = f.json(&argv, None);
    assert_eq!(first["outcome"], "accepted");
    assert_eq!(first["dispatch"]["operationId"], operation);
    assert_eq!(first["runId"], replay["runId"]);
    assert_eq!(db.query_row("SELECT COUNT(*) FROM request_attempts WHERE origin='automation' AND originator_identity_id=?",[&owner],|r|r.get::<_,i64>(0)).unwrap(),1);
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM orchestration_job_runs", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        db.query_row(
            "SELECT revision,pause_by,pending_ms FROM orchestration_jobs WHERE id=?",
            [id],
            |r| Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?
            ))
        )
        .unwrap(),
        (2, "manual".into(), 1000)
    );
}
