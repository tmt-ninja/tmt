//! Where a built-in-host member's terminal stream is: a read-only lookup for a view such as
//! the Ops Terminal tab. It opens no connection and starts, wakes or types nothing; the
//! stream itself is `contracts/terminal-stream-v1.md`. `terminal.resume` continues a member
//! stopped by job control (Ctrl-Z), and `terminal.relaunch` starts a program on the kept
//! terminal of a member whose program ended; they are the operations here with an effect.
//! `terminal.open`, `terminal.list` and `terminal.close` manage a member's extra terminals
//! (`pty::terminal`): login shells the member owns, never panes or Talk targets.
use super::{Fault, Request, invalid};
use crate::{
    config::ConfigPaths,
    delivery,
    host::{Host, OperationOptions, RelaunchError, ResumeError, TerminalState},
    pty::{
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

pub(super) fn decode_list(input: &[u8]) -> Result<Request, Fault> {
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

/// The identity's built-in binding once fresh host evidence shows it Active. Presence only,
/// as for `pane.screen`: an ended agent's kept terminal still has a stream to read, but a
/// member whose supervisor is gone does not.
fn active(entry: &BindingEntry) -> Result<&Binding, Fault> {
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
        BindingEvidence::Active(_) => Ok(binding),
        BindingEvidence::EndpointLost
        | BindingEvidence::MarkerMismatch
        | BindingEvidence::Unknown => Err(unavailable()),
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
pub(super) fn relaunch(
    storage: &mut Storage,
    id: &str,
    kind: RelaunchKind,
) -> Result<Vec<u8>, Fault> {
    let entry = entry(storage, id)?;
    let binding = entry.binding.as_ref().ok_or_else(unavailable)?;
    if binding.server.host != HostKind::pty() {
        return Err(relaunch_unsupported());
    }
    let binding = active(&entry)?;
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

/// The member's live built-in binding, as `terminal.stream` requires it.
fn member(storage: &mut Storage, id: &str) -> Result<Binding, Fault> {
    let entry = entry(storage, id)?;
    if entry
        .binding
        .as_ref()
        .is_none_or(|binding| binding.server.host != HostKind::pty())
    {
        return Err(unavailable());
    }
    active(&entry).cloned()
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
    // The member's launch directory is its supervisor's; doubt falls back to home.
    let directory = i32::try_from(binding.server.server_pid)
        .ok()
        .and_then(tmt_sys::process_cwd)
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| "/".into());
    let shell = relaunch_program(id, RelaunchKind::Shell)?;
    let owner = terminal::Owner {
        identity: id,
        server_pid: binding.server.server_pid,
        server_start: &binding.server.server_start_time,
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
        Err(TerminalError::Unconfirmed { id, cause }) => Err(Fault::detailed(
            "TERMINAL_OPEN_UNCONFIRMED",
            format!(
                "Terminal {id} was not confirmed and may be running; list or close it, do not open again to retry: {cause}"
            ),
        )),
        Err(error) => Err(failed(format!("Nothing was started: {error}."))),
    }
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
                relaunch(&mut storage, id, RelaunchKind::Shell)
                    .unwrap_err()
                    .code(),
                "NAME_NOT_FOUND"
            );
        }
        assert_eq!(
            relaunch(&mut storage, &unbound.id, RelaunchKind::Resume)
                .unwrap_err()
                .code(),
            "TERMINAL_STREAM_UNAVAILABLE"
        );
    }
}
