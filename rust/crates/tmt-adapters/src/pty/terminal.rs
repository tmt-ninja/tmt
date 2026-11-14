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
    /// The name of the terminal's shell, from a supervisor that reports it (#6112).
    pub shell: Option<String>,
    /// The name of the program in the foreground, only while `busy` and known.
    pub program: Option<String>,
}

/// What a terminal supervisor says about itself.
struct Answer {
    owner: String,
    created_ms: u64,
    busy: bool,
    shell: Option<String>,
    program: Option<String>,
}

impl Answer {
    fn terminal(self, pty: &Path, id: String) -> Terminal {
        Terminal {
            socket: socket_path(pty, &id).to_string_lossy().into_owned(),
            id,
            busy: self.busy,
            created_ms: self.created_ms,
            shell: self.shell,
            program: self.program,
        }
    }
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

/// How often a terminal compares its member supervisor's start identity, off its loop.
const START_CHECK: Duration = Duration::from_secs(30);

/// Whether the member supervisor `pid`, started at `start`, still runs. It is called on the
/// supervisor's loop, so each call only signals the PID (`kill(pid, 0)`, no fork, no wait):
/// a PID that is gone ends the terminal. The start identity, which needs `ps`, is compared on a
/// helper thread at the first call and then every `START_CHECK`; a reused PID with another
/// start is gone. An observation that fails keeps the terminal: unknown never ends it.
pub fn member_alive(pid: u64, start: String) -> Box<dyn FnMut() -> bool + Send> {
    member_alive_every(pid, start, START_CHECK)
}

fn member_alive_every(pid: u64, start: String, every: Duration) -> Box<dyn FnMut() -> bool + Send> {
    let mut checked: Option<Instant> = None;
    let mut pending: Option<mpsc::Receiver<bool>> = None;
    Box::new(move || {
        let Ok(raw) = i32::try_from(pid) else {
            return false;
        };
        if nix::sys::signal::kill(nix::unistd::Pid::from_raw(raw), None)
            == Err(nix::errno::Errno::ESRCH)
        {
            return false;
        }
        if let Some(answer) = &pending {
            match answer.try_recv() {
                Ok(same) => {
                    pending = None;
                    if !same {
                        return false;
                    }
                }
                Err(mpsc::TryRecvError::Disconnected) => pending = None,
                Err(mpsc::TryRecvError::Empty) => {}
            }
        }
        if pending.is_none() && checked.is_none_or(|at| at.elapsed() >= every) {
            checked = Some(Instant::now());
            let (sender, answer) = mpsc::channel();
            let start = start.clone();
            std::thread::spawn(move || {
                let same = match observe_runtime_process(
                    &UnixCommandRunner,
                    pid,
                    Instant::now() + Duration::from_secs(3),
                ) {
                    Ok(
                        ProcessObservation::Live(process) | ProcessObservation::Stopped(process),
                    ) => process.start_identity() == start,
                    Ok(_) => false,
                    Err(_) => true,
                };
                let _ = sender.send(same);
            });
            pending = Some(answer);
        }
        true
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
    detached::start_line(executable, &argv, log, b"ready ", None).map_err(|error| {
        uncertain(io::Error::other(format!(
            "terminal startup is not confirmed: {error}; diagnostics: {}",
            log_path.display()
        )))
    })?;
    let terminal = ask(&pty, &id, Instant::now() + Duration::from_secs(3)).map_err(uncertain)?;
    let _ = fs::remove_file(&log_path);
    match terminal {
        Some(answer) if answer.owner == owner.identity => Ok(answer.terminal(&pty, id)),
        _ => Err(uncertain(io::Error::other(
            "the terminal did not name its owner",
        ))),
    }
}

/// The live terminals of `identity`, oldest first. All supervisors are asked in parallel
/// within one `PER_SOCKET`; one that does not answer, or names another owner, is left out.
pub fn list(paths: &ConfigPaths, identity: &str) -> Vec<Terminal> {
    let pty = paths.pty_directory();
    // Every supervisor is asked at once, so hung ones cost one `PER_SOCKET` in all.
    let deadline = Instant::now() + PER_SOCKET;
    let (sender, answers) = mpsc::channel();
    let ids = terminal_ids(&pty);
    for id in &ids {
        let (sender, pty, id) = (sender.clone(), pty.clone(), id.clone());
        std::thread::spawn(move || {
            let answer = ask(&pty, &id, deadline).ok().flatten();
            let _ = sender.send((id, answer));
        });
    }
    drop(sender);
    let mut terminals = Vec::new();
    for _ in &ids {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok((id, answer)) = answers.recv_timeout(remaining + Duration::from_millis(50)) else {
            break;
        };
        if let Some(answer) = answer
            && answer.owner == identity
        {
            terminals.push(answer.terminal(&pty, id));
        }
    }
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
    let Some(answer) = ask(&pty, id, Instant::now() + PER_SOCKET).ok().flatten() else {
        return Err(TerminalError::NotFound);
    };
    if answer.busy && !force {
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

/// What a terminal supervisor says about itself, `None` from anything else. A
/// supervisor that grants the terminal-detail capability also names its shell and
/// foreground program; an older one is asked the released `Control::Terminal`.
fn ask(pty: &Path, id: &str, deadline: Instant) -> io::Result<Option<Answer>> {
    let mut client = Connection::connect_until(pty, id, deadline)?;
    let remaining = || {
        deadline
            .saturating_duration_since(Instant::now())
            .max(Duration::from_millis(1))
    };
    let detail = matches!(
        client.control(Control::Capabilities, remaining())?,
        ControlReply::Capabilities {
            terminal_detail: true,
            ..
        }
    );
    let request = if detail {
        Control::TerminalDetail
    } else {
        Control::Terminal
    };
    Ok(match client.control(request, remaining())? {
        ControlReply::Terminal {
            owner,
            created_ms,
            busy,
        } => Some(Answer {
            owner,
            created_ms,
            busy,
            shell: None,
            program: None,
        }),
        ControlReply::TerminalDetail {
            owner,
            created_ms,
            busy,
            shell,
            program,
        } => Some(Answer {
            owner,
            created_ms,
            busy,
            shell,
            program,
        }),
        _ => None,
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    fn own_start() -> String {
        match observe_runtime_process(
            &UnixCommandRunner,
            u64::from(std::process::id()),
            Instant::now() + Duration::from_secs(3),
        )
        .unwrap()
        {
            ProcessObservation::Live(process) => process.start_identity().to_owned(),
            other => panic!("{other:?}"),
        }
    }

    /// Calls the check as the supervisor loop does until `until` holds; every call must
    /// return at once, since the start comparison runs on a helper thread.
    fn calls_until(check: &mut Box<dyn FnMut() -> bool + Send>, until: bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let started = Instant::now();
            let alive = check();
            assert!(
                started.elapsed() < Duration::from_millis(50),
                "the check blocked the loop for {:?}",
                started.elapsed()
            );
            if alive == until {
                return;
            }
            assert!(Instant::now() < deadline, "never {until}");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn the_member_check_never_blocks_and_ends_only_on_proof() {
        let pid = u64::from(std::process::id());
        // The same incarnation stays alive through several start comparisons.
        let mut same = member_alive_every(pid, own_start(), Duration::from_millis(20));
        let until = Instant::now() + Duration::from_millis(300);
        while Instant::now() < until {
            calls_until(&mut same, true);
        }

        // A live PID with another start is a reused PID: gone, found off the loop.
        let mut reused = member_alive_every(pid, "ps-v1:another".into(), START_CHECK);
        calls_until(&mut reused, false);

        // A PID that is gone ends the terminal on the first call.
        let mut child = std::process::Command::new("/bin/sh")
            .args(["-c", "exit 0"])
            .spawn()
            .unwrap();
        let gone = u64::from(child.id());
        child.wait().unwrap();
        let mut ended = member_alive_every(gone, own_start(), START_CHECK);
        assert!(!ended());
    }
}
