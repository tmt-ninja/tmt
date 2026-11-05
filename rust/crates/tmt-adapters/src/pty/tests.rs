//! The supervisor against real pseudo-terminals, in this process: the programs
//! are model-free `sh` one-liners and every client is a real socket connection.

use super::{Connection, Launch, Supervisor, lock_path, socket_path, supervisor::MAX_CLIENTS};
use crate::{private_file::ensure_private_directory, test_support::TestDirectory};
use nix::{
    sys::signal::{Signal, kill},
    unistd::Pid,
};
use std::{
    ffi::OsString,
    fs,
    io::{self, Read, Write},
    os::unix::{
        fs::PermissionsExt,
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tmt_pty_protocol::{
    ClientMessage, Decoder, Eviction, Exit, Frame, Refusal, ServerMessage, Size, VERSION,
};

const WAIT: Duration = Duration::from_secs(20);

fn size(cols: u16, rows: u16) -> Size {
    Size::new(cols, rows).unwrap()
}

/// A supervisor running on a thread of the test, with its own owner-only directory.
struct Member {
    _root: TestDirectory,
    directory: PathBuf,
    id: String,
    pid: u32,
    thread: Option<JoinHandle<io::Result<()>>>,
}

impl Member {
    fn start(program: &[&str]) -> Self {
        Self::start_with(program, |supervisor| supervisor)
    }

    fn start_with(program: &[&str], configure: impl FnOnce(Supervisor) -> Supervisor) -> Self {
        let root = TestDirectory::new();
        let directory = root.path.join("pty");
        let supervisor = configure(
            Supervisor::start(launch(&directory, "pty_test", program))
                .expect("start the supervisor"),
        );
        let pid = supervisor.program_pid();
        Self {
            _root: root,
            directory,
            id: "pty_test".to_owned(),
            pid,
            thread: Some(std::thread::spawn(move || supervisor.run())),
        }
    }

    fn connect(&self) -> Connection {
        Connection::connect(&self.directory, &self.id).expect("attach to the supervisor")
    }

    /// Waits for the program to end on its own, then closes the kept terminal and
    /// waits for the supervisor to end, returning how.
    fn finish(mut self) -> io::Result<()> {
        wait_ended(&self.directory, &self.id);
        close(&self.directory, &self.id);
        join(self.thread.take().unwrap())
    }
}

impl Drop for Member {
    fn drop(&mut self) {
        // A test that failed leaves the supervisor serving: close it, which hangs up
        // a running program, and only then fall back to signalling the program.
        if let Some(thread) = self.thread.take() {
            if !thread.is_finished() {
                if let Ok(mut client) = Connection::connect(&self.directory, &self.id) {
                    let _ = client.control(tmt_pty_protocol::Control::Close, WAIT);
                }
                let deadline = Instant::now() + WAIT;
                while !thread.is_finished() && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
            if thread.is_finished() {
                let _ = thread.join();
            } else {
                let _ = kill(Pid::from_raw(self.pid as i32), Signal::SIGKILL);
            }
        }
    }
}

fn join(thread: JoinHandle<io::Result<()>>) -> io::Result<()> {
    let deadline = Instant::now() + WAIT;
    while !thread.is_finished() {
        assert!(Instant::now() < deadline, "the supervisor did not end");
        std::thread::sleep(Duration::from_millis(10));
    }
    thread.join().expect("the supervisor thread panicked")
}

/// One fresh Inspect of the member's supervisor.
fn inspect(directory: &Path, id: &str) -> tmt_pty_protocol::ControlReply {
    Connection::connect(directory, id)
        .expect("attach to the supervisor")
        .control(tmt_pty_protocol::Control::Inspect, WAIT)
        .unwrap()
}

/// Waits until the supervisor reports the program ended, and returns how.
fn wait_ended(directory: &Path, id: &str) -> Exit {
    let deadline = Instant::now() + WAIT;
    loop {
        if let tmt_pty_protocol::ControlReply::State {
            ended: Some(exit), ..
        } = inspect(directory, id)
        {
            return exit;
        }
        assert!(Instant::now() < deadline, "the program did not end");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn close(directory: &Path, id: &str) {
    assert_eq!(
        Connection::connect(directory, id)
            .expect("attach to the supervisor")
            .control(tmt_pty_protocol::Control::Close, WAIT)
            .unwrap(),
        tmt_pty_protocol::ControlReply::Applied(true)
    );
}

/// Serves a supervisor whose program ends by itself, then closes its kept terminal.
fn run_until_closed(directory: &Path, id: &str, supervisor: Supervisor) {
    let thread = std::thread::spawn(move || supervisor.run());
    wait_ended(directory, id);
    close(directory, id);
    join(thread).unwrap();
}

fn launch(directory: &Path, id: &str, program: &[&str]) -> Launch {
    Launch {
        directory: directory.to_path_buf(),
        id: id.to_owned(),
        size: size(80, 24),
        program: program.iter().map(OsString::from).collect(),
        terminal: None,
        environment: Vec::new(),
    }
}

/// What a client has received so far: the tail of its output as text, and every
/// other frame.
#[derive(Default)]
struct Transcript {
    text: String,
    frames: Vec<ServerMessage>,
}

/// Receives until `done` holds; a closed connection or the timeout fails the test.
fn collect(connection: &mut Connection, done: impl Fn(&Transcript) -> bool) -> Transcript {
    let deadline = Instant::now() + WAIT;
    let mut seen = Transcript::default();
    while !done(&seen) {
        let left = deadline.saturating_duration_since(Instant::now());
        match connection.receive(left) {
            Ok(Some(ServerMessage::Output(bytes))) => {
                seen.text.push_str(&String::from_utf8_lossy(&bytes));
                // Only the tail can complete a needle; megabytes of output stay cheap.
                if seen.text.len() > 16 * 1024 {
                    let cut = seen
                        .text
                        .char_indices()
                        .rev()
                        .nth(4096)
                        .map_or(0, |(i, _)| i);
                    seen.text.drain(..cut);
                }
            }
            Ok(Some(other)) => seen.frames.push(other),
            Ok(None) => panic!("timed out; saw {:?} and {:?}", seen.text, seen.frames),
            Err(error) => panic!("{error}; saw {:?} and {:?}", seen.text, seen.frames),
        }
    }
    seen
}

fn says(needle: &'static str) -> impl Fn(&Transcript) -> bool {
    move |seen| seen.text.contains(needle)
}

fn exited(code: Exit) -> impl Fn(&Transcript) -> bool {
    move |seen| seen.frames.contains(&ServerMessage::Exited(code))
}

/// A raw socket for what `Connection` refuses to send.
struct Raw {
    stream: UnixStream,
    decoder: Decoder,
}

impl Raw {
    fn connect(member: &Member) -> Self {
        let stream = UnixStream::connect(socket_path(&member.directory, &member.id)).unwrap();
        stream.set_read_timeout(Some(WAIT)).unwrap();
        Self {
            stream,
            decoder: Decoder::new(),
        }
    }

    fn send(&mut self, bytes: &[u8]) {
        match (&self.stream).write_all(bytes) {
            // A supervisor that refuses answers and closes without reading.
            Err(error) if error.kind() == io::ErrorKind::BrokenPipe => {}
            sent => sent.unwrap(),
        }
    }

    /// The next frame, or `None` once the supervisor closed the connection.
    fn next(&mut self) -> Option<ServerMessage> {
        let mut buffer = [0u8; 4096];
        loop {
            if let Some(message) = self.decoder.frame::<ServerMessage>().unwrap() {
                return Some(message);
            }
            match (&self.stream).read(&mut buffer) {
                Ok(0) => return None,
                Ok(count) => self.decoder.push(&buffer[..count]).unwrap(),
                Err(error) => panic!("reading from the supervisor: {error}"),
            }
        }
    }
}

#[test]
fn every_attached_client_sees_the_output_and_the_exit() {
    let member = Member::start(&["sh", "-c", "read l; echo got:$l"]);
    let (mut first, mut second) = (member.connect(), member.connect());
    assert_eq!(first.size(), size(80, 24));
    first.input(b"hello\r").unwrap();
    for client in [&mut first, &mut second] {
        collect(client, says("got:hello"));
    }
    for client in [&mut first, &mut second] {
        collect(client, exited(Exit::Code(0)));
    }
    let directory = member.directory.clone();
    member.finish().unwrap();
    assert!(!socket_path(&directory, "pty_test").exists());
    assert!(!lock_path(&directory, "pty_test").exists());
}

#[test]
fn the_exit_status_and_the_signal_are_reported() {
    let member = Member::start(&["sh", "-c", "read l; exit 7"]);
    let mut client = member.connect();
    client.input(b"\r").unwrap();
    collect(&mut client, exited(Exit::Code(7)));
    member.finish().unwrap();

    let member = Member::start(&["sh", "-c", "read l; kill -9 $$"]);
    let mut client = member.connect();
    client.input(b"\r").unwrap();
    collect(&mut client, exited(Exit::Signal(9)));
    member.finish().unwrap();
}

#[test]
fn a_control_answer_after_an_unread_exit_on_the_same_connection_is_still_the_answer() {
    let member = Member::start(&["sh", "-c", "read l; exit 3"]);
    let mut client = member.connect();
    client.input(b"\r").unwrap();
    // The exit is published before this client reads anything, so `Exited` is queued
    // ahead of the answer on its connection.
    assert_eq!(wait_ended(&member.directory, &member.id), Exit::Code(3));
    assert!(matches!(
        client
            .control(tmt_pty_protocol::Control::Inspect, WAIT)
            .unwrap(),
        tmt_pty_protocol::ControlReply::State {
            ended: Some(Exit::Code(3)),
            ..
        }
    ));
    drop(client);
    member.finish().unwrap();
}

#[test]
fn a_waiting_control_ends_with_the_program_instead_of_running_out_its_time() {
    let member = Member::start(&["sh", "-c", "read l"]);
    let mut wrapper = member.connect();
    let waiting = std::thread::spawn(move || {
        let started = Instant::now();
        let reply = wrapper.control(tmt_pty_protocol::Control::WaitLauncher, WAIT);
        (reply, started.elapsed())
    });
    // No launcher listens, so only the program's exit can answer the wait.
    let mut client = member.connect();
    client.input(b"\r").unwrap();
    let (reply, took) = waiting.join().unwrap();
    // A wait already queued ends with the exit; one that arrives after it is refused.
    match reply {
        Err(error) => assert_eq!(error.kind(), io::ErrorKind::UnexpectedEof),
        Ok(reply) => assert!(
            matches!(reply, tmt_pty_protocol::ControlReply::Error(_)),
            "{reply:?}"
        ),
    }
    assert!(took < WAIT, "the wait ended with the exit, not its timeout");
    wait_ended(&member.directory, &member.id);
    // After the exit, both waits are answered at once.
    for request in [
        tmt_pty_protocol::Control::WaitLauncher,
        tmt_pty_protocol::Control::AwaitLaunch,
    ] {
        assert!(matches!(
            member.connect().control(request, WAIT).unwrap(),
            tmt_pty_protocol::ControlReply::Error(_)
        ));
    }
    drop(client);
    member.finish().unwrap();
}

#[test]
fn a_program_runs_to_the_end_with_nobody_attached() {
    // More output than any terminal or socket buffer holds: it finishes only if
    // the supervisor keeps reading while no client is there.
    let member = Member::start(&["sh", "-c", "yes | head -c 3000000"]);
    member.finish().unwrap();
}

#[test]
fn a_client_that_detaches_leaves_the_program_running() {
    let member = Member::start(&["sh", "-c", "read l; echo got:$l"]);
    let mut leaving = member.connect();
    leaving.send(&ClientMessage::Detach).unwrap();
    drop(leaving);
    let mut staying = member.connect();
    staying.input(b"later\r").unwrap();
    collect(&mut staying, says("got:later"));
    drop(member.finish());
}

#[test]
fn the_window_follows_the_client_that_resizes_or_types() {
    let member = Member::start(&["sh", "-c", "while read l; do stty size; done"]);
    let mut first = member.connect();
    first.send(&ClientMessage::Resize(size(100, 30))).unwrap();
    collect(&mut first, |seen| {
        seen.frames.contains(&ServerMessage::Resized(size(100, 30)))
    });
    first.input(b"go\r").unwrap();
    collect(&mut first, says("30 100"));

    // A new client is told the size in force and can take the window.
    let mut second = member.connect();
    assert_eq!(second.size(), size(100, 30));
    second.send(&ClientMessage::Resize(size(50, 20))).unwrap();
    collect(&mut first, |seen| {
        seen.frames.contains(&ServerMessage::Resized(size(50, 20)))
    });
    second.input(b"go\r").unwrap();
    collect(&mut second, says("20 50"));

    // Typing in the first window brings the terminal back to it.
    first.input(b"go\r").unwrap();
    collect(&mut first, says("30 100"));

    // A client that never sent a size, a delivery, does not move the window.
    let mut delivery = member.connect();
    delivery.input(b"go\r").unwrap();
    collect(&mut delivery, says("30 100"));
}

#[test]
fn sole_use_disconnects_the_other_clients() {
    let member = Member::start(&["sh", "-c", "read l; echo got:$l"]);
    let mut other = member.connect();
    let mut taker = member.connect();
    taker.send(&ClientMessage::TakeSole).unwrap();
    collect(&mut other, |seen| {
        seen.frames
            .contains(&ServerMessage::Evicted(Eviction::TakenOver))
    });
    assert!(
        other.receive(WAIT).is_err(),
        "the evicted connection is closed"
    );
    taker.input(b"alone\r").unwrap();
    collect(&mut taker, says("got:alone"));
}

#[test]
fn a_stalled_client_is_evicted_and_the_program_goes_on_for_the_others() {
    let member = Member::start(&[
        "sh",
        "-c",
        "yes | head -c 4000000; echo END; read l; echo done",
    ]);
    let mut stalled = member.connect();
    let mut reading = member.connect();
    // `stalled` reads nothing: output pauses until it is evicted, then resumes.
    collect(&mut reading, says("END"));
    // It was told if its connection lasted; either way its stream ends.
    let mut told = None;
    loop {
        match stalled.receive(WAIT) {
            Ok(Some(ServerMessage::Evicted(reason))) => told = Some(reason),
            Ok(Some(ServerMessage::Exited(_))) => panic!("the program has not ended"),
            Ok(Some(_)) => {}
            Ok(None) => panic!("the stalled client was never disconnected"),
            Err(_) => break,
        }
    }
    assert!(told.is_none_or(|reason| reason == Eviction::TooSlow));
    reading.input(b"\r").unwrap();
    collect(&mut reading, exited(Exit::Code(0)));
    member.finish().unwrap();
}

/// What a client rebuilds from one snapshot: a terminal at the size it says, holding the screen.
struct Snapshot {
    /// Frames that arrived before the snapshot started, in order.
    before: Vec<ServerMessage>,
    screen: vt100::Parser,
    chunks: Vec<usize>,
}

/// Requests a snapshot and applies it the way a client must: start discards what it held,
/// the data is buffered, and the end gives the size to rebuild it at.
fn snapshot(connection: &mut Connection) -> Snapshot {
    connection.send(&ClientMessage::Snapshot).unwrap();
    let (mut before, mut data, mut chunks, mut started) =
        (Vec::new(), Vec::new(), Vec::new(), false);
    let deadline = Instant::now() + WAIT;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match connection
            .receive(left)
            .unwrap()
            .expect("a snapshot before the timeout")
        {
            ServerMessage::SnapshotStart => {
                (data, chunks, started) = (Vec::new(), Vec::new(), true);
            }
            ServerMessage::SnapshotData(bytes) => {
                assert!(started, "data before a start");
                chunks.push(bytes.len());
                data.extend(bytes);
            }
            ServerMessage::SnapshotEnd(at) => {
                assert!(started, "an end before a start");
                let mut screen = vt100::Parser::new(at.rows, at.cols, 0);
                screen.process(&data);
                return Snapshot {
                    before,
                    screen,
                    chunks,
                };
            }
            other => {
                assert!(!started, "a frame inside a snapshot: {other:?}");
                before.push(other);
            }
        }
    }
}

/// A member whose program prints nothing until the test opens the gate: output is not replayed
/// to a client that connects later, so a program that printed at once could win the race.
struct Gate {
    _directory: TestDirectory,
    file: PathBuf,
}

impl Gate {
    fn member(script: &str) -> (Member, Self) {
        let directory = TestDirectory::new();
        let file = directory.path.join("open");
        let script = format!(
            "while [ ! -e '{}' ]; do sleep 0.02; done; {script}",
            file.display()
        );
        let member = Member::start(&["sh", "-c", &script]);
        (
            member,
            Self {
                _directory: directory,
                file,
            },
        )
    }

    fn open(&self) {
        fs::write(&self.file, b"").unwrap();
    }
}

#[test]
fn a_snapshot_rebuilds_the_screen_with_its_colors_cursor_and_input_modes() {
    let (member, gate) = Gate::member(
        r"printf '\033[?2004h\033[?1h\033[?1000h\033[31mred\033[0m plain\r\nnext'; read l",
    );
    let mut client = member.connect();
    client.send(&ClientMessage::Resize(size(100, 30))).unwrap();
    gate.open();
    collect(&mut client, says("next"));

    let rebuilt = snapshot(&mut client);
    let screen = rebuilt.screen.screen();
    assert_eq!(screen.size(), (30, 100));
    assert_eq!(screen.contents(), "red plain\nnext");
    assert_eq!(screen.cell(0, 0).unwrap().fgcolor(), vt100::Color::Idx(1));
    assert_eq!(screen.cell(0, 4).unwrap().fgcolor(), vt100::Color::Default);
    assert_eq!(screen.cursor_position(), (1, 4));
    assert!(!screen.hide_cursor());
    assert!(screen.bracketed_paste());
    assert!(screen.application_cursor());
    assert_eq!(
        screen.mouse_protocol_mode(),
        vt100::MouseProtocolMode::PressRelease
    );
    assert!(!screen.alternate_screen());
}

#[test]
fn a_snapshot_keeps_a_hidden_cursor_where_the_program_parked_it() {
    // An input method draws uncommitted text at the cursor, shown or not: the relay to
    // `tmt attach` must put it back where the program left it, still hidden.
    let (member, gate) = Gate::member(r"printf 'prompt\r\n> \033[?25l\033[2;3H'; read l");
    let mut client = member.connect();
    gate.open();
    collect(&mut client, says("prompt"));

    let rebuilt = snapshot(&mut client);
    let screen = rebuilt.screen.screen();
    assert_eq!(screen.cursor_position(), (1, 2));
    assert!(screen.hide_cursor());
}

#[test]
fn a_snapshot_of_the_alternate_screen_enters_it() {
    let (member, gate) = Gate::member(r"printf 'main\r\n\033[?1049h\033[2J\033[Halt'; read l");
    let mut client = member.connect();
    gate.open();
    collect(&mut client, says("alt"));

    let rebuilt = snapshot(&mut client);
    assert!(rebuilt.screen.screen().alternate_screen());
    assert_eq!(rebuilt.screen.screen().contents(), "alt");
}

#[test]
fn output_before_a_snapshot_precedes_it_and_output_after_applies_once_on_top() {
    let (member, gate) = Gate::member("printf 'one\\r\\n'; read l; printf 'two\\r\\n'; read l");
    // Never reads before asking: the first line is already queued ahead of the request.
    let mut client = member.connect();
    let mut watcher = member.connect();
    gate.open();
    collect(&mut watcher, says("one"));

    let rebuilt = snapshot(&mut client);
    let early: String = rebuilt
        .before
        .iter()
        .filter_map(|frame| match frame {
            ServerMessage::Output(bytes) => Some(String::from_utf8_lossy(bytes).into_owned()),
            _ => None,
        })
        .collect();
    assert!(early.is_empty() || early.contains("one"), "{early:?}");
    assert_eq!(rebuilt.screen.screen().contents(), "one");

    // What the program prints next arrives after the snapshot, once.
    client.input(b"\r").unwrap();
    let after = collect(&mut client, says("two"));
    assert!(!after.text.contains("one"), "repeated: {:?}", after.text);
}

#[test]
fn every_snapshot_request_gets_the_screen_as_it_is_then() {
    let (member, gate) = Gate::member("printf 'first'; read l; printf ' second'; read l");
    let mut client = member.connect();
    gate.open();
    collect(&mut client, says("first"));
    assert_eq!(snapshot(&mut client).screen.screen().contents(), "first");

    client.input(b"\r").unwrap();
    collect(&mut client, says("second"));
    // The echo of the Enter moved to the next line before the program printed again.
    let latest = snapshot(&mut client);
    assert!(latest.screen.screen().contents().contains("second"));
    // Asking again with nothing new returns the same screen, not a queue of older ones.
    let again = snapshot(&mut client);
    assert_eq!(
        again.screen.screen().contents_formatted(),
        latest.screen.screen().contents_formatted()
    );
}

#[test]
fn a_large_screen_arrives_in_chunks_within_the_output_bound() {
    let member = Member::start(&[
        "sh",
        "-c",
        r#"read l; i=0; while [ $i -lt 100 ]; do printf '\033[%dm%0300d\033[0m\r\n' $((31 + i % 7)) $i; i=$((i + 1)); done; printf end; read l"#,
    ]);
    let mut client = member.connect();
    client.send(&ClientMessage::Resize(size(300, 100))).unwrap();
    collect(&mut client, |seen| {
        seen.frames
            .contains(&ServerMessage::Resized(size(300, 100)))
    });
    client.input(b"go\r").unwrap();
    collect(&mut client, says("end"));

    let rebuilt = snapshot(&mut client);
    assert!(rebuilt.chunks.len() >= 2, "{:?}", rebuilt.chunks);
    assert!(
        rebuilt
            .chunks
            .iter()
            .all(|chunk| (1..=tmt_pty_protocol::MAX_OUTPUT).contains(chunk))
    );
    let contents = rebuilt.screen.screen().contents();
    assert!(contents.contains(&format!("{:0300}", 42)));
    assert!(contents.ends_with("end"));
}

#[test]
fn a_snapshot_asked_before_the_hello_is_a_handshake_refusal() {
    let member = Member::start(&["sh", "-c", "read l"]);
    let mut raw = Raw::connect(&member);
    raw.send(&ClientMessage::Snapshot.encode());
    assert_eq!(raw.next(), Some(ServerMessage::Refused(Refusal::Handshake)));
    assert_eq!(raw.next(), None);
}

#[test]
fn a_client_that_asks_for_a_snapshot_without_reading_its_backlog_is_evicted() {
    // A full 1000 x 1000 screen makes the first snapshot far larger than the backlog the
    // supervisor tolerates and than any socket buffer can absorb, so the second request finds
    // the client behind whatever the timing: no sleep decides it.
    let member = Member::start(&[
        "sh",
        "-c",
        r#"read l; i=0; while [ $i -lt 1000 ]; do printf '%01000d\r\n' $i; i=$((i + 1)); done; printf end; read l"#,
    ]);
    let mut reading = member.connect();
    reading
        .send(&ClientMessage::Resize(size(1000, 1000)))
        .unwrap();
    collect(&mut reading, |seen| {
        seen.frames
            .contains(&ServerMessage::Resized(size(1000, 1000)))
    });
    reading.input(b"go\r").unwrap();
    collect(&mut reading, says("end"));

    let mut stalled = Raw::connect(&member);
    stalled.send(&ClientMessage::Hello { version: VERSION }.encode());
    assert!(matches!(
        stalled.next(),
        Some(ServerMessage::Welcome { .. })
    ));
    let mut twice = ClientMessage::Snapshot.encode();
    twice.extend(ClientMessage::Snapshot.encode());
    stalled.send(&twice);
    let mut evicted = false;
    let mut completed = 0;
    while let Some(frame) = stalled.next() {
        match frame {
            ServerMessage::Evicted(Eviction::TooSlow) => evicted = true,
            ServerMessage::SnapshotEnd(_) => completed += 1,
            _ => {}
        }
    }
    assert!(evicted, "the stalled client was not told it was too slow");
    // The first snapshot is larger than any buffer and was not read, so none was completed.
    assert_eq!(completed, 0);
    // The member went on: the reading client is still served.
    reading.input(b"\r").unwrap();
}

#[test]
fn a_connection_that_breaks_the_protocol_is_refused_or_closed() {
    let member = Member::start(&["sh", "-c", "read l; echo got:$l"]);

    // Input before the handshake.
    let mut raw = Raw::connect(&member);
    raw.send(&ClientMessage::Input(b"x".to_vec()).encode());
    assert_eq!(raw.next(), Some(ServerMessage::Refused(Refusal::Handshake)));
    assert_eq!(raw.next(), None);

    // A version this supervisor does not speak.
    let mut raw = Raw::connect(&member);
    raw.send(
        &ClientMessage::Hello {
            version: VERSION + 1,
        }
        .encode(),
    );
    assert_eq!(raw.next(), Some(ServerMessage::Refused(Refusal::Version)));
    assert_eq!(raw.next(), None);

    // A frame that is not valid, and a second hello, close the connection.
    let mut raw = Raw::connect(&member);
    raw.send(&ClientMessage::Hello { version: VERSION }.encode());
    assert!(matches!(raw.next(), Some(ServerMessage::Welcome { .. })));
    raw.send(&[0x7f, 0, 0, 0, 0]);
    assert_eq!(raw.next(), None);
    let mut raw = Raw::connect(&member);
    raw.send(&ClientMessage::Hello { version: VERSION }.encode());
    assert!(matches!(raw.next(), Some(ServerMessage::Welcome { .. })));
    raw.send(&ClientMessage::Hello { version: VERSION }.encode());
    assert_eq!(raw.next(), None);

    // None of that reached the program.
    let mut client = member.connect();
    client.input(b"fine\r").unwrap();
    collect(&mut client, |seen| seen.text.contains("got:fine"));
}

#[test]
fn clients_beyond_the_limit_are_refused() {
    let member = Member::start(&["sh", "-c", "read l; echo got:$l"]);
    let attached: Vec<Connection> = (0..MAX_CLIENTS).map(|_| member.connect()).collect();
    let mut raw = Raw::connect(&member);
    raw.send(&ClientMessage::Hello { version: VERSION }.encode());
    assert_eq!(raw.next(), Some(ServerMessage::Refused(Refusal::Full)));
    assert_eq!(attached.len(), MAX_CLIENTS);
}

#[test]
fn a_refusal_is_reported_even_when_the_supervisor_closed_before_the_hello() {
    let (client, mut supervisor) = UnixStream::pair().unwrap();
    client.set_write_timeout(Some(WAIT)).unwrap();
    supervisor
        .write_all(&ServerMessage::Refused(Refusal::Full).encode())
        .unwrap();
    drop(supervisor);
    let error = Connection::handshake(client).err().expect("refused");
    assert_eq!(error.kind(), io::ErrorKind::PermissionDenied, "{error}");
    assert!(error.to_string().contains("Full"), "{error}");

    // Without a refusal to read, the failed Hello is what is reported.
    let (client, supervisor) = UnixStream::pair().unwrap();
    drop(supervisor);
    let error = Connection::handshake(client).err().expect("closed");
    assert_eq!(error.kind(), io::ErrorKind::BrokenPipe, "{error}");
}

#[test]
fn a_client_that_never_says_hello_is_dropped() {
    let member = Member::start(&["sh", "-c", "read l; echo got:$l"]);
    let mut silent = Raw::connect(&member);
    assert_eq!(
        silent.next(),
        Some(ServerMessage::Refused(Refusal::Handshake))
    );
    assert_eq!(silent.next(), None);
}

#[test]
fn a_second_supervisor_for_the_member_is_refused_and_a_dead_ones_socket_is_replaced() {
    let member = Member::start(&["sh", "-c", "read l; echo got:$l"]);
    let error = Supervisor::start(launch(&member.directory, &member.id, &["sh", "-c", "true"]))
        .err()
        .expect("a second supervisor must not start");
    assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
    // The first is untouched.
    let mut client = member.connect();
    client.input(b"still\r").unwrap();
    collect(&mut client, says("got:still"));
    member.finish().unwrap();

    // A killed supervisor leaves its socket behind; its lock died with it.
    let root = TestDirectory::new();
    let directory = root.path.join("pty");
    ensure_private_directory(&directory).unwrap();
    drop(UnixListener::bind(socket_path(&directory, "pty_old")).unwrap());
    assert!(socket_path(&directory, "pty_old").exists());
    let supervisor =
        Supervisor::start(launch(&directory, "pty_old", &["sh", "-c", "exit 0"])).unwrap();
    run_until_closed(&directory, "pty_old", supervisor);
    assert!(!socket_path(&directory, "pty_old").exists());
}

#[test]
fn starting_a_different_member_reclaims_unlocked_neighbours_and_preserves_live_or_unknown_ones() {
    let member = Member::start(&["sh", "-c", "read l; echo got:$l"]);
    let directory = &member.directory;
    // Model the files and kernel-released flock of a killed supervisor. The
    // process-level kill test separately verifies this exact crash transition.
    let dead = "pty_dead";
    drop(crate::file_lock::exclusive(&lock_path(directory, dead)).unwrap());
    drop(UnixListener::bind(socket_path(directory, dead)).unwrap());

    // Unknown locks and a socket that cannot be removed must be left alone.
    std::os::unix::fs::symlink(
        lock_path(directory, &member.id),
        lock_path(directory, "pty_unknown"),
    )
    .unwrap();
    drop(UnixListener::bind(socket_path(directory, "pty_unknown")).unwrap());
    drop(crate::file_lock::exclusive(&lock_path(directory, "pty_unremovable")).unwrap());
    fs::create_dir(socket_path(directory, "pty_unremovable")).unwrap();

    let supervisor = Supervisor::start(launch(directory, "pty_new", &["sh", "-c", "exit 0"]))
        .expect("unknown neighbours must not fail the new start");
    run_until_closed(directory, "pty_new", supervisor);
    for extension in ["sock", "lock"] {
        assert!(!directory.join(format!("{dead}.{extension}")).exists());
        for id in [&member.id, "pty_unknown", "pty_unremovable"] {
            assert!(directory.join(format!("{id}.{extension}")).exists());
        }
    }
    let mut client = member.connect();
    client.input(b"still-live\r").unwrap();
    collect(&mut client, says("got:still-live"));
    member.finish().unwrap();
}

#[test]
fn an_unlocked_neighbour_without_a_socket_is_left_alone() {
    let root = TestDirectory::new();
    let directory = root.path.join("pty");
    ensure_private_directory(&directory).unwrap();
    let starting = "pty_starting";
    // exclusive opens the file before taking its flock. A concurrent starter
    // must not acquire or unlink that lock before this member has bound a socket.
    drop(crate::file_lock::exclusive(&lock_path(&directory, starting)).unwrap());
    let supervisor =
        Supervisor::start(launch(&directory, "pty_new", &["sh", "-c", "exit 0"])).unwrap();
    run_until_closed(&directory, "pty_new", supervisor);
    assert!(lock_path(&directory, starting).exists());
    assert!(!socket_path(&directory, starting).exists());
}

#[test]
fn startup_reclamation_stops_after_64_directory_entries() {
    let root = TestDirectory::new();
    let directory = root.path.join("pty");
    ensure_private_directory(&directory).unwrap();
    // First prove that a reclaimable pair is actually removed; directory entry
    // order is unspecified, so the larger bounded scan need not reach a lock.
    fs::write(lock_path(&directory, "pty_control"), "").unwrap();
    drop(UnixListener::bind(socket_path(&directory, "pty_control")).unwrap());
    let error = Supervisor::start(launch(
        &directory,
        "pty_control_start",
        &["/nonexistent/program"],
    ))
    .err()
    .unwrap();
    assert_eq!(error.kind(), io::ErrorKind::NotFound);
    assert!(!lock_path(&directory, "pty_control").exists());
    assert!(!socket_path(&directory, "pty_control").exists());

    for index in 0..80 {
        let id = format!("pty_dead{index}");
        fs::write(lock_path(&directory, &id), "").unwrap();
        drop(UnixListener::bind(socket_path(&directory, &id)).unwrap());
    }
    let error = Supervisor::start(launch(&directory, "pty_new", &["/nonexistent/program"]))
        .err()
        .unwrap();
    assert_eq!(error.kind(), io::ErrorKind::NotFound);
    let remaining = fs::read_dir(&directory)
        .unwrap()
        .filter(|entry| {
            entry
                .as_ref()
                .unwrap()
                .path()
                .extension()
                .is_some_and(|ext| ext == "lock")
        })
        .count();
    assert!(
        (16..=80).contains(&remaining),
        "a start must inspect no more than 64 entries: {remaining} locks remain"
    );
}

#[test]
fn a_start_that_cannot_proceed_leaves_nothing_behind() {
    let root = TestDirectory::new();

    // A directory other users can enter.
    let open = root.path.join("open");
    fs::create_dir(&open).unwrap();
    fs::set_permissions(&open, fs::Permissions::from_mode(0o755)).unwrap();
    let error = Supervisor::start(launch(&open, "pty_a", &["sh"]))
        .err()
        .unwrap();
    assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
    assert_eq!(fs::read_dir(&open).unwrap().count(), 0);

    // A program that does not exist.
    let private = root.path.join("private");
    let error = Supervisor::start(launch(&private, "pty_b", &["/nonexistent/program"]))
        .err()
        .unwrap();
    assert_eq!(error.kind(), io::ErrorKind::NotFound);
    assert_eq!(fs::read_dir(&private).unwrap().count(), 0);

    // Nothing to run, a bad id and a path too long for a socket.
    for (id, program, directory) in [
        ("pty_c", Vec::new(), private.clone()),
        ("../escape", vec!["sh"], private.clone()),
        ("", vec!["sh"], private.clone()),
        ("pty_d", vec!["sh"], private.join("x".repeat(100))),
    ] {
        let error = Supervisor::start(launch(&directory, id, &program))
            .err()
            .unwrap();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput, "{id:?}");
    }
    assert_eq!(fs::read_dir(&private).unwrap().count(), 0);
}

#[test]
fn host_controls_pin_the_pane_marker_and_keep_only_the_visible_screen() {
    use tmt_pty_protocol::{Control, ControlReply};
    let member = Member::start(&[
        "sh",
        "-c",
        r"printf '\033[2J\033[Hscreen-ready'; read line; printf '\033[2J\033[Hfresh-screen'; read line",
    ]);
    let mut client = member.connect();
    assert_eq!(
        client.control(Control::Capabilities, WAIT).unwrap(),
        ControlReply::Capabilities {
            resume: true,
            relaunch: true,
            close: true,
            terminal: false,
        }
    );
    let deadline = Instant::now() + WAIT;
    loop {
        if let ControlReply::Screen(screen) = client.control(Control::Capture, WAIT).unwrap()
            && screen.contains("screen-ready")
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "program never painted its screen"
        );
        std::thread::yield_now();
    }
    assert_eq!(
        client
            .control(
                Control::PublishIf {
                    pane_pid: member.pid + 1,
                    key: "first".into(),
                    expected_key: None,
                    marker: "bad".into()
                },
                WAIT
            )
            .unwrap(),
        ControlReply::Applied(false)
    );
    assert_eq!(
        client
            .control(
                Control::PublishIf {
                    pane_pid: member.pid,
                    key: "first".into(),
                    expected_key: None,
                    marker: "correct".into()
                },
                WAIT
            )
            .unwrap(),
        ControlReply::Applied(true)
    );
    // A delayed publisher must not replace a different live binding.
    assert_eq!(
        client
            .control(
                Control::PublishIf {
                    pane_pid: member.pid,
                    key: "stale".into(),
                    expected_key: None,
                    marker: "stale marker".into(),
                },
                WAIT,
            )
            .unwrap(),
        ControlReply::Applied(false)
    );
    assert_eq!(
        client
            .control(
                Control::Clear {
                    key: "other".into()
                },
                WAIT
            )
            .unwrap(),
        ControlReply::Applied(false)
    );
    let ControlReply::State {
        pane_pid,
        marker,
        key_idle_ms,
        ..
    } = client.control(Control::Inspect, WAIT).unwrap()
    else {
        panic!("missing state")
    };
    assert_eq!(pane_pid, member.pid);
    assert_eq!(marker.as_deref(), Some("correct"));
    assert_eq!(key_idle_ms, None);
    assert_eq!(
        client
            .control(
                Control::PublishIf {
                    pane_pid: member.pid,
                    key: "successor".into(),
                    expected_key: Some("first".into()),
                    marker: "successor marker".into(),
                },
                WAIT
            )
            .unwrap(),
        ControlReply::Applied(true)
    );
    assert_eq!(
        client
            .control(
                Control::PublishIf {
                    pane_pid: member.pid,
                    key: "stale".into(),
                    expected_key: Some("first".into()),
                    marker: "stale marker".into(),
                },
                WAIT
            )
            .unwrap(),
        ControlReply::Applied(false)
    );
    let ControlReply::State { marker, .. } = client.control(Control::Inspect, WAIT).unwrap() else {
        panic!("missing state")
    };
    assert_eq!(marker.as_deref(), Some("successor marker"));
    client.control(Control::Enter, WAIT).unwrap();
    loop {
        if let ControlReply::Screen(screen) = client.control(Control::Capture, WAIT).unwrap()
            && screen.contains("fresh-screen")
        {
            assert!(!screen.contains("screen-ready"));
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::yield_now();
    }
    assert_eq!(client.size(), size(80, 24));
    client
        .control(
            Control::Clear {
                key: "successor".into(),
            },
            WAIT,
        )
        .unwrap();
    client.input(b"\r").unwrap();
    drop(client);
    member.finish().unwrap();
}

#[test]
fn delivery_wraps_paste_only_in_the_program_mode_and_never_counts_as_typing() {
    use tmt_pty_protocol::{Control, ControlReply};
    for (mode, expected) in [
        ("", "61 62"),
        (r"\033[?2004h", "1b 5b 32 30 30 7e 61 62 1b 5b 32 30 31 7e"),
    ] {
        let script = format!(
            "stty -echo; printf '{mode}ready'; IFS= read -r line; printf '%s' \"$line\" | od -An -tx1; IFS= read -r line"
        );
        let member = Member::start(&["sh", "-c", &script]);
        let mut client = member.connect();
        let deadline = Instant::now() + WAIT;
        loop {
            if let ControlReply::Screen(text) = client.control(Control::Capture, WAIT).unwrap()
                && text.contains("ready")
            {
                break;
            }
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
        assert_eq!(
            client
                .control(Control::Paste(b"ab".to_vec()), WAIT)
                .unwrap(),
            ControlReply::Applied(true)
        );
        client.control(Control::Enter, WAIT).unwrap();
        loop {
            let ControlReply::Screen(text) = client.control(Control::Capture, WAIT).unwrap() else {
                panic!("capture refused")
            };
            if text
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .contains(expected)
            {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "expected {expected}; screen={text:?}"
            );
            std::thread::yield_now();
        }
        assert!(matches!(
            client.control(Control::Inspect, WAIT).unwrap(),
            ControlReply::State {
                key_idle_ms: None,
                ..
            }
        ));
        client.input(b"key").unwrap();
        assert!(matches!(
            client.control(Control::Inspect, WAIT).unwrap(),
            ControlReply::State {
                key_idle_ms: Some(_),
                ..
            }
        ));
        client.input(b"\r").unwrap();
        drop(client);
        member.finish().unwrap();
    }
}

#[test]
fn a_paste_end_marker_in_the_message_stays_inside_the_one_bracketed_paste() {
    use tmt_pty_protocol::{Control, ControlReply};
    // 6 (start) + 1 + 3 (U+241B) + 5 + 1 + 6 (end) bytes of paste, then the Enter.
    // The program stays alive after printing what it read (`read` holds it until the test
    // ends), so the capture never races its exit and the screen still proves the bytes.
    let script = r"stty raw -echo; printf '\033[?2004hready'; dd bs=1 count=23 2>/dev/null | od -An -tx1; read hold";
    let member = Member::start(&["sh", "-c", script]);
    let mut client = member.connect();
    let deadline = Instant::now() + WAIT;
    loop {
        if let ControlReply::Screen(text) = client.control(Control::Capture, WAIT).unwrap()
            && text.contains("ready")
        {
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::yield_now();
    }
    // What every host receives: the message after Core's pane input policy.
    let message = tmt_core::driver::pane_input_text("a\x1b[201~b");
    assert_eq!(
        client
            .control(Control::Paste(message.into_bytes()), WAIT)
            .unwrap(),
        ControlReply::Applied(true)
    );
    client.control(Control::Enter, WAIT).unwrap();
    let expected = "1b 5b 32 30 30 7e 61 e2 90 9b 5b 32 30 31 7e 62 1b 5b 32 30 31 7e 0d";
    loop {
        let ControlReply::Screen(text) = client.control(Control::Capture, WAIT).unwrap() else {
            panic!("capture refused")
        };
        let seen = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if seen.contains(expected) {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "expected {expected}; screen={seen:?}"
        );
        std::thread::yield_now();
    }
    // Release the program and let the supervisor end with it (raw mode: a newline, not Enter).
    client.input(b"\n").unwrap();
    drop(client);
    member.finish().unwrap();
}

#[test]
fn launch_preparation_waits_for_a_listener_and_readiness_carries_the_committed_marker() {
    use tmt_pty_protocol::{Control, ControlReply};
    let member = Member::start(&["sh", "-c", "read line"]);
    let mut wrapper = member.connect();
    wrapper
        .send(&ClientMessage::Control(Control::WaitLauncher))
        .unwrap();
    assert_eq!(wrapper.receive(Duration::from_millis(10)).unwrap(), None);
    let mut launcher = member.connect();
    launcher
        .send(&ClientMessage::Control(Control::AwaitLaunch))
        .unwrap();
    assert_eq!(
        wrapper.receive(WAIT).unwrap(),
        Some(ServerMessage::Control(ControlReply::Applied(true)))
    );
    assert_eq!(
        wrapper
            .control(
                Control::LaunchReady {
                    pane_pid: member.pid + 1
                },
                WAIT
            )
            .unwrap(),
        ControlReply::Applied(false)
    );
    assert_eq!(launcher.receive(Duration::from_millis(10)).unwrap(), None);
    wrapper
        .control(
            Control::PublishIf {
                pane_pid: member.pid,
                key: "binding".into(),
                expected_key: None,
                marker: "committed-marker".into(),
            },
            WAIT,
        )
        .unwrap();
    assert_eq!(
        wrapper
            .control(
                Control::LaunchReady {
                    pane_pid: member.pid
                },
                WAIT
            )
            .unwrap(),
        ControlReply::Applied(true)
    );
    assert_eq!(
        launcher.receive(WAIT).unwrap(),
        Some(ServerMessage::Control(ControlReply::Launched(
            "committed-marker".into()
        )))
    );
    wrapper.input(b"\r").unwrap();
    drop(wrapper);
    drop(launcher);
    member.finish().unwrap();
}

#[test]
fn startup_exit_keeps_a_bounded_terminal_tail_without_rendering_control_bytes() {
    let member = Member::start(&[
        "/bin/sh",
        "-c",
        "IFS= read -r release; i=0; while [ \"$i\" -lt 300 ]; do printf 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; i=$((i+1)); done; printf '\\033[2Jfixture-startup-reason\\n' >&2; exit 31",
    ]);
    let mut client = member.connect();
    client.input(b"release\r").unwrap();
    match client.await_launch(WAIT).unwrap() {
        super::LaunchOutcome::Exited { status, output } => {
            assert_eq!(status, Exit::Code(31));
            assert!(output.contains("fixture-startup-reason"), "{output}");
            assert!(!output.contains('\u{1b}'));
            assert!(output.len() <= 8192, "{}", output.len());
        }
        other => panic!("unexpected startup result: {other:?}"),
    }
    drop(client);
    member.finish().unwrap();
}

/// The `paused` flag of a fresh Inspect.
fn paused(member: &Member) -> bool {
    use tmt_pty_protocol::{Control, ControlReply};
    match member.connect().control(Control::Inspect, WAIT).unwrap() {
        ControlReply::State { paused, .. } => paused,
        other => panic!("not a state: {other:?}"),
    }
}

/// Waits, within the supervisor's tick, until Inspect reports `expected`.
fn wait_paused(member: &Member, expected: bool) {
    let deadline = Instant::now() + WAIT;
    while paused(member) != expected {
        assert!(Instant::now() < deadline, "paused never became {expected}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn resume(member: &Member) -> tmt_pty_protocol::ControlReply {
    member
        .connect()
        .control(tmt_pty_protocol::Control::Resume, WAIT)
        .unwrap()
}

/// The launcher leads an orphaned process group (its parent, the supervisor, is in
/// another session), so the kernel discards SIGTSTP sent to it; SIGSTOP stands in
/// for a job-control stop of the launcher's own group.
fn stop_launcher_group(member: &Member) {
    nix::sys::signal::killpg(Pid::from_raw(member.pid as i32), Signal::SIGSTOP).unwrap();
}

/// Echoes each line back. It prints nothing first: output written before a test
/// client attaches is not replayed, so tests type a line and wait for its echo.
const ECHO_LOOP: &str = r#"while IFS= read -r line; do printf 'got:%s\r\n' "$line"; done"#;

/// Waits until the member reads input, by typing a line and seeing it echoed.
fn ready(client: &mut Connection) {
    client.input(b"ready\r").unwrap();
    collect(client, says("got:ready"));
}

#[test]
fn a_job_control_stop_is_reported_until_the_member_continues() {
    let member = Member::start(&["sh", "-c", ECHO_LOOP]);
    let mut client = member.connect();
    ready(&mut client);
    assert!(!paused(&member), "a running member is not paused");
    stop_launcher_group(&member);
    wait_paused(&member, true);
    // A continue from outside the supervisor (a shell's `fg`, `kill -CONT`) clears it.
    nix::sys::signal::killpg(Pid::from_raw(member.pid as i32), Signal::SIGCONT).unwrap();
    wait_paused(&member, false);
    client.input(b"after\r").unwrap();
    collect(&mut client, says("got:after"));
    client.input(&[4]).unwrap();
    drop(client);
    member.finish().unwrap();
}

#[test]
fn resume_continues_a_paused_member_and_repeating_it_changes_nothing() {
    use tmt_pty_protocol::ControlReply;
    let member = Member::start(&["sh", "-c", ECHO_LOOP]);
    let mut client = member.connect();
    ready(&mut client);
    // Resuming a member that is not paused is applied and leaves it running.
    assert_eq!(resume(&member), ControlReply::Applied(true));
    stop_launcher_group(&member);
    wait_paused(&member, true);
    // Typed while stopped: the program reads it only once it continues.
    client.input(b"queued\r").unwrap();
    assert_eq!(resume(&member), ControlReply::Applied(true));
    wait_paused(&member, false);
    collect(&mut client, says("got:queued"));
    assert_eq!(resume(&member), ControlReply::Applied(true));
    assert!(!paused(&member));
    client.input(b"again\r").unwrap();
    collect(&mut client, says("got:again"));
    client.input(&[4]).unwrap();
    drop(client);
    member.finish().unwrap();
}

#[test]
fn a_member_that_ends_while_paused_still_reports_its_exit() {
    let member = Member::start(&["sh", "-c", ECHO_LOOP]);
    let mut client = member.connect();
    ready(&mut client);
    stop_launcher_group(&member);
    wait_paused(&member, true);
    kill(Pid::from_raw(member.pid as i32), Signal::SIGKILL).unwrap();
    collect(&mut client, exited(Exit::Signal(9)));
    drop(client);
    member.finish().unwrap();
}

/// A provider in its own process group that holds the terminal: Ctrl-Z typed into
/// the terminal stops only that group, the launcher keeps running, and the
/// supervisor still reports the member paused through the foreground group.
#[test]
fn a_stopped_foreground_group_of_its_own_is_paused_while_the_launcher_runs() {
    use tmt_pty_protocol::ControlReply;
    let member = Member::start(&["perl", "-MPOSIX", "-e", OWN_GROUP_LAUNCHER, ECHO_LOOP]);
    let mut client = member.connect();
    ready(&mut client);
    assert!(!paused(&member));
    // Ctrl-Z as a person types it: the terminal signals its foreground group.
    client.input(&[0x1a]).unwrap();
    wait_paused(&member, true);
    assert!(
        !crate::process::job_stopped(u64::from(member.pid), Instant::now() + WAIT),
        "only the provider's group stopped"
    );
    client.input(b"queued\r").unwrap();
    assert_eq!(resume(&member), ControlReply::Applied(true));
    wait_paused(&member, false);
    collect(&mut client, says("got:queued"));
    client.input(&[4]).unwrap();
    drop(client);
    member.finish().unwrap();
}

/// Runs `$ARGV[0]` with `sh -c` in a new process group that takes the terminal,
/// then waits for it without reclaiming the terminal, as a launcher that is not a
/// job-control shell does. SIGTTOU is ignored so the child may take the terminal
/// from the background; it never reads before it holds it.
pub(super) const OWN_GROUP_LAUNCHER: &str = r#"$SIG{TTOU} = "IGNORE";
my $script = $ARGV[0];
my $pid = fork() // die "fork: $!";
if ($pid == 0) {
    setpgid(0, 0) or die "setpgid: $!";
    tcsetpgrp(0, getpgrp()) or die "tcsetpgrp: $!";
    exec("/bin/sh", "-c", $script) or die "exec: $!";
}
waitpid($pid, 0);
exit(WIFEXITED($?) ? WEXITSTATUS($?) : 128 + WTERMSIG($?));"#;

fn control(member: &Member, request: tmt_pty_protocol::Control) -> tmt_pty_protocol::ControlReply {
    member.connect().control(request, WAIT).unwrap()
}

fn relaunch_echo(kind: tmt_pty_protocol::RelaunchKind) -> tmt_pty_protocol::Control {
    tmt_pty_protocol::Control::Relaunch {
        kind,
        program: ["sh", "-c", ECHO_LOOP].map(str::to_owned).to_vec(),
    }
}

#[test]
fn the_terminal_is_kept_after_the_program_ends_and_reports_how_it_ended() {
    use tmt_pty_protocol::{Control, ControlReply};
    let member = Member::start(&["sh", "-c", "read l; echo got:$l; exit 3"]);
    let mut client = member.connect();
    client.input(b"first\r").unwrap();
    collect(&mut client, exited(Exit::Code(3)));
    // Existing viewers got Exited and keep their connection; new ones attach.
    let socket = socket_path(&member.directory, &member.id);
    assert_eq!(wait_ended(&member.directory, &member.id), Exit::Code(3));
    assert!(socket.exists() && lock_path(&member.directory, &member.id).exists());
    let ControlReply::State {
        pane_pid,
        ended,
        shell,
        ..
    } = control(&member, Control::Inspect)
    else {
        panic!("not a state");
    };
    assert_eq!(
        (pane_pid, ended, shell),
        (member.pid, Some(Exit::Code(3)), false)
    );
    // The screen is kept, and nothing types into a terminal that runs nothing.
    let ControlReply::Screen(screen) = control(&member, Control::Capture) else {
        panic!("no screen");
    };
    assert!(screen.contains("got:first"), "{screen}");
    assert_eq!(
        control(&member, Control::Paste(b"lost".to_vec())),
        ControlReply::Error("the program has ended".into())
    );
    // Closing a terminal that runs nothing ends the supervisor at once.
    close(&member.directory, &member.id);
    let directory = member.directory.clone();
    let mut member = member;
    join(member.thread.take().unwrap()).unwrap();
    assert!(!socket.exists());
    assert!(!lock_path(&directory, "pty_test").exists());
}

#[test]
fn every_relaunch_kind_starts_a_program_on_the_kept_terminal() {
    use tmt_pty_protocol::{Control, ControlReply, RelaunchKind};
    for kind in [RelaunchKind::Resume, RelaunchKind::New, RelaunchKind::Shell] {
        let member = Member::start(&["sh", "-c", "read l; echo first:$l"]);
        let mut client = member.connect();
        client.input(b"one\r").unwrap();
        collect(&mut client, exited(Exit::Code(0)));
        assert_eq!(
            control(
                &member,
                Control::PublishIf {
                    pane_pid: member.pid,
                    key: "binding".into(),
                    expected_key: None,
                    marker: "ended-marker".into(),
                }
            ),
            ControlReply::Applied(true)
        );
        // Typed while nothing runs: it must not reach the relaunched program.
        client.input(b"lost\r").unwrap();
        assert_eq!(
            client.control(relaunch_echo(kind), WAIT).unwrap(),
            ControlReply::Applied(true)
        );
        client.input(b"ready\r").unwrap();
        let seen = collect(&mut client, says("got:ready"));
        assert!(!seen.text.contains("got:lost"), "{kind:?}: {}", seen.text);
        let ControlReply::State {
            pane_pid,
            ended,
            shell,
            marker,
            ..
        } = control(&member, Control::Inspect)
        else {
            panic!("not a state");
        };
        assert_eq!(ended, None, "{kind:?}");
        if kind == RelaunchKind::Shell {
            // The shell is not the member's agent: the binding's process and marker stay.
            assert!(shell);
            assert_eq!(pane_pid, member.pid);
            assert_eq!(marker.as_deref(), Some("ended-marker"));
        } else {
            assert!(!shell);
            assert_ne!(pane_pid, member.pid);
            assert_eq!(
                marker, None,
                "{kind:?}: the old marker belonged to the ended program"
            );
        }
        let ControlReply::Screen(screen) = control(&member, Control::Capture) else {
            panic!("no screen");
        };
        assert!(
            screen.contains("first:one") && screen.contains("got:ready"),
            "{screen}"
        );
        client.input(&[4]).unwrap();
        collect(&mut client, exited(Exit::Code(0)));
        drop(client);
        member.finish().unwrap();
    }
}

#[test]
fn a_relaunch_is_refused_while_a_program_or_a_shell_runs() {
    use tmt_pty_protocol::{Control, ControlReply, RelaunchKind};
    let member = Member::start(&["sh", "-c", ECHO_LOOP]);
    let mut client = member.connect();
    ready(&mut client);
    assert_eq!(
        control(&member, relaunch_echo(RelaunchKind::Resume)),
        ControlReply::Error("the program is still running; exit it first".into())
    );
    client.input(b"alive\r").unwrap();
    collect(&mut client, says("got:alive"));
    client.input(&[4]).unwrap();
    collect(&mut client, exited(Exit::Code(0)));
    assert_eq!(
        client
            .control(relaunch_echo(RelaunchKind::Shell), WAIT)
            .unwrap(),
        ControlReply::Applied(true)
    );
    ready(&mut client);
    for kind in [RelaunchKind::Resume, RelaunchKind::New, RelaunchKind::Shell] {
        assert_eq!(
            control(&member, relaunch_echo(kind)),
            ControlReply::Error("the shell is still running; exit it first".into())
        );
    }
    // A program that cannot start is refused and leaves the terminal kept.
    client.input(&[4]).unwrap();
    collect(&mut client, exited(Exit::Code(0)));
    let ControlReply::Error(reason) = control(
        &member,
        Control::Relaunch {
            kind: RelaunchKind::New,
            program: vec!["/nonexistent/program".into()],
        },
    ) else {
        panic!("a missing program must be refused");
    };
    assert!(
        reason.starts_with("the program could not start"),
        "{reason}"
    );
    assert_eq!(wait_ended(&member.directory, &member.id), Exit::Code(0));
    drop(client);
    member.finish().unwrap();
}

#[test]
fn close_hangs_up_a_running_program_and_removes_the_files() {
    use tmt_pty_protocol::{Control, ControlReply};
    let member = Member::start(&["sh", "-c", ECHO_LOOP]);
    let mut client = member.connect();
    ready(&mut client);
    assert_eq!(
        control(&member, Control::Close),
        ControlReply::Applied(true)
    );
    // The program ends as a closing terminal ends it, and the viewer is told.
    collect(&mut client, exited(Exit::Signal(Signal::SIGHUP as i32)));
    drop(client);
    let directory = member.directory.clone();
    let mut member = member;
    join(member.thread.take().unwrap()).unwrap();
    assert!(!socket_path(&directory, "pty_test").exists());
    assert!(!lock_path(&directory, "pty_test").exists());
    assert!(
        nix::sys::signal::kill(Pid::from_raw(member.pid as i32), None).is_err(),
        "the program was reaped"
    );
}

#[test]
fn a_relaunched_launcher_that_never_binds_leaves_the_member_as_it_was() {
    use tmt_pty_protocol::{Control, ControlReply, RelaunchKind};
    let member = Member::start(&["sh", "-c", "read l; echo first:$l"]);
    let mut client = member.connect();
    client.input(b"one\r").unwrap();
    collect(&mut client, exited(Exit::Code(0)));
    let publish = |pane_pid| Control::PublishIf {
        pane_pid,
        key: "binding".into(),
        expected_key: None,
        marker: "kept-marker".into(),
    };
    assert_eq!(
        control(&member, publish(member.pid)),
        ControlReply::Applied(true)
    );
    // A refused resume: the launcher prints its reason and ends without publishing.
    let refusal = Control::Relaunch {
        kind: RelaunchKind::Resume,
        program: ["sh", "-c", "read l; echo refused:$l; exit 1"]
            .map(str::to_owned)
            .to_vec(),
    };
    assert_eq!(
        client.control(refusal, WAIT).unwrap(),
        ControlReply::Applied(true)
    );
    assert!(relaunching(&member), "the launcher has not published yet");
    client.input(b"two\r").unwrap();
    collect(&mut client, exited(Exit::Code(1)));
    let ControlReply::State {
        pane_pid,
        marker,
        ended,
        relaunching,
        ..
    } = control(&member, Control::Inspect)
    else {
        panic!("not a state");
    };
    // Relaunching ends with the launcher, and the member reads as before: ended, kept.
    assert_eq!(
        (pane_pid, marker.as_deref(), ended, relaunching),
        (member.pid, Some("kept-marker"), Some(Exit::Code(1)), false)
    );
    drop(client);
    member.finish().unwrap();
}

fn relaunching(member: &Member) -> bool {
    matches!(
        control(member, tmt_pty_protocol::Control::Inspect),
        tmt_pty_protocol::ControlReply::State {
            relaunching: true,
            ..
        }
    )
}

#[test]
fn a_relaunched_launcher_that_misses_its_admission_is_hung_up_and_the_member_restored() {
    use tmt_pty_protocol::{Control, ControlReply, RelaunchKind};
    let member = Member::start_with(&["sh", "-c", "read l; echo first:$l"], |supervisor| {
        supervisor.with_admission(Duration::from_millis(500))
    });
    let mut client = member.connect();
    client.input(b"one\r").unwrap();
    collect(&mut client, exited(Exit::Code(0)));
    assert_eq!(
        control(
            &member,
            Control::PublishIf {
                pane_pid: member.pid,
                key: "binding".into(),
                expected_key: None,
                marker: "kept-marker".into(),
            }
        ),
        ControlReply::Applied(true)
    );
    // A launcher that hangs before it binds, and ignores the hang-up: it is killed.
    let hung = Control::Relaunch {
        kind: RelaunchKind::Resume,
        program: [
            "sh",
            "-c",
            "trap '' HUP; echo hung; while :; do sleep 1; done",
        ]
        .map(str::to_owned)
        .to_vec(),
    };
    assert_eq!(
        client.control(hung, WAIT).unwrap(),
        ControlReply::Applied(true)
    );
    assert!(relaunching(&member));
    collect(&mut client, exited(Exit::Signal(Signal::SIGKILL as i32)));
    let ControlReply::State {
        pane_pid,
        marker,
        ended,
        relaunching,
        ..
    } = control(&member, Control::Inspect)
    else {
        panic!("not a state");
    };
    assert_eq!(
        (pane_pid, marker.as_deref(), ended, relaunching),
        (
            member.pid,
            Some("kept-marker"),
            Some(Exit::Signal(Signal::SIGKILL as i32)),
            false
        )
    );
    drop(client);
    member.finish().unwrap();
}

/// One of a member's extra terminals (#5991) on a thread of the test; `alive` stands in
/// for its member supervisor.
fn start_terminal(
    program: &[&str],
    alive: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Member {
    let root = TestDirectory::new();
    let directory = root.path.join("pty");
    let mut launch = launch(&directory, "term_test", program);
    launch.terminal = Some(super::TerminalOf {
        owner: "11111111-1111-4111-8111-111111111111".into(),
        created_ms: 1_762_300_000_000,
        member_alive: Box::new(move || alive.load(std::sync::atomic::Ordering::SeqCst)),
    });
    let supervisor = Supervisor::start(launch).expect("start the terminal");
    let pid = supervisor.program_pid();
    Member {
        _root: root,
        directory,
        id: "term_test".to_owned(),
        pid,
        thread: Some(std::thread::spawn(move || supervisor.run())),
    }
}

fn alive() -> std::sync::Arc<std::sync::atomic::AtomicBool> {
    std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true))
}

fn terminal_reply(terminal: &Member) -> tmt_pty_protocol::ControlReply {
    terminal
        .connect()
        .control(tmt_pty_protocol::Control::Terminal, WAIT)
        .unwrap()
}

fn busy(terminal: &Member) -> bool {
    match terminal_reply(terminal) {
        tmt_pty_protocol::ControlReply::Terminal { busy, .. } => busy,
        other => panic!("not a terminal answer: {other:?}"),
    }
}

#[test]
fn an_extra_terminal_names_its_owner_and_says_when_a_program_holds_it() {
    use tmt_pty_protocol::{Control, ControlReply};
    let terminal = start_terminal(&["sh", "-i"], alive());
    assert_eq!(
        terminal
            .connect()
            .control(Control::Capabilities, WAIT)
            .unwrap(),
        ControlReply::Capabilities {
            resume: true,
            relaunch: false,
            close: true,
            terminal: true,
        }
    );
    assert!(matches!(
        terminal_reply(&terminal),
        ControlReply::Terminal { ref owner, created_ms: 1_762_300_000_000, busy: false }
            if owner == "11111111-1111-4111-8111-111111111111"
    ));
    let mut client = terminal.connect();
    client
        .control(Control::Paste(b"sleep 30".to_vec()), WAIT)
        .unwrap();
    client.control(Control::Enter, WAIT).unwrap();
    let deadline = Instant::now() + WAIT;
    while !busy(&terminal) {
        assert!(Instant::now() < deadline, "sleep never took the terminal");
        std::thread::sleep(Duration::from_millis(50));
    }
    // It has no binding and no kept terminal to relaunch on.
    for refused in [
        Control::Publish {
            pane_pid: terminal.pid,
            key: "k".into(),
            marker: "m".into(),
        },
        Control::Relaunch {
            kind: tmt_pty_protocol::RelaunchKind::Shell,
            program: vec!["sh".into()],
        },
    ] {
        assert!(matches!(
            terminal.connect().control(refused, WAIT).unwrap(),
            ControlReply::Error(_)
        ));
    }
    close(&terminal.directory, &terminal.id);
}

#[test]
fn a_member_supervisor_is_not_a_terminal() {
    let member = Member::start(&["sh", "-c", "sleep 30"]);
    assert!(matches!(
        member
            .connect()
            .control(tmt_pty_protocol::Control::Terminal, WAIT)
            .unwrap(),
        tmt_pty_protocol::ControlReply::Error(_)
    ));
}

#[test]
fn an_extra_terminal_ends_with_its_shell() {
    let mut terminal = start_terminal(&["sh", "-c", "exit 0"], alive());
    join(terminal.thread.take().unwrap()).unwrap();
    assert!(!socket_path(&terminal.directory, &terminal.id).exists());
}

#[test]
fn an_extra_terminal_ends_when_its_member_is_gone() {
    let member = alive();
    let mut terminal = start_terminal(&["sh", "-c", "sleep 30"], member.clone());
    member.store(false, std::sync::atomic::Ordering::SeqCst);
    join(terminal.thread.take().unwrap()).unwrap();
    assert!(!socket_path(&terminal.directory, &terminal.id).exists());
    assert!(
        kill(Pid::from_raw(terminal.pid as i32), None).is_err(),
        "its program was hung up"
    );
}
