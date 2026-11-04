//! A built-in member stopped by job control (#5994): Core shows it paused in
//! `terminal.stream` and `identities.status`, refuses to deliver to it with
//! `MEMBER_PAUSED`, and `terminal.resume` continues it. Ctrl-Z itself is never
//! intercepted.
//!
//! The launcher leads an orphaned process group (its parent, the supervisor, is
//! in another session), so the kernel discards SIGTSTP sent to that group;
//! SIGSTOP stands in for a stop of the launcher's own group. A provider in its
//! own foreground group is stopped by a real Ctrl-Z typed into the terminal.
use super::*;
use nix::sys::signal::killpg;
use std::io::{Read, Write};
use tmt_adapters::pty::protocol::{ClientMessage, Decoder, Exit, Frame, ServerMessage, VERSION};

pub(super) const ECHO_LOOP: &str =
    r#"printf 'paused-ready\r\n'; while IFS= read -r line; do printf 'got:%s\r\n' "$line"; done"#;

/// One Core API call through `tmt api`, as an extension makes it.
pub(super) fn call(world: &World, operation: &str, input: Value) -> Value {
    let mut child = world
        .command(&["api"])
        .stdin(Stdio::piped())
        .spawn()
        .unwrap();
    let request = serde_json::json!({"version": 1, "operation": operation, "input": input});
    child
        .stdin
        .take()
        .unwrap()
        .write_all(request.to_string().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    serde_json::from_slice(&output.stdout).unwrap_or_else(|_| panic!("{output:?}"))
}

pub(super) fn stream(world: &World, identity: &str) -> Value {
    call(
        world,
        "terminal.stream",
        serde_json::json!({"identityId": identity}),
    )
}

fn resume(world: &World, identity: &str) -> Value {
    call(
        world,
        "terminal.resume",
        serde_json::json!({"identityId": identity}),
    )
}

/// The identity's `identities.status` entry.
pub(super) fn status(world: &World, identity: &str) -> Value {
    let answer = call(
        world,
        "identities.status",
        serde_json::json!({"identityIds": [identity]}),
    );
    answer["identities"][0].clone()
}

/// Waits until a fresh `terminal.stream` read reports `paused`, and checks the status
/// projection agrees.
fn wait_paused(world: &World, identity: &str, paused: bool) {
    let deadline = Instant::now() + WAIT;
    loop {
        let found = stream(world, identity);
        assert_eq!(found["host"], "pty", "{found}");
        if found["paused"] == paused {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "paused never became {paused}: {found}"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
    let entry = status(world, identity);
    assert_eq!(entry["found"], true, "{entry}");
    if paused {
        assert_eq!(entry["paused"], true, "{entry}");
    } else {
        assert!(
            entry.get("paused").is_none(),
            "absent, never false: {entry}"
        );
    }
}

/// Starts a saved member running `args` under the basic driver's name and returns its
/// identity and pane.
pub(super) fn member(world: &mut World, name: &str, args: &[&str]) -> (String, String) {
    let agent = world.agent();
    let mut command = vec!["run", "--no-channel", "--save", name, agent.as_str()];
    command.extend_from_slice(args);
    let started = world.run(&command);
    assert!(started.status.success(), "{started:?}");
    let listed = world.json(&["ls", "--json"]);
    let row = listed["identities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["name"] == name)
        .expect("the member is listed")
        .clone();
    (
        row["id"].as_str().unwrap().to_owned(),
        row["pane"].as_str().unwrap().to_owned(),
    )
}

/// The member's launcher pid, which leads its process group.
fn launcher(world: &World, pane: &str) -> Pid {
    let mut client = Connection::connect(&support::state_dir(&world.root).join("pty"), pane)
        .expect("connect to the supervisor");
    let ControlReply::State { pane_pid, .. } = client
        .control(Control::Inspect, Duration::from_secs(3))
        .unwrap()
    else {
        panic!("no state");
    };
    Pid::from_raw(pane_pid as i32)
}

pub(super) fn screen(world: &mut World, name: &str) -> String {
    let checked = world.run(&["check", name]);
    assert!(checked.status.success(), "{checked:?}");
    String::from_utf8_lossy(&checked.stdout).into_owned()
}

pub(super) fn wait_screen(world: &mut World, name: &str, needle: &str) {
    let deadline = Instant::now() + WAIT;
    loop {
        let text = screen(world, name);
        if text.contains(needle) {
            return;
        }
        assert!(Instant::now() < deadline, "no {needle:?} in {text}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// A raw stream connection, as the Ops Terminal tab opens one.
pub(super) struct View {
    stream: std::os::unix::net::UnixStream,
    decoder: Decoder,
}

impl View {
    pub(super) fn open(world: &World, identity: &str) -> Self {
        let found = stream(world, identity);
        let socket = found["socket"].as_str().expect("a published socket");
        let stream = std::os::unix::net::UnixStream::connect(socket).unwrap();
        stream.set_read_timeout(Some(WAIT)).unwrap();
        let mut view = Self {
            stream,
            decoder: Decoder::new(),
        };
        view.send(&ClientMessage::Hello { version: VERSION });
        assert!(matches!(view.next(), ServerMessage::Welcome { .. }));
        view
    }

    pub(super) fn send(&mut self, message: &ClientMessage) {
        self.stream.write_all(&message.encode()).unwrap();
    }

    pub(super) fn next(&mut self) -> ServerMessage {
        let mut buffer = [0u8; 8192];
        loop {
            if let Some(message) = self.decoder.frame::<ServerMessage>().unwrap() {
                return message;
            }
            let count = self.stream.read(&mut buffer).expect("the stream ended");
            assert!(count > 0, "the stream closed");
            self.decoder.push(&buffer[..count]).unwrap();
        }
    }

    pub(super) fn exit(&mut self) -> Exit {
        loop {
            match self.next() {
                ServerMessage::Exited(exit) => return exit,
                ServerMessage::Output(_) | ServerMessage::Resized(_) => {}
                other => panic!("expected the exit: {other:?}"),
            }
        }
    }
}

#[test]
fn a_paused_member_is_shown_refuses_talk_and_resumes() {
    let mut world = World::new();
    let (identity, pane) = member(&mut world, "sleeper", &["-c", ECHO_LOOP]);
    wait_screen(&mut world, "sleeper", "paused-ready");
    wait_paused(&world, &identity, false);

    killpg(launcher(&world, &pane), Signal::SIGSTOP).unwrap();
    wait_paused(&world, &identity, true);
    // A board that restarts reconnects and reads again: the state lives in the
    // supervisor, so a fresh stream connection and a fresh read still say paused.
    drop(View::open(&world, &identity));
    assert_eq!(stream(&world, &identity)["paused"], true);

    let refused = world.run(&["talk", "sleeper", "while-paused", "--detach", "--json"]);
    assert_eq!(refused.status.code(), Some(1), "{refused:?}");
    let error: Value = serde_json::from_slice(&refused.stdout).unwrap();
    assert_eq!(error["error"]["code"], "MEMBER_PAUSED", "{error:#}");
    let message = error["error"]["message"].as_str().unwrap();
    assert!(message.contains("terminal.resume"), "{message}");
    // The terminal echoes typed input even while its program is stopped: nothing was typed.
    assert!(!screen(&mut world, "sleeper").contains("while-paused"));

    let resumed = resume(&world, &identity);
    assert_eq!(resumed["resumed"], true, "{resumed}");
    wait_paused(&world, &identity, false);
    // Resuming a member that is not paused is applied and changes nothing.
    let again = resume(&world, &identity);
    assert_eq!(again["resumed"], true, "{again}");
    assert_eq!(stream(&world, &identity)["paused"], false);

    let sent = world.run(&["talk", "sleeper", "after-resume", "--detach", "--json"]);
    assert!(sent.status.success(), "{sent:?}");
    wait_screen(&mut world, "sleeper", "got:");
    assert!(world.clean());
}

#[test]
fn a_member_that_ends_while_paused_still_reports_its_exit() {
    let mut world = World::new();
    let (identity, pane) = member(&mut world, "ender", &["-c", ECHO_LOOP]);
    wait_screen(&mut world, "ender", "paused-ready");
    let group = launcher(&world, &pane);
    let mut view = View::open(&world, &identity);
    killpg(group, Signal::SIGSTOP).unwrap();
    wait_paused(&world, &identity, true);
    killpg(group, Signal::SIGKILL).unwrap();
    assert_eq!(view.exit(), Exit::Signal(9));
    // The terminal is kept (#5988): the stream reports the end, and nothing is paused.
    let deadline = Instant::now() + WAIT;
    loop {
        let after = stream(&world, &identity);
        if after["ended"] == serde_json::json!({"signal": 9}) {
            assert_eq!(after["paused"], false, "{after}");
            break;
        }
        assert!(Instant::now() < deadline, "never reported ended: {after}");
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(status(&world, &identity).get("paused").is_none());
    assert!(world.clean());
}

/// Runs `$ARGV[0]` with `sh -c` in a new process group that takes the terminal, then
/// waits for it without reclaiming the terminal, as a launcher that is not a
/// job-control shell does. SIGTTOU is ignored so the child may take the terminal from
/// the background; it never reads before it holds it. A copy of the supervisor unit
/// test's launcher, which this crate cannot import.
const OWN_GROUP_LAUNCHER: &str = r#"$SIG{TTOU} = "IGNORE";
my $script = $ARGV[0];
my $pid = fork() // die "fork: $!";
if ($pid == 0) {
    setpgid(0, 0) or die "setpgid: $!";
    tcsetpgrp(0, getpgrp()) or die "tcsetpgrp: $!";
    exec("/bin/sh", "-c", $script) or die "exec: $!";
}
waitpid($pid, 0);
exit(WIFEXITED($?) ? WEXITSTATUS($?) : 128 + WTERMSIG($?));"#;

#[test]
fn ctrl_z_that_stops_only_a_provider_in_its_own_group_is_still_paused() {
    let mut world = World::new();
    let perl = ["/usr/bin/perl", "/bin/perl"]
        .into_iter()
        .find(|path| std::path::Path::new(path).is_file())
        .expect("perl");
    std::os::unix::fs::symlink(perl, world.root.join("bin/perl")).unwrap();
    let (identity, pane) = member(
        &mut world,
        "grouped",
        &[
            "-c",
            r#"exec perl -MPOSIX -e "$0" "$1""#,
            OWN_GROUP_LAUNCHER,
            ECHO_LOOP,
        ],
    );
    wait_screen(&mut world, "grouped", "paused-ready");
    wait_paused(&world, &identity, false);

    // Ctrl-Z as a person types it: the terminal signals its foreground group only.
    let mut view = View::open(&world, &identity);
    view.send(&ClientMessage::Input(vec![0x1a]));
    wait_paused(&world, &identity, true);
    let group = launcher(&world, &pane);
    assert!(
        matches!(
            observe_runtime_process(
                &UnixCommandRunner,
                group.as_raw() as u64,
                Instant::now() + Duration::from_secs(3)
            ),
            Ok(ProcessObservation::Live(_))
        ),
        "the launcher keeps running"
    );

    let resumed = resume(&world, &identity);
    assert_eq!(resumed["resumed"], true, "{resumed}");
    wait_paused(&world, &identity, false);
    view.send(&ClientMessage::Input(b"continued\r".to_vec()));
    wait_screen(&mut world, "grouped", "got:continued");
    drop(view);
    assert!(world.clean());
}
