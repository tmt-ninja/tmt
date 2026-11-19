use super::*;
use serde_json::Value;

fn records(buffer: &Mutex<Vec<u8>>) -> Vec<Value> {
    let bytes = buffer.lock().unwrap();
    std::str::from_utf8(&bytes)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[test]
fn opt_in_values_preserve_file_paths() {
    let reports = Reports::default();
    for value in [None, Some(OsStr::new("")), Some(OsStr::new("0"))] {
        assert!(matches!(destination(value), Destination::Off));
        assert!(Trace::open(destination(value), &reports).is_none());
    }
    assert!(matches!(
        destination(Some(OsStr::new("1"))),
        Destination::BoardCache
    ));
    let Destination::File(path) = destination(Some(OsStr::new("my trace.jsonl"))) else {
        panic!()
    };
    assert_eq!(path, std::path::PathBuf::from("my trace.jsonl"));
}

#[test]
fn disabled_stage_never_samples_the_clock_and_preserves_result() {
    let work = std::cell::Cell::new(0);
    let result = measured(
        None,
        "Squad::list",
        || {
            work.set(work.get() + 1);
            Err::<(), _>("unavailable")
        },
        || panic!("off must not read clock"),
    );
    assert_eq!(result, Err("unavailable"));
    assert_eq!(work.get(), 1);
}

#[test]
fn stage_records_have_stable_shape_units_escaping_and_error_status() {
    let (trace, buffer) = Trace::buffer();
    let load = trace.load(Some("quoted\"\nname"), 7);
    load.emit("stage", "Squad::list", Duration::from_micros(1234), true);
    let result = measure(Some(&load), "Config::load", || {
        Err::<(), _>("secret error body")
    });
    assert!(result.is_err());
    let records = records(&buffer);
    assert_eq!(records.len(), 2);
    let mut expected = json!({"version":1,"pid":std::process::id(),"load_id":1,"generation":7,
        "tab":"quoted\"\nname","event":"stage","stage":"Squad::list","duration_us":1234,
        "elapsed_us":0,"status":"ok","deferred_pending":false});
    expected["elapsed_us"] = records[0]["elapsed_us"].clone();
    assert_eq!(records[0], expected);
    assert_eq!(records[1]["stage"], "Config::load");
    assert_eq!(records[1]["status"], "error");
    assert!(records[1]["duration_us"].is_u64());
    assert!(
        !String::from_utf8(buffer.lock().unwrap().clone())
            .unwrap()
            .contains("secret")
    );
}

#[test]
fn file_sink_appends_private_complete_records_and_rejects_symlinks() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let root = std::env::temp_dir().join(format!(
        "ops-timing-{}-{}",
        std::process::id(),
        crate::id::new_v4().unwrap()
    ));
    std::fs::create_dir(&root).unwrap();
    let path = root.join("trace");
    let reports = Reports::default();
    for _ in 0..2 {
        let trace = Trace::open(Destination::File(path.clone()), &reports).unwrap();
        trace
            .startup()
            .emit("stage", "startup.Config::load", Duration::ZERO, true);
    }
    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(records(&Mutex::new(bytes.clone())).len(), 2);
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let link = root.join("link");
    symlink(&path, &link).unwrap();
    assert!(Trace::open(Destination::File(link), &reports).is_none());
    assert!(Trace::open(Destination::File(root.clone()), &reports).is_none());
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_len(DEFAULT_LIMIT)
        .unwrap();
    let mut capped = open_file(&path, Some(DEFAULT_LIMIT)).unwrap();
    assert!(capped.write(b"{}\n").is_err());
    assert_eq!(std::fs::metadata(&path).unwrap().len(), DEFAULT_LIMIT);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn milestones_require_accepted_current_snapshot_and_are_emitted_once() {
    let (trace, buffer) = Trace::buffer();
    let mut ui = Ui::new(trace.clone());
    ui.drawn(Some("product"), true); // Retained view alone is insufficient.
    let mut load = trace.load(Some("product"), 2);
    load.partial = true;
    load.pending = true;
    ui.snapshot(Some(load.clone()), false); // Failed/not-current snapshot.
    ui.drawn(Some("product"), true);
    ui.snapshot(Some(load.clone()), true);
    ui.drawn(Some("infra"), true); // Switched before draw.
    ui.snapshot(Some(load.clone()), true);
    ui.drawn(Some("product"), false); // Still loading.
    ui.snapshot(Some(load), true);
    ui.drawn(Some("product"), true);
    ui.drawn(Some("product"), true); // Neither milestone repeats.
    let records = records(&buffer);
    assert_eq!(records.len(), 2);
    assert_eq!(records[0]["event"], "first_frame");
    assert_eq!(records[1]["event"], "fresh_board");
    assert_eq!(records[1]["generation"], 2);
    assert_eq!(records[1]["status"], "partial");
    assert_eq!(records[1]["deferred_pending"], true);
}

#[test]
fn sink_failure_disables_further_writes_without_changing_work_results() {
    let path = std::env::temp_dir().join(format!(
        "ops-timing-readonly-{}",
        crate::id::new_v4().unwrap()
    ));
    std::fs::write(&path, b"preserved").unwrap();
    let failure = Arc::new(Mutex::new(None));
    let trace = Trace::new(
        Sink::File {
            file: File::open(&path).unwrap(),
            limit: None,
        },
        failure.clone(),
    );
    let load = trace.load(Some("product"), 0);
    for _ in 0..2 {
        assert_eq!(
            measure(Some(&load), "Config::load", || Ok::<_, ()>(42)),
            Ok(42)
        );
        assert!(matches!(*trace.0.sink.lock().unwrap(), Sink::Disabled));
    }
    assert!(failure.lock().unwrap().is_some());
    assert_eq!(std::fs::read(&path).unwrap(), b"preserved");
    std::fs::remove_file(path).unwrap();
}

#[test]
fn worker_and_ui_records_share_one_complete_line_writer() {
    let (trace, buffer) = Trace::buffer();
    std::thread::scope(|scope| {
        for generation in 0..2 {
            let trace = trace.clone();
            scope.spawn(move || {
                let load = trace.load(Some("product"), generation);
                for _ in 0..10 {
                    load.emit("stage", "Squad::list", Duration::ZERO, true);
                }
            });
        }
    });
    let records = records(&buffer);
    assert_eq!(records.len(), 20);
    for generation in 0..2 {
        assert_eq!(
            records
                .iter()
                .filter(|record| record["generation"] == generation)
                .count(),
            10
        );
    }
}

#[test]
fn navigation_is_file_only_and_off_without_a_path() {
    let reports = Reports::default();
    for value in [None, Some(OsStr::new("")), Some(OsStr::new("0"))] {
        assert!(Trace::navigation_destination(value, &reports).is_none());
    }
    let root = std::env::temp_dir().join(format!("ops-key-trace-{}", crate::id::new_v4().unwrap()));
    std::fs::create_dir(&root).unwrap();
    let missing = root.join("missing").join("trace");
    assert!(Trace::navigation_destination(Some(missing.as_os_str()), &reports).is_none());
    assert!(!missing.exists());
    std::fs::remove_dir(root).unwrap();
}

#[test]
fn navigation_records_end_ownership_and_action() {
    use crate::board::app::workspace::tests::{MEMBER, ROOM, board};
    use crate::board::workspace::OpsTarget;
    use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    let mut app = board();

    app.workspace.expanded.insert(ROOM.into());
    app.workspace.selected = Some(OpsTarget::Squad(ROOM.into()));
    app.workspace_reconcile();
    let (trace, buffer) = Trace::buffer();
    app.navigation_trace = Some(trace);
    app.key(KeyEvent::new(KeyCode::End, KeyModifiers::NONE));
    let rows = records(&buffer);
    let before = rows.iter().find(|r| r["event"] == "key_before").unwrap();
    assert_eq!(before["key"], "End");
    assert_eq!(before["owner"], "List");
    assert_eq!(before["verb"], "Ui(Last)");
    assert_eq!(before["selected"]["roomId"], ROOM);
    let after = rows.iter().find(|r| r["event"] == "key_after").unwrap();
    assert_eq!(after["selected"]["identityId"], MEMBER);
    assert!(
        rows.iter()
            .any(|r| r["event"] == "action" && r["verb"] == "Ui(Last)")
    );
    assert!(
        !String::from_utf8(buffer.lock().unwrap().clone())
            .unwrap()
            .contains("worker")
    );
}

#[test]
fn navigation_trace_does_not_record_private_shell_text() {
    use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    let mut app = crate::board::app::workspace::tests::board();
    app.focus_composer();
    let (trace, buffer) = Trace::buffer();
    app.navigation_trace = Some(trace);
    for ch in "!! secret".chars() {
        app.key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
    }
    let rows = records(&buffer);
    assert!(
        rows.iter()
            .filter(|row| row["event"] == "key_before")
            .all(|row| row["key"] == "<text>")
    );
    let logged = String::from_utf8(buffer.lock().unwrap().clone()).unwrap();
    assert!(!logged.contains("secret"));
    assert!(!logged.contains("Char('s')"));
}

#[test]
fn navigation_trace_distinguishes_pane_switch_from_refresh() {
    use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    let mut app = crate::board::app::workspace::tests::board();
    let (trace, buffer) = Trace::buffer();
    app.navigation_trace = Some(trace);
    app.key(KeyEvent::new(KeyCode::Char('M'), KeyModifiers::SHIFT));
    app.key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
    let after: Vec<_> = records(&buffer)
        .into_iter()
        .filter(|r| r["event"] == "key_after")
        .collect();
    assert_eq!(after.len(), 2);
    assert_eq!(after[0]["effect"], "none");
    assert_eq!(after[1]["effect"], "refresh");
}

#[test]
fn active_board_trace_keeps_diagnostics_off_the_tty() {
    use crate::board::terminal::{Crossterm, Guard};

    const CHILD: &str = "TMT_OPS_TEST_TIMING_PTY";
    if let Some(root) = std::env::var_os(CHILD) {
        let root = std::path::PathBuf::from(root);
        let read_only = root.join("readonly");
        std::fs::write(&read_only, "").unwrap();
        let reports = Reports::default();
        let mut screen = Guard::enter(Crossterm::with_timing_reports(&reports)).unwrap();
        let live = Trace::from_env(&reports).unwrap();
        live.startup().emit("stage", "live", Duration::ZERO, true);
        let failed = Trace::new(
            Sink::File {
                file: File::open(read_only).unwrap(),
                limit: None,
            },
            reports.failure.clone(),
        );
        let load = failed.startup();
        load.emit("stage", "fail", Duration::ZERO, true);
        load.emit("stage", "repeat", Duration::ZERO, true);
        screen.restore().unwrap();
        let trace_file = crate::cache::directory("board")
            .unwrap()
            .join("timing.jsonl");
        if trace_file.exists() {
            std::fs::copy(trace_file, root.join("trace.jsonl")).unwrap();
        }
        return;
    }

    let root = crate::test_support::Scratch::new("trace-pty");
    let output = std::process::Command::new("/usr/bin/python3")
        .args([
            "-c",
            r#"
import errno, fcntl, os, pty, select, signal, subprocess, sys, termios
master, slave = pty.openpty()
os.setsid()
signal.signal(signal.SIGHUP, signal.SIG_IGN)
fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
try:
    with subprocess.Popen([sys.argv[1], '--exact',
        'board::timing::tests::active_board_trace_keeps_diagnostics_off_the_tty',
        '--nocapture'], stdin=slave, stdout=slave, stderr=slave) as child:
        os.close(slave)
        try:
            while select.select([master], [], [], 8)[0]:
                try:
                    data = os.read(master, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    break
                if not data:
                    break
                sys.stdout.buffer.write(data)
            assert child.wait(timeout=2) == 0
        finally:
            if child.poll() is None:
                child.kill()
finally:
    os.close(master)
"#,
        ])
        .arg(std::env::current_exe().unwrap())
        .env(CHILD, root.as_ref().as_os_str())
        .env("TMPDIR", root.as_ref().as_os_str())
        .env(ENV, "1")
        .output()
        .unwrap();
    let tty = String::from_utf8(output.stdout).unwrap();
    assert!(output.status.success(), "{tty}\n{:?}", output.stderr);
    let (_, active) = tty.split_once("\x1b[?1049h").expect("board entered");
    let (active, restored) = active.split_once("\x1b[?1049l").expect("board restored");
    assert!(
        !active.contains("\"stage\"") && !active.contains("timing trace disabled"),
        "{active:?}"
    );
    assert_eq!(restored.matches("Ops timing trace disabled:").count(), 1);
    let logged: Value =
        serde_json::from_str(&std::fs::read_to_string(root.join("trace.jsonl")).unwrap()).unwrap();
    assert_eq!(logged["stage"], "live");
}
