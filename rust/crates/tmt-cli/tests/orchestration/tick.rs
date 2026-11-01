//! Public clock lifecycle in a private store; no providers, tmux or OS timer.
use super::*;
use nix::{
    sys::signal::{Signal, kill},
    unistd::Pid,
};
use std::time::Instant;
struct ClockChild(Option<Child>);
impl ClockChild {
    fn signal(&self) {
        let child = self.0.as_ref().unwrap();
        kill(Pid::from_raw(child.id() as i32), Signal::SIGTERM).unwrap();
    }
    fn finish(&mut self) -> Output {
        support::wait(&mut self.0, Duration::from_secs(5))
            .wait_with_output()
            .unwrap()
    }
}
impl Drop for ClockChild {
    fn drop(&mut self) {
        if let Some(child) = self.0.as_mut()
            && child.try_wait().unwrap().is_none()
        {
            let _ = kill(Pid::from_raw(child.id() as i32), Signal::SIGTERM);
            let deadline = Instant::now() + Duration::from_secs(5);
            while child.try_wait().unwrap().is_none() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        support::stop(&mut self.0);
    }
}
#[test]
fn status_is_read_only_and_foreground_clock_runs_subminute_jobs_then_releases_on_term() {
    let mut f = Fixture::new();
    let status = f.json(&["tick", "status", "--json"], None);
    assert_eq!(status["state"], "stopped");
    assert!(!f.db().exists());
    assert!(!support::state_dir(&f.root).join("tick").exists());
    let owner = f.seed();
    let path = f.root.join("job.json");
    fs::write(&path,json!({"ownerIdentityId":owner,"message":"clock causal message","schedule":{"kind":"every","zone":"UTC","seconds":1,"anchorMs":0}}).to_string()).unwrap();
    f.json(
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
    let mut clock = ClockChild(Some(
        support::command(&f.root, &["tick", "run", "--json"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap(),
    ));
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let db = Connection::open_with_flags(f.db(), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
        db.busy_timeout(Duration::ZERO).unwrap();
        let runs: i64 = db
            .query_row("SELECT COUNT(*) FROM orchestration_job_runs", [], |row| {
                row.get(0)
            })
            .unwrap();
        if runs > 0 {
            break;
        }
        assert!(
            clock.0.as_mut().unwrap().try_wait().unwrap().is_none(),
            "clock ended before causal job admission"
        );
        assert!(
            Instant::now() < deadline,
            "clock did not admit a sub-minute slot"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    let holder = f.json(&["tick", "status", "--json"], None);
    assert_eq!(holder["state"], "running");
    assert_eq!(holder["holder"]["pid"], clock.0.as_ref().unwrap().id());
    let competing = f.run(&["tick", "--json"], None);
    assert_eq!(competing.status.code(), Some(5));
    assert_eq!(
        serde_json::from_slice::<Value>(&competing.stdout).unwrap()["error"]["code"],
        "TICK_CLOCK_RUNNING"
    );
    assert_eq!(
        f.json(&["tick", "status", "--json"], None)["holder"]["token"],
        holder["holder"]["token"]
    );
    clock.signal();
    let result = clock.finish();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(result.stderr.is_empty());
    let text = std::str::from_utf8(&result.stdout).unwrap();
    let last: Value = serde_json::from_str(text.lines().last().unwrap()).unwrap();
    assert_eq!(last["stopped"], true);
    assert_eq!(last["digest"]["state"], "not_installed");
    assert_eq!(
        f.json(&["tick", "status", "--json"], None)["state"],
        "stopped"
    );
    assert!(!support::state_dir(&f.root).join("tick/clock.json").exists());
    let shown = f.json(&["orch", "job", "show", "j1", "--json"], None);
    assert_eq!(shown["job"]["lastRun"]["acceptance"], "queued");
    assert!(shown["job"]["lastRun"]["operationId"].is_string());
}

#[test]
fn timer_preview_and_unconsented_install_create_no_store_unit_or_clock() {
    let mut f = Fixture::new();
    let preview = f.json(&["tick", "timer", "preview", "--json"], None);
    assert_eq!(preview["requiresConsent"], true);
    assert_eq!(preview["scope"], "user");
    assert_eq!(preview["command"][1], "tick");
    assert_eq!(preview["command"][2], "--json");
    let files = preview["files"].as_array().unwrap();
    assert!(!files.is_empty());
    for file in files {
        let path = std::path::Path::new(file["path"].as_str().unwrap());
        assert!(
            path.starts_with(&f.root),
            "timer plan escaped its private world"
        );
        assert!(!path.exists());
    }
    // Never pass --yes or call status here: OS-manager behavior is covered only
    // by the injected Manager in adapters, even in this otherwise private world.
    let refused = f.run(&["tick", "timer", "install", "--json"], None);
    assert_eq!(refused.status.code(), Some(1));
    assert_eq!(
        serde_json::from_slice::<Value>(&refused.stdout).unwrap()["error"]["code"],
        "TICK_TIMER_CONSENT_REQUIRED"
    );
    assert!(!f.db().exists());
    assert!(!support::state_dir(&f.root).join("tick").exists());
    for file in files {
        assert!(!std::path::Path::new(file["path"].as_str().unwrap()).exists());
    }
}
