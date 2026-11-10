//! In-process built-in host over one member supervisor. The ordinary HostDriver
//! policy remains the only binding/delivery admission owner.

use super::{
    ActionError, AgentNaming, CallerEnvironment, DeliveryError, DeliveryStage, HostError,
    driver::HostDriver, external::ExternalCaller,
};
use crate::{
    process::{CommandError, CommandRunner, ancestry, runtime},
    pty::{
        Connection, LaunchOutcome,
        protocol::{Control, ControlReply, Exit, RelaunchKind},
    },
};
use std::{
    io,
    path::Path,
    time::{Duration, Instant},
};
use tmt_core::{
    binding::{Binding, session::RuntimeState},
    driver::{ActionResult, DeliveryAcceptance, Focused, InputActivity, SendFailure},
    endpoint::{
        BindingMarker, EndpointProbe, EndpointSnapshot, PaneLocation, PaneObservation,
        ServerEvidence,
    },
    host::{HostKind, HostServerIds, HostServerIncarnation},
    identity::Identity,
};
use tmt_driver_protocol::LaunchTemplate;

/// Runs the command line `$2`, which is itself one built-in-host launch
/// (`tmt run --host pty NAME TOOL …`); that launch starts its own member and returns once it is
/// admitted or ended during startup (#5536). The built-in host has no sessions: `$1` fills the
/// grammar's required `{session}` and is ignored. Nothing is interpolated, and an empty command
/// is refused first.
const LAUNCH_SCRIPT: &str = "[ -n \"$2\" ] || { echo 'tmt-launch: a command is required' >&2; exit 2; }; \
exec sh -c \"$2\"";

pub fn launch_template() -> LaunchTemplate {
    let argv: Vec<String> = [
        "sh",
        "-c",
        LAUNCH_SCRIPT,
        "tmt-launch",
        "{session}",
        "{command}",
    ]
    .map(str::to_owned)
    .to_vec();
    LaunchTemplate::new(&argv).expect("the shipped built-in launch template is valid")
}

pub(crate) const PANE_ENV: &str = "TMT_PTY_PANE";
pub(crate) const SOCKET_ENV: &str = "TMT_PTY_SOCKET";
/// One built-in host operation's bound; a built-in workspace preview reuses it.
pub(crate) const BUDGET: Duration = Duration::from_secs(3);
/// How long closing a member waits for its supervisor to end after the program did.
const CLOSE_WAIT: Duration = Duration::from_secs(3);
const CLOSE_POLL: Duration = Duration::from_millis(50);
/// How long a relaunched agent launcher may take to admit its launch, as for a
/// new member (`pty::start_member`).
const RELAUNCH_WAIT: Duration = Duration::from_secs(60);

fn error(reason: &'static str) -> HostError {
    HostError::Evidence {
        driver: HostKind::pty().as_str().into(),
        reason,
    }
}
fn io_error(cause: io::Error) -> HostError {
    HostError::Pty(cause)
}

fn connection(socket: &str, pane: &str, deadline: Instant) -> Result<Connection, HostError> {
    let path = Path::new(socket);
    if !HostKind::pty().is_pane_id(pane)
        || path.file_stem().and_then(|s| s.to_str()) != Some(pane)
        || path.extension().and_then(|s| s.to_str()) != Some("sock")
    {
        return Err(error("the pane and socket do not match"));
    }
    let directory = path
        .parent()
        .ok_or_else(|| error("the socket has no directory"))?;
    if !crate::private_file::directory_is_private(directory) {
        return Err(error("the socket directory is not private"));
    }
    Connection::connect_until(directory, pane, deadline).map_err(io_error)
}

fn call(
    socket: &str,
    pane: &str,
    request: Control,
    deadline: Instant,
) -> Result<ControlReply, HostError> {
    let mut client = connection(socket, pane, deadline)?;
    let left = deadline.saturating_duration_since(Instant::now());
    if left.is_zero() {
        return Err(io_error(io::ErrorKind::TimedOut.into()));
    }
    client.control(request, left).map_err(io_error)
    // Drop disconnects immediately on success and error; no unread output client survives.
}

struct State {
    server_pid: u64,
    pane_pid: u64,
    marker: Option<BindingMarker>,
    idle: Option<u64>,
    /// Stopped by job control (Ctrl-Z); see `resume`.
    paused: bool,
    /// How the member's program ended, while the kept terminal runs nothing.
    ended: Option<Exit>,
    /// A relaunched shell holds the kept terminal.
    shell: bool,
    /// A relaunched agent launcher has not bound yet; see `PtyDriver::snapshot_from`.
    relaunching: bool,
}

impl State {
    /// Whether the member's program (`pane_pid`) runs. Otherwise the supervisor
    /// keeps an ended member's terminal, and `pane_pid` names the process the
    /// binding's marker belongs to, which is gone: the supervisor alone vouches
    /// for the pane, and there is no pane process to pair with it.
    fn program_running(&self) -> bool {
        self.ended.is_none() && !self.shell
    }
}
fn state(socket: &str, pane: &str, deadline: Instant) -> Result<State, HostError> {
    decode_state(call(socket, pane, Control::Inspect, deadline)?)
}

fn decode_state(reply: ControlReply) -> Result<State, HostError> {
    let ControlReply::State {
        supervisor_pid,
        pane_pid,
        key_idle_ms,
        marker,
        paused,
        ended,
        shell,
        relaunching,
    } = reply
    else {
        return Err(error("the supervisor did not return state"));
    };
    let marker = marker
        .map(|text| {
            serde_json::from_str::<tmt_driver_protocol::Marker>(&text)
                .map(|m| BindingMarker {
                    name: m.name,
                    canonical_name: m.canonical_name,
                    identity_id: m.identity_id,
                    binding_id: m.binding_id,
                    server_id: m.server_id,
                    pane_pid: m.pane_pid,
                })
                .map_err(|_| error("the supervisor returned an invalid marker"))
        })
        .transpose()?;
    Ok(State {
        server_pid: u64::from(supervisor_pid),
        pane_pid: u64::from(pane_pid),
        marker,
        idle: key_idle_ms,
        paused,
        ended,
        shell,
        relaunching,
    })
}

/// What a supervisor's answer to `Control::Capabilities` grants beyond
/// conditional publication, which every answer grants.
#[derive(Default)]
struct Capabilities {
    resume: bool,
    /// The supervisor keeps the terminal after the program ends and relaunches.
    relaunch: bool,
    close: bool,
}

/// Decodes a capabilities answer. A supervisor that predates the flags answers
/// `Applied(true)`, which grants conditional publication only.
fn capabilities(reply: ControlReply) -> Result<Capabilities, HostError> {
    match reply {
        ControlReply::Applied(true) => Ok(Capabilities::default()),
        ControlReply::Capabilities {
            resume,
            relaunch,
            close,
            terminal: _,
        } => Ok(Capabilities {
            resume,
            relaunch,
            close,
        }),
        _ => Err(error("the supervisor returned invalid capabilities")),
    }
}

/// What one fresh read of a built-in member's supervisor shows beyond presence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerminalState {
    pub paused: bool,
    /// The program ended and nothing runs on the kept terminal.
    pub ended: Option<Exit>,
    /// A relaunched shell, not the member's agent, runs on the kept terminal.
    pub shell: bool,
}

/// One fresh read of a built-in member's terminal, or `None` on any doubt
/// (another host, an unreachable supervisor, another supervisor incarnation).
pub fn member_terminal(binding: &Binding) -> Option<TerminalState> {
    if binding.server.host != HostKind::pty() {
        return None;
    }
    state(
        &binding.server.socket_path,
        &binding.pane_id,
        Instant::now() + BUDGET,
    )
    .ok()
    .filter(|state| state.server_pid == binding.server.server_pid)
    .map(|state| TerminalState {
        paused: state.paused,
        ended: state.ended,
        shell: state.shell,
    })
}

/// Why a built-in member was not resumed.
#[derive(Debug)]
pub(crate) enum ResumeError {
    /// The member's supervisor predates `Control::Resume`; restarting the member
    /// replaces it. Nothing was sent.
    Unsupported,
    /// The supervisor could not be reached or did not confirm; the member may
    /// still be paused.
    Unconfirmed,
}

/// Continues a built-in member stopped by job control. Support is decided from
/// the supervisor's capabilities before anything is sent; a closed connection
/// is a transport error, never a capability answer. Idempotent.
pub(crate) fn resume(binding: &Binding) -> Result<(), ResumeError> {
    let deadline = Instant::now() + BUDGET;
    let (socket, pane) = (&binding.server.socket_path, &binding.pane_id);
    let granted = call(socket, pane, Control::Capabilities, deadline)
        .and_then(capabilities)
        .map_err(|_| ResumeError::Unconfirmed)?;
    if !granted.resume {
        return Err(ResumeError::Unsupported);
    }
    match call(socket, pane, Control::Resume, deadline) {
        Ok(ControlReply::Applied(true)) => Ok(()),
        _ => Err(ResumeError::Unconfirmed),
    }
}

/// Why a program was not relaunched on a built-in member's kept terminal.
#[derive(Debug)]
pub enum RelaunchError {
    /// The member's supervisor predates kept terminals. Nothing was sent.
    Unsupported,
    /// The supervisor refused: a program is still running.
    Refused(String),
    /// The relaunched launcher ended before admitting its launch, for example on a
    /// resume refusal; `output` is the bounded tail it printed. The terminal is kept.
    Exited { status: Exit, output: String },
    /// The supervisor could not be reached or did not confirm; a program may
    /// have started.
    Unconfirmed(String),
}

/// Starts `program` on the kept terminal of a built-in member whose program ended.
/// Support is decided from the supervisor's capabilities before anything is sent;
/// a closed connection is a transport error, never a capability answer. A shell is
/// confirmed once started; an agent launcher once it admitted its launch, on the
/// same connection, so no output it printed before ending can be missed. A launcher's
/// answer is its committed binding marker; a shell has none.
pub fn relaunch(
    binding: &Binding,
    kind: RelaunchKind,
    program: Vec<String>,
) -> Result<Option<String>, RelaunchError> {
    let deadline = Instant::now() + BUDGET;
    let (socket, pane) = (&binding.server.socket_path, &binding.pane_id);
    let unconfirmed = |cause: &dyn std::fmt::Display| RelaunchError::Unconfirmed(cause.to_string());
    let granted = call(socket, pane, Control::Capabilities, deadline)
        .and_then(capabilities)
        .map_err(|cause| unconfirmed(&cause))?;
    if !granted.relaunch {
        return Err(RelaunchError::Unsupported);
    }
    let mut client = connection(socket, pane, deadline).map_err(|cause| unconfirmed(&cause))?;
    let left = deadline.saturating_duration_since(Instant::now());
    match client.control(Control::Relaunch { kind, program }, left) {
        Ok(ControlReply::Applied(true)) => {}
        Ok(ControlReply::Error(reason)) => return Err(RelaunchError::Refused(reason)),
        Ok(other) => return Err(unconfirmed(&format!("unexpected answer {other:?}"))),
        Err(cause) => return Err(unconfirmed(&cause)),
    }
    if kind == RelaunchKind::Shell {
        return Ok(None);
    }
    match client.await_launch(RELAUNCH_WAIT) {
        Ok(LaunchOutcome::Launched(marker)) => Ok(Some(marker)),
        Ok(LaunchOutcome::Exited { status, output }) => {
            Err(RelaunchError::Exited { status, output })
        }
        Err(cause) => Err(unconfirmed(&cause)),
    }
}

/// Ends a built-in member's supervisor that keeps its terminal: `Close` hangs up
/// whatever runs there and removes the socket and lock. A supervisor without the
/// capability, or one that cannot be reached, is sent nothing; either way this
/// then waits the bounded time for that exact supervisor incarnation to end.
fn close_terminal<R: CommandRunner>(runner: &R, binding: &Binding) -> Result<(), ActionError> {
    let deadline = Instant::now() + BUDGET;
    let (socket, pane) = (&binding.server.socket_path, &binding.pane_id);
    let closable = call(socket, pane, Control::Capabilities, deadline)
        .and_then(capabilities)
        .is_ok_and(|granted| granted.close)
        // The socket names one member forever; the PID check keeps a stale
        // binding from closing whatever answers there now.
        && state(socket, pane, deadline)
            .is_ok_and(|state| state.server_pid == binding.server.server_pid);
    if closable {
        // A lost reply is not a failure here: the wait below decides.
        let _ = call(socket, pane, Control::Close, deadline);
    }
    wait_for_supervisor_end(
        runner,
        binding.server.server_pid,
        &binding.server.server_start_time,
        CLOSE_WAIT,
    )
}

/// Closes the kept terminal of a built-in member that was just removed, so no
/// supervisor outlives its identity. Advisory: the removal stands either way.
pub(crate) fn close_removed(binding: &Binding) -> Result<(), ActionError> {
    if binding.server.host != HostKind::pty() {
        return Ok(());
    }
    close_terminal(&crate::process::UnixCommandRunner, binding)
}

fn verify_pair<R: CommandRunner>(
    runner: &R,
    observed: &State,
    deadline: Instant,
) -> Result<(), HostError> {
    let chain = ancestry::pinned_chain(runner, observed.pane_pid, deadline)
        .map_err(|_| error("the pane ancestry is unverified"))?;
    if !chain
        .links()
        .get(1)
        .is_some_and(|parent| parent.process.pid() == observed.server_pid)
    {
        return Err(error("the supervisor is not the pane process owner"));
    }
    Ok(())
}

pub(super) fn caller<R: CommandRunner>(
    runner: &R,
    env: &CallerEnvironment,
    pinned: Option<&ancestry::PinnedChain>,
    deadline: Instant,
) -> Result<Option<ExternalCaller>, HostError> {
    let Some(pane) = env.driver_env.get(PANE_ENV).and_then(|v| v.to_str()) else {
        return Ok(None);
    };
    let socket = env
        .driver_env
        .get(SOCKET_ENV)
        .and_then(|v| v.to_str())
        .ok_or_else(|| error("the caller socket locator is missing"))?;
    let observed = state(socket, pane, deadline)?;
    // A kept terminal with no member program (ended, or a relaunched shell) has
    // no member process for a caller to descend from.
    if !observed.program_running() {
        return Ok(None);
    }
    verify_pair(runner, &observed, deadline)?;
    let owned;
    let chain = match pinned {
        Some(chain) => chain,
        None => {
            owned = ancestry::pinned_chain(runner, env.process_id, deadline)
                .map_err(|_| error("the caller ancestry is unverified"))?;
            &owned
        }
    };
    let Some(depth) = chain.position(observed.pane_pid) else {
        return Ok(None);
    };
    let segment = &chain.links()[..=depth];
    let pids: Vec<_> = segment
        .iter()
        .map(|link| link.process.pid())
        .chain(std::iter::once(observed.server_pid))
        .collect();
    let now = runtime::observe_starts(runner, &pids, deadline).map_err(HostError::Process)?;
    if !now.contains_key(&observed.server_pid)
        || !segment
            .iter()
            .all(|link| now.get(&link.process.pid()) == Some(&link.process))
    {
        return Err(error("the caller process chain changed"));
    }
    let HostKind::External(host) = HostKind::pty() else {
        unreachable!()
    };
    Ok(Some(ExternalCaller {
        host,
        pane_id: pane.into(),
        socket: socket.into(),
        depth,
    }))
}

pub(super) fn target_socket(pane: &str) -> Result<String, HostError> {
    if !HostKind::pty().is_pane_id(pane) {
        return Err(error("invalid built-in pane target"));
    }
    let paths =
        crate::config::ConfigPaths::discover().map_err(|e| HostError::ServerIds(Box::new(e)))?;
    Ok(crate::pty::socket_path(&paths.pty_directory(), pane)
        .to_string_lossy()
        .into_owned())
}

pub(super) fn socket_path_exists(socket: &str) -> Result<bool, HostError> {
    match std::fs::symlink_metadata(socket) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(io_error(error)),
        Ok(_) => Ok(true),
    }
}

pub(super) fn target_exists<R: CommandRunner>(
    runner: &R,
    socket: &str,
    pane: &str,
    deadline: Instant,
) -> Result<bool, HostError> {
    if !socket_path_exists(socket)? {
        return Ok(false);
    }
    let answer = state(socket, pane, deadline)?;
    if answer.program_running() {
        verify_pair(runner, &answer, deadline)?;
    }
    Ok(true)
}

pub(super) fn resolve<R: CommandRunner, I: HostServerIds>(
    runner: &R,
    socket: &str,
    pane: &str,
    ids: &mut I,
    deadline: Instant,
) -> Result<ServerEvidence, HostError> {
    let answer = state(socket, pane, deadline)?;
    let running = answer.program_running();
    if running {
        verify_pair(runner, &answer, deadline)?;
    }
    let pids = if running {
        vec![answer.server_pid, answer.pane_pid]
    } else {
        vec![answer.server_pid]
    };
    let mut starts =
        runtime::observe_starts(runner, &pids, deadline).map_err(HostError::Process)?;
    let supervisor = starts
        .remove(&answer.server_pid)
        .ok_or_else(|| error("the supervisor process is unverified"))?;
    if running && !starts.contains_key(&answer.pane_pid) {
        return Err(error("the pane process is unverified"));
    }
    let server_id = ids
        .server_id(&HostServerIncarnation {
            host: HostKind::pty(),
            socket_path: socket,
            server_pid: supervisor.pid(),
            server_start_time: supervisor.start_identity(),
        })
        .map_err(|e| HostError::ServerIds(Box::new(e)))?;
    if !tmt_core::endpoint::valid_server_id(&server_id) {
        return Err(error("the server UUID is invalid"));
    }
    Ok(ServerEvidence {
        host: HostKind::pty(),
        server_id,
        socket_path: socket.into(),
        server_pid: supervisor.pid(),
        server_start_time: supervisor.start_identity().into(),
    })
}

pub(super) fn wait_for_launcher(env: &CallerEnvironment) -> Result<(), HostError> {
    let pane = env
        .driver_env
        .get(PANE_ENV)
        .and_then(|v| v.to_str())
        .ok_or_else(|| error("no pane locator"))?;
    let socket = env
        .driver_env
        .get(SOCKET_ENV)
        .and_then(|v| v.to_str())
        .ok_or_else(|| error("no socket locator"))?;
    match call(socket, pane, Control::WaitLauncher, Instant::now() + BUDGET)? {
        ControlReply::Applied(true) => Ok(()),
        _ => Err(error("the launcher is not listening")),
    }
}

pub(super) fn launch_ready(binding: &Binding) -> Result<(), HostError> {
    let pane_pid = u32::try_from(binding.pane_pid).map_err(|_| error("invalid launch owner"))?;
    match call(
        &binding.server.socket_path,
        &binding.pane_id,
        Control::LaunchReady { pane_pid },
        Instant::now() + BUDGET,
    )? {
        ControlReply::Applied(true) => Ok(()),
        _ => Err(error("the supervisor did not confirm launch readiness")),
    }
}

pub(super) struct PtyDriver<'a, R> {
    pub runner: &'a R,
    pub server: Option<&'a ServerEvidence>,
    pub deadline: Instant,
    pub enter_delay: Duration,
}
impl<R: CommandRunner> PtyDriver<'_, R> {
    fn snapshot_at(
        &self,
        server: &ServerEvidence,
        panes: &[String],
    ) -> Result<EndpointSnapshot, HostError> {
        let pane = Path::new(&server.socket_path)
            .file_stem()
            .and_then(|v| v.to_str())
            .ok_or_else(|| error("invalid socket path"))?;
        let answer = state(&server.socket_path, pane, self.deadline)?;
        self.snapshot_from(server, pane, panes, answer)
    }

    fn snapshot_from(
        &self,
        server: &ServerEvidence,
        pane: &str,
        panes: &[String],
        answer: State,
    ) -> Result<EndpointSnapshot, HostError> {
        // While a relaunched agent launcher has not bound, the supervisor reports the
        // launcher as its pane process and no marker. The binding it replaces is restored
        // if that launch fails, so no other reader may judge it lost meanwhile (#5988):
        // their observation is inconclusive and every binding stays as it is. The
        // launcher itself, the pane process, observes its own pane to bind.
        if answer.relaunching && answer.pane_pid != u64::from(std::process::id()) {
            return Err(error("a relaunched launcher has not bound yet"));
        }
        let running = answer.program_running();
        if running {
            verify_pair(self.runner, &answer, self.deadline)?;
        }
        // The member's live directory, as tmux reports a pane's: display and skill roots
        // only, never authority or a binding fence. It is read before the start observation
        // below, so a member whose start that observation finds was alive, and owned the pid,
        // when the directory was read; a pid reused in between shows as another incarnation,
        // which fails the binding fence that every trusting reader checks. Doubt is `None`.
        let cwd = i32::try_from(answer.pane_pid)
            .ok()
            .filter(|_| running)
            .and_then(tmt_sys::process_cwd);
        let pids = if running {
            vec![answer.server_pid, answer.pane_pid]
        } else {
            vec![answer.server_pid]
        };
        let starts = runtime::observe_starts(self.runner, &pids, self.deadline)
            .map_err(HostError::Process)?;
        if answer.server_pid != server.server_pid
            || !starts
                .get(&answer.server_pid)
                .is_some_and(|p| p.start_identity() == server.server_start_time)
        {
            return Err(error("the supervisor incarnation changed"));
        }
        let mut found = Vec::new();
        if panes.is_empty() || panes.iter().any(|id| id == pane) {
            // A kept terminal's pane has no live process: its incarnation is
            // unknown, which leaves the PID and the supervisor's marker to decide
            // (`evaluate_binding`), so the member's binding stays Active. The
            // marker is the one the ended program published, or none after an
            // agent relaunch, whose launcher publishes its own.
            let incarnation = if running {
                Some(
                    starts
                        .get(&answer.pane_pid)
                        .ok_or_else(|| error("the pane process is unverified"))?
                        .start_identity()
                        .into(),
                )
            } else {
                None
            };
            found.push(PaneObservation {
                id: pane.into(),
                target: None,
                cwd,
                command: String::new(),
                pane_pid: answer.pane_pid,
                pane_incarnation: incarnation,
                suggested_name: None,
                marker: answer.marker,
                location: Some(PaneLocation {
                    host: server.host.as_str().into(),
                    session: None,
                    window: None,
                }),
                agent_name: None,
            });
        }
        Ok(EndpointSnapshot {
            server: server.clone(),
            panes: found,
        })
    }
}

/// Admits the interactive connection itself, rather than verifying a separate
/// socket and assuming its path is still the same member on reconnect.
pub(super) fn attach<R: CommandRunner>(
    runner: &R,
    entry: &tmt_core::binding::BindingEntry,
) -> Result<Connection, ActionError> {
    use tmt_core::binding::{BindingEvidence, evaluate_binding};
    let binding = entry.binding.as_ref().ok_or(ActionError::Unverified)?;
    let deadline = Instant::now() + BUDGET;
    let mut client = connection(&binding.server.socket_path, &binding.pane_id, deadline)
        .map_err(ActionError::Evidence)?;
    let answer = client
        .control(
            Control::Inspect,
            deadline.saturating_duration_since(Instant::now()),
        )
        .map_err(|e| ActionError::Evidence(io_error(e)))?;
    let driver = PtyDriver {
        runner,
        server: Some(&binding.server),
        deadline,
        enter_delay: Duration::ZERO,
    };
    let snapshot = driver
        .snapshot_from(
            &binding.server,
            &binding.pane_id,
            std::slice::from_ref(&binding.pane_id),
            decode_state(answer).map_err(ActionError::Evidence)?,
        )
        .map_err(ActionError::Evidence)?;
    if Instant::now() >= deadline
        || !matches!(
            evaluate_binding(entry, &EndpointProbe::Live(snapshot)),
            BindingEvidence::Active(_)
        )
    {
        return Err(ActionError::Unverified);
    }
    Ok(client)
}

pub(super) fn input(
    socket: &str,
    pane: &str,
    message: &str,
    enter_delay: Duration,
) -> Result<(), DeliveryError> {
    if message.len() > crate::pty::protocol::MAX_PAYLOAD {
        return Err(DeliveryError::new(
            DeliveryStage::Prepare,
            error("the message exceeds the paste byte bound"),
        ));
    }
    let deadline = Instant::now() + BUDGET;
    let mut client = connection(socket, pane, deadline)
        .map_err(|e| DeliveryError::new(DeliveryStage::Prepare, e))?;
    if !message.is_empty() {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(DeliveryError::new(
                DeliveryStage::Prepare,
                io_error(io::ErrorKind::TimedOut.into()),
            ));
        }
        match client.control(Control::Paste(message.as_bytes().to_vec()), remaining) {
            Ok(ControlReply::Applied(true)) => {}
            Ok(_) => {
                return Err(DeliveryError::new(
                    DeliveryStage::Paste,
                    error("the supervisor refused paste"),
                ));
            }
            Err(e) => return Err(DeliveryError::new(DeliveryStage::Paste, io_error(e))),
        }
    }
    // Keep no idle output subscriber during the configured delay.
    drop(client);
    std::thread::sleep(enter_delay);
    let reply = call(socket, pane, Control::Enter, Instant::now() + BUDGET)
        .map_err(|e| DeliveryError::new(DeliveryStage::Submit, e))?;
    match reply {
        ControlReply::Applied(true) => Ok(()),
        _ => Err(DeliveryError::new(
            DeliveryStage::Submit,
            error("the supervisor refused Enter"),
        )),
    }
}

pub(super) fn capture(socket: &str, pane: &str, lines: u32) -> Result<String, HostError> {
    let ControlReply::Screen(text) = call(socket, pane, Control::Capture, Instant::now() + BUDGET)?
    else {
        return Err(error("the supervisor refused capture"));
    };
    if lines == 0 {
        return Ok(text);
    }
    let all: Vec<_> = text.lines().collect();
    Ok(all[all.len().saturating_sub(lines as usize)..].join("\n"))
}

/// Waits up to `wait` for the supervisor incarnation `pid`/`start` to be gone (or replaced by
/// another process of that pid), which is what closing a built-in member means. It signals
/// nothing; a program that still runs when the time is up is refused, not ended.
fn wait_for_supervisor_end<R: CommandRunner>(
    runner: &R,
    pid: u64,
    start: &str,
    wait: Duration,
) -> Result<(), ActionError> {
    let deadline = Instant::now() + wait;
    loop {
        match runtime::observe_runtime_process(runner, pid, deadline)
            .map_err(|e| ActionError::Evidence(HostError::Process(e)))?
        {
            runtime::ProcessObservation::Gone => return Ok(()),
            runtime::ProcessObservation::Live(process)
            | runtime::ProcessObservation::Stopped(process)
                if process.start_identity() != start =>
            {
                return Ok(());
            }
            _ => {}
        }
        if Instant::now() + CLOSE_POLL >= deadline {
            return Err(ActionError::Evidence(error(
                "the member's program is still running; nothing was closed",
            )));
        }
        std::thread::sleep(CLOSE_POLL);
    }
}

/// Waits until `deadline` at most for the supervisor to report that the member's program ended.
/// A stop proves the agent gone, and the program on the terminal then ends with it: it is that
/// agent, whose exit the supervisor reaps only once per loop, or the launcher above it, still
/// exiting. Evidence read during that exit is inconclusive, so the close reads it afterwards.
/// Returns as soon as the report says so, or names another supervisor or pane process.
fn settle_ended_program(binding: &Binding, deadline: Instant) {
    let (socket, pane) = (&binding.server.socket_path, &binding.pane_id);
    loop {
        let Ok(state) = state(socket, pane, deadline) else {
            return;
        };
        let running = state.program_running()
            && state.server_pid == binding.server.server_pid
            && state.pane_pid == binding.pane_pid;
        if !running || Instant::now() + CLOSE_POLL >= deadline {
            return;
        }
        std::thread::sleep(CLOSE_POLL);
    }
}

impl<R: CommandRunner> HostDriver for PtyDriver<'_, R> {
    fn begin_coordination(&mut self) {
        self.deadline = Instant::now() + BUDGET;
    }
    fn budget_available(&self) -> bool {
        Instant::now() < self.deadline
    }
    fn snapshot(&mut self, panes: &[String]) -> Result<EndpointSnapshot, HostError> {
        self.snapshot_at(
            self.server
                .ok_or_else(|| error("no supervisor was resolved"))?,
            panes,
        )
    }
    fn probe(
        &mut self,
        server: &ServerEvidence,
        panes: &[String],
    ) -> Result<EndpointProbe, HostError> {
        if server.host != HostKind::pty() || !self.budget_available() {
            return Ok(EndpointProbe::Unknown);
        }
        let start = runtime::observe_start(self.runner, server.server_pid, self.deadline)
            .map_err(HostError::Process)?;
        match start {
            Some(start) if start != server.server_start_time => return Ok(EndpointProbe::Dead),
            None if runtime::recorded_process_gone(server.server_pid) => {
                return Ok(EndpointProbe::Dead);
            }
            None => return Ok(EndpointProbe::Unknown),
            _ => {}
        }
        match self.snapshot_at(server, panes) {
            Ok(snapshot) if self.budget_available() => Ok(EndpointProbe::Live(snapshot)),
            Err(e) if e.cleanup_failed() => Err(e),
            _ => Ok(EndpointProbe::Unknown),
        }
    }
    fn publish(&mut self, binding: &Binding, identity: &Identity) -> Result<(), HostError> {
        if self.publish_if(binding, identity, None)? {
            Ok(())
        } else {
            Err(error("the pane changed before marker publication"))
        }
    }
    fn publish_if(
        &mut self,
        binding: &Binding,
        identity: &Identity,
        expected: Option<&str>,
    ) -> Result<bool, HostError> {
        let marker = binding.marker(identity);
        let text = serde_json::to_string(&tmt_driver_protocol::Marker {
            name: marker.name,
            canonical_name: marker.canonical_name,
            identity_id: marker.identity_id,
            binding_id: marker.binding_id,
            server_id: marker.server_id,
            pane_pid: marker.pane_pid,
        })
        .map_err(|_| error("the marker could not be encoded"))?;
        let pane_pid = u32::try_from(binding.pane_pid).map_err(|_| error("invalid pane PID"))?;
        let socket = &binding.server.socket_path;
        let pane = &binding.pane_id;
        let conditional = match call(socket, pane, Control::Capabilities, self.deadline) {
            Ok(ControlReply::Applied(false)) => false,
            Ok(reply) => capabilities(reply).map(|_| true)?,
            // Version 1 supervisors close a connection on an unknown control.
            Err(HostError::Pty(cause)) if cause.kind() == io::ErrorKind::UnexpectedEof => false,
            Err(cause) => return Err(cause),
        };
        let request = if conditional {
            Control::PublishIf {
                pane_pid,
                key: binding.id.clone(),
                expected_key: expected.map(str::to_owned),
                marker: text,
            }
        } else {
            // Re-observe the same supervisor and pane after the capability connection
            // closes. Core verifies the published marker and compensates on mismatch.
            let observed = state(socket, pane, self.deadline)?;
            verify_pair(self.runner, &observed, self.deadline)?;
            let start = runtime::observe_start(self.runner, observed.server_pid, self.deadline)
                .map_err(HostError::Process)?;
            if observed.server_pid != binding.server.server_pid
                || observed.pane_pid != binding.pane_pid
                || start.as_deref() != Some(binding.server.server_start_time.as_str())
            {
                return Err(error("the supervisor changed during capability detection"));
            }
            Control::Publish {
                pane_pid,
                key: binding.id.clone(),
                marker: text,
            }
        };
        match call(socket, pane, request, self.deadline)? {
            ControlReply::Applied(applied) => Ok(applied),
            _ => Err(error("the supervisor did not confirm marker publication")),
        }
    }
    fn conditional_clear(&mut self, binding: &Binding) -> Result<bool, HostError> {
        match call(
            &binding.server.socket_path,
            &binding.pane_id,
            Control::Capabilities,
            self.deadline,
        ) {
            Ok(ControlReply::Applied(false)) => Ok(false),
            Ok(reply) => capabilities(reply).map(|_| true),
            Err(HostError::Pty(cause)) if cause.kind() == io::ErrorKind::UnexpectedEof => Ok(false),
            Err(cause) => Err(cause),
        }
    }

    fn clear(&mut self, binding: &Binding, _: &Identity) -> Result<bool, HostError> {
        match call(
            &binding.server.socket_path,
            &binding.pane_id,
            Control::Clear {
                key: binding.id.clone(),
            },
            self.deadline,
        )? {
            ControlReply::Applied(answer) => Ok(answer),
            _ => Err(error("the supervisor did not confirm marker removal")),
        }
    }
    fn observed_runtime(&self, binding: &Binding) -> Result<RuntimeState, CommandError> {
        runtime::binding_runtime(self.runner, binding, self.deadline)
    }
    fn pane_incarnation(&mut self, pid: u64) -> Result<Option<String>, HostError> {
        runtime::observe_start(self.runner, pid, self.deadline).map_err(HostError::Process)
    }
    fn input_activity(&mut self, binding: &Binding) -> Result<InputActivity, HostError> {
        Ok(
            state(&binding.server.socket_path, &binding.pane_id, self.deadline)?
                .idle
                .map_or(InputActivity::Unknown, InputActivity::ElapsedMs),
        )
    }
    fn has_input(&self) -> bool {
        true
    }
    fn prompt(
        &mut self,
        _: &Binding,
        _: &str,
    ) -> ActionResult<DeliveryAcceptance, SendFailure<ActionError>> {
        ActionResult::Unsupported
    }
    fn input(&mut self, binding: &Binding, message: &str) -> Result<(), DeliveryError> {
        input(
            &binding.server.socket_path,
            &binding.pane_id,
            message,
            self.enter_delay,
        )
    }
    fn focus_preflight(&self, _: Option<&Binding>) -> Result<(), ActionError> {
        Err(ActionError::HostUnsupported)
    }
    fn focus(&mut self, _: &Binding) -> Result<Focused, ActionError> {
        Err(ActionError::HostUnsupported)
    }
    fn close_preflight(&self) -> Result<(), ActionError> {
        Ok(())
    }
    /// A supervisor only starts through tmt's launcher, so every built-in member was opened by
    /// tmt; the binding must still name a built-in supervisor and pane.
    fn opened_by_tmt(&mut self, binding: &Binding) -> Result<Option<bool>, HostError> {
        Ok(Some(
            binding.server.host == HostKind::pty() && HostKind::pty().is_pane_id(&binding.pane_id),
        ))
    }
    /// Closing a built-in member means its supervisor has ended and removed its socket and
    /// lock. A supervisor that keeps its terminal is sent `Close`, which hangs up whatever
    /// still runs there (a shell, or a program the stop left), as closing a tmux pane does.
    /// An older one ends by itself with its program and is sent nothing. Either way this waits
    /// a bounded time for that exact supervisor incarnation to be gone, and refuses while an
    /// older supervisor's program still runs.
    fn close_pane(&mut self, binding: &Binding) -> Result<(), ActionError> {
        close_terminal(self.runner, binding)
    }
    fn settle_after_stop(&mut self, binding: &Binding, deadline: Instant) {
        settle_ended_program(binding, deadline);
    }
    fn name_agent(&mut self, _: &Binding, _: &str) -> Result<AgentNaming, HostError> {
        Ok(AgentNaming::NotLinked)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::{CommandOutput, CommandRequest, UnixCommandRunner};
    use std::process::{Child, Command, Stdio};

    fn spawn(script: &str) -> (Child, u64, String) {
        let child = Command::new("/bin/sh")
            .args(["-c", script])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let pid = u64::from(child.id());
        let start = runtime::observe_start(
            &UnixCommandRunner,
            pid,
            Instant::now() + Duration::from_secs(5),
        )
        .unwrap()
        .expect("a live child has a start identity");
        (child, pid, start)
    }

    /// Counts every process observation, native or through `ps`, the Unix runner is asked for.
    struct Counting {
        calls: std::cell::Cell<usize>,
    }
    impl Counting {
        fn count(&self) {
            self.calls.set(self.calls.get() + 1);
        }
    }
    impl CommandRunner for Counting {
        fn process_observation(
            &self,
            pid: u64,
            deadline: Instant,
        ) -> Option<runtime::ProcessObservation> {
            self.count();
            UnixCommandRunner.process_observation(pid, deadline)
        }
        fn process_parent(&self, pid: u64, deadline: Instant) -> Option<u64> {
            self.count();
            UnixCommandRunner.process_parent(pid, deadline)
        }
        fn process_link(&self, pid: u64, deadline: Instant) -> Option<ancestry::ProcessLink> {
            self.count();
            UnixCommandRunner.process_link(pid, deadline)
        }
        fn execute(&self, request: CommandRequest<'_>) -> Result<CommandOutput, CommandError> {
            self.count();
            UnixCommandRunner.execute(request)
        }
        fn execute_leaf(&self, request: CommandRequest<'_>) -> Result<CommandOutput, CommandError> {
            self.count();
            UnixCommandRunner.execute_leaf(request)
        }
    }

    #[test]
    fn a_snapshot_reports_the_live_directory_without_another_process_observation() {
        use crate::test_support::{TestChild, TestDirectory};
        let root = TestDirectory::new();
        let (first, second) = (root.path.join("first"), root.path.join("second"));
        std::fs::create_dir(&first).unwrap();
        std::fs::create_dir(&second).unwrap();
        let moved = root.path.join("moved");
        let script = format!(
            "cd {} && : > {} && exec sleep 30",
            second.display(),
            moved.display()
        );
        let mut child = TestChild::new(
            Command::new("/bin/sh")
                .args(["-c", &script])
                .current_dir(&first)
                .stdin(Stdio::null())
                .spawn()
                .unwrap(),
        );
        child.wait_for_content(&moved, "", Duration::from_secs(10));
        let deadline = Instant::now() + Duration::from_secs(10);
        let (server_pid, pane_pid) = (u64::from(std::process::id()), u64::from(child.child.id()));
        let server = ServerEvidence {
            host: HostKind::pty(),
            server_id: "server".into(),
            socket_path: "/unused/pty_cwd.sock".into(),
            server_pid,
            server_start_time: runtime::observe_start(&UnixCommandRunner, server_pid, deadline)
                .unwrap()
                .unwrap(),
        };
        let answer = || State {
            server_pid,
            pane_pid,
            marker: None,
            idle: None,
            paused: false,
            ended: None,
            shell: false,
            relaunching: false,
        };
        let runner = Counting {
            calls: Default::default(),
        };
        let driver = PtyDriver {
            runner: &runner,
            server: Some(&server),
            deadline,
            enter_delay: Duration::ZERO,
        };
        // What a snapshot observed before it reported a directory (#5634).
        verify_pair(&runner, &answer(), deadline).unwrap();
        runtime::observe_starts(&runner, &[server_pid, pane_pid], deadline).unwrap();
        let baseline = runner.calls.replace(0);
        let snapshot = driver
            .snapshot_from(&server, "pty_cwd", &[], answer())
            .unwrap();
        assert_eq!(runner.calls.get(), baseline, "no extra process observation");
        let pane = &snapshot.panes[0];
        assert_eq!(
            pane.cwd
                .as_deref()
                .map(|cwd| std::fs::canonicalize(cwd).unwrap()),
            Some(std::fs::canonicalize(&second).unwrap()),
            "the live directory after cd, not the launch directory"
        );
        assert!(pane.pane_incarnation.is_some());
        child.child.kill().unwrap();
        child.wait_for_exit(Duration::from_secs(10));
        assert!(
            driver
                .snapshot_from(&server, "pty_cwd", &[], answer())
                .map_or(true, |snapshot| snapshot
                    .panes
                    .iter()
                    .all(|pane| pane.cwd.is_none())),
            "an exited member lends no directory"
        );
    }

    #[test]
    fn old_capability_supervisor_uses_legacy_publish_and_verifies_marker() {
        use crate::test_support::{TestChild, TestDirectory};
        use std::{
            io::{Read, Write},
            os::unix::net::UnixListener,
        };
        use tmt_core::identity::Lifetime;
        use tmt_pty_protocol::{ClientMessage, Decoder, Frame, ServerMessage, Size, VERSION};

        let root = TestDirectory::new();
        let directory = root.path.join("pty");
        crate::private_file::ensure_private_directory(&directory).unwrap();
        let socket = directory.join("pty_test.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        listener.set_nonblocking(true).unwrap();
        let child = Command::new("/bin/sh")
            .args(["-c", "exec sleep 30"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let child = TestChild::new(child);
        let pane_pid = child.child.id();
        let supervisor_pid = std::process::id();
        let server_start = runtime::observe_start(
            &UnixCommandRunner,
            u64::from(supervisor_pid),
            Instant::now() + Duration::from_secs(5),
        )
        .unwrap()
        .unwrap();
        let handle = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(20);
            let mut marker = None;
            let mut seen_legacy = false;
            for step in 0..5 {
                let (mut stream, _) = loop {
                    match listener.accept() {
                        Ok(value) => break value,
                        Err(e)
                            if e.kind() == io::ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            std::thread::sleep(Duration::from_millis(10));
                        }
                        Err(e) => panic!("fake old supervisor accept: {e}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(10)))
                    .unwrap();
                let mut decoder = Decoder::new();
                let hello = loop {
                    if let Some(frame) = decoder.frame::<ClientMessage>().unwrap() {
                        break frame;
                    }
                    let mut buf = [0; 4096];
                    let n = stream.read(&mut buf).unwrap();
                    assert!(n > 0);
                    decoder.push(&buf[..n]).unwrap();
                };
                assert!(matches!(hello, ClientMessage::Hello { version: VERSION }));
                stream
                    .write_all(
                        &ServerMessage::Welcome {
                            version: VERSION,
                            size: Size::new(80, 24).unwrap(),
                        }
                        .encode(),
                    )
                    .unwrap();
                let request = loop {
                    if let Some(frame) = decoder.frame::<ClientMessage>().unwrap() {
                        break frame;
                    }
                    let mut buf = [0; 4096];
                    let n = stream.read(&mut buf).unwrap();
                    assert!(n > 0);
                    decoder.push(&buf[..n]).unwrap();
                };
                let answer = match request {
                    ClientMessage::Control(Control::Capabilities) if step == 0 || step == 4 => {
                        continue;
                    }
                    ClientMessage::Control(Control::Inspect) if step == 1 || step == 3 => {
                        ControlReply::State {
                            supervisor_pid,
                            pane_pid,
                            key_idle_ms: None,
                            marker: marker.clone(),
                            paused: false,
                            ended: None,
                            shell: false,
                            relaunching: false,
                        }
                    }
                    ClientMessage::Control(Control::Publish {
                        pane_pid: pid,
                        key,
                        marker: value,
                    }) if step == 2 => {
                        assert_eq!(pid, pane_pid);
                        assert_eq!(key, "binding");
                        marker = Some(value);
                        seen_legacy = true;
                        ControlReply::Applied(true)
                    }
                    other => panic!("unexpected old supervisor request: {other:?}"),
                };
                stream
                    .write_all(&ServerMessage::Control(answer).encode())
                    .unwrap();
            }
            assert!(seen_legacy);
        });
        let server = ServerEvidence {
            host: HostKind::pty(),
            server_id: "server".into(),
            socket_path: socket.to_string_lossy().into_owned(),
            server_pid: u64::from(supervisor_pid),
            server_start_time: server_start,
        };
        let binding = Binding {
            id: "binding".into(),
            identity_id: "identity".into(),
            server,
            pane_id: "pty_test".into(),
            pane_pid: u64::from(pane_pid),
            pane_incarnation: None,
            session: Default::default(),
        };
        let identity = Identity {
            id: "identity".into(),
            name: "Name".into(),
            canonical_name: "name".into(),
            lifetime: Lifetime::Saved,
            created_at: "".into(),
            updated_at: "".into(),
        };
        let deadline = Instant::now() + Duration::from_secs(15);
        let mut driver = PtyDriver {
            runner: &UnixCommandRunner,
            server: None,
            deadline,
            enter_delay: Duration::ZERO,
        };
        assert!(driver.publish_if(&binding, &identity, None).unwrap());
        let observed = state(&binding.server.socket_path, &binding.pane_id, deadline).unwrap();
        assert_eq!(observed.marker.unwrap().binding_id, "binding");
        assert!(!driver.conditional_clear(&binding).unwrap());
        handle.join().unwrap();
    }

    /// A fake supervisor at `pty_resume.sock` that answers each connection's one control
    /// with `answer` (or closes it on `None`) and records every control it received.
    fn fake_supervisor(
        answer: impl Fn(&Control) -> Option<ControlReply> + Send + 'static,
        connections: usize,
    ) -> (
        crate::test_support::TestDirectory,
        Binding,
        std::thread::JoinHandle<Vec<Control>>,
    ) {
        use std::{
            io::{Read, Write},
            os::unix::net::UnixListener,
        };
        use tmt_pty_protocol::{ClientMessage, Decoder, Frame, ServerMessage, Size, VERSION};
        let root = crate::test_support::TestDirectory::new();
        let directory = root.path.join("pty");
        crate::private_file::ensure_private_directory(&directory).unwrap();
        let socket = directory.join("pty_resume.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let handle = std::thread::spawn(move || {
            let mut seen = Vec::new();
            for _ in 0..connections {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(10)))
                    .unwrap();
                let mut decoder = Decoder::new();
                let mut next = |stream: &mut std::os::unix::net::UnixStream| loop {
                    if let Some(frame) = decoder.frame::<ClientMessage>().unwrap() {
                        break frame;
                    }
                    let mut buf = [0; 4096];
                    let n = stream.read(&mut buf).unwrap();
                    assert!(n > 0);
                    decoder.push(&buf[..n]).unwrap();
                };
                assert!(matches!(
                    next(&mut stream),
                    ClientMessage::Hello { version: VERSION }
                ));
                let welcome = ServerMessage::Welcome {
                    version: VERSION,
                    size: Size::new(80, 24).unwrap(),
                };
                stream.write_all(&welcome.encode()).unwrap();
                let ClientMessage::Control(request) = next(&mut stream) else {
                    panic!("expected a control");
                };
                if let Some(reply) = answer(&request) {
                    stream
                        .write_all(&ServerMessage::Control(reply).encode())
                        .unwrap();
                }
                seen.push(request);
            }
            seen
        });
        let binding = Binding {
            id: "binding".into(),
            identity_id: "identity".into(),
            server: ServerEvidence {
                host: HostKind::pty(),
                server_id: "server".into(),
                socket_path: socket.to_string_lossy().into_owned(),
                server_pid: 1,
                server_start_time: "start".into(),
            },
            pane_id: "pty_resume".into(),
            pane_pid: 2,
            pane_incarnation: None,
            session: Default::default(),
        };
        (root, binding, handle)
    }

    #[test]
    fn a_supervisor_without_the_resume_flag_is_unsupported_and_never_sent_resume() {
        // A supervisor from before the flags answers capabilities with `Applied(true)`.
        let (_root, binding, handle) = fake_supervisor(
            |request| match request {
                Control::Capabilities => Some(ControlReply::Applied(true)),
                other => panic!("sent {other:?} to a supervisor without resume"),
            },
            1,
        );
        assert!(matches!(resume(&binding), Err(ResumeError::Unsupported)));
        assert_eq!(handle.join().unwrap(), vec![Control::Capabilities]);
    }

    #[test]
    fn a_closed_capability_connection_is_a_transport_failure_not_unsupported() {
        let (_root, binding, handle) = fake_supervisor(|_| None, 1);
        assert!(matches!(resume(&binding), Err(ResumeError::Unconfirmed)));
        assert_eq!(handle.join().unwrap(), vec![Control::Capabilities]);
    }

    #[test]
    fn a_supervisor_with_the_resume_flag_is_sent_resume() {
        let (_root, binding, handle) = fake_supervisor(
            |request| {
                Some(match request {
                    Control::Capabilities => ControlReply::Capabilities {
                        resume: true,
                        relaunch: false,
                        close: false,
                        terminal: false,
                    },
                    Control::Resume => ControlReply::Applied(true),
                    other => panic!("unexpected {other:?}"),
                })
            },
            2,
        );
        resume(&binding).unwrap();
        assert_eq!(
            handle.join().unwrap(),
            vec![Control::Capabilities, Control::Resume]
        );
    }

    const SHELL: RelaunchKind = RelaunchKind::Shell;

    fn shell_program() -> Vec<String> {
        vec!["/bin/sh".into(), "-l".into()]
    }

    #[test]
    fn a_supervisor_without_the_relaunch_or_close_flags_is_sent_neither() {
        // A supervisor from #5926 grants resume only; one from before answers Applied(true).
        for old in [
            ControlReply::Capabilities {
                resume: true,
                relaunch: false,
                close: false,
                terminal: false,
            },
            ControlReply::Applied(true),
        ] {
            let answer = old.clone();
            let (_root, binding, handle) = fake_supervisor(
                move |request| match request {
                    Control::Capabilities => Some(answer.clone()),
                    other => panic!("sent {other:?} to a supervisor without relaunch"),
                },
                1,
            );
            assert!(matches!(
                relaunch(&binding, SHELL, shell_program()),
                Err(RelaunchError::Unsupported)
            ));
            assert_eq!(handle.join().unwrap(), vec![Control::Capabilities]);

            let answer = old.clone();
            let (_root, binding, handle) = fake_supervisor(
                move |request| match request {
                    Control::Capabilities => Some(answer.clone()),
                    other => panic!("sent {other:?} to a supervisor without close"),
                },
                1,
            );
            // Its supervisor (PID 1 with another start) is not the binding's: the
            // close waits for nothing and was sent nothing.
            close_terminal(&UnixCommandRunner, &binding).unwrap();
            assert_eq!(handle.join().unwrap(), vec![Control::Capabilities]);
        }
    }

    #[test]
    fn a_closed_capability_connection_never_relaunches() {
        let (_root, binding, handle) = fake_supervisor(|_| None, 1);
        assert!(matches!(
            relaunch(&binding, SHELL, shell_program()),
            Err(RelaunchError::Unconfirmed(_))
        ));
        assert_eq!(handle.join().unwrap(), vec![Control::Capabilities]);
    }

    fn granting(request: &Control, relaunch: ControlReply) -> Option<ControlReply> {
        Some(match request {
            Control::Capabilities => ControlReply::Capabilities {
                resume: true,
                relaunch: true,
                close: true,
                terminal: false,
            },
            Control::Relaunch { .. } => relaunch,
            Control::Inspect => ControlReply::State {
                supervisor_pid: 1,
                pane_pid: 2,
                key_idle_ms: None,
                marker: None,
                paused: false,
                ended: Some(Exit::Code(0)),
                shell: false,
                relaunching: false,
            },
            Control::Close => ControlReply::Applied(true),
            other => panic!("unexpected {other:?}"),
        })
    }

    #[test]
    fn a_granting_supervisor_is_sent_relaunch_and_its_refusal_is_returned() {
        let (_root, binding, handle) =
            fake_supervisor(|request| granting(request, ControlReply::Applied(true)), 2);
        relaunch(&binding, SHELL, shell_program()).unwrap();
        assert_eq!(
            handle.join().unwrap(),
            vec![
                Control::Capabilities,
                Control::Relaunch {
                    kind: SHELL,
                    program: shell_program()
                }
            ]
        );
        let refused = "the shell is still running; exit it first";
        let (_root, binding, handle) = fake_supervisor(
            move |request| granting(request, ControlReply::Error(refused.into())),
            2,
        );
        assert!(matches!(
            relaunch(&binding, SHELL, shell_program()),
            Err(RelaunchError::Refused(reason)) if reason == refused
        ));
        handle.join().unwrap();
    }

    #[test]
    fn a_granting_supervisor_of_the_binding_is_sent_close() {
        let (_root, binding, handle) =
            fake_supervisor(|request| granting(request, ControlReply::Applied(false)), 3);
        close_terminal(&UnixCommandRunner, &binding).unwrap();
        assert_eq!(
            handle.join().unwrap(),
            vec![Control::Capabilities, Control::Inspect, Control::Close]
        );
    }

    #[test]
    fn a_kept_terminal_decodes_as_a_member_program_that_is_not_running() {
        let state = |ended, shell| {
            decode_state(ControlReply::State {
                supervisor_pid: 1,
                pane_pid: 2,
                key_idle_ms: None,
                marker: None,
                paused: false,
                ended,
                shell,
                relaunching: false,
            })
            .unwrap()
            .program_running()
        };
        assert!(state(None, false));
        assert!(!state(Some(Exit::Signal(2)), false));
        assert!(!state(None, true));
    }

    #[test]
    fn a_state_from_a_supervisor_before_pausing_decodes_as_not_paused() {
        let legacy = ControlReply::State {
            supervisor_pid: 1,
            pane_pid: 2,
            key_idle_ms: None,
            marker: None,
            paused: false,
            ended: None,
            shell: false,
            relaunching: false,
        };
        assert!(!decode_state(legacy).unwrap().paused);
        let paused = ControlReply::State {
            supervisor_pid: 1,
            pane_pid: 2,
            key_idle_ms: None,
            marker: None,
            paused: true,
            ended: None,
            shell: false,
            relaunching: false,
        };
        assert!(decode_state(paused).unwrap().paused);
    }

    /// A supervisor answering `Inspect` for pane process `pane_pid`, reporting it running for
    /// the first `behind` answers and ended after that.
    fn lagging_supervisor(
        pane_pid: u64,
        behind: usize,
        connections: usize,
    ) -> (
        crate::test_support::TestDirectory,
        Binding,
        std::thread::JoinHandle<Vec<Control>>,
        std::sync::Arc<std::sync::atomic::AtomicUsize>,
    ) {
        let answered = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counted = answered.clone();
        let (root, mut binding, handle) = fake_supervisor(
            move |request| {
                assert_eq!(request, &Control::Inspect);
                let n = answered.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                Some(ControlReply::State {
                    supervisor_pid: 1,
                    pane_pid: pane_pid as u32,
                    key_idle_ms: None,
                    marker: None,
                    paused: false,
                    ended: (n >= behind).then_some(Exit::Code(0)),
                    shell: false,
                    relaunching: false,
                })
            },
            connections,
        );
        binding.pane_pid = pane_pid;
        (root, binding, handle, counted)
    }

    /// The answers given so far, read before joining, so asking too few fails instead of
    /// leaving the fake waiting for a connection.
    fn answers(answered: &std::sync::atomic::AtomicUsize) -> usize {
        answered.load(std::sync::atomic::Ordering::Relaxed)
    }

    #[test]
    fn after_a_stop_the_close_waits_for_the_supervisor_to_report_the_program_ended() {
        // The agent is gone, and the program over it is still exiting or not yet reaped.
        let (_root, binding, handle, answered) = lagging_supervisor(4242, 2, 3);
        settle_ended_program(&binding, Instant::now() + Duration::from_secs(10));
        // It asked until the report caught up, and no more: the third answer was settled.
        assert_eq!(answers(&answered), 3);
        assert_eq!(handle.join().unwrap(), vec![Control::Inspect; 3]);
    }

    #[test]
    fn a_report_naming_another_program_is_already_settled_and_asked_once() {
        let (_root, mut binding, handle, answered) = lagging_supervisor(4242, usize::MAX, 1);
        binding.pane_pid = 4243;
        settle_ended_program(&binding, Instant::now() + Duration::from_secs(10));
        assert_eq!(answers(&answered), 1);
        assert_eq!(handle.join().unwrap(), vec![Control::Inspect]);
    }

    #[test]
    fn a_supervisor_that_ends_within_the_bound_closes_the_member() {
        let (mut child, pid, start) = spawn("sleep 0.3");
        let reaper = std::thread::spawn(move || child.wait());
        wait_for_supervisor_end(&UnixCommandRunner, pid, &start, Duration::from_secs(10))
            .expect("the supervisor ended");
        reaper.join().unwrap().unwrap();
    }

    #[test]
    fn a_running_program_is_refused_after_the_bound_and_left_alone() {
        let (mut child, pid, start) = spawn("sleep 30");
        let started = Instant::now();
        let refused =
            wait_for_supervisor_end(&UnixCommandRunner, pid, &start, Duration::from_millis(400));
        assert!(
            matches!(refused, Err(ActionError::Evidence(_))),
            "{refused:?}"
        );
        assert!(started.elapsed() >= Duration::from_millis(300));
        // Nothing was signalled: it is still the same live process.
        assert!(child.try_wait().unwrap().is_none());
        child.kill().unwrap();
        child.wait().unwrap();
    }

    #[test]
    fn another_incarnation_of_the_pid_counts_as_the_supervisor_having_ended() {
        let (mut child, pid, _) = spawn("sleep 30");
        wait_for_supervisor_end(&UnixCommandRunner, pid, "some other start", BUDGET)
            .expect("a different start identity is a different process");
        child.kill().unwrap();
        child.wait().unwrap();
    }
}
