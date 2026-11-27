//! Private-tmux integration checks for Pi paste delivery without a channel (#6561).
#![cfg(unix)]

#[allow(dead_code)]
mod support;

use serde_json::Value;
use std::{
    ffi::OsStr,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::atomic::{AtomicUsize, Ordering},
    thread,
    time::{Duration, Instant},
};

static NEXT: AtomicUsize = AtomicUsize::new(0);

const DEADLINE: Duration = Duration::from_secs(20);
const POLL: Duration = Duration::from_millis(25);

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn wait_until(what: &str, mut ready: impl FnMut() -> bool) {
    let deadline = Instant::now() + DEADLINE;
    while !ready() {
        assert!(Instant::now() < deadline, "timed out: {what}");
        thread::sleep(POLL);
    }
}

struct PrivateTmux {
    root: PathBuf,
    socket: PathBuf,
    server_pid: u64,
    pane_id: String,
}

impl PrivateTmux {
    fn new(label: &str) -> Self {
        let root = if label == "chan" {
            nix::unistd::mkdtemp("/tmp/tmtp-XXXXXX").unwrap()
        } else {
            std::env::temp_dir().join(format!(
                "tmt-pi-{label}-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ))
        };
        for dir in [
            "home",
            "xdg-config",
            "xdg-data",
            "xdg-state",
            "xdg-cache",
            "tmp",
            "tmux",
            "bin",
        ] {
            fs::create_dir_all(root.join(dir)).unwrap();
        }
        let socket = root.join("s");
        assert!(socket.starts_with(&root));
        assert!(
            socket.as_os_str().len() < 104,
            "private tmux socket must fit macOS sun_path: {}",
            socket.display()
        );
        assert_ne!(
            socket.file_name(),
            Some(OsStr::new("default")),
            "never use the host default tmux socket name"
        );
        let uid = nix::unistd::Uid::current();
        for forbidden in [
            std::env::var_os("TMUX_TMPDIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("/tmp"))
                .join(format!("tmux-{uid}/default")),
            PathBuf::from(format!("/tmp/tmux-{uid}/default")),
            PathBuf::from(format!("/private/tmp/tmux-{uid}/default")),
        ] {
            assert_ne!(socket, forbidden, "must never match host default socket");
        }

        let mut server = Self {
            root,
            socket,
            server_pid: 0,
            pane_id: String::new(),
        };
        let out = server.tmux(&[
            "-f",
            "/dev/null",
            "new-session",
            "-d",
            "-s",
            "pi-test",
            "-c",
            server.root.to_str().unwrap(),
            "/bin/sh",
        ]);
        assert!(
            out.status.success(),
            "start private tmux server: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let pid_out = server.tmux(&["display-message", "-p", "#{pid}"]);
        assert!(pid_out.status.success());
        server.server_pid = String::from_utf8(pid_out.stdout)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        let pane_out = server.tmux(&["display-message", "-p", "#{pane_id}"]);
        assert!(pane_out.status.success());
        server.pane_id = String::from_utf8(pane_out.stdout)
            .unwrap()
            .trim()
            .to_owned();
        server
    }

    fn tmux(&self, args: &[&str]) -> Output {
        assert!(self.socket.starts_with(&self.root));
        assert_ne!(self.socket.file_name(), Some(OsStr::new("default")));
        Command::new("tmux")
            .env_remove("TMUX")
            .env_remove("TMUX_PANE")
            .env("TMT_HOME", support::state_dir(&self.root))
            .env("TMUX_TMPDIR", self.root.join("tmux"))
            .arg("-u")
            .arg("-S")
            .arg(&self.socket)
            .args(args)
            .stdin(Stdio::null())
            .output()
            .expect("invoke private tmux")
    }

    fn isolated_path(&self) -> String {
        let bin = self.root.join("bin");
        match std::env::var("PATH") {
            Ok(existing) if !existing.is_empty() => format!("{}:{existing}", bin.display()),
            _ => format!(
                "{}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
                bin.display()
            ),
        }
    }

    fn tmt_env(&self, command: &mut Command) {
        command
            .env("TMT_HOME", support::state_dir(&self.root))
            .env("PATH", self.isolated_path())
            .env(
                "TMUX",
                format!("{},{},0", self.socket.display(), self.server_pid),
            )
            .env("TMUX_PANE", &self.pane_id);
    }

    fn tmt(&self, args: &[&str]) -> Output {
        let mut command = support::command(&self.root, args);
        self.tmt_env(&mut command);
        command.output().expect("run tmt against private tmux")
    }

    fn tmt_json(&self, args: &[&str]) -> Value {
        let out = self.tmt(args);
        assert!(
            out.status.success(),
            "tmt {:?} failed ({:?}):\nstdout: {}\nstderr: {}",
            args,
            out.status.code(),
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        serde_json::from_slice(&out.stdout).expect("parse tmt json stdout")
    }

    fn install_fake_pi(&self, interpreter_script: &str) -> PathBuf {
        let example = Path::new(env!("CARGO_BIN_EXE_tmt"))
            .parent()
            .unwrap()
            .join("examples/provider-script-fixture");
        assert!(
            example.is_file(),
            "build the shared fixture first: cargo build --locked -p tmt-adapters --example provider-script-fixture"
        );
        let fake_pi = self.root.join("bin/pi");
        tmt_test_support::write_executable(&fake_pi, &fs::read(&example).unwrap(), 0o755).unwrap();
        let interpreter = self.root.join("fake-pi-interpreter");
        tmt_test_support::write_executable(&interpreter, interpreter_script.as_bytes(), 0o755)
            .unwrap();
        let set_env = self.tmux(&[
            "set-environment",
            "-g",
            "TMT_TEST_PROVIDER_INTERPRETER",
            interpreter.to_str().unwrap(),
        ]);
        assert!(set_env.status.success());
        fake_pi
    }

    fn db(&self) -> rusqlite::Connection {
        rusqlite::Connection::open(support::state_dir(&self.root).join("tmt.db")).unwrap()
    }

    fn received_lines(&self) -> Vec<String> {
        fs::read_to_string(self.root.join("received.lines"))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    fn wait_for_received(&self, expected: &str) {
        wait_until(&format!("fake pi receives {expected:?}"), || {
            self.received_lines()
                .iter()
                .any(|line| line.contains(expected))
        });
    }

    fn assert_clean_attempts_and_no_dot_pi(&self) {
        let claimed: i64 = self
            .db()
            .query_row(
                "SELECT count(*) FROM request_attempts WHERE wake_state = 'claimed'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(claimed, 0, "no request attempt may stay stuck in Claimed");
        assert!(
            !self.root.join("home/.pi").exists(),
            "TMT must never create or write under ~/.pi"
        );
    }
}

impl Drop for PrivateTmux {
    fn drop(&mut self) {
        if !self.pane_id.is_empty() {
            let _ = self.tmux(&["kill-pane", "-t", &self.pane_id]);
        }
        if self.server_pid > 0
            && let Ok(pid) = i32::try_from(self.server_pid)
        {
            let _ = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(pid),
                nix::sys::signal::Signal::SIGTERM,
            );
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            let out = self.tmux(&["list-sessions"]);
            let stderr = String::from_utf8_lossy(&out.stderr);
            if !out.status.success()
                && (stderr.starts_with("no server running on ")
                    || stderr.contains("(No such file or directory)"))
            {
                break;
            }
            thread::sleep(POLL);
        }
        if std::thread::panicking() && self.root.join("launch").exists() {
            eprintln!(
                "Pi fixture launch (ready={}): {}",
                self.root.join("ready").exists(),
                fs::read_to_string(self.root.join("launch")).unwrap_or_default()
            );
        }
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn tmux_command_target_verifies_cwd_and_refuses_a_changed_pane_before_launch() {
    let tmux = PrivateTmux::new("cmd");
    let bound = tmux.tmt_json(&["add", &tmux.pane_id, "command-target", "--json"]);
    let identity = &bound["id"];
    let request = |op: &str, data: Value| {
        let mut command = support::command(&tmux.root, &["api", "--session"]);
        tmux.tmt_env(&mut command);
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let envelope = serde_json::json!({"version":1,"operation":op,"input":data});
        writeln!(stdin, "{envelope}").unwrap();
        let mut response = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut response)
            .unwrap();
        drop(stdin);
        assert!(child.wait().unwrap().success());
        serde_json::from_str::<Value>(&response).unwrap_or_else(|_| panic!("{response:?}"))
    };
    let observed = request(
        "terminal.command.target",
        serde_json::json!({"identityId":identity}),
    );
    assert!(observed["paneIncarnation"].is_string(), "{observed}");
    assert!(observed["bindingId"].is_string(), "{observed}");
    let cwd = tmux.root.canonicalize().unwrap();
    assert_eq!(
        Path::new(observed["cwd"].as_str().unwrap())
            .canonicalize()
            .unwrap(),
        cwd
    );
    let target = serde_json::json!({"kind":"member", "identityId":identity,
        "cwd":observed["cwd"], "bindingId":observed["bindingId"],
        "paneIncarnation":observed["paneIncarnation"]});
    let run = |command: &str| {
        request(
            "terminal.command.run",
            serde_json::json!({"target":target,"command":command}),
        )
    };
    let output = run("pwd");
    assert_eq!(output["exitCode"], 0, "{output}");
    assert_eq!(
        Path::new(output["stdout"].as_str().unwrap().trim())
            .canonicalize()
            .unwrap(),
        cwd
    );

    let changed = cwd.join("changed-directory");
    fs::create_dir(&changed).unwrap();
    let change = format!("cd {}", quote(changed.to_str().unwrap()));
    assert!(
        tmux.tmux(&["send-keys", "-t", &tmux.pane_id, &change, "Enter"])
            .status
            .success()
    );
    wait_until("the bound pane is in the changed directory", || {
        let output = tmux.tmux(&[
            "display-message",
            "-t",
            &tmux.pane_id,
            "-p",
            "#{pane_current_path}",
        ]);
        output.status.success()
            && String::from_utf8_lossy(&output.stdout).trim() == changed.to_str().unwrap()
    });
    let marker = cwd.join("command-started");
    let command = format!("printf started > {}", quote(marker.to_str().unwrap()));
    let refused = run(&command);
    assert_eq!(
        refused["error"]["code"], "TERMINAL_COMMAND_TARGET_CHANGED",
        "{refused}"
    );
    assert!(!marker.exists());

    assert!(
        tmux.tmux(&[
            "respawn-pane",
            "-k",
            "-t",
            &tmux.pane_id,
            "-c",
            cwd.to_str().unwrap(),
            "/bin/sh"
        ])
        .status
        .success()
    );
    let pane = tmux.tmux(&["display-message", "-t", &tmux.pane_id, "-p", "#{pane_id}"]);
    assert!(pane.status.success());
    assert_eq!(String::from_utf8_lossy(&pane.stdout).trim(), tmux.pane_id);
    let refused = run(&command);
    assert_eq!(
        refused["error"]["code"], "SHELL_RUN_UNAVAILABLE",
        "{refused}"
    );
    assert!(!marker.exists());
}

#[test]
fn hand_started_fake_pi_in_tmux_receives_talk_via_paste_even_with_digest() {
    let tmux = PrivateTmux::new("hand");
    let root = tmux.root.display();
    let script = format!(
        r#"#!/bin/sh
if [ "$1" = --version ]; then
  echo "1.3.0"
  exit 0
fi
printf 'FAKE_PI_READY\n'
printf 'ready\n' > '{root}/pi.ready'
while IFS= read -r line; do
  printf '%s\n' "$line" >> '{root}/received.lines'
  case "$line" in
    QUIT_FAKE_PI) exit 0 ;;
  esac
done
"#
    );
    let fake_pi = tmux.install_fake_pi(&script);

    // Respawn the pane directly with fake `pi` (`comm == "pi"`), hand-started outside `tmt run`.
    let respawn = tmux.tmux(&[
        "respawn-pane",
        "-k",
        "-c",
        tmux.root.to_str().unwrap(),
        "-t",
        &tmux.pane_id,
        fake_pi.to_str().unwrap(),
    ]);
    assert!(
        respawn.status.success(),
        "{}",
        String::from_utf8_lossy(&respawn.stderr)
    );
    wait_until("hand-started fake pi is ready", || {
        tmux.root.join("pi.ready").is_file()
    });

    assert!(
        tmux.tmt(&["identity", "create", "sender", "--json"])
            .status
            .success()
    );
    assert!(
        tmux.tmt(&["identity", "create", "owner", "--json"])
            .status
            .success()
    );
    assert!(
        tmux.tmt(&[
            "identity",
            "meta",
            "set",
            "user",
            "true",
            "--identity",
            "owner",
            "--json"
        ])
        .status
        .success()
    );

    let _named = tmux.tmt_json(&["add", &tmux.pane_id, "pi-hand", "--save", "--json"]);
    let target_id: String = tmux
        .db()
        .query_row(
            "SELECT id FROM identities WHERE name = 'pi-hand'",
            [],
            |r| r.get(0),
        )
        .unwrap();

    // 1. Without Digest: ordinary tmux paste delivery works and never returns RECIPIENT_UNVERIFIED.
    let first = tmux.tmt_json(&[
        "talk",
        "pi-hand",
        "hello-hand-no-digest",
        "--identity",
        "sender",
        "--detach",
        "--json",
    ]);
    assert_eq!(first["status"], "sent", "{first:#}");
    assert_ne!(first["digest"], true, "{first:#}");
    tmux.wait_for_received("hello-hand-no-digest");

    // 2. With Digest active: a hand-started pane cannot report Idle, so Digest does not hold it.
    let now = tmt_adapters::request_runtime::wall_time_ms() as i64;
    let owner_id: String = tmux
        .db()
        .query_row("SELECT id FROM identities WHERE name = 'owner'", [], |r| {
            r.get(0)
        })
        .unwrap();
    tmux.db()
        .execute(
            "INSERT INTO focus_policies(identity_id,revision,until_ms,owner_identity_id,setter_identity_id,max_hold_ms)
             VALUES(?1,1,?2,?3,?3,300000)",
            rusqlite::params![target_id, now + 3_600_000, owner_id],
        )
        .unwrap();

    let second = tmux.tmt_json(&[
        "talk",
        "pi-hand",
        "hello-hand-with-digest",
        "--identity",
        "sender",
        "--detach",
        "--json",
    ]);
    assert_eq!(second["status"], "sent", "{second:#}");
    assert_ne!(second["digest"], true, "{second:#}");
    tmux.wait_for_received("hello-hand-with-digest");

    tmux.assert_clean_attempts_and_no_dot_pi();
}

#[test]
fn launched_fake_pi_1_3_0_receives_paste_across_startup_session_switches_and_turns() {
    let tmux = PrivateTmux::new("run");
    let root = tmux.root.display();
    let tmt_bin = quote(env!("CARGO_BIN_EXE_tmt"));

    let s1 = "11111111-1111-4111-8111-111111111111";
    let s2 = "22222222-2222-4222-8222-222222222222";
    let s3 = "33333333-3333-4333-8333-333333333333";

    let script = format!(
        r#"#!/bin/sh
if [ "$1" = --version ]; then
  echo "1.3.0"
  exit 0
fi
printf '%s\n' "$@" > '{root}/pi.argv'
printf '{{"event":"session_start","reason":"startup","startup_ready":false,"session_id":"{s1}"}}' | {tmt_bin} __hook pi > '{root}/hook-start.out' 2> '{root}/hook-start.err'
printf '1\n' > '{root}/pi.started'
while IFS= read -r line; do
  printf '%s\n' "$line" >> '{root}/received.lines'
  case "$line" in
    CMD_SWITCH_NEW)
      printf '{{"event":"session_start","reason":"new","startup_ready":false,"session_id":"{s2}"}}' | {tmt_bin} __hook pi > '{root}/hook-new.out' 2> '{root}/hook-new.err'
      printf '1\n' > '{root}/pi.switched_new'
      ;;
    CMD_SWITCH_RESUME)
      printf '{{"event":"session_start","reason":"resume","startup_ready":false,"session_id":"{s3}"}}' | {tmt_bin} __hook pi > '{root}/hook-resume.out' 2> '{root}/hook-resume.err'
      printf '1\n' > '{root}/pi.switched_resume'
      ;;
    CMD_TURN_START)
      printf '{{"event":"before_agent_start","session_id":"{s3}","prompt":"hi"}}' | {tmt_bin} __hook pi > '{root}/hook-turn-start.out' 2> '{root}/hook-turn-start.err'
      printf '1\n' > '{root}/pi.turn_started'
      ;;
    CMD_TURN_END)
      printf '{{"event":"agent_settled","session_id":"{s3}","aborted":false}}' | {tmt_bin} __hook pi > '{root}/hook-turn-end.out' 2> '{root}/hook-turn-end.err'
      printf '1\n' > '{root}/pi.turn_ended'
      ;;
    QUIT_FAKE_PI) exit 0 ;;
  esac
done
"#
    );
    let fake_pi = tmux.install_fake_pi(&script);

    assert!(
        tmux.tmt(&["identity", "create", "sender", "--json"])
            .status
            .success()
    );
    assert!(
        tmux.tmt(&["identity", "create", "owner", "--json"])
            .status
            .success()
    );
    assert!(
        tmux.tmt(&[
            "identity",
            "meta",
            "set",
            "user",
            "true",
            "--identity",
            "owner",
            "--json"
        ])
        .status
        .success()
    );

    // Export isolated test environment into the private tmux server before launching `tmt run` inside the pane.
    let path = tmux.isolated_path();
    for (key, value) in [
        ("TMT_TEST_ROOT", tmux.root.to_str().unwrap()),
        ("TMT_AGENT", "1"),
        ("HOME", tmux.root.join("home").to_str().unwrap()),
        (
            "XDG_CONFIG_HOME",
            tmux.root.join("xdg-config").to_str().unwrap(),
        ),
        (
            "XDG_DATA_HOME",
            tmux.root.join("xdg-data").to_str().unwrap(),
        ),
        (
            "XDG_STATE_HOME",
            tmux.root.join("xdg-state").to_str().unwrap(),
        ),
        (
            "XDG_CACHE_HOME",
            tmux.root.join("xdg-cache").to_str().unwrap(),
        ),
        (
            "CODEX_HOME",
            tmux.root.join("home/.codex").to_str().unwrap(),
        ),
        ("TMPDIR", tmux.root.join("tmp").to_str().unwrap()),
        ("TMUX_TMPDIR", tmux.root.join("tmux").to_str().unwrap()),
        ("PATH", &path),
    ] {
        let res = tmux.tmux(&["set-environment", "-g", key, value]);
        assert!(res.status.success());
    }

    let launch_cmd = format!(
        "exec {} run --no-channel pi-worker {} > {} 2> {}",
        quote(env!("CARGO_BIN_EXE_tmt")),
        quote(fake_pi.to_str().unwrap()),
        quote(tmux.root.join("run.out").to_str().unwrap()),
        quote(tmux.root.join("run.err").to_str().unwrap()),
    );
    let respawn = tmux.tmux(&[
        "respawn-pane",
        "-k",
        "-c",
        tmux.root.to_str().unwrap(),
        "-t",
        &tmux.pane_id,
        &launch_cmd,
    ]);
    assert!(
        respawn.status.success(),
        "{}",
        String::from_utf8_lossy(&respawn.stderr)
    );
    let deadline = Instant::now() + DEADLINE;
    while !tmux.root.join("pi.started").is_file() {
        assert!(
            Instant::now() < deadline,
            "timed out: launched fake pi 1.3.0 reports session_start\nrun.out: {}\nrun.err: {}\npane: {}",
            fs::read_to_string(tmux.root.join("run.out")).unwrap_or_default(),
            fs::read_to_string(tmux.root.join("run.err")).unwrap_or_default(),
            String::from_utf8_lossy(
                &tmux
                    .tmux(&["capture-pane", "-p", "-t", &tmux.pane_id])
                    .stdout
            ),
        );
        thread::sleep(POLL);
    }
    assert_eq!(
        fs::read_to_string(tmux.root.join("hook-start.err")).unwrap_or_default(),
        ""
    );

    // Enable Digest policy on pi-worker.
    let target_id: String = tmux
        .db()
        .query_row(
            "SELECT id FROM identities WHERE name = 'pi-worker'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let owner_id: String = tmux
        .db()
        .query_row("SELECT id FROM identities WHERE name = 'owner'", [], |r| {
            r.get(0)
        })
        .unwrap();
    let now = tmt_adapters::request_runtime::wall_time_ms() as i64;
    tmux.db()
        .execute(
            "INSERT INTO focus_policies(identity_id,revision,until_ms,owner_identity_id,setter_identity_id,max_hold_ms)
             VALUES(?1,1,?2,?3,?3,300000)",
            rusqlite::params![target_id, now + 3_600_000, owner_id],
        )
        .unwrap();

    // 1. At startup (pi 1.3.0 -> startup_ready=false): talk falls back to ordinary paste immediately.
    let at_startup = tmux.tmt_json(&[
        "talk",
        "pi-worker",
        "talk-at-startup",
        "--identity",
        "sender",
        "--detach",
        "--json",
    ]);
    assert_eq!(at_startup["status"], "sent", "{at_startup:#}");
    assert_ne!(at_startup["digest"], true, "{at_startup:#}");
    tmux.wait_for_received("talk-at-startup");

    // 2. Session switch (`new`): keeps binding Running, records new session ID, and talks paste cleanly.
    assert!(
        tmux.tmux(&["send-keys", "-t", &tmux.pane_id, "-l", "CMD_SWITCH_NEW"])
            .status
            .success()
    );
    assert!(
        tmux.tmux(&["send-keys", "-t", &tmux.pane_id, "Enter"])
            .status
            .success()
    );
    wait_until("fake pi handles session_start(new)", || {
        tmux.root.join("pi.switched_new").is_file()
    });
    assert_eq!(
        fs::read_to_string(tmux.root.join("hook-new.err")).unwrap_or_default(),
        ""
    );
    let session_after_new: String = tmux
        .db()
        .query_row(
            "SELECT observed_provider_session_id FROM bindings WHERE identity_id = ?1",
            [&target_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(session_after_new, s2);
    let after_new = tmux.tmt_json(&[
        "talk",
        "pi-worker",
        "talk-after-new",
        "--identity",
        "sender",
        "--detach",
        "--json",
    ]);
    assert_eq!(after_new["status"], "sent", "{after_new:#}");
    assert_ne!(after_new["digest"], true, "{after_new:#}");
    tmux.wait_for_received("talk-after-new");

    // 3. Session switch (`resume`): keeps binding Running, records resumed session ID, and talks paste cleanly.
    assert!(
        tmux.tmux(&["send-keys", "-t", &tmux.pane_id, "-l", "CMD_SWITCH_RESUME"])
            .status
            .success()
    );
    assert!(
        tmux.tmux(&["send-keys", "-t", &tmux.pane_id, "Enter"])
            .status
            .success()
    );
    wait_until("fake pi handles session_start(resume)", || {
        tmux.root.join("pi.switched_resume").is_file()
    });
    assert_eq!(
        fs::read_to_string(tmux.root.join("hook-resume.err")).unwrap_or_default(),
        ""
    );
    let session_after_resume: String = tmux
        .db()
        .query_row(
            "SELECT observed_provider_session_id FROM bindings WHERE identity_id = ?1",
            [&target_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(session_after_resume, s3);
    let after_resume = tmux.tmt_json(&[
        "talk",
        "pi-worker",
        "talk-after-resume",
        "--identity",
        "sender",
        "--detach",
        "--json",
    ]);
    assert_eq!(after_resume["status"], "sent", "{after_resume:#}");
    assert_ne!(after_resume["digest"], true, "{after_resume:#}");
    tmux.wait_for_received("talk-after-resume");

    // 4. Turn lifecycle (`before_agent_start` -> `agent_settled`): held during Working, then flushed cleanly at Idle via `tmt check`.
    assert!(
        tmux.tmux(&["send-keys", "-t", &tmux.pane_id, "-l", "CMD_TURN_START"])
            .status
            .success()
    );
    assert!(
        tmux.tmux(&["send-keys", "-t", &tmux.pane_id, "Enter"])
            .status
            .success()
    );
    wait_until("fake pi reports before_agent_start", || {
        tmux.root.join("pi.turn_started").is_file()
    });
    assert_eq!(
        fs::read_to_string(tmux.root.join("hook-turn-start.err")).unwrap_or_default(),
        ""
    );
    let during_turn = tmux.tmt_json(&[
        "talk",
        "pi-worker",
        "talk-during-turn",
        "--identity",
        "sender",
        "--detach",
        "--json",
    ]);
    assert_eq!(during_turn["digest"], true, "{during_turn:#}");

    assert!(
        tmux.tmux(&["send-keys", "-t", &tmux.pane_id, "-l", "CMD_TURN_END"])
            .status
            .success()
    );
    assert!(
        tmux.tmux(&["send-keys", "-t", &tmux.pane_id, "Enter"])
            .status
            .success()
    );
    wait_until("fake pi reports agent_settled", || {
        tmux.root.join("pi.turn_ended").is_file()
    });
    assert_eq!(
        fs::read_to_string(tmux.root.join("hook-turn-end.err")).unwrap_or_default(),
        ""
    );
    // Expire the Digest window cleanly so `tmt check` flushes the held turn item at Idle.
    tmux.db()
        .execute(
            "UPDATE focus_policies SET until_ms = 1 WHERE identity_id = ?1",
            [&target_id],
        )
        .unwrap();
    let checked = tmux.tmt_json(&["check", "pi-worker", "--json"]);
    assert!(checked.is_object(), "{checked:#}");
    tmux.wait_for_received("talk-during-turn");

    // 5. After turn end (`Idle`), a fresh talk also pastes cleanly without RECIPIENT_UNVERIFIED.
    let after_turn = tmux.tmt_json(&[
        "talk",
        "pi-worker",
        "talk-after-turn",
        "--identity",
        "sender",
        "--detach",
        "--json",
    ]);
    assert_eq!(after_turn["status"], "sent", "{after_turn:#}");
    assert_ne!(after_turn["digest"], true, "{after_turn:#}");
    tmux.wait_for_received("talk-after-turn");

    tmux.assert_clean_attempts_and_no_dot_pi();
}

#[test]
fn enrolled_pi_delivers_original_request_and_fences_a_replaced_session() {
    let tmux = PrivateTmux::new("chan");
    let root = &tmux.root;
    // An actual interpreter named pi remains the foreground and socket peer.
    let node = Command::new("node")
        .args(["-p", "process.execPath"])
        .output()
        .unwrap();
    assert!(node.status.success());
    let node = PathBuf::from(String::from_utf8(node.stdout).unwrap().trim());
    let runtime = root.join("runtime");
    fs::create_dir(&runtime).unwrap();
    // Shared-library Node distributions resolve libnode relative to the executable.
    let lib = node.parent().unwrap().join("../lib");
    if lib.is_dir() {
        std::os::unix::fs::symlink(lib, root.join("lib")).unwrap();
    }
    fs::copy(&node, runtime.join("pi")).unwrap();
    let fake = root.join("bin/pi");
    let script = format!(
        "#!{}\n{}",
        runtime.join("pi").display(),
        r#"
(async()=>{
  const fs = require('node:fs'), path = require('node:path');
  if(process.argv.includes('--version')) { console.log('1.6.1'); return; }
  const root=process.env.TMT_TEST_ROOT;
  const callbacks=new Map();
  let session='ace3e386-fa75-4420-a4fd-e377545441c7';
  let pending;
  const ctx={mode:'tui',signal:new AbortController().signal,isIdle:()=>!fs.existsSync(path.join(root,'busy')),sessionManager:{getSessionId:()=>session}};
  function emit(name,e){ for(const fn of callbacks.get(name)||[]) fn(e,ctx); }
  const pi={on(name,fn){if(!callbacks.has(name))callbacks.set(name,[]);callbacks.get(name).push(fn);},
    registerCommand(){},sendUserMessage(text,options){
      fs.appendFileSync(path.join(root,'submissions'),JSON.stringify({text,options})+'\n');
      pending = {message:{role:'user',content:[{type:'text',text}]}};
      if(ctx.isIdle()) emit('message_start',pending);
      else {
        emit('message_start',{message:{role:'assistant',content:text}});
        emit('message_start',{message:{role:'user',content:text+' changed'}});
      }
    }};
  for(let i=2;i<process.argv.length;i++) if(process.argv[i]==='--extension')
    (await import(require('node:url').pathToFileURL(process.argv[++i]))).default(pi);
  emit('session_start',{reason:'startup'});
  fs.writeFileSync(path.join(root,'ready'),'1');
  process.stdin.on('data',bytes=>{
    fs.appendFileSync(path.join(root,'input'),bytes);
    if(bytes.toString().includes('TURN-ON')){
      emit('before_agent_start',{messageType:'user',prompt:'fixture turn'});fs.writeFileSync(path.join(root,'in-turn'),'1');
    }
    if(bytes.toString().includes('TURN-OFF')){
      emit('agent_settled',{aborted:false});fs.writeFileSync(path.join(root,'turn-over'),'1');
    }
    if(bytes.toString().includes('BLOCK')) {
      emit('ui_prompt_start',{}); fs.writeFileSync(path.join(root,'blocked'),'1');
    }
    if(bytes.toString().includes('START') && pending) emit('message_start',pending);
    if(bytes.toString().includes('SWITCH')){
      emit('session_shutdown',{reason:'new'});
      session='505873ec-e67a-4b7f-83d4-f474334ed029';
      emit('session_start',{reason:'new'});fs.writeFileSync(path.join(root,'switched'),'1');
    }
    if(bytes.toString().includes('QUIT')) process.exit();
  });
})().catch(e=>{ console.error(e);process.exitCode=1; });
"#
    );
    tmt_test_support::write_executable(&fake, script.as_bytes(), 0o755).unwrap();
    tmux.tmt_json(&["identity", "create", "sender", "--json"]);
    tmux.tmt_json(&[
        "config",
        "set",
        "experimental.channel",
        "true",
        "--global",
        "--json",
    ]);
    let tmt = env!("CARGO_BIN_EXE_tmt");
    let mut env = support::command(root, &[]);
    tmux.tmt_env(&mut env);
    let assignments = env
        .get_envs()
        .filter_map(|(key, value)| {
            value.map(|v| format!("{}={}", key.to_string_lossy(), quote(v.to_str().unwrap())))
        })
        .collect::<Vec<_>>()
        .join(" ");
    let cmd = format!(
        "exec env -i {assignments} {} run --channel pi-worker {} >{} 2>&1",
        quote(tmt),
        quote(fake.to_str().unwrap()),
        quote(root.join("launch").to_str().unwrap())
    );
    assert!(
        tmux.tmux(&["respawn-pane", "-k", "-t", &tmux.pane_id, &cmd])
            .status
            .success()
    );
    wait_until("Pi handshake and session admission", || {
        if !root.join("ready").exists() {
            return false;
        }
        tmux.db().query_row("SELECT count(*) FROM bindings WHERE runtime_state='running' AND observed_provider_session_id IS NOT NULL",[],|r|r.get::<_,i64>(0)).unwrap()>0
    });
    let sent = tmux.tmt_json(&[
        "talk",
        "--identity",
        "sender",
        "--detach",
        "pi-worker",
        "one exact request",
        "--json",
    ]);
    assert_eq!(sent["status"], "sent", "{sent}");
    let text = fs::read_to_string(root.join("submissions")).unwrap();
    assert_eq!(text.lines().count(), 1);
    let payload: Value = serde_json::from_str(text.trim()).unwrap();
    let frame = payload["text"].as_str().unwrap();
    assert!(
        frame.contains(sent["requestId"].as_str().unwrap())
            && frame.contains("one exact request")
            && frame.contains("--receipt v2_")
    );
    assert_eq!(
        payload["options"],
        serde_json::json!({"expandPromptTemplates":false})
    );
    let receipt = frame
        .split("--receipt ")
        .nth(1)
        .unwrap()
        .split_whitespace()
        .next()
        .unwrap();
    let request_id = sent["requestId"].as_str().unwrap();
    tmux.tmt_json(&[
        "reply",
        request_id,
        "--receipt",
        receipt,
        "--message",
        "idle receipt verified",
        "--json",
    ]);
    let result = tmux.tmt_json(&["result", request_id, "--json"]);
    assert_eq!(result["response"], "idle receipt verified");
    assert!(!root.join("input").exists());
    fs::write(root.join("busy"), "").unwrap();
    for (message, mode, abandon) in [
        ("normal queued", "followUp", false),
        ("urgent queued", "steer", false),
        ("sender exits", "followUp", true),
    ] {
        let mut args = vec!["talk", "--identity", "sender", "--detach", "--json"];
        if mode == "steer" {
            args.push("--urgent");
        }
        args.extend(["pi-worker", message]);
        let mut command = support::command(root, &args);
        tmux.tmt_env(&mut command);
        let mut caller = command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        wait_until("Pi holds the full request", || {
            fs::read_to_string(root.join("submissions"))
                .unwrap()
                .contains(message)
        });
        let contents = fs::read_to_string(root.join("submissions")).unwrap();
        let submit: Value = serde_json::from_str(contents.lines().last().unwrap()).unwrap();
        assert_eq!(submit["options"]["deliverAs"], mode);
        let request_id = submit["text"]
            .as_str()
            .unwrap()
            .split("tmt reply ")
            .nth(1)
            .unwrap()
            .split_whitespace()
            .next()
            .unwrap();
        let show = || tmux.tmt_json(&["x", "show", request_id, "--identity", "sender", "--json"]);
        let pending = show().to_string();
        assert!(pending.contains("waiting_for_delivery"), "{pending}");
        if abandon {
            caller.kill().unwrap();
            caller.wait().unwrap();
            // Advance only the abandoned attempt's deadline, as if its receipt window elapsed.
            tmux.db().execute("UPDATE request_attempts SET receipt_deadline_ms=1 WHERE request_id=? AND wake_state='uncertain'",[request_id]).unwrap();
            let expired = show().to_string();
            assert!(expired.contains("unconfirmed"), "{expired}");
            let retry = tmux.tmt(&["send-now", request_id, "--identity", "sender", "--json"]);
            assert!(!retry.status.success());
            assert!(
                String::from_utf8_lossy(&retry.stdout).contains("SEND_NOW_UNCONFIRMED")
                    || String::from_utf8_lossy(&retry.stderr).contains("SEND_NOW_UNCONFIRMED")
            );
        }
        assert!(
            tmux.tmux(&["send-keys", "-t", &tmux.pane_id, "START", "Enter"])
                .status
                .success()
        );
        if !abandon {
            let sent = caller.wait_with_output().unwrap();
            assert!(
                sent.status.success(),
                "{}",
                String::from_utf8_lossy(&sent.stderr)
            );
            assert_eq!(tmux.db().query_row("SELECT wake_state FROM request_attempts WHERE request_id=? AND receipt_deadline_ms IS NULL",[request_id],|r|r.get::<_,String>(0)).unwrap(),"sent");
        } else {
            assert!(show().to_string().contains("unconfirmed"));
        }
    }
    let text = fs::read_to_string(root.join("submissions")).unwrap();
    assert_eq!(text.lines().count(), 4);
    fs::remove_file(root.join("busy")).unwrap();
    // A durable answer to Pi's own request also delivers its unframed notice.
    let outgoing = tmux.tmt_json(&[
        "talk",
        "--identity",
        "pi-worker",
        "--detach",
        "sender",
        "Please return a notice",
        "--json",
    ]);
    let id = outgoing["requestId"].as_str().unwrap();
    let incoming = tmux.tmt_json(&[
        "x",
        "show",
        id,
        "--incoming",
        "--identity",
        "sender",
        "--json",
    ]);
    let receipt = incoming["exchange"]["reply"]["receipt"].as_str().unwrap();
    tmux.tmt_json(&[
        "reply",
        id,
        "--receipt",
        receipt,
        "--message",
        "notice proof",
        "--json",
    ]);
    wait_until("the enrolled Pi starts the reply notice", || {
        fs::read_to_string(root.join("submissions"))
            .unwrap()
            .lines()
            .any(|l| l.contains("notice proof"))
    });

    tmux.tmt_json(&["identity", "create", "digest-owner", "--json"]);
    let now = tmt_adapters::request_runtime::wall_time_ms() as i64;
    tmux.db().execute("INSERT INTO focus_policies(identity_id,revision,until_ms,owner_identity_id,setter_identity_id,max_hold_ms)
        SELECT target.id,1,?1,owner.id,owner.id,300000 FROM identities target, identities owner WHERE target.name='pi-worker' AND owner.name='digest-owner'",[now+300_000]).unwrap();
    assert!(
        tmux.tmux(&["send-keys", "-t", &tmux.pane_id, "TURN-ON", "Enter"])
            .status
            .success()
    );
    wait_until("turn hook recorded", || root.join("in-turn").exists());
    let mut held_requests = Vec::new();
    for message in ["digest member one", "digest member two"] {
        let held = tmux.tmt_json(&[
            "talk",
            "--identity",
            "sender",
            "--detach",
            "pi-worker",
            message,
            "--json",
        ]);
        assert_eq!(held["digest"], true, "{held}");
        held_requests.push(held["requestId"].as_str().unwrap().to_owned());
    }
    assert!(
        tmux.tmux(&["send-keys", "-t", &tmux.pane_id, "TURN-OFF", "Enter"])
            .status
            .success()
    );
    wait_until("idle hook recorded", || root.join("turn-over").exists());
    tmux.db().execute("UPDATE focus_policies SET until_ms=1 WHERE identity_id=(SELECT id FROM identities WHERE name='pi-worker')",[]).unwrap();
    tmux.tmt_json(&["check", "pi-worker", "--json"]);
    let text = fs::read_to_string(root.join("submissions")).unwrap();
    let groups: Vec<_> = text
        .lines()
        .filter(|l| l.contains("digest member one"))
        .collect();
    assert_eq!(groups.len(), 1, "missing or duplicated checklist");
    let confirmed:i64=tmux.db().query_row("SELECT count(*) FROM focus_checklists WHERE state='delivered' AND confirmed_at_ms IS NOT NULL",[],|r|r.get(0)).unwrap();
    assert_eq!(confirmed, 1);
    for id in held_requests {
        let shown = tmux.tmt_json(&["x", "show", &id, "--identity", "sender", "--json"]);
        assert_eq!(
            shown["exchange"]["messageState"]["state"], "delivered",
            "{shown}"
        );
    }
    assert!(groups[0].contains("digest member two") && groups[0].contains("TMT Digest checklist"));
    tmux.tmt_json(&["check", "pi-worker", "--json"]);
    assert_eq!(fs::read_to_string(root.join("submissions")).unwrap(), text);
    assert!(
        tmux.tmux(&["send-keys", "-t", &tmux.pane_id, "BLOCK", "Enter"])
            .status
            .success()
    );
    wait_until("Pi is waiting on its user", || {
        root.join("blocked").exists()
    });
    let held = tmux.tmt(&[
        "talk",
        "--identity",
        "sender",
        "--urgent",
        "--detach",
        "pi-worker",
        "do not bypass the prompt",
        "--json",
    ]);
    assert!(!held.status.success());
    assert_eq!(fs::read_to_string(root.join("submissions")).unwrap(), text);

    assert!(
        tmux.tmux(&["send-keys", "-t", &tmux.pane_id, "SWITCH", "Enter"])
            .status
            .success()
    );
    wait_until("old endpoint retired", || root.join("switched").exists());
    let refused = tmux.tmt(&[
        "talk",
        "--identity",
        "sender",
        "--detach",
        "pi-worker",
        "must not paste",
        "--json",
    ]);
    assert!(!refused.status.success());
    assert_eq!(fs::read_to_string(root.join("submissions")).unwrap(), text);
    assert!(
        !fs::read_to_string(root.join("input"))
            .unwrap()
            .contains("must not paste")
    );
    assert!(
        tmux.tmux(&["send-keys", "-t", &tmux.pane_id, "QUIT", "Enter"])
            .status
            .success()
    );
    wait_until("lease retired", || {
        fs::read_dir(support::state_dir(root).join("channels/pi"))
            .unwrap()
            .all(|e| {
                e.unwrap()
                    .path()
                    .extension()
                    .is_none_or(|ext| ext != "json" && ext != "sock")
            })
    });
    tmux.assert_clean_attempts_and_no_dot_pi();
}
