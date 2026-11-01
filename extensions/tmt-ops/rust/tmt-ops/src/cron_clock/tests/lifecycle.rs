//! Ops keeps migration and idle alerts; Core alone owns scheduling.
use super::*;
use std::fs;
use tmt_ops::cron::Clock;
fn wait_for<T>(mut read: impl FnMut() -> Option<T>) -> T {
    let until = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(value) = read() {
            return value;
        }
        assert!(
            Instant::now() < until,
            "private worker did not reach readiness"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}
fn legacy(f: &Fixture) -> (Core, Config, tmt_ops::cron::Lease, Vec<u8>) {
    crate::migration::paths(&f.core, None).unwrap();
    if f.directory.join("ops").exists() {
        fs::rename(f.directory.join("ops"), f.directory.join("squad")).unwrap();
    }
    fs::rename(f.directory.join("ops.toml"), f.directory.join("squad.toml")).unwrap();
    for name in [".ops-paths-v1", ".ops-paths-cutover-v1"] {
        fs::remove_file(f.directory.join(name)).unwrap();
    }
    let lease = Clock::new(&f.directory.join("squad"))
        .unwrap()
        .acquire(now(), 123, Some("%41".into()), "0.1.0")
        .unwrap()
        .unwrap();
    let held = fs::read(f.directory.join("squad/cron/clock.json")).unwrap();
    let core = Core::at(f.core.executable().into());
    let config = Config::load(&core).unwrap();
    (core, config, lease, held)
}
#[test]
fn competing_core_clock_does_not_stop_idle_alerts_or_restart_scheduling() {
    let f = Fixture::new();
    let at = 1_800_000_000_000i64;
    fs::write(
        f.config.path(),
        format!(
            "me='Ben'\nme_id='{USER}'\n[squad.product.idle_alert]\nenabled=true\nafter='30m'\n"
        ),
    )
    .unwrap();
    let holder = json!({"schemaVersion":1,"state":"running","holder":{"pid":42,"pane":"%7","startedAtMs":100,"expiresAtMs":30100,"build":"other"}});
    f.change_model(|m|{m["clockStatus"]=holder.clone();m["ls"]=json!([{"id":WORKER,"presence":"active","pane":"%1","session":{"activity":{"state":"idle","sinceMs":at-3_600_000,"lastActivityMs":at-3_600_000}}}]);});
    let scans = Arc::new(AtomicUsize::new(0));
    let observed = scans.clone();
    let mut worker =
        ClockWorker::spawn_clock(f.core.clone(), f.config.clone(), false, true, move || {
            at + 60_000 * observed.fetch_add(1, Ordering::Relaxed) as i64
        });
    wait_for(|| {
        (scans.load(Ordering::Relaxed) >= 3 && f.model()["notices"].as_array().unwrap().len() == 1)
            .then_some(())
    });
    let result = worker.stop().unwrap();
    let model = f.model();
    assert_eq!(
        model["clockStarts"], 1,
        "an uncertain/competing clock is never restarted"
    );
    assert_eq!(
        model["clockStatus"], holder,
        "Ops must not mutate another owner's holder"
    );
    assert_eq!(
        model["notices"].as_array().unwrap().len(),
        1,
        "same idle episode is announced only once"
    );
    assert_eq!(model["notices"][0]["input"]["recipientIds"], json!([LEAD]));
    assert_eq!(model["notices"][0]["input"]["origin"], "automation");
    assert!(
        result["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w["error"]["code"] == "TICK_CLOCK_RUNNING")
    );
    assert!(!f.directory.join("ops/cron/clock.json").exists());
}
#[test]
fn stopping_a_deferred_worker_preserves_the_old_holder_and_is_interruptible() {
    let f = Fixture::new();
    let (core, config, lease, held) = legacy(&f);
    let mut worker = ClockWorker::spawn(core, config, false);
    let started = Instant::now();
    worker.stop().unwrap();
    assert!(
        started.elapsed() < EVERY,
        "disconnect wakes the deferred cadence"
    );
    assert_eq!(
        fs::read(f.directory.join("squad/cron/clock.json")).unwrap(),
        held
    );
    assert!(!f.directory.join("ops").exists());
    assert!(f.model().get("clockStarts").is_none());
    lease.release().unwrap();
}
#[test]
fn deferred_shutdown_joins_an_inflight_migration_read_before_returning() {
    let f = Fixture::new();
    let (core, config, lease, held) = legacy(&f);
    f.change_model(|m| m["blockOn"] = json!("storage.root"));
    let mut worker = ClockWorker::spawn(core, config, false);
    let pid: i32 = wait_for(|| {
        fs::read_to_string(f.directory.join("blocked.pid"))
            .ok()?
            .parse()
            .ok()
    });
    let started = Instant::now();
    worker.stop().unwrap();
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(
        nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None),
        Err(nix::errno::Errno::ESRCH)
    );
    assert_eq!(
        fs::read(f.directory.join("squad/cron/clock.json")).unwrap(),
        held
    );
    assert!(!f.directory.join("ops").exists());
    lease.release().unwrap();
}
#[test]
fn deferred_workers_migrate_without_preempting_legacy_then_offer_only_core_clocks() {
    let f = Fixture::new();
    let job = f.add(&f.actor(LEAD), WORKER).unwrap().job.job;
    let source = crate::test_support::stored_jobs(&f.directory);
    let before = f.current_jobs().document();
    let (core, config, lease, held) = legacy(&f);
    let reads = || {
        f.model()["calls"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|call| call["request"]["operation"] == "storage.root")
            .count()
    };
    let before_reads = reads();
    let mut first = ClockWorker::spawn(core.clone(), config.clone(), false);
    let mut second = ClockWorker::spawn(core.clone(), config, false);
    wait_for(|| (reads() >= before_reads + 2).then_some(()));
    assert_eq!(
        fs::read(f.directory.join("squad/cron/clock.json")).unwrap(),
        held
    );
    assert!(!f.directory.join("ops").exists());
    assert!(f.model().get("clockStarts").is_none());
    let directory = f.directory.join("squad/cron");
    let guard = wait_for(|| {
        let file = fs::File::open(directory.join("clock.lock")).unwrap();
        match nix::fcntl::Flock::lock(file, nix::fcntl::FlockArg::LockExclusiveNonblock) {
            Ok(guard) => Some(guard),
            Err((_, nix::errno::Errno::EAGAIN)) => None,
            Err((_, e)) => panic!("fixture clock lock: {e}"),
        }
    });
    assert_eq!(fs::read(directory.join("clock.json")).unwrap(), held);
    fs::remove_file(directory.join("clock.json")).unwrap();
    fs::File::open(&directory).unwrap().sync_all().unwrap();
    drop(guard);
    drop(lease);
    // Retain the original migration-control bound: directory publication and syncs
    // are slower than the ordinary fixture readiness checks on a loaded host.
    let until = Instant::now() + Duration::from_secs(60);
    loop {
        if f.model()["clockStarts"] == 2 {
            break;
        }
        assert!(
            Instant::now() < until,
            "deferred workers did not reach the public clock boundary"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(!crate::migration::paths(&core, None).unwrap().legacy);
    assert_eq!(crate::test_support::stored_jobs(&f.directory), source);
    assert_eq!(f.current_jobs().document(), before);
    assert_eq!(f.current_jobs().jobs()[0].id(), job.id());
    assert!(!f.directory.join("squad").exists());
    assert!(!f.directory.join("ops/cron/clock.json").exists());
    first.stop().unwrap();
    second.stop().unwrap();
}
