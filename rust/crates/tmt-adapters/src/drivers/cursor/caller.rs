//! Documentation-derived, conservative CLI ancestry; no provider environment or files.

#[cfg(test)]
mod tests;

use crate::process::{CommandRunner, ancestry::AncestryError, ps::query_ps};
use std::{
    path::Path,
    time::{Duration, Instant},
};
use tmt_core::{
    binding::session::HarnessId,
    driver::{
        ActionResult,
        caller::{HostAttribution, RuntimeCaller},
    },
};

pub(super) fn identify_caller<R: CommandRunner>(
    runner: &R,
    process_id: u32,
) -> ActionResult<RuntimeCaller, AncestryError> {
    let deadline = Instant::now() + Duration::from_secs(3);
    let host = match observe(runner, process_id, deadline) {
        Ok(Some(host)) => host,
        Ok(None) => return ActionResult::Unsupported,
        Err(error) => return ActionResult::Failed(error),
    };
    ActionResult::Completed(RuntimeCaller {
        harness: HarnessId::new(super::NAME).expect("built-in driver ID"),
        // Hook IDs are not documented as fresh shell-child markers.
        session: None,
        host,
    })
}

fn observe<R: CommandRunner>(
    runner: &R,
    process_id: u32,
    deadline: Instant,
) -> Result<Option<HostAttribution>, AncestryError> {
    let chain = crate::process::ancestry::command_chain(runner, process_id, deadline)?;
    let mut ancestors = chain.iter().filter(|(_, executable)| {
        Path::new(executable)
            .file_name()
            .is_some_and(|name| name == super::EXECUTABLE)
    });
    let Some((pid, executable)) = ancestors.next() else {
        return Ok(None);
    };
    if ancestors.next().is_some() {
        return Ok(Some(HostAttribution::Ambiguous));
    }
    let output = query_ps(
        runner,
        &[
            "-o".into(),
            "args=".into(),
            "-p".into(),
            pid.to_string().into(),
        ],
        deadline,
        16384,
    )
    .map_err(AncestryError::Command)?;
    let args = std::str::from_utf8(&output.stdout)
        .map_err(|_| AncestryError::Unavailable)?
        .trim();
    if args.is_empty() {
        return Err(AncestryError::Unavailable);
    }
    let tail = command_tail(args, executable);
    Ok(Some(if tail.is_some_and(interactive) {
        HostAttribution::Independent
    } else {
        HostAttribution::Ambiguous
    }))
}

fn command_tail<'a>(args: &'a str, executable: &str) -> Option<&'a str> {
    args.strip_prefix(executable)
        .filter(|tail| tail.is_empty() || tail.starts_with(char::is_whitespace))
        .or_else(|| {
            let split = args.find(char::is_whitespace).unwrap_or(args.len());
            (Path::new(&args[..split]).file_name()? == super::EXECUTABLE).then_some(&args[split..])
        })
}

/// `ps args=` loses quoting. Unknown modes/options and ambiguous positional input
/// therefore stay fenced; this is not a second provider argument parser.
fn interactive(tail: &str) -> bool {
    let mut words = tail.split_whitespace().peekable();
    // These modes can serve other clients or run without this terminal's input.
    if words
        .clone()
        .any(|word| matches!(word, "acp" | "worker" | "background" | "server" | "daemon"))
    {
        return false;
    }
    let explicit = matches!(words.peek(), Some(&"agent" | &"resume"));
    if explicit {
        words.next();
    }
    while let Some(word) = words.next() {
        let (flag, inline) = word
            .split_once('=')
            .map_or((word, None), |(a, b)| (a, Some(b)));
        match flag {
            "--continue" | "--plan" if inline.is_none() => {}
            "--resume" => {
                if let Some(value) = inline {
                    if value.is_empty() {
                        return false;
                    }
                } else if words.peek().is_some_and(|value| !value.starts_with('-')) {
                    words.next();
                }
            }
            "--model" | "--workspace" | "--mode" | "--sandbox" => {
                let Some(value) = inline.or_else(|| words.next()) else {
                    return false;
                };
                if value.is_empty() || value.starts_with('-') {
                    return false;
                }
                if flag == "--mode" && !matches!(value, "plan" | "ask") {
                    return false;
                }
                if flag == "--sandbox" && !matches!(value, "enabled" | "disabled") {
                    return false;
                }
            }
            _ if explicit && !word.starts_with('-') => {}
            _ => return false,
        }
    }
    true
}
