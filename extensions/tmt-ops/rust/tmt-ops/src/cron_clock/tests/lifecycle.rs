//! Ops keeps migration and idle alerts; Core alone owns scheduling.
use super::*;
use std::fs;
use tmt_ops::cron::Clock;
#[track_caller]
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
fn competing_core_clock_keeps_idle_alerts_and_reacquires_after_holder_exits() {
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
    f.change_model(|m| m["clockLeaseFixture"] = json!(true));
    let lease = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(f.directory.join("fixture-clock.lock"))
        .unwrap();
    let holder_lease =
        nix::fcntl::Flock::lock(lease, nix::fcntl::FlockArg::LockExclusiveNonblock).unwrap();
    let scans = Arc::new(AtomicUsize::new(0));
    let minute = Arc::new(std::sync::atomic::AtomicI64::new(at));
    let observed_minute = minute.clone();
    let observed = scans.clone();
    let mut worker =
        ClockWorker::spawn_clock(f.core.clone(), f.config.clone(), false, true, move || {
            observed.fetch_add(1, Ordering::Relaxed);
            observed_minute.load(Ordering::Relaxed)
        });
    wait_for(|| {
        (scans.load(Ordering::Relaxed) >= 3 && f.model()["clockStarts"] == 1).then_some(())
    });
    assert_eq!(
        f.model()["clockStarts"],
        1,
        "no retry within the same minute"
    );
    drop(holder_lease);
    minute.store(at + 60_000, Ordering::Relaxed);
    let acquired: i32 = wait_for(|| {
        fs::read_to_string(f.directory.join("clock-acquired.pid"))
            .ok()?
            .parse()
            .ok()
    });
    assert_eq!(
        f.model()["clockStarts"],
        2,
        "the waiting UI acquired on the next minute"
    );
    wait_for(|| (f.model()["notices"].as_array().unwrap().len() == 1).then_some(()));
    worker.stop().unwrap();
    let model = f.model();
    assert_eq!(
        nix::sys::signal::kill(nix::unistd::Pid::from_raw(acquired), None),
        Err(nix::errno::Errno::ESRCH)
    );
    assert_eq!(model["clockStarts"], 2);
    let lease = fs::File::open(f.directory.join("fixture-clock.lock")).unwrap();
    let _released =
        nix::fcntl::Flock::lock(lease, nix::fcntl::FlockArg::LockExclusiveNonblock).unwrap();
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

#[test]
fn continuous_ui_reoffers_after_clean_and_errored_ends_and_joins_every_child() {
    for end in ["clean", "error"] {
        let f = Fixture::new();
        f.change_model(|m| m["clockEndFixture"] = json!(end));
        let scans = Arc::new(AtomicUsize::new(0));
        let observed = scans.clone();
        let mut worker =
            ClockWorker::spawn_clock(f.core.clone(), f.config.clone(), false, true, move || {
                1_800_000_000_000 + 60_000 * observed.fetch_add(1, Ordering::Relaxed) as i64
            });
        wait_for(|| (f.model()["clockStarts"].as_u64().unwrap_or(0) >= 2).then_some(()));
        worker.stop().unwrap();
        let model = f.model();
        for pid in model["clockPids"].as_array().unwrap() {
            assert_eq!(
                nix::sys::signal::kill(
                    nix::unistd::Pid::from_raw(pid.as_i64().unwrap() as i32),
                    None
                ),
                Err(nix::errno::Errno::ESRCH)
            );
        }
    }
}
