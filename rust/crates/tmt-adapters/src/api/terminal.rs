//! Where a built-in-host member's terminal stream is: a read-only lookup for a view such as
//! the Ops Terminal tab. It opens no connection and starts, wakes or types nothing; the
//! stream itself is `contracts/terminal-stream-v1.md`. `terminal.resume` continues a member
//! stopped by job control (Ctrl-Z), and `terminal.relaunch` starts a program on the kept
//! terminal of a member whose program ended; they are the operations here with an effect.
//! `terminal.open`, `terminal.list` and `terminal.close` manage a member's extra terminals
//! (`pty::terminal`) on any host: login shells the member owns, never panes or Talk targets.
//! `terminal.run` confirms one command submission through that terminal owner.
use super::{Fault, Request, invalid};
use crate::storage::saved_terminal::{SavedShell, SavedTerminalError, SavedTerminalRecord};
use crate::{
    config::ConfigPaths,
    delivery,
    host::{Host, OperationOptions, RelaunchError, ResumeError, TerminalState},
    pty::{
        LaunchError,
        protocol::{Exit, RelaunchKind},
        terminal::{self, TerminalError},
    },
    storage::Storage,
};
use serde::Deserialize;
use serde_json::json;
use std::path::Path;
use tmt_core::{
    binding::{Binding, BindingEntry, BindingEvidence, evaluate_binding},
    endpoint::ServerEvidence,
    host::HostKind,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    identity_id: String,
}

fn identity_id(input: &[u8]) -> Result<String, Fault> {
    let input: Input = serde_json::from_slice(input).map_err(|_| invalid())?;
    if !tmt_core::dispatch::canonical_id(&input.identity_id) {
        return Err(invalid());
    }
    Ok(input.identity_id)
}

pub(super) fn decode(input: &[u8]) -> Result<Request, Fault> {
    Ok(Request::TerminalStream {
        identity_id: identity_id(input)?,
    })
}

pub(super) fn decode_resume(input: &[u8]) -> Result<Request, Fault> {
    Ok(Request::TerminalResume {
        identity_id: identity_id(input)?,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RelaunchInput {
    identity_id: String,
    kind: String,
}

pub(super) fn decode_relaunch(input: &[u8]) -> Result<Request, Fault> {
    let input: RelaunchInput = serde_json::from_slice(input).map_err(|_| invalid())?;
    let kind = match input.kind.as_str() {
        "resume" => RelaunchKind::Resume,
        "new" => RelaunchKind::New,
        "shell" => RelaunchKind::Shell,
        _ => return Err(invalid()),
    };
    if !tmt_core::dispatch::canonical_id(&input.identity_id) {
        return Err(invalid());
    }
    Ok(Request::TerminalRelaunch {
        identity_id: input.identity_id,
        kind,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CloseInput {
    terminal_id: String,
    #[serde(default)]
    force: bool,
}

pub(super) fn decode_open(input: &[u8]) -> Result<Request, Fault> {
    Ok(Request::TerminalOpen {
        identity_id: identity_id(input)?,
    })
}

/// At most this many members in one batch `terminal.list`.
pub const LIST_MANY_LIMIT: usize = 256;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListManyInput {
    identity_ids: Vec<String>,
}

/// `{identityId}` lists one member after its binding check; `{identityIds}` lists several
/// from one scan (#6301), so a board's start sweep is one call.
pub(super) fn decode_list(input: &[u8]) -> Result<Request, Fault> {
    if let Ok(many) = serde_json::from_slice::<ListManyInput>(input) {
        let mut ids = many.identity_ids;
        if ids.is_empty()
            || ids.len() > LIST_MANY_LIMIT
            || !ids.iter().all(|id| tmt_core::dispatch::canonical_id(id))
        {
            return Err(invalid());
        }
        ids.sort();
        ids.dedup();
        return Ok(Request::TerminalListMany { identity_ids: ids });
    }
    Ok(Request::TerminalList {
        identity_id: identity_id(input)?,
    })
}

pub(super) fn decode_close(input: &[u8]) -> Result<Request, Fault> {
    let input: CloseInput = serde_json::from_slice(input).map_err(|_| invalid())?;
    if !terminal::is_terminal_id(&input.terminal_id) {
        return Err(invalid());
    }
    Ok(Request::TerminalClose {
        terminal_id: input.terminal_id,
        force: input.force,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunInput {
    identity_id: String,
    terminal_id: String,
    command: String,
}

pub(super) fn decode_run(input: &[u8]) -> Result<Request, Fault> {
    let input: RunInput = serde_json::from_slice(input).map_err(|_| invalid())?;
    if !tmt_core::dispatch::canonical_id(&input.identity_id)
        || !terminal::is_terminal_id(&input.terminal_id)
        || !tmt_pty_protocol::valid_command(&input.command)
    {
        return Err(invalid());
    }
    Ok(Request::TerminalRun {
        identity_id: input.identity_id,
        terminal_id: input.terminal_id,
        command: input.command,
    })
}

pub(super) fn run(
    paths: &ConfigPaths,
    storage: &mut Storage,
    id: &str,
    terminal_id: &str,
    command: &str,
) -> Result<Vec<u8>, Fault> {
    use terminal::RunError;
    use tmt_pty_protocol::TerminalRunResult;
    let binding = member(storage, id)?;
    let (pid, start) = owner_process(&binding).map_err(|_| no_live_member())?;
    terminal::run(
        paths,
        terminal_id,
        &terminal::Owner {
            identity: id,
            pid,
            start: &start,
        },
        command,
    )
    .map_err(|error| match error {
        RunError::NotFound => Fault::new(
            "TERMINAL_NOT_FOUND",
            "No running terminal has this id; nothing was submitted.",
        ),
        RunError::Unavailable(cause) => Fault::detailed(
            "TERMINAL_STREAM_UNAVAILABLE",
            format!("Nothing was submitted: the terminal could not be confirmed: {cause}"),
        ),
        RunError::Unsupported => Fault::new(
            "TERMINAL_RUN_UNSUPPORTED",
            "This terminal cannot confirm command submission; nothing was submitted.",
        ),
        RunError::Refused(TerminalRunResult::Busy) => Fault::new(
            "TERMINAL_BUSY",
            "The terminal's shell is not idle; nothing was submitted.",
        ),
        RunError::Refused(TerminalRunResult::Ended) => Fault::new(
            "TERMINAL_ENDED",
            "The terminal has ended; nothing was submitted.",
        ),
        RunError::Refused(_) => Fault::new(
            "TERMINAL_STALE",
            "The terminal belongs to a different member launch; nothing was submitted.",
        ),
        RunError::Unconfirmed(cause) => Fault::detailed(
            "TERMINAL_RUN_UNCONFIRMED",
            format!("The command may have been submitted; do not retry automatically: {cause}"),
        ),
    })?;
    serde_json::to_vec(&json!({"identityId": id, "terminalId": terminal_id, "submitted": true}))
        .map_err(|_| Fault::unavailable())
}

fn unavailable() -> Fault {
    Fault::new(
        "TERMINAL_STREAM_UNAVAILABLE",
        "The identity has no live member on the built-in host.",
    )
}

fn resume_unsupported() -> Fault {
    Fault::new(
        "TERMINAL_RESUME_UNSUPPORTED",
        "Only a member on the built-in host can be resumed.",
    )
}

fn relaunch_unsupported() -> Fault {
    Fault::new(
        "TERMINAL_RELAUNCH_UNSUPPORTED",
        "Only a member on the built-in host whose supervisor keeps its terminal can be relaunched; restart the member.",
    )
}

fn entry(storage: &mut Storage, id: &str) -> Result<BindingEntry, Fault> {
    delivery::current(storage, id)
        .map_err(|_| Fault::unavailable())?
        .ok_or_else(|| Fault::new("NAME_NOT_FOUND", "The selected identity was not found."))
}

/// The identity's binding once fresh host evidence shows it Active. Presence only,
/// as for `pane.screen`: an ended agent's kept terminal still has a stream to read, but a
/// member whose supervisor is gone does not.
fn active(entry: &BindingEntry) -> Result<&Binding, Fault> {
    active_or_gone(entry)?.ok_or_else(unavailable)
}

/// As `active`, except that a binding whose supervisor is gone is `None` rather than an
/// error. Only lost-endpoint evidence counts as gone; a mismatched or unknown answer
/// stays unavailable, so a relaunch never starts beside a member that may still run.
fn active_or_gone(entry: &BindingEntry) -> Result<Option<&Binding>, Fault> {
    let binding = entry.binding.as_ref().ok_or_else(unavailable)?;
    let probe = Host::for_server(&binding.server)
        .probe(
            &binding.server,
            OperationOptions {
                deadline: None,
                pane_ids: Some(std::slice::from_ref(&binding.pane_id)),
            },
        )
        .map_err(|_| Fault::unavailable())?;
    match evaluate_binding(entry, &probe) {
        BindingEvidence::Active(_) => Ok(Some(binding)),
        BindingEvidence::EndpointLost => Ok(None),
        BindingEvidence::MarkerMismatch | BindingEvidence::Unknown => Err(unavailable()),
    }
}

pub(super) fn stream(storage: &mut Storage, id: &str) -> Result<Vec<u8>, Fault> {
    let entry = entry(storage, id)?;
    if entry
        .binding
        .as_ref()
        .is_none_or(|binding| binding.server.host != HostKind::pty())
    {
        return Err(unavailable());
    }
    let binding = active(&entry)?;
    resource(
        id,
        &binding.server,
        &binding.pane_id,
        crate::host::member_terminal(binding),
    )
}

/// Continues a built-in member stopped by job control. Idempotent: a member that is not
/// paused is resumed as well. The pause clears once the supervisor observes it continue.
pub(super) fn resume(storage: &mut Storage, id: &str) -> Result<Vec<u8>, Fault> {
    let entry = entry(storage, id)?;
    let binding = entry.binding.as_ref().ok_or_else(unavailable)?;
    if binding.server.host != HostKind::pty() {
        return Err(resume_unsupported());
    }
    let binding = active(&entry)?;
    match crate::host::resume_member(binding) {
        Ok(()) => serde_json::to_vec(&json!({"identityId": id, "resumed": true}))
            .map_err(|_| Fault::unavailable()),
        Err(ResumeError::Unsupported) => Err(Fault::new(
            "TERMINAL_RESUME_UNSUPPORTED",
            "Resume is unsupported by this member's supervisor; restart the member.",
        )),
        Err(ResumeError::Unconfirmed) => Err(Fault::unavailable()),
    }
}

/// Starts a program on the kept terminal of a built-in member whose program ended, under
/// the same binding. `resume` and `new` run the in-terminal launcher that `tmt resume -- ID`
/// and `tmt resume --new -- ID` run in a new supervisor, so its preflight, session selection
/// and learning are the CLI's own; `shell` runs the user's login shell, which is no agent.
/// A member whose supervisor is gone, as after a reboot, gets a new terminal instead
/// (`relaunch_offline`). Any read that reconciles drops such a binding, so an identity with
/// no binding takes that path too; the built-in capture then decides whether it has a folder.
pub(super) fn relaunch(
    paths: &ConfigPaths,
    storage: &mut Storage,
    id: &str,
    kind: RelaunchKind,
) -> Result<Vec<u8>, Fault> {
    let entry = entry(storage, id)?;
    let Some(binding) = entry.binding.as_ref() else {
        return relaunch_offline(paths, id, kind);
    };
    if binding.server.host != HostKind::pty() {
        return Err(relaunch_unsupported());
    }
    let Some(binding) = active_or_gone(&entry)? else {
        return relaunch_offline(paths, id, kind);
    };
    let program = relaunch_program(id, kind)?;
    match crate::host::relaunch_member(binding, kind, program) {
        Ok(_) => serde_json::to_vec(&json!({"identityId": id, "relaunched": kind_name(kind)}))
            .map_err(|_| Fault::unavailable()),
        Err(RelaunchError::Unsupported) => Err(relaunch_unsupported()),
        Err(RelaunchError::Refused(reason)) => Err(Fault::detailed(
            "TERMINAL_RELAUNCH_REFUSED",
            format!("Nothing was started: {reason}."),
        )),
        Err(RelaunchError::Exited { status, output }) => Err(Fault::detailed(
            "TERMINAL_RELAUNCH_FAILED",
            format!(
                "The relaunched command ended before it started ({}); the terminal is kept.{}",
                exit_text(status),
                tail(&output)
            ),
        )),
        Err(RelaunchError::Unconfirmed(cause)) => Err(Fault::detailed(
            "TERMINAL_RELAUNCH_UNCONFIRMED",
            format!("The relaunch was not confirmed; a program may have started: {cause}"),
        )),
    }
}

/// A new built-in terminal for a member whose supervisor is gone, started in the folder
/// the built-in workspace capture recorded for it, running what `tmt resume --host pty`
/// runs there. With no recorded folder, or one that no longer exists, nothing starts: the
/// provider finds its session by folder, so another folder would resume the wrong session.
/// A shell needs a member's binding, so it opens only on a kept terminal.
fn relaunch_offline(paths: &ConfigPaths, id: &str, kind: RelaunchKind) -> Result<Vec<u8>, Fault> {
    if kind == RelaunchKind::Shell {
        return Err(Fault::new(
            "TERMINAL_RELAUNCH_UNSUPPORTED",
            "A shell opens only on a member's kept terminal; resume the member or start a new session first.",
        ));
    }
    let refused = |reason: String| {
        Fault::detailed(
            "TERMINAL_RELAUNCH_REFUSED",
            format!("Nothing was started: {reason}."),
        )
    };
    let folder = crate::workspace::builtin_member_folder(paths, id)
        .map_err(|_| Fault::unavailable())?
        .ok_or_else(|| {
            refused(
                "no folder is recorded for this member; start it with tmt resume from its folder"
                    .into(),
            )
        })?;
    if !folder.is_dir() {
        return Err(refused(format!(
            "the member's folder {} no longer exists",
            folder.display()
        )));
    }
    let program = relaunch_program(id, kind)?;
    let (executable, arguments) = program.split_first().ok_or_else(Fault::unavailable)?;
    let arguments: Vec<std::ffi::OsString> = arguments.iter().map(Into::into).collect();
    match crate::pty::start_member(executable.as_ref(), &arguments, paths, Some(&folder)) {
        Ok(_) => serde_json::to_vec(&json!({"identityId": id, "relaunched": kind_name(kind)}))
            .map_err(|_| Fault::unavailable()),
        Err(LaunchError::Exited { status, output }) => Err(Fault::detailed(
            "TERMINAL_RELAUNCH_FAILED",
            format!(
                "The relaunched command ended before it started ({}); no terminal is kept.{}",
                exit_text(status),
                tail(&output)
            ),
        )),
        Err(LaunchError::Unconfirmed { cause, .. }) => Err(Fault::detailed(
            "TERMINAL_RELAUNCH_UNCONFIRMED",
            format!("The relaunch was not confirmed; a program may have started: {cause}"),
        )),
        Err(LaunchError::NotStarted(cause)) => Err(Fault::detailed(
            "TERMINAL_RELAUNCH_FAILED",
            format!("Nothing was started: {cause}."),
        )),
        Err(LaunchError::Refused(reason)) => Err(refused(reason)),
    }
}

/// The launcher's last lines, which carry a refusal's reason, within a bounded message.
fn tail(output: &str) -> String {
    let lines: Vec<&str> = output
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.is_empty())
        .collect();
    let mut text = lines[lines.len().saturating_sub(6)..].join("\n");
    if text.len() > 2048 {
        let start = text.ceil_char_boundary(text.len() - 2048);
        text.drain(..start);
    }
    if text.is_empty() {
        text
    } else {
        format!("\n{text}")
    }
}

/// The member's live binding on any host, for its extra terminals (#6301). The terminals are
/// TMT supervisors whatever the host, so only the binding's presence is checked, with the same
/// fresh evidence as `terminal.stream`.
fn member(storage: &mut Storage, id: &str) -> Result<Binding, Fault> {
    let entry = entry(storage, id)?;
    active(&entry).cloned().map_err(|_| no_live_member())
}

fn no_live_member() -> Fault {
    Fault::new(
        "TERMINAL_STREAM_UNAVAILABLE",
        "The identity has no live member.",
    )
}

/// The process whose life a member's extra terminals follow, as its pid and start token: the
/// supervisor on the built-in host, else the bound pane's process, read now with the token
/// `pty::terminal::member_alive` compares. A recorded pane start that differs is a reused pid.
fn owner_process(binding: &Binding) -> Result<(u64, String), Fault> {
    if binding.server.host == HostKind::pty() {
        return Ok((
            binding.server.server_pid,
            binding.server.server_start_time.clone(),
        ));
    }
    let start = crate::process::runtime::observe_start(
        &crate::process::UnixCommandRunner,
        binding.pane_pid,
        std::time::Instant::now() + std::time::Duration::from_secs(3),
    )
    .ok()
    .flatten()
    .ok_or_else(|| {
        Fault::detailed(
            "TERMINAL_OPEN_FAILED",
            "Nothing was started: the member's pane process could not be observed.".into(),
        )
    })?;
    if binding
        .pane_incarnation
        .as_ref()
        .is_some_and(|recorded| *recorded != start)
    {
        return Err(no_live_member());
    }
    Ok((binding.pane_pid, start))
}

/// `shell` and `program` are untrusted display text, already cleaned and bounded by the
/// supervisor protocol; each is left out when unknown (#6112).
fn terminal_json(terminal: &terminal::Terminal) -> serde_json::Value {
    let mut value = json!({
        "terminalId": terminal.id,
        "socket": terminal.socket,
        "pane": terminal.id,
        "busy": terminal.busy,
        "createdMs": terminal.created_ms,
    });
    for (key, name) in [("shell", &terminal.shell), ("program", &terminal.program)] {
        if let Some(name) = name {
            value[key] = name.as_str().into();
        }
    }
    value
}

pub(super) fn open(paths: &ConfigPaths, storage: &mut Storage, id: &str) -> Result<Vec<u8>, Fault> {
    let binding = member(storage, id)?;
    let failed = |message: String| Fault::detailed("TERMINAL_OPEN_FAILED", message);
    let executable = crate::core_executable::selected().map_err(|_| {
        failed("Nothing was started: the Core executable could not be located.".into())
    })?;
    let (pid, start) = owner_process(&binding)?;
    // The member's launch directory is its owner process's; doubt falls back to home.
    let directory = i32::try_from(pid)
        .ok()
        .and_then(tmt_sys::process_cwd)
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| "/".into());
    let shell = relaunch_program(id, RelaunchKind::Shell)?;
    let owner = terminal::Owner {
        identity: id,
        pid,
        start: &start,
    };
    match terminal::open(
        executable.as_os_str(),
        paths,
        &owner,
        Path::new(&directory),
        &shell,
    ) {
        Ok(opened) => {
            let mut value = terminal_json(&opened);
            value["identityId"] = id.into();
            value["directory"] = directory.into();
            if let Some(fields) = value.as_object_mut() {
                for key in ["busy", "createdMs", "shell", "program"] {
                    fields.remove(key);
                }
            }
            serde_json::to_vec(&value).map_err(|_| Fault::unavailable())
        }
        Err(TerminalError::Limit) => Err(Fault::detailed(
            "TERMINAL_LIMIT",
            format!(
                "The member already has {} terminals; close one first.",
                terminal::TERMINAL_LIMIT
            ),
        )),
        Err(TerminalError::Unconfirmed { id, cause }) => Err(unconfirmed_open(id, cause)),
        Err(error) => Err(failed(format!("Nothing was started: {error}."))),
    }
}

fn unconfirmed_open(id: String, cause: std::io::Error) -> Fault {
    Fault::terminal_open_unconfirmed(
        format!(
            "Terminal {id} was not confirmed and may be running; list or close it, do not open again to retry: {cause}"
        ),
        id,
    )
}

pub(super) fn list(paths: &ConfigPaths, storage: &mut Storage, id: &str) -> Result<Vec<u8>, Fault> {
    member(storage, id)?;
    let terminals: Vec<_> = terminal::list(paths, id)
        .iter()
        .map(terminal_json)
        .collect();
    serde_json::to_vec(&json!({"identityId": id, "terminals": terminals}))
        .map_err(|_| Fault::unavailable())
}

/// The batch form: each requested member with a stored binding and its terminals, possibly
/// none; an unknown or unbound id is left out. It reads the stored bindings in one transaction
/// and probes no host: a terminal names its owner and ends by itself once that owner is gone.
pub(super) fn list_many(
    paths: &ConfigPaths,
    storage: &mut Storage,
    identity_ids: &[String],
) -> Result<Vec<u8>, Fault> {
    use tmt_core::binding::BindingRepository;
    let bound = storage
        .with_binding_transaction::<_, crate::storage::StorageError>(|records| {
            let mut bound = Vec::new();
            for id in identity_ids {
                if records
                    .entry_by_id(id)?
                    .is_some_and(|entry| entry.binding.is_some())
                {
                    bound.push(id.clone());
                }
            }
            Ok(bound)
        })
        .map_err(|_| Fault::unavailable())?;
    let lists: Vec<_> = terminal::list_owned(paths, &bound)
        .into_iter()
        .map(|(identity, terminals)| {
            json!({
                "identityId": identity,
                "terminals": terminals.iter().map(terminal_json).collect::<Vec<_>>(),
            })
        })
        .collect();
    serde_json::to_vec(&json!({"lists": lists})).map_err(|_| Fault::unavailable())
}

pub(super) fn close(paths: &ConfigPaths, terminal_id: &str, force: bool) -> Result<Vec<u8>, Fault> {
    match terminal::close(paths, terminal_id, force) {
        Ok(()) => serde_json::to_vec(&json!({"terminalId": terminal_id, "closed": true}))
            .map_err(|_| Fault::unavailable()),
        Err(TerminalError::NotFound) => Err(Fault::new(
            "TERMINAL_NOT_FOUND",
            "No running terminal has this id.",
        )),
        Err(TerminalError::Busy) => Err(Fault::new(
            "TERMINAL_BUSY",
            "A program is still running in this terminal; close with force to end it.",
        )),
        Err(error) => Err(Fault::detailed(
            "API_UNAVAILABLE",
            format!("The terminal may still be running: {error}."),
        )),
    }
}

fn exit_text(status: Exit) -> String {
    match status {
        Exit::Code(code) => format!("exit status {code}"),
        Exit::Signal(signal) => format!("signal {signal}"),
    }
}

fn kind_name(kind: RelaunchKind) -> &'static str {
    match kind {
        RelaunchKind::Resume => "resume",
        RelaunchKind::New => "new",
        RelaunchKind::Shell => "shell",
    }
}

fn checked_saved(storage: &Storage, id: &str, expected: u64) -> Result<SavedTerminalRecord, Fault> {
    let saved = storage
        .saved_terminal(id)
        .map_err(super::shell::saved_fault)?;
    if saved.revision != expected {
        return Err(super::shell::saved_fault(SavedTerminalError::Stale));
    }
    Ok(saved)
}

fn saved_incarnation(
    shell: &SavedShell,
) -> Result<Option<tmt_core::endpoint::ProcessIncarnation>, Fault> {
    match shell {
        SavedShell::Verified { pid, start, .. } => {
            tmt_core::endpoint::ProcessIncarnation::new(*pid, start)
                .map(Some)
                .map_err(|_| {
                    Fault::new(
                        "TERMINAL_SAVED_SHELL_UNCONFIRMED",
                        "The saved shell incarnation is invalid. The result was kept.",
                    )
                })
        }
        SavedShell::Reserved { .. } => Ok(None),
    }
}

fn saved_shell_fault(error: TerminalError) -> Fault {
    if matches!(error, TerminalError::Busy) {
        Fault::new(
            "TERMINAL_SAVED_SHELL_BUSY",
            "A program is running in the saved shell. Confirm to stop it and remove the result.",
        )
    } else {
        Fault::new(
            "TERMINAL_SAVED_SHELL_UNCONFIRMED",
            "The saved shell's state could not be confirmed. The result was kept.",
        )
    }
}

fn saved_attachment(
    terminal: &SavedTerminalRecord,
    shell: &terminal::SavedShellView,
) -> Result<Vec<u8>, Fault> {
    serde_json::to_vec(&json!({
        "terminalId": terminal.terminal_id, "revision": terminal.revision,
        "shellId": shell.terminal.id, "socket": shell.terminal.socket,
        "cwd": terminal.summary.cwd,
    }))
    .map_err(|_| Fault::unavailable())
}

pub(super) fn open_saved_shell(
    paths: &ConfigPaths,
    storage: &mut Storage,
    id: &str,
    expected: u64,
) -> Result<Vec<u8>, Fault> {
    let _operation = terminal::saved_shell_operation(paths).map_err(saved_shell_fault)?;
    let mut saved = checked_saved(storage, id, expected)?;
    if let Some(shell) = &saved.shell {
        let incarnation = saved_incarnation(shell)?;
        if let Some(view) = terminal::saved_shell(paths, id, shell.id(), incarnation.as_ref())
            .map_err(saved_shell_fault)?
        {
            if incarnation.is_none() {
                saved = storage
                    .finish_saved_shell(
                        id,
                        shell,
                        Some((view.process.pid(), view.process.start_identity())),
                    )
                    .map_err(super::shell::saved_fault)?;
            }
            return saved_attachment(&saved, &view);
        }

        // Exact previous incarnation is gone and the socket is absent.
        saved = storage
            .finish_saved_shell(id, shell, None)
            .map_err(super::shell::saved_fault)?;
    }
    let cwd = Path::new(&saved.summary.cwd);
    let failed = || {
        Fault::new(
            "TERMINAL_SAVED_SHELL_NOT_STARTED",
            "The persistent shell could not start in its saved directory.",
        )
    };
    if !cwd.is_dir() {
        return Err(failed());
    }
    let executable = crate::core_executable::selected().map_err(|_| failed())?;
    let program = relaunch_program(id, RelaunchKind::Shell)?;
    let shell_id = terminal::new_saved_shell_id();
    let reserved = storage
        .reserve_saved_shell(id, saved.revision, &shell_id)
        .map_err(super::shell::saved_fault)?;
    let reservation = reserved.shell.as_ref().expect("reserved exact shell");
    let view = match terminal::start_saved_shell(
        executable.as_os_str(),
        paths,
        id,
        &shell_id,
        cwd,
        &program,
    ) {
        Ok(view) => view,
        Err(TerminalError::NotStarted(_)) => {
            storage
                .finish_saved_shell(id, reservation, None)
                .map_err(super::shell::saved_fault)?;
            return Err(failed());
        }
        Err(error) => return Err(saved_shell_fault(error)),
    };
    let saved = storage
        .finish_saved_shell(
            id,
            reservation,
            Some((view.process.pid(), view.process.start_identity())),
        )
        .map_err(super::shell::saved_fault)?;
    saved_attachment(&saved, &view)
}

pub(super) fn remove_saved(
    paths: &ConfigPaths,
    storage: &mut Storage,
    id: &str,
    expected: u64,
    force: bool,
) -> Result<(), Fault> {
    let saved = checked_saved(storage, id, expected)?;
    let operation = saved
        .shell
        .as_ref()
        .map(|_| terminal::saved_shell_operation(paths))
        .transpose()
        .map_err(saved_shell_fault)?;
    let saved = if operation.is_some() {
        checked_saved(storage, id, expected)?
    } else {
        saved
    };
    if let Some(shell) = &saved.shell {
        let incarnation = saved_incarnation(shell)?;
        terminal::close_saved_shell(paths, id, shell.id(), incarnation.as_ref(), force)
            .map_err(saved_shell_fault)?;
    }
    storage
        .remove_saved_terminal(id, expected, saved.shell.as_ref())
        .map_err(super::shell::saved_fault)
}

/// The program a relaunch runs: the executable, then `pty::relaunch_arguments`, or the
/// user's login shell. The identity is named by its UUID, so a rename cannot retarget it.
fn relaunch_program(identity_id: &str, kind: RelaunchKind) -> Result<Vec<String>, Fault> {
    if kind == RelaunchKind::Shell {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|shell| shell.starts_with('/'))
            .unwrap_or_else(|| "/bin/sh".into());
        return Ok(vec![shell, "-l".into()]);
    }
    let tmt = crate::core_executable::selected()
        .ok()
        .and_then(|path| path.into_os_string().into_string().ok())
        .ok_or_else(|| {
            Fault::new(
                "TERMINAL_RELAUNCH_FAILED",
                "Nothing was started: the Core executable could not be located.",
            )
        })?;
    Ok(std::iter::once(tmt)
        .chain(
            crate::pty::relaunch_arguments(identity_id, kind == RelaunchKind::New)
                .into_iter()
                .map(str::to_owned),
        )
        .collect())
}

fn resource(
    id: &str,
    server: &ServerEvidence,
    pane: &str,
    terminal: Option<TerminalState>,
) -> Result<Vec<u8>, Fault> {
    let mut value = json!({
        "identityId": id,
        "host": server.host.as_str(),
        "socket": server.socket_path,
        "pane": pane,
        "paused": terminal.is_some_and(|state| state.paused),
    });
    add_terminal_fields(&mut value, terminal);
    serde_json::to_vec(&value).map_err(|_| Fault::unavailable())
}

/// `ended` and `foreground`, each present only in its state, for `terminal.stream` and
/// `identities.status`.
pub(super) fn add_terminal_fields(value: &mut serde_json::Value, terminal: Option<TerminalState>) {
    let Some(terminal) = terminal else {
        return;
    };
    if let Some(ended) = terminal.ended {
        value["ended"] = match ended {
            Exit::Code(code) => json!({"code": code}),
            Exit::Signal(signal) => json!({"signal": signal}),
        };
    }
    if terminal.shell {
        value["foreground"] = "shell".into();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestDirectory;
    use serde_json::Value;
    use tmt_core::{
        binding::BindingRepository,
        identity::{Lifetime, create_or_resolve},
    };

    #[test]
    fn an_unconfirmed_open_reports_its_terminal_id_in_the_error_envelope() {
        let id = "term_11111111111111111111111111111111";
        let fault = unconfirmed_open(id.into(), std::io::Error::other("fixture timeout"));
        assert_eq!(fault.status(), 1);
        assert_eq!(
            serde_json::from_slice::<Value>(&fault.encode()).unwrap(),
            json!({"error":{
                "code":"TERMINAL_OPEN_UNCONFIRMED",
                "message":format!("Terminal {id} was not confirmed and may be running; list or close it, do not open again to retry: fixture timeout"),
                "terminalId":id,
            }})
        );
    }

    #[test]
    fn requests_admit_only_an_exact_canonical_uuid() {
        let id = "11111111-1111-4111-8111-111111111111";
        let request = serde_json::json!({"identityId": id}).to_string();
        assert!(matches!(
            decode(request.as_bytes()).unwrap(),
            Request::TerminalStream { identity_id } if identity_id == id
        ));
        assert!(matches!(
            decode_resume(request.as_bytes()).unwrap(),
            Request::TerminalResume { identity_id } if identity_id == id
        ));
        for input in [
            serde_json::json!({}),
            serde_json::json!({"identityId": "Worker"}),
            serde_json::json!({"identityId": id, "name": "Worker"}),
            serde_json::json!({"identityId": 7}),
        ] {
            assert_eq!(
                decode(input.to_string().as_bytes()).err().unwrap().code(),
                "API_INPUT_INVALID",
                "{input}"
            );
        }
    }

    #[test]
    fn command_requests_pin_the_identity_terminal_and_exact_text_without_extra_authority() {
        let valid = json!({"identityId":"11111111-1111-4111-8111-111111111111", "terminalId":format!("term_{}", "1".repeat(32)), "command":"printf '%s' 'one value'"});
        assert!(
            matches!(decode_run(valid.to_string().as_bytes()).unwrap(), Request::TerminalRun { command, .. } if command == "printf '%s' 'one value'")
        );
        for (field, value) in [
            ("identityId", json!("owner")),
            ("terminalId", json!("pty_member")),
            ("command", json!(42)),
            ("cwd", json!("/tmp")),
            ("force", json!(true)),
        ] {
            let mut input = valid.clone();
            input[field] = value;
            assert_eq!(
                decode_run(input.to_string().as_bytes())
                    .err()
                    .unwrap()
                    .code(),
                "API_INPUT_INVALID",
                "{input}"
            );
        }
    }

    #[test]
    fn the_resource_names_the_socket_and_pane_and_nothing_else() {
        let server = ServerEvidence {
            host: HostKind::pty(),
            server_id: "server".into(),
            socket_path: "/data/pty/pty_a1.sock".into(),
            server_pid: 7,
            server_start_time: "start".into(),
        };
        let body = resource(
            "11111111-1111-4111-8111-111111111111",
            &server,
            "pty_a1",
            Some(TerminalState {
                paused: true,
                ended: None,
                shell: false,
            }),
        )
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&body).unwrap(),
            serde_json::json!({
                "identityId": "11111111-1111-4111-8111-111111111111",
                "host": "pty",
                "socket": "/data/pty/pty_a1.sock",
                "pane": "pty_a1",
                "paused": true,
            })
        );
        let ended = resource(
            "11111111-1111-4111-8111-111111111111",
            &server,
            "pty_a1",
            Some(TerminalState {
                paused: false,
                ended: Some(Exit::Signal(2)),
                shell: false,
            }),
        )
        .unwrap();
        let ended = serde_json::from_slice::<Value>(&ended).unwrap();
        assert_eq!(ended["ended"], serde_json::json!({"signal": 2}));
        assert!(ended.get("foreground").is_none());
        let shell = resource(
            "11111111-1111-4111-8111-111111111111",
            &server,
            "pty_a1",
            Some(TerminalState {
                paused: false,
                ended: None,
                shell: true,
            }),
        )
        .unwrap();
        let shell = serde_json::from_slice::<Value>(&shell).unwrap();
        assert_eq!(shell["foreground"], "shell");
        assert!(shell.get("ended").is_none());
    }

    #[test]
    fn a_relaunch_names_one_kind_and_an_exact_uuid() {
        let id = "11111111-1111-4111-8111-111111111111";
        for (kind, expected) in [
            ("resume", RelaunchKind::Resume),
            ("new", RelaunchKind::New),
            ("shell", RelaunchKind::Shell),
        ] {
            let request = serde_json::json!({"identityId": id, "kind": kind}).to_string();
            assert!(matches!(
                decode_relaunch(request.as_bytes()).unwrap(),
                Request::TerminalRelaunch { identity_id, kind } if identity_id == id && kind == expected
            ));
        }
        for input in [
            serde_json::json!({"identityId": id}),
            serde_json::json!({"identityId": id, "kind": "Resume"}),
            serde_json::json!({"identityId": id, "kind": "bash"}),
            serde_json::json!({"identityId": "Worker", "kind": "shell"}),
            serde_json::json!({"identityId": id, "kind": "shell", "program": ["sh"]}),
        ] {
            assert_eq!(
                decode_relaunch(input.to_string().as_bytes())
                    .err()
                    .unwrap()
                    .code(),
                "API_INPUT_INVALID",
                "{input}"
            );
        }
        assert_eq!(relaunch_program(id, RelaunchKind::Shell).unwrap()[1], "-l");
    }

    #[test]
    fn extra_terminal_operations_take_an_exact_uuid_or_terminal_id() {
        let id = "11111111-1111-4111-8111-111111111111";
        let input = serde_json::json!({"identityId": id}).to_string();
        assert!(matches!(
            decode_open(input.as_bytes()).unwrap(),
            Request::TerminalOpen { identity_id } if identity_id == id
        ));
        assert!(matches!(
            decode_list(input.as_bytes()).unwrap(),
            Request::TerminalList { identity_id } if identity_id == id
        ));
        let other = "22222222-2222-4222-8222-222222222222";
        let many = serde_json::json!({"identityIds": [other, id, other]}).to_string();
        assert!(matches!(
            decode_list(many.as_bytes()).unwrap(),
            Request::TerminalListMany { identity_ids } if identity_ids == [id, other]
        ));
        let too_many = vec![id; LIST_MANY_LIMIT + 1];
        for bad in [
            serde_json::json!({"identityIds": []}),
            serde_json::json!({"identityIds": ["not-a-uuid"]}),
            serde_json::json!({"identityIds": too_many}),
            serde_json::json!({"identityIds": [id], "identityId": id}),
        ] {
            assert!(decode_list(bad.to_string().as_bytes()).is_err(), "{bad}");
        }
        let terminal = format!("term_{}", "a1".repeat(16));
        for (input, force) in [
            (serde_json::json!({"terminalId": terminal}), false),
            (
                serde_json::json!({"terminalId": terminal, "force": true}),
                true,
            ),
        ] {
            assert!(matches!(
                decode_close(input.to_string().as_bytes()).unwrap(),
                Request::TerminalClose { terminal_id, force: f } if terminal_id == terminal && f == force
            ));
        }
        for input in [
            serde_json::json!({"identityId": "Worker"}),
            serde_json::json!({"identityId": id, "shell": "/bin/sh"}),
        ] {
            for decode in [decode_open, decode_list] {
                assert_eq!(
                    decode(input.to_string().as_bytes()).err().unwrap().code(),
                    "API_INPUT_INVALID",
                    "{input}"
                );
            }
        }
        for input in [
            serde_json::json!({"terminalId": id}),
            serde_json::json!({"terminalId": format!("term_{}", "A1".repeat(16))}),
            serde_json::json!({"terminalId": "term_../x"}),
            serde_json::json!({"terminalId": terminal, "force": "yes"}),
            serde_json::json!({"terminalId": terminal, "identityId": id}),
        ] {
            assert_eq!(
                decode_close(input.to_string().as_bytes())
                    .err()
                    .unwrap()
                    .code(),
                "API_INPUT_INVALID",
                "{input}"
            );
        }
    }

    #[test]
    fn a_failed_relaunch_reports_the_launchers_last_lines() {
        assert_eq!(tail(""), "");
        assert_eq!(
            tail("one\r\n\r\ntwo\nthree\nfour\nfive\nsix\nseven\n"),
            "\ntwo\nthree\nfour\nfive\nsix\nseven"
        );
        assert!(tail(&"x".repeat(5000)).len() <= 2049);
    }

    #[test]
    fn an_unknown_or_retired_identity_is_not_found_and_an_unbound_one_is_unavailable() {
        let directory = TestDirectory::new();
        let mut storage = Storage::open(directory.path.join("fixture.db")).unwrap();
        let paths = ConfigPaths::resolve(
            &directory.path,
            &directory.path,
            Some(&directory.path),
            None,
        );
        let unbound = create_or_resolve(&mut storage, "Unbound", Lifetime::Saved)
            .unwrap()
            .identity;
        let retired = create_or_resolve(&mut storage, "Retired", Lifetime::Saved)
            .unwrap()
            .identity;
        storage
            .with_binding_transaction(|rows| rows.retire_identity(&retired, false))
            .unwrap();
        let unknown = "22222222-2222-4222-8222-222222222222";
        for id in [unknown, retired.id.as_str()] {
            assert_eq!(
                stream(&mut storage, id).unwrap_err().code(),
                "NAME_NOT_FOUND"
            );
        }
        assert_eq!(
            stream(&mut storage, &unbound.id).unwrap_err().code(),
            "TERMINAL_STREAM_UNAVAILABLE"
        );
        for id in [unknown, retired.id.as_str()] {
            assert_eq!(
                resume(&mut storage, id).unwrap_err().code(),
                "NAME_NOT_FOUND"
            );
        }
        assert_eq!(
            resume(&mut storage, &unbound.id).unwrap_err().code(),
            "TERMINAL_STREAM_UNAVAILABLE"
        );
        for id in [unknown, retired.id.as_str()] {
            assert_eq!(
                relaunch(&paths, &mut storage, id, RelaunchKind::Shell)
                    .unwrap_err()
                    .code(),
                "NAME_NOT_FOUND"
            );
        }
        // An unbound identity the built-in capture never recorded starts nothing.
        assert_eq!(
            relaunch(&paths, &mut storage, &unbound.id, RelaunchKind::Resume)
                .unwrap_err()
                .code(),
            "TERMINAL_RELAUNCH_REFUSED"
        );
        assert_eq!(
            relaunch(&paths, &mut storage, &unbound.id, RelaunchKind::Shell)
                .unwrap_err()
                .code(),
            "TERMINAL_RELAUNCH_UNSUPPORTED"
        );
    }
}
