//! `tmt stop`: stop a bound member's agent with the verified stop that
//! `resume --move` uses. The binding and the remembered session stay, so
//! `tmt resume` works afterwards.

use crate::{
    binding_error::{refusal, stop_refusal},
    output::{Failure, identity_missing},
};
use std::io::{self, Write};
use tmt_adapters::{
    config::ConfigPaths,
    storage::Storage,
    verified_stop::{PaneOutcome, StopOutcome, stop_identity},
};
use tmt_core::identity::Identity;

fn outcome_text(outcome: StopOutcome) -> &'static str {
    match outcome {
        StopOutcome::Stopped => "stopped",
        StopOutcome::AlreadyEnded => "already_ended",
        StopOutcome::NotRunning => "not_running",
    }
}

/// What `--close` did about the member's pane; `none` when it has no binding.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Pane {
    Closed,
    Gone,
    None,
}

impl Pane {
    fn as_str(self) -> &'static str {
        match self {
            Self::Closed => "closed",
            Self::Gone => "gone",
            Self::None => "none",
        }
    }
}

pub struct Stopped {
    identity: Identity,
    outcome: StopOutcome,
    /// Present only when the pane was asked to be closed.
    pane: Option<Pane>,
    /// The member's extra terminals still running after `--close` closed them.
    terminals_left: Vec<String>,
}

pub fn run(selector: &str, close: bool) -> Result<Stopped, Failure> {
    let paths = ConfigPaths::discover().map_err(Failure::from)?;
    let mut storage = Storage::open(&paths.database).map_err(|error| {
        Failure::storage_access(
            error,
            &paths.global_dir,
            "No agent was stopped.",
            "IDENTITY_ERROR",
            "Could not access member state.",
        )
    })?;
    let stopped = stop(&mut storage, &paths, selector, close);
    if storage.close().is_err() {
        let mut stderr = tmt_cli_style::stream::stderr();
        let terminal = stderr.terminal();
        let _ = tmt_cli_style::message::warning(
            &mut stderr,
            terminal,
            "could not close member state cleanly; inspect identity status before retrying.",
            None,
        );
    }
    stopped
}

fn stop(
    storage: &mut Storage,
    paths: &ConfigPaths,
    selector: &str,
    close: bool,
) -> Result<Stopped, Failure> {
    let identity = storage
        .resolve_identity(selector)
        .map_err(|error| {
            Failure::new("IDENTITY_ERROR", "Could not access member state.", 1).caused_by(error)
        })?
        .ok_or_else(|| identity_missing(selector))?;
    let stopped = stop_identity(storage, paths, &identity, close).map_err(stop_refusal)?;
    // The CLI keeps its PANE_NOT_CLOSED exit for a pane left open.
    let pane = match stopped.pane {
        Some(PaneOutcome::Kept(kept)) => {
            return Err(refusal("PANE_NOT_CLOSED", kept.reason(&identity.name)));
        }
        Some(PaneOutcome::Closed) => Some(Pane::Closed),
        Some(PaneOutcome::Gone) => Some(Pane::Gone),
        None => close.then_some(Pane::None),
    };
    Ok(Stopped {
        identity,
        outcome: stopped.outcome,
        pane,
        terminals_left: stopped.terminals_left,
    })
}

pub fn execute(
    selector: String,
    close: bool,
    mode: crate::invocation::OutputMode,
) -> io::Result<u8> {
    tmt_cli_style::CliOutput::new(mode.json).finish(run(&selector, close))
}

impl tmt_cli_style::Render for Stopped {
    fn human(
        &self,
        stdout: &mut dyn Write,
        _: &mut dyn Write,
        terminal: tmt_cli_style::Terminal,
        _: tmt_cli_style::Terminal,
    ) -> io::Result<()> {
        let name = &self.identity.name;
        let kept_state = "its binding and remembered session are kept";
        let message = match (self.outcome, self.pane) {
            (StopOutcome::Stopped, Some(Pane::Closed)) => {
                format!("Stopped {name}'s agent and closed its pane; {kept_state}")
            }
            (StopOutcome::Stopped, _) => format!("Stopped {name}'s agent; {kept_state}"),
            (StopOutcome::AlreadyEnded, Some(Pane::Closed)) => {
                format!("{name}'s agent had already ended; closed its pane, nothing was signalled")
            }
            (StopOutcome::AlreadyEnded, _) => {
                format!("{name}'s agent had already ended; nothing was signalled")
            }
            (StopOutcome::NotRunning, _) => format!("{name} has no running agent; nothing to stop"),
        };
        tmt_cli_style::message::success(&mut &mut *stdout, terminal, &message)?;
        if !self.terminals_left.is_empty() {
            tmt_cli_style::message::warning(
                &mut &mut *stdout,
                terminal,
                &format!(
                    "its terminals {} were still running; each ends once its member is gone",
                    self.terminals_left.join(", ")
                ),
                None,
            )?;
        }
        Ok(())
    }
    fn json(&self, stdout: &mut dyn Write) -> io::Result<()> {
        let mut document = serde_json::json!({
            "identity": {"id": self.identity.id, "name": self.identity.name},
            "outcome": outcome_text(self.outcome),
        });
        if let Some(pane) = self.pane {
            document["pane"] = pane.as_str().into();
        }
        if !self.terminals_left.is_empty() {
            document["terminalsLeft"] = self.terminals_left.clone().into();
        }
        writeln!(stdout, "{document}")
    }
}
