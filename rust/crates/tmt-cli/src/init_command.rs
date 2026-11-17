//! Workspace-local configuration initialization.

use crate::output::Failure;
use serde_json::json;
use std::io::{self, Write};
use tmt_adapters::config::{ConfigFiles, ConfigPaths};

pub struct Report(std::path::PathBuf);

pub fn run() -> Result<Report, Failure> {
    let paths = ConfigPaths::discover()?;
    let local_config = paths.local_config.clone();
    ConfigFiles { paths }.initialize_local()?;
    Ok(Report(local_config))
}

impl tmt_cli_style::Render for Report {
    fn human(
        &self,
        mut output: &mut dyn Write,
        _: &mut dyn Write,
        terminal: tmt_cli_style::Terminal,
        _: tmt_cli_style::Terminal,
    ) -> io::Result<()> {
        tmt_cli_style::message::success(
            &mut output,
            terminal,
            &format!("Created {}", self.0.display()),
        )
    }
    fn json(&self, output: &mut dyn Write) -> io::Result<()> {
        writeln!(output, "{}", json!({"created": self.0}))
    }
}
