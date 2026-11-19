//! Opt-in diagnostics for acquisition and successfully painted board milestones.
//! Stable record names and milestone semantics live in the Ops refresh guide.

use serde_json::json;
use std::{
    cell::Cell,
    ffi::OsStr,
    fs::{DirBuilder, File, OpenOptions},
    io::{self, Write},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

const ENV: &str = "TMT_OPS_TIMING_TRACE";
const DEFAULT_LIMIT: u64 = 8 * 1024 * 1024;

enum Destination {
    Off,
    BoardCache,
    File(std::path::PathBuf),
}

fn destination(value: Option<&OsStr>) -> Destination {
    match value {
        None => Destination::Off,
        Some(value) if value.is_empty() || value == "0" => Destination::Off,
        Some(value) if value == "1" => Destination::BoardCache,
        Some(value) => Destination::File(value.into()),
    }
}

enum Sink {
    File {
        file: File,
        limit: Option<u64>,
    },
    Disabled,
    #[cfg(test)]
    Buffer(Arc<Mutex<Vec<u8>>>),
}

impl Sink {
    fn write(&mut self, bytes: &[u8]) -> io::Result<()> {
        match self {
            Self::File { file, limit } => {
                if let Some(limit) = *limit
                    && file.metadata()?.len().saturating_add(bytes.len() as u64) > limit
                {
                    return Err(io::Error::other("board timing log reached its 8 MiB limit"));
                }
                file.write_all(bytes)?;
                file.flush()
            }
            Self::Disabled => Ok(()),
            #[cfg(test)]
            Self::Buffer(buffer) => {
                buffer.lock().unwrap().extend_from_slice(bytes);
                Ok(())
            }
        }
    }
}

struct State {
    started: Instant,
    next: AtomicU64,
    sink: Mutex<Sink>,
    failure: Arc<Mutex<Option<io::Error>>>,
}

#[derive(Clone)]
pub(super) struct Trace(Arc<State>);

/// One failure for the invocation. Workers retain the error without owning stderr.
#[derive(Default)]
pub(super) struct Reports {
    failure: Arc<Mutex<Option<io::Error>>>,
    screen_owned: Cell<bool>,
}

impl Reports {
    pub fn screen_entered(&self) {
        self.screen_owned.set(true);
    }

    pub fn screen_restored(&self) {
        self.screen_owned.set(false);
    }

    pub fn flush(&self) {
        if !self.screen_owned.get()
            && let Some(error) = self.failure.lock().unwrap().take()
        {
            let _ = writeln!(
                tmt_cli_style::stream::stderr(),
                "Ops timing trace disabled: {error}"
            );
        }
    }
}

impl Drop for Reports {
    fn drop(&mut self) {
        self.flush();
    }
}

fn open_file(path: &Path, limit: Option<u64>) -> io::Result<Sink> {
    let file = OpenOptions::new()
        .append(true)
        .create(true)
        .mode(0o600)
        .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK)
        .open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(io::Error::other("trace destination must be a regular file"));
    }
    if limit.is_some() {
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err(io::Error::other("board timing log must be private"));
        }
        // Hold the nonblocking exclusive lock for this default sink so two
        // boards cannot both append a record across the hard size cap.
        file.try_lock().map_err(io::Error::from)?;
    }
    Ok(Sink::File { file, limit })
}

fn open_default() -> io::Result<Sink> {
    let directory = crate::cache::directory("board")
        .ok_or_else(|| io::Error::other("no Ops board cache directory"))?;
    DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&directory)?;
    open_file(&directory.join("timing.jsonl"), Some(DEFAULT_LIMIT))
}

impl Trace {
    pub fn from_env(reports: &Reports) -> Option<Self> {
        Self::open(destination(std::env::var_os(ENV).as_deref()), reports)
    }

    fn open(destination: Destination, reports: &Reports) -> Option<Self> {
        let sink = match destination {
            Destination::Off => return None,
            Destination::BoardCache => open_default(),
            Destination::File(path) => open_file(&path, None),
        };
        match sink {
            Ok(sink) => Some(Self::new(sink, reports.failure.clone())),
            Err(error) => {
                reports.failure.lock().unwrap().get_or_insert(error);
                None
            }
        }
    }

    fn new(sink: Sink, failure: Arc<Mutex<Option<io::Error>>>) -> Self {
        Self(Arc::new(State {
            started: Instant::now(),
            next: AtomicU64::new(1),
            sink: Mutex::new(sink),
            failure,
        }))
    }

    #[cfg(test)]
    pub fn buffer() -> (Self, Arc<Mutex<Vec<u8>>>) {
        let buffer = Arc::new(Mutex::new(Vec::new()));
        (
            Self::new(Sink::Buffer(buffer.clone()), Arc::default()),
            buffer,
        )
    }

    /// Test evidence only. Resolve once at interactive startup, never per key.
    pub fn navigation_from_env(reports: &Reports) -> Option<Self> {
        Self::navigation_destination(
            std::env::var_os("TMT_OPS_TEST_KEY_TRACE").as_deref(),
            reports,
        )
    }

    fn navigation_destination(value: Option<&OsStr>, reports: &Reports) -> Option<Self> {
        match value {
            None => None,
            Some(value) if value.is_empty() || value == "0" => None,
            Some(path) => Self::open(Destination::File(path.into()), reports),
        }
    }

    pub(super) fn navigation(&self, mut record: serde_json::Value) {
        record["version"] = json!(1);
        record["pid"] = json!(std::process::id());
        record["elapsed_us"] = json!(self.0.started.elapsed().as_micros());
        self.record(&record);
    }

    fn record(&self, record: &serde_json::Value) {
        let mut sink = self.0.sink.lock().unwrap();
        if matches!(*sink, Sink::Disabled) {
            return;
        }
        let mut bytes = serde_json::to_vec(record).expect("diagnostic record is JSON");
        bytes.push(b'\n');
        if let Err(error) = sink.write(&bytes) {
            *sink = Sink::Disabled;
            self.0.failure.lock().unwrap().get_or_insert(error);
        }
    }

    pub fn startup(&self) -> Load {
        Load {
            trace: self.clone(),
            id: 0,
            generation: None,
            tab: None,
            partial: false,
            pending: false,
        }
    }

    pub fn load(&self, tab: Option<&str>, generation: u64) -> Load {
        Load {
            trace: self.clone(),
            id: self.0.next.fetch_add(1, Ordering::Relaxed),
            generation: Some(generation),
            tab: tab.map(str::to_owned),
            partial: false,
            pending: false,
        }
    }
}

#[derive(Clone)]
pub(super) struct Load {
    trace: Trace,
    id: u64,
    generation: Option<u64>,
    tab: Option<String>,
    partial: bool,
    pending: bool,
}

impl Load {
    pub fn completed(&mut self, snapshot: &super::app::Snapshot, pending: bool) {
        self.tab.clone_from(&snapshot.squad);
        self.partial = snapshot
            .view
            .as_ref()
            .is_ok_and(|view| view.document["partial"] == true);
        self.pending = pending;
    }

    fn emit(&self, event: &str, stage: &str, duration: Duration, ok: bool) {
        let record = json!({
            "version": 1, "pid": std::process::id(), "load_id": self.id,
            "generation": self.generation, "tab": self.tab, "event": event, "stage": stage,
            "duration_us": duration.as_micros(), "elapsed_us": self.trace.0.started.elapsed().as_micros(),
            "status": if !ok { "error" } else if self.partial { "partial" } else { "ok" },
            "deferred_pending": self.pending,
        });
        self.trace.record(&record);
    }

    pub fn finish(&self, started: Instant, ok: bool) {
        self.emit("stage", "load", started.elapsed(), ok);
    }
}

pub(super) fn measure<T, E>(
    trace: Option<&Load>,
    stage: &str,
    work: impl FnOnce() -> Result<T, E>,
) -> Result<T, E> {
    measured(trace, stage, work, Instant::now)
}

fn measured<T, E>(
    trace: Option<&Load>,
    stage: &str,
    work: impl FnOnce() -> Result<T, E>,
    now: impl FnOnce() -> Instant,
) -> Result<T, E> {
    let Some(trace) = trace else {
        return work();
    };
    let started = now();
    let result = work();
    trace.emit("stage", stage, started.elapsed(), result.is_ok());
    result
}

pub(super) struct Ui {
    trace: Trace,
    first: bool,
    fresh: bool,
    pending: Option<Load>,
}

impl Ui {
    pub fn new(trace: Trace) -> Self {
        Self {
            trace,
            first: false,
            fresh: false,
            pending: None,
        }
    }

    pub fn snapshot(&mut self, load: Option<Load>, accepted: bool) {
        if !self.fresh {
            self.pending = if accepted { load } else { None };
        }
    }

    /// Called only after a successful draw, never on acquisition.
    pub fn drawn(&mut self, tab: Option<&str>, usable: bool) {
        if !self.first {
            let mut first = self.trace.startup();
            first.tab = tab.map(str::to_owned);
            first.emit("first_frame", "draw", self.trace.0.started.elapsed(), true);
            self.first = true;
        }
        if !self.fresh
            && let Some(load) = self.pending.take()
            && usable
            && load.tab.as_deref() == tab
        {
            load.emit("fresh_board", "draw", self.trace.0.started.elapsed(), true);
            self.fresh = true;
        }
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
pub(in crate::board) mod probe;
