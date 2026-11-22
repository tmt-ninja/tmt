//! Local shell commands in a freshly observed member directory.
use super::{CommandProgress, Fault, Request, invalid};
use crate::{
    delivery,
    host::{Host, OperationOptions},
    process::{
        CommandFailure, ShellControl, ShellObserver, ShellStream, UnixCommandRunner,
        runtime::observe_starts,
    },
    storage::{
        Storage,
        saved_terminal::{
            SavedCommandOutput, SavedCommandSummary, SavedPlacement, SavedTerminalError,
            SavedTerminalRecord,
        },
    },
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    path::Path,
    time::{Duration, Instant},
};
use tmt_core::{
    binding::{BindingEntry, BindingEvidence, evaluate_binding},
    endpoint::EndpointProbe,
    host::HostKind,
};

const SHELL_OUTPUT_LIMIT: usize = 65_536;
const MEMBER_TARGET_OBSERVATION: Duration = Duration::from_secs(1);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    identity_id: String,
    command: String,
}

pub(super) fn decode(input: &[u8]) -> Result<Request, Fault> {
    let input: Input = serde_json::from_slice(input).map_err(|_| invalid())?;
    if !tmt_core::dispatch::canonical_id(&input.identity_id)
        || !tmt_pty_protocol::valid_command(&input.command)
    {
        return Err(invalid());
    }
    Ok(Request::ShellRun {
        identity_id: input.identity_id,
        command: input.command,
    })
}

fn no_directory() -> Fault {
    Fault::new(
        "SHELL_RUN_UNAVAILABLE",
        "The member's current local directory could not be verified. Nothing was started.",
    )
}

fn verified_cwd(entry: &BindingEntry, probe: &EndpointProbe) -> Result<String, Fault> {
    match evaluate_binding(entry, probe) {
        BindingEvidence::Active(pane) => pane
            .cwd
            .filter(|cwd| Path::new(cwd).is_absolute())
            .ok_or_else(no_directory),
        _ => Err(no_directory()),
    }
}

fn observe_member(
    storage: &mut Storage,
    identity_id: &str,
    tmux_deadline: Option<Instant>,
) -> Result<(BindingEntry, EndpointProbe), Fault> {
    let entry = delivery::current(storage, identity_id)
        .map_err(|_| no_directory())?
        .ok_or_else(no_directory)?;
    let binding = entry.binding.as_ref().ok_or_else(no_directory)?;
    if binding.server.host != HostKind::Tmux && binding.server.host != HostKind::pty() {
        return Err(no_directory());
    }
    let probe = Host::for_server(&binding.server)
        .probe(
            &binding.server,
            OperationOptions {
                deadline: tmux_deadline.filter(|_| binding.server.host == HostKind::Tmux),
                pane_ids: Some(std::slice::from_ref(&binding.pane_id)),
            },
        )
        .map_err(|_| no_directory())?;
    Ok((entry, probe))
}

fn run_captured(
    command: &str,
    cwd: &Path,
    lifeline: Option<std::os::fd::BorrowedFd<'_>>,
    output: Option<&mut ShellObserver<'_>>,
) -> Result<crate::process::ShellOutput, Fault> {
    let mut interrupt = crate::interrupt::Interrupt::install_termination().map_err(|_| {
        Fault::new(
            "SHELL_RUN_FAILED",
            "Shell cancellation could not be prepared. Nothing was run.",
        )
    })?;
    interrupt.defer_emergency_exit();
    let control = ShellControl {
        interrupt: Some(&interrupt),
        lifeline,
        output,
    };
    UnixCommandRunner.run_shell_in_interrupt(command, cwd, Duration::from_secs(120), SHELL_OUTPUT_LIMIT, control).map_err(|error| {
        if matches!(error.kind, CommandFailure::Spawn) && !error.cleanup_failed() {
            Fault::new("SHELL_RUN_FAILED", "The shell could not be started. Nothing was run.")
        } else {
            Fault::new("SHELL_RUN_UNCONFIRMED", "The shell may have started; its result could not be confirmed. Do not retry automatically.")
        }
    })
}

pub(super) fn run(
    storage: &mut Storage,
    identity_id: &str,
    command: &str,
    lifeline: Option<std::os::fd::BorrowedFd<'_>>,
) -> Result<Vec<u8>, Fault> {
    let (entry, probe) = observe_member(storage, identity_id, None)?;
    let cwd = verified_cwd(&entry, &probe)?;
    let result = run_captured(command, Path::new(&cwd), lifeline, None)?;
    if result.cancelled {
        return Err(Fault::new(
            "SHELL_RUN_CANCELLED",
            "Shell cancelled; its process group was terminated and reaped.",
        ));
    }
    serde_json::to_vec(&json!({
        "identityId": identity_id, "cwd":cwd,
        "stdout":String::from_utf8_lossy(&result.stdout),
        "stderr":String::from_utf8_lossy(&result.stderr),
        "exitCode":result.exit_code, "signal":result.signal,
        "timedOut":result.timed_out, "truncated":result.truncated,
    }))
    .map_err(|_| {
        Fault::new(
            "SHELL_RUN_UNCONFIRMED",
            "The shell ran but its result could not be confirmed. Do not retry automatically.",
        )
    })
}

// Standalone results use a dedicated framed session. Only the successful
// result of that session can be kept.
pub struct SavedTerminalRequest(SavedOperation);

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum CommandTarget {
    Local {
        cwd: String,
    },
    Member {
        identity_id: String,
        room_id: Option<String>,
        cwd: String,
        binding_id: String,
        pane_incarnation: String,
    },
    Saved {
        terminal_id: String,
        expected_revision: u64,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommandInput {
    command: Option<String>,
    target: CommandTarget,
    #[serde(default)]
    stream: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SavedId {
    terminal_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpectedRevision {
    terminal_id: String,
    expected_revision: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemoveSaved {
    terminal_id: String,
    expected_revision: u64,
    #[serde(default)]
    force: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MoveSaved {
    terminal_id: String,
    expected_revision: u64,
    placement: SavedPlacement,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MemberTarget {
    identity_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KeepRun {
    run_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}

enum SavedOperation {
    Target(MemberTarget),
    Run(CommandInput),
    Keep(KeepRun),
    List,
    Get(SavedId),
    Move(MoveSaved),
    OpenShell(ExpectedRevision),
    Remove(RemoveSaved),
}

pub(super) fn decode_saved(operation: &str, input: &[u8]) -> Result<Request, Fault> {
    fn parse<T: serde::de::DeserializeOwned>(input: &[u8]) -> Result<T, Fault> {
        serde_json::from_slice(input).map_err(|_| invalid())
    }

    use tmt_core::dispatch::canonical_id;
    fn checked_revision(revision: u64) -> bool {
        (1..=tmt_core::limits::MAX_JS_SAFE_INTEGER).contains(&revision)
    }
    fn placement_ok(placement: &SavedPlacement) -> bool {
        match placement {
            SavedPlacement::Local => true,
            SavedPlacement::Room { room_id } => canonical_id(room_id),
            SavedPlacement::Member {
                identity_id,
                room_id,
            } => canonical_id(identity_id) && room_id.as_deref().is_none_or(canonical_id),
        }
    }

    let request = match operation {
        "terminal.command.target" => {
            let target: MemberTarget = parse(input)?;
            if !canonical_id(&target.identity_id) {
                return Err(invalid());
            }
            SavedOperation::Target(target)
        }
        "terminal.command.run" => {
            let run: CommandInput = parse(input)?;
            let valid = match &run.target {
                CommandTarget::Local { cwd } => {
                    valid_cwd(cwd)
                        && run
                            .command
                            .as_deref()
                            .is_some_and(tmt_pty_protocol::valid_command)
                }
                CommandTarget::Member {
                    identity_id,
                    room_id,
                    cwd,
                    binding_id,
                    pane_incarnation,
                } => {
                    canonical_id(identity_id)
                        && room_id.as_deref().is_none_or(canonical_id)
                        && valid_cwd(cwd)
                        && canonical_id(binding_id)
                        && !pane_incarnation.is_empty()
                        && pane_incarnation.len() <= 256
                        && run
                            .command
                            .as_deref()
                            .is_some_and(tmt_pty_protocol::valid_command)
                }
                CommandTarget::Saved {
                    terminal_id,
                    expected_revision,
                } => {
                    canonical_id(terminal_id)
                        && checked_revision(*expected_revision)
                        && run.command.is_none()
                }
            };
            if !valid {
                return Err(invalid());
            }
            SavedOperation::Run(run)
        }
        "terminal.command.keep" => {
            let keep: KeepRun = parse(input)?;
            if !canonical_id(&keep.run_id) {
                return Err(invalid());
            }
            SavedOperation::Keep(keep)
        }
        "terminal.saved.list" => {
            let _: Empty = parse(input)?;
            SavedOperation::List
        }
        "terminal.saved.get" => {
            let request: SavedId = parse(input)?;
            if !canonical_id(&request.terminal_id) {
                return Err(invalid());
            }
            SavedOperation::Get(request)
        }
        "terminal.saved.move" => {
            let request: MoveSaved = parse(input)?;
            if !canonical_id(&request.terminal_id)
                || !checked_revision(request.expected_revision)
                || !placement_ok(&request.placement)
            {
                return Err(invalid());
            }
            SavedOperation::Move(request)
        }
        "terminal.saved.openShell" => {
            let request: ExpectedRevision = parse(input)?;
            if !canonical_id(&request.terminal_id) || !checked_revision(request.expected_revision) {
                return Err(invalid());
            }
            SavedOperation::OpenShell(request)
        }
        "terminal.saved.remove" => {
            let request: RemoveSaved = parse(input)?;
            if !canonical_id(&request.terminal_id) || !checked_revision(request.expected_revision) {
                return Err(invalid());
            }
            SavedOperation::Remove(request)
        }
        _ => unreachable!("saved terminal API dispatcher"),
    };
    Ok(Request::SavedTerminal(Box::new(SavedTerminalRequest(
        request,
    ))))
}

fn valid_cwd(cwd: &str) -> bool {
    Path::new(cwd).is_absolute() && cwd.len() <= 4096 && !cwd.contains('\0')
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ObservedTarget {
    cwd: String,
    binding_id: String,
    pane_incarnation: String,
}

fn member_target(storage: &mut Storage, identity: &str) -> Result<ObservedTarget, Fault> {
    let deadline = Instant::now() + MEMBER_TARGET_OBSERVATION;
    let (entry, probe) = observe_member(storage, identity, Some(deadline))?;
    let binding = entry.binding.as_ref().ok_or_else(no_directory)?;
    let BindingEvidence::Active(pane) = evaluate_binding(&entry, &probe) else {
        return Err(no_directory());
    };
    let pane_incarnation = if binding.server.host == HostKind::Tmux {
        // The ordinary Host probe supplies tmux's marker and cwd. Join that
        // evidence to the live pane process under the same deadline.
        let starts = observe_starts(&UnixCommandRunner, &[pane.pane_pid], deadline)
            .map_err(|_| no_directory())?;
        let start = starts
            .get(&pane.pane_pid)
            .ok_or_else(no_directory)?
            .start_identity();
        if binding
            .pane_incarnation
            .as_deref()
            .is_some_and(|recorded| recorded != start)
        {
            return Err(no_directory());
        }
        start.to_owned()
    } else {
        pane.pane_incarnation.ok_or_else(no_directory)?
    };
    Ok(ObservedTarget {
        cwd: pane
            .cwd
            .filter(|cwd| valid_cwd(cwd))
            .ok_or_else(no_directory)?,
        binding_id: binding.id.clone(),
        pane_incarnation,
    })
}

struct Launch {
    terminal_id: String,
    expected: Option<u64>,
    placement: SavedPlacement,
    command: String,
    cwd: String,
}

fn launch(storage: &mut Storage, request: CommandInput) -> Result<Launch, Fault> {
    use CommandTarget::*;
    let terminal_id = || uuid::Uuid::new_v4().to_string();
    let launch = match request.target {
        Local { cwd } => Launch {
            terminal_id: terminal_id(),
            expected: None,
            placement: SavedPlacement::Local,
            command: request.command.expect("admitted local command"),
            cwd,
        },
        Member {
            identity_id,
            room_id,
            cwd,
            binding_id,
            pane_incarnation,
        } => {
            let current = member_target(storage, &identity_id)?;
            if current.cwd != cwd
                || current.binding_id != binding_id
                || current.pane_incarnation != pane_incarnation
            {
                return Err(Fault::new(
                    "TERMINAL_COMMAND_TARGET_CHANGED",
                    "The member's launch or directory changed. Confirm a fresh target. Nothing was started.",
                ));
            }
            Launch {
                terminal_id: terminal_id(),
                expected: None,
                placement: SavedPlacement::Member {
                    identity_id,
                    room_id,
                },
                command: request.command.expect("admitted member command"),
                cwd,
            }
        }
        Saved {
            terminal_id,
            expected_revision,
        } => {
            let saved = storage.saved_terminal(&terminal_id).map_err(saved_fault)?;
            if saved.revision != expected_revision {
                return Err(saved_fault(SavedTerminalError::Stale));
            }
            Launch {
                terminal_id,
                expected: Some(expected_revision),
                placement: saved.placement,
                command: saved.summary.command,
                cwd: saved.summary.cwd,
            }
        }
    };
    if !Path::new(&launch.cwd).is_dir() {
        return Err(Fault::new(
            "TERMINAL_COMMAND_DIRECTORY_UNAVAILABLE",
            "The confirmed directory is unavailable. Nothing was started.",
        ));
    }
    Ok(launch)
}

#[derive(Default)]
pub(super) struct SavedCommandSession(Option<StagedResult>);

enum StagedResult {
    Unkeepable,
    Pending {
        launch: Launch,
        run_id: String,
        result: SavedCommandOutput,
    },
    Kept {
        run_id: String,
        terminal: SavedTerminalRecord,
    },
}

pub(super) fn saved_fault(error: SavedTerminalError) -> Fault {
    match error {
        SavedTerminalError::Missing => Fault::new(
            "TERMINAL_SAVED_NOT_FOUND",
            "That saved terminal no longer exists.",
        ),
        SavedTerminalError::Stale => Fault::new(
            "TERMINAL_SAVED_REVISION_CONFLICT",
            "The saved terminal changed. Refresh before retrying.",
        ),
        SavedTerminalError::PlacementMissing => Fault::new(
            "TERMINAL_SAVED_PARENT_UNAVAILABLE",
            "That display parent is no longer available.",
        ),
        SavedTerminalError::Full => Fault::new(
            "TERMINAL_SAVED_LIMIT",
            "There are already 64 saved terminals. Remove one before keeping this result.",
        ),
        SavedTerminalError::ShellOccupied => Fault::new(
            "TERMINAL_SAVED_SHELL_OCCUPIED",
            "The saved terminal has a live or unconfirmed shell. Its result was kept.",
        ),
        SavedTerminalError::Storage(error) => Fault::unavailable()
            .with_storage_access(error, "Inspect the saved terminal before retrying a write."),
    }
}

fn encode(value: impl Serialize) -> Result<Vec<u8>, Fault> {
    serde_json::to_vec(&value).map_err(|_| Fault::unavailable())
}

fn output_document(
    metadata: impl Serialize,
    stdout: &[u8],
    stderr: &[u8],
) -> Result<serde_json::Value, Fault> {
    let mut value = serde_json::to_value(metadata).map_err(|_| Fault::unavailable())?;
    value["stdout"] = json!(String::from_utf8_lossy(stdout));
    value["stderr"] = json!(String::from_utf8_lossy(stderr));
    Ok(value)
}

pub(super) fn execute_saved(
    paths: &crate::config::ConfigPaths,
    storage: &mut Storage,
    request: SavedTerminalRequest,
    session: &mut SavedCommandSession,
    lifeline: Option<std::os::fd::BorrowedFd<'_>>,
    progress: Option<&mut CommandProgress<'_>>,
) -> Result<Vec<u8>, Fault> {
    let staged = &mut session.0;
    match request.0 {
        SavedOperation::Target(request) => encode(member_target(storage, &request.identity_id)?),
        SavedOperation::Run(input) => {
            let lifeline = lifeline.ok_or_else(|| {
                Fault::new(
                    "TERMINAL_COMMAND_SESSION_REQUIRED",
                    "Run the command on a dedicated framed session.",
                )
            })?;
            if staged.is_some() {
                return Err(Fault::new(
                    "TERMINAL_COMMAND_SESSION_USED",
                    "Start a fresh session for another attempt.",
                ));
            }
            let progress = if input.stream {
                Some(progress.ok_or_else(|| {
                    Fault::new(
                        "TERMINAL_COMMAND_STREAM_UNAVAILABLE",
                        "Live output needs a dedicated framed session. Nothing was started.",
                    )
                })?)
            } else {
                None
            };
            let launch = launch(storage, input)?;
            *staged = Some(StagedResult::Unkeepable);
            let started_ms = crate::request_runtime::wall_time_ms();
            let captured = if let Some(publish) = progress {
                let mut stdout = tmt_pty_protocol::OutputSanitizer::default();
                let mut stderr = tmt_pty_protocol::OutputSanitizer::default();
                let mut sequence = 0;
                run_captured(
                    &launch.command,
                    Path::new(&launch.cwd),
                    Some(lifeline),
                    Some(&mut |stream, bytes, deadline, cancelled| {
                        let (stream, sanitizer) = match stream {
                            ShellStream::Stdout => ("stdout", &mut stdout),
                            ShellStream::Stderr => ("stderr", &mut stderr),
                        };
                        for chunk in bytes.chunks(512) {
                            let text = sanitizer.push(chunk);
                            if !text.is_empty() {
                                let frame = json!({"commandOutput":{"sequence":sequence,"stream":stream,"text":text}});
                                let body =
                                    serde_json::to_vec(&frame).map_err(std::io::Error::other)?;
                                publish(&body, deadline, cancelled)?;
                                sequence += 1;
                            }
                        }
                        Ok(())
                    }),
                )?
            } else {
                run_captured(
                    &launch.command,
                    Path::new(&launch.cwd),
                    Some(lifeline),
                    None,
                )?
            };
            if captured.cancelled {
                return Err(Fault::new(
                    "SHELL_RUN_CANCELLED",
                    "Shell cancelled; its process group was terminated and reaped.",
                ));
            }
            let run_id = uuid::Uuid::new_v4().to_string();
            let result = SavedCommandOutput {
                summary: SavedCommandSummary {
                    command: launch.command.clone(),
                    cwd: launch.cwd.clone(),
                    started_ms,
                    ended_ms: crate::request_runtime::wall_time_ms().max(started_ms),
                    exit_code: captured.exit_code,
                    signal: captured.signal,
                    timed_out: captured.timed_out,
                    truncated: captured.truncated,
                },
                stdout: captured.stdout,
                stderr: captured.stderr,
            };
            let mut value = output_document(&result.summary, &result.stdout, &result.stderr)?;
            value["runId"] = json!(run_id);
            *staged = Some(StagedResult::Pending {
                launch,
                run_id,
                result,
            });
            encode(value)
        }
        SavedOperation::Keep(keep) => {
            let missing = || {
                Fault::new(
                    "TERMINAL_COMMAND_RESULT_UNAVAILABLE",
                    "This session has no matching command result to keep.",
                )
            };
            if lifeline.is_none() {
                return Err(missing());
            }
            match staged.as_ref() {
                Some(StagedResult::Kept { run_id, terminal }) if *run_id == keep.run_id => {
                    encode(terminal)
                }
                Some(StagedResult::Pending {
                    launch,
                    run_id,
                    result,
                }) if *run_id == keep.run_id => {
                    let terminal = storage
                        .keep_saved_command(
                            &launch.terminal_id,
                            run_id,
                            launch.expected,
                            &launch.placement,
                            result,
                        )
                        .map_err(saved_fault)?;
                    let bytes = encode(&terminal)?;
                    *staged = Some(StagedResult::Kept {
                        run_id: keep.run_id,
                        terminal,
                    });
                    Ok(bytes)
                }
                _ => Err(missing()),
            }
        }
        SavedOperation::List => encode(
            json!({"terminals": storage.list_saved_terminals().map_err(|error| saved_fault(error.into()))?}),
        ),
        SavedOperation::Get(request) => {
            let (meta, stdout, stderr) = storage
                .saved_terminal_output(&request.terminal_id)
                .map_err(saved_fault)?;
            encode(output_document(meta, &stdout, &stderr)?)
        }
        SavedOperation::Move(request) => encode(
            storage
                .move_saved_terminal(
                    &request.terminal_id,
                    request.expected_revision,
                    &request.placement,
                )
                .map_err(saved_fault)?,
        ),
        SavedOperation::OpenShell(request) => super::terminal::open_saved_shell(
            paths,
            storage,
            &request.terminal_id,
            request.expected_revision,
        ),
        SavedOperation::Remove(request) => {
            super::terminal::remove_saved(
                paths,
                storage,
                &request.terminal_id,
                request.expected_revision,
                request.force,
            )?;
            encode(json!({"removed": true}))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tmt_core::{
        binding::Binding,
        endpoint::{EndpointSnapshot, PaneObservation, ServerEvidence},
        identity::{Identity, Lifetime},
    };

    #[test]
    fn verified_host_directory_is_used_for_pwd_and_stale_evidence_refuses() {
        let root = crate::test_support::TestDirectory::new();
        let identity = Identity {
            id: "11111111-1111-4111-8111-111111111111".into(),
            name: "worker".into(),
            canonical_name: "worker".into(),
            lifetime: Lifetime::Saved,
            created_at: "t".into(),
            updated_at: "t".into(),
        };
        let server = ServerEvidence {
            host: HostKind::Tmux,
            server_id: "22222222-2222-4222-8222-222222222222".into(),
            socket_path: "/fixture/socket".into(),
            server_pid: 10,
            server_start_time: "start".into(),
        };
        let binding = Binding {
            id: "binding".into(),
            identity_id: identity.id.clone(),
            server: server.clone(),
            pane_id: "%1".into(),
            pane_pid: 42,
            pane_incarnation: None,
            session: Default::default(),
        };
        let pane = PaneObservation {
            id: binding.pane_id.clone(),
            target: None,
            cwd: Some(root.path.to_str().unwrap().into()),
            command: "fixture".into(),
            pane_pid: binding.pane_pid,
            pane_incarnation: None,
            suggested_name: None,
            marker: Some(binding.marker(&identity)),
            location: None,
            agent_name: None,
        };
        let entry = BindingEntry {
            identity,
            binding: Some(binding),
        };
        let mut snapshot = EndpointSnapshot {
            server,
            panes: vec![pane],
        };
        let cwd = verified_cwd(&entry, &EndpointProbe::Live(snapshot.clone())).unwrap();
        let output = UnixCommandRunner
            .run_shell_in("pwd", Path::new(&cwd), Duration::from_secs(3), 65_536)
            .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&output.stdout).trim(),
            root.path.canonicalize().unwrap().to_str().unwrap()
        );
        snapshot.panes[0].marker = None;
        assert_eq!(
            verified_cwd(&entry, &EndpointProbe::Live(snapshot))
                .unwrap_err()
                .code(),
            "SHELL_RUN_UNAVAILABLE"
        );
        assert_eq!(
            verified_cwd(&entry, &EndpointProbe::Unknown)
                .unwrap_err()
                .code(),
            "SHELL_RUN_UNAVAILABLE"
        );
    }

    #[test]
    fn unknown_member_refuses_before_starting_the_command() {
        let root = crate::test_support::TestDirectory::new();
        let mut storage = Storage::open(root.path.join("shell.db")).unwrap();
        let marker = root.path.join("started");
        let command = format!("touch '{}'", marker.display());
        let error = run(
            &mut storage,
            "11111111-1111-4111-8111-111111111111",
            &command,
            None,
        )
        .unwrap_err();
        assert_eq!(error.code(), "SHELL_RUN_UNAVAILABLE");
        assert!(!marker.exists());
    }

    fn saved_request(
        session: &mut crate::api::Session,
        operation: &str,
        input: serde_json::Value,
        lifeline: Option<std::os::fd::BorrowedFd<'_>>,
    ) -> Result<serde_json::Value, Fault> {
        let body = json!({"version":1,"operation":operation,"input":input}).to_string();
        let bytes = session.execute_with_lifeline(crate::api::decode(&body)?, lifeline)?;
        Ok(serde_json::from_slice(&bytes).unwrap())
    }

    #[test]
    fn saved_remove_recovers_unconfirmed_start_only_after_the_supervisor_lock_is_free() {
        let root = crate::test_support::TestDirectory::short();
        let paths =
            crate::config::ConfigPaths::resolve(&root.path, &root.path, Some(&root.path), None);
        let mut storage = Storage::open(&paths.database).unwrap();
        let terminal = uuid::Uuid::new_v4().to_string();
        let result = storage
            .keep_saved_command(
                &terminal,
                &uuid::Uuid::new_v4().to_string(),
                None,
                &SavedPlacement::Local,
                &fixture_output(&root.path),
            )
            .unwrap();
        let shell = crate::pty::terminal::new_saved_shell_id();
        let reserved = storage
            .reserve_saved_shell(&terminal, result.revision, &shell)
            .unwrap();
        let pty = paths.pty_directory();
        crate::private_file::ensure_private_directory(&pty).unwrap();
        let lock_path = crate::pty::lock_path(&pty, &shell);
        let supervisor_lock = crate::file_lock::exclusive(&lock_path).unwrap();
        let mut session = crate::api::Session::new(paths);
        let input = json!({"terminalId":terminal, "expectedRevision":reserved.revision});
        assert_eq!(
            saved_request(&mut session, "terminal.saved.remove", input.clone(), None)
                .unwrap_err()
                .code(),
            "TERMINAL_SAVED_SHELL_UNCONFIRMED",
        );
        assert_eq!(storage.saved_terminal_output(&terminal).unwrap().1, b"kept");
        drop(supervisor_lock);
        assert_eq!(
            saved_request(&mut session, "terminal.saved.remove", input, None).unwrap(),
            json!({"removed": true}),
        );
        assert!(matches!(
            storage.saved_terminal(&terminal),
            Err(SavedTerminalError::Missing)
        ));
    }

    fn fixture_output(cwd: &Path) -> SavedCommandOutput {
        SavedCommandOutput {
            summary: SavedCommandSummary {
                command: "printf kept".into(),
                cwd: cwd.to_str().unwrap().into(),
                started_ms: 0,
                ended_ms: 1,
                exit_code: Some(0),
                signal: None,
                timed_out: false,
                truncated: false,
            },
            stdout: b"kept".to_vec(),
            stderr: Vec::new(),
        }
    }

    #[test]
    fn stale_rerun_keep_leaves_saved_output_and_placement_intact() {
        use std::{os::fd::AsFd, os::unix::net::UnixStream};

        let root = crate::test_support::TestDirectory::new();
        let paths =
            crate::config::ConfigPaths::resolve(&root.path, &root.path, Some(&root.path), None);
        let mut storage = Storage::open(&paths.database).unwrap();
        let terminal = uuid::Uuid::new_v4().to_string();
        let mut original = fixture_output(&root.path);
        original.summary.command = "printf fresh".into();
        let row = storage
            .keep_saved_command(
                &terminal,
                &uuid::Uuid::new_v4().to_string(),
                None,
                &SavedPlacement::Local,
                &original,
            )
            .unwrap();
        let mut session = crate::api::Session::new(paths);
        let (_client, server) = UnixStream::pair().unwrap();
        let result = saved_request(
            &mut session,
            "terminal.command.run",
            json!({
                "target":{"kind":"saved","terminalId":terminal,"expectedRevision":row.revision}
            }),
            Some(server.as_fd()),
        )
        .unwrap();
        assert_eq!(result["stdout"], "fresh");
        let moved = storage
            .reserve_saved_shell(
                &terminal,
                row.revision,
                &crate::pty::terminal::new_saved_shell_id(),
            )
            .unwrap();
        assert!(moved.revision > row.revision);
        assert_eq!(
            saved_request(
                &mut session,
                "terminal.command.keep",
                json!({"runId":result["runId"]}),
                Some(server.as_fd())
            )
            .unwrap_err()
            .code(),
            "TERMINAL_SAVED_REVISION_CONFLICT",
        );
        let loaded = saved_request(
            &mut session,
            "terminal.saved.get",
            json!({"terminalId":terminal}),
            None,
        )
        .unwrap();
        assert_eq!(loaded["stdout"], "kept");
        assert_eq!(loaded["placement"], json!({"kind":"local"}));
        assert_eq!(loaded["revision"], moved.revision);
    }

    #[test]
    fn the_saved_terminal_limit_refuses_keep_without_writing_a_row() {
        use std::{os::fd::AsFd, os::unix::net::UnixStream};

        let root = crate::test_support::TestDirectory::new();
        let paths =
            crate::config::ConfigPaths::resolve(&root.path, &root.path, Some(&root.path), None);
        let mut storage = Storage::open(&paths.database).unwrap();
        for _ in 0..64 {
            storage
                .keep_saved_command(
                    &uuid::Uuid::new_v4().to_string(),
                    &uuid::Uuid::new_v4().to_string(),
                    None,
                    &SavedPlacement::Local,
                    &fixture_output(&root.path),
                )
                .unwrap();
        }
        let mut session = crate::api::Session::new(paths);
        let (_client, server) = UnixStream::pair().unwrap();
        let result = saved_request(
            &mut session,
            "terminal.command.run",
            json!({
                "target":{"kind":"local","cwd":root.path}, "command":"printf new",
            }),
            Some(server.as_fd()),
        )
        .unwrap();
        assert_eq!(
            saved_request(
                &mut session,
                "terminal.command.keep",
                json!({"runId":result["runId"]}),
                Some(server.as_fd())
            )
            .unwrap_err()
            .code(),
            "TERMINAL_SAVED_LIMIT",
        );
        assert_eq!(storage.list_saved_terminals().unwrap().len(), 64);
    }

    #[test]
    fn cancelling_a_started_command_leaves_the_session_unkeepable() {
        use nix::{
            fcntl::{FcntlArg, OFlag, fcntl},
            sys::stat::Mode,
            unistd::mkfifo,
        };
        use std::{
            fs::OpenOptions,
            io::Read,
            os::{
                fd::AsFd,
                unix::{fs::OpenOptionsExt, net::UnixStream},
            },
        };

        let root = crate::test_support::TestDirectory::new();
        let paths =
            crate::config::ConfigPaths::resolve(&root.path, &root.path, Some(&root.path), None);
        let mut session = crate::api::Session::new(paths);
        // Keep the first store open and its migrations outside the launch/Stop fixture.
        assert_eq!(
            saved_request(&mut session, "terminal.saved.list", json!({}), None).unwrap()["terminals"],
            json!([])
        );
        let ready = root.path.join("launch-ready");
        let hold = root.path.join("launch-hold");
        let mode = Mode::S_IRUSR | Mode::S_IWUSR;
        mkfifo(&ready, mode).unwrap();
        mkfifo(&hold, mode).unwrap();
        let (client, server) = UnixStream::pair().unwrap();
        std::thread::scope(|scope| {
            let mut reader = OpenOptions::new()
                .read(true)
                .custom_flags(OFlag::O_NONBLOCK.bits())
                .open(&ready)
                .unwrap();
            // Avoid EOF before the shell opens the FIFO; an early Run return drops this writer.
            let writer = OpenOptions::new().write(true).open(&ready).unwrap();
            let flags = OFlag::from_bits_retain(fcntl(&reader, FcntlArg::F_GETFL).unwrap());
            fcntl(
                &reader,
                FcntlArg::F_SETFL(flags.difference(OFlag::O_NONBLOCK)),
            )
            .unwrap();
            let stop = scope.spawn(move || {
                let mut byte = [0];
                let ready = reader.read_exact(&mut byte).map(|()| byte[0]);
                drop(client);
                ready
            });
            let result = saved_request(
                &mut session,
                "terminal.command.run",
                json!({
                    "target":{"kind":"local","cwd":root.path},
                    "command":"printf 1 > launch-ready && read -r release < launch-hold",
                }),
                Some(server.as_fd()),
            );
            drop(writer);
            let ready = stop.join().unwrap();
            assert!(
                matches!(ready, Ok(b'1')),
                "Stop follows a confirmed launch: readiness {ready:?}, Run {result:?}"
            );
            assert_eq!(result.unwrap_err().code(), "SHELL_RUN_CANCELLED");
        });
        let (_client, server) = UnixStream::pair().unwrap();
        assert_eq!(
            saved_request(
                &mut session,
                "terminal.command.keep",
                json!({"runId":uuid::Uuid::new_v4().to_string()}),
                Some(server.as_fd())
            )
            .unwrap_err()
            .code(),
            "TERMINAL_COMMAND_RESULT_UNAVAILABLE",
        );
        assert_eq!(
            saved_request(&mut session, "terminal.saved.list", json!({}), None).unwrap()["terminals"],
            json!([])
        );
    }

    #[test]
    fn standalone_result_is_invisible_until_keep_and_reopening_keeps_it_once() {
        use std::{os::fd::AsFd, os::unix::net::UnixStream};

        let root = crate::test_support::TestDirectory::new();
        let paths =
            crate::config::ConfigPaths::resolve(&root.path, &root.path, Some(&root.path), None);
        let mut session = crate::api::Session::new(paths.clone());
        let call = saved_request;
        let capabilities = call(&mut session, "capabilities", json!({}), None).unwrap();
        assert!(
            capabilities["operations"]
                .as_array()
                .unwrap()
                .iter()
                .any(|operation| { operation == "terminal.command.run" })
        );

        let input = json!({
            "target": {"kind":"local","cwd":root.path},
            "command": "printf once >> launches; printf hello; printf note >&2; exit 7",
        });
        assert_eq!(
            call(&mut session, "terminal.command.run", input.clone(), None)
                .unwrap_err()
                .code(),
            "TERMINAL_COMMAND_SESSION_REQUIRED"
        );
        assert!(!root.path.join("launches").exists());

        let (_client, server) = UnixStream::pair().unwrap();
        let lifeline = Some(server.as_fd());
        let result = call(&mut session, "terminal.command.run", input, lifeline).unwrap();
        let run = result["runId"].as_str().unwrap();
        assert_eq!(result["exitCode"], 7);
        assert_eq!(result["stdout"], "hello");
        assert_eq!(result["stderr"], "note");
        assert_eq!(
            call(&mut session, "terminal.saved.list", json!({}), None).unwrap()["terminals"],
            json!([])
        );

        let keep = json!({"runId":run});
        let saved = call(
            &mut session,
            "terminal.command.keep",
            keep.clone(),
            lifeline,
        )
        .unwrap();
        assert_eq!(
            call(&mut session, "terminal.command.keep", keep, lifeline).unwrap(),
            saved
        );
        assert_eq!(std::fs::read(root.path.join("launches")).unwrap(), b"once");
        let id = saved["terminalId"].as_str().unwrap();
        session.close().unwrap();

        let mut reopened = crate::api::Session::new(paths);
        let listed = call(&mut reopened, "terminal.saved.list", json!({}), None).unwrap();
        let rows = listed["terminals"].as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["terminalId"], id);
        assert!(rows[0].get("stdout").is_none() && rows[0].get("stderr").is_none());
        let loaded = call(
            &mut reopened,
            "terminal.saved.get",
            json!({"terminalId":id}),
            None,
        )
        .unwrap();
        assert_eq!(loaded["stdout"], "hello");
        assert_eq!(loaded["placement"], json!({"kind":"local"}));
    }

    #[test]
    fn a_confirmed_truncated_run_can_be_kept_without_an_invented_exit_code() {
        use std::{os::fd::AsFd, os::unix::net::UnixStream};

        let root = crate::test_support::TestDirectory::new();
        let paths =
            crate::config::ConfigPaths::resolve(&root.path, &root.path, Some(&root.path), None);
        let mut session = crate::api::Session::new(paths);
        let (_client, server) = UnixStream::pair().unwrap();
        let mut call = |operation, input| {
            let body = json!({"version":1,"operation":operation,"input":input}).to_string();
            let request = crate::api::decode(&body).unwrap();
            let response = session
                .execute_with_lifeline(request, Some(server.as_fd()))
                .unwrap();
            serde_json::from_slice::<serde_json::Value>(&response).unwrap()
        };
        let result = call(
            "terminal.command.run",
            json!({
                "target": {"kind":"local","cwd":root.path},
                "command":"printf '%065537d' 0"
            }),
        );
        assert_eq!(result["truncated"], true);
        assert!(result["exitCode"].is_null() && result["signal"].is_null());
        let saved = call("terminal.command.keep", json!({"runId":result["runId"]}));
        let loaded = call(
            "terminal.saved.get",
            json!({"terminalId":saved["terminalId"]}),
        );
        assert_eq!(loaded["stdout"].as_str().unwrap().len(), 65_536);
        assert_eq!(loaded["stderr"], "");
        assert_eq!(loaded["truncated"], true);
        assert!(loaded["exitCode"].is_null() && loaded["signal"].is_null());
    }
}
