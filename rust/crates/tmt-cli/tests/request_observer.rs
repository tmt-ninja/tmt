//! Detached child reaping, observer status, durable state and owned log lifetime.
#![cfg(unix)]

mod support;

use nix::poll::{PollFd, PollFlags, poll};
use rusqlite::Connection;
use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    os::{
        fd::AsFd,
        unix::fs::{MetadataExt, OpenOptionsExt},
    },
    path::PathBuf,
    process::{Child, Command, Output, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};
use tmt_adapters::{
    process::{CommandFailure, CommandRequest, CommandRunner, UnixCommandRunner},
    request_runtime::{request_ids, wall_time_ms},
    storage::Storage,
};
use tmt_core::request::{
    Originator, PrepareRequest, RequestKind, RequestOrigin, RequestRoute, RequestService,
    SubmitResponse, notification::NotificationPolicy,
};

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

struct Fixture {
    root: PathBuf,
    database: PathBuf,
    request_id: String,
    recipient_id: String,
    deadline_ms: u64,
    child: Option<Child>,
    workers: Vec<u32>,
}

impl Fixture {
    fn new(timeout_ms: u64) -> Self {
        let root = std::env::temp_dir().join(format!(
            "tmt-request-observer-{}-{}",
            std::process::id(),
            NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        let mut fixture = Self {
            database: support::state_dir(&root).join("tmt.db"),
            root,
            request_id: String::new(),
            recipient_id: String::new(),
            deadline_ms: 0,
            child: None,
            workers: Vec::new(),
        };
        let created = |fixture: &mut Fixture, name: &str| -> String {
            let output = fixture.run(&["identity", "create", name, "--json"]);
            let document: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
            document["identity"]["id"].as_str().unwrap().into()
        };
        let sender = created(&mut fixture, "Sender");
        fixture.recipient_id = created(&mut fixture, "Receiver");
        // A request nobody asked to be notified about: the observer tests add the
        // one notification policy under test themselves.
        let (request_id, attempt_id) = request_ids();
        fixture.request_id = request_id.clone();
        let mut storage = Storage::open(&fixture.database).unwrap();
        RequestService::new(&mut storage, wall_time_ms)
            .enqueue(
                PrepareRequest {
                    kind: RequestKind::Request,
                    origin: RequestOrigin::Person,
                    room_id: None,
                    request_id,
                    message: "observer probe".into(),
                    route: RequestRoute::Inbox {
                        recipient_identity_id: fixture.recipient_id.clone(),
                    },
                    wait: false,
                    expires_at_ms: wall_time_ms() + 3_600_000,
                    originator: Originator::Explicit(sender),
                    recipient_identity_id: Some(fixture.recipient_id.clone()),
                    preamble: None,
                },
                attempt_id,
                7,
            )
            .unwrap();
        fixture.deadline_ms = wall_time_ms() + timeout_ms;
        RequestService::new(&mut storage, wall_time_ms)
            .enable_notifications(
                &fixture.request_id,
                NotificationPolicy {
                    deadline_ms: fixture.deadline_ms,
                    timeout_ms,
                    waiter: None,
                },
            )
            .unwrap();
        storage.close().unwrap();
        fixture
    }

    fn command(&self, args: &[&str]) -> Command {
        let mut command = support::command(&self.root, args);
        command.stdin(Stdio::null()).stdout(Stdio::piped());
        command
    }

    fn wait(&mut self) -> Output {
        support::wait(&mut self.child, Duration::from_secs(10))
            .wait_with_output()
            .unwrap()
    }

    fn run(&mut self, args: &[&str]) -> Output {
        assert!(self.child.is_none());
        self.child = Some(self.command(args).stderr(Stdio::piped()).spawn().unwrap());
        let output = self.wait();
        assert!(output.status.success(), "CLI failed: {output:?}");
        output
    }

    fn log_path(&self) -> PathBuf {
        support::state_dir(&self.root)
            .join("request-observers")
            .join(format!("{}.log", self.request_id))
    }

    fn start(&mut self) -> File {
        assert!(self.child.is_none());
        let path = self.log_path();
        fs::create_dir(path.parent().unwrap()).unwrap();
        let mut log = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .unwrap();
        self.child = Some(
            self.command(&["__request-observer", &self.request_id])
                .stderr(Stdio::from(log.try_clone().unwrap()))
                .spawn()
                .unwrap(),
        );
        let child = self.child.as_mut().unwrap();
        let stdout = child.stdout.as_mut().unwrap();
        let mut readiness = [PollFd::new(stdout.as_fd(), PollFlags::POLLIN)];
        assert_eq!(
            poll(&mut readiness, 5000u16).unwrap(),
            1,
            "observer not ready"
        );
        let mut ack = [0];
        stdout.read_exact(&mut ack).unwrap();
        assert_eq!(ack, [b'R']);
        // Read the attached inode even if a clean, short deadline already unlinked it.
        log.seek(SeekFrom::Start(0)).unwrap();
        let mut text = String::new();
        log.read_to_string(&mut text).unwrap();
        assert_eq!(text, format!("observer_pid={}\n", child.id()));
        log
    }

    fn assert_queued(&self) {
        let db = Connection::open(&self.database).unwrap();
        let status: String = db
            .query_row(
                "SELECT status FROM request_attempts WHERE request_id = ?",
                [&self.request_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "queued");
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        support::stop(&mut self.child);
        for pid in &self.workers {
            wait_reaped(*pid);
        }
        assert_eq!(fs::read_dir(self.root.join("tmux")).unwrap().count(), 0);
        fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn storage_failure_after_readiness_exits_nonzero_and_keeps_the_owned_log() {
    let mut fixture = Fixture::new(120_000);
    let log = fixture.start();
    let attached = log.metadata().unwrap();
    let db = Connection::open(&fixture.database).unwrap();
    db.busy_timeout(Duration::from_secs(5)).unwrap();
    // Inject only after R and the PID line; the policy read and close still work.
    db.execute_batch("ALTER TABLE request_responses RENAME TO injected_unavailable_responses")
        .unwrap();
    let output = fixture.wait();
    let retained = fs::metadata(fixture.log_path()).expect("failure log must remain");
    assert_eq!(
        (retained.dev(), retained.ino()),
        (attached.dev(), attached.ino())
    );
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    let text = fs::read_to_string(fixture.log_path()).unwrap();
    assert!(text.starts_with("observer_pid="));
    assert_eq!(text.lines().count(), 2);
    assert_eq!(
        text.lines().nth(1),
        Some("warning: tmt: request timeout observer unavailable; inspect the retained request")
    );
    fixture.assert_queued();
    let finals: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM injected_unavailable_responses",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(finals, 0);
    let policy: (String, String, bool) = db.query_row(
        "SELECT reply_state, timeout_state, observed FROM request_notifications WHERE request_id = ?",
        [&fixture.request_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).unwrap();
    assert_eq!(
        policy,
        ("not_attempted".into(), "not_attempted".into(), false)
    );
    assert!(wall_time_ms() < fixture.deadline_ms);
}

#[test]
fn a_final_after_readiness_exits_cleanly_and_removes_the_log() {
    let mut fixture = Fixture::new(120_000);
    let _log = fixture.start();
    let mut storage = Storage::open(&fixture.database).unwrap();
    let mut service = RequestService::new(&mut storage, wall_time_ms);
    let (request_id, proof, _) = service
        .answer_target(&fixture.recipient_id, None, Some(&fixture.request_id))
        .unwrap();
    service
        .submit_response(SubmitResponse {
            request_id,
            proof,
            body: "completed".into(),
        })
        .unwrap();
    storage.close().unwrap();
    let output = fixture.wait();
    assert_eq!(output.status.code(), Some(0));
    assert!(!fixture.log_path().exists());
    let result = fixture.run(&["result", &fixture.request_id.clone(), "--json"]);
    let result: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(result["response"], "completed");
}

#[test]
fn a_timeout_exits_cleanly_and_keeps_the_request_queued() {
    let mut fixture = Fixture::new(1000);
    let _log = fixture.start();
    let output = fixture.wait();
    assert_eq!(output.status.code(), Some(0));
    assert!(!fixture.log_path().exists());
    fixture.assert_queued();
    let db = Connection::open(&fixture.database).unwrap();
    let timeout: String = db
        .query_row(
            "SELECT timeout_state FROM request_notifications WHERE request_id = ?",
            [&fixture.request_id],
            |row| row.get(0),
        )
        .unwrap();
    // Unbound identities have no delivery route; the one-shot claim is settled.
    assert_eq!(timeout, "unavailable");
    let finals: i64 = db
        .query_row("SELECT COUNT(*) FROM request_responses", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(finals, 0);
}

fn api_request(
    fixture: &mut Fixture,
    operation: &str,
    input: serde_json::Value,
) -> serde_json::Value {
    let child = fixture.child.as_mut().unwrap();
    let stdin = child.stdin.as_mut().unwrap();
    writeln!(
        stdin,
        "{}",
        serde_json::json!({"version": 1, "operation": operation, "input": input})
    )
    .unwrap();
    stdin.flush().unwrap();
    let stdout = child.stdout.as_ref().unwrap();
    let mut readiness = [PollFd::new(stdout.as_fd(), PollFlags::POLLIN)];
    assert_eq!(poll(&mut readiness, 5000u16).unwrap(), 1, "API response");
    let frame = tmt_adapters::framed_stdio::Reader::new(stdout, 65_536)
        .read_frame()
        .unwrap()
        .expect("API session closed before response");
    let response: serde_json::Value = serde_json::from_slice(&frame).unwrap();
    assert!(response.get("error").is_none(), "{response}");
    response
}

fn process_row(pid: u32) -> Option<String> {
    let args = [
        OsString::from("-p"),
        pid.to_string().into(),
        "-o".into(),
        "pid=,ppid=,stat=,args=".into(),
    ];
    match UnixCommandRunner.execute_leaf(CommandRequest {
        program: "/bin/ps".as_ref(),
        args: &args,
        input: &[],
        deadline: Instant::now() + Duration::from_secs(2),
        max_output_bytes: 4096,
    }) {
        Ok(output) => Some(String::from_utf8(output.stdout).unwrap()),
        Err(error)
            if error.kind
                == (CommandFailure::Exit {
                    code: Some(1),
                    signal: None,
                })
                && error
                    .output
                    .as_ref()
                    .is_some_and(|output| output.stdout.is_empty() && output.stderr.is_empty()) =>
        {
            None
        }
        other => panic!("could not inspect owned worker {pid}: {other:?}"),
    }
}

fn wait_reaped(pid: u32) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while let Some(row) = process_row(pid) {
        assert!(Instant::now() < deadline, "worker was not reaped: {row}");
        thread::sleep(Duration::from_millis(10));
    }
}

fn held_flusher(fixture: &mut Fixture) -> u32 {
    let logs: Vec<_> = fs::read_dir(support::state_dir(&fixture.root))
        .unwrap()
        .map(Result::unwrap)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("hook-flush-")
        })
        .collect();
    assert_eq!(logs.len(), 1, "one acknowledged worker");
    let text = fs::read_to_string(logs[0].path()).unwrap();
    let pid = text
        .trim()
        .strip_prefix("flusher_pid=")
        .unwrap()
        .parse()
        .unwrap();
    fixture.workers.push(pid);
    let row = process_row(pid).expect("queue writer keeps worker alive");
    let fields: Vec<_> = row.split_whitespace().collect();
    assert_eq!(fields[1], fixture.child.as_ref().unwrap().id().to_string());
    assert!(!fields[2].starts_with('Z'), "worker must still be running");
    assert!(fields.contains(&"__flush"), "actual hook worker: {row}");
    pid
}

#[test]
fn api_session_reaps_completed_flushers_without_waiting_for_live_workers() {
    let mut fixture = Fixture::new(120_000);
    fixture.child = Some(
        fixture
            .command(&["api", "--session"])
            .env("TMT_HOME", support::state_dir(&fixture.root))
            .stdin(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    let queue = Connection::open(fixture.database.with_file_name("hook-writes.db")).unwrap();
    let identity = fixture.recipient_id.clone();
    // A malformed persisted capture exercises the real recovery worker and leaves
    // a durable quarantine receipt, without launching a provider or reading its data.
    let enqueue = |id: &str| {
        queue.execute("INSERT INTO hook_writes(event_id,identity_id,kind,payload,enqueued_ms) VALUES(?,?,'capture','{}',0)", (id, &identity)).unwrap();
        // Startup acknowledges before SQLite waits. This holds the child alive
        // long enough to prove its command/parent; it is not a timing assumption.
        queue.execute_batch("BEGIN IMMEDIATE").unwrap();
    };
    enqueue("reap-session-child");
    let renamed = api_request(
        &mut fixture,
        "identity.rename",
        serde_json::json!({
            "identityId": identity, "expectedName": "Receiver", "name": "Renamed"
        }),
    );
    assert_eq!(renamed["outcome"], "applied");
    let completed = held_flusher(&mut fixture);
    queue.execute_batch("ROLLBACK").unwrap();
    wait_reaped(completed);
    assert_eq!(
        queue
            .query_row(
                "SELECT count(*) FROM invalid_hook_writes WHERE event_id='reap-session-child'",
                [],
                |r| r.get::<_, u32>(0)
            )
            .unwrap(),
        1
    );
    assert_eq!(
        api_request(&mut fixture, "capabilities", serde_json::json!({}))["version"],
        1
    );

    enqueue("outlive-session");
    let renamed = api_request(
        &mut fixture,
        "identity.rename",
        serde_json::json!({
            "identityId": identity, "expectedName": "Renamed", "name": "Receiver"
        }),
    );
    assert_eq!(renamed["outcome"], "applied");
    let survivor = held_flusher(&mut fixture);
    fixture.child.as_mut().unwrap().stdin.take();
    assert!(
        fixture.wait().status.success(),
        "session must not join a live worker"
    );
    let row = process_row(survivor).expect("detached worker outlives session");
    assert!(
        !row.split_whitespace().nth(2).unwrap().starts_with('Z'),
        "{row}"
    );
    queue.execute_batch("ROLLBACK").unwrap();
    wait_reaped(survivor);
    assert_eq!(
        queue
            .query_row(
                "SELECT count(*) FROM invalid_hook_writes WHERE event_id='outlive-session'",
                [],
                |r| r.get::<_, u32>(0)
            )
            .unwrap(),
        1
    );
}
