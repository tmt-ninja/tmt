//! Native skill installation composition; filesystem policy stays in adapters.

use crate::output::Failure;
use std::{
    error::Error,
    io::{self, Write},
    path::Path,
};
use tmt_adapters::{
    config::ConfigPaths,
    drivers::claude::picker,
    skill_installation::{self, InstallReport, ProviderEnvironment},
};
use tmt_command_output::guidance::{report_document, write_report_human};

fn failure(error: impl Error + 'static) -> Failure {
    Failure::new("ERROR", error.to_string(), 1).caused_by(error)
}

pub struct Report(InstallReport, Option<String>);

pub fn run(
    provider: Option<&str>,
    directory: Option<&str>,
    force: bool,
) -> Result<Report, Failure> {
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
    Ok(Report(report, picker_hint))
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
        Ok(())
    }
    fn json(&self, stdout: &mut dyn Write) -> io::Result<()> {
        let mut value = report_document(&self.0);
        if let Some(hint) = &self.1 {
            value["pickerHint"] = hint.as_str().into();
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
];
