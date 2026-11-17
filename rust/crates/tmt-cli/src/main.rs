mod answer_command;
mod api_command;
mod appearance;
mod attach_command;
mod binding_command;
mod binding_error;
mod caller_context;
mod caller_session_command;
mod channel_command;
mod channel_server_command;
mod check_command;
mod completion;
mod completion_command;
mod config_command;
mod consent;
mod context_command;
mod discovery_command;
mod focus_command;
mod resume_command;
use tmt_adapters::delivery;
mod diagnostics;
mod driver_command;
#[cfg(test)]
mod driver_registry_tests;
mod driver_style;
mod exchange_command;
mod exchange_flow_command;
mod extension_command;
mod extension_hooks_command;
mod extension_install_command;
mod grammar;
mod guidance_command;
mod help_output;
mod hook_flush_command;
mod host_command;
mod identity_command;
mod identity_context;
mod init_command;
mod install_command;
mod install_guidance;
mod invocation;
mod mcp_command;
mod native_install_command;
mod native_progress;
mod native_upgrade_command;
mod notes_command;
mod output;
use tmt_adapters::pane_badge;
mod allowance_command;
mod consumption_sample_command;
mod database_compaction_command;
mod database_rename_command;
mod digest_hook_command;
mod orch_command;
mod parser;
mod profile_command;
mod provider_hook_command;
mod pty_serve_command;
mod reply_notice_command;
mod request_observer_command;
mod response_command;
mod room_command;
mod run_command;
mod send_now_command;
mod session_learning;
mod setup_command;
mod skill_refresh_command;
mod skill_reminder;
mod stop_command;
mod storage_command;
mod talk_command;
mod target;
mod tick_command;
mod uninstall_command;
mod workspace_command;
mod workspace_hook;
mod workspace_restore_command;
mod workspace_show_command;
mod workspace_snapshot_command;

#[cfg(test)]
mod cli_style_tests;

use std::io::{self, Write};
use std::process::ExitCode;

use invocation::{ExchangeOperation, Invocation, OutputMode};

fn main() -> ExitCode {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    let result = match parser::parse(&args) {
        Ok(parsed) => execute(parsed),
        Err(error) => parser_failure(&error).publish(error.mode),
    };
    match result {
        Ok(code) => ExitCode::from(code),
        Err(error) => {
            // Output-stream failures cannot reliably produce another document.
            let mut stderr = tmt_cli_style::stream::stderr();
            let terminal = stderr.terminal();
            let _ = tmt_cli_style::message::error(
                &mut stderr,
                terminal,
                &format!("Could not write CLI output: {error}"),
                None,
            );
            ExitCode::FAILURE
        }
    }
}

fn execute(parsed: invocation::Parsed) -> io::Result<u8> {
    // A host driver gets everything it needs in its request; a tmt it runs
    // does nothing, so a driver can neither recurse nor change TMT's state.
    if std::env::var_os(tmt_adapters::host::external::CALL_ENV).is_some()
        && !matches!(parsed.invocation, Invocation::Help(_) | Invocation::Version)
    {
        return failure(
            parsed.mode,
            "DRIVER_CALL_REFUSED",
            "tmt runs no command for a host driver; a driver gets what it needs in its request.",
        );
    }
    // A driver's pane IDs and targets are known once its syntax is registered.
    // Recovery inspection never participates in optional learning/delivery effects.
    if workspace_snapshot_command::eligible(&parsed.invocation) {
        tmt_adapters::host::external::register_approved();
        return workspace_snapshot_command::execute(&parsed.invocation, parsed.mode);
    }
    if let Invocation::Discover { host, socket } = &parsed.invocation {
        return tmt_cli_style::CliOutput::new(parsed.mode.json)
            .finish(discovery_command::run(host.as_deref(), socket.as_deref()));
    }
    if matches!(parsed.invocation, Invocation::GuardedBind { .. }) {
        return tmt_cli_style::CliOutput::new(parsed.mode.json)
            .finish(binding_command::prepare_guarded(parsed.invocation));
    }
    // The updater's frozen skill-refresh protocol owns its own path admission
    // and output. Driver registration would discover configuration first and
    // print a directory-move diagnostic before that protocol can silence it.
    if let Invocation::NativeUpgradeExtensions {
        plan,
        progress,
        complete: true,
    } = &parsed.invocation
    {
        return extension_install_command::upgrade_all::complete::execute(
            *plan,
            *progress,
            parsed.mode,
        );
    }
    if matches!(parsed.invocation, Invocation::NativeRefreshIntegrations) {
        return setup_command::refresh::execute(parsed.mode);
    }
    if matches!(
        parsed.invocation,
        Invocation::NativeRefreshSkills { managed: true }
    ) {
        return skill_refresh_command::execute(true, parsed.mode);
    }
    // The shipped Herdr driver is approved before its syntax is registered,
    // so this command already reads the pane it runs in.
    if skill_reminder::works_with_hosts(&parsed.invocation) {
        driver_command::approve_shipped_automatically();
    }
    tmt_adapters::host::external::register_approved();
    // Companions reach core through this executable, whatever name it has.
    tmt_adapters::core_executable::declare_core();
    appearance::configure(parsed.mode.json);
    let inspect_drift = skill_reminder::eligible_for_drift(&parsed);
    let driver_hint = skill_reminder::eligible_for_driver_hint(&parsed);
    let mode = parsed.mode;
    let refresh_workspace = workspace_command::eligible(&parsed.invocation);
    // This process may observe lifecycle changes for enabled extension hooks;
    // delivery runs after the command's own effects and output.
    tmt_adapters::extension_hooks::allow_capture();
    let learn_session = !matches!(
        parsed.invocation,
        Invocation::Help(_)
            | Invocation::Version
            | Invocation::ProviderHook { .. }
            | Invocation::DigestHook { .. }
            | Invocation::HookFlush { .. }
            | Invocation::ReplyNoticeWorker { .. }
            | Invocation::RequestObserver { .. }
            | Invocation::Mcp { .. }
            | Invocation::Api
            | Invocation::ApiSession
    );
    let code = dispatch(parsed);
    tmt_adapters::extension_hooks::deliver_pending();
    let code = code?;
    if learn_session {
        // Flush the user's result before any optional native/provider I/O.
        let _ = tmt_cli_style::stream::stdout(mode.json).flush();
        caller_session_command::observe();
    }
    if refresh_workspace {
        workspace_command::refresh(&mut tmt_cli_style::stream::stdout(mode.json));
    }
    // A Herdr pane without its driver: whatever the result, say how to
    // approve one. It replaces the passive drift line.
    if driver_hint && skill_reminder::present_driver_hint() {
        return Ok(code);
    }
    if code == 0 && inspect_drift {
        skill_reminder::present(skill_reminder::Outcome::None, mode, true);
    }
    Ok(code)
}

/// Bytes that shells and scripts read exactly: the version, completion
/// candidates and completion scripts. Never styled.
fn write_exact(
    write: impl FnOnce(&mut io::StdoutLock<'static>) -> io::Result<()>,
) -> io::Result<()> {
    write(&mut io::stdout().lock())
}

/// Advisory work follows a successfully written result, never a failed publication.
fn output_then_advisories(
    publish: impl FnOnce() -> io::Result<u8>,
    reminder: impl FnOnce(),
    refresh: impl FnOnce(),
) -> io::Result<u8> {
    let status = publish()?;
    reminder();
    refresh();
    Ok(status)
}

fn dispatch(parsed: invocation::Parsed) -> io::Result<u8> {
    let output = (parsed.invocation.output_boundary() == invocation::OutputBoundary::Paired)
        .then(|| tmt_cli_style::CliOutput::new(parsed.mode.json));
    match parsed.invocation {
        Invocation::Mcp { identity } => return mcp_command::execute(&identity),
        Invocation::Api => {
            return api_command::execute();
        }
        Invocation::ApiSession => {
            return api_command::execute_session();
        }
        Invocation::Extension {
            name,
            args,
            help,
            prefix,
        } => {
            return extension_command::execute(&name, &args, help, &prefix);
        }
        // The parser has already resolved and validated this public path.
        Invocation::Help(path) => {
            let discovered = if path.is_empty() {
                extension_command::discover()?
            } else {
                extension_command::Discovered::default()
            };
            let mut stdout = tmt_cli_style::stream::stdout(false);
            let terminal = stdout.terminal();
            let guidance = path.is_empty().then(|| install_guidance::read(None, &[]));
            if parsed.start_here
                && let Some(guidance) = &guidance
            {
                guidance.write("Start here", terminal, &mut stdout)?;
                writeln!(stdout)?;
            }
            help_output::write_with_inventory(
                &path,
                &discovered,
                guidance.as_ref(),
                terminal,
                &mut stdout,
            )?;
            if path.is_empty()
                && !parsed.mode.json
                && tmt_cli_style::Interaction::detect(parsed.mode.json).stdout
                && completion_command::needs_setup()
            {
                writeln!(
                    stdout,
                    "Tip: shell completion is not set up; run tmt completion to see the line to add."
                )?;
            }
        }
        Invocation::Version => {
            write_exact(|stdout| writeln!(stdout, "{}", env!("CARGO_PKG_VERSION")))?
        }
        Invocation::Complete(words) => write_exact(|stdout| completion::query(&words, stdout))?,
        Invocation::Completion { shell } => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(completion_command::run(shell.as_deref()));
        }
        Invocation::CompletionScript(shell) => {
            write_exact(|stdout| grammar::completion::generate(&shell, stdout))?;
        }
        Invocation::Discover { host, socket } => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(discovery_command::run(host.as_deref(), socket.as_deref()));
        }
        request @ Invocation::GuardedBind { .. } => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(binding_command::prepare_guarded(request));
        }
        Invocation::Config(request) => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(config_command::run(request));
        }
        request @ (Invocation::WorkspaceRestore { .. }
        | Invocation::WorkspaceShow { .. }
        | Invocation::WorkspaceSave { .. }
        | Invocation::WorkspaceList { .. }
        | Invocation::WorkspaceRemove { .. }) => {
            return workspace_snapshot_command::execute(&request, parsed.mode);
        }
        Invocation::ExtensionInstall(request) => {
            return extension_install_command::execute(request, parsed.mode);
        }
        Invocation::ExtensionHooks(request) => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(extension_hooks_command::run(request));
        }
        Invocation::Driver(request) => {
            return driver_command::execute(request, parsed.mode);
        }
        Invocation::Host(request) => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(host_command::run(request));
        }
        Invocation::Init => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(init_command::run());
        }
        Invocation::Run {
            host,
            name,
            command,
            resume,
            save,
            model,
            effort,
            channel,
        } => {
            let resume = resume.then(run_command::Resume::default);
            let options = tmt_adapters::runtime::launch_preset::LaunchSettings { model, effort };
            return run_command::execute(
                &name,
                &command,
                resume,
                save,
                &options,
                channel,
                host.as_deref(),
            );
        }
        Invocation::ChannelServer {
            harness,
            binding_id,
            generation,
            directory,
        } => {
            return channel_server_command::execute(&harness, &binding_id, &generation, &directory);
        }
        Invocation::PtyServe {
            directory,
            id,
            cols,
            rows,
            program,
            terminal,
        } => {
            return pty_serve_command::execute(&directory, &id, cols, rows, program, terminal);
        }
        Invocation::Channel(request) => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(channel_command::run(request));
        }
        Invocation::Resume {
            host,
            name,
            driver,
            move_running,
            fresh,
            show,
            forget_launch,
            model,
            effort,
            forget,
            retry,
            channel,
        } => {
            return resume_command::execute(resume_command::Request {
                host: host.as_deref(),
                name: name.as_deref(),
                show,
                forget_launch,
                forget,
                resume: run_command::Resume {
                    driver: driver.as_deref(),
                    retry,
                    move_running,
                    fresh,
                },
                options: tmt_adapters::runtime::launch_preset::LaunchSettings { model, effort },
                channel,
            });
        }
        Invocation::Learn { skill, reference } => {
            return guidance_command::execute(skill.as_deref(), reference.as_ref());
        }
        Invocation::Install {
            target,
            directory,
            force,
        } => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(install_command::run(
                    target.as_deref(),
                    directory.as_deref(),
                    force,
                ));
        }
        Invocation::Setup {
            provider,
            status: true,
            ..
        } => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(setup_command::status_report(provider.as_deref()));
        }
        Invocation::Setup {
            provider,
            status,
            remove,
            usage,
            yes,
        } => {
            return setup_command::execute(provider, status, remove, usage, yes, parsed.mode);
        }
        Invocation::ConsumptionSample => return consumption_sample_command::execute(),
        Invocation::AllowancePush { provider } => return allowance_command::execute(&provider),
        Invocation::DigestHook {
            provider,
            launch,
            worker,
            work_budget_ms,
        } => {
            return digest_hook_command::execute(
                &provider,
                launch.as_deref(),
                worker,
                work_budget_ms,
                parsed.legacy_hook,
            );
        }
        Invocation::ProviderHook {
            caller_session,
            activity_only,
            provider,
            worker,
            work_budget_ms,
        } => {
            if caller_session {
                return Ok(caller_session_command::worker(&provider, work_budget_ms));
            }
            return provider_hook_command::execute(
                &provider,
                worker,
                work_budget_ms,
                activity_only,
            );
        }
        Invocation::HookFlush { log_id } => return hook_flush_command::execute(&log_id),
        Invocation::ReplyNoticeWorker { batch_id, log_id } => {
            return reply_notice_command::execute(&batch_id, &log_id);
        }
        Invocation::RequestObserver { request_id } => {
            return request_observer_command::execute(&request_id);
        }
        Invocation::Identity(request) => {
            let report = match identity_command::run(request) {
                Ok(report) => report,
                Err(error) => {
                    return output
                        .as_ref()
                        .expect("paired output")
                        .finish::<identity_command::Report, _>(Err(error));
                }
            };
            let reminder = report.reminder();
            let status = output
                .as_ref()
                .expect("paired output")
                .finish::<_, crate::output::Failure>(Ok(&report))?;
            crate::skill_reminder::present(reminder, parsed.mode, true);
            return Ok(status);
        }
        Invocation::Room(request) => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(room_command::run(request));
        }
        Invocation::Tick(invocation::TickOperation::Status) => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(tick_command::status());
        }
        Invocation::Tick(operation) => return tick_command::execute(operation, parsed.mode),
        Invocation::Orch(request) => return orch_command::execute(request, parsed.mode),
        Invocation::NotesPath { identity } => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(notes_command::run(identity));
        }
        Invocation::ExchangeFlow {
            window_ms,
            bucket_ms,
        } => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(exchange_flow_command::run(
                    window_ms,
                    bucket_ms,
                    !parsed.mode.json,
                ));
        }
        Invocation::Exchange {
            identity,
            operation: operation @ ExchangeOperation::Listen { .. },
        } => {
            return exchange_command::execute(identity, operation, parsed.mode);
        }
        Invocation::Exchange {
            identity,
            operation,
        } => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(exchange_command::run(identity, operation));
        }
        request @ Invocation::Talk { .. } => {
            return talk_command::execute(request, parsed.mode);
        }
        request @ Invocation::TalkRemote { .. } => {
            return talk_command::remote::execute(request, parsed.mode);
        }
        request @ (Invocation::Role { .. } | Invocation::Preamble(_)) => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(profile_command::run(request));
        }
        Invocation::Check {
            target,
            lines,
            capture_only,
            expect_name,
        } => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(check_command::run(target, lines, capture_only, expect_name));
        }
        Invocation::Stop { name, close } => {
            return stop_command::execute(name, close, parsed.mode);
        }
        Invocation::Focus { target, into } => {
            return focus_command::execute(target, into, parsed.mode);
        }
        Invocation::FocusClient => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(focus_command::client());
        }
        Invocation::Attach {
            target,
            detach_others,
        } => {
            return attach_command::execute(target, detach_others, parsed.mode);
        }
        request @ (Invocation::Reply { .. } | Invocation::Result { .. }) => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(response_command::run(request));
        }
        request @ (Invocation::Inbox { .. } | Invocation::Answer { .. }) => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(answer_command::run(request));
        }
        request @ Invocation::SendNow { .. } => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(send_now_command::run(request));
        }
        Invocation::WhoamiContext => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(context_command::run());
        }
        request @ (Invocation::Bind { .. }
        | Invocation::BindMarked { .. }
        | Invocation::Whoami
        | Invocation::Unbind
        | Invocation::Remove { .. }
        | Invocation::Rename { .. }
        | Invocation::List { .. }) => {
            let report = match binding_command::prepare(request) {
                Ok(report) => report,
                Err(error) => {
                    return output
                        .as_ref()
                        .expect("paired output")
                        .finish::<binding_command::Presentation, _>(Err(error));
                }
            };
            return output_then_advisories(
                || {
                    output
                        .as_ref()
                        .expect("paired output")
                        .finish::<_, crate::output::Failure>(Ok(&report))
                },
                || crate::skill_reminder::present(report.reminder(), parsed.mode, true),
                || report.refresh(),
            );
        }
        Invocation::Upgrade {
            channel,
            exact,
            unpin,
            yes,
            allow_schema_ahead,
        } => {
            return native_upgrade_command::execute_with_schema_consent(
                channel,
                exact.as_deref(),
                unpin,
                yes,
                allow_schema_ahead,
                parsed.mode,
            );
        }
        Invocation::NativeUpgradeExtensions {
            plan,
            progress,
            complete,
        } => {
            if complete {
                return extension_install_command::upgrade_all::complete::execute(
                    plan,
                    progress,
                    parsed.mode,
                );
            }
            return extension_install_command::upgrade_all::execute(plan, progress, parsed.mode);
        }
        Invocation::NativeRefreshSkills { managed } => {
            return skill_refresh_command::execute(managed, parsed.mode);
        }
        Invocation::NativeRenameDatabase => {
            return database_rename_command::execute(parsed.mode);
        }
        Invocation::NativeCompactDatabase => {
            return database_compaction_command::execute(parsed.mode);
        }
        Invocation::Storage => {
            return output
                .as_ref()
                .expect("paired output")
                .finish(storage_command::run());
        }
        Invocation::NativeRefreshIntegrations => {
            return setup_command::refresh::execute(parsed.mode);
        }
        Invocation::Uninstall { purge, yes, prefix } => {
            return uninstall_command::execute(purge, yes, prefix.as_deref(), parsed.mode);
        }
        Invocation::NativeInstallHandoff { probe, version } => {
            return native_install_command::handoff(version, probe, parsed.mode);
        }
        Invocation::NativeSchema { source_sha } => {
            return native_install_command::schema(&source_sha, parsed.mode);
        }
        Invocation::NativeInstall {
            product,
            archive,
            manifest,
            prefix,
            channel,
            pin,
        } => {
            return native_install_command::execute(
                product,
                &archive,
                &manifest,
                &prefix,
                channel,
                pin,
                parsed.mode,
            );
        }
    }
    Ok(0)
}

fn failure(mode: OutputMode, code: &'static str, message: &str) -> io::Result<u8> {
    // Parse and existing configuration failures retain their exit-1 contract.
    output::Failure::new(code, message, 1).publish(mode)
}

fn parser_failure(error: &invocation::ParseError) -> output::Failure {
    // The hint is presentation-only: JSON retains the exact parser message and
    // existing fields, while human usage errors use the shared styled renderer.
    if !error.mode.json
        && error.code == "USAGE_ERROR"
        && let Some(hint) = &error.hint
    {
        let message = error
            .message
            .strip_suffix("For more information, try '--help'.\n")
            .unwrap_or(&error.message);
        return output::Failure::new(error.code, message, 1).suggestion(hint.clone());
    }
    output::Failure::new(error.code, &error.message, 1)
}

// Source-checked command samples for the printed-command guard.
#[cfg(test)]
pub(crate) const PRINTED_HINTS: &[crate::cli_style_tests::HintSpec] = &[
    crate::cli_style_tests::HintSpec::core(
        "Tip: shell completion is not set up; run tmt completion to see the line to add.",
        &[" to see the line to add."],
        &[],
    ),
    crate::cli_style_tests::HintSpec::skipped(
        "tmt runs no command for a host driver; a driver gets what it needs in its request.",
        "Executable or option reference in prose, not a full command suggestion.",
    ),
];

#[cfg(test)]
mod failure_tests {
    use super::*;

    #[test]
    fn binding_output_precedes_reminder_and_workspace_refresh() {
        let order = std::cell::RefCell::new(Vec::new());
        let status = output_then_advisories(
            || {
                order.borrow_mut().push("output");
                Ok(3)
            },
            || order.borrow_mut().push("reminder"),
            || order.borrow_mut().push("refresh"),
        )
        .unwrap();
        assert_eq!(status, 3);
        assert_eq!(*order.borrow(), ["output", "reminder", "refresh"]);
        order.borrow_mut().clear();
        let result = output_then_advisories(
            || Err(io::Error::other("closed")),
            || order.borrow_mut().push("reminder"),
            || order.borrow_mut().push("refresh"),
        );
        assert!(result.is_err());
        assert!(order.borrow().is_empty());
    }

    #[test]
    fn parser_hints_are_human_only_and_replace_claps_help_footer() {
        let message = "error: unexpected argument '--bad' found\n\nUsage: tmt [OPTIONS] [COMMAND]\n\nFor more information, try '--help'.\n";
        let hint = "Run tmt help to see the commands and options.".to_owned();
        let failure = |mode, code, hint| {
            parser_failure(&invocation::ParseError {
                mode,
                code,
                message: message.into(),
                hint,
            })
        };
        let json = failure(OutputMode { json: true }, "USAGE_ERROR", Some(hint.clone()));
        assert_eq!(
            json.document(),
            serde_json::json!({"error": {"code": "USAGE_ERROR", "message": message}})
        );
        let human = failure(OutputMode::default(), "USAGE_ERROR", Some(hint.clone()));
        let mut output = Vec::new();
        human
            .write_human(&mut output, tmt_cli_style::Terminal::PLAIN)
            .unwrap();
        let output = String::from_utf8(output).unwrap();
        assert!(output.ends_with("hint: Run tmt help to see the commands and options\n"));
        assert!(!output.contains("For more information"));
        assert_eq!(output.matches("hint:").count(), 1);
        assert!(output.contains("Usage: tmt [OPTIONS] [COMMAND]"));
        let other = failure(OutputMode::default(), "DRIVER_CALL_REFUSED", Some(hint));
        assert_eq!(
            other.document(),
            serde_json::json!({"error": {"code": "DRIVER_CALL_REFUSED", "message": message}})
        );
    }
}
