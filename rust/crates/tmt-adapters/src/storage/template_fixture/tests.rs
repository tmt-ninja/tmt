//! Template lifecycle controls. Every store here uses a private root under its
//! own `TestDirectory`; nothing touches the shared template root.

use std::{
    collections::BTreeMap,
    fs,
    os::unix::fs::{MetadataExt, PermissionsExt, symlink},
    panic::{AssertUnwindSafe, catch_unwind},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Barrier},
    thread,
    time::{Duration, Instant},
};

use rusqlite::{Connection, OpenFlags, types::Value};

use super::{RUN_SCOPE_LOCK, STALE_RUN_SCOPE_AGE, TemplateStore, admit, key, published};
use crate::{
    storage::{Storage, hook_queue::HookQueue, migrations},
    test_support::{TestChild, TestDirectory},
};

fn store(directory: &TestDirectory, run: Option<&str>) -> TemplateStore {
    TemplateStore::new(
        directory.path.join("templates"),
        run.map(String::from),
        &[],
        |_| {},
    )
}

fn panic_text(result: thread::Result<impl Sized>) -> String {
    let Err(payload) = result else {
        panic!("expected a panic");
    };
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| {
            payload
                .downcast_ref::<&str>()
                .map(|text| (*text).to_string())
        })
        .unwrap_or_default()
}

/// Every caller expects `directory` to exist; an inspection error fails.
fn entries(directory: &Path) -> Vec<String> {
    let mut names = fs::read_dir(directory)
        .unwrap_or_else(|error| panic!("inspect {}: {error}", directory.display()))
        .map(|entry| {
            entry
                .unwrap_or_else(|error| panic!("inspect {}: {error}", directory.display()))
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect::<Vec<_>>();
    names.sort();
    names
}

/// Logical state that a case can observe after its real open. Migration times
/// are dropped: each build records its own.
#[derive(Debug, PartialEq)]
struct Snapshot {
    schema: Vec<(String, String, String, Option<String>)>,
    rows: BTreeMap<String, Vec<String>>,
    pragmas: Vec<(String, String)>,
    queue_version: i64,
    modes: (u32, u32),
}

fn snapshot(storage: &Storage, database: &Path) -> Snapshot {
    let connection = storage.connection().unwrap();
    let mut statement = connection
        .prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name")
        .unwrap();
    let schema = statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .unwrap()
        .collect::<Result<Vec<(String, String, String, Option<String>)>, _>>()
        .unwrap();
    let mut rows = BTreeMap::new();
    for (kind, name, _, _) in &schema {
        if kind != "table" {
            continue;
        }
        let query = if name == "_migrations" {
            "SELECT version, name FROM _migrations".to_string()
        } else {
            format!("SELECT * FROM \"{name}\"")
        };
        let mut statement = connection.prepare(&query).unwrap();
        let width = statement.column_count();
        let mut values = statement
            .query_map([], |row| {
                (0..width)
                    .map(|index| row.get::<_, Value>(index).map(|value| format!("{value:?}")))
                    .collect::<Result<Vec<_>, _>>()
                    .map(|cells| cells.join("|"))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        values.sort();
        rows.insert(name.clone(), values);
    }
    let pragmas = [
        "page_size",
        "auto_vacuum",
        "encoding",
        "user_version",
        "application_id",
        "journal_mode",
        "foreign_keys",
        "synchronous",
        "busy_timeout",
    ]
    .into_iter()
    .map(|name| {
        let value: Value = connection
            .query_row(&format!("PRAGMA {name}"), [], |row| row.get(0))
            .unwrap();
        (name.to_string(), format!("{value:?}"))
    })
    .collect();
    // Real FTS5 behavior on the case connection, as the open checks it.
    connection
        .execute_batch(
            "CREATE VIRTUAL TABLE temp.template_fts USING fts5(body);
             INSERT INTO temp.template_fts VALUES ('migrated template');",
        )
        .unwrap();
    let matched: i64 = connection
        .query_row(
            "SELECT count(*) FROM temp.template_fts WHERE template_fts MATCH 'template'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(matched, 1);
    connection
        .execute_batch("DROP TABLE temp.template_fts;")
        .unwrap();
    let queue =
        Connection::open_with_flags(HookQueue::path(database), OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
    let queue_version = queue
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    let mode = |path: &Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;
    Snapshot {
        schema,
        rows,
        pragmas,
        queue_version,
        modes: (mode(database.parent().unwrap()), mode(database)),
    }
}

/// The control always runs the real chain for its baseline; only the other
/// side comes from a template.
#[test]
fn a_placed_template_opens_to_the_same_state_as_the_real_chain() {
    let baseline_directory = TestDirectory::new();
    let baseline = baseline_directory.path.join("state").join("tmux-team.db");
    let mut chain = Storage::open(&baseline).unwrap();
    let expected = snapshot(&chain, &baseline);

    let directory = TestDirectory::new();
    let store = store(&directory, Some("equivalence"));
    let database = directory
        .path
        .join("case")
        .join("state")
        .join("tmux-team.db");
    let _lease = store.place(&database);
    let mut copied = Storage::open(&database).unwrap();
    assert_eq!(snapshot(&copied, &database), expected);
    let mut health = copied.health().unwrap();
    health.path = baseline.clone();
    assert_eq!(health, chain.health().unwrap());
    assert_eq!(expected.modes, (0o700, 0o600));
    assert_eq!(fs::metadata(&database).unwrap().nlink(), 1);
    copied.close().unwrap();
    chain.close().unwrap();
}

/// Sensitivity of the control above: a template that differs in one seed row
/// does not compare equal.
#[test]
fn the_equivalence_snapshot_detects_a_changed_template() {
    let baseline_directory = TestDirectory::new();
    let baseline = baseline_directory.path.join("tmt.db");
    let mut chain = Storage::open(&baseline).unwrap();
    let expected = snapshot(&chain, &baseline);
    chain.close().unwrap();

    let directory = TestDirectory::new();
    let changed = TemplateStore::new(
        directory.path.join("templates"),
        Some("changed".into()),
        &[],
        |database| {
            Connection::open(database)
                .unwrap()
                .execute_batch("CREATE TABLE template_drift(value TEXT);")
                .unwrap();
        },
    );
    let database = directory.path.join("case.db");
    let _lease = changed.place(&database);
    let mut copied = Storage::open(&database).unwrap();
    assert_ne!(snapshot(&copied, &database), expected);
    copied.close().unwrap();
}

fn assert_admission_refuses(name: &str, damage: impl FnOnce(&Path), reason: &str) {
    let directory = TestDirectory::new();
    let store = store(&directory, Some(name));
    let lease = store.place(&directory.path.join("first.db"));
    let (template, _) = published(&store).unwrap();
    fs::remove_file(&template).unwrap();
    let source = directory.path.join("first.db");
    let damaged = directory.path.join("damaged.db");
    fs::copy(&source, &damaged).unwrap();
    damage(&damaged);
    fs::rename(&damaged, &template).unwrap();

    let database = directory.path.join("case").join("tmt.db");
    let message = panic_text(catch_unwind(AssertUnwindSafe(|| store.place(&database))));
    assert!(message.contains("failed admission"), "{message}");
    assert!(message.contains(reason), "{message}");
    // Nothing migrated or repaired the copy: no WAL and no queue appeared.
    assert!(!directory.path.join("case").join("tmt.db-wal").exists());
    assert!(!HookQueue::path(&database).exists());
    drop(lease);
}

#[test]
fn admission_refuses_a_template_behind_the_compiled_version() {
    assert_admission_refuses(
        "behind",
        |path| {
            Connection::open(path)
                .unwrap()
                .execute(
                    "DELETE FROM _migrations WHERE version = ?1",
                    [migrations::VERSION],
                )
                .unwrap();
        },
        "migration history",
    );
}

#[test]
fn admission_refuses_a_truncated_template() {
    assert_admission_refuses(
        "truncated",
        |path| {
            let file = fs::OpenOptions::new().write(true).open(path).unwrap();
            file.set_len(fs::metadata(path).unwrap().len() / 2).unwrap();
        },
        "",
    );
}

#[test]
fn admission_refuses_garbage_bytes() {
    assert_admission_refuses(
        "garbage",
        |path| fs::write(path, vec![0x5a; 65536]).unwrap(),
        "not a SQLite database",
    );
}

#[test]
fn admission_refuses_a_template_left_in_wal_mode() {
    assert_admission_refuses(
        "wal",
        |path| {
            let connection = Connection::open(path).unwrap();
            let mode: String = connection
                .query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))
                .unwrap();
            assert_eq!(mode, "wal");
        },
        "journal mode wal in the file header",
    );
}

#[test]
fn an_intact_template_copy_is_admitted() {
    let directory = TestDirectory::new();
    let store = store(&directory, Some("intact"));
    let database = directory.path.join("tmt.db");
    let _lease = store.place(&database);
    assert_eq!(admit(&database), Ok(()));
}

#[test]
fn an_existing_destination_or_sidecar_is_refused() {
    let directory = TestDirectory::new();
    let store = store(&directory, Some("destination"));
    for suffix in ["", "-wal", "-shm"] {
        let database = directory.path.join(format!("seeded{}.db", suffix.len()));
        let mut existing = database.as_os_str().to_os_string();
        existing.push(suffix);
        fs::write(&existing, b"seeded").unwrap();
        let message = panic_text(catch_unwind(AssertUnwindSafe(|| store.place(&database))));
        assert!(message.contains("already exists"), "{message}");
        assert_eq!(fs::read(&existing).unwrap(), b"seeded");
    }
}

#[test]
fn a_late_builder_never_replaces_the_published_template() {
    let directory = TestDirectory::new();
    let store = store(&directory, Some("winner"));
    let _lease = store.place(&directory.path.join("first.db"));
    let (template, inode) = published(&store).unwrap();
    let bytes = fs::read(&template).unwrap();
    store.build(template.parent().unwrap());
    assert_eq!(published(&store).unwrap().1, inode);
    assert_eq!(fs::read(&template).unwrap(), bytes);
    assert_eq!(entries(template.parent().unwrap()), [super::TEMPLATE]);
}

#[test]
fn a_failed_build_publishes_nothing_and_leaves_no_build_files() {
    let directory = TestDirectory::new();
    let failing = TemplateStore::new(
        directory.path.join("templates"),
        Some("failed".into()),
        &[],
        |_| panic!("injected template build failure"),
    );
    let message = panic_text(catch_unwind(AssertUnwindSafe(|| {
        failing.place(&directory.path.join("first.db"))
    })));
    assert!(message.contains("injected"), "{message}");
    let key_directory = directory
        .path
        .join("templates")
        .join("run-failed")
        .join(key());
    assert_eq!(entries(&key_directory), Vec::<String>::new());
    assert!(!directory.path.join("first.db").exists());

    let working = store(&directory, Some("failed"));
    let database = directory.path.join("second.db");
    let _lease = working.place(&database);
    assert_eq!(admit(&database), Ok(()));
    assert_eq!(entries(&key_directory), [super::TEMPLATE]);
}

#[test]
fn the_template_root_must_be_private_and_outside_host_stores() {
    let directory = TestDirectory::new();
    let open = directory.path.join("open");
    fs::create_dir(&open).unwrap();
    fs::set_permissions(&open, fs::Permissions::from_mode(0o755)).unwrap();
    let opened = TemplateStore::new(open, Some("open".into()), &[], |_| {});
    let message = panic_text(catch_unwind(AssertUnwindSafe(|| {
        opened.place(&directory.path.join("a.db"))
    })));
    assert!(message.contains("owner-only"), "{message}");

    let target = directory.path.join("target");
    fs::create_dir(&target).unwrap();
    let linked = directory.path.join("linked");
    symlink(&target, &linked).unwrap();
    let symlinked = TemplateStore::new(linked, Some("link".into()), &[], |_| {});
    let message = panic_text(catch_unwind(AssertUnwindSafe(|| {
        symlinked.place(&directory.path.join("b.db"))
    })));
    assert!(message.contains("owner-only"), "{message}");

    // A fake host store reached through a symlinked parent; the real host
    // store is never used.
    let host = directory.path.join("fake-home").join(".config").join("tmt");
    fs::create_dir_all(&host).unwrap();
    let alias = directory.path.join("alias");
    symlink(&host, &alias).unwrap();
    let message = panic_text(catch_unwind(AssertUnwindSafe(|| {
        TemplateStore::new(
            alias.join("templates"),
            None,
            std::slice::from_ref(&host),
            |_| {},
        )
    })));
    assert!(message.contains("inside host store"), "{message}");
    assert_eq!(entries(&host), Vec::<String>::new());
}

/// Sets the modification time of `path` itself, not of a link target.
fn set_age(path: &Path, age: Duration) {
    use nix::sys::time::{TimeVal, TimeValLike};
    let when = std::time::SystemTime::now()
        .checked_sub(age)
        .unwrap()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    let time = TimeVal::seconds(i64::try_from(when.as_secs()).unwrap());
    nix::sys::stat::lutimes(path, &time, &time).unwrap();
}

fn private_root(directory: &TestDirectory) -> PathBuf {
    let root = directory.path.join("templates");
    fs::create_dir(&root).unwrap();
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
    root
}

const STALE: Duration = STALE_RUN_SCOPE_AGE.saturating_add(Duration::from_secs(60 * 60));

/// An unleased scope as an earlier run leaves it: lock file, key, template.
fn left_scope(root: &Path, name: &str, age: Duration, lock: bool) {
    let path = root.join(name);
    fs::create_dir_all(path.join("key")).unwrap();
    fs::write(path.join("key").join("template.db"), b"old").unwrap();
    if lock {
        fs::write(path.join(RUN_SCOPE_LOCK), b"").unwrap();
    }
    for private in [path.join("key"), path.clone()] {
        fs::set_permissions(&private, fs::Permissions::from_mode(0o700)).unwrap();
    }
    set_age(&path, age);
}

#[test]
fn a_run_scope_collects_only_old_unlocked_run_scopes_of_earlier_runs() {
    let directory = TestDirectory::new();
    let root = private_root(&directory);
    left_scope(&root, "run-old", STALE, true);
    left_scope(&root, "run-current", STALE, true);
    left_scope(&root, "run-fresh", Duration::from_secs(60), true);
    left_scope(&root, "run-nolock", STALE, false);
    left_scope(&root, "process-1-2-3", STALE, true);
    left_scope(&root, "run-not.an.id", STALE, true);
    // An old link named like a run scope is not followed and not removed.
    let outside = directory.path.join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("keep"), b"keep").unwrap();
    symlink(&outside, root.join("run-link")).unwrap();
    set_age(&root.join("run-link"), STALE);

    let store = TemplateStore::new(root.clone(), Some("current".into()), &[], |_| {});
    let _lease = store.place(&directory.path.join("tmt.db"));

    assert_eq!(
        entries(&root),
        [
            "process-1-2-3",
            "run-current",
            "run-fresh",
            "run-link",
            "run-nolock",
            "run-not.an.id"
        ]
    );
    assert_eq!(entries(&outside), ["keep"]);
    assert!(published(&store).is_some());
}

/// A run that sleeps or debugs keeps an old scope directory while its lease
/// is live; a later run must not collect it.
#[test]
fn an_old_run_scope_with_a_live_lease_is_kept() {
    let directory = TestDirectory::new();
    let root = private_root(&directory);
    let active = TemplateStore::new(root.clone(), Some("active".into()), &[], |_| {});
    let lease = active.place(&directory.path.join("active.db"));
    let (template, inode) = published(&active).unwrap();
    set_age(&root.join("run-active"), STALE);

    let later = TemplateStore::new(root.clone(), Some("later".into()), &[], |_| {});
    let _later = later.place(&directory.path.join("later.db"));

    assert_eq!(entries(&root), ["run-active", "run-later"]);
    assert_eq!(fs::metadata(&template).unwrap().ino(), inode);
    drop(lease);
}

/// After a collector removed its scope, a run that places again creates the
/// scope again instead of using the removed one.
#[test]
fn a_collected_run_scope_is_created_again_on_next_use() {
    let directory = TestDirectory::new();
    let root = private_root(&directory);
    let earlier = TemplateStore::new(root.clone(), Some("earlier".into()), &[], |_| {});
    drop(earlier.place(&directory.path.join("first.db")));
    set_age(&root.join("run-earlier"), STALE);

    let later = TemplateStore::new(root.clone(), Some("later".into()), &[], |_| {});
    let _later = later.place(&directory.path.join("later.db"));
    assert_eq!(entries(&root), ["run-later"]);

    let _again = earlier.place(&directory.path.join("again.db"));
    assert_eq!(entries(&root), ["run-earlier", "run-later"]);
    assert!(published(&earlier).is_some());
    Storage::open(directory.path.join("again.db")).unwrap();
}

#[test]
fn building_a_template_does_not_read_observer_consent() {
    let directory = TestDirectory::new();
    let store = store(&directory, Some("observer"));
    let _lease = store.place(&directory.path.join("tmt.db"));
    assert!(!crate::extension_hooks::capture_allowed());
    assert!(!crate::extension_hooks::observers_initialized());
}

#[test]
fn threads_share_one_process_scope_until_the_last_lease_drops() {
    let directory = TestDirectory::new();
    let store = Arc::new(store(&directory, None));
    let root = directory.path.join("templates");
    let barrier = Arc::new(Barrier::new(4));
    let leases = (0..4)
        .map(|index| {
            let store = Arc::clone(&store);
            let barrier = Arc::clone(&barrier);
            let database = directory.path.join(format!("case-{index}.db"));
            thread::spawn(move || {
                barrier.wait();
                (store.place(&database), database)
            })
        })
        .collect::<Vec<_>>()
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(entries(&root).len(), 1);
    for (_, database) in &leases {
        assert_eq!(admit(database), Ok(()));
    }
    drop(leases);
    assert_eq!(entries(&root), Vec::<String>::new());
}

/// The final release and a new acquisition race; the new case must keep an
/// admitted template and only the live scope may remain.
#[test]
fn a_new_lease_survives_the_previous_scope_being_removed() {
    let directory = TestDirectory::new();
    let store = Arc::new(store(&directory, None));
    let root = directory.path.join("templates");
    for round in 0..20 {
        let first = store.place(&directory.path.join(format!("old-{round}.db")));
        let barrier = Arc::new(Barrier::new(2));
        let releasing = {
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                drop(first);
            })
        };
        let acquiring = {
            let store = Arc::clone(&store);
            let barrier = Arc::clone(&barrier);
            let database = directory.path.join(format!("new-{round}.db"));
            thread::spawn(move || {
                barrier.wait();
                let lease = store.place(&database);
                (lease, database)
            })
        };
        releasing.join().unwrap();
        let (lease, database) = acquiring.join().unwrap();
        assert_eq!(admit(&database), Ok(()));
        let live = entries(&root);
        assert_eq!(live.len(), 1, "round {round}: {live:?}");
        let (template, _) = published(&store).unwrap();
        assert!(template.starts_with(root.join(&live[0])));
        drop(lease);
        assert_eq!(entries(&root), Vec::<String>::new());
    }
}

const CHILD_ROOT: &str = "TMT_TEMPLATE_TEST_ROOT";
const CHILD_DATABASE: &str = "TMT_TEMPLATE_TEST_DATABASE";
const CHILD_READY: &str = "TMT_TEMPLATE_TEST_READY";
const CHILD_START: &str = "TMT_TEMPLATE_TEST_START";
const CHILD_FAIL: &str = "TMT_TEMPLATE_TEST_FAIL";
const CHILD_TEST: &str = "storage::template_fixture::tests::template_child_process";
/// One readiness budget for a whole batch. The parent stops waiting for ready
/// files when it runs out; a ready child waits the same budget for the start
/// file, so it cannot give up while the parent still waits for its siblings.
const CHILD_READY_BUDGET: Duration = Duration::from_secs(30);
const CHILD_EXIT_TIMEOUT: Duration = Duration::from_secs(60);

/// Child role for the cross-process tests; a no-op in a normal run.
#[test]
fn template_child_process() {
    let Some(root) = std::env::var_os(CHILD_ROOT) else {
        return;
    };
    assert!(
        std::env::var_os(CHILD_FAIL).is_none(),
        "injected template child failure"
    );
    fs::write(std::env::var_os(CHILD_READY).unwrap(), "ready").unwrap();
    let start = PathBuf::from(std::env::var_os(CHILD_START).unwrap());
    let deadline = Instant::now() + CHILD_READY_BUDGET;
    while !start.exists() {
        assert!(
            Instant::now() < deadline,
            "parent did not start template children"
        );
        thread::sleep(Duration::from_millis(2));
    }
    let store = TemplateStore::new(PathBuf::from(root), Some("processes".into()), &[], |_| {});
    let database = PathBuf::from(std::env::var_os(CHILD_DATABASE).unwrap());
    let _lease = store.place(&database);
    let mut storage = Storage::open(&database).unwrap();
    storage
        .connection()
        .unwrap()
        .execute_batch("CREATE TABLE child_write(value TEXT);")
        .unwrap();
    storage.close().unwrap();
}

/// Starts `count` children, each owned by a `TestChild` from spawn on, so an
/// assertion or timeout anywhere here kills and reaps the rest. All children
/// report ready before one start file releases them together.
fn run_children(
    directory: &TestDirectory,
    batch: &str,
    count: usize,
    failing: Option<usize>,
    pids: &mut Vec<u32>,
) -> Vec<PathBuf> {
    let start = directory.path.join(format!("start-{batch}"));
    let mut children = Vec::new();
    for index in 0..count {
        let case = directory.path.join(format!("{batch}-{index}"));
        fs::create_dir(&case).unwrap();
        let stderr = fs::File::create(case.join("stderr")).unwrap();
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", CHILD_TEST, "--nocapture", "--test-threads=1"])
            .env(CHILD_ROOT, directory.path.join("templates"))
            .env(CHILD_DATABASE, case.join("tmt.db"))
            .env(CHILD_READY, case.join("ready"))
            .env(CHILD_START, &start)
            .env_remove(CHILD_FAIL)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(stderr);
        if failing == Some(index) {
            command.env(CHILD_FAIL, "1");
        }
        let child = TestChild::new(command.spawn().unwrap());
        pids.push(child.child.id());
        children.push((child, case));
    }
    let ready_deadline = Instant::now() + CHILD_READY_BUDGET;
    for (child, case) in &mut children {
        let remaining = ready_deadline.saturating_duration_since(Instant::now());
        child.wait_for_content(&case.join("ready"), "ready", remaining);
    }
    fs::write(&start, b"go").unwrap();
    children
        .iter_mut()
        .map(|(child, case)| {
            let status = child.wait_for_exit(CHILD_EXIT_TIMEOUT);
            assert!(
                status.success(),
                "template child failed: {}",
                fs::read_to_string(case.join("stderr")).unwrap()
            );
            case.join("tmt.db")
        })
        .collect()
}

fn assert_reaped(pid: u32) {
    use nix::{
        errno::Errno,
        sys::wait::{WaitPidFlag, waitpid},
        unistd::Pid,
    };
    let pid = Pid::from_raw(i32::try_from(pid).unwrap());
    assert_eq!(
        waitpid(pid, Some(WaitPidFlag::WNOHANG)),
        Err(Errno::ECHILD),
        "template child {pid} was not reaped"
    );
}

#[test]
fn a_failing_child_test_still_reaps_its_other_children() {
    let directory = TestDirectory::new();
    let mut pids = Vec::new();
    let message = panic_text(catch_unwind(AssertUnwindSafe(|| {
        run_children(&directory, "failing", 3, Some(0), &mut pids)
    })));
    assert!(message.contains("test child exited before"), "{message}");
    assert_eq!(pids.len(), 3);
    for pid in pids {
        assert_reaped(pid);
    }
    // The released children never started building.
    assert!(!directory.path.join("start-failing").exists());
}

#[test]
fn concurrent_processes_share_one_published_template() {
    let directory = TestDirectory::new();
    let store = store(&directory, Some("processes"));
    let mut pids = Vec::new();
    let first = run_children(&directory, "builders", 4, None, &mut pids);
    let (template, inode) = published(&store).unwrap();
    let bytes = fs::read(&template).unwrap();
    let key_directory = template.parent().unwrap().to_path_buf();
    assert_eq!(entries(&key_directory), [super::TEMPLATE]);

    // Readers copy while a late builder in this process loses its link.
    let late = thread::spawn(move || store.build(&key_directory));
    let second = run_children(&directory, "readers", 4, None, &mut pids);
    late.join().unwrap();
    assert_eq!(fs::metadata(&template).unwrap().ino(), inode);
    assert_eq!(fs::read(&template).unwrap(), bytes);
    assert_eq!(entries(template.parent().unwrap()), [super::TEMPLATE]);

    for database in first.iter().chain(&second) {
        let connection =
            Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let tables: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name = 'child_write'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tables, 1, "each case wrote only its own copy");
        assert_eq!(fs::metadata(database).unwrap().nlink(), 1);
        assert_ne!(fs::metadata(database).unwrap().ino(), inode);
    }
    // The template itself never saw a case write.
    let template_connection =
        Connection::open_with_flags(&template, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let written: i64 = template_connection
        .query_row(
            "SELECT count(*) FROM sqlite_schema WHERE name = 'child_write'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(written, 0);
}

/// Makes `parent` read-only so removing a directory inside it fails, runs
/// `drop_owner`, restores the mode and returns whether the drop panicked.
fn drop_with_blocked_removal(parent: &Path, target: &Path, drop_owner: impl FnOnce()) -> String {
    fs::set_permissions(parent, fs::Permissions::from_mode(0o500)).unwrap();
    let result = catch_unwind(AssertUnwindSafe(drop_owner));
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(
        target.exists(),
        "the permission fault did not block cleanup"
    );
    fs::remove_dir_all(target).unwrap();
    panic_text(result)
}

#[test]
fn a_scope_cleanup_failure_fails_the_test() {
    let directory = TestDirectory::new();
    let scope = directory.path.join("scope");
    fs::create_dir(&scope).unwrap();
    let message = drop_with_blocked_removal(&directory.path, &scope, || {
        drop(super::Scope {
            directory: scope.clone(),
            removed_on_drop: true,
            _live: None,
        });
    });
    assert!(
        message.contains("Could not remove storage template scope"),
        "{message}"
    );
}

#[test]
fn a_build_cleanup_failure_fails_the_test() {
    let directory = TestDirectory::new();
    let build = directory.path.join(".build-test");
    let owner = super::BuildDirectory::create(build.clone());
    let message = drop_with_blocked_removal(&directory.path, &build, || drop(owner));
    assert!(
        message.contains("Could not remove storage template build"),
        "{message}"
    );
}

/// During an existing panic a cleanup failure is reported, not raised again,
/// so the original failure survives instead of aborting the process.
#[test]
fn a_cleanup_failure_during_a_panic_keeps_the_original_failure() {
    let directory = TestDirectory::new();
    let build = directory.path.join(".build-test");
    let owner = super::BuildDirectory::create(build.clone());
    let message = drop_with_blocked_removal(&directory.path, &build, || {
        let _owner = owner;
        panic!("original failure");
    });
    assert_eq!(message, "original failure");
}

#[test]
fn an_inspection_error_is_not_an_empty_directory() {
    let directory = TestDirectory::new();
    let missing = directory.path.join("missing");
    let message = panic_text(catch_unwind(|| entries(&missing)));
    assert!(message.contains("inspect"), "{message}");
}
