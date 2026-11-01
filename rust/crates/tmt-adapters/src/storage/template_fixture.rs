//! Migrated-database template for storage tests.
//!
//! A fresh `Storage::open` runs the whole migration chain, which dominates the
//! setup cost of a storage case. A test that does not test opening itself
//! places a copy of a migrated, closed main file at its database path instead;
//! its real `Storage::open` (direct or through the service under test) then runs
//! on that copy.
//!
//! Lifecycle rules:
//! - Templates live in a private root under the temporary directory, in a scope
//!   that one test run owns: `NEXTEST_RUN_ID` under nextest, else a process
//!   scope that the last lease removes on drop. A template is never reused by a
//!   later run. A run scope outlives its run, so the first use of a run scope in
//!   a process also collects this user's other run scopes that are older than
//!   `STALE_RUN_SCOPE_AGE` and that no process holds. Collection is
//!   opportunistic: nothing runs after the last run.
//! - Liveness of a run scope is a lock, not a timestamp: every lease holds a
//!   shared `flock` on the scope's lock file, and a collector removes a scope
//!   only while it holds the exclusive lock on that file.
//! - Builders do not elect a winner: concurrent builders each run the real chain
//!   and publish with a no-replace hard link, so a published template never
//!   changes and readers only copy it.
//! - Every copy is admitted before the case uses it. A failed admission panics;
//!   there is no fallback to the migration chain.

use std::{
    fs,
    io::{self, ErrorKind},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, Once, OnceLock, Weak,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use nix::{
    errno::Errno,
    fcntl::{Flock, FlockArg, OFlag},
};
use rusqlite::{Connection, OpenFlags};

use super::{Storage, hook_queue::HookQueue, migrations};
use crate::private_file::directory_is_private;

const FORMAT: &str = "tmt-adapters-storage-template-v1";
const TEMPLATE: &str = "template.db";
const RUN_SCOPE_PREFIX: &str = "run-";
const RUN_SCOPE_LOCK: &str = "live.lock";

/// A run scope must be at least this old before a later run may collect it.
/// Age alone never removes a scope: the scope must also be unlocked.
pub(super) const STALE_RUN_SCOPE_AGE: Duration = Duration::from_secs(6 * 60 * 60);

/// Keeps the scope that holds this case's template alive for the case. A
/// fixture stores it next to its database path.
#[must_use = "the scope directory may be removed when the lease drops"]
pub(crate) struct TemplateLease {
    _scope: Arc<Scope>,
}

/// Places an admitted copy of the migrated template at `database`.
///
/// The destination and its sidecars must not exist: a reopen or a seeded
/// database never goes through here.
pub(crate) fn place_migrated_database(database: &Path) -> TemplateLease {
    static STORE: OnceLock<TemplateStore> = OnceLock::new();
    STORE
        .get_or_init(TemplateStore::from_environment)
        .place(database)
}

struct Scope {
    directory: PathBuf,
    /// Only a process scope is removed by its last lease; a later run removes
    /// a stale run scope.
    removed_on_drop: bool,
    /// A run scope's shared lock, held while any lease of this scope lives.
    _live: Option<Flock<fs::File>>,
}

impl Drop for Scope {
    fn drop(&mut self) {
        if self.removed_on_drop {
            removed_or_reported("storage template scope", &self.directory);
        }
    }
}

/// Like `TestDirectory`: a failed removal fails an otherwise green test, and is
/// only reported while a panic is already unwinding.
fn removed_or_reported(what: &str, directory: &Path) {
    if let Err(error) = fs::remove_dir_all(directory) {
        let message = format!("Could not remove {what} {}: {error}", directory.display());
        if std::thread::panicking() {
            eprintln!("{message}");
        } else {
            panic!("{message}");
        }
    }
}

enum ScopeKind {
    Run(String),
    Process,
}

struct ProcessSlot {
    live: Weak<Scope>,
    generation: u64,
}

pub(super) struct TemplateStore {
    root: PathBuf,
    kind: ScopeKind,
    process: Mutex<ProcessSlot>,
    stale_runs_pruned: Once,
    /// Test hook: runs after the builder's real open, before publication.
    after_build_open: fn(&Path),
}

impl TemplateStore {
    fn from_environment() -> Self {
        let temporary = fs::canonicalize(std::env::temp_dir())
            .expect("resolve the temporary directory for storage templates");
        let root = temporary.join(format!(
            "tmt-adapters-storage-template-{}",
            nix::unistd::geteuid().as_raw()
        ));
        let run = std::env::var("NEXTEST_RUN_ID").ok();
        Self::new(root, run, &forbidden_roots(), |_| {})
    }

    /// `forbidden` names host stores the root must never be inside of.
    pub(super) fn new(
        root: PathBuf,
        run: Option<String>,
        forbidden: &[PathBuf],
        after_build_open: fn(&Path),
    ) -> Self {
        assert!(root.is_absolute(), "storage template root must be absolute");
        let parent = root.parent().expect("storage template root has a parent");
        // Resolve the existing parent so a `/tmp` alias or a symlinked parent
        // cannot hide a host store; the root itself must not be a link.
        let resolved = fs::canonicalize(parent)
            .unwrap_or_else(|error| panic!("resolve {}: {error}", parent.display()))
            .join(root.file_name().expect("storage template root name"));
        for store in forbidden {
            if let Ok(store) = fs::canonicalize(store) {
                assert!(
                    !resolved.starts_with(&store),
                    "storage template root {} is inside host store {}",
                    root.display(),
                    store.display()
                );
            }
        }
        let root = resolved;
        let kind = match run {
            Some(run) => {
                assert!(is_run_id(&run), "unexpected NEXTEST_RUN_ID {run:?}");
                ScopeKind::Run(run)
            }
            None => ScopeKind::Process,
        };
        Self {
            root,
            kind,
            process: Mutex::new(ProcessSlot {
                live: Weak::new(),
                generation: 0,
            }),
            stale_runs_pruned: Once::new(),
            after_build_open,
        }
    }

    pub(super) fn place(&self, database: &Path) -> TemplateLease {
        let scope = self.scope();
        let key = scope.directory.join(key());
        private_directory(&key);
        let template = key.join(TEMPLATE);
        if !template.exists() {
            self.build(&key);
        }
        copy_and_admit(&template, database);
        TemplateLease { _scope: scope }
    }

    fn scope(&self) -> Arc<Scope> {
        private_directory(&self.root);
        match &self.kind {
            ScopeKind::Run(run) => {
                let name = format!("{RUN_SCOPE_PREFIX}{run}");
                let directory = self.root.join(&name);
                self.stale_runs_pruned
                    .call_once(|| prune_stale_run_scopes(&self.root, &name));
                let live = hold_run_scope(&directory);
                Arc::new(Scope {
                    directory,
                    removed_on_drop: false,
                    _live: Some(live),
                })
            }
            ScopeKind::Process => {
                // One lock orders acquisition against the final release: a new
                // scope always takes a new generation path, so it never meets a
                // directory that an old scope's drop is still removing.
                let mut slot = self.process.lock().expect("storage template scope lock");
                if let Some(scope) = slot.live.upgrade() {
                    return scope;
                }
                slot.generation += 1;
                let directory = self.root.join(format!(
                    "process-{}-{}-{}",
                    std::process::id(),
                    process_start_ns(),
                    slot.generation
                ));
                fs::DirBuilder::new()
                    .mode(0o700)
                    .create(&directory)
                    .unwrap_or_else(|error| {
                        panic!(
                            "create storage template scope {}: {error}",
                            directory.display()
                        )
                    });
                let scope = Arc::new(Scope {
                    directory,
                    removed_on_drop: true,
                    _live: None,
                });
                slot.live = Arc::downgrade(&scope);
                scope
            }
        }
    }

    /// Runs the real chain into a private build directory and publishes the
    /// closed main file. Losing to a concurrent builder is not an error.
    fn build(&self, key: &Path) {
        assert!(
            !crate::extension_hooks::capture_allowed(),
            "storage templates must not be built in a process that allows observer capture"
        );
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let build = BuildDirectory::create(key.join(format!(
            ".build-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        )));
        let database = build.0.join(TEMPLATE);
        let mut storage = Storage::open(&database)
            .unwrap_or_else(|error| panic!("build storage template: {error}"));
        (self.after_build_open)(&database);
        let connection = storage.connection().expect("storage template connection");
        let busy: i64 = connection
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| row.get(0))
            .expect("checkpoint storage template");
        assert_eq!(busy, 0, "storage template checkpoint was busy");
        // The copy carries no WAL; each case's real open turns WAL on again.
        let mode: String = connection
            .pragma_update_and_check(None, "journal_mode", "DELETE", |row| row.get(0))
            .expect("leave WAL in storage template");
        assert_eq!(mode, "delete", "storage template kept journal mode {mode}");
        storage.close().expect("close storage template");
        for suffix in ["-wal", "-shm"] {
            assert!(
                !sidecar(&database, suffix).exists(),
                "storage template left {suffix}"
            );
        }
        match fs::hard_link(&database, key.join(TEMPLATE)) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
            Err(error) => panic!("publish storage template in {}: {error}", key.display()),
        }
    }
}

/// Removes only its own builder directory, on success, error and panic.
struct BuildDirectory(PathBuf);

impl BuildDirectory {
    fn create(path: PathBuf) -> Self {
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .unwrap_or_else(|error| panic!("create {}: {error}", path.display()));
        Self(path)
    }
}

impl Drop for BuildDirectory {
    fn drop(&mut self) {
        removed_or_reported("storage template build", &self.0);
    }
}

fn copy_and_admit(template: &Path, database: &Path) {
    for path in [
        database.to_path_buf(),
        sidecar(database, "-wal"),
        sidecar(database, "-shm"),
        HookQueue::path(database),
    ] {
        assert!(
            !path.exists(),
            "storage template destination {} already exists",
            path.display()
        );
    }
    if let Some(parent) = database.parent() {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(parent)
            .unwrap_or_else(|error| panic!("create {}: {error}", parent.display()));
    }
    let copied = (|| {
        let mut source = fs::File::open(template)?;
        let mut target = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(database)?;
        io::copy(&mut source, &mut target)
    })();
    if let Err(error) = copied {
        panic!("copy storage template {}: {error}", template.display());
    }
    if let Err(reason) = admit(database) {
        panic!(
            "storage template {} failed admission: {reason}",
            template.display()
        );
    }
}

/// Checks the copy read-only before any real open can migrate or repair it.
/// This proves an intact file at the expected version history, not full
/// equivalence with a fresh chain; the equivalence control test owns that.
pub(super) fn admit(database: &Path) -> Result<(), String> {
    // Read the header first: SQLite opens a WAL-mode file, even read-only, by
    // creating WAL sidecars next to the copy.
    let mut header = [0; 20];
    io::Read::read_exact(
        &mut fs::File::open(database).map_err(|error| format!("read header: {error}"))?,
        &mut header,
    )
    .map_err(|error| format!("read header: {error}"))?;
    if &header[..16] != b"SQLite format 3\0" {
        return Err("not a SQLite database".into());
    }
    if header[18..20] != [1, 1] {
        return Err("journal mode wal in the file header".into());
    }
    let connection = Connection::open_with_flags(
        database,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("open: {error}"))?;
    let check: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|error| format!("quick_check: {error}"))?;
    if check != "ok" {
        return Err(format!("quick_check: {check}"));
    }
    let mode: String = connection
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .map_err(|error| format!("journal_mode: {error}"))?;
    if mode != "delete" {
        return Err(format!("journal mode {mode}"));
    }
    let versions = connection
        .prepare("SELECT version FROM _migrations ORDER BY version")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get::<_, u32>(0))?
                .collect::<Result<Vec<_>, _>>()
        })
        .map_err(|error| format!("migration history: {error}"))?;
    if versions != (1..=migrations::VERSION).collect::<Vec<_>>() {
        return Err(format!(
            "migration history {:?}..{:?} ({} entries), expected 1..={}",
            versions.first(),
            versions.last(),
            versions.len(),
            migrations::VERSION
        ));
    }
    Ok(())
}

/// Separates schema versions within one scope. It is not a build identity:
/// a scope never outlives the test run that made it.
fn key() -> String {
    let schema = migrations::compiled_schema();
    let mut encoded = Vec::new();
    let version = schema.version.to_string();
    let mut field = |value: &str| {
        encoded.extend((value.len() as u64).to_be_bytes());
        encoded.extend(value.as_bytes());
    };
    field(FORMAT);
    field(&version);
    for source in &schema.sources {
        field(source.path);
        field(&source.sha256);
    }
    tmt_core::content_digest::sha256(&encoded)
}

fn private_directory(path: &Path) {
    match fs::DirBuilder::new().mode(0o700).create(path) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
        Err(error) => panic!("create {}: {error}", path.display()),
    }
    assert!(
        directory_is_private(path),
        "storage template directory {} must be a real owner-only directory",
        path.display()
    );
}

fn is_run_id(run: &str) -> bool {
    !run.is_empty() && run.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Creates the run scope if needed and takes a shared lock on its lock file.
/// A collector removes a scope only while it holds the exclusive lock, so a
/// lock on a file that is no longer at its path means the scope was removed
/// meanwhile; the scope is then created again. A new scope is never stale, so
/// this repeats at most once per collection.
fn hold_run_scope(directory: &Path) -> Flock<fs::File> {
    let lock = directory.join(RUN_SCOPE_LOCK);
    loop {
        private_directory(directory);
        let file = match open_lock(&lock, true) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => panic!("open {}: {error}", lock.display()),
        };
        let held = Flock::lock(file, FlockArg::LockShared)
            .unwrap_or_else(|(_, error)| panic!("lock {}: {error}", lock.display()));
        if is_at_path(&held, &lock) {
            return held;
        }
    }
}

fn open_lock(path: &Path, create: bool) -> io::Result<fs::File> {
    fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(create)
        .mode(0o600)
        .custom_flags(OFlag::O_NOFOLLOW.bits())
        .open(path)
}

/// Whether `file` is still the file at `path`.
fn is_at_path(file: &fs::File, path: &Path) -> bool {
    let held = file.metadata().expect("inspect held storage template lock");
    fs::symlink_metadata(path)
        .is_ok_and(|current| current.dev() == held.dev() && current.ino() == held.ino())
}

/// Collects run scopes that earlier nextest runs left in this private root:
/// only real `run-*` directories owned by this user, older than
/// `STALE_RUN_SCOPE_AGE`, not `current`, and whose lock file this collector
/// can lock exclusively without waiting. A held lock means a live lease, so the
/// scope is kept whatever its age. A scope without a lock file is kept: it is
/// being created, or it predates the lock. Links are not followed, and
/// `remove_dir_all` does not follow links inside a scope. Another collector may
/// remove the same scope at the same time; that is not an error.
fn prune_stale_run_scopes(root: &Path, current: &str) {
    let uid = nix::unistd::geteuid().as_raw();
    let inspect = |error: io::Error| -> ! {
        panic!("inspect storage template root {}: {error}", root.display())
    };
    let collectable = |path: &Path| match fs::symlink_metadata(path) {
        Ok(metadata) => {
            metadata.file_type().is_dir()
                && metadata.uid() == uid
                && metadata
                    .modified()
                    .ok()
                    .and_then(|modified| SystemTime::now().duration_since(modified).ok())
                    .is_some_and(|age| age > STALE_RUN_SCOPE_AGE)
        }
        Err(error) if error.kind() == ErrorKind::NotFound => false,
        Err(error) => inspect(error),
    };
    for entry in fs::read_dir(root).unwrap_or_else(|error| inspect(error)) {
        let entry = entry.unwrap_or_else(|error| inspect(error));
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let is_run_scope = name.strip_prefix(RUN_SCOPE_PREFIX).is_some_and(is_run_id);
        let path = entry.path();
        if name == current || !is_run_scope || !collectable(&path) {
            continue;
        }
        let lock = path.join(RUN_SCOPE_LOCK);
        let file = match open_lock(&lock, false) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => inspect(error),
        };
        let held = match Flock::lock(file, FlockArg::LockExclusiveNonblock) {
            Ok(held) => held,
            Err((_, Errno::EWOULDBLOCK)) => continue,
            Err((_, error)) => panic!("lock {}: {error}", lock.display()),
        };
        // Check again under the lock: another collector may have removed the
        // scope, and a new run may have created it again.
        if !is_at_path(&held, &lock) || !collectable(&path) {
            continue;
        }
        match fs::remove_dir_all(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => panic!(
                "Could not remove stale storage template scope {}: {error}",
                path.display()
            ),
        }
        drop(held);
    }
}

fn forbidden_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = std::env::var_os("TMT_HOME") {
        roots.push(PathBuf::from(home));
    }
    if let Some(config) = std::env::var_os("XDG_CONFIG_HOME") {
        roots.push(PathBuf::from(config).join("tmt"));
    }
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(&home).join(".config").join("tmt"));
    }
    roots
}

fn process_start_ns() -> u128 {
    static START: OnceLock<u128> = OnceLock::new();
    *START.get_or_init(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos()
    })
}

fn sidecar(database: &Path, suffix: &str) -> PathBuf {
    let mut path = database.as_os_str().to_os_string();
    path.push(suffix);
    PathBuf::from(path)
}

/// For the scope tests: the published template and its inode, if any.
pub(super) fn published(store: &TemplateStore) -> Option<(PathBuf, u64)> {
    let scope = store.scope();
    let template = scope.directory.join(key()).join(TEMPLATE);
    fs::metadata(&template)
        .ok()
        .map(|metadata| (template, metadata.ino()))
}

#[cfg(test)]
mod tests;
