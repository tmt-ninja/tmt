//! One member's supervisor: it owns the pseudo-terminal the program runs on and
//! serves it to attached clients over a private Unix socket.
//!
//! A single thread polls the listener, the terminal and every client, so no
//! state is shared. Output is read whether or not anyone is attached. While a
//! client lags far behind, reading pauses so the program slows to its pace; a
//! client that stops reading altogether is evicted, never buffered without bound.
//!
//! The terminal belongs to the member, not to one run of its program (#5988):
//! when the program ends the supervisor tells its clients (`Exited`) and keeps
//! serving the same terminal and screen until Core relaunches a program on it
//! (`Control::Relaunch`) or closes it (`Control::Close`).

use super::{lock_path, socket_path, validate};
use crate::{file_lock, private_file::ensure_private_directory};
use nix::{
    errno::Errno,
    fcntl::{FcntlArg, FdFlag, Flock, OFlag, fcntl, open},
    poll::{PollFd, PollFlags, PollTimeout, poll},
    pty::{Winsize, openpty},
    sys::{
        signal::{Signal, killpg},
        stat::Mode,
        termios::{SetArg, Termios, tcgetattr, tcsetattr},
        wait::{WaitPidFlag, WaitStatus, waitpid},
    },
    unistd::{Pid, tcgetpgrp, ttyname},
};
use std::{
    collections::VecDeque,
    ffi::OsString,
    fs::{self, File},
    io::{self, Read, Write},
    os::fd::AsFd,
    os::unix::{
        fs::PermissionsExt,
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    process::{Child, Command},
    time::{Duration, Instant},
};
use tmt_pty_protocol::{
    ClientMessage, Control, ControlReply, Decoder, Eviction, Exit, Frame, MAX_OUTPUT, MAX_PAYLOAD,
    Refusal, RelaunchKind, ServerMessage, Size, VERSION,
};

/// How often the program's end and job-control state are checked when nothing
/// else wakes the loop.
const TICK: u16 = 200;
/// The bound on one native read of the terminal's foreground group leader.
const FOREGROUND_READ: Duration = Duration::from_millis(50);
pub(super) const MAX_CLIENTS: usize = 16;
/// A client that has not completed the handshake by then is dropped.
const HELLO_DEADLINE: Duration = Duration::from_secs(5);
/// Queued output at which reading the program pauses until clients catch up.
const SOFT_BACKLOG: usize = 256 * 1024;
/// A client with output queued that has read none of it for this long is evicted.
const STALL: Duration = Duration::from_secs(3);
/// Keystrokes waiting for the program; clients are not read while above it.
const INPUT_HIGH_WATER: usize = 64 * 1024;
/// How long a closing client may take to read its last frame.
const CLOSING_GRACE: Duration = Duration::from_secs(1);
/// How long the program's last output and exit may take to reach clients.
const FLUSH_GRACE: Duration = Duration::from_millis(500);
/// Opportunistic crash cleanup must not grow with the member directory.
const RECLAIM_ENTRIES: usize = 64;
/// How long a program hung up by `Control::Close` may take to end before its
/// groups are killed.
const HANGUP_GRACE: Duration = Duration::from_secs(2);
/// How long a relaunched agent launcher may run without publishing its marker before
/// it is hung up, which restores the member it replaced. Longer than Core's wait for
/// the admission (`host::pty`'s 60 s), so a launch Core still awaits is never cut.
const RELAUNCH_ADMISSION: Duration = Duration::from_secs(90);
/// How often an extra terminal checks that its member still runs.
const OWNER_CHECK: Duration = Duration::from_secs(1);

/// Where and how to run one member.
pub struct Launch {
    /// The owner-only directory holding the member's socket and lock.
    pub directory: PathBuf,
    /// The member's id (see `pty::socket_path`); unique per run.
    pub id: String,
    /// The terminal's initial size.
    pub size: Size,
    /// The program and its arguments; the first word is looked up in `PATH`.
    /// The program inherits this process's environment and working directory.
    pub program: Vec<OsString>,
    /// Child-only host locators and inherited-host removals.
    pub environment: Vec<(OsString, Option<OsString>)>,
    /// Set for one of a member's extra terminals (#5991) instead of the member itself.
    pub terminal: Option<TerminalOf>,
}

/// Whose extra terminal a supervisor serves. It has no binding and no kept terminal: it
/// ends when its shell ends, when Core closes it, or when its member is gone.
pub struct TerminalOf {
    /// The identity UUID the terminal was opened for.
    pub owner: String,
    /// When it was opened, in Unix milliseconds.
    pub created_ms: u64,
    /// Whether the owner's member supervisor still runs (its PID and start time), asked
    /// once per `OWNER_CHECK`.
    pub member_alive: Box<dyn FnMut() -> bool + Send>,
}

/// The display name of the shell a terminal started: the file name of its first
/// program word, without the dash a login shell's name may carry.
fn shell_name(program: &std::ffi::OsStr) -> Option<String> {
    let name = Path::new(program).file_name()?.to_string_lossy();
    tmt_pty_protocol::display_name(name.trim_start_matches('-'))
}

/// The socket and lock files of a running supervisor, removed when it ends. Ids
/// are never reused, so removing the lock cannot split a lock domain.
struct Files {
    socket: PathBuf,
    lock: PathBuf,
}

impl Drop for Files {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.socket);
        let _ = fs::remove_file(&self.lock);
    }
}

enum Fate {
    Leave,
    Evict(Eviction),
    Refuse(Refusal),
}

/// Encoded frames waiting for a client, with the progress into the first.
#[derive(Default)]
struct Outbox {
    frames: VecDeque<Vec<u8>>,
    offset: usize,
    queued: usize,
}

impl Outbox {
    fn push(&mut self, frame: Vec<u8>) {
        self.queued += frame.len();
        self.frames.push_back(frame);
    }

    fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    /// Writes until the socket would block and returns how many bytes it took.
    fn flush(&mut self, mut stream: &UnixStream) -> io::Result<usize> {
        let mut written = 0;
        while let Some(frame) = self.frames.front() {
            match stream.write(&frame[self.offset..]) {
                Ok(0) => return Err(io::ErrorKind::WriteZero.into()),
                Ok(count) => {
                    written += count;
                    self.offset += count;
                    self.queued -= count;
                    if self.offset == frame.len() {
                        self.frames.pop_front();
                        self.offset = 0;
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) => return Err(error),
            }
        }
        Ok(written)
    }

    /// Drops every frame not yet started, so a final frame can follow cleanly.
    fn keep_only_started(&mut self) {
        let started = (self.offset > 0).then(|| self.frames.pop_front()).flatten();
        self.frames.clear();
        self.queued = 0;
        if let Some(frame) = started {
            self.queued = frame.len() - self.offset;
            self.frames.push_back(frame);
        }
    }
}

struct Client {
    id: u64,
    stream: UnixStream,
    decoder: Decoder,
    outbox: Outbox,
    welcomed: bool,
    wait_launch: bool,
    wait_launcher: bool,
    /// Set by the client's own `Resize`; a client without one never moves the window.
    size: Option<Size>,
    since: Instant,
    /// The last time the client took output, or the outbox last went from empty.
    progress: Instant,
    fate: Option<Fate>,
    /// Set once a final frame is queued: the client is dropped when it is
    /// delivered or this deadline passes.
    closing_until: Option<Instant>,
}

impl Client {
    fn live(&self) -> bool {
        self.fate.is_none() && self.closing_until.is_none()
    }

    /// Far enough behind that the program should wait for it.
    fn congested(&self) -> bool {
        self.welcomed && self.live() && self.outbox.queued >= SOFT_BACKLOG
    }

    fn enqueue(&mut self, frame: Vec<u8>) {
        if self.outbox.is_empty() {
            self.progress = Instant::now();
        }
        self.outbox.push(frame);
    }

    fn queue(&mut self, message: &ServerMessage) {
        self.enqueue(message.encode());
    }

    fn close_with(&mut self, message: &ServerMessage, now: Instant) {
        self.outbox.keep_only_started();
        self.queue(message);
        self.closing_until = Some(now + CLOSING_GRACE);
    }
}

/// What one poll reported.
struct Ready {
    listener: bool,
    master_read: bool,
    master_write: bool,
    clients: Vec<PollFlags>,
}

#[derive(PartialEq, Eq)]
enum Pump {
    /// Nothing more to read right now.
    Idle,
    /// The budget ran out; more may be pending.
    More,
    /// The program closed its end of the terminal.
    Closed,
}

/// A started member: the lock is held, the socket is bound and the program runs.
pub struct Supervisor {
    listener: UnixListener,
    master: File,
    /// The program running on the terminal; `None` once it ended and before a
    /// relaunch, while the terminal is kept.
    child: Option<Child>,
    /// What the running child was relaunched as; `None` for the first program.
    child_kind: Option<RelaunchKind>,
    /// The process a binding's marker belongs to: the first program, or the
    /// last relaunched agent launcher. A shell never takes it, so the member's
    /// binding outlives an ended agent and the shell that follows it.
    member_pid: u32,
    /// The member process and marker a relaunched agent launcher replaced, until it
    /// publishes its own marker. A launcher that ends before that (a refused resume)
    /// never bound, so they are restored and the member's binding is unchanged.
    replaced: Option<(u32, Option<(String, String)>)>,
    /// When the relaunched launcher started, and when it was hung up for missing its
    /// admission (`RELAUNCH_ADMISSION`); both end with `replaced`.
    relaunched_at: Instant,
    admission_hangup: Option<Instant>,
    admission: Duration,
    /// How the last program ended, while no program runs.
    ended: Option<Exit>,
    /// The terminal's device. A relaunch opens it again rather than keeping a
    /// descriptor: a kept descriptor would hide the end of the program's output
    /// (the master never sees the last close), and macOS revokes every
    /// descriptor of a controlling terminal when its session leader exits.
    slave_path: PathBuf,
    /// The settings the terminal started with; each relaunch starts on them, so
    /// a program that ended in raw mode cannot hand that to the next one.
    settings: Termios,
    /// Child-only host locators, applied again to every relaunched program.
    environment: Vec<(OsString, Option<OsString>)>,
    /// The terminal still has an open slave end (a program may still write).
    master_open: bool,
    /// `Control::Close` was received: the loop ends after this tick.
    closing: bool,
    size: Size,
    clients: Vec<Client>,
    next_client: u64,
    /// The client whose window the terminal follows.
    active: Option<u64>,
    input: VecDeque<u8>,
    owner: u32,
    screen: vt100::Parser,
    marker: Option<(String, String)>,
    last_key: Option<Instant>,
    launch_ready: bool,
    launcher_listening: bool,
    /// The launcher reported stopped by job control and not yet continued.
    launcher_stopped: bool,
    /// The launcher is stopped, or the terminal's foreground group is another
    /// group whose leader is stopped.
    paused: bool,
    /// The last foreground-group read and its answer; read at most once a tick,
    /// however often output wakes the loop.
    foreground: (Instant, bool),
    /// Set for an extra terminal, with the last time its member was checked.
    terminal: Option<(TerminalOf, Instant)>,
    /// An extra terminal's shell name (#6112): the started program's file name
    /// without a login dash, cleaned as display text.
    shell_name: Option<String>,
    // Drop order: the files go before the lock is released.
    _files: Files,
    _lock: Flock<File>,
}

impl Supervisor {
    /// Takes the member's lock, binds its socket and starts the program. Fails,
    /// leaving nothing behind, when the directory is not owner-only, another
    /// supervisor serves the id, or the program cannot start.
    pub fn start(launch: Launch) -> io::Result<Self> {
        let Launch {
            directory,
            id,
            size,
            program,
            environment,
            terminal: extra,
        } = launch;
        validate(&directory, &id)?;
        let Some((name, arguments)) = program.split_first() else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "a member needs a program to run",
            ));
        };
        ensure_private_directory(&directory)?;
        let lock = file_lock::exclusive(&lock_path(&directory, &id)).map_err(|error| {
            if error.kind() == io::ErrorKind::WouldBlock {
                io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "another supervisor already serves this member",
                )
            } else {
                error
            }
        })?;
        // A crashed member cannot unlink its files. An acquired flock proves
        // there is no live holder; IDs are never reused, as for Files::drop.
        // Unknown neighbours and scan errors never prevent this member starting.
        if let Ok(entries) = fs::read_dir(&directory) {
            for entry in entries.take(RECLAIM_ENTRIES).flatten() {
                let name = entry.file_name();
                let Some(other) = name.to_str().and_then(|name| name.strip_suffix(".lock")) else {
                    continue;
                };
                if other == id || validate(&directory, other).is_err() {
                    continue;
                }
                let socket = socket_path(&directory, other);
                // A starter opens its lock before taking the flock and only
                // binds its socket afterwards. Leave lock-only neighbours alone.
                if fs::symlink_metadata(&socket).is_err() {
                    continue;
                }
                let Ok(_neighbour_lock) = file_lock::exclusive(&entry.path()) else {
                    // WouldBlock is live; every other failure is unknown.
                    continue;
                };
                if let Err(error) = fs::remove_file(socket)
                    && error.kind() != io::ErrorKind::NotFound
                {
                    continue;
                }
                let _ = fs::remove_file(entry.path());
            }
        }
        let files = Files {
            socket: socket_path(&directory, &id),
            lock: lock_path(&directory, &id),
        };
        // Holding the lock, a socket file here is a dead supervisor's leftover.
        match fs::remove_file(&files.socket) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        let listener = UnixListener::bind(&files.socket)?;
        fs::set_permissions(&files.socket, fs::Permissions::from_mode(0o600))?;
        listener.set_nonblocking(true)?;

        let terminal = openpty(Some(&winsize(size)), None)?;
        for end in [&terminal.master, &terminal.slave] {
            fcntl(end, FcntlArg::F_SETFD(FdFlag::FD_CLOEXEC))?;
        }
        fcntl(&terminal.master, FcntlArg::F_SETFL(OFlag::O_NONBLOCK))?;
        let slave_path = ttyname(&terminal.slave)?;
        let settings = tcgetattr(&terminal.slave)?;
        let child = spawn(name, arguments, &environment, terminal.slave)?;
        Ok(Self {
            listener,
            master: File::from(terminal.master),
            member_pid: child.id(),
            replaced: None,
            relaunched_at: Instant::now(),
            admission_hangup: None,
            admission: RELAUNCH_ADMISSION,
            child: Some(child),
            child_kind: None,
            ended: None,
            slave_path,
            settings,
            environment,
            master_open: true,
            closing: false,
            size,
            clients: Vec::new(),
            next_client: 0,
            active: None,
            input: VecDeque::new(),
            owner: nix::unistd::geteuid().as_raw(),
            screen: vt100::Parser::new(size.rows, size.cols, 0),
            marker: None,
            last_key: None,
            launch_ready: false,
            launcher_listening: false,
            launcher_stopped: false,
            paused: false,
            foreground: (Instant::now(), false),
            shell_name: extra.as_ref().and_then(|_| shell_name(name)),
            terminal: extra.map(|extra| (extra, Instant::now())),
            _files: files,
            _lock: lock,
        })
    }

    /// The program's process id.
    pub fn program_pid(&self) -> u32 {
        self.member_pid
    }

    /// Serves until Core closes the terminal. When the program ends the attached
    /// clients are told (`Exited`) and the terminal, socket and screen are kept
    /// for a relaunch. Returns an error only when the supervisor itself fails;
    /// the terminal then hangs up and a running program receives SIGHUP.
    pub fn run(mut self) -> io::Result<()> {
        loop {
            let ready = self.wait()?;
            if ready.listener {
                self.accept()?;
            }
            if self.master_open && ready.master_read {
                self.master_open = self.pump_output(16) != Pump::Closed;
            }
            if ready.master_write {
                self.pump_input();
            }
            for (index, flags) in ready.clients.into_iter().enumerate() {
                if !flags.is_empty() {
                    self.serve_client(index, flags);
                }
            }
            self.sweep();
            if let Some(exit) = self.reap(WaitPidFlag::WNOHANG)? {
                self.ended_with(exit);
                // An extra terminal keeps nothing: it ends with its shell.
                self.closing |= self.terminal.is_some();
            }
            if let Some((terminal, checked)) = &mut self.terminal
                && checked.elapsed() >= OWNER_CHECK
            {
                *checked = Instant::now();
                self.closing |= !(terminal.member_alive)();
            }
            self.enforce_admission();
            if self.closing {
                break;
            }
            if self.foreground.0.elapsed() >= Duration::from_millis(TICK.into()) {
                self.foreground = (Instant::now(), self.foreground_stopped());
            }
            self.paused = self.launcher_stopped || self.foreground.1;
        }
        self.hang_up()?;
        self.flush_clients();
        Ok(())
    }

    /// A relaunched launcher that has not published within `admission` never bound: it
    /// is hung up (SIGHUP, then SIGKILL after `HANGUP_GRACE`), and its end restores the
    /// member it replaced, so `relaunching` always ends.
    fn enforce_admission(&mut self) {
        if self.replaced.is_none() || self.relaunched_at.elapsed() < self.admission {
            return;
        }
        let signals: &[Signal] = match self.admission_hangup {
            None => &[Signal::SIGHUP, Signal::SIGCONT],
            Some(at) if at.elapsed() >= HANGUP_GRACE => &[Signal::SIGKILL],
            Some(_) => return,
        };
        for group in self.groups() {
            for signal in signals {
                let _ = killpg(group, *signal);
            }
        }
        self.admission_hangup = Some(Instant::now());
    }

    #[cfg(test)]
    pub(crate) fn with_admission(mut self, admission: Duration) -> Self {
        self.admission = admission;
        self
    }

    /// Tells the clients the program ended, after its last output, and keeps the
    /// terminal. Requests that waited for this program are answered by `Exited`.
    fn ended_with(&mut self, exit: Exit) {
        if self.master_open {
            for _ in 0..256 {
                match self.pump_output(16) {
                    Pump::More => {}
                    Pump::Closed => {
                        self.master_open = false;
                        break;
                    }
                    Pump::Idle => break,
                }
            }
        }
        self.broadcast(&ServerMessage::Exited(exit));
        if let Some((member_pid, marker)) = self.replaced.take() {
            self.member_pid = member_pid;
            self.marker = marker;
        }
        self.child = None;
        self.child_kind = None;
        self.ended = Some(exit);
        self.launcher_stopped = false;
        self.paused = false;
        self.foreground = (Instant::now(), false);
        // Nothing will read keystrokes until a relaunch; they must not reach it.
        self.input.clear();
        for client in &mut self.clients {
            client.wait_launch = false;
            client.wait_launcher = false;
        }
    }

    /// Ends a running program the way a closing terminal would: SIGHUP (and
    /// SIGCONT, so a stopped one sees it) to its groups, then SIGKILL after
    /// `HANGUP_GRACE`. Output is read and dropped meanwhile, since a program
    /// cannot finish closing a terminal whose output nobody reads.
    fn hang_up(&mut self) -> io::Result<()> {
        if self.child.is_none() {
            return Ok(());
        }
        let groups = self.groups();
        for signal in [Signal::SIGHUP, Signal::SIGCONT] {
            for group in &groups {
                let _ = killpg(*group, signal);
            }
        }
        let mut deadline = Instant::now() + HANGUP_GRACE;
        let mut killed = false;
        let mut buffer = [0u8; MAX_OUTPUT];
        loop {
            if let Some(exit) = self.reap(WaitPidFlag::WNOHANG)? {
                self.broadcast(&ServerMessage::Exited(exit));
                return Ok(());
            }
            if Instant::now() >= deadline {
                if killed {
                    // Left to init: the terminal it holds goes when this ends.
                    return Ok(());
                }
                for group in &groups {
                    let _ = killpg(*group, Signal::SIGKILL);
                }
                killed = true;
                deadline = Instant::now() + HANGUP_GRACE;
            }
            while self.master_open {
                match self.master.read(&mut buffer) {
                    Ok(0) => self.master_open = false,
                    Ok(_) => {}
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                    Err(_) => self.master_open = false,
                }
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// The running program's launcher leads its own session and process group,
    /// so its pid is its group id.
    fn launcher(&self) -> Option<Pid> {
        self.child.as_ref().map(|child| {
            Pid::from_raw(i32::try_from(child.id()).expect("a child pid fits a pid_t"))
        })
    }

    /// The running program's group and, when another group holds the terminal,
    /// that group too.
    fn groups(&self) -> Vec<Pid> {
        let Some(launcher) = self.launcher() else {
            return Vec::new();
        };
        let mut groups = vec![launcher];
        if let Ok(group) = tcgetpgrp(self.master.as_fd())
            && group != launcher
            && group.as_raw() > 0
        {
            groups.push(group);
        }
        groups
    }

    /// Drains every status the running launcher has reported since the last
    /// tick: a stop or continue updates `launcher_stopped`, and an end is the
    /// program's exit. Nothing runs, nothing is reaped.
    fn reap(&mut self, wait: WaitPidFlag) -> io::Result<Option<Exit>> {
        let Some(launcher) = self.launcher() else {
            return Ok(None);
        };
        let flags = wait | WaitPidFlag::WUNTRACED | WaitPidFlag::WCONTINUED;
        loop {
            match waitpid(launcher, Some(flags)) {
                Ok(WaitStatus::StillAlive) => return Ok(None),
                Ok(WaitStatus::Stopped(..)) => self.launcher_stopped = true,
                Ok(WaitStatus::Continued(_)) => self.launcher_stopped = false,
                Ok(WaitStatus::Exited(_, code)) => return Ok(Some(Exit::Code(code))),
                Ok(WaitStatus::Signaled(_, signal, _)) => {
                    return Ok(Some(Exit::Signal(signal as i32)));
                }
                // Trace stops are not job control; nothing traces the launcher.
                #[cfg(any(target_os = "linux", target_os = "android"))]
                Ok(_) => {}
                Err(Errno::EINTR) => {}
                // The kernel reaped the launcher, but nix cannot name the signal
                // that ended it (a real-time signal): the end is still reported.
                Err(Errno::EINVAL) => return Ok(Some(Exit::Signal(0))),
                Err(error) => return Err(error.into()),
            }
        }
    }

    /// The primary path for a real Ctrl-Z. The launcher leads its own session
    /// and its parent (this supervisor) is in another session, so the
    /// launcher's process group is orphaned and the kernel discards the
    /// terminal's SIGTSTP for it and for a provider that shares it; only
    /// SIGSTOP stops that group, which `reap` sees. A provider that runs in its
    /// own process group as the terminal's foreground group is not orphaned: it
    /// stops alone on Ctrl-Z while the launcher keeps running, and only this
    /// read sees it. A failed read is not evidence of a stop.
    fn foreground_stopped(&self) -> bool {
        let Some(launcher) = self.launcher() else {
            return false;
        };
        let Ok(group) = tcgetpgrp(self.master.as_fd()) else {
            return false;
        };
        if group == launcher || group.as_raw() <= 0 {
            return false;
        }
        crate::process::job_stopped(
            group.as_raw().unsigned_abs().into(),
            Instant::now() + FOREGROUND_READ,
        )
    }

    /// The foreground group when a program other than the terminal's own shell
    /// holds it (#5991); `None` while the shell itself is in the foreground.
    fn foreground_job(&self) -> Option<Pid> {
        let child = self.child.as_ref()?;
        tcgetpgrp(self.master.as_fd())
            .ok()
            .filter(|group| group.as_raw() > 0 && group.as_raw().unsigned_abs() != child.id())
    }

    /// Continues the launcher's group and, when another group holds the
    /// terminal, that group too. Continuing a running group changes nothing,
    /// so a repeated resume is applied as well, and so is one with no program.
    fn resume(&self) -> ControlReply {
        for group in self.groups() {
            if let Err(error) = killpg(group, Signal::SIGCONT) {
                return ControlReply::Error(format!("the member could not be continued: {error}"));
            }
        }
        ControlReply::Applied(true)
    }

    /// Starts `program` on the kept terminal once the last one ended. Core
    /// builds the program; the supervisor's only rule is that none is running.
    fn relaunch(&mut self, kind: RelaunchKind, program: Vec<String>) -> ControlReply {
        if self.child.is_some() {
            return ControlReply::Error(
                if self.child_kind == Some(RelaunchKind::Shell) {
                    "the shell is still running; exit it first"
                } else {
                    "the program is still running; exit it first"
                }
                .into(),
            );
        }
        let Some((name, arguments)) = program.split_first() else {
            return ControlReply::Error("a relaunch needs a program".into());
        };
        let arguments: Vec<OsString> = arguments.iter().map(OsString::from).collect();
        let started = open(
            &self.slave_path,
            OFlag::O_RDWR | OFlag::O_NOCTTY | OFlag::O_CLOEXEC,
            Mode::empty(),
        )
        .map_err(io::Error::from)
        .and_then(|slave| {
            tcsetattr(&slave, SetArg::TCSANOW, &self.settings)?;
            let _ = tmt_sys::set_window_size(self.master.as_fd(), self.size.cols, self.size.rows);
            spawn(
                OsString::from(name).as_os_str(),
                &arguments,
                &self.environment,
                slave,
            )
        });
        let child = match started {
            Ok(child) => child,
            Err(error) => {
                let mut reason = format!("the program could not start: {error}");
                reason.truncate(reason.floor_char_boundary(200));
                return ControlReply::Error(reason);
            }
        };
        if kind != RelaunchKind::Shell {
            // A new launcher binds and publishes its own marker; the old one
            // belonged to the program that ended.
            self.replaced = Some((self.member_pid, self.marker.take()));
            self.relaunched_at = Instant::now();
            self.admission_hangup = None;
            self.member_pid = child.id();
            self.launch_ready = false;
            self.launcher_listening = false;
        }
        self.child = Some(child);
        self.child_kind = Some(kind);
        self.ended = None;
        self.master_open = true;
        ControlReply::Applied(true)
    }

    fn wait(&self) -> io::Result<Ready> {
        let mut set = vec![PollFd::new(self.listener.as_fd(), PollFlags::POLLIN)];
        let mut master_events = PollFlags::empty();
        if self.master_open && !self.congested() {
            master_events |= PollFlags::POLLIN;
        }
        if !self.input.is_empty() {
            master_events |= PollFlags::POLLOUT;
        }
        let master_slot = (!master_events.is_empty()).then(|| {
            set.push(PollFd::new(self.master.as_fd(), master_events));
            set.len() - 1
        });
        let first_client = set.len();
        for client in &self.clients {
            let mut events = PollFlags::empty();
            if client.live() && self.input.len() < INPUT_HIGH_WATER {
                events |= PollFlags::POLLIN;
            }
            if !client.outbox.is_empty() {
                events |= PollFlags::POLLOUT;
            }
            set.push(PollFd::new(client.stream.as_fd(), events));
        }
        match poll(&mut set, PollTimeout::from(TICK)) {
            Ok(_) | Err(Errno::EINTR) => {}
            Err(error) => return Err(error.into()),
        }
        let flags = |slot: usize| set[slot].revents().unwrap_or_else(PollFlags::empty);
        let master = master_slot.map_or_else(PollFlags::empty, flags);
        Ok(Ready {
            listener: flags(0).intersects(PollFlags::POLLIN),
            master_read: master.intersects(PollFlags::POLLIN | PollFlags::POLLHUP),
            master_write: master.contains(PollFlags::POLLOUT),
            clients: (first_client..set.len()).map(flags).collect(),
        })
    }

    fn accept(&mut self) -> io::Result<()> {
        loop {
            match self.listener.accept() {
                Ok((stream, _)) => self.admit(stream),
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Ok(()),
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::Interrupted | io::ErrorKind::ConnectionAborted
                    ) => {}
                Err(error) => return Err(error),
            }
        }
    }

    fn admit(&mut self, stream: UnixStream) {
        // Refused connections wait to be told so; past this many, just drop them.
        if self.clients.len() >= 2 * MAX_CLIENTS || stream.set_nonblocking(true).is_err() {
            return;
        }
        let refusal = if tmt_sys::peer_uid(stream.as_fd()).ok() != Some(self.owner) {
            Some(Refusal::Owner)
        } else if self.clients.iter().filter(|client| client.live()).count() >= MAX_CLIENTS {
            Some(Refusal::Full)
        } else {
            None
        };
        self.next_client += 1;
        self.clients.push(Client {
            id: self.next_client,
            stream,
            decoder: Decoder::new(),
            outbox: Outbox::default(),
            welcomed: false,
            wait_launch: false,
            wait_launcher: false,
            size: None,
            since: Instant::now(),
            progress: Instant::now(),
            fate: refusal.map(Fate::Refuse),
            closing_until: None,
        });
    }

    /// Reads what the program wrote and queues it for every attached client, in
    /// frames as full as the terminal's pending output allows.
    fn pump_output(&mut self, budget: usize) -> Pump {
        let mut buffer = [0u8; MAX_OUTPUT];
        for _ in 0..budget {
            if self.congested() {
                return Pump::Idle;
            }
            let mut filled = 0;
            let state = loop {
                match self.master.read(&mut buffer[filled..]) {
                    Ok(0) => break Pump::Closed,
                    Ok(count) => {
                        filled += count;
                        if filled == buffer.len() {
                            break Pump::More;
                        }
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => break Pump::Idle,
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                    // Linux reports a closed terminal as EIO.
                    Err(_) => break Pump::Closed,
                }
            };
            if filled > 0 {
                self.screen.process(&buffer[..filled]);
                self.broadcast(&ServerMessage::Output(buffer[..filled].to_vec()));
            }
            if state != Pump::More {
                return state;
            }
        }
        Pump::More
    }

    fn pump_input(&mut self) {
        while !self.input.is_empty() {
            match self.master.write(self.input.as_slices().0) {
                Ok(0) => break,
                Ok(count) => {
                    self.input.drain(..count);
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                // The program closed its terminal: nothing will read these.
                Err(_) => {
                    self.input.clear();
                    break;
                }
            }
        }
    }

    fn congested(&self) -> bool {
        self.clients.iter().any(Client::congested)
    }

    fn broadcast(&mut self, message: &ServerMessage) {
        let frame = message.encode();
        for client in self.clients.iter_mut().filter(|c| c.welcomed && c.live()) {
            client.enqueue(frame.clone());
        }
    }

    fn serve_client(&mut self, index: usize, flags: PollFlags) {
        let client = &mut self.clients[index];
        if flags.contains(PollFlags::POLLOUT) {
            match client.outbox.flush(&client.stream) {
                Ok(0) => {}
                Ok(_) => client.progress = Instant::now(),
                Err(_) => {
                    client.fate = Some(Fate::Leave);
                    return;
                }
            }
        }
        if !client.live() {
            if flags.intersects(PollFlags::POLLHUP | PollFlags::POLLERR) {
                client.fate = Some(Fate::Leave);
            }
            return;
        }
        if !flags.intersects(PollFlags::POLLIN | PollFlags::POLLHUP | PollFlags::POLLERR) {
            return;
        }
        let mut buffer = [0u8; 8192];
        let count = match (&client.stream).read(&mut buffer) {
            Ok(0) => {
                client.fate = Some(Fate::Leave);
                return;
            }
            Ok(count) => count,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => return,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => return,
            Err(_) => {
                client.fate = Some(Fate::Leave);
                return;
            }
        };
        let mut messages = Vec::new();
        if client.decoder.push(&buffer[..count]).is_err() {
            client.fate = Some(Fate::Leave);
            return;
        }
        loop {
            match client.decoder.frame::<ClientMessage>() {
                Ok(Some(message)) => messages.push(message),
                Ok(None) => break,
                Err(_) => {
                    // A frame that is not valid ends the connection; the earlier
                    // ones in the same read were valid and are still handled.
                    client.fate = Some(Fate::Leave);
                    break;
                }
            }
        }
        for message in messages {
            if self.clients[index].fate.is_some() {
                break;
            }
            self.handle(index, message);
        }
    }

    fn handle(&mut self, index: usize, message: ClientMessage) {
        let (id, welcomed) = (self.clients[index].id, self.clients[index].welcomed);
        match message {
            ClientMessage::Hello { version } if !welcomed => {
                let size = self.size;
                let client = &mut self.clients[index];
                if version == VERSION {
                    client.welcomed = true;
                    client.queue(&ServerMessage::Welcome {
                        version: VERSION,
                        size,
                    });
                } else {
                    client.fate = Some(Fate::Refuse(Refusal::Version));
                }
            }
            _ if !welcomed => self.clients[index].fate = Some(Fate::Refuse(Refusal::Handshake)),
            // A second hello is not part of the protocol.
            ClientMessage::Hello { .. } | ClientMessage::Detach => {
                self.clients[index].fate = Some(Fate::Leave);
            }
            ClientMessage::Control(control) => self.control(index, control),
            ClientMessage::Snapshot => self.snapshot(index),
            // Keys typed while no program runs would reach the next one.
            ClientMessage::Input(_) if self.child.is_none() => {}
            ClientMessage::Input(data) => {
                self.last_key = Some(Instant::now());
                // Typing from another window brings the terminal to that window.
                if self.active != Some(id)
                    && let Some(size) = self.clients[index].size
                {
                    self.active = Some(id);
                    self.resize(size);
                }
                self.input.extend(data);
            }
            ClientMessage::Resize(size) => {
                self.clients[index].size = Some(size);
                self.active = Some(id);
                self.resize(size);
            }
            ClientMessage::TakeSole => {
                for other in self.clients.iter_mut().filter(|c| c.id != id && c.live()) {
                    other.fate = Some(Fate::Evict(Eviction::TakenOver));
                }
                if let Some(size) = self.clients[index].size {
                    self.active = Some(id);
                    self.resize(size);
                }
            }
        }
    }

    /// Answers a snapshot request with the screen as it is at this moment: the formatted
    /// screen (cursor and input modes included), bounded by the screen size and queued in
    /// output-sized chunks behind the client's other frames, so live output that follows
    /// arrives after it and nothing is lost or repeated. The supervisor handles requests and
    /// reads program output in one thread, so the screen already holds every byte queued
    /// before this request and none that is queued after it. Every request gets the current
    /// screen; none is kept waiting. A client that asks while 256 KiB of earlier frames are
    /// unread is too slow to follow a screen and is evicted like any other.
    fn snapshot(&mut self, index: usize) {
        if self.clients[index].congested() {
            self.clients[index].fate = Some(Fate::Evict(Eviction::TooSlow));
            return;
        }
        let screen = self.screen.screen();
        let mut state = Vec::new();
        if screen.alternate_screen() {
            state.extend_from_slice(b"\x1b[?1049h");
        }
        state.extend_from_slice(&screen.state_formatted());
        let size = self.size;
        let client = &mut self.clients[index];
        client.queue(&ServerMessage::SnapshotStart);
        for chunk in state.chunks(MAX_OUTPUT) {
            client.queue(&ServerMessage::SnapshotData(chunk.to_vec()));
        }
        client.queue(&ServerMessage::SnapshotEnd(size));
    }

    /// Controls share the supervisor's serialization with the stream. No control
    /// creates key activity, resizes the terminal or captures scrollback.
    fn control(&mut self, index: usize, request: Control) {
        // Nothing runs to listen or launch after the program ended, so a wait that
        // arrives then is answered at once instead of never.
        if matches!(request, Control::WaitLauncher | Control::AwaitLaunch) && self.child.is_none() {
            let answer = ControlReply::Error("the program has ended".into());
            self.clients[index].queue(&ServerMessage::Control(answer));
            return;
        }
        if request == Control::WaitLauncher && !self.launcher_listening {
            self.clients[index].wait_launcher = true;
            return;
        }
        if request == Control::AwaitLaunch {
            self.launcher_listening = true;
            for client in self
                .clients
                .iter_mut()
                .filter(|c| c.wait_launcher && c.live())
            {
                client.wait_launcher = false;
                client.queue(&ServerMessage::Control(ControlReply::Applied(true)));
            }
            if !self.launch_ready {
                self.clients[index].wait_launch = true;
                return;
            }
        }
        let answer = match request {
            Control::AwaitLaunch => self.marker.as_ref().map_or_else(
                || ControlReply::Error("the launch has no committed binding marker".into()),
                |(_, marker)| ControlReply::Launched(marker.clone()),
            ),
            Control::WaitLauncher => ControlReply::Applied(true),
            Control::LaunchReady { pane_pid } => {
                let matches = pane_pid == self.member_pid;
                if matches {
                    self.launch_ready = true;
                    for client in self
                        .clients
                        .iter_mut()
                        .filter(|c| c.wait_launch && c.live())
                    {
                        client.wait_launch = false;
                        let answer = self.marker.as_ref().map_or_else(
                            || {
                                ControlReply::Error(
                                    "the launch has no committed binding marker".into(),
                                )
                            },
                            |(_, marker)| ControlReply::Launched(marker.clone()),
                        );
                        client.queue(&ServerMessage::Control(answer));
                    }
                }
                ControlReply::Applied(matches)
            }
            Control::Capabilities => ControlReply::Capabilities {
                resume: true,
                relaunch: self.terminal.is_none(),
                close: true,
                terminal: self.terminal.is_some(),
                terminal_detail: self.terminal.is_some(),
            },
            Control::Terminal => match &self.terminal {
                Some((terminal, _)) => ControlReply::Terminal {
                    owner: terminal.owner.clone(),
                    created_ms: terminal.created_ms,
                    busy: self.foreground_job().is_some(),
                },
                None => {
                    ControlReply::Error("this supervisor serves a member, not a terminal".into())
                }
            },
            Control::TerminalDetail => match &self.terminal {
                Some((terminal, _)) => {
                    let job = self.foreground_job();
                    ControlReply::TerminalDetail {
                        owner: terminal.owner.clone(),
                        created_ms: terminal.created_ms,
                        busy: job.is_some(),
                        shell: self.shell_name.clone(),
                        // The job's group leader names it; a leader that already
                        // ended leaves the job unnamed.
                        program: job
                            .and_then(|group| tmt_sys::process_name(group.as_raw()))
                            .and_then(|name| tmt_pty_protocol::display_name(&name)),
                    }
                }
                None => {
                    ControlReply::Error("this supervisor serves a member, not a terminal".into())
                }
            },
            // An extra terminal has no binding: nothing may publish one into it, and it has
            // no kept terminal to relaunch on.
            Control::Publish { .. } | Control::PublishIf { .. } | Control::Relaunch { .. }
                if self.terminal.is_some() =>
            {
                ControlReply::Error("an extra terminal has no binding".into())
            }
            Control::Resume => self.resume(),
            Control::Relaunch { kind, program } => self.relaunch(kind, program),
            Control::Close => {
                self.closing = true;
                ControlReply::Applied(true)
            }
            Control::Inspect => ControlReply::State {
                supervisor_pid: std::process::id(),
                pane_pid: self.member_pid,
                key_idle_ms: self
                    .last_key
                    .map(|at| u64::try_from(at.elapsed().as_millis()).unwrap_or(u64::MAX - 1)),
                marker: self.marker.as_ref().map(|(_, marker)| marker.clone()),
                paused: self.paused,
                ended: self.ended,
                shell: self.child.is_some() && self.child_kind == Some(RelaunchKind::Shell),
                relaunching: self.replaced.is_some(),
            },
            Control::Publish {
                pane_pid,
                key,
                marker,
            } => {
                let matches = pane_pid == self.member_pid;
                if matches {
                    self.marker = Some((key, marker));
                    self.replaced = None;
                }
                ControlReply::Applied(matches)
            }
            Control::PublishIf {
                pane_pid,
                key,
                expected_key,
                marker,
            } => {
                let matches = pane_pid == self.member_pid
                    && match self.marker.as_ref() {
                        None => expected_key.is_none(),
                        Some((old, _)) => old == &key || expected_key.as_ref() == Some(old),
                    };
                if matches {
                    self.marker = Some((key, marker));
                    self.replaced = None;
                }
                ControlReply::Applied(matches)
            }
            Control::Clear { key } => {
                let matches = self.marker.as_ref().is_some_and(|(old, _)| old == &key);
                if matches {
                    self.marker = None;
                }
                // The relaunched launcher unbinding the member it replaces: that
                // marker must not come back if the launcher then ends.
                let replaced = match &mut self.replaced {
                    Some((_, marker)) if marker.as_ref().is_some_and(|(old, _)| old == &key) => {
                        *marker = None;
                        true
                    }
                    _ => false,
                };
                ControlReply::Applied(matches || replaced)
            }
            Control::Capture => {
                let text = self.screen.screen().contents();
                if text.len() > MAX_PAYLOAD {
                    ControlReply::Error("the visible screen exceeds the capture byte bound".into())
                } else {
                    ControlReply::Screen(text)
                }
            }
            Control::Paste(_) | Control::Enter if self.child.is_none() => {
                ControlReply::Error("the program has ended".into())
            }
            Control::Paste(data) => {
                if self.screen.screen().bracketed_paste() {
                    self.input.extend(b"\x1b[200~");
                }
                self.input.extend(data);
                if self.screen.screen().bracketed_paste() {
                    self.input.extend(b"\x1b[201~");
                }
                ControlReply::Applied(true)
            }
            Control::Enter => {
                self.input.push_back(b'\r');
                ControlReply::Applied(true)
            }
        };
        self.clients[index].queue(&ServerMessage::Control(answer));
    }

    fn resize(&mut self, size: Size) {
        if size == self.size {
            return;
        }
        // A terminal the program already closed cannot be resized; nothing to do.
        let _ = tmt_sys::set_window_size(self.master.as_fd(), size.cols, size.rows);
        self.size = size;
        self.screen.screen_mut().set_size(size.rows, size.cols);
        self.broadcast(&ServerMessage::Resized(size));
    }

    /// Applies each client's pending end: leaving ones go, evicted and refused
    /// ones get their last frame, and silent or finished ones are dropped.
    fn sweep(&mut self) {
        let now = Instant::now();
        let mut kept = Vec::with_capacity(self.clients.len());
        for mut client in std::mem::take(&mut self.clients) {
            if client.live() && !client.welcomed && now - client.since > HELLO_DEADLINE {
                client.fate = Some(Fate::Refuse(Refusal::Handshake));
            } else if client.live() && !client.outbox.is_empty() && now - client.progress > STALL {
                client.fate = Some(Fate::Evict(Eviction::TooSlow));
            }
            match client.fate.take() {
                Some(Fate::Leave) => continue,
                Some(Fate::Evict(reason)) => {
                    client.close_with(&ServerMessage::Evicted(reason), now);
                }
                Some(Fate::Refuse(reason)) => {
                    client.close_with(&ServerMessage::Refused(reason), now);
                }
                None => {}
            }
            if client
                .closing_until
                .is_some_and(|until| client.outbox.is_empty() || now >= until)
            {
                continue;
            }
            kept.push(client);
        }
        self.clients = kept;
        if let Some(active) = self.active
            && !self.clients.iter().any(|c| c.id == active && c.live())
        {
            self.active = None;
        }
    }

    /// Gives the last frames, the program's exit among them, a short time to be read.
    fn flush_clients(&mut self) {
        let deadline = Instant::now() + FLUSH_GRACE;
        loop {
            self.clients
                .retain_mut(|c| c.outbox.flush(&c.stream).is_ok() && !c.outbox.is_empty());
            let remaining = deadline.saturating_duration_since(Instant::now());
            if self.clients.is_empty() || remaining.is_zero() {
                return;
            }
            let mut set: Vec<_> = self
                .clients
                .iter()
                .map(|c| PollFd::new(c.stream.as_fd(), PollFlags::POLLOUT))
                .collect();
            let wait = u16::try_from(remaining.as_millis()).unwrap_or(u16::MAX);
            let _ = poll(&mut set, PollTimeout::from(wait));
        }
    }
}

/// Starts `name` on `slave` as the leader of a new session the terminal
/// controls, with this process's environment and directory plus `environment`.
fn spawn(
    name: &std::ffi::OsStr,
    arguments: &[OsString],
    environment: &[(OsString, Option<OsString>)],
    slave: std::os::fd::OwnedFd,
) -> io::Result<Child> {
    let mut command = Command::new(name);
    command.args(arguments);
    for (name, value) in environment {
        match value {
            Some(value) => {
                command.env(name, value);
            }
            None => {
                command.env_remove(name);
            }
        }
    }
    tmt_sys::spawn_on_terminal(command, slave)
}

fn winsize(size: Size) -> Winsize {
    Winsize {
        ws_row: size.rows,
        ws_col: size.cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    }
}

#[cfg(test)]
mod shell_name_tests {
    use super::shell_name;
    use std::ffi::OsStr;

    #[test]
    fn a_shell_is_named_by_its_file_name_without_a_login_dash() {
        assert_eq!(shell_name(OsStr::new("/bin/zsh")).as_deref(), Some("zsh"));
        assert_eq!(shell_name(OsStr::new("-zsh")).as_deref(), Some("zsh"));
        assert_eq!(
            shell_name(OsStr::new("/opt/\u{1b}[2Jfish")).as_deref(),
            Some("[2Jfish")
        );
        assert_eq!(shell_name(OsStr::new("/")), None);
    }
}
