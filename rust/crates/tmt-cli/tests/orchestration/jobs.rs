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
    let request = json!({"version":1,"operation":"orchestration.job.run","identity":"Night-1","input":{"jobId":id,"revision":2,"slotMs":1000,"manualOperationId":operation,"consent":true}});
    let api = f.json(&["api"], Some(request.clone()));
    assert_eq!(api["runId"], first["runId"]);
    let mut refused = request;
    refused["input"]["consent"] = json!(false);
    let denied = f.run(&["api"], Some(refused));
    assert!(!denied.status.success());

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

#[test]
fn frozen_file_preview_is_read_only_and_adoption_receipt_recovers_exact_large_source() {
    let mut f = Fixture::new();
    let empty = f.root.join("empty-jobs.json");
    let empty_bytes = br#"{"version":2,"counters":{},"jobs":[]}"#;
    fs::write(&empty, empty_bytes).unwrap();
    let (empty_digest, _) = tmt_adapters::storage::preview_job_import(empty_bytes).unwrap();
    let source = "33333333-3333-4333-8333-333333333333";
    let preview = f.json(
        &[
            "orch",
            "job",
            "import",
            "--file",
            empty.to_str().unwrap(),
            "--source-id",
            source,
            "--digest",
            &empty_digest,
            "--json",
        ],
        None,
    );
    assert_eq!(preview["requiresConsent"], true);
    assert!(
        !f.db().exists(),
        "preflight must not initialize Core storage"
    );
    let owner = f.seed();
    let message = "x".repeat(900_000);
    let jobs=(1..=8).map(|number|json!({"id":format!("c{number}"),"roomId":PLAN,"ownerId":owner,"message":message,"revision":1,"state":"on","pause":null,"schedule":{"kind":"every","zone":"UTC","seconds":10,"anchorMs":0}})).collect::<Vec<_>>();
    let bytes =
        serde_json::to_vec(&json!({"version":2,"counters":{(PLAN):8},"jobs":jobs})).unwrap();
    assert!(
        bytes.len() > tmt_adapters::api::INPUT_LIMIT,
        "this path must exceed a normal API frame"
    );
    let file = f.root.join("frozen-jobs.json");
    fs::write(&file, &bytes).unwrap();
    let (digest, count) = tmt_adapters::storage::preview_job_import(&bytes).unwrap();
    assert_eq!(count, 8);
    let args = [
        "orch",
        "job",
        "import",
        "--file",
        file.to_str().unwrap(),
        "--source-id",
        source,
        "--digest",
        &digest,
        "--yes",
        "--json",
    ];
    let adopted = f.json(&args, None);
    assert_eq!(adopted["receipt"]["sourceDigest"], digest);
    assert_eq!(adopted["receipt"]["jobs"].as_array().unwrap().len(), 8);
    let before = cursor(&f.db());
    assert_eq!(f.json(&args, None)["receipt"], adopted["receipt"]);
    assert_eq!(cursor(&f.db()), before, "exact import replay is a no-op");
    let recovered = f.json(&["orch", "job", "import-receipt", source, "--json"], None);
    assert_eq!(recovered["receipt"], adopted["receipt"]);
    let mut storage = Storage::open(f.db()).unwrap();
    for reference in adopted["receipt"]["jobs"].as_array().unwrap() {
        let job = storage
            .orchestration_job(reference["jobId"].as_str().unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(job.message, message);
        assert_eq!(job.legacy.as_ref().unwrap().room_id, PLAN);
        assert_eq!(
            job.legacy.unwrap().cron_id,
            reference["cronId"].as_u64().unwrap()
        );
    }
    storage.close().unwrap();
    fs::write(&file, empty_bytes).unwrap();
    let changed = f.run(&args, None);
    assert_eq!(changed.status.code(), Some(5));
    assert_eq!(cursor(&f.db()), before);
    assert_eq!(
        f.json(&["orch", "job", "import-receipt", source, "--json"], None)["receipt"],
        adopted["receipt"]
    );
}
#[test]
fn adoption_refuses_linked_or_oversized_sources_before_opening_storage() {
    use std::os::unix::fs::symlink;
    let mut f = Fixture::new();
    let actual = f.root.join("source.json");
    let selected = f.root.join("selected.json");
    fs::write(&actual, b"{}").unwrap();
    symlink(&actual, &selected).unwrap();
    let digest = "a".repeat(64);
    let args = [
        "orch",
        "job",
        "import",
        "--file",
        selected.to_str().unwrap(),
        "--source-id",
        "33333333-3333-4333-8333-333333333333",
        "--digest",
        &digest,
        "--yes",
        "--json",
    ];
    assert_eq!(f.run(&args, None).status.code(), Some(1));
    assert!(!f.db().exists());
    fs::remove_file(&selected).unwrap();
    fs::File::create(&selected)
        .unwrap()
        .set_len(16 * 1024 * 1024 + 1)
        .unwrap();
    assert_eq!(f.run(&args, None).status.code(), Some(1));
    assert!(!f.db().exists());
    assert_eq!(fs::read(actual).unwrap(), b"{}");
}
