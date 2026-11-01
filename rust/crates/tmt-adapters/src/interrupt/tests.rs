use super::Interrupt;
use crate::test_support::{TestChild, TestDirectory};
use nix::{
    sys::signal::{Signal, kill},
    unistd::Pid,
};
use std::{
    env, fs,
    os::unix::process::ExitStatusExt,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const FIXTURE_TEST: &str = "interrupt::tests::subprocess_fixture";
const FIXTURE_MODE: &str = "TMT_INTERRUPT_TEST_MODE";
const FIXTURE_READY: &str = "TMT_INTERRUPT_TEST_READY";
const FIXTURE_EVENT: &str = "TMT_INTERRUPT_TEST_EVENT";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(2);
const EXIT_TIMEOUT: Duration = Duration::from_secs(3);

struct Fixture {
    // Drop the child before the directory removes its readiness/event paths.
    child: TestChild,
    _directory: TestDirectory,
    ready: std::path::PathBuf,
    event: std::path::PathBuf,
}

impl Fixture {
    fn start(mode: &str) -> Self {
        let directory = TestDirectory::new();
        let ready = directory.path.join("ready");
        let event = directory.path.join("event");
        let executable = env::current_exe().expect("locate adapter test executable");
        let child = Command::new(executable)
            .args(["--exact", FIXTURE_TEST, "--nocapture", "--test-threads=1"])
            .env(FIXTURE_MODE, mode)
            .env(FIXTURE_READY, &ready)
            .env(FIXTURE_EVENT, &event)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn task-owned interrupt fixture");
        Self {
            _directory: directory,
            ready,
            event,
            child: TestChild::new(child),
        }
    }
}

fn fixture_pid(fixture: &Fixture) -> Pid {
    Pid::from_raw(i32::try_from(fixture.child.child.id()).expect("fixture PID fits in pid_t"))
}

fn event(fixture: &Fixture) -> String {
    fs::read_to_string(&fixture.event).expect("interrupt fixture wrote its event")
}

fn open_fd_count() -> usize {
    fs::read_dir("/dev/fd")
        .expect("the Unix test host exposes /dev/fd")
        .count()
}

#[test]
fn sigint_wakes_a_task_owned_wait() {
    let mut fixture = Fixture::start("wake");
    fixture
        .child
        .wait_for_content(&fixture.ready.clone(), "ready", STARTUP_TIMEOUT);
    kill(fixture_pid(&fixture), Signal::SIGINT).expect("send SIGINT to fixture child");

    let status = fixture.child.wait_for_exit(EXIT_TIMEOUT);
    assert!(status.success(), "fixture failed after SIGINT: {status}");
    assert_eq!(event(&fixture), "interrupted");
}

#[test]
fn second_sigint_uses_the_emergency_default() {
    let mut fixture = Fixture::start("second");
    fixture
        .child
        .wait_for_content(&fixture.ready.clone(), "ready", STARTUP_TIMEOUT);
    kill(fixture_pid(&fixture), Signal::SIGINT).expect("send first SIGINT to fixture child");
    fixture
        .child
        .wait_for_content(&fixture.event.clone(), "first-interrupted", STARTUP_TIMEOUT);
    assert_eq!(event(&fixture), "first-interrupted");

    kill(fixture_pid(&fixture), Signal::SIGINT).expect("send second SIGINT to fixture child");
    let status = fixture.child.wait_for_exit(EXIT_TIMEOUT);
    assert_eq!(
        status.signal(),
        Some(Signal::SIGINT as i32),
        "second SIGINT must terminate the fixture"
    );
}

#[test]
fn deadline_returns_without_a_signal() {
    let mut fixture = Fixture::start("deadline");
    fixture
        .child
        .wait_for_content(&fixture.ready.clone(), "ready", STARTUP_TIMEOUT);

    let status = fixture.child.wait_for_exit(EXIT_TIMEOUT);
    assert!(status.success(), "deadline fixture failed: {status}");
    assert_eq!(event(&fixture), "deadline-no-signal");
}

#[test]
fn guard_drop_releases_descriptors_and_allows_reinstallation() {
    let mut fixture = Fixture::start("drop");
    fixture
        .child
        .wait_for_content(&fixture.ready.clone(), "ready", STARTUP_TIMEOUT);

    let status = fixture.child.wait_for_exit(EXIT_TIMEOUT);
    assert!(status.success(), "drop fixture failed: {status}");
    assert_eq!(event(&fixture), "reinstalled");
}

#[test]
fn cancellable_children_keep_stream_bounds_input_and_post_eof_deadlines() {
    for mode in [
        "cancellable-streams",
        "cancellable-stdout",
        "cancellable-stderr",
        "cancellable-eof",
    ] {
        let mut fixture = Fixture::start(mode);
        let status = fixture.child.wait_for_exit(EXIT_TIMEOUT);
        assert!(status.success(), "{mode}: {status}");
        let pid: i32 = event(&fixture).trim().parse().unwrap();
        assert_eq!(
            nix::sys::signal::killpg(Pid::from_raw(pid), None),
            Err(nix::errno::Errno::ESRCH)
        );
    }
}

#[test]
fn subprocess_fixture() {
    let Some(mode) = env::var_os(FIXTURE_MODE) else {
        return;
    };
    let ready = env::var_os(FIXTURE_READY)
        .map(std::path::PathBuf::from)
        .expect("fixture ready path");
    let event = env::var_os(FIXTURE_EVENT)
        .map(std::path::PathBuf::from)
        .expect("fixture event path");
    let mode = mode.to_str().expect("fixture mode is UTF-8");
    let before_install = (mode == "drop").then(open_fd_count);
    let mut interrupt = if mode == "fanout-term" {
        Interrupt::install_termination()
    } else {
        Interrupt::install()
    }
    .expect("install interrupt fixture");
    fs::write(&ready, b"ready").expect("publish interrupt fixture readiness");

    match mode {
        "cancel" => {
            interrupt.defer_emergency_exit();
            interrupt.cancel().unwrap();
            interrupt.cancel().unwrap();
            assert!(interrupt.is_interrupted());
            assert_eq!(interrupt.take_notifications().unwrap(), 1);
            assert_eq!(interrupt.take_notifications().unwrap(), 1);
            interrupt.wait_until(Instant::now() + EXIT_TIMEOUT).unwrap();
            fs::write(&event, b"cancelled").unwrap();
        }
        "fanout" | "fanout-term" => {
            use crate::process::{
                CommandFailure, CommandRequest, CommandRunner, UnixCommandRunner,
            };
            use std::sync::mpsc;
            interrupt.defer_emergency_exit();
            let (sender, receiver) = mpsc::channel();
            let results = std::thread::scope(|scope| {
                let mut handles = Vec::new();
                for _ in 0..2 {
                    let sender = sender.clone();
                    let interrupt = &interrupt;
                    handles.push(scope.spawn(move || {
                        let mut observed = Vec::new();
                        let mut announced = false;
                        UnixCommandRunner.execute_cancellable(
                            CommandRequest {
                                program: env::current_exe().unwrap().as_os_str(),
                                args: &[
                                    "--exact".into(),
                                    "interrupt::tests::fanout_child_fixture".into(),
                                    "--nocapture".into(),
                                    "--test-threads=1".into(),
                                ],
                                input: &[],
                                deadline: Instant::now() + STARTUP_TIMEOUT,
                                max_output_bytes: 2048,
                            },
                            1024,
                            &mut |bytes| {
                                observed.extend_from_slice(bytes);
                                if !announced && observed.ends_with(b"\n") {
                                    for line in String::from_utf8_lossy(&observed).lines() {
                                        if let Some(pid) = line
                                            .strip_prefix("fanout-ready:")
                                            .and_then(|s| s.parse::<u32>().ok())
                                        {
                                            sender.send(pid).unwrap();
                                            announced = true;
                                            break;
                                        }
                                    }
                                }
                            },
                            interrupt,
                        )
                    }));
                }
                let pids = [
                    receiver.recv_timeout(STARTUP_TIMEOUT).unwrap(),
                    receiver.recv_timeout(STARTUP_TIMEOUT).unwrap(),
                ];
                fs::write(&event, b"both-ready").unwrap();
                let errors: Vec<_> = handles
                    .into_iter()
                    .map(|h| h.join().unwrap().unwrap_err())
                    .collect();
                fs::write(&event,serde_json::to_vec(&serde_json::json!({"pids":pids,"kinds":errors.iter().map(|e|format!("{:?}",e.kind)).collect::<Vec<_>>()})).unwrap()).unwrap();
                errors
            });
            assert!(
                results.iter().all(|e| !e.cleanup_failed()),
                "every owned child must be reaped even on the negative path"
            );
            assert!(
                results.iter().all(|e| matches!(
                    e.kind,
                    CommandFailure::Exit {
                        signal: Some(2),
                        ..
                    }
                )),
                "one SIGINT must reach both child owners"
            );
        }
        mode if mode.starts_with("cancellable-") => {
            use crate::process::{
                CommandFailure, CommandRequest, CommandRunner, UnixCommandRunner,
            };
            use std::ffi::OsStr;
            interrupt.defer_emergency_exit();
            let script = match mode {
                "cancellable-streams" => "echo $$ > \"$1\"; wc -c; printf progress >&2",
                "cancellable-stdout" => "echo $$ > \"$1\"; printf 123456789",
                "cancellable-stderr" => "echo $$ > \"$1\"; printf 123456789 >&2",
                "cancellable-eof" => "echo $$ > \"$1\"; exec 1>&- 2>&-; exec /bin/sleep 10",
                _ => unreachable!(),
            };
            let mut observed = Vec::new();
            let result = UnixCommandRunner.execute_cancellable(
                CommandRequest {
                    program: OsStr::new("/bin/sh"),
                    args: &[
                        "-c".into(),
                        script.into(),
                        "cancellable-fixture".into(),
                        event.into_os_string(),
                    ],
                    input: &vec![b'x'; 128 * 1024],
                    deadline: Instant::now() + Duration::from_millis(300),
                    max_output_bytes: if mode == "cancellable-streams" { 32 } else { 8 },
                },
                8,
                &mut |bytes| observed.extend_from_slice(bytes),
                &interrupt,
            );
            match mode {
                "cancellable-streams" => {
                    let output = result.unwrap();
                    assert_eq!(
                        std::str::from_utf8(&output.stdout).unwrap().trim(),
                        "131072"
                    );
                    assert_eq!(output.stderr, b"progress");
                    assert_eq!(observed, output.stderr);
                }
                _ => {
                    let error = result.unwrap_err();
                    assert_eq!(
                        error.kind,
                        if mode == "cancellable-eof" {
                            CommandFailure::Timeout
                        } else {
                            CommandFailure::OutputLimit
                        }
                    );
                    assert!(!error.cleanup_failed());
                    assert!(
                        error.output.is_none(),
                        "unconfirmed bytes must not become a report"
                    );
                }
            }
        }
        "wake" => {
            interrupt
                .wait_until(Instant::now() + Duration::from_secs(5))
                .expect("SIGINT wait should not fail");
            assert!(interrupt.is_interrupted());
            fs::write(event, b"interrupted").expect("publish interrupt event");
        }
        "second" => {
            interrupt
                .wait_until(Instant::now() + Duration::from_secs(5))
                .expect("first SIGINT wait should not fail");
            assert!(interrupt.is_interrupted());
            fs::write(event, b"first-interrupted").expect("publish first interrupt event");
            thread::sleep(Duration::from_secs(30));
        }
        "deadline" => {
            let deadline = Instant::now() + Duration::from_millis(200);
            interrupt
                .wait_until(deadline)
                .expect("deadline wait should not fail");
            assert!(
                Instant::now() >= deadline,
                "wait returned before its deadline"
            );
            assert!(!interrupt.is_interrupted());
            fs::write(event, b"deadline-no-signal").expect("publish deadline event");
        }
        "drop" => {
            let original_interrupted = interrupt.interrupted.clone();
            let with_guard = open_fd_count();
            assert!(
                with_guard > before_install.unwrap(),
                "interrupt guard descriptors are present"
            );
            drop(interrupt);
            assert_eq!(
                open_fd_count(),
                before_install.unwrap(),
                "guard drop closes every interrupt descriptor"
            );

            let replacement = Interrupt::install().expect("reinstall interrupt after drop");
            assert_eq!(
                open_fd_count(),
                with_guard,
                "reinstallation restores the interrupt descriptors"
            );
            kill(Pid::this(), Signal::SIGINT).expect("signal task-owned fixture process");
            replacement
                .wait_until(Instant::now() + Duration::from_secs(2))
                .expect("reinstalled interrupt should wake");
            assert!(replacement.is_interrupted());
            assert!(!original_interrupted.load(std::sync::atomic::Ordering::SeqCst));
            fs::write(event, b"reinstalled").expect("publish reinstall event");
        }
        _ => panic!("unknown interrupt fixture mode: {mode}"),
    }
}

fn fanout_signal(mode: &str, signal: Signal) {
    let mut fixture = Fixture::start(mode);
    fixture
        .child
        .wait_for_content(&fixture.event.clone(), "both-ready", STARTUP_TIMEOUT);
    kill(fixture_pid(&fixture), signal).unwrap();
    let status = fixture.child.wait_for_exit(STARTUP_TIMEOUT + EXIT_TIMEOUT);
    assert!(
        status.success(),
        "fan-out fixture failed: {status}; {}",
        event(&fixture)
    );
    let result: serde_json::Value = serde_json::from_str(&event(&fixture)).unwrap();
    for pid in result["pids"].as_array().unwrap() {
        assert_eq!(
            nix::sys::signal::killpg(Pid::from_raw(pid.as_i64().unwrap() as i32), None),
            Err(nix::errno::Errno::ESRCH)
        );
    }
}

#[test]
fn one_interrupt_reaches_both_invocation_owned_children() {
    fanout_signal("fanout", Signal::SIGINT);
}

#[test]
fn termination_reaches_both_invocation_owned_children() {
    fanout_signal("fanout-term", Signal::SIGTERM);
}

#[test]
fn programmatic_cancellation_is_shared_and_repeated_calls_are_not_repeat_signals() {
    let mut fixture = Fixture::start("cancel");
    assert!(fixture.child.wait_for_exit(EXIT_TIMEOUT).success());
    assert_eq!(event(&fixture), "cancelled");
}

#[test]
fn fanout_child_fixture() {
    if !env::var(FIXTURE_MODE).is_ok_and(|mode| mode.starts_with("fanout")) {
        return;
    }
    use std::io::Read;
    let (mut reader, _writer) = std::os::unix::net::UnixStream::pair().unwrap();
    eprintln!("fanout-ready:{}", std::process::id());
    reader.read_exact(&mut [0]).unwrap();
}
