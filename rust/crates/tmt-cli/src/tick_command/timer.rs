//! Whole-plan consent stays in the CLI; adapters own user-unit file policy.
use super::*;
use tmt_adapters::{
    process::UnixCommandRunner,
    tick::timer::{Action, Plan},
};
fn failure(error: io::Error) -> Failure {
    Failure::new("TICK_TIMER_UNCONFIRMED", "The user timer action was not confirmed. Inspect its files and user manager before retrying; effects may already have occurred.",1).caused_by(error)
}
fn publish(
    out: &mut tmt_cli_style::stream::Stream<impl Write>,
    mode: OutputMode,
    value: &Value,
) -> io::Result<()> {
    if mode.json {
        serde_json::to_writer(&mut *out, value)?;
    } else {
        serde_json::to_writer_pretty(&mut *out, value)?;
    }
    writeln!(out)?;
    out.flush()
}
pub(super) fn execute(
    paths: &ConfigPaths,
    action: Action,
    yes: bool,
    mode: OutputMode,
) -> io::Result<u8> {
    let run = || -> Result<(), Failure> {
        let executable = std::env::current_exe().map_err(failure)?;
        let discovered = Plan::discover(&paths.global_dir, &executable).map_err(failure)?;
        let plan = if action == Action::Remove {
            discovered.for_removal().map_err(failure)?
        } else {
            discovered
        };
        let mut out = tmt_cli_style::stream::stdout(mode.json);
        if matches!(action, Action::Install | Action::Remove) {
            if !mode.json {
                publish(&mut out, mode, &plan.preview()).map_err(failure)?;
            }
            if !crate::consent::ask(
                &mut out,
                yes,
                mode,
                crate::consent::Consent {
                    code: "TICK_TIMER_CONSENT_REQUIRED",
                    refusal: "Review tmt tick timer preview, then explicitly approve install or remove with --yes or at an interactive terminal.",
                    question: if action == Action::Install {
                        "Install these user timer files and register the finite minute tick"
                    } else {
                        "Stop the owned user timer and remove only its unchanged generated files"
                    },
                    declined: "No timer changes made.",
                },
                failure,
            )? {
                return Ok(());
            }
        }
        let value = match action {
            Action::Preview => plan.preview(),
            Action::Status => plan.status(&UnixCommandRunner).map_err(failure)?,
            Action::Install | Action::Remove => {
                plan.apply(action, &UnixCommandRunner).map_err(failure)?
            }
        };
        publish(&mut out, mode, &value).map_err(failure)
    };
    match run() {
        Ok(()) => Ok(0),
        Err(error) => error.publish(mode),
    }
}
