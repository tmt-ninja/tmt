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

use super::{TemplateStore, admit, key, published};
use crate::{
    storage::{Storage, hook_queue::HookQueue, migrations},
    test_support::TestDirectory,
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

fn entries(directory: &Path) -> Vec<String> {
    let mut names = fs::read_dir(directory)
        .map(|entries| {
            entries
                .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
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
const CHILD_START: &str = "TMT_TEMPLATE_TEST_START";
const CHILD_TEST: &str = "storage::template_fixture::tests::template_child_process";

/// Child role for the cross-process test; a no-op in a normal run.
#[test]
fn template_child_process() {
    let Some(root) = std::env::var_os(CHILD_ROOT) else {
        return;
    };
    let start = PathBuf::from(std::env::var_os(CHILD_START).unwrap());
    let deadline = Instant::now() + Duration::from_secs(10);
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

fn run_children(directory: &TestDirectory, batch: &str, count: usize) -> Vec<PathBuf> {
    let start = directory.path.join(format!("start-{batch}"));
    let children = (0..count)
        .map(|index| {
            let database = directory
                .path
                .join(format!("{batch}-{index}"))
                .join("tmt.db");
            let child = Command::new(std::env::current_exe().unwrap())
                .args(["--exact", CHILD_TEST, "--nocapture", "--test-threads=1"])
                .env(CHILD_ROOT, directory.path.join("templates"))
                .env(CHILD_DATABASE, &database)
                .env(CHILD_START, &start)
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap();
            (child, database)
        })
        .collect::<Vec<_>>();
    fs::write(&start, b"go").unwrap();
    children
        .into_iter()
        .map(|(child, database)| {
            let output = child.wait_with_output().unwrap();
            assert!(
                output.status.success(),
                "template child failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            database
        })
        .collect()
}

#[test]
fn concurrent_processes_share_one_published_template() {
    let directory = TestDirectory::new();
    let store = store(&directory, Some("processes"));
    let first = run_children(&directory, "builders", 4);
    let (template, inode) = published(&store).unwrap();
    let bytes = fs::read(&template).unwrap();
    let key_directory = template.parent().unwrap().to_path_buf();
    assert_eq!(entries(&key_directory), [super::TEMPLATE]);

    // Readers copy while a late builder in this process loses its link.
    let late = thread::spawn(move || store.build(&key_directory));
    let second = run_children(&directory, "readers", 4);
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
