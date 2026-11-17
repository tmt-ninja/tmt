//! Thin command composition over the invocation-owned clock.
mod timer;
use crate::{
    invocation::{OutputMode, TickOperation, TickTimerAction},
    output::Failure,
};
use serde_json::Value;
use std::io::{self, Write};
#[cfg(test)]
pub(crate) use timer::PRINTED_HINTS as TIMER_HINTS;
use tmt_adapters::{config::ConfigPaths, tick};
pub struct ClockReport(Value);
impl tmt_cli_style::Render for ClockReport {
    fn human(
        &self,
        stdout: &mut dyn Write,
        _: &mut dyn Write,
        terminal: tmt_cli_style::Terminal,
        _: tmt_cli_style::Terminal,
    ) -> io::Result<()> {
        let fields = if self.0["jobs"].is_object() {
            vec![
                ("accepted", self.0["jobs"]["accepted"].to_string()),
                ("recovered", self.0["jobs"]["recovered"].to_string()),
                ("held", self.0["jobs"]["held"].to_string()),
                ("complete", self.0["complete"].to_string()),
                (
                    "Digest",
                    self.0["digest"]["state"]
                        .as_str()
                        .unwrap_or("unknown")
                        .to_owned(),
                ),
            ]
        } else {
            vec![
                (
                    "state",
                    self.0["state"].as_str().unwrap_or("unknown").to_owned(),
                ),
                ("holder", self.0["holder"].to_string()),
            ]
        };
        tmt_cli_style::detail::write(&mut &mut *stdout, terminal, "Clock", &fields)?;
        stdout.flush()
    }
    fn json(&self, stdout: &mut dyn Write) -> io::Result<()> {
        serde_json::to_writer(&mut &mut *stdout, &self.0)?;
        writeln!(stdout)?;
        stdout.flush()
    }
}

fn publish<W: Write>(
    out: &mut tmt_cli_style::stream::Stream<W>,
    json: bool,
    value: Value,
) -> io::Result<()> {
    use tmt_cli_style::Render;
    let terminal = out.terminal();
    let report = ClockReport(value);
    if json {
        report.json(out)
    } else {
        report.human(
            out,
            &mut io::sink(),
            terminal,
            tmt_cli_style::Terminal::PLAIN,
        )
    }
}

pub fn status() -> Result<ClockReport, Failure> {
    let paths = ConfigPaths::discover().map_err(|error| {
        Failure::new("CONFIG_ERROR", "Could not resolve clock paths.", 1).caused_by(error)
    })?;
    tick::status(
        &paths.global_dir,
        tmt_adapters::request_runtime::wall_time_ms(),
    )
    .map(ClockReport)
    .map_err(tick_failure)
}

fn tick_failure(error: tick::TickError) -> Failure {
    let status = if matches!(
        error,
        tick::TickError::Busy(_) | tick::TickError::LeaseLost | tick::TickError::SchemaChanged
    ) {
        5
    } else {
        1
    };
    Failure::new(error.code(), error.to_string(), status).caused_by(error)
}
pub fn execute(operation: TickOperation, mode: OutputMode) -> io::Result<u8> {
    let paths = match ConfigPaths::discover() {
        Ok(paths) => paths,
        Err(error) => {
            return Failure::new("CONFIG_ERROR", "Could not resolve clock paths.", 1)
                .caused_by(error)
                .publish(mode);
        }
    };
    let mut out = tmt_cli_style::stream::stdout(mode.json);
    if let TickOperation::Timer { action, yes } = operation {
        let action = match action {
            TickTimerAction::Preview => tick::timer::Action::Preview,
            TickTimerAction::Status => tick::timer::Action::Status,
            TickTimerAction::Install => tick::timer::Action::Install,
            TickTimerAction::Remove => tick::timer::Action::Remove,
        };
        return timer::execute(&paths, action, yes, mode);
    }
    let result = match operation {
        TickOperation::Timer { .. } => unreachable!("handled before clock selection"),
        TickOperation::Status => tick::status(
            &paths.global_dir,
            tmt_adapters::request_runtime::wall_time_ms(),
        )
        .and_then(|value| publish(&mut out, mode.json, value).map_err(Into::into))
        .map(|_| true),
        TickOperation::Once | TickOperation::Run => std::env::current_exe()
            .map_err(tick::TickError::from)
            .and_then(|executable| {
                tick::run(
                    &paths,
                    &executable,
                    operation == TickOperation::Run,
                    |value| publish(&mut out, mode.json, value),
                )
            }),
    };
    match result {
        Ok(complete) => Ok(u8::from(!complete)),
        Err(error) => {
            let status = if matches!(
                error,
                tick::TickError::Busy(_)
                    | tick::TickError::LeaseLost
                    | tick::TickError::SchemaChanged
            ) {
                5
            } else {
                1
            };
            Failure::new(error.code(), error.to_string(), status)
                .caused_by(error)
                .publish(mode)
        }
    }
}
