//! `tmt install herdr`: the Herdr back key, written into the user's Herdr
//! configuration only with consent; otherwise the exact block is printed for
//! the user to add. Filesystem policy stays in `setup::herdr_keys`.

use crate::{consent, invocation::OutputMode, output::Failure};
use std::{
    io::{self, Write},
    path::PathBuf,
};
use tmt_adapters::{
    drivers::pi::user_extension::detect_launcher,
    setup::herdr_keys::{self, State},
};

/// What the command did with the block.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Installed,
    Refreshed,
    Current,
    /// Not written: no consent, a binding of the user's, or a failed check.
    Printed,
}

impl Status {
    fn label(self) -> &'static str {
        match self {
            Self::Installed => "installed",
            Self::Refreshed => "refreshed",
            Self::Current => "current",
            Self::Printed => "printed",
        }
    }
}

pub struct Report {
    status: Status,
    path: PathBuf,
    block: String,
    /// Why the block was printed instead of written.
    reason: Option<String>,
}

const SCOPE: &str = "every client attached to that Herdr server returns to the board";

fn failure(error: impl std::error::Error + 'static) -> Failure {
    Failure::new("ERROR", error.to_string(), 1).caused_by(error)
}

pub fn run(yes: bool, mode: OutputMode) -> Result<Report, Failure> {
    let path = herdr_keys::config_path(|name| std::env::var_os(name)).ok_or_else(|| {
        Failure::new(
            "HERDR_CONFIG_UNKNOWN",
            "Could not find the Herdr configuration: set HERDR_CONFIG_PATH or HOME to an absolute path. Nothing changed.",
            1,
        )
    })?;
    let launcher = detect_launcher().map_err(failure)?;
    let block = herdr_keys::block(&launcher);
    let original = herdr_keys::read(&path).map_err(failure)?;
    let text = String::from_utf8(original.clone()).map_err(|_| {
        Failure::new(
            "HERDR_CONFIG_UNREADABLE",
            format!("{} is not UTF-8 text; nothing changed.", path.display()),
            1,
        )
    })?;
    let report = |status, reason: Option<&str>| Report {
        status,
        path: path.clone(),
        block: block.clone(),
        reason: reason.map(str::to_owned),
    };
    let status = match herdr_keys::state(&text, &launcher) {
        State::Current => return Ok(report(Status::Current, None)),
        State::Edited => {
            return Err(Failure::new(
                "HERDR_KEYS_EDITED",
                format!(
                    "The TMT block in {} was edited (its markers are incomplete or repeated); nothing changed.",
                    path.display()
                ),
                1,
            ));
        }
        State::Taken => {
            return Ok(report(
                Status::Printed,
                Some("your configuration already binds prefix+G"),
            ));
        }
        State::Stale => Status::Refreshed,
        State::Absent => {
            if !yes && !consent::interactive(mode) {
                return Ok(report(Status::Printed, Some("no consent to edit it")));
            }
            let question = format!(
                "Herdr back key preview:\n  path: {}\n  scope: prefix+G returns to the board after a jump; {SCOPE}\n{block}Add this block to your Herdr configuration",
                path.display()
            );
            let accepted = consent::ask(
                yes,
                mode,
                consent::Consent {
                    code: "HERDR_KEYS_CONSENT_REQUIRED",
                    refusal: "Adding the Herdr back key needs explicit --yes in non-interactive mode.",
                    question: &question,
                    declined: "The Herdr configuration was not changed.",
                },
                |error| Failure::new("ERROR", error.to_string(), 1).caused_by(error),
            )?;
            if !accepted {
                return Ok(report(Status::Printed, Some("no consent to edit it")));
            }
            Status::Installed
        }
    };
    let next = herdr_keys::with_block(&text, &launcher).expect("unedited markers");
    match herdr_keys::publish(&path, &original, &next, herdr_keys::herdr_check) {
        Ok(()) => Ok(report(status, None)),
        Err(herdr_keys::WriteError::Invalid(reason)) => Ok(report(Status::Printed, Some(&reason))),
        Err(error) => Err(failure(error)),
    }
}

impl tmt_cli_style::Render for Report {
    fn human(
        &self,
        stdout: &mut dyn Write,
        _: &mut dyn Write,
        terminal: tmt_cli_style::Terminal,
        _: tmt_cli_style::Terminal,
    ) -> io::Result<()> {
        let path = self.path.display();
        match self.status {
            Status::Installed | Status::Refreshed => {
                let verb = if self.status == Status::Installed {
                    "Added"
                } else {
                    "Refreshed"
                };
                tmt_cli_style::message::success(
                    &mut &mut *stdout,
                    terminal,
                    &format!("{verb} the Herdr back key (prefix+G) in {path}"),
                )?;
            }
            Status::Current => writeln!(stdout, "The Herdr back key is current in {path}")?,
            Status::Printed => {
                writeln!(
                    stdout,
                    "Not written ({}). To add the back key, put this block in {path}:\n\n{}",
                    self.reason.as_deref().unwrap_or("not written"),
                    self.block
                )?;
            }
        }
        tmt_cli_style::message::hint(&mut &mut *stdout, terminal, SCOPE)?;
        if self.status != Status::Current {
            tmt_cli_style::message::hint(
                &mut &mut *stdout,
                terminal,
                "run herdr server reload-config to load it",
            )?;
        }
        Ok(())
    }

    fn json(&self, stdout: &mut dyn Write) -> io::Result<()> {
        let value = serde_json::json!({
            "herdrKeys": {
                "status": self.status.label(),
                "path": self.path,
                "block": self.block,
                "reason": self.reason,
            }
        });
        writeln!(stdout, "{value}")
    }
}
