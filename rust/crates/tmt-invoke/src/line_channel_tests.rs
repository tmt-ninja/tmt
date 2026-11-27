use super::*;
use crate::{
    Cleanup,
    tests::{Fixture, START_BUDGET, gone, ready},
};
use std::{
    fs,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

fn open(script: &str, limit: usize) -> (Fixture, LineChannel) {
    let fixture = Fixture::new(&format!("echo $$ > pid\n{script}"));
    let args = [fixture.program().into_os_string()];
    let channel = LineChannel::start(
        LineChannelOptions {
            program: Path::new("/bin/sh"),
            args: &args,
            deadline: Instant::now() + START_BUDGET,
            max_frame_bytes: limit,
            launch: Default::default(),
        },
        || false,
    )
    .unwrap();
    (fixture, channel)
}

fn exchange(channel: &mut LineChannel, payload: &[u8]) -> Result<Vec<u8>, InvokeError> {
    channel.exchange(payload, Instant::now() + START_BUDGET, || false)
}

#[test]
fn request_pipe_is_close_on_exec() {
    let (_fixture, channel) = open("cat", 64);
    let flags = fcntl(channel.stdin.as_ref().unwrap(), FcntlArg::F_GETFD).unwrap();
    assert!(FdFlag::from_bits_truncate(flags).contains(FdFlag::FD_CLOEXEC));
    assert!(
        channel
            .close(Instant::now() + START_BUDGET, || false)
            .unwrap()
            .status
            .success()
    );
}

#[test]
fn several_byte_frames_use_one_child_and_clean_eof_reaps_it() {
    let (fixture, mut channel) = open("printf diagnostic >&2; cat; printf done > eof", 64);
    assert_eq!(exchange(&mut channel, b"first").unwrap(), b"first");
    let pid = fs::read(fixture.0.join("pid")).unwrap();
    assert_eq!(
        exchange(&mut channel, b"\0second\xff").unwrap(),
        b"\0second\xff"
    );
    assert_eq!(fs::read(fixture.0.join("pid")).unwrap(), pid);
    let output = channel
        .close(Instant::now() + START_BUDGET, || false)
        .unwrap();
    assert!(output.status.success());
    assert!(output.stdout.is_empty());
    assert_eq!(output.stderr, b"diagnostic");
    assert_eq!(fs::read(fixture.0.join("eof")).unwrap(), b"done");
    gone(&fixture.0.join("pid"));
}

#[test]
fn local_frame_rejection_keeps_the_unmodified_channel_usable() {
    let (fixture, mut channel) = open("cat", 4);
    for input in [b"a\nb".as_slice(), b"12345"] {
        let error = exchange(&mut channel, input).unwrap_err();
        assert!(matches!(error.cleanup, Cleanup::NotStarted));
        assert_eq!(error.cause.unwrap().kind(), io::ErrorKind::InvalidInput);
    }
    assert_eq!(
        exchange(&mut channel, b"four").unwrap(),
        b"four",
        "delimiter is outside the byte limit"
    );
    assert!(
        channel
            .close(Instant::now() + START_BUDGET, || false)
            .unwrap()
            .status
            .success()
    );
    gone(&fixture.0.join("pid"));
}

#[test]
fn progress_requires_a_terminal_frame_and_refuses_trailing_output() {
    for (response, expected) in [
        ("progress\n", io::ErrorKind::UnexpectedEof),
        ("progress\nfinal\nextra\n", io::ErrorKind::InvalidData),
    ] {
        let (_fixture, mut channel) = open(
            &format!("IFS= read -r request; printf '%s' '{response}'"),
            64,
        );
        let mut progress = 0;
        let result = channel.exchange_lifeline_frames(
            b"run",
            Instant::now() + START_BUDGET,
            || false,
            |frame| {
                if frame == b"progress" {
                    progress += 1;
                    Ok(false)
                } else {
                    Ok(frame == b"final")
                }
            },
        );
        assert_eq!(progress, 1);
        assert_eq!(result.unwrap_err().cause.unwrap().kind(), expected);
        assert!(channel.pid().is_none());
    }
}

#[test]
fn a_late_frame_after_final_refuses_before_sending_the_next_request() {
    let (fixture, mut channel) = open(
        "IFS= read -r request; printf 'final\\n'; while [ ! -f release ]; do sleep 0.01; done; printf 'extra\\n'; printf ready > extra; cat > next",
        64,
    );
    let frame = channel
        .exchange_lifeline_frames(
            b"run",
            Instant::now() + START_BUDGET,
            || false,
            |frame| Ok(frame == b"final"),
        )
        .unwrap();
    assert_eq!(frame, b"final");
    fs::write(fixture.0.join("release"), b"").unwrap();
    ready(&fixture.0.join("extra"));
    assert_eq!(
        exchange(&mut channel, b"keep")
            .unwrap_err()
            .cause
            .unwrap()
            .kind(),
        io::ErrorKind::InvalidData,
    );
    assert!(
        fs::read(fixture.0.join("next"))
            .unwrap_or_default()
            .is_empty()
    );
    assert!(channel.pid().is_none());
}

#[test]
fn stopping_after_progress_drains_the_final_frame_and_reaps_the_child() {
    let (fixture, mut channel) = open(
        "IFS= read -r request; printf 'progress\\n'; IFS= read -r eof || printf 'final\\n'",
        64,
    );
    let stopped = AtomicBool::new(false);
    let frame = channel
        .exchange_lifeline_frames(
            b"run",
            Instant::now() + START_BUDGET,
            || stopped.load(Ordering::Relaxed),
            |frame| {
                if frame == b"progress" {
                    stopped.store(true, Ordering::Relaxed);
                    Ok(false)
                } else {
                    Ok(frame == b"final")
                }
            },
        )
        .unwrap();
    assert_eq!(frame, b"final");
    assert!(channel.pid().is_none());
    gone(&fixture.0.join("pid"));
}

#[test]
fn incomplete_response_closes_the_child_without_replaying_the_request() {
    let (fixture, mut channel) = open(
        "IFS= read -r line; printf '%s' \"$line\" > seen; printf partial; exit 7",
        64,
    );
    let error = exchange(&mut channel, b"effect").unwrap_err();
    assert!(matches!(error.kind, FailureKind::Io(Phase::Communicate)));
    assert_eq!(error.cause.unwrap().kind(), io::ErrorKind::UnexpectedEof);
    assert!(matches!(error.cleanup, Cleanup::Confirmed));
    let next = exchange(&mut channel, b"another").unwrap_err();
    assert_eq!(next.cause.unwrap().kind(), io::ErrorKind::BrokenPipe);
    assert!(matches!(next.cleanup, Cleanup::NotStarted));
    assert_eq!(fs::read(fixture.0.join("seen")).unwrap(), b"effect");
    gone(&fixture.0.join("pid"));
}

#[test]
fn both_output_streams_have_independent_bounds_and_confirmed_cleanup() {
    for (script, stream) in [
        ("IFS= read -r line; printf '12345\\n'", Stream::Stdout),
        (
            "IFS= read -r line; printf 12345 >&2; printf 'ok\\n'",
            Stream::Stderr,
        ),
    ] {
        let (fixture, mut channel) = open(script, 4);
        let error = exchange(&mut channel, b"go").unwrap_err();
        assert_eq!(error.kind, FailureKind::OutputLimit(stream));
        assert!(matches!(error.cleanup, Cleanup::Confirmed));
        gone(&fixture.0.join("pid"));
    }
}

#[test]
fn stderr_is_bounded_across_exchanges() {
    let (fixture, mut channel) = open(
        "while IFS= read -r line; do printf xxx >&2; printf '%s\\n' \"$line\"; done",
        4,
    );
    assert_eq!(exchange(&mut channel, b"one").unwrap(), b"one");
    let error = exchange(&mut channel, b"two").unwrap_err();
    assert_eq!(error.kind, FailureKind::OutputLimit(Stream::Stderr));
    assert!(matches!(error.cleanup, Cleanup::Confirmed));
    gone(&fixture.0.join("pid"));
}

#[test]
fn cancellation_after_request_admission_ends_the_channel() {
    let (fixture, mut channel) = open(
        "IFS= read -r line; printf '%s' \"$line\" > seen; echo ready > ready; cat > /dev/null",
        64,
    );
    let stop = AtomicBool::new(false);
    std::thread::scope(|scope| {
        scope.spawn(|| {
            ready(&fixture.0.join("ready"));
            stop.store(true, Ordering::Release);
        });
        let error = channel
            .exchange(b"effect", Instant::now() + START_BUDGET, || {
                stop.load(Ordering::Acquire)
            })
            .unwrap_err();
        assert_eq!(error.kind, FailureKind::Interrupted);
        assert!(matches!(error.cleanup, Cleanup::Confirmed));
    });
    assert_eq!(fs::read(fixture.0.join("seen")).unwrap(), b"effect");
    gone(&fixture.0.join("pid"));
}

#[test]
fn lifeline_cancellation_gives_child_a_graceful_cleanup() {
    let (fixture, mut channel) = open(
        "trap 'printf stopped > stopped; exit 0' TERM\nIFS= read -r line; echo ready > ready; while IFS= read -r line; do :; done; printf eof > eof",
        64,
    );
    let stop = AtomicBool::new(false);
    std::thread::scope(|scope| {
        scope.spawn(|| {
            ready(&fixture.0.join("ready"));
            stop.store(true, Ordering::Release);
        });
        let error = channel
            .exchange_lifeline(
                b"effect",
                Instant::now() + START_BUDGET,
                || stop.load(Ordering::Acquire),
                || {},
            )
            .unwrap_err();
        assert_eq!(error.kind, FailureKind::Interrupted);
        assert!(matches!(error.cleanup, Cleanup::Confirmed));
    });
    assert!(fixture.0.join("stopped").exists() || fixture.0.join("eof").exists());
    gone(&fixture.0.join("pid"));
}

#[test]
fn a_lifeline_drain_without_a_response_escalates_after_its_grace() {
    let (fixture, mut channel) = open(
        "trap '' INT TERM; IFS= read -r line; printf '%s' \"$line\" > seen; echo ready > ready; exec sleep 60",
        64,
    );
    let stop = AtomicBool::new(false);
    let error = std::thread::scope(|scope| {
        scope.spawn(|| {
            ready(&fixture.0.join("ready"));
            stop.store(true, Ordering::Release);
        });
        channel
            .exchange_lifeline_drain(b"effect", Instant::now() + START_BUDGET, || {
                stop.load(Ordering::Acquire)
            })
            .unwrap_err()
    });
    assert_eq!(error.kind, FailureKind::Deadline);
    assert!(matches!(error.cleanup, Cleanup::Confirmed));
    assert!(channel.pid().is_none());
    assert_eq!(fs::read(fixture.0.join("seen")).unwrap(), b"effect");
    gone(&fixture.0.join("pid"));
}

#[test]
fn a_response_deadline_after_readiness_ends_the_owned_child() {
    let (fixture, mut channel) = open(
        "IFS= read -r line; printf 'ready\\n'; IFS= read -r line; printf '%s' \"$line\" > seen; cat > /dev/null",
        64,
    );
    assert_eq!(exchange(&mut channel, b"start").unwrap(), b"ready");
    let error = channel
        .exchange(b"effect", Instant::now() + Duration::from_secs(1), || false)
        .unwrap_err();
    assert_eq!(error.kind, FailureKind::Deadline);
    assert!(matches!(error.cleanup, Cleanup::Confirmed));
    assert_eq!(fs::read(fixture.0.join("seen")).unwrap(), b"effect");
    gone(&fixture.0.join("pid"));
}

#[test]
fn drop_closes_stdin_and_preserves_the_childs_eof_cleanup() {
    let (fixture, mut channel) = open("cat; printf done > eof", 64);
    assert_eq!(exchange(&mut channel, b"hello").unwrap(), b"hello");
    drop(channel);
    assert_eq!(fs::read(fixture.0.join("eof")).unwrap(), b"done");
    gone(&fixture.0.join("pid"));
}

#[test]
fn unsolicited_frames_do_not_write_input_and_graceful_termination_reaps_the_owner() {
    let (fixture, mut channel) = open(
        "trap 'printf stopped > stopped; exit 0' TERM\nprintf 'first\\nsecond\\n'\nwhile IFS= read -r line; do printf '%s' \"$line\" >> input; done",
        64,
    );
    assert_eq!(
        channel
            .receive(Instant::now() + START_BUDGET, || false)
            .unwrap(),
        b"first"
    );
    assert_eq!(
        channel
            .receive(Instant::now() + START_BUDGET, || false)
            .unwrap(),
        b"second"
    );
    let output = channel.terminate(Instant::now() + START_BUDGET).unwrap();
    assert!(output.status.success());
    assert_eq!(fs::read(fixture.0.join("stopped")).unwrap(), b"stopped");
    assert!(
        !fixture.0.join("input").exists(),
        "reading a report must never submit a command"
    );
    gone(&fixture.0.join("pid"));
}
#[test]
fn cancelled_stream_read_keeps_shutdown_with_the_supervisor_owner() {
    let (fixture, mut channel) = open(
        "trap 'printf stopped > stopped; exit 0' TERM\nprintf 'ready\\n'\nwhile IFS= read -r line; do :; done",
        64,
    );
    assert_eq!(
        channel
            .receive(Instant::now() + START_BUDGET, || false)
            .unwrap(),
        b"ready"
    );
    let error = channel
        .receive(Instant::now() + START_BUDGET, || true)
        .unwrap_err();
    assert_eq!(error.kind, FailureKind::Interrupted);
    assert!(
        channel
            .terminate(Instant::now() + START_BUDGET)
            .unwrap()
            .status
            .success()
    );
    assert_eq!(fs::read(fixture.0.join("stopped")).unwrap(), b"stopped");
    gone(&fixture.0.join("pid"));
}
#[test]
fn every_buffered_stream_frame_keeps_its_bound() {
    let (fixture, mut channel) = open(
        "trap 'exit 0' TERM\nprintf 'ok\\ntoolong\\n'\nwhile IFS= read -r line; do :; done",
        4,
    );
    assert_eq!(
        channel
            .receive(Instant::now() + START_BUDGET, || false)
            .unwrap(),
        b"ok"
    );
    let error = channel
        .receive(Instant::now() + START_BUDGET, || false)
        .unwrap_err();
    assert_eq!(error.kind, FailureKind::OutputLimit(Stream::Stdout));
    assert!(
        channel
            .terminate(Instant::now() + START_BUDGET)
            .unwrap()
            .status
            .success()
    );
    gone(&fixture.0.join("pid"));
}
