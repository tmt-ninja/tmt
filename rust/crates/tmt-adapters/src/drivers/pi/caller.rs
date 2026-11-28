//! Pi invocation evidence. Decoupled RPC processes (`pi-rpc` / `--mode rpc`)
//! cannot prove host pane ownership; `AI_AGENT`, `PI_CODING_AGENT`, and
//! `PI_SESSION_ID` are hints only, never authority without `command_chain` proof.

#[cfg(test)]
mod tests;

use crate::process::{
    CommandRunner,
    ancestry::{AncestryError, CallerSnapshot},
};
use std::{
    ffi::OsString,
    path::Path,
    time::{Duration, Instant},
};
use tmt_core::{
    binding::session::{HarnessId, ProviderSessionId},
    driver::{
        ActionResult, Driver,
        caller::{HostAttribution, RuntimeCaller},
    },
};

const RPC_EXECUTABLE: &str = "pi-rpc";

pub struct CallerEnvironment {
    pub session_id: Option<OsString>,
    pub coding_agent: Option<OsString>,
    pub ai_agent: Option<OsString>,
    pub process_id: u32,
}

impl CallerEnvironment {
    pub fn current() -> Self {
        Self {
            session_id: std::env::var_os("PI_SESSION_ID"),
            coding_agent: std::env::var_os("PI_CODING_AGENT"),
            ai_agent: std::env::var_os("AI_AGENT"),
            process_id: std::process::id(),
        }
    }

    pub(super) fn has_marker(&self) -> bool {
        self.session_id
            .as_ref()
            .is_some_and(|value| !value.is_empty())
            || self
                .coding_agent
                .as_ref()
                .is_some_and(|value| !value.is_empty())
            || self
                .ai_agent
                .as_ref()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value == super::NAME)
    }
}

pub struct PiCaller<'a, R> {
    runner: &'a R,
    environment: CallerEnvironment,
}

impl<'a, R: CommandRunner> PiCaller<'a, R> {
    pub fn new(runner: &'a R, environment: CallerEnvironment) -> Self {
        Self {
            runner,
            environment,
        }
    }

    /// Reused by `caller_session` admission: ancestry proves host mode, never identity.
    pub fn observe_host(&self) -> Result<Option<(HostAttribution, u32)>, AncestryError> {
        self.observe_host_with_deadline(Instant::now() + Duration::from_secs(3))
    }

    pub(super) fn observe_host_with_deadline(
        &self,
        deadline: Instant,
    ) -> Result<Option<(HostAttribution, u32)>, AncestryError> {
        let snapshot = CallerSnapshot::capture(self.runner, self.environment.process_id, deadline)?;
        observe_snapshot(&snapshot)
    }
}

fn observe_snapshot(
    snapshot: &CallerSnapshot<'_>,
) -> Result<Option<(HostAttribution, u32)>, AncestryError> {
    let mut observed = None;
    for (pid, executable) in &snapshot.chain {
        let Some(file_name) = Path::new(executable).file_name() else {
            continue;
        };
        if file_name == RPC_EXECUTABLE {
            return Ok(Some((HostAttribution::Ambiguous, *pid)));
        }
        if file_name == super::NAME {
            let args = snapshot.arguments(*pid)?;
            let args = args.trim();
            let tail = command_tail(args, executable).ok_or(AncestryError::Unavailable)?;
            if is_rpc_tail(tail) {
                return Ok(Some((HostAttribution::Ambiguous, *pid)));
            }
            observed.get_or_insert((HostAttribution::Independent, *pid));
        }
    }
    Ok(observed)
}

fn command_tail<'a>(args: &'a str, executable: &str) -> Option<&'a str> {
    args.strip_prefix(executable)
        .filter(|tail| tail.is_empty() || tail.starts_with(char::is_whitespace))
        .or_else(|| {
            args.strip_prefix(super::NAME)
                .filter(|tail| tail.is_empty() || tail.starts_with(char::is_whitespace))
        })
        .or_else(|| {
            let split = args.find(char::is_whitespace).unwrap_or(args.len());
            (Path::new(&args[..split]).file_name()? == super::NAME).then_some(&args[split..])
        })
}

fn is_rpc_tail(tail: &str) -> bool {
    let mut expects_mode_value = false;
    for word in tail.split_whitespace() {
        if word == "--" {
            break;
        }
        if expects_mode_value {
            if word == "rpc" {
                return true;
            }
            expects_mode_value = false;
            continue;
        }
        if word == "--mode=rpc" {
            return true;
        }
        if word == "--mode" {
            expects_mode_value = true;
        }
    }
    false
}

impl<R: CommandRunner> Driver for PiCaller<'_, R> {
    type Target = ();
    type Error = AncestryError;
    type Launch = ();

    fn identify_caller(&mut self) -> ActionResult<RuntimeCaller, Self::Error> {
        classify(&self.environment, self.observe_host())
    }
}

pub(super) fn identify(
    snapshot: &CallerSnapshot<'_>,
) -> ActionResult<RuntimeCaller, AncestryError> {
    classify(&CallerEnvironment::current(), observe_snapshot(snapshot))
}

fn classify(
    environment: &CallerEnvironment,
    observation: Result<Option<(HostAttribution, u32)>, AncestryError>,
) -> ActionResult<RuntimeCaller, AncestryError> {
    let host = match observation {
        Ok(observation) => observation,
        Err(error) if environment.has_marker() => {
            return ActionResult::Failed(error);
        }
        Err(_) => return ActionResult::Unsupported,
    };
    let Some((host, _)) = host else {
        // Env markers without a proven pi/pi-rpc ancestor never fall back
        // to the host pane.
        if environment.has_marker() {
            return ActionResult::Failed(AncestryError::Unavailable);
        }
        return ActionResult::Unsupported;
    };
    let session = environment
        .session_id
        .as_ref()
        .and_then(|value| value.to_str())
        .and_then(|value| ProviderSessionId::new(value).ok());
    ActionResult::Completed(RuntimeCaller {
        harness: HarnessId::new(super::NAME).expect("built-in driver ID"),
        session,
        host,
    })
}
