//! Thin command composition over the invocation-owned clock.
use crate::{
    invocation::{OutputMode, TickOperation},
    output::Failure,
};
use serde_json::Value;
use std::io::{self, Write};
use tmt_adapters::{config::ConfigPaths, tick};
fn publish<W: Write>(
    out: &mut tmt_cli_style::stream::Stream<W>,
    json: bool,
    value: Value,
) -> io::Result<()> {
    if json {
        serde_json::to_writer(&mut *out, &value)?;
        writeln!(out)?;
    } else {
        let terminal = out.terminal();
        let fields = if value["jobs"].is_object() {
            vec![
                ("accepted", value["jobs"]["accepted"].to_string()),
                ("recovered", value["jobs"]["recovered"].to_string()),
                ("held", value["jobs"]["held"].to_string()),
                ("complete", value["complete"].to_string()),
                (
                    "Digest",
                    value["digest"]["state"]
                        .as_str()
                        .unwrap_or("unknown")
                        .to_owned(),
                ),
            ]
        } else {
            vec![
                (
                    "state",
                    value["state"].as_str().unwrap_or("unknown").to_owned(),
                ),
                ("holder", value["holder"].to_string()),
            ]
        };
        tmt_cli_style::detail::write(out, terminal, "Clock", &fields)?;
    }
    out.flush()
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
    let result = match operation {
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
