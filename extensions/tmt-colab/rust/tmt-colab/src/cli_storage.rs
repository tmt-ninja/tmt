//! Root-local storage reporting and verified reclaim.
use crate::cli_management::resolve_page;
use clap::{Arg, ArgAction, ArgMatches, Command};
use std::{io::Write, path::Path};
use tmt_cli_style::{CommandSpec, Example, OutputModes};
use tmt_colab::{
    Result,
    decoder::Decoder,
    keyring::{Keyring, Layout, StateFault},
    page::Fault,
    storage::{self, Reclaim},
    store::{Store, owner::size},
};

fn spec(name: &'static str, summary: &'static str, examples: &'static [Example]) -> Command {
    tmt_cli_style::command(&CommandSpec {
        name,
        summary,
        examples,
        outputs: OutputModes::HumanAndJson,
        details: "Reports retained bytes and estimated reclaimable history. Comments and signed history stay protected. Attachments are not removed.",
    })
}
fn dry_run() -> Arg {
    Arg::new("dry-run")
        .long("dry-run")
        .action(ArgAction::SetTrue)
        .help("Estimate without changing state")
}
pub fn command() -> Command {
    spec(
        "storage",
        "Show local storage for each page",
        &[Example {
            command: "tmt colab storage --json",
            note: "Show storage on this machine",
        }],
    )
    .mut_arg("json", |arg| arg.global(true))
    .subcommand(
        spec(
            "reclaim",
            "Clean up eligible page history",
            &[Example {
                command: "tmt colab storage reclaim --dry-run",
                note: "Preview cleanup",
            }],
        )
        .arg(dry_run()),
    )
}
pub fn page_command() -> Command {
    spec(
        "reclaim",
        "Clean up this page's eligible history",
        &[Example {
            command: "tmt colab page reclaim 10000000-0000-4000-8000-000000000001 --dry-run",
            note: "Preview cleanup for one page",
        }],
    )
    .arg(
        Arg::new("source")
            .long("source")
            .value_name("FILE")
            .requires("dry-run")
            .value_parser(clap::value_parser!(std::path::PathBuf))
            .help("Measure whether this HTML rewrite fits the candidate (use - for stdin)"),
    )
    .arg(
        Arg::new("discard-content-history")
            .long("discard-content-history")
            .action(ArgAction::SetTrue)
            .conflicts_with("dry-run")
            .requires("yes")
            .help("Irreversibly discard old content history for this page"),
    )
    .arg(
        Arg::new("yes")
            .long("yes")
            .action(ArgAction::SetTrue)
            .requires("discard-content-history")
            .help("Confirm that old content history may be discarded"),
    )
    .arg(crate::cli_grammar::page())
    .arg(dry_run())
}
fn human(bytes: u64) -> String {
    size(usize::try_from(bytes).unwrap_or(usize::MAX))
}
fn print_page(
    report: &Reclaim,
    json_output: bool,
    preview: Option<&tmt_colab::page::compact::HistoryPreview>,
) -> Result<()> {
    if let Some(error) = &report.error {
        let message = if let Some(freed) = report.freed.history.filter(|bytes| *bytes > 0) {
            format!(
                "{} Freed {} before the error. The page is unchanged.",
                error.message,
                human(freed)
            )
        } else {
            format!("{} The page is unchanged.", error.message)
        };
        return Err(Box::new(crate::cli_management::ManagementFault {
            code: "COLAB_UNAVAILABLE",
            message,
            correlation: serde_json::to_value(report)?,
            source: None,
        }));
    }
    let mut out = tmt_cli_style::stream::stdout(json_output);
    if json_output {
        let mut value = serde_json::to_value(report)?;
        if let Some(preview) = preview {
            value["historyPreview"] = serde_json::to_value(preview)?;
        }
        if report.skipped.as_deref() == Some("shared-history") {
            value["skipDetail"] = tmt_colab::page::compact::SHARED_HISTORY.into();
        }
        writeln!(out, "{value}")?;
    } else if let Some(reason) = &report.skipped {
        writeln!(out, "skipped  {reason}")?;
        if reason == "shared-history" {
            writeln!(out, "{}", tmt_colab::page::compact::SHARED_HISTORY)?;
        }
    } else if report.dry_run {
        writeln!(
            out,
            "would free {}  page unchanged",
            human(report.freeable.history)
        )?;
    } else {
        writeln!(
            out,
            "reclaimed  {}  page unchanged",
            report
                .freed
                .history
                .map(human)
                .unwrap_or_else(|| "unknown".into())
        )?;
    }
    if !json_output && let Some(p) = preview {
        writeln!(
            out,
            "Stored page now: {} compressed bytes.",
            p.before_gzip_bytes
        )?;
        if let Some(reason) = &p.blocked {
            writeln!(out, "Preview unavailable: {reason}")?;
        } else {
            if let (Some(after), Some(room)) = (p.after_gzip_bytes, p.headroom_bytes) {
                writeln!(
                    out,
                    "Candidate: {after} compressed bytes, {room} bytes of headroom."
                )?;
            }
            if let Some(n) = p.estimated_whole_rewrites {
                writeln!(
                    out,
                    "About {n} whole rewrites of the current source at similar compression (estimate)."
                )?;
            }
            if let Some(loss) = &p.discard {
                writeln!(
                    out,
                    "Would discard {} content checkpoints ({} bytes) and {} content updates ({} bytes).",
                    loss.checkpoints, loss.checkpoint_bytes, loss.updates, loss.update_bytes
                )?;
                writeln!(out, "Existing sharing recipients affected: 0.")?;
                if p.changes_history_policy == Some(true) {
                    writeln!(
                        out,
                        "History would change from shared to current. Future link readers and members would start at the new cut."
                    )?;
                }
            }
            writeln!(out, "{}\n{}", p.write_detail, p.history_loss)?;
        }
    }
    Ok(())
}

pub fn page(root: &Path, args: &ArgMatches) -> Result<()> {
    let layout = Layout::existing(root)?.ok_or(Fault::Missing)?;
    let key = Keyring::read(&layout)?;
    let store = Store::read(&layout)?;
    store.require_current_schema()?;
    let id = resolve_page(
        &store,
        &key,
        args.get_one::<String>("page").expect("required page"),
    )?;
    if args.get_flag("dry-run") {
        let source = args
            .get_one::<std::path::PathBuf>("source")
            .map(|p| crate::page_source(p))
            .transpose()?;
        let mut store = store;
        let generation = store.write_generation()?;
        let mut decoder = Decoder::new(std::env::current_exe()?)?;
        let report = storage::reclaim(&mut store, &key, &id, &mut decoder, true)?;
        let preview =
            tmt_colab::page::compact::preview(&store, &key, &id, &mut decoder, source.as_deref())?;
        if store.write_generation()? != generation {
            return Err(Fault::StaleBase.into());
        }
        store.close()?;
        return print_page(&report, args.get_flag("json"), Some(&preview));
    }
    store.close()?;
    if args.get_flag("discard-content-history") {
        let _lock = layout.serve_lock().map_err(|error| {
            if error.downcast_ref::<StateFault>() == Some(&StateFault::AlreadyServing) {
                std::io::Error::other(
                    "Run `tmt colab stop` before discarding content history. Open pages will disconnect. Run the confirmed command again, then `tmt colab serve` to bring the pages back.",
                ).into()
            } else {
                error
            }
        })?;
        let mut store = Store::write_existing(&layout)?;
        let mut decoder = Decoder::new(std::env::current_exe()?)?;
        let result = tmt_colab::page::compact::discard_history(
            &mut store,
            &key,
            &id,
            &crate::cli_management::fresh_id()?,
            &mut decoder,
            |preview, discard| {
                let mut err = std::io::stderr().lock();
                writeln!(
                    err,
                    "Stored page: {} compressed bytes now, {} in the preview candidate.",
                    preview.before_gzip_bytes,
                    preview.after_gzip_bytes.ok_or(Fault::Invalid)?
                )?;
                writeln!(
                    err,
                    "Discarding {} content checkpoints ({} bytes) and {} content updates ({} bytes). This cannot be undone.",
                    discard.checkpoints,
                    discard.checkpoint_bytes,
                    discard.updates,
                    discard.update_bytes
                )?;
                writeln!(
                    err,
                    "Current source, metadata, attachments and discussion are kept byte for byte. Existing sharing recipients affected: 0."
                )?;
                if preview.changes_history_policy == Some(true) {
                    writeln!(
                        err,
                        "History changes from shared to current. Future link readers and members start at the new cut."
                    )?;
                }
                writeln!(
                    err,
                    "Open Colab pages are disconnected while serve is stopped. Run `tmt colab serve` after recovery to reconnect."
                )?;
                writeln!(
                    err,
                    "This recovery only measures local space and does not remove any cloud copy."
                )?;
                err.flush()?;
                Ok(())
            },
        )?;
        store.close()?;
        let mut out = tmt_cli_style::stream::stdout(args.get_flag("json"));
        if args.get_flag("json") {
            writeln!(out, "{}", serde_json::to_string(&result)?)?;
        } else if let (Some(after), Some(freed)) =
            (result.after_gzip_bytes, result.freed_gzip_bytes)
        {
            writeln!(
                out,
                "Recovered {freed} compressed bytes locally. The stored page is now {after} compressed bytes."
            )?;
        } else {
            writeln!(
                out,
                "Recovery committed. Could not measure local space recovered: {}",
                result
                    .measurement_error
                    .as_deref()
                    .unwrap_or("measurement unavailable")
            )?;
        }
        return Ok(());
    }
    let report = match layout.serve_lock() {
        Ok(_lock) => {
            let mut store = Store::write_existing(&layout)?;
            let mut decoder = Decoder::new(std::env::current_exe()?)?;
            let report = storage::reclaim(&mut store, &key, &id, &mut decoder, false)?;
            store.close()?;
            report
        }
        Err(error) if error.downcast_ref::<StateFault>() == Some(&StateFault::AlreadyServing) => {
            tmt_colab::storage_ipc::reclaim(&layout, &id, false)?
        }
        Err(error) => return Err(error),
    };
    print_page(&report, args.get_flag("json"), None)
}

pub fn run(root: &Path, args: &ArgMatches) -> Result<()> {
    if let Some(("reclaim", reclaim)) = args.subcommand() {
        return space_reclaim(root, reclaim, args.get_flag("json"));
    }
    let layout = Layout::existing(root)?.ok_or(Fault::Missing)?;
    let key = Keyring::read(&layout)?;
    let store = Store::read(&layout)?;
    store.require_current_schema()?;
    let mut decoder = Decoder::new(std::env::current_exe()?)?;
    let mut report = storage::read(&store, &key, &layout, &mut decoder)?;
    store.close()?;
    // The active owner service can supply per-page Remote namespace allocation. A missing or
    // slow service leaves it unknown; storage reporting never starts a service.
    if layout.running().unwrap_or(false) {
        let until = std::time::Instant::now() + std::time::Duration::from_secs(1);
        for row in &mut report.pages {
            let Some(wait) = until.checked_duration_since(std::time::Instant::now()) else {
                break;
            };
            if let Ok(remote) = tmt_colab::storage_ipc::read(&layout, &row.page_id, wait) {
                row.apply_attachment_bytes(remote.attachments_bytes);
                row.copy_unreferenced(&remote);
            }
        }
    }
    let json_output = args.get_flag("json");
    let mut out = tmt_cli_style::stream::stdout(json_output);
    if json_output {
        writeln!(out, "{}", serde_json::to_string(&report)?)?;
    } else {
        writeln!(
            out,
            "SPACE  {}   space.db {} ({} free inside, returned on next cleanup)",
            tmt_cli_style::table::escape(&report.space),
            human(report.db_bytes),
            human(report.db_free_bytes)
        )?;
        writeln!(
            out,
            "PAGE                      CONTENT  HISTORY  FILES  FREEABLE"
        )?;
        for row in &report.pages {
            let title = row.title.as_deref().unwrap_or(&row.page_id);
            let title = tmt_cli_style::table::escape(title);
            let files = row
                .attachments_bytes
                .map(human)
                .unwrap_or_else(|| "—".into());
            writeln!(
                out,
                "{title:<25} {:>8} {:>8} {:>8} {:>8}",
                human(row.content_bytes),
                human(row.history_bytes),
                files,
                human(row.freeable.history)
            )?;
        }
        // Files no page refers to any more, and when they go (#5284).
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| {
                u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
            });
        for row in &report.pages {
            if let (Some(bytes), Some(at)) = (
                row.unused_attachment_bytes,
                row.unused_attachments_remove_at_ms,
            ) && bytes > 0
            {
                let title = row.title.as_deref().unwrap_or(&row.page_id);
                writeln!(
                    out,
                    "{}: {} not in use, removed {}",
                    tmt_cli_style::table::escape(title),
                    human(bytes),
                    crate::cli_management::last_edit_text(at, now.min(at))
                )?;
            }
        }
    }
    Ok(())
}

fn space_failure(
    report: &storage::SpaceReclaim,
) -> Result<Box<dyn std::error::Error + Send + Sync>> {
    let message = format!(
        "Cleanup stopped after {} pages. Freed {} before the error. Pages are unchanged.",
        report.pages.len(),
        report
            .freed
            .history
            .map(human)
            .unwrap_or_else(|| "unknown".into())
    );
    Ok(Box::new(crate::cli_management::ManagementFault {
        code: "COLAB_UNAVAILABLE",
        message,
        correlation: serde_json::to_value(report)?,
        source: None,
    }))
}

fn space_uncertain(
    report: &storage::SpaceReclaim,
    error: Box<dyn std::error::Error + Send + Sync>,
) -> Box<dyn std::error::Error + Send + Sync> {
    let mut correlation = serde_json::json!(report);
    correlation["freedBeforeUnknown"] = serde_json::json!(report.freed);
    correlation["freed"]["history"] = serde_json::Value::Null;
    let known = report
        .freed
        .history
        .map(human)
        .unwrap_or_else(|| "unknown".into());
    Box::new(crate::cli_management::ManagementFault {
        code: "COLAB_UNAVAILABLE",
        message: format!(
            "Cleanup stopped after {} completed pages (freed {known}); the current page outcome is unknown: {error}",
            report.pages.len()
        ),
        correlation,
        source: Some(error),
    })
}

fn space_reclaim(root: &Path, args: &ArgMatches, json_output: bool) -> Result<()> {
    let layout = Layout::existing(root)?.ok_or(Fault::Missing)?;
    let key = Keyring::read(&layout)?;
    let source = Store::read(&layout)?;
    source.require_current_schema()?;
    let pages = tmt_colab::inspection::all_page_ids(&source, &key)?;
    source.close()?;
    let dry = args.get_flag("dry-run");
    let mut report = storage::SpaceReclaim::new(dry);
    let lock = if dry {
        if layout.running()? {
            Err(StateFault::AlreadyServing.into())
        } else {
            Ok(None)
        }
    } else {
        layout.serve_lock().map(Some)
    };
    match lock {
        Ok(_lock) => {
            let mut store = if dry {
                Store::read(&layout)?
            } else {
                Store::write_existing(&layout)?
            };
            let mut decoder = Decoder::new(std::env::current_exe()?)?;
            for id in &pages {
                let entry = storage::reclaim(&mut store, &key, id, &mut decoder, dry)
                    .map_err(|error| space_uncertain(&report, error))?;
                let failed = entry.error.is_some();
                report.add(entry)?;
                if failed {
                    return Err(space_failure(&report)?);
                }
            }
            if !dry {
                store.reclaim_free_pages();
            }
            store.close()?;
        }
        Err(error) if error.downcast_ref::<StateFault>() == Some(&StateFault::AlreadyServing) => {
            for id in &pages {
                let entry = tmt_colab::storage_ipc::reclaim(&layout, id, dry)
                    .map_err(|error| space_uncertain(&report, error))?;
                let failed = entry.error.is_some();
                report.add(entry)?;
                if failed {
                    return Err(space_failure(&report)?);
                }
            }
        }
        Err(error) => return Err(error),
    }
    let mut out = tmt_cli_style::stream::stdout(json_output);
    if json_output {
        writeln!(out, "{}", serde_json::to_string(&report)?)?;
    } else if dry {
        writeln!(
            out,
            "would free {} across {} pages; nothing visible changes",
            human(report.freeable.history),
            report.pages.len()
        )?;
    } else {
        writeln!(
            out,
            "reclaimed {} across {} pages; pages unchanged",
            report
                .freed
                .history
                .map(human)
                .unwrap_or_else(|| "unknown".into()),
            report.pages.len()
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uncertain_batch_preserves_subtotal_without_claiming_a_total() {
        let mut report = storage::SpaceReclaim::new(false);
        report.freed.history = Some(42);
        let error = space_uncertain(&report, std::io::Error::other("lost reply").into());
        let fault = error
            .downcast_ref::<crate::cli_management::ManagementFault>()
            .unwrap();
        assert!(fault.correlation["freed"]["history"].is_null());
        assert_eq!(fault.correlation["freedBeforeUnknown"]["history"], 42);
        assert!(fault.message.contains("outcome is unknown"));
        assert!(fault.message.contains(&human(42)));
    }
}
