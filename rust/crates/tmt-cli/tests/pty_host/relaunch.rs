//! The built-in member's terminal belongs to the member, not to one run of its agent
//! (#5988). When the agent ends, its supervisor keeps the terminal, the binding stays
//! the member's, and `terminal.stream` and `identities.status` report how it ended.
//! `terminal.relaunch` starts the remembered session, a fresh one or a login shell on
//! that terminal; `tmt rm` closes it.
use super::e2e::{SESSION, gone, replying_provider};
use super::paused::{ECHO_LOOP, View, call, member, screen, status, stream, wait_screen};
use super::*;
use tmt_adapters::pty::protocol::{ClientMessage, Exit};

fn relaunch(world: &World, identity: &str, kind: &str) -> Value {
    call(
        world,
        "terminal.relaunch",
        serde_json::json!({"identityId": identity, "kind": kind}),
    )
}

/// Waits until `terminal.stream` reports the program ended, checks the status
/// projection agrees, and returns the reported end.
fn wait_ended(world: &World, identity: &str) -> Value {
    let deadline = Instant::now() + WAIT;
    let ended = loop {
        let found = stream(world, identity);
        if found["ended"].is_object() {
            assert!(found.get("foreground").is_none(), "{found}");
            break found["ended"].clone();
        }
        if Instant::now() >= deadline {
            let inspected = fs::read_dir(support::state_dir(&world.root).join("pty"))
                .unwrap()
                .flatten()
                .filter_map(|entry| {
                    let path = entry.path();
                    (path.extension()? == "sock").then(|| {
                        let id = path.file_stem().unwrap().to_str().unwrap().to_owned();
                        Connection::connect(&support::state_dir(&world.root).join("pty"), &id)
                            .map(|mut client| {
                                format!(
                                    "{:?} {:?}",
                                    client.control(Control::Inspect, Duration::from_secs(3)),
                                    client.control(Control::Capture, Duration::from_secs(3))
                                )
                            })
                            .unwrap_or_else(|error| error.to_string())
                    })
                })
                .collect::<Vec<_>>();
            panic!("never ended: {found}; supervisors: {inspected:?}");
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let entry = status(world, identity);
    assert_eq!(entry["ended"], ended, "{entry}");
    assert!(entry.get("foreground").is_none(), "{entry}");
    ended
}

/// Relaunches the replying provider and releases its held SessionStart hook once the
/// relaunch answered, then waits for the member's binding, on the same pane, to record
/// that session for a running provider again.
fn relaunched(world: &mut World, identity: &str, pane: &str, kind: &str) -> Value {
    for file in ["hook.status", "provider-argv", "alpha.pid"] {
        fs::remove_file(world.root.join(file)).unwrap();
    }
    let answer = relaunch(world, identity, kind);
    assert!(world.root.join("alpha.pid").exists(), "{answer}");
    type_into(world, pane, b"\r");
    let deadline = Instant::now() + WAIT;
    while fs::read_to_string(world.root.join("hook.status"))
        .ok()
        .as_deref()
        != Some("0")
    {
        assert!(
            Instant::now() < deadline,
            "the relaunched provider's hook did not run"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    let db = rusqlite::Connection::open_with_flags(
        support::state_dir(&world.root).join("tmt.db"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    let provider: i64 = fs::read_to_string(world.root.join("alpha.pid"))
        .unwrap()
        .parse()
        .unwrap();
    loop {
        let row: (String, String, Option<i64>, Option<String>) = db
            .query_row(
                "SELECT b.pane_id,b.runtime_state,b.runtime_pid,b.observed_provider_session_id \
                 FROM bindings b WHERE b.identity_id=?",
                [identity],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        if row
            == (
                pane.into(),
                "running".into(),
                Some(provider),
                Some(SESSION.into()),
            )
        {
            break;
        }
        assert!(Instant::now() < deadline, "not recorded again: {row:?}");
        std::thread::sleep(Duration::from_millis(20));
    }
    answer
}

fn type_into(world: &World, pane: &str, bytes: &[u8]) {
    Connection::connect(&support::state_dir(&world.root).join("pty"), pane)
        .unwrap()
        .input(bytes)
        .unwrap();
}

fn files(world: &World, pane: &str) -> [PathBuf; 2] {
    let directory = support::state_dir(&world.root).join("pty");
    ["sock", "lock"].map(|extension| directory.join(format!("{pane}.{extension}")))
}

/// A talk to a member whose agent is not running reaches nothing and waits offline.
fn talk_waits_offline(world: &mut World, name: &str, text: &str) {
    let queued = world.json(&["talk", name, text, "--detach", "--json"]);
    assert_eq!(queued["offline"], true, "{queued:#}");
    assert!(!screen(world, name).contains(text));
}

#[test]
fn an_ended_agent_keeps_its_terminal_and_relaunches_a_shell_its_session_and_a_fresh_one() {
    let mut world = World::new();
    world.json(&["identity", "create", "sender", "--json"]);
    let provider = replying_provider(&mut world);
    let started = world.run(&[
        "run",
        "--no-channel",
        "--save",
        "alpha",
        provider.to_str().unwrap(),
    ]);
    assert!(started.status.success(), "{started:?}");
    let (identity, pane, _) = record_provider_session(&world, None, SESSION);
    world.remember();
    let supervisor = world.supervisor_of("alpha");
    let live = || {
        matches!(observe_runtime_process(&UnixCommandRunner, supervisor.pid(),
            Instant::now() + Duration::from_secs(3)), Ok(ProcessObservation::Live(now)) if now == supervisor)
    };
    assert!(stream(&world, &identity).get("ended").is_none());

    // The agent ends: the same supervisor keeps the terminal and the binding.
    type_into(&world, &pane, b"quit\r");
    assert_eq!(
        wait_ended(&world, &identity),
        serde_json::json!({"code": 0})
    );
    assert!(live(), "the supervisor outlives its program");
    assert!(files(&world, &pane).iter().all(|file| file.exists()));
    assert_eq!(world.member_row("alpha")["pane"], pane.as_str());
    talk_waits_offline(&mut world, "alpha", "while-ended");

    // A login shell on the kept terminal is not the member's agent.
    let shell = relaunch(&world, &identity, "shell");
    assert_eq!(shell["relaunched"], "shell", "{shell}");
    let found = stream(&world, &identity);
    assert_eq!(found["foreground"], "shell", "{found}");
    assert!(found.get("ended").is_none(), "{found}");
    assert_eq!(status(&world, &identity)["foreground"], "shell");
    type_into(&world, &pane, b"echo shell-$((40+2))\r");
    wait_screen(&mut world, "alpha", "shell-42");
    talk_waits_offline(&mut world, "alpha", "while-shell");
    let refused = relaunch(&world, &identity, "resume");
    assert_eq!(
        refused["error"]["code"], "TERMINAL_RELAUNCH_REFUSED",
        "{refused}"
    );
    let message = refused["error"]["message"].as_str().unwrap();
    assert!(
        message.contains("the shell is still running; exit it first"),
        "{message}"
    );

    // After the shell, the remembered session resumes on the same terminal.
    type_into(&world, &pane, b"exit\r");
    wait_ended(&world, &identity);
    let resumed = relaunched(&mut world, &identity, &pane, "resume");
    assert_eq!(resumed["relaunched"], "resume", "{resumed}");
    let argv = fs::read_to_string(world.root.join("provider-argv")).unwrap();
    assert!(
        argv.lines()
            .collect::<Vec<_>>()
            .windows(2)
            .any(|words| words == ["--resume", SESSION]),
        "{argv}"
    );
    let found = stream(&world, &identity);
    assert!(
        found.get("ended").is_none() && found.get("foreground").is_none(),
        "{found}"
    );
    world.talk_for_reply("alpha", "after-relaunch");
    assert!(live(), "one supervisor served every run");

    // A fresh session starts the remembered driver without resuming.
    type_into(&world, &pane, b"quit\r");
    wait_ended(&world, &identity);
    let fresh = relaunched(&mut world, &identity, &pane, "new");
    assert_eq!(fresh["relaunched"], "new", "{fresh}");
    let argv = fs::read_to_string(world.root.join("provider-argv")).unwrap();
    assert!(!argv.lines().any(|word| word == "--resume"), "{argv}");
    world.talk_for_reply("alpha", "after-fresh");
    assert!(live());
    assert!(world.clean());
}

#[test]
fn an_agent_ended_by_ctrl_c_keeps_its_terminal_a_failed_resume_keeps_it_and_rm_closes_it() {
    let mut world = World::new();
    let (identity, pane) = member(&mut world, "plain", &["-c", ECHO_LOOP]);
    wait_screen(&mut world, "plain", "paused-ready");
    world.remember();
    let supervisor = world.supervisor_of("plain");

    // Ctrl-C as a person types it ends the agent; the viewer is told, and stays.
    let mut view = View::open(&world, &identity);
    view.send(&ClientMessage::Input(vec![0x03]));
    assert!(matches!(view.exit(), Exit::Code(_) | Exit::Signal(_)));
    let ended = wait_ended(&world, &identity);
    assert!(ended.is_object(), "{ended}");
    assert!(files(&world, &pane).iter().all(|file| file.exists()));
    assert!(!gone(&supervisor));
    let listed = world.json(&["ls", "plain", "--json"]);
    assert_eq!(
        listed["presence"], "active",
        "the binding stays the member's: {listed:#}"
    );

    // The member has no remembered session: the relaunched resume refuses with its own
    // reason, and the terminal is kept.
    let failed = relaunch(&world, &identity, "resume");
    assert_eq!(
        failed["error"]["code"], "TERMINAL_RELAUNCH_FAILED",
        "{failed}"
    );
    let message = failed["error"]["message"].as_str().unwrap();
    assert!(message.contains("no remembered session"), "{message}");
    assert!(message.contains("the terminal is kept"), "{message}");
    wait_ended(&world, &identity);
    assert!(!gone(&supervisor));
    // Still the same terminal, which a viewer keeps reading.
    view.send(&ClientMessage::Input(b"x".to_vec()));
    drop(view);
    // `tmt resume` from outside runs in the member's kept terminal, not a second one that
    // the kept binding would refuse: the refusal is resume's own, and the terminal stays.
    let outside = world.run(&["resume", "--host", "pty", "--no-channel", "--new", "plain"]);
    assert_eq!(outside.status.code(), Some(1), "{outside:?}");
    let stderr = String::from_utf8_lossy(&outside.stderr);
    assert!(stderr.contains("no remembered driver"), "{stderr}");
    assert!(!stderr.contains("already active"), "{stderr}");
    assert_eq!(world.supervisor_of("plain"), supervisor);
    wait_ended(&world, &identity);

    // Removing the member closes its kept terminal.
    let removed = world.run(&["rm", "--force", "plain"]);
    assert!(removed.status.success(), "{removed:?}");
    wait_for_gone(&supervisor);
    assert!(files(&world, &pane).iter().all(|file| !file.exists()));
    assert!(world.clean());
}

fn wait_for_gone(process: &ProcessIncarnation) {
    let deadline = Instant::now() + WAIT;
    while !gone(process) {
        assert!(Instant::now() < deadline, "{process:?} did not end");
        std::thread::sleep(Duration::from_millis(20));
    }
}
