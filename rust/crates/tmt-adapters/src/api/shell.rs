//! Local shell commands in a freshly observed member directory.
use super::{Fault, Request, invalid};
use crate::{
    delivery,
    host::{Host, OperationOptions},
    process::{CommandFailure, UnixCommandRunner},
    storage::Storage,
};
use serde::Deserialize;
use serde_json::json;
use std::{path::Path, time::Duration};
use tmt_core::{
    binding::{BindingEntry, BindingEvidence, evaluate_binding},
    endpoint::EndpointProbe,
    host::HostKind,
};

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

pub(super) fn run(
    storage: &mut Storage,
    identity_id: &str,
    command: &str,
    lifeline: Option<std::os::fd::BorrowedFd<'_>>,
) -> Result<Vec<u8>, Fault> {
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
                deadline: None,
                pane_ids: Some(std::slice::from_ref(&binding.pane_id)),
            },
        )
        .map_err(|_| no_directory())?;
    let cwd = verified_cwd(&entry, &probe)?;
    let mut interrupt = crate::interrupt::Interrupt::install_termination().map_err(|_| {
        Fault::new(
            "SHELL_RUN_FAILED",
            "Shell cancellation could not be prepared. Nothing was run.",
        )
    })?;
    interrupt.defer_emergency_exit();
    let result = UnixCommandRunner.run_shell_in_interrupt(command, Path::new(&cwd), Duration::from_secs(120), 65_536, Some(&interrupt), lifeline).map_err(|error| {
        if matches!(error.kind, CommandFailure::Spawn) && !error.cleanup_failed() {
            Fault::new("SHELL_RUN_FAILED", "The shell could not be started. Nothing was run.")
        } else {
            Fault::new("SHELL_RUN_UNCONFIRMED", "The shell may have started; its result could not be confirmed. Do not retry automatically.")
        }
    })?;
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
}
