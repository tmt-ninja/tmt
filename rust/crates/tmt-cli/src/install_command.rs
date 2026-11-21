//! Native skill installation composition; filesystem policy stays in adapters.

use crate::output::Failure;
use std::{
    error::Error,
    io::{self, Write},
    path::{Path, PathBuf},
};
use tmt_adapters::{
    config::ConfigPaths,
    drivers::{claude::picker, pi},
    setup::provider_mod::ModState,
    skill_installation::{self, InstallReport, ProviderEnvironment},
};
use tmt_command_output::guidance::{report_document, write_report_human};

fn failure(error: impl Error + 'static) -> Failure {
    Failure::new("ERROR", error.to_string(), 1).caused_by(error)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PiExtensionStatus {
    Installed,
    Refreshed,
    Current,
    Blocked,
    Declined,
    Skipped,
}

impl PiExtensionStatus {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Installed => "installed",
            Self::Refreshed => "refreshed",
            Self::Current => "current",
            Self::Blocked => "blocked",
            Self::Declined => "declined",
            Self::Skipped => "skipped",
        }
    }
}

#[derive(Debug, Clone)]
pub struct PiExtensionReport {
    pub status: PiExtensionStatus,
    pub path: PathBuf,
}

pub struct Report(InstallReport, Option<String>, Option<PiExtensionReport>);

pub fn run(
    provider: Option<&str>,
    directory: Option<&str>,
    force: bool,
    extension: bool,
    ask_consent: impl FnOnce(&Path) -> Result<Option<bool>, Failure>,
) -> Result<Report, Failure> {
    if extension && directory.is_some() {
        return Err(Failure::new(
            "INVALID_ARGUMENT",
            "The --extension option cannot be combined with --dir.",
            2,
        ));
    }
    if extension && pi::user_extension::rejects_explicit_provider(provider) {
        return Err(Failure::new(
            "INVALID_ARGUMENT",
            "Only Pi supports installing a user extension.",
            2,
        ));
    }
    let environment = ProviderEnvironment::capture().map_err(failure)?;
    let paths = ConfigPaths::discover()?;
    let report = skill_installation::install(
        &environment,
        &paths.global_dir,
        provider,
        directory.map(Path::new),
        force,
    )
    .map_err(failure)?;
    let picker_hint = picker::missing_hint_after_install(&environment, &report);
    let pi_targeted = directory.is_none() && pi::user_extension::targeted(provider, &report);
    let pi_extension = if pi_targeted {
        Some(handle_pi_extension(&environment, ask_consent)?)
    } else {
        None
    };
    Ok(Report(report, picker_hint, pi_extension))
}

fn handle_pi_extension(
    environment: &ProviderEnvironment,
    ask_consent: impl FnOnce(&Path) -> Result<Option<bool>, Failure>,
) -> Result<PiExtensionReport, Failure> {
    let launcher = pi::user_extension::detect_launcher().map_err(failure)?;
    let startup_ready = pi::user_extension::detect_startup_ready();
    let entry_path = pi::user_extension::target_entry(environment);
    let current_state =
        pi::user_extension::state(environment, &launcher, startup_ready).map_err(failure)?;
    match current_state {
        ModState::Current => Ok(PiExtensionReport {
            status: PiExtensionStatus::Current,
            path: entry_path,
        }),
        ModState::Foreign => Ok(PiExtensionReport {
            status: PiExtensionStatus::Blocked,
            path: entry_path,
        }),
        ModState::Stale => {
            let outcome =
                pi::user_extension::install_or_refresh(environment, &launcher, startup_ready)
                    .map_err(failure)?;
            let status = match outcome {
                pi::user_extension::Outcome::Installed(_) => PiExtensionStatus::Installed,
                pi::user_extension::Outcome::Refreshed(_) => PiExtensionStatus::Refreshed,
                pi::user_extension::Outcome::Current(_) => PiExtensionStatus::Current,
                pi::user_extension::Outcome::Blocked(_) => PiExtensionStatus::Blocked,
            };
            Ok(PiExtensionReport {
                status,
                path: entry_path,
            })
        }
        ModState::Absent => {
            let Some(accepted) = ask_consent(&entry_path)? else {
                return Ok(PiExtensionReport {
                    status: PiExtensionStatus::Skipped,
                    path: entry_path,
                });
            };
            if !accepted {
                return Ok(PiExtensionReport {
                    status: PiExtensionStatus::Declined,
                    path: entry_path,
                });
            }
            let outcome =
                pi::user_extension::install_or_refresh(environment, &launcher, startup_ready)
                    .map_err(failure)?;
            let status = match outcome {
                pi::user_extension::Outcome::Installed(_) => PiExtensionStatus::Installed,
                pi::user_extension::Outcome::Refreshed(_) => PiExtensionStatus::Refreshed,
                pi::user_extension::Outcome::Current(_) => PiExtensionStatus::Current,
                pi::user_extension::Outcome::Blocked(_) => PiExtensionStatus::Blocked,
            };
            Ok(PiExtensionReport {
                status,
                path: entry_path,
            })
        }
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
        write_report_human(&self.0, &mut &mut *stdout)?;
        tmt_cli_style::message::hint(
            &mut &mut *stdout,
            terminal,
            "reload or restart your agent to use the current skill; existing conversations can read tmt learn --skill",
        )?;
        if let Some(hint) = &self.1 {
            tmt_cli_style::message::hint(&mut &mut *stdout, terminal, hint)?;
        }
        if let Some(ext) = &self.2 {
            match ext.status {
                PiExtensionStatus::Installed => {
                    tmt_cli_style::message::success(
                        &mut &mut *stdout,
                        terminal,
                        &format!("Installed Pi extension at {}", ext.path.display()),
                    )?;
                    tmt_cli_style::message::hint(
                        &mut &mut *stdout,
                        terminal,
                        "upgrading Pi takes effect after the next tmt upgrade or tmt install pi",
                    )?;
                }
                PiExtensionStatus::Refreshed => {
                    tmt_cli_style::message::success(
                        &mut &mut *stdout,
                        terminal,
                        &format!("Refreshed Pi extension at {}", ext.path.display()),
                    )?;
                    tmt_cli_style::message::hint(
                        &mut &mut *stdout,
                        terminal,
                        "upgrading Pi takes effect after the next tmt upgrade or tmt install pi",
                    )?;
                }
                PiExtensionStatus::Current => {
                    writeln!(stdout, "Pi extension is current at {}", ext.path.display())?;
                    tmt_cli_style::message::hint(
                        &mut &mut *stdout,
                        terminal,
                        "upgrading Pi takes effect after the next tmt upgrade or tmt install pi",
                    )?;
                }
                PiExtensionStatus::Blocked => {
                    tmt_cli_style::message::warning(
                        &mut &mut *stdout,
                        terminal,
                        &format!(
                            "Skipped Pi extension at {}: foreign directory left untouched",
                            ext.path.parent().unwrap_or(&ext.path).display()
                        ),
                        None,
                    )?;
                }
                PiExtensionStatus::Skipped => {
                    tmt_cli_style::message::hint(
                        &mut &mut *stdout,
                        terminal,
                        "to install the Pi extension non-interactively, run tmt install pi --extension --yes",
                    )?;
                }
                PiExtensionStatus::Declined => {}
            }
        }
        Ok(())
    }
    fn json(&self, stdout: &mut dyn Write) -> io::Result<()> {
        let mut value = report_document(&self.0);
        if let Some(hint) = &self.1 {
            value["pickerHint"] = hint.as_str().into();
        }
        if let Some(ext) = &self.2
            && ext.status != PiExtensionStatus::Skipped
        {
            value["piExtension"] = serde_json::json!({
                "status": ext.status.label(),
                "path": ext.path,
            });
        }
        writeln!(stdout, "{value}")
    }
}

// Source-checked command samples for the printed-command guard.
#[cfg(test)]
pub(crate) const PRINTED_HINTS: &[crate::cli_style_tests::HintSpec] = &[
    crate::cli_style_tests::HintSpec::core(
        "reload or restart your agent to use the current skill; existing conversations can read tmt learn --skill",
        &[""],
        &[],
    ),
    crate::cli_style_tests::HintSpec::core(
        "upgrading Pi takes effect after the next tmt upgrade or tmt install pi",
        &[" or ", ""],
        &[],
    ),
    crate::cli_style_tests::HintSpec::core(
        "to install the Pi extension non-interactively, run tmt install pi --extension --yes",
        &[""],
        &[],
    ),
];
