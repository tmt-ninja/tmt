//! A member's extra terminals (#5991). Each one is its own supervisor serving a login shell in
//! the member's launch directory, at `term_<32 hex>` beside the member supervisors. The
//! supervisor is the one record of whose terminal it is (`Control::Terminal`): Core keeps no
//! table, so nothing outlives the process. Only this module scans the directory, and only for
//! `term_` sockets; the member host never does, so a terminal is never a pane, binding or Talk
//! target.

use super::{Connection, socket_path};
use crate::{
    config::ConfigPaths,
    file_lock,
    private_file::ensure_private_directory,
    process::{
        UnixCommandRunner, detached,
        runtime::{ProcessObservation, observe_runtime_process},
    },
};
use std::{
    ffi::{OsStr, OsString},
    fs::{self, OpenOptions},
    io,
    os::unix::fs::OpenOptionsExt,
    path::Path,
    sync::mpsc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tmt_pty_protocol::{Control, ControlReply};

/// At most this many terminals per member.
pub const TERMINAL_LIMIT: usize = 8;
const PREFIX: &str = "term_";
/// One terminal's answer while listing; a supervisor slower than this is left out.
const PER_SOCKET: Duration = Duration::from_millis(500);
/// How long an open may wait for another open of the same member.
const OPEN_LOCK_WAIT: Duration = Duration::from_secs(2);
/// How long a closed terminal's process may take to end, for one or for all of a member's.
const CLOSE_WAIT: Duration = Duration::from_secs(5);

/// The member a terminal belongs to: its identity and its supervisor's incarnation.
pub struct Owner<'a> {
    pub identity: &'a str,
    pub server_pid: u64,
    pub server_start: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Terminal {
    pub id: String,
    pub socket: String,
    pub busy: bool,
    pub created_ms: u64,
}

#[derive(Debug)]
pub enum TerminalError {
    /// The member already has `TERMINAL_LIMIT` terminals.
    Limit,
    /// Nothing was started.
    NotStarted(io::Error),
    /// A supervisor may have started; never retried.
    Unconfirmed {
        id: String,
        cause: io::Error,
    },
    NotFound,
    /// A program other than the shell runs there and `force` was not given.
    Busy,
    /// `Close` was not confirmed, or the process did not end in time.
    CloseUnconfirmed(io::Error),
}

impl std::fmt::Display for TerminalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Limit => write!(f, "the member already has {TERMINAL_LIMIT} terminals"),
            Self::NotStarted(error) => write!(f, "no terminal was opened: {error}"),
            Self::Unconfirmed { id, cause } => write!(f, "terminal {id} is not confirmed: {cause}"),
            Self::NotFound => write!(f, "no such terminal"),
            Self::Busy => write!(f, "a program is still running in this terminal"),
            Self::CloseUnconfirmed(error) => write!(f, "closing is not confirmed: {error}"),
        }
    }
}

impl std::error::Error for TerminalError {}

/// What a terminal's shell starts without: tmux and pty host locators, approved hosts'
/// caller variables, and every agent runtime's session variables, so nothing run there is
/// taken for the member or for an agent.
pub fn environment() -> Vec<(OsString, Option<OsString>)> {
    let mut names: Vec<String> = crate::host::Host::pty_environment(Path::new("/"), "unused")
        .into_iter()
        .map(|(name, _)| name.to_string_lossy().into_owned())
        .collect();
    names.extend(
        crate::drivers::Registry::builtin()
            .session_env()
            .into_iter()
            .map(str::to_owned),
    );
    names.sort();
    names.dedup();
    names
        .into_iter()
        .map(|name| (OsString::from(name), None))
        .collect()
}

/// Whether the member supervisor `pid`, started at `start`, still runs. A reused PID with
/// another start is gone; an observation that fails keeps the terminal.
pub fn member_alive(pid: u64, start: String) -> Box<dyn FnMut() -> bool + Send> {
    Box::new(move || {
        match observe_runtime_process(
            &UnixCommandRunner,
            pid,
            Instant::now() + Duration::from_millis(300),
        ) {
            Ok(ProcessObservation::Live(process) | ProcessObservation::Stopped(process)) => {
                process.start_identity() == start
            }
            Ok(_) => false,
            Err(_) => true,
        }
    })
}

/// Whether `value` has the shape of a terminal id, `term_` and 32 lowercase hex digits.
pub fn is_terminal_id(value: &str) -> bool {
    value.strip_prefix(PREFIX).is_some_and(|hex| {
        hex.len() == 32
            && hex
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}

/// Unix milliseconds now.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| {
            u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
        })
}

/// Opens a terminal for `owner`, running `shell` in `directory`.
pub fn open(
    executable: &OsStr,
    paths: &ConfigPaths,
    owner: &Owner<'_>,
    directory: &Path,
    shell: &[String],
) -> Result<Terminal, TerminalError> {
    let pty = paths.pty_directory();
    ensure_private_directory(&pty).map_err(TerminalError::NotStarted)?;
    // Counting and starting are one step, so two opens cannot pass the limit.
    let _lock = open_lock(&pty, owner.identity).map_err(TerminalError::NotStarted)?;
    if list(paths, owner.identity).len() >= TERMINAL_LIMIT {
        return Err(TerminalError::Limit);
    }
    let id = format!("{PREFIX}{}", uuid::Uuid::new_v4().simple());
    super::validate(&pty, &id).map_err(TerminalError::NotStarted)?;
    let log_path = pty.join(format!("{id}.startup.log"));
    let log = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&log_path)
        .map_err(TerminalError::NotStarted)?;
    let created_ms = now_ms();
    let mut argv: Vec<OsString> = vec![
        "__pty-serve".into(),
        "--terminal-owner".into(),
        owner.identity.into(),
        "--member-pid".into(),
        owner.server_pid.to_string().into(),
        "--member-start".into(),
        owner.server_start.into(),
        "--created-ms".into(),
        created_ms.to_string().into(),
        "--terminal-directory".into(),
        directory.as_os_str().into(),
        pty.as_os_str().into(),
        id.clone().into(),
        "80".into(),
        "24".into(),
    ];
    argv.extend(shell.iter().map(OsString::from));
    let uncertain = |cause: io::Error| TerminalError::Unconfirmed {
        id: id.clone(),
        cause,
    };
    detached::start_line(executable, &argv, log, b"ready ").map_err(|error| {
        uncertain(io::Error::other(format!(
            "terminal startup is not confirmed: {error}; diagnostics: {}",
            log_path.display()
        )))
    })?;
    let terminal = ask(&pty, &id, Instant::now() + Duration::from_secs(3)).map_err(uncertain)?;
    let _ = fs::remove_file(&log_path);
    match terminal {
        Some(terminal) if terminal.0 == owner.identity => Ok(Terminal {
            socket: socket_path(&pty, &id).to_string_lossy().into_owned(),
            id,
            busy: terminal.2,
            created_ms: terminal.1,
        }),
        _ => Err(uncertain(io::Error::other(
            "the terminal did not name its owner",
        ))),
    }
}

/// The live terminals of `identity`, oldest first. Each supervisor is asked within
/// `PER_SOCKET`; one that does not answer, or names another owner, is left out.
pub fn list(paths: &ConfigPaths, identity: &str) -> Vec<Terminal> {
    let pty = paths.pty_directory();
    let mut terminals: Vec<_> = terminal_ids(&pty)
        .into_iter()
        .filter_map(|id| {
            let (owner, created_ms, busy) =
                ask(&pty, &id, Instant::now() + PER_SOCKET).ok().flatten()?;
            (owner == identity).then(|| Terminal {
                socket: socket_path(&pty, &id).to_string_lossy().into_owned(),
                id,
                busy,
                created_ms,
            })
        })
        .collect();
    terminals.sort_by(|a, b| a.created_ms.cmp(&b.created_ms).then(a.id.cmp(&b.id)));
    terminals
}

/// Closes terminal `id`: refused while busy unless `force`, then confirmed once its
/// supervisor ended.
pub fn close(paths: &ConfigPaths, id: &str, force: bool) -> Result<(), TerminalError> {
    let pty = paths.pty_directory();
    if !is_terminal_id(id) || super::validate(&pty, id).is_err() {
        return Err(TerminalError::NotFound);
    }
    let Some((_, _, busy)) = ask(&pty, id, Instant::now() + PER_SOCKET).ok().flatten() else {
        return Err(TerminalError::NotFound);
    };
    if busy && !force {
        return Err(TerminalError::Busy);
    }
    close_now(&pty, id, Instant::now() + CLOSE_WAIT)
}

/// Closes every terminal of `identity` at once, within one `CLOSE_WAIT`; returns the ids
/// still running afterwards. Used when the member is closed or removed.
pub fn close_all(paths: &ConfigPaths, identity: &str) -> Vec<String> {
    let pty = paths.pty_directory();
    let deadline = Instant::now() + CLOSE_WAIT;
    let (sender, results) = mpsc::channel();
    let ids: Vec<_> = list(paths, identity).into_iter().map(|t| t.id).collect();
    for id in &ids {
        let (sender, pty, id) = (sender.clone(), pty.clone(), id.clone());
        std::thread::spawn(move || {
            let closed = close_now(&pty, &id, deadline).is_ok();
            let _ = sender.send((id, closed));
        });
    }
    drop(sender);
    let mut left = Vec::new();
    let mut answered = 0;
    while answered < ids.len() {
        let wait = deadline.saturating_duration_since(Instant::now()) + Duration::from_millis(200);
        match results.recv_timeout(wait) {
            Ok((id, closed)) => {
                answered += 1;
                if !closed {
                    left.push(id);
                }
            }
            Err(_) => break,
        }
    }
    // A close that never answered counts as still running.
    let unanswered: Vec<_> = ids
        .into_iter()
        .filter(|id| socket_path(&pty, id).exists() && !left.contains(id))
        .collect();
    left.extend(unanswered);
    left.sort();
    left.dedup();
    left
}

fn close_now(pty: &Path, id: &str, deadline: Instant) -> Result<(), TerminalError> {
    let mut client =
        Connection::connect_until(pty, id, deadline).map_err(|_| TerminalError::NotFound)?;
    let remaining = deadline.saturating_duration_since(Instant::now());
    match client.control(Control::Close, remaining.max(Duration::from_millis(1))) {
        Ok(ControlReply::Applied(true)) => {}
        Ok(other) => {
            return Err(TerminalError::CloseUnconfirmed(io::Error::other(format!(
                "unexpected answer {other:?}"
            ))));
        }
        Err(error) => return Err(TerminalError::CloseUnconfirmed(error)),
    }
    drop(client);
    // The supervisor removes its socket when it has ended.
    while socket_path(pty, id).exists() {
        if Instant::now() >= deadline {
            return Err(TerminalError::CloseUnconfirmed(io::Error::new(
                io::ErrorKind::TimedOut,
                "the terminal did not end in time",
            )));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    Ok(())
}

/// `(owner, created_ms, busy)` from a terminal supervisor, `None` from anything else.
fn ask(pty: &Path, id: &str, deadline: Instant) -> io::Result<Option<(String, u64, bool)>> {
    let mut client = Connection::connect_until(pty, id, deadline)?;
    let remaining = deadline.saturating_duration_since(Instant::now());
    Ok(
        match client.control(Control::Terminal, remaining.max(Duration::from_millis(1)))? {
            ControlReply::Terminal {
                owner,
                created_ms,
                busy,
            } => Some((owner, created_ms, busy)),
            _ => None,
        },
    )
}

/// The `term_` ids with a socket in the pty directory.
fn terminal_ids(pty: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(pty) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let id = name.strip_suffix(".sock")?;
            (id.starts_with(PREFIX) && super::validate(pty, id).is_ok()).then(|| id.to_owned())
        })
        .collect()
}

/// One open at a time per member. The name is not a supervisor id, so startup reclamation
/// leaves it alone.
fn open_lock(pty: &Path, identity: &str) -> io::Result<nix::fcntl::Flock<fs::File>> {
    let path = pty.join(format!("open-{}.lock", identity.replace('-', "")));
    let deadline = Instant::now() + OPEN_LOCK_WAIT;
    loop {
        match file_lock::exclusive(&path) {
            Ok(lock) => return Ok(lock),
            Err(error)
                if error.kind() == io::ErrorKind::WouldBlock && Instant::now() < deadline =>
            {
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(error) => return Err(error),
        }
    }
}
