//! New-executable composition for the native updater's managed-skill phase.

use crate::{invocation::OutputMode, output::Failure};
use serde_json::{Value, json};
use std::{
    io::{self, Write},
    path::Path,
};
use tmt_adapters::{
    config::ConfigPaths,
    drivers::pi,
    skill_installation::{self, ProviderEnvironment, RefreshReport, RefreshedSkill},
};

/// One recovery line per preserved target. Move the entry, never its source,
/// into a fresh backup outside provider discovery before retrying the update.
pub(crate) fn conflict_hint(target: &Path) -> String {
    let parent = target
        .parent()
        .and_then(Path::parent)
        .unwrap_or(Path::new("."));
    let backups = parent.join(".tmt-skill-backups");
    let template = backups.join("upgrade-conflict.XXXXXXXX");
    let name = target.file_name().unwrap_or_default().to_string_lossy();
    let quote = crate::output::shell_word;
    format!(
        "User-owned or modified skill preserved at {}; back up this entry with: mkdir -p {} && backup=$(mktemp -d {}) && mv {} \"$backup\"/{}; then repeat the original upgrade command",
        target.display(),
        quote(&backups.to_string_lossy()),
        quote(&template.to_string_lossy()),
        quote(&target.to_string_lossy()),
        quote(&name)
    )
}

fn refresh_pi_extension(report: &mut RefreshReport) -> io::Result<()> {
    let environment = ProviderEnvironment::capture()?;
    let launcher = pi::user_extension::detect_launcher()?;
    let startup_ready = pi::user_extension::detect_startup_ready();
    if let Some(outcome) =
        pi::user_extension::refresh_if_installed(&environment, &launcher, startup_ready)?
    {
        report.refreshed.push(RefreshedSkill {
            target: outcome.entry_path(),
            changed: outcome.changed(),
        });
    }
    Ok(())
}

/// The Herdr back key follows this build only where a managed block exists;
/// none is created here. A rejected refresh keeps the old block.
fn refresh_herdr_keys(report: &mut RefreshReport) -> io::Result<()> {
    use tmt_adapters::setup::herdr_keys;
    let Some(path) = herdr_keys::managed_config(|name| std::env::var_os(name))? else {
        return Ok(());
    };
    let launcher = pi::user_extension::detect_launcher()?;
    match herdr_keys::refresh(&path, &launcher, herdr_keys::herdr_check) {
        Ok(Some(changed)) => report.refreshed.push(RefreshedSkill {
            target: path,
            changed,
        }),
        Ok(None) => {}
        // The previous block stays; the path is reported as not refreshed.
        Err(_) => report.skipped.push(path),
    }
    Ok(())
}

fn document(report: &RefreshReport) -> Value {
    json!({
        "refreshed": report.refreshed.iter().map(|item| json!({"target": item.target, "changed": item.changed})).collect::<Vec<_>>(),
        "skipped": report.skipped,
        "conflicts": report.conflicts,
    })
}

/// The updater consumes this same owner's bounded JSON contract, not arbitrary
/// child stdout. Error details retain the shared CLI error-envelope shape.
pub(crate) fn parse_document(bytes: &[u8]) -> Option<Value> {
    let value: Value = serde_json::from_slice(bytes).ok()?;
    let object = value.as_object()?;
    if object.len() != 3 + usize::from(object.contains_key("error")) {
        return None;
    }
    if !value["refreshed"].as_array()?.iter().all(|item| {
        item.as_object().is_some_and(|item| item.len() == 2)
            && item["target"].is_string()
            && item["changed"].is_boolean()
    }) {
        return None;
    }
    for key in ["skipped", "conflicts"] {
        if !value[key].as_array()?.iter().all(Value::is_string) {
            return None;
        }
    }
    if !value["conflicts"].as_array()?.is_empty() && !object.contains_key("error") {
        return None;
    }
    if let Some(error) = object.get("error")
        && (!error["code"].is_string() || !error["message"].is_string())
    {
        return None;
    }
    Some(value)
}

pub fn execute(managed: bool, mode: OutputMode) -> io::Result<u8> {
    // Published updaters require exactly one JSON document and empty stderr.
    // A successful directory cutover cannot add a diagnostic to this protocol.
    let paths = if managed {
        ConfigPaths::discover_with_move_report(|_, _| {})
    } else {
        ConfigPaths::discover()
    };
    let (report, failure) = match paths {
        Err(error) => (RefreshReport::default(), Some(Failure::from(error))),
        Ok(paths) => match if managed {
            std::env::current_exe().and_then(|executable| {
                tmt_adapters::native_install::with_active_release(&executable, || {
                    skill_installation::refresh(&paths.global_dir)
                })
            })
        } else {
            Ok(skill_installation::refresh(&paths.global_dir))
        } {
            Ok(Ok(mut report)) => {
                if let Err(error) =
                    refresh_pi_extension(&mut report).and_then(|()| refresh_herdr_keys(&mut report))
                {
                    let failure =
                        Failure::new("SKILL_REFRESH_FAILED", error.to_string(), 1).caused_by(error);
                    (report, Some(failure))
                } else {
                    (report, None)
                }
            }
            Ok(Err(mut error)) => {
                let report = std::mem::take(&mut error.report);
                let failure =
                    Failure::new("SKILL_REFRESH_FAILED", error.to_string(), 1).caused_by(error);
                (report, Some(failure))
            }
            Err(error) => (
                RefreshReport::default(),
                Some(Failure::new("SKILL_REFRESH_FAILED", error.to_string(), 1).caused_by(error)),
            ),
        },
    };
    let mut output = tmt_cli_style::stream::stdout(mode.json);
    let terminal = output.terminal();
    if mode.json {
        let mut value = document(&report);
        if let Some(failure) = &failure {
            value["error"] = failure.document()["error"].clone();
            if !report.conflicts.is_empty() {
                value["error"]["suggestion"] = report
                    .conflicts
                    .iter()
                    .map(|target| conflict_hint(target))
                    .collect::<Vec<_>>()
                    .join("\n")
                    .into();
            }
        }
        writeln!(output, "{value}")?;
    } else {
        for item in &report.refreshed {
            writeln!(
                output,
                "{} skill at {}",
                if item.changed { "Refreshed" } else { "Current" },
                item.target.display()
            )?;
        }
        for target in &report.skipped {
            writeln!(output, "Skipped missing skill at {}", target.display())?;
        }
        for target in &report.conflicts {
            writeln!(output, "{}", conflict_hint(target))?;
        }
        if !report.refreshed.is_empty() {
            tmt_cli_style::message::hint(
                &mut output,
                terminal,
                "reload or restart your agent to use the current skill; existing conversations can read tmt learn --skill",
            )?;
        }
        if let Some(failure) = &failure {
            failure.publish(mode)?;
        }
    }
    Ok(if failure.is_some() { 1 } else { 0 })
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
