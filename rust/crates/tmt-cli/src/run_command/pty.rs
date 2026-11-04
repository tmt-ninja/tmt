//! Typed re-entry into the ordinary managed launcher on a new member PTY.
//! Only the supervisor is detached; run_bound keeps foreground ownership inside it.

use super::{RunRequest, diagnostic};
use crate::{invocation::ChannelMode, output::Failure};
use std::ffi::OsString;
use tmt_adapters::config::ConfigPaths;
use tmt_core::host::HostKind;

fn arguments(request: RunRequest<'_>) -> Vec<OsString> {
    let mut argv: Vec<OsString> = vec![
        if request.resume.is_some() {
            "resume".into()
        } else {
            "run".into()
        },
        "--host".into(),
        HostKind::pty().as_str().into(),
    ];
    match request.channel {
        ChannelMode::Disabled => argv.push("--no-channel".into()),
        ChannelMode::Required => argv.push("--channel".into()),
        ChannelMode::Default => {}
    }
    if let Some(resume) = request.resume {
        if resume.move_running {
            argv.push("--move".into());
        }
        if resume.retry {
            argv.push("--retry".into());
        }
        if resume.fresh {
            argv.push("--new".into());
        }
        if let Some(driver) = resume.driver {
            argv.extend(["--driver".into(), driver.into()]);
        }
        if let Some(model) = &request.options.model {
            argv.extend(["--model".into(), model.into()]);
        }
        if let Some(effort) = &request.options.effort {
            argv.extend(["--effort".into(), effort.into()]);
        }
    } else {
        if request.save {
            argv.push("--save".into());
        }
        // The member's own run applies them after the re-entry (#5564).
        if let Some(model) = &request.options.model {
            argv.extend(["--model".into(), model.into()]);
        }
        if let Some(effort) = &request.options.effort {
            argv.extend(["--effort".into(), effort.into()]);
        }
    }
    argv.extend(["--".into(), request.name.into()]);
    argv.extend_from_slice(request.command);
    argv
}

pub(super) fn start(request: RunRequest<'_>, paths: &ConfigPaths) -> Result<u8, Failure> {
    let executable = std::env::current_exe().map_err(|error| {
        Failure::new(
            "PTY_LAUNCH_FAILED",
            "No member was launched: the Core executable could not be located.",
            1,
        )
        .caused_by(error)
    })?;
    let started = match relaunch_kept(&executable, request, paths).unwrap_or_else(|| {
        tmt_adapters::pty::start_member(executable.as_os_str(), &arguments(request), paths)
    }) {
        Ok(started) => started,
        Err(tmt_adapters::pty::LaunchError::Exited { status, output }) => {
            let (code, outcome) = match status {
                tmt_adapters::pty::protocol::Exit::Code(code) => {
                    (code.clamp(0, 255) as u8, format!("exit status {code}"))
                }
                tmt_adapters::pty::protocol::Exit::Signal(signal) => (
                    (128 + signal).clamp(1, 255) as u8,
                    format!("signal {signal}"),
                ),
            };
            let message = format!(
                "The requested command ended during startup ({outcome}).{}",
                if output.trim().is_empty() {
                    String::new()
                } else {
                    format!("\n{}", output.trim())
                }
            );
            if code == 0 {
                diagnostic(&message);
                return Ok(0);
            }
            return Err(Failure::new("COMMAND_EXITED", message, code));
        }
        Err(error) => {
            let failure = match &error {
                tmt_adapters::pty::LaunchError::NotStarted(_) => Failure::new(
                    "PTY_LAUNCH_FAILED", "No member was launched: built-in host startup failed.", 1),
                tmt_adapters::pty::LaunchError::Unconfirmed {pane, ..} => Failure::new(
                    "PTY_LAUNCH_FAILED", "The built-in host launch was not confirmed; a member may have started. Do not blindly rerun.", 1)
                    .suggestion(format!("Inspect the pane first: tmt check -- {}", crate::output::shell_word(pane))),
                tmt_adapters::pty::LaunchError::Exited { .. } => unreachable!("handled above"),
                tmt_adapters::pty::LaunchError::Refused(reason) => Failure::new(
                    "PTY_LAUNCH_FAILED",
                    format!("No member was launched: its terminal refused ({reason})."),
                    1,
                ),
            };
            return Err(failure.caused_by(error));
        }
    };
    if let Some(warning) = &started.cleanup_warning {
        diagnostic(warning);
    }
    diagnostic(&format!(
        "started {} on host {} ({})",
        started.name,
        HostKind::pty().as_str(),
        started.pane
    ));
    // Resume keeps its existing return-after-confirmation contract. Only a new
    // interactive run takes over the caller's terminal; the managed launcher
    // inside the member PTY continues to own the provider's lifetime.
    if request.resume.is_none()
        && tmt_cli_style::Interaction::detect(false).view() == tmt_cli_style::Mode::Interactive
    {
        let prepared =
            crate::attach_command::prepare_launched(&started.identity_id, &started.binding_id)?;
        return crate::attach_command::execute_prepared(
            prepared,
            false,
            crate::invocation::OutputMode::default(),
        )
        .map_err(|error| {
            Failure::new(
                "ATTACH_FAILED",
                "The member started, but attachment output failed. The member was not stopped; inspect it before attaching again.",
                1,
            )
            .caused_by(error)
        });
    }
    Ok(0)
}

/// The member's terminal belongs to the member (#5988): when its supervisor kept the
/// terminal after the agent ended, a run or resume of that identity starts there, with the
/// same re-entry it would run in a new supervisor, rather than in a second terminal that
/// the kept one's binding would refuse. `None` is "no kept terminal": start a new one.
fn relaunch_kept(
    executable: &std::path::Path,
    request: RunRequest<'_>,
    paths: &ConfigPaths,
) -> Option<Result<tmt_adapters::pty::StartedMember, tmt_adapters::pty::LaunchError>> {
    use tmt_adapters::{host, pty::LaunchError, pty::protocol::RelaunchKind};
    let binding = {
        let storage = tmt_adapters::storage::Storage::open(&paths.database).ok()?;
        let identity = storage.resolve_identity(request.name).ok()??;
        storage.current_binding(&identity.id).ok()??
    };
    let terminal = host::member_terminal(&binding)?;
    if terminal.ended.is_none() && !terminal.shell {
        return None;
    }
    let program = std::iter::once(executable.as_os_str().to_owned())
        .chain(arguments(request))
        .map(|word| word.into_string().ok())
        .collect::<Option<Vec<_>>>()?;
    let kind = if request.resume.is_some_and(|resume| !resume.fresh) {
        RelaunchKind::Resume
    } else {
        RelaunchKind::New
    };
    let unconfirmed = |cause: String| LaunchError::Unconfirmed {
        pane: binding.pane_id.clone(),
        cause: std::io::Error::other(cause),
    };
    Some(match host::relaunch_member(&binding, kind, program) {
        Ok(Some(marker)) => tmt_adapters::pty::StartedMember::from_marker(
            &marker,
            binding.pane_id.clone(),
            binding.server.socket_path.clone(),
        )
        .map_err(|error| unconfirmed(error.to_string())),
        Ok(None) => Err(unconfirmed("the terminal answered without a launch".into())),
        Err(host::RelaunchError::Unsupported) => return None,
        Err(host::RelaunchError::Refused(reason)) => Err(LaunchError::Refused(reason)),
        Err(host::RelaunchError::Exited { status, output }) => {
            Err(LaunchError::Exited { status, output })
        }
        Err(host::RelaunchError::Unconfirmed(cause)) => Err(unconfirmed(cause)),
    })
}

#[cfg(test)]
pub(crate) const PRINTED_HINTS: &[crate::cli_style_tests::HintSpec] =
    &[crate::cli_style_tests::HintSpec::core(
        "Inspect the pane first: tmt check -- {}",
        &[""],
        &[],
    )];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{invocation::ChannelMode, run_command::Resume};
    use tmt_adapters::runtime::launch_preset::LaunchSettings;

    #[test]
    fn reentry_preserves_opaque_command_words_and_launch_policy() {
        let options = LaunchSettings::default();
        let command = vec![
            "fake-provider".into(),
            "a b".into(),
            "--host".into(),
            "literal".into(),
        ];
        let argv = arguments(RunRequest {
            name: "member",
            options: &options,
            command: &command,
            resume: None,
            save: true,
            channel: ChannelMode::Disabled,
        });
        assert_eq!(
            argv,
            vec![
                "run",
                "--host",
                HostKind::pty().as_str(),
                "--no-channel",
                "--save",
                "--",
                "member",
                "fake-provider",
                "a b",
                "--host",
                "literal"
            ]
            .into_iter()
            .map(OsString::from)
            .collect::<Vec<_>>()
        );
    }
    #[test]
    fn a_fresh_resume_reenters_with_new() {
        let argv = arguments(RunRequest {
            name: "member",
            options: &LaunchSettings::default(),
            command: &[],
            resume: Some(Resume {
                driver: None,
                retry: false,
                move_running: false,
                fresh: true,
            }),
            save: false,
            channel: ChannelMode::Disabled,
        });
        assert_eq!(
            argv,
            [
                "resume",
                "--host",
                HostKind::pty().as_str(),
                "--no-channel",
                "--new",
                "--",
                "member"
            ]
            .into_iter()
            .map(OsString::from)
            .collect::<Vec<_>>()
        );
    }
    /// `terminal.relaunch` on a kept terminal runs the same re-entry as a resume
    /// into a new supervisor, so its preflight and session learning are the same.
    #[test]
    fn a_kept_terminal_relaunch_runs_the_resume_reentry() {
        let id = "11111111-1111-4111-8111-111111111111";
        for fresh in [false, true] {
            let argv = arguments(RunRequest {
                name: id,
                options: &LaunchSettings::default(),
                command: &[],
                resume: Some(Resume {
                    driver: None,
                    retry: false,
                    move_running: false,
                    fresh,
                }),
                save: false,
                channel: ChannelMode::Default,
            });
            assert_eq!(
                argv,
                tmt_adapters::pty::relaunch_arguments(id, fresh)
                    .into_iter()
                    .map(OsString::from)
                    .collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn resume_reentry_keeps_driver_move_retry_and_model_preferences() {
        let options = LaunchSettings {
            model: Some("model".into()),
            effort: Some("high".into()),
        };
        let argv = arguments(RunRequest {
            name: "member",
            options: &options,
            command: &[],
            resume: Some(Resume {
                driver: Some("driver"),
                retry: true,
                move_running: true,
                fresh: false,
            }),
            save: false,
            channel: ChannelMode::Default,
        });
        assert_eq!(
            argv,
            vec![
                "resume",
                "--host",
                HostKind::pty().as_str(),
                "--move",
                "--retry",
                "--driver",
                "driver",
                "--model",
                "model",
                "--effort",
                "high",
                "--",
                "member"
            ]
            .into_iter()
            .map(OsString::from)
            .collect::<Vec<_>>()
        );
    }
}
