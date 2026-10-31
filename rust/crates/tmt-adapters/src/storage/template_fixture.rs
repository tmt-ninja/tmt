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
//!   that one test run owns: `NEXTEST_RUN_ID` under nextest (left for the run
//!   owner, such as the CI private world), else a process scope that the last
//!   lease removes on drop. A template is never reused by a later run.
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
        Arc, Mutex, OnceLock, Weak,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OpenFlags};

use super::{Storage, hook_queue::HookQueue, migrations};
use crate::private_file::directory_is_private;

const FORMAT: &str = "tmt-adapters-storage-template-v1";
const TEMPLATE: &str = "template.db";

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
    /// Only a process scope is removed by its last lease; a run scope belongs
    /// to the run owner.
    removed_on_drop: bool,
}

impl Drop for Scope {
    fn drop(&mut self) {
        if self.removed_on_drop
            && let Err(error) = fs::remove_dir_all(&self.directory)
            && error.kind() != ErrorKind::NotFound
        {
            eprintln!(
                "Could not remove storage template scope {}: {error}",
                self.directory.display()
            );
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
                assert!(
                    !run.is_empty() && run.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
                    "unexpected NEXTEST_RUN_ID {run:?}"
                );
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
                let directory = self.root.join(format!("run-{run}"));
                private_directory(&directory);
                Arc::new(Scope {
                    directory,
                    removed_on_drop: false,
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
        if let Err(error) = fs::remove_dir_all(&self.0) {
            eprintln!(
                "Could not remove storage template build {}: {error}",
                self.0.display()
            );
        }
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
