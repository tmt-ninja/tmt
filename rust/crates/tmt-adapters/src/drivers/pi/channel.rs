//! Pi owns its extension protocol. Socket leases, pane attribution, inspection,
//! and recovery use the same record mechanics as the local Claude endpoint.
use crate::{
    drivers::claude::channel::{self as socket, ClaudeChannel},
    private_file::{directory_is_private, ensure_private_directory},
    process::{CommandRequest, CommandRunner, SupervisedProbeRunner},
    runtime::{RuntimeCommand, RuntimeError, channel::*},
};
use serde::{Deserialize, Serialize};
use std::{
    io,
    os::unix::net::UnixStream,
    path::Path,
    time::{Duration, Instant},
};
use tmt_core::{
    binding::{
        BindingEntry,
        session::{RuntimeLiveness, RuntimeState},
    },
    driver::{ActionResult, DeliveryAcceptance, SendFailure},
};

pub(super) struct PiChannel;
const VERSION: &str = "1.6.1";
const HANDSHAKE: Duration = Duration::from_secs(2);
const EXTENSION: &[u8] = include_bytes!("channel-extension.mjs");

impl RuntimeChannel for PiChannel {
    fn preflight(
        &self,
        command: &RuntimeCommand,
        _: Option<&Path>,
        root: &Path,
        deadline: Instant,
    ) -> Result<Option<String>, ChannelError> {
        let directory = root.join("pi");
        if !directory.is_absolute() || !socket::socket_fits(&directory, &"0".repeat(36)) {
            return Err(ChannelError::PathTooLong);
        }
        use crate::runtime::lifecycle::RuntimeLifecycle;
        if !super::PiLifecycle.startup_input(command) {
            return Err(ChannelError::UnsupportedArguments(
                "PiChannel requires an interactive launch without a startup prompt",
            ));
        }
        let output = SupervisedProbeRunner
            .execute(CommandRequest {
                program: &command.executable,
                args: &["--version".into()],
                input: &[],
                deadline: deadline.min(Instant::now() + super::VERSION_TIMEOUT),
                max_output_bytes: 1024,
            })
            .map_err(|_| ChannelError::ProviderUnavailable)?;
        let found = String::from_utf8_lossy(&output.stdout);
        if found.trim() != VERSION {
            return Err(ChannelError::ProviderVersion {
                found: found.trim().into(),
            });
        }
        Ok(None)
    }

    fn enroll(&self, plan: &ChannelPlan<'_>) -> Result<Box<dyn ChannelEnrollment>, ChannelError> {
        let directory = plan.directory.join("pi");
        ensure_private_directory(plan.directory)
            .and_then(|()| ensure_private_directory(&directory))
            .map_err(|_| ChannelError::Enrollment)?;
        let extension = directory.join("channel-v1.mjs");
        if !super::extension_up_to_date(&extension, EXTENSION) {
            crate::private_file::replace(&extension, EXTENSION)
                .map_err(|_| ChannelError::Enrollment)?;
        }
        let mut lease = socket::acquire_lease(&ChannelPlan {
            directory: &directory,
            ..*plan
        })?;
        let addr = socket::socket_path(&directory, plan.binding_id);
        lease.environment = vec![
            ("TMT_PI_CHANNEL_SOCKET".into(), addr.into_os_string()),
            (
                "TMT_PI_CHANNEL_GENERATION".into(),
                lease.generation.clone().into(),
            ),
            (
                "TMT_PI_CHANNEL_RESUME".into(),
                plan.resume_session.map_or("", |s| s.as_str()).into(),
            ),
        ];
        lease
            .command
            .args
            .extend(["--extension".into(), extension.into_os_string()]);
        Ok(Box::new(lease))
    }

    fn enrolled(&self, root: &Path, id: &str) -> Result<bool, ChannelFault> {
        ClaudeChannel.enrolled(&root.join("pi"), id)
    }
    fn enrolled_in_pane(
        &self,
        root: &Path,
        pane: &PaneAddress<'_>,
        id: Option<&str>,
        deadline: Instant,
    ) -> Result<PaneEvidence, EvidenceError> {
        ClaudeChannel.enrolled_in_pane(&root.join("pi"), pane, id, deadline)
    }
    fn inspect(
        &self,
        root: &Path,
        id: &str,
        deadline: Instant,
    ) -> Result<Option<EnrollmentReport>, EvidenceError> {
        ClaudeChannel.inspect(&root.join("pi"), id, deadline)
    }
    fn recover(
        &self,
        root: &Path,
        id: &str,
        generation: &str,
        deadline: Instant,
    ) -> Result<Recovery, RecoveryError> {
        ClaudeChannel.recover(&root.join("pi"), id, generation, deadline)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Hello {
    version: u8,
    session: String,
    pid: u64,
}

#[derive(Serialize)]
struct Frame<'a> {
    version: u8,
    generation: &'a str,
    session: &'a str,
    attempt: &'a str,
    urgent: bool,
    deadline: u64,
    content: &'a str,
}

#[derive(Deserialize)]
#[serde(tag = "outcome", rename_all = "lowercase", deny_unknown_fields)]
enum Reply {
    Refused,
    Started {
        attempt: String,
        generation: String,
        session: String,
        sha256: String,
    },
}

type Sent = ActionResult<DeliveryAcceptance, SendFailure<RuntimeError>>;
fn denied(f: ChannelFault) -> Sent {
    ActionResult::Failed(SendFailure::Denied(RuntimeError::Channel(f)))
}

// Verify the process behind the socket before disclosing request text or its
// receipt. The PID in a JSON greeting alone is never evidence of the peer.
fn peer_pid(stream: &UnixStream) -> Option<u64> {
    #[cfg(target_os = "macos")]
    let pid = nix::sys::socket::getsockopt(stream, nix::sys::socket::sockopt::LocalPeerPid).ok()?;
    #[cfg(target_os = "linux")]
    let pid = nix::sys::socket::getsockopt(stream, nix::sys::socket::sockopt::PeerCredentials)
        .ok()?
        .pid();
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return u64::try_from(pid).ok();
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    None
}

/// A stale record for another independently verified launch is also ignored
/// by send and by the pane guard. Preserve the new launch's ordinary paste.
pub(crate) fn needs_receipt_window(root: &Path, entry: &BindingEntry) -> bool {
    let Some(binding) = &entry.binding else {
        return false;
    };
    match socket::read_record(&root.join("pi"), &binding.id) {
        Ok(None) => false,
        Ok(Some(record)) => !binding.session.launch_owner.as_ref().is_some_and(|owner| {
            record.launch_owner.incarnation().as_ref() != Some(owner)
                && socket::liveness(owner) == RuntimeLiveness::Alive
        }),
        Err(_) => true,
    }
}

pub(super) fn send(
    entry: &BindingEntry,
    content: &str,
    request: Option<(&str, bool, Option<u64>)>,
) -> Sent {
    let Some(b) = &entry.binding else {
        return ActionResult::Unsupported;
    };
    let Ok(paths) = crate::config::ConfigPaths::discover() else {
        return denied(ChannelFault::Unverifiable);
    };
    let directory = paths.channel_directory().join("pi");
    let record = match socket::read_record(&directory, &b.id) {
        Ok(None) => return ActionResult::Unsupported,
        Ok(Some(r)) => r,
        Err(f) => return denied(f),
    };
    if !directory_is_private(&directory)
        || record.version != 1
        || record.binding_id != b.id
        || record.identity_id.as_ref() != Some(&entry.identity.id)
        || !record.pane.as_ref().is_some_and(|p| {
            p.is(&PaneAddress {
                server: &b.server,
                pane_id: &b.pane_id,
                pane_pid: b.pane_pid,
            })
        })
    {
        return denied(ChannelFault::Mismatch);
    }
    let Some(owner) = record.launch_owner.incarnation() else {
        return denied(ChannelFault::InvalidRecord);
    };
    if b.session.launch_owner.as_ref() != Some(&owner) {
        if b.session
            .launch_owner
            .as_ref()
            .is_some_and(|p| socket::liveness(p) == RuntimeLiveness::Alive)
        {
            return ActionResult::Unsupported;
        }
        return denied(ChannelFault::Mismatch);
    }
    if socket::liveness(&owner) != RuntimeLiveness::Alive {
        return denied(ChannelFault::Stale);
    }
    let Some(key) = b.session.key.as_ref() else {
        return denied(ChannelFault::NotReady);
    };
    let Some(session) = key.provider_session.as_ref() else {
        return denied(ChannelFault::NotReady);
    };
    if b.session.state != RuntimeState::Running
        || record
            .foreground
            .as_ref()
            .and_then(|p| p.incarnation())
            .as_ref()
            != Some(&key.incarnation)
        || socket::liveness(&key.incarnation) != RuntimeLiveness::Alive
    {
        return denied(ChannelFault::NotReady);
    }
    let Some((attempt, urgent, Some(deadline))) = request else {
        return denied(ChannelFault::Refused);
    };
    let Ok(mut stream) = UnixStream::connect(socket::socket_path(&directory, &b.id)) else {
        return denied(ChannelFault::Unreachable);
    };
    if peer_pid(&stream) != Some(key.incarnation.pid())
        || socket::liveness(&key.incarnation) != RuntimeLiveness::Alive
    {
        return denied(ChannelFault::Mismatch);
    }
    let hello = socket::read_line_until(&mut stream, Instant::now() + HANDSHAKE, 4096)
        .ok()
        .filter(|v| v.ends_with(b"\n"))
        .and_then(|v| serde_json::from_slice::<Hello>(&v).ok());
    if !hello.is_some_and(|h| {
        h.version == 1 && h.pid == key.incarnation.pid() && h.session == session.as_str()
    }) {
        return denied(ChannelFault::Mismatch);
    }
    let remaining = deadline.saturating_sub(crate::request_runtime::wall_time_ms());
    if remaining == 0 || remaining > 30_000 {
        return denied(ChannelFault::NotReady);
    }
    let limit = Instant::now() + Duration::from_millis(remaining);
    let frame = Frame {
        version: 1,
        generation: &record.generation,
        session: session.as_str(),
        attempt,
        urgent,
        deadline,
        content,
    };
    let Ok(mut bytes) = serde_json::to_vec(&frame) else {
        return denied(ChannelFault::Refused);
    };
    bytes.push(b'\n');
    if bytes.len() > 7 * 1024 * 1024 {
        return denied(ChannelFault::TooLarge);
    }
    if socket::write_until(&mut stream, &bytes, limit).is_err() {
        return ActionResult::Completed(DeliveryAcceptance::Unacknowledged);
    }
    let reply = socket::read_line_until(&mut stream, limit, 4096).and_then(|b| {
        if !b.ends_with(b"\n") {
            return Err(io::Error::other("Incomplete Pi receipt"));
        }
        serde_json::from_slice::<Reply>(&b).map_err(io::Error::other)
    });
    match reply {
        Ok(Reply::Started {
            attempt: a,
            generation,
            session: s,
            sha256,
        }) if a == attempt
            && s == session.as_str()
            && generation == record.generation
            && sha256 == tmt_core::content_digest::sha256(content.as_bytes()) =>
        {
            ActionResult::Completed(DeliveryAcceptance::Submitted)
        }
        Ok(Reply::Refused) => denied(ChannelFault::Refused),
        _ => ActionResult::Completed(DeliveryAcceptance::Unacknowledged),
    }
}
