//! Background startup uses the existing detached-process owner, then the same
//! supervisor socket for a managed-launch receipt. It never edits provider state.

use super::{Connection, socket_path};
use crate::{config::ConfigPaths, private_file::ensure_private_directory, process::detached};
use std::{
    ffi::{OsStr, OsString},
    fs::{self, OpenOptions},
    io,
    os::unix::fs::OpenOptionsExt,
    path::Path,
    time::Duration,
};

pub struct StartedMember {
    pub identity_id: String,
    pub binding_id: String,
    pub pane: String,
    pub name: String,
    pub socket: String,
    pub cleanup_warning: Option<String>,
}

/// Preparation refusal is distinct from a detached startup whose result could
/// not be confirmed. Neither case gives authority to replay a possible launch.
#[derive(Debug)]
pub enum LaunchError {
    NotStarted(io::Error),
    Exited {
        status: tmt_pty_protocol::Exit,
        output: String,
    },
    Unconfirmed {
        pane: String,
        cause: io::Error,
    },
    /// The member's kept terminal refused a relaunch: a program still runs there.
    Refused(String),
}
impl std::fmt::Display for LaunchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotStarted(error) => write!(f, "no member was launched: {error}"),
            Self::Exited { status, output } => {
                write!(f, "command exited during startup ({status:?}): {output}")
            }
            Self::Unconfirmed { pane, cause } => {
                write!(f, "launch in {pane} is not confirmed: {cause}")
            }
            Self::Refused(reason) => write!(f, "the member's terminal refused: {reason}"),
        }
    }
}
impl std::error::Error for LaunchError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::NotStarted(error) => Some(error),
            Self::Unconfirmed { cause, .. } => Some(cause),
            Self::Exited { .. } | Self::Refused(_) => None,
        }
    }
}
impl From<io::Error> for LaunchError {
    fn from(value: io::Error) -> Self {
        Self::NotStarted(value)
    }
}

/// The words after the executable that a relaunch on a kept terminal runs for
/// `tmt resume -- IDENTITY` (`fresh`: `--new`). They must stay the in-terminal
/// re-entry `tmt resume` builds for a new supervisor; a test beside that
/// builder (`tmt-cli` `run_command::pty`) keeps the two equal.
pub fn relaunch_arguments(identity: &str, fresh: bool) -> Vec<&str> {
    let mut words = vec!["resume", "--host", "pty"];
    if fresh {
        words.push("--new");
    }
    words.extend(["--", identity]);
    words
}

/// Starts a supervisor for one member. `folder` is where the program starts; `None`
/// keeps the caller's directory, as `tmt run` and `tmt resume` launch from it.
pub fn start_member(
    executable: &OsStr,
    arguments: &[OsString],
    paths: &ConfigPaths,
    folder: Option<&Path>,
) -> Result<StartedMember, LaunchError> {
    let directory = paths.pty_directory();
    ensure_private_directory(&directory)?;
    let pane = format!("pty_{}", uuid::Uuid::new_v4().simple());
    super::validate(&directory, &pane)?;
    let log_path = directory.join(format!("{pane}.startup.log"));
    let log = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&log_path)?;
    let mut argv: Vec<OsString> = vec![
        "__pty-serve".into(),
        directory.as_os_str().into(),
        pane.clone().into(),
        "80".into(),
        "24".into(),
        executable.into(),
    ];
    argv.extend_from_slice(arguments);
    let uncertain = |cause| LaunchError::Unconfirmed {
        pane: pane.clone(),
        cause,
    };
    let acknowledgment =
        detached::start_line(executable, &argv, log, b"ready ", folder).map_err(|error| {
            uncertain(io::Error::other(format!(
                "supervisor startup is not confirmed: {error}; diagnostics: {}",
                log_path.display()
            )))
        })?;
    let line =
        std::str::from_utf8(&acknowledgment).map_err(|error| uncertain(io::Error::other(error)))?;
    let pid = line
        .strip_prefix("ready ")
        .and_then(|v| v.trim().parse::<u32>().ok())
        .filter(|pid| *pid > 0)
        .ok_or_else(|| {
            uncertain(io::Error::other(
                "the supervisor returned invalid readiness",
            ))
        })?;
    let mut client = Connection::connect(&directory, &pane).map_err(|error| {
        uncertain(io::Error::other(format!(
            "supervisor started for PID {pid}, but launch is not confirmed: {error}"
        )))
    })?;
    let marker = client
        .await_launch(Duration::from_secs(60))
        .map_err(|error| {
            uncertain(io::Error::other(format!(
                "supervisor started for PID {pid}, but managed launch is not confirmed: {error}"
            )))
        })?;
    drop(client);
    let marker = match marker {
        super::LaunchOutcome::Launched(marker) => marker,
        super::LaunchOutcome::Exited { status, output } => {
            // The member has ended, so this is a confirmed outcome, never an
            // uncertain launch that could still be running. A member that never
            // started keeps no terminal: its supervisor is closed (best effort).
            if let Ok(mut client) = Connection::connect(&directory, &pane) {
                let _ = client.control(tmt_pty_protocol::Control::Close, Duration::from_secs(3));
            }
            let _ = fs::remove_file(&log_path);
            return Err(LaunchError::Exited { status, output });
        }
    };
    let mut started = StartedMember::from_marker(
        &marker,
        pane.clone(),
        socket_path(&directory, &pane)
            .to_string_lossy()
            .into_owned(),
    )
    .map_err(uncertain)?;
    started.cleanup_warning = fs::remove_file(&log_path).err().map(|error| {
        format!(
            "could not remove startup diagnostics {}: {error}",
            log_path.display()
        )
    });
    Ok(started)
}

impl StartedMember {
    /// The member a committed binding marker names, in `pane` served at `socket`.
    pub fn from_marker(marker: &str, pane: String, socket: String) -> io::Result<Self> {
        let marker: tmt_driver_protocol::Marker =
            serde_json::from_str(marker).map_err(io::Error::other)?;
        Ok(Self {
            identity_id: marker.identity_id,
            binding_id: marker.binding_id,
            name: marker.name,
            cleanup_warning: None,
            socket,
            pane,
        })
    }
}
