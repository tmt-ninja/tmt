//! Where a built-in-host member's terminal stream is: a read-only lookup for a view such as
//! the Ops Terminal tab. It opens no connection and starts, wakes or types nothing; the
//! stream itself is `contracts/terminal-stream-v1.md`. `terminal.resume` continues a member
//! stopped by job control (Ctrl-Z) and is the one operation here with an effect.
use super::{Fault, Request, invalid};
use crate::{
    delivery,
    host::{Host, OperationOptions, ResumeError},
    storage::Storage,
};
use serde::Deserialize;
use serde_json::json;
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

fn entry(storage: &mut Storage, id: &str) -> Result<BindingEntry, Fault> {
    delivery::current(storage, id)
        .map_err(|_| Fault::unavailable())?
        .ok_or_else(|| Fault::new("NAME_NOT_FOUND", "The selected identity was not found."))
}

/// The identity's built-in binding once fresh host evidence shows it Active. Presence only,
/// as for `pane.screen`: an ended agent still has a stream to read, but a member whose
/// supervisor is gone does not.
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
        crate::host::member_paused(binding),
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

fn resource(id: &str, server: &ServerEvidence, pane: &str, paused: bool) -> Result<Vec<u8>, Fault> {
    serde_json::to_vec(&json!({
        "identityId": id,
        "host": server.host.as_str(),
        "socket": server.socket_path,
        "pane": pane,
        "paused": paused,
    }))
    .map_err(|_| Fault::unavailable())
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
            true,
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
    }
}
