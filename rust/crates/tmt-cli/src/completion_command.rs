//! Public completion setup; exact script generation remains grammar-owned.

use crate::output::Failure;
use serde_json::json;
use std::io::{self, Write};
use tmt_adapters::{
    completion_install::{self, Plan, Shell},
    config::ConfigPaths,
};
use tmt_cli_style::{detail, message};

fn failure(error: impl std::error::Error + 'static) -> Failure {
    Failure::new("COMPLETION_ERROR", error.to_string(), 1).caused_by(error)
}

pub struct Report {
    selected: Shell,
    detected: Option<Shell>,
    plan: Plan,
}

pub fn run(shell: Option<&str>) -> Result<Report, Failure> {
    let detected = completion_install::detected_shell();
    let selected = shell.and_then(Shell::parse).or(detected).ok_or_else(|| {
        Failure::new(
            "COMPLETION_SHELL_UNKNOWN",
            "Cannot detect a supported shell from SHELL; specify bash, zsh, or fish.",
            1,
        )
    })?;
    let plan = Plan::inspect(selected, ConfigPaths::shell_startup(selected)?).map_err(failure)?;
    Ok(Report {
        selected,
        detected,
        plan,
    })
}

impl tmt_cli_style::Render for Report {
    fn human(
        &self,
        stdout: &mut dyn Write,
        _: &mut dyn Write,
        terminal: tmt_cli_style::Terminal,
        _: tmt_cli_style::Terminal,
    ) -> io::Result<()> {
        let selected = self.selected;
        let detected = self.detected;
        let plan = &self.plan;
        detail::write(
            &mut &mut *stdout,
            terminal,
            "Shell completion",
            &[
                ("shell", selected.name().into()),
                ("detected", detected.map_or("unknown", Shell::name).into()),
                ("file", plan.file.display().to_string()),
                ("line", selected.line().into()),
                (
                    "configured",
                    if plan.configured {
                        "already installed (startup-file evidence)"
                    } else {
                        "not installed (startup-file evidence)"
                    }
                    .into(),
                ),
            ],
        )?;
        writeln!(
            stdout,
            "This checks startup-file text, not functions loaded in your current shell."
        )?;
        if selected == Shell::Zsh {
            writeln!(
                stdout,
                "Place the line after zsh completion initialization (compinit or your shell framework)."
            )?;
        }
        for warning in &plan.warnings {
            message::hint(&mut &mut *stdout, terminal, warning)?;
        }
        Ok(())
    }
    fn json(&self, stdout: &mut dyn Write) -> io::Result<()> {
        writeln!(
            stdout,
            "{}",
            json!({
                "shell": self.selected.name(), "detectedShell": self.detected.map(Shell::name),
                "installed": self.plan.configured, "evidence": "startup-file", "file": self.plan.file,
                "line": self.selected.line(), "warnings": self.plan.warnings,
            })
        )
    }
}

/// Help remains available when shell detection or startup-file inspection fails.
pub fn needs_setup() -> bool {
    let Some(shell) = completion_install::detected_shell() else {
        return false;
    };
    ConfigPaths::shell_startup(shell)
        .ok()
        .and_then(|file| Plan::inspect(shell, file).ok())
        .is_some_and(|plan| !plan.configured)
}
