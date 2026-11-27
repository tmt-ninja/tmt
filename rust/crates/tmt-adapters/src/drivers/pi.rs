//! Pi coding agent (`pi`): descriptor, file locations, runtime, per-launch
//! extension materialization, hook wire mapping, and bounded JSONL transcript
//! parsing. Payloads describe observations, never bindings.

mod caller;
mod caller_session;
mod channel;
pub mod user_extension;

use crate::process::CommandRunner;
pub use crate::runtime::hook_protocol::{CONTEXT_LIMIT, HOOK_INPUT_LIMIT};
use serde::Deserialize;
use std::{
    ffi::OsString,
    fs, io,
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tmt_core::binding::session::{
    BindingSessionState, ObservedSessionKey, ProviderSessionId, RuntimeLiveness, RuntimeMode,
    RuntimeState, SessionTransition,
};
use tmt_core::endpoint::ProcessIncarnation;

const NAME: &str = tmt_core::driver::descriptor::PI.name;
const MIN_VERSION: (u64, u64, u64) = (1, 3, 0);
// Audited normal-input buffering before session_start (#6447).
const STARTUP_IDLE_VERSION: (u64, u64, u64) = (1, 5, 2);
const VERSION_TIMEOUT: Duration = Duration::from_secs(3);
const EXTENSION_FILE_NAME: &str = "tmt-pi-extension.mjs";
const EMBEDDED_EXTENSION: &str = include_str!("pi/tmt-pi-extension.mjs");

/// Pi has one runtime mode.
pub const MODE_DEFAULT: &str = "default";

pub static DRIVER: super::DriverDefinition = super::DriverDefinition {
    descriptor: &tmt_core::driver::descriptor::PI,
    identify_caller: Some(identify_caller),
    env: &["PI_CODING_AGENT_DIR"],
    locate,
    runtime: Some(super::Runtime {
        session_env: &["PI_CODING_AGENT", "PI_SESSION_ID"],
        driver: || Box::new(PiRuntime),
        lifecycle: || Box::new(PiLifecycle),
        channel: Some(|| Box::new(channel::PiChannel)),
    }),
};

fn identify_caller() -> tmt_core::driver::ActionResult<
    tmt_core::driver::caller::RuntimeCaller,
    crate::process::ancestry::AncestryError,
> {
    use tmt_core::driver::Driver;
    caller::PiCaller::new(
        &crate::process::UnixCommandRunner,
        caller::CallerEnvironment::current(),
    )
    .identify_caller()
}

fn agent_dir(environment: &crate::skill_installation::ProviderEnvironment) -> PathBuf {
    let home = environment.home();
    match environment.var("PI_CODING_AGENT_DIR") {
        None => home.join(".pi/agent"),
        Some(configured) if configured == Path::new("~") => home.to_path_buf(),
        Some(configured) => match configured.strip_prefix("~/") {
            Ok(relative) => home.join(relative),
            Err(_) => environment.resolve(configured),
        },
    }
}

fn sessions_root(environment: &crate::skill_installation::ProviderEnvironment) -> PathBuf {
    agent_dir(environment).join("sessions")
}

fn locate(environment: &crate::skill_installation::ProviderEnvironment) -> super::Locations {
    let directory = agent_dir(environment);
    super::Locations {
        skills: directory.join("skills"),
        config_dirs: vec![directory],
        legacy_skills: Vec::new(),
        hook_settings: None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PiObservation {
    pub session: ProviderSessionId,
    /// The model the provider reported for this event, when concrete.
    pub model: Option<String>,
    pub transition: SessionTransition,
    pub starting: bool,
    pub startup_ready: bool,
}

impl PiObservation {
    pub fn propose(
        &self,
        current: &BindingSessionState,
        incarnation: &ProcessIncarnation,
        previous_liveness: RuntimeLiveness,
    ) -> Option<BindingSessionState> {
        let key = ObservedSessionKey {
            incarnation: incarnation.clone(),
            provider_session: Some(self.session.clone()),
        };
        if !self.starting {
            return current.transition(&key, self.transition, None);
        }
        if let Some(previous) = &current.key {
            if previous.incarnation != *incarnation {
                if previous_liveness != RuntimeLiveness::Gone
                    && !(previous_liveness == RuntimeLiveness::Alive
                        && current.last_transition == Some(SessionTransition::Ended))
                {
                    return None;
                }
            } else {
                if current.state == RuntimeState::Ended {
                    return None;
                }
                if current.state == RuntimeState::Unknown
                    && current.last_transition == Some(SessionTransition::Ended)
                {
                    return current.admit(key, self.transition, RuntimeLiveness::Alive);
                }
                if self.transition == SessionTransition::Started {
                    return current.admit(key, self.transition, RuntimeLiveness::Alive);
                }
                if matches!(
                    self.transition,
                    SessionTransition::Cleared
                        | SessionTransition::Resumed
                        | SessionTransition::Forked
                ) && previous_liveness == RuntimeLiveness::Alive
                {
                    // Pi has no preliminary SessionEnd for new/resume/fork: a live
                    // session_start on the same verified process switches directly to Running
                    // with the new provider session recorded in the binding key.
                    return Some(BindingSessionState {
                        plain_program: None,
                        start_refusal: None,
                        launch_owner: current.launch_owner.clone(),
                        key: Some(key),
                        last_transition: Some(self.transition),
                        state: RuntimeState::Running,
                    });
                }
                return None;
            }
        }
        current.admit(key, self.transition, RuntimeLiveness::Alive)
    }
}

impl crate::runtime::lifecycle::LifecycleObservation for PiObservation {
    fn startup_ready(&self) -> bool {
        self.startup_ready
    }
    fn session(&self) -> &ProviderSessionId {
        &self.session
    }

    fn driver_state(
        &self,
        previous: Option<&tmt_core::binding::session::DriverState>,
        now_ms: u64,
    ) -> Option<tmt_core::binding::session::DriverState> {
        if self.transition == SessionTransition::Compacted {
            return crate::runtime::driver_state::after_compaction(
                self.model.as_deref(),
                previous,
                now_ms,
            );
        }
        crate::runtime::driver_state::after_start(self.model.as_deref(), None, previous, now_ms)
    }

    fn starting(&self) -> bool {
        self.starting
    }

    fn transition(&self) -> Option<SessionTransition> {
        Some(self.transition)
    }

    fn propose(
        &self,
        current: &BindingSessionState,
        process: &ProcessIncarnation,
        previous: RuntimeLiveness,
        _: crate::runtime::lifecycle::HostEvidence,
        _: bool,
    ) -> Option<BindingSessionState> {
        PiObservation::propose(self, current, process, previous)
    }
}

#[derive(Deserialize)]
struct Payload {
    event: String,
    session_id: String,
    #[serde(default)]
    session_file: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    startup_ready: bool,
    #[serde(default)]
    idle: bool,
    #[serde(default)]
    aborted: bool,
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    final_text: Option<String>,
    #[serde(default)]
    final_text_bytes: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookInputError {
    TooLarge,
    Invalid,
}

fn parse_payload(bytes: &[u8]) -> Result<(Payload, ProviderSessionId), HookInputError> {
    if bytes.len() > HOOK_INPUT_LIMIT {
        return Err(HookInputError::TooLarge);
    }
    let payload: Payload = serde_json::from_slice(bytes).map_err(|_| HookInputError::Invalid)?;
    let session =
        ProviderSessionId::new(&payload.session_id).map_err(|_| HookInputError::Invalid)?;
    Ok((payload, session))
}

fn is_placeholder_model(model: &str) -> bool {
    model.eq_ignore_ascii_case("unknown")
        || model.eq_ignore_ascii_case("auto")
        || model.eq_ignore_ascii_case("default")
}

fn concrete_model(raw: Option<&str>) -> Option<String> {
    let model = raw?.trim();
    (!model.is_empty()
        && !is_placeholder_model(model)
        && crate::runtime::driver_state::valid_model(model))
    .then(|| model.to_owned())
}

pub fn decode_hook(bytes: &[u8]) -> Result<PiObservation, HookInputError> {
    let (payload, session) = parse_payload(bytes)?;
    let model = concrete_model(payload.model.as_deref());
    let (transition, starting) = match payload.event.as_str() {
        "session_start" => {
            let transition = match payload.reason.as_deref() {
                Some("resume") => SessionTransition::Resumed,
                Some("new") => SessionTransition::Cleared,
                Some("fork") => SessionTransition::Forked,
                Some(_) | None => SessionTransition::Started,
            };
            (transition, true)
        }
        "session_shutdown" => (SessionTransition::Ended, false),
        "before_agent_start" | "agent_settled" | "ui_prompt_start" | "ui_prompt_end"
        | "model_select" => (SessionTransition::Started, false),
        _ => return Err(HookInputError::Invalid),
    };
    let startup_ready =
        starting && payload.reason.as_deref() == Some("startup") && payload.startup_ready;
    Ok(PiObservation {
        startup_ready,
        session,
        model,
        transition,
        starting,
    })
}

fn parse_semver(output: &str) -> Option<(u64, u64, u64)> {
    let token = output
        .split_whitespace()
        .find(|word| word.bytes().any(|b| b.is_ascii_digit()))?;
    let trimmed = token.strip_prefix('v').unwrap_or(token);
    let core = trimmed.split(['-', '+']).next()?;
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

fn check_version(runner: &dyn CommandRunner, executable: &OsString) -> io::Result<bool> {
    let args = [OsString::from("--version")];
    let output = runner
        .execute(crate::process::CommandRequest {
            program: executable.as_os_str(),
            args: &args,
            input: &[],
            deadline: Instant::now() + VERSION_TIMEOUT,
            max_output_bytes: 1024,
        })
        .map_err(|error| {
            io::Error::other(format!(
                "Failed to check pi version for lifecycle hooks: {error}"
            ))
        })?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let version = parse_semver(&stdout).ok_or_else(|| {
        io::Error::other(format!(
            "Unrecognized `pi --version` output ({:?}); lifecycle hooks require pi >= 1.3.0.",
            stdout.trim()
        ))
    })?;
    if version < MIN_VERSION {
        return Err(io::Error::other(format!(
            "pi {}.{}.{} is older than 1.3.0; lifecycle hooks require pi >= 1.3.0.",
            version.0, version.1, version.2
        )));
    }
    let stable_floor = stdout
        .split_whitespace()
        .find(|word| word.bytes().any(|byte| byte.is_ascii_digit()))
        .is_some_and(|word| !word.split('+').next().unwrap_or(word).contains('-'));
    Ok(version > STARTUP_IDLE_VERSION || (version == STARTUP_IDLE_VERSION && stable_floor))
}

fn extension_up_to_date(path: &Path, expected: &[u8]) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if !metadata.is_file()
        || metadata.uid() != nix::unistd::geteuid().as_raw()
        || metadata.permissions().mode() & 0o777 != 0o600
    {
        return false;
    }
    fs::read(path).is_ok_and(|bytes| bytes == expected)
}

fn render_extension(launcher: &str, startup_ready: bool) -> io::Result<String> {
    let quoted = serde_json::to_string(launcher).map_err(io::Error::other)?;
    Ok(EMBEDDED_EXTENSION
        .replace("__TMT_HOOK_BIN__", &quoted)
        .replace(
            "__TMT_STARTUP_READY__",
            if startup_ready { "true" } else { "false" },
        ))
}

fn materialize_extension(
    state_directory: &Path,
    launcher: &str,
    startup_ready: bool,
) -> io::Result<PathBuf> {
    let pi_dir = state_directory.join(NAME);
    crate::private_file::ensure_private_directory(&pi_dir)?;
    // Keep both immutable capability variants: an older concurrent launch must
    // not replace the bridge a newer process has yet to load.
    let path = pi_dir.join(if startup_ready {
        "tmt-pi-extension-ready.mjs"
    } else {
        EXTENSION_FILE_NAME
    });
    let content = render_extension(launcher, startup_ready)?;
    if !extension_up_to_date(&path, content.as_bytes()) {
        crate::private_file::replace(&path, content.as_bytes())?;
    }
    Ok(path)
}

fn prepare_launch_with_runner(
    plan: &crate::runtime::hook_protocol::LaunchHooks<'_>,
    runner: &dyn CommandRunner,
) -> io::Result<crate::runtime::RuntimeCommand> {
    let launcher = plan
        .tmt
        .to_str()
        .filter(|path| Path::new(path).is_absolute() && !path.chars().any(char::is_control))
        .ok_or_else(|| io::Error::other("Invalid hook launcher."))?;
    if !plan.launch.valid() {
        return Err(io::Error::other("Invalid hook launch coordinates."));
    }
    let state_directory = plan
        .state_directory
        .ok_or_else(|| io::Error::other("Missing state directory for pi extension."))?;
    let startup_ready =
        check_version(runner, &plan.command.executable)? && plan.launch.startup_input;
    let extension_path = materialize_extension(state_directory, launcher, startup_ready)?;
    let mut command = plan.command.clone();
    let boundary = command
        .args
        .iter()
        .position(|arg| arg == "--")
        .unwrap_or(command.args.len());
    let already_present = command.args[..boundary].windows(2).any(|pair| {
        matches!(pair[0].to_str(), Some("--extension" | "-e"))
            && pair[1] == extension_path.as_os_str()
    }) || command.args[..boundary].iter().any(|arg| {
        arg.to_str()
            .and_then(|s| s.strip_prefix("--extension="))
            .is_some_and(|p| Path::new(p) == extension_path)
    });
    if !already_present {
        command.args.splice(
            boundary..boundary,
            ["--extension".into(), extension_path.into_os_string()],
        );
    }
    Ok(command)
}

/// Pi session JSONL (`docs/session-format.md`): `type == "message"` with
/// `message.role == "assistant"`, or `type == "usage"`.
fn transcript_usage(line: &str) -> Option<u64> {
    let entry: serde_json::Value = serde_json::from_str(line).ok()?;
    let usage = match entry.get("type").and_then(serde_json::Value::as_str)? {
        "message" => {
            let message = entry.get("message")?;
            if message.get("role").and_then(serde_json::Value::as_str) != Some("assistant") {
                return None;
            }
            message.get("usage")?
        }
        "usage" => entry.get("usage")?,
        _ => return None,
    };
    if let Some(total) = usage.get("totalTokens").and_then(serde_json::Value::as_u64) {
        return Some(total);
    }
    let input = usage.get("input").and_then(serde_json::Value::as_u64)?;
    let output = usage.get("output").and_then(serde_json::Value::as_u64)?;
    let cache_read = usage
        .get("cacheRead")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let cache_write = usage
        .get("cacheWrite")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    input
        .checked_add(output)?
        .checked_add(cache_read)?
        .checked_add(cache_write)
}

/// Outer `Some` marks the newest assistant message even when it carries no text
/// so tool-only or empty turns never resurrect an older turn's final response.
fn transcript_final_text(line: &str) -> Option<Option<tmt_core::responses::FinalText>> {
    let entry: serde_json::Value = serde_json::from_str(line).ok()?;
    if entry.get("type").and_then(serde_json::Value::as_str) != Some("message") {
        return None;
    }
    let message = entry.get("message")?;
    if message.get("role").and_then(serde_json::Value::as_str) != Some("assistant") {
        return None;
    }
    let text = (|| {
        let blocks = message.get("content")?.as_array()?;
        let mut joined = String::new();
        for block in blocks {
            if block.get("type").and_then(serde_json::Value::as_str) == Some("text")
                && let Some(text) = block.get("text").and_then(serde_json::Value::as_str)
                && !text.is_empty()
            {
                if !joined.is_empty() {
                    joined.push('\n');
                }
                joined.push_str(text);
            }
        }
        (!joined.is_empty())
            .then(|| tmt_core::responses::FinalText::new(&joined))
            .flatten()
    })();
    Some(text)
}

fn find_session_file(root: &Path, session: &ProviderSessionId) -> Option<PathBuf> {
    let suffix = format!("_{}.jsonl", session.as_str());
    let entries = fs::read_dir(root).ok()?;
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for dir_entry in entries.flatten() {
        let project_dir = dir_entry.path();
        let Ok(meta) = fs::symlink_metadata(&project_dir) else {
            continue;
        };
        if !meta.is_dir() {
            continue;
        }
        let Ok(files) = fs::read_dir(&project_dir) else {
            continue;
        };
        for file_entry in files.flatten() {
            let path = file_entry.path();
            if path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|name| name.ends_with(&suffix))
                && let Ok(fmeta) = fs::symlink_metadata(&path)
                && fmeta.is_file()
            {
                let modified = fmeta
                    .modified()
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                if best.as_ref().is_none_or(|(prev, _)| modified > *prev) {
                    best = Some((modified, path));
                }
            }
        }
    }
    best.map(|(_, path)| path)
}

struct PiRuntime;

impl tmt_core::driver::Driver for PiRuntime {
    type Target = tmt_core::binding::BindingEntry;
    type Error = crate::runtime::RuntimeError;
    type Launch = crate::runtime::RuntimeCommand;

    fn claims(&self, command: &str) -> Option<tmt_core::binding::session::HarnessId> {
        crate::runtime::claim_named(command, NAME)
    }

    fn send(
        &mut self,
        target: &Self::Target,
        message: &str,
    ) -> tmt_core::driver::ActionResult<
        tmt_core::driver::DeliveryAcceptance,
        tmt_core::driver::SendFailure<Self::Error>,
    > {
        channel::send(target, message, None)
    }

    fn send_advisory(
        &mut self,
        target: &Self::Target,
        message: &str,
    ) -> tmt_core::driver::ActionResult<
        tmt_core::driver::DeliveryAcceptance,
        tmt_core::driver::SendFailure<Self::Error>,
    > {
        let connection_id = uuid::Uuid::new_v4().to_string();
        self.send_request(
            target,
            message,
            &connection_id,
            false,
            Some(crate::request_runtime::wall_time_ms() + 30_000),
        )
    }

    fn send_request(
        &mut self,
        target: &Self::Target,
        message: &str,
        attempt: &str,
        urgent: bool,
        deadline: Option<u64>,
    ) -> tmt_core::driver::ActionResult<
        tmt_core::driver::DeliveryAcceptance,
        tmt_core::driver::SendFailure<Self::Error>,
    > {
        channel::send(target, message, Some((attempt, urgent, deadline)))
    }

    fn resume(
        &mut self,
        resume: tmt_core::driver::HarnessResume<'_>,
    ) -> tmt_core::driver::ActionResult<Self::Launch, Self::Error> {
        use tmt_core::driver::ActionResult;
        let model = match crate::runtime::first_party_resume(&resume, NAME, &[MODE_DEFAULT]) {
            ActionResult::Completed(model) => model,
            ActionResult::Unsupported => return ActionResult::Unsupported,
            ActionResult::Failed(error) => return ActionResult::Failed(error),
        };
        let mut args = vec!["--session".into(), resume.session.as_str().into()];
        if let Some(model) = concrete_model(model.as_deref()) {
            args.extend(["--model".into(), model.into()]);
        }
        ActionResult::Completed(crate::runtime::RuntimeCommand {
            executable: NAME.into(),
            args,
        })
    }
}

pub struct PiLifecycle;

impl crate::runtime::lifecycle::RuntimeLifecycle for PiLifecycle {
    fn startup_input(&self, command: &crate::runtime::RuntimeCommand) -> bool {
        crate::runtime::launch_preset::empty_prompt(
            &command.args,
            &[
                "--session",
                "--model",
                "--thinking",
                "--provider",
                "--tools",
                "--extension",
                "-e",
                "--agent-dir",
            ],
            &[
                "--continue",
                "-c",
                "--resume",
                "-r",
                "--no-skills",
                "--no-extensions",
            ],
        )
    }

    fn launch_settings(&self, args: &[OsString]) -> crate::runtime::launch_preset::LaunchSettings {
        crate::runtime::launch_preset::flags(args, &["--model"], &["--thinking"], &[], false)
    }

    fn resume_settings(
        &self,
        command: &mut crate::runtime::RuntimeCommand,
        settings: &crate::runtime::launch_preset::LaunchSettings,
    ) -> bool {
        if !settings.valid() {
            return false;
        }
        if let Some(model) = &settings.model {
            if let Some(index) = command.args.iter().position(|arg| arg == "--model") {
                command.args.drain(index..index + 2);
            }
            command.args.extend(["--model".into(), model.into()]);
        }
        if let Some(effort) = &settings.effort {
            if let Some(index) = command.args.iter().position(|arg| arg == "--thinking") {
                command.args.drain(index..index + 2);
            }
            command.args.extend(["--thinking".into(), effort.into()]);
        }
        true
    }

    fn initial_message(&self, command: &mut crate::runtime::RuntimeCommand, message: &str) -> bool {
        command.args.extend(["--".into(), message.into()]);
        true
    }

    fn caller_refusal(
        &self,
        name: Option<&str>,
    ) -> Option<crate::runtime::lifecycle::RuntimeRefusal> {
        let fix = format!("tmt run {} {NAME}", name.unwrap_or("<name>"));
        Some(crate::runtime::lifecycle::RuntimeRefusal {
            reason: "pi-shared-rpc",
            why: "This Pi process runs without a dedicated terminal pane (`pi-rpc` / `--mode rpc`), so TMT cannot tell which pane commands come from.",
            consequence: "This agent can still receive messages, but it cannot name itself, send as itself, or reply; anyone waiting on it will time out.",
            instruction: format!("Exit this Pi, then start it with:  {fix}"),
            fix,
        })
    }

    fn caller_session(&self) -> Option<crate::runtime::lifecycle::CallerSession> {
        caller_session::coordinates(std::env::var_os("PI_SESSION_ID").as_deref())
    }

    fn caller_session_observation(
        &self,
        coordinates: &crate::runtime::lifecycle::CallerSession,
        environment: &crate::skill_installation::ProviderEnvironment,
        deadline: Instant,
    ) -> Result<
        Box<dyn crate::runtime::lifecycle::LifecycleObservation>,
        crate::runtime::lifecycle::CallerSessionRefusal,
    > {
        caller_session::verify_header(coordinates, environment, deadline)?;
        Ok(Box::new(PiObservation {
            session: coordinates.session.clone(),
            model: None,
            transition: SessionTransition::Started,
            starting: true,
            startup_ready: false,
        }))
    }

    fn observe_main_caller(
        &self,
        runner: &dyn CommandRunner,
        caller: u64,
        pane: u64,
        deadline: Instant,
    ) -> Option<ProcessIncarnation> {
        let mut environment = caller::CallerEnvironment::current();
        environment.process_id = u32::try_from(caller).ok()?;
        let observed = caller::PiCaller::new(&runner, environment)
            .observe_host_with_deadline(deadline)
            .ok()??;
        if observed.0 != tmt_core::driver::caller::HostAttribution::Independent {
            return None;
        }
        crate::runtime::evidence::observe_main_in_pane(&runner, caller, pane, deadline, NAME)
    }

    fn prepare_launch_hooks(
        &self,
        plan: &crate::runtime::hook_protocol::LaunchHooks<'_>,
    ) -> io::Result<Option<crate::runtime::RuntimeCommand>> {
        prepare_launch_with_runner(plan, &crate::process::SupervisedProbeRunner).map(Some)
    }

    fn decode_digest_turn(&self, _payload: &[u8]) -> Option<ProviderSessionId> {
        None
    }

    fn encode_digest_turn(&self, _digest: &str) -> Option<String> {
        None
    }

    fn encode_hook_notice(&self, _message: &str, _decision: Option<&str>) -> Option<String> {
        None
    }

    fn empty_hook_output(&self) -> &'static str {
        "{}"
    }

    fn reads_state(&self, version: u16) -> bool {
        crate::runtime::driver_state::reads(version)
    }

    fn state_model(&self, state: &tmt_core::binding::session::DriverState) -> Option<String> {
        concrete_model(crate::runtime::driver_state::state_model(state).as_deref())
    }

    fn state_observed_model(
        &self,
        state: &tmt_core::binding::session::DriverState,
    ) -> Option<crate::runtime::driver_state::ObservedModel> {
        crate::runtime::driver_state::state_observed_model(state)
            .filter(|observed| concrete_model(Some(&observed.model)).is_some())
    }

    fn state_usage(
        &self,
        state: &tmt_core::binding::session::DriverState,
    ) -> Option<crate::runtime::driver_state::Usage> {
        crate::runtime::driver_state::state_usage(state)
    }

    fn decode_activity(
        &self,
        bytes: &[u8],
    ) -> Option<crate::runtime::hook_protocol::ActivityObservation> {
        use tmt_core::binding::session::activity::{Event, EventKind};
        let (payload, _) = parse_payload(bytes).ok()?;
        let kind = match payload.event.as_str() {
            "before_agent_start" => EventKind::TurnStarted,
            "ui_prompt_start" => EventKind::InputPrompt {
                initial: payload.startup_ready,
            },
            "ui_prompt_end" if payload.idle => EventKind::TurnEnded,
            "ui_prompt_end" => EventKind::ToolFinished,
            "agent_settled" => EventKind::TurnEnded,
            _ => return None,
        };
        Some(crate::runtime::hook_protocol::ActivityObservation {
            event: Event { kind, turn: None },
            model: concrete_model(payload.model.as_deref()),
        })
    }

    fn decode_activity_session(&self, bytes: &[u8]) -> Option<ProviderSessionId> {
        let (payload, session) = parse_payload(bytes).ok()?;
        matches!(payload.event.as_str(), "ui_prompt_start" | "ui_prompt_end").then_some(session)
    }

    fn activity_state(
        &self,
        observation: &crate::runtime::hook_protocol::ActivityObservation,
        session: &ProviderSessionId,
        process: &ProcessIncarnation,
        previous: Option<&tmt_core::binding::session::DriverState>,
        now_ms: u64,
    ) -> Option<tmt_core::binding::session::DriverState> {
        crate::runtime::driver_state::after_activity(
            previous,
            session,
            process,
            &observation.event,
            observation.model.as_deref(),
            now_ms,
        )
    }

    fn state_activity(
        &self,
        state: &tmt_core::binding::session::DriverState,
    ) -> Option<tmt_core::binding::session::activity::Activity> {
        crate::runtime::driver_state::state_activity(state)
    }

    fn state_consumption(
        &self,
        state: &tmt_core::binding::session::DriverState,
    ) -> Option<crate::runtime::consumption::Consumption> {
        crate::runtime::driver_state::state_consumption(state).map(|state| state.value)
    }

    fn decode_prompt(&self, bytes: &[u8]) -> Option<ProviderSessionId> {
        let (payload, session) = parse_payload(bytes).ok()?;
        (payload.event == "before_agent_start").then_some(session)
    }

    fn decode_prompt_text(&self, bytes: &[u8]) -> Option<String> {
        let (payload, _) = parse_payload(bytes).ok()?;
        (payload.event == "before_agent_start")
            .then_some(payload.prompt)
            .flatten()
            .filter(|prompt| !prompt.is_empty())
    }

    fn decode_turn(&self, payload: &[u8]) -> Option<crate::runtime::lifecycle::TurnEnd> {
        let (parsed, session) = parse_payload(payload).ok()?;
        if parsed.event != "agent_settled" {
            return None;
        }
        if parsed.aborted {
            return Some(crate::runtime::lifecycle::TurnEnd {
                session,
                transcript: None,
                final_text: None,
                interrupted: true,
            });
        }
        let final_text = parsed.final_text.as_deref().and_then(|text| {
            parsed
                .final_text_bytes
                .and_then(|bytes| tmt_core::responses::FinalText::from_kept(text, bytes))
                .or_else(|| tmt_core::responses::FinalText::new(text))
        });
        Some(crate::runtime::lifecycle::TurnEnd {
            session,
            transcript: parsed.session_file.map(PathBuf::from),
            final_text,
            interrupted: false,
        })
    }

    fn consumption_locator(
        &self,
        payload: &[u8],
        environment: &crate::skill_installation::ProviderEnvironment,
    ) -> Option<String> {
        let (parsed, _) = parse_payload(payload).ok()?;
        let path = parsed.session_file?;
        crate::runtime::sampling::locator(&sessions_root(environment), Path::new(&path))
    }

    fn sampling_turn(
        &self,
        session: &ProviderSessionId,
        locator: Option<&str>,
        environment: &crate::skill_installation::ProviderEnvironment,
        _deadline: Instant,
    ) -> Option<crate::runtime::lifecycle::TurnEnd> {
        let root = sessions_root(environment);
        if let Some(locator) = locator
            && let Some(turn) = crate::runtime::sampling::located(&root, locator, session)
        {
            return Some(turn);
        }
        let found = find_session_file(&root, session)?;
        let rel = found.strip_prefix(&root).ok()?.to_str()?;
        crate::runtime::sampling::located(&root, rel, session)
    }

    fn session_presence(
        &self,
        session: &ProviderSessionId,
        environment: &crate::skill_installation::ProviderEnvironment,
        deadline: Instant,
    ) -> crate::runtime::session_presence::SessionPresence {
        let root = sessions_root(environment);
        let Some(found) = find_session_file(&root, session) else {
            return crate::runtime::session_presence::SessionPresence::Missing;
        };
        let Some(rel) = found.strip_prefix(&root).ok() else {
            return crate::runtime::session_presence::SessionPresence::Missing;
        };
        crate::runtime::session_presence::probe_exact(&root, rel, session, deadline)
    }

    fn turn_state(
        &self,
        turn: &crate::runtime::lifecycle::TurnEnd,
        environment: &crate::skill_installation::ProviderEnvironment,
        previous: Option<&tmt_core::binding::session::DriverState>,
        now_ms: u64,
        deadline: Instant,
    ) -> Option<tmt_core::binding::session::DriverState> {
        self.turn_observation(turn, environment, previous, now_ms, deadline)
            .state
    }

    fn turn_observation(
        &self,
        turn: &crate::runtime::lifecycle::TurnEnd,
        environment: &crate::skill_installation::ProviderEnvironment,
        previous: Option<&tmt_core::binding::session::DriverState>,
        now_ms: u64,
        deadline: Instant,
    ) -> crate::runtime::lifecycle::TurnObservation {
        let root = sessions_root(environment);
        let fallback = find_session_file(&root, &turn.session);
        let path = turn.transcript.as_deref().or(fallback.as_deref());
        let (usage, final_text) = match path {
            Some(path) => crate::runtime::transcript::latest_pair(
                &root,
                path,
                transcript_usage,
                transcript_final_text,
            ),
            None => (None, None),
        };
        let usage =
            usage.and_then(|tokens| crate::runtime::driver_state::Usage::new(tokens, None, now_ms));
        let previous_consumption =
            previous.and_then(crate::runtime::driver_state::state_consumption);
        let consumption = path.and_then(|path| {
            crate::runtime::consumption::pi(
                &root,
                path,
                previous_consumption.as_ref(),
                now_ms,
                deadline,
            )
        });
        crate::runtime::lifecycle::TurnObservation {
            state: crate::runtime::driver_state::after_observation(usage, consumption, previous),
            final_text: turn.final_text.clone().or(final_text.flatten()),
        }
    }

    fn observe_replacement(&self, pane_pid: u64, deadline: Instant) -> Option<ProcessIncarnation> {
        crate::runtime::evidence::observe_replacement(
            &crate::process::SupervisedProbeRunner,
            pane_pid,
            deadline,
            NAME,
        )
    }

    fn decode(
        &self,
        payload: &[u8],
    ) -> Option<Box<dyn crate::runtime::lifecycle::LifecycleObservation>> {
        decode_hook(payload).ok().map(|value| Box::new(value) as _)
    }

    fn host_evidence(
        &self,
    ) -> Result<
        crate::runtime::lifecycle::HostEvidence,
        crate::runtime::lifecycle::LifecycleUnavailable,
    > {
        Ok(crate::runtime::lifecycle::HostEvidence::Independent { runtime_pid: None })
    }

    fn observe_in_pane(
        &self,
        runner: &dyn CommandRunner,
        caller: u64,
        pane: u64,
        deadline: Instant,
    ) -> Option<ProcessIncarnation> {
        crate::runtime::evidence::observe_main_in_pane(&runner, caller, pane, deadline, NAME)
    }

    fn movable_process(
        &self,
        runner: &dyn CommandRunner,
        binding: &tmt_core::binding::Binding,
        _preferences: &tmt_core::binding::session::SessionPreferences,
        deadline: Instant,
    ) -> Option<ProcessIncarnation> {
        crate::runtime::evidence::movable_process(
            &runner,
            &binding.session.key.as_ref()?.incarnation,
            binding.pane_pid,
            deadline,
            NAME,
        )
    }

    fn mode(&self, _: crate::runtime::lifecycle::HostEvidence) -> Option<RuntimeMode> {
        RuntimeMode::new(MODE_DEFAULT).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::{CommandError, CommandFailure, CommandOutput, CommandRequest};
    use crate::runtime::hook_protocol::{HookLaunch, LaunchHooks};
    use crate::runtime::lifecycle::RuntimeLifecycle;
    use crate::skill_installation::ProviderEnvironment;
    use crate::test_support::TestDirectory;
    use serde_json::json;
    use tmt_core::binding::session::activity::EventKind;

    struct StubRunner(&'static str);

    impl CommandRunner for StubRunner {
        fn execute(&self, request: CommandRequest<'_>) -> Result<CommandOutput, CommandError> {
            assert_eq!(request.args, &[OsString::from("--version")]);
            Ok(CommandOutput {
                stdout: self.0.as_bytes().to_vec(),
                stderr: Vec::new(),
            })
        }
    }

    struct FailingRunner;

    impl CommandRunner for FailingRunner {
        fn execute(&self, _request: CommandRequest<'_>) -> Result<CommandOutput, CommandError> {
            Err(CommandError::new(CommandFailure::Spawn))
        }
    }

    fn sample_launch() -> HookLaunch {
        HookLaunch {
            identity_id: "11111111-1111-4111-8111-111111111111".into(),
            binding_id: "22222222-2222-4222-8222-222222222222".into(),
            owner_pid: 42,
            startup_input: true,
            owner_start: "100".into(),
        }
    }

    #[test]
    fn version_check_enforces_pi_1_3_0_minimum() {
        assert_eq!(parse_semver("1.3.0\n"), Some((1, 3, 0)));
        assert_eq!(parse_semver("pi v1.4.2-beta\n"), Some((1, 4, 2)));
        assert_eq!(parse_semver("invalid"), None);

        let dir = TestDirectory::new();
        let env = ProviderEnvironment::from_parts(&dir.path, &dir.path, vec![], []);
        let cmd = crate::runtime::RuntimeCommand {
            executable: "pi".into(),
            args: vec![],
        };
        let launch = sample_launch();
        let plan = LaunchHooks {
            command: &cmd,
            launch: &launch,
            tmt: Path::new("/usr/local/bin/tmt"),
            environment: &env,
            state_directory: Some(&dir.path),
        };
        let old = prepare_launch_with_runner(&plan, &StubRunner("1.2.9\n")).unwrap_err();
        assert!(old.to_string().contains("1.3.0"));
        assert!(prepare_launch_with_runner(&plan, &FailingRunner).is_err());

        let prepared = prepare_launch_with_runner(&plan, &StubRunner("1.3.0\n")).unwrap();
        let ext_path = dir.path.join("pi").join(EXTENSION_FILE_NAME);
        assert_eq!(
            prepared.args,
            vec![
                OsString::from("--extension"),
                ext_path.clone().into_os_string()
            ]
        );
        assert_eq!(
            fs::symlink_metadata(dir.path.join("pi"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            fs::symlink_metadata(&ext_path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            fs::read_to_string(&ext_path).unwrap(),
            render_extension("/usr/local/bin/tmt", false).unwrap()
        );
        let quoted_ext = render_extension("/a b/tm\"t\\x", false).unwrap();
        assert!(quoted_ext.contains("const HOOK_BIN = \"/a b/tm\\\"t\\\\x\";"));

        // Old and audited-capability bridges coexist for concurrent launches.
        let ready = prepare_launch_with_runner(&plan, &StubRunner("1.5.2\n")).unwrap();
        assert_ne!(ready.args, prepared.args);
        let ready_path = Path::new(&ready.args[1]);
        assert!(
            fs::read_to_string(ready_path)
                .unwrap()
                .contains("const STARTUP_READY = true;")
        );
        assert!(
            fs::read_to_string(&ext_path)
                .unwrap()
                .contains("const STARTUP_READY = false;")
        );
        let mut prompted_launch = plan.launch.clone();
        prompted_launch.startup_input = false;
        let prompted_plan = crate::runtime::hook_protocol::LaunchHooks {
            launch: &prompted_launch,
            ..plan
        };
        let prompted = prepare_launch_with_runner(&prompted_plan, &StubRunner("1.5.2\n")).unwrap();
        assert_eq!(
            prompted.args, prepared.args,
            "an initial prompt is not ready"
        );
        assert!(!check_version(&StubRunner("1.5.1\n"), &cmd.executable).unwrap());
        assert!(check_version(&StubRunner("1.5.2\n"), &cmd.executable).unwrap());
        assert!(!check_version(&StubRunner("1.5.2-rc.1\n"), &cmd.executable).unwrap());

        // Tampered bytes or wrong permissions are rewritten atomically.
        fs::write(&ext_path, b"tampered").unwrap();
        fs::set_permissions(&ext_path, fs::Permissions::from_mode(0o644)).unwrap();
        prepare_launch_with_runner(&plan, &StubRunner("1.3.0\n")).unwrap();
        assert_eq!(
            fs::symlink_metadata(&ext_path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            fs::read_to_string(&ext_path).unwrap(),
            render_extension("/usr/local/bin/tmt", false).unwrap()
        );
        let quoted_ext = render_extension("/a b/tm\"t\\x", false).unwrap();
        assert!(quoted_ext.contains("const HOOK_BIN = \"/a b/tm\\\"t\\\\x\";"));
    }

    #[test]
    fn only_a_session_start_can_name_an_already_launched_process() {
        let process = ProcessIncarnation::new(42, "pi").unwrap();
        let owner = ProcessIncarnation::new(41, "launcher").unwrap();
        let session = ProviderSessionId::new("bound").unwrap();
        for previous_session in [None, Some(session.clone())] {
            let current = BindingSessionState::default()
                .admit_launched(
                    ObservedSessionKey {
                        incarnation: process.clone(),
                        provider_session: previous_session,
                    },
                    owner.clone(),
                    SessionTransition::Started,
                    RuntimeLiveness::Alive,
                    RuntimeLiveness::Alive,
                )
                .unwrap();
            for event in [
                "before_agent_start",
                "agent_settled",
                "ui_prompt_start",
                "ui_prompt_end",
                "model_select",
            ] {
                for reported_session in ["bound", "other"] {
                    let payload = json!({"event":event,"session_id":reported_session});
                    let observation = decode_hook(payload.to_string().as_bytes()).unwrap();
                    assert!(!observation.starting);
                    assert_eq!(observation.transition, SessionTransition::Started);
                    assert!(
                        observation
                            .propose(&current, &process, RuntimeLiveness::Alive)
                            .is_none(),
                        "{event} cannot admit {reported_session} over {current:?}"
                    );
                }
            }
            let start = json!({"event":"session_start","reason":"startup","session_id":"bound"});
            let observation = decode_hook(start.to_string().as_bytes()).unwrap();
            let named = observation
                .propose(&current, &process, RuntimeLiveness::Alive)
                .unwrap();
            assert_eq!(named.key.unwrap().provider_session, Some(session.clone()));
            assert_eq!(named.launch_owner, Some(owner.clone()));
            let other = json!({"event":"session_start","reason":"startup","session_id":"other"});
            let observation = decode_hook(other.to_string().as_bytes()).unwrap();
            if current.key.as_ref().unwrap().provider_session.is_some() {
                assert!(
                    observation
                        .propose(&current, &process, RuntimeLiveness::Alive)
                        .is_none()
                );
            }
        }
    }

    #[test]
    fn hooks_decode_lifecycle_and_activity_and_transcript_usage() {
        let lifecycle = PiLifecycle;
        let session = "33333333-3333-4333-8333-333333333333";

        let start = json!({
            "event": "session_start",
            "session_id": session,
            "reason": "startup",
            "model": "claude-sonnet-4-5"
        });
        let obs = decode_hook(start.to_string().as_bytes()).unwrap();
        assert!(obs.starting);
        assert_eq!(obs.transition, SessionTransition::Started);
        assert_eq!(obs.model.as_deref(), Some("claude-sonnet-4-5"));
        assert!(!obs.startup_ready);
        let mut ready = start.clone();
        ready["startup_ready"] = true.into();
        assert!(
            decode_hook(ready.to_string().as_bytes())
                .unwrap()
                .startup_ready
        );
        for reason in ["reload", "resume", "new", "fork", "future"] {
            ready["reason"] = reason.into();
            assert!(
                !decode_hook(ready.to_string().as_bytes())
                    .unwrap()
                    .startup_ready
            );
        }

        let future_start = json!({
            "event": "session_start",
            "session_id": session,
            "reason": "future-reason"
        });
        let future_obs = decode_hook(future_start.to_string().as_bytes()).unwrap();
        assert!(future_obs.starting);
        assert_eq!(future_obs.transition, SessionTransition::Started);

        for (ev, expected_kind) in [
            ("before_agent_start", EventKind::TurnStarted),
            ("ui_prompt_start", EventKind::InputPrompt { initial: false }),
            ("ui_prompt_end", EventKind::ToolFinished),
            ("agent_settled", EventKind::TurnEnded),
        ] {
            let payload = json!({
                "event": ev,
                "session_id": session,
                "model": "gemini-4-hydrogen"
            });
            let act = lifecycle
                .decode_activity(payload.to_string().as_bytes())
                .unwrap();
            assert_eq!(act.event.kind, expected_kind);
            assert_eq!(act.model.as_deref(), Some("gemini-4-hydrogen"));
        }

        // Provenance: Pi 1.3.0 docs/session-format.md & docs/message-types.md.
        let assistant_line = json!({
            "type": "message",
            "id": "b2c3d4e5",
            "parentId": "a1b2c3d4",
            "timestamp": "2026-11-15T07:00:00.000Z",
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": "Done!"}],
                "provider": "anthropic",
                "model": "claude-sonnet-4-5",
                "usage": {
                    "input": 100,
                    "output": 40,
                    "cacheRead": 20,
                    "cacheWrite": 10,
                    "totalTokens": 170
                },
                "stopReason": "stop",
                "timestamp": 1794726000000u64
            }
        })
        .to_string();
        assert_eq!(transcript_usage(&assistant_line), Some(170));
        assert_eq!(
            transcript_final_text(&assistant_line),
            Some(tmt_core::responses::FinalText::new("Done!"))
        );
    }

    #[test]
    fn prompt_text_and_settled_final_text_respect_bounds_abort_and_tool_turns() {
        let lifecycle = PiLifecycle;
        let session = "33333333-3333-4333-8333-333333333333";

        let prompt_payload = json!({
            "event": "before_agent_start",
            "session_id": session,
            "prompt": "hello pi"
        });
        assert_eq!(
            lifecycle
                .decode_prompt_text(prompt_payload.to_string().as_bytes())
                .as_deref(),
            Some("hello pi")
        );

        let empty_prompt = json!({
            "event": "before_agent_start",
            "session_id": session,
            "prompt": ""
        });
        assert_eq!(
            lifecycle.decode_prompt_text(empty_prompt.to_string().as_bytes()),
            None
        );

        let settled = json!({
            "event": "agent_settled",
            "session_id": session,
            "session_file": "/tmp/session.jsonl",
            "aborted": false,
            "final_text": "All done"
        });
        let turn = lifecycle
            .decode_turn(settled.to_string().as_bytes())
            .unwrap();
        assert!(!turn.interrupted);
        assert_eq!(
            turn.transcript.as_deref(),
            Some(Path::new("/tmp/session.jsonl"))
        );
        assert_eq!(
            turn.final_text,
            tmt_core::responses::FinalText::new("All done")
        );

        // Truncated final_text preserves truncation provenance without exceeding FinalText bounds.
        let kept = "a".repeat(tmt_core::responses::MAX_TEXT_BYTES);
        let original_bytes = tmt_core::responses::MAX_TEXT_BYTES + 250;
        let truncated_settled = json!({
            "event": "agent_settled",
            "session_id": session,
            "aborted": false,
            "final_text": kept,
            "final_text_bytes": original_bytes
        });
        let truncated_turn = lifecycle
            .decode_turn(truncated_settled.to_string().as_bytes())
            .unwrap();
        let truncated_final = truncated_turn.final_text.unwrap();
        assert!(truncated_final.truncated());
        assert_eq!(truncated_final.original_bytes(), original_bytes);
        assert_eq!(
            truncated_final.text().len(),
            tmt_core::responses::MAX_TEXT_BYTES
        );

        // Tool-only turn omits final_text cleanly.
        let tool_only = json!({
            "event": "agent_settled",
            "session_id": session,
            "session_file": "/tmp/session.jsonl",
            "aborted": false
        });
        let tool_turn = lifecycle
            .decode_turn(tool_only.to_string().as_bytes())
            .unwrap();
        assert!(!tool_turn.interrupted);
        assert_eq!(tool_turn.final_text, None);

        // Aborted turn drops final_text and transcript, marking interrupted = true.
        let aborted = json!({
            "event": "agent_settled",
            "session_id": session,
            "session_file": "/tmp/session.jsonl",
            "aborted": true,
            "final_text": "must be ignored"
        });
        let aborted_turn = lifecycle
            .decode_turn(aborted.to_string().as_bytes())
            .unwrap();
        assert!(aborted_turn.interrupted);
        assert_eq!(aborted_turn.final_text, None);
        assert_eq!(aborted_turn.transcript, None);
    }

    #[test]
    fn placeholder_models_are_rejected_and_omitted_on_resume() {
        use tmt_core::binding::session::{
            DriverState, HarnessId, ProviderSessionId, RuntimeMode,
            activity::{Event, EventKind},
        };
        use tmt_core::driver::{ActionResult, Driver, HarnessResume, HarnessStart};

        let lifecycle = PiLifecycle;
        let session_str = "33333333-3333-4333-8333-333333333333";
        let session = ProviderSessionId::new(session_str).unwrap();
        let process = ProcessIncarnation::new(42, "pi").unwrap();
        let harness = HarnessId::new(NAME).unwrap();
        let mode = RuntimeMode::new(MODE_DEFAULT).unwrap();

        for bad_model in ["unknown", "Unknown", "auto", "AUTO", "default", "DEFAULT"] {
            let start = json!({
                "event": "session_start",
                "session_id": session_str,
                "reason": "startup",
                "model": bad_model
            });
            let obs = decode_hook(start.to_string().as_bytes()).unwrap();
            assert_eq!(obs.model, None, "{bad_model} must be rejected");
            let turn_start = json!({
                "event": "before_agent_start",
                "session_id": session_str,
                "model": bad_model
            });
            let act = lifecycle
                .decode_activity(turn_start.to_string().as_bytes())
                .unwrap();
            assert_eq!(act.model, None, "{bad_model} activity must be rejected");

            // Even if legacy state persisted a placeholder model, resume omits --model.
            let legacy_state =
                DriverState::new(1, &serde_json::json!({ "model": bad_model }).to_string())
                    .unwrap();
            assert_eq!(lifecycle.state_model(&legacy_state), None);
            assert_eq!(lifecycle.state_observed_model(&legacy_state), None);

            let mut runtime = PiRuntime;
            let ActionResult::Completed(launch) = runtime.resume(HarnessResume {
                start: HarnessStart {
                    harness: &harness,
                    context: None,
                },
                session: &session,
                mode: &mode,
                state: Some(&legacy_state),
            }) else {
                panic!("resume should complete");
            };
            assert_eq!(
                launch.args,
                vec![OsString::from("--session"), OsString::from(session_str)],
                "resume after {bad_model} must omit --model"
            );
        }

        // Concrete model still propagates through LifecycleObservation::driver_state into resume --model.
        let good_start = decode_hook(
            json!({
                "event": "session_start",
                "session_id": session_str,
                "reason": "startup",
                "model": "claude-sonnet-4-5"
            })
            .to_string()
            .as_bytes(),
        )
        .unwrap();
        let good_state =
            crate::runtime::lifecycle::LifecycleObservation::driver_state(&good_start, None, 100)
                .unwrap();
        assert_eq!(
            lifecycle.state_model(&good_state).as_deref(),
            Some("claude-sonnet-4-5")
        );
        let good_activity = lifecycle
            .activity_state(
                &crate::runtime::hook_protocol::ActivityObservation {
                    event: Event {
                        kind: EventKind::TurnStarted,
                        turn: None,
                    },
                    model: concrete_model(Some("claude-sonnet-4-5")),
                },
                &session,
                &process,
                Some(&good_state),
                100,
            )
            .unwrap();
        assert_eq!(
            lifecycle
                .state_observed_model(&good_activity)
                .map(|observed| observed.model)
                .as_deref(),
            Some("claude-sonnet-4-5")
        );
        let mut runtime = PiRuntime;
        let ActionResult::Completed(launch) = runtime.resume(HarnessResume {
            start: HarnessStart {
                harness: &harness,
                context: None,
            },
            session: &session,
            mode: &mode,
            state: Some(&good_activity),
        }) else {
            panic!("resume should complete");
        };
        assert_eq!(
            launch.args,
            vec![
                OsString::from("--session"),
                OsString::from(session_str),
                OsString::from("--model"),
                OsString::from("claude-sonnet-4-5"),
            ]
        );
    }

    #[test]
    fn runtime_exposes_minimal_session_env_and_shared_rpc_refusal() {
        let runtime = DRIVER.runtime.as_ref().expect("pi runtime");
        assert!(DRIVER.identify_caller.is_some());
        assert_eq!(runtime.session_env, &["PI_CODING_AGENT", "PI_SESSION_ID"]);

        let registered_env = crate::drivers::Registry::builtin().session_env();
        for key in ["PI_CODING_AGENT", "PI_SESSION_ID"] {
            assert!(
                registered_env.contains(&key),
                "registry session_env must include {key}"
            );
        }
        for dropped in ["PI_PROVIDER", "PI_MODEL", "PI_REASONING_LEVEL"] {
            assert!(
                !registered_env.contains(&dropped),
                "registry session_env must drop {dropped}"
            );
        }

        let refusal = PiLifecycle
            .caller_refusal(Some("'beta'"))
            .expect("pi rpc refusal");
        assert_eq!(refusal.reason, "pi-shared-rpc");
        assert_eq!(refusal.fix, "tmt run 'beta' pi");
    }

    #[test]
    fn session_switches_on_same_incarnation_keep_running_and_record_new_session() {
        let process = ProcessIncarnation::new(42, "pi").unwrap();
        let other_process = ProcessIncarnation::new(99, "pi").unwrap();
        let owner = ProcessIncarnation::new(41, "launcher").unwrap();
        let initial = ProviderSessionId::new("session-initial").unwrap();
        let switched = ProviderSessionId::new("session-switched").unwrap();
        let running = BindingSessionState::default()
            .admit_launched(
                ObservedSessionKey {
                    incarnation: process.clone(),
                    provider_session: Some(initial),
                },
                owner.clone(),
                SessionTransition::Started,
                RuntimeLiveness::Alive,
                RuntimeLiveness::Alive,
            )
            .unwrap();

        for reason in ["new", "resume", "fork"] {
            let payload = json!({
                "event": "session_start",
                "reason": reason,
                "session_id": "session-switched",
            });
            let observation = decode_hook(payload.to_string().as_bytes()).unwrap();
            let next = observation
                .propose(&running, &process, RuntimeLiveness::Alive)
                .unwrap_or_else(|| panic!("{reason} on same incarnation should keep Running"));
            assert_eq!(next.state, RuntimeState::Running);
            assert_eq!(
                next.key.as_ref().and_then(|k| k.provider_session.as_ref()),
                Some(&switched)
            );
            assert_eq!(next.launch_owner.as_ref(), Some(&owner));

            assert!(
                observation
                    .propose(&running, &other_process, RuntimeLiveness::Alive)
                    .is_none(),
                "{reason} must still refuse a changed incarnation"
            );
            assert!(
                observation
                    .propose(&running, &process, RuntimeLiveness::Gone)
                    .is_none(),
                "{reason} must fail closed when previous process is not Alive"
            );
        }
    }

    #[test]
    fn digest_turn_decoding_is_disabled_without_digest_turn_encoding() {
        let lifecycle = PiLifecycle;
        assert!(lifecycle.encode_digest_turn("digest").is_none());
        for payload in [
            json!({"event": "agent_settled", "session_id": "session-1"}),
            json!({"event": "agent_busy", "session_id": "session-1"}),
            json!({"event": "session_start", "reason": "startup", "session_id": "session-1"}),
        ] {
            assert!(
                lifecycle
                    .decode_digest_turn(payload.to_string().as_bytes())
                    .is_none(),
                "decode_digest_turn must return None while encode_digest_turn is None"
            );
        }
    }

    #[test]
    fn tool_only_or_empty_assistant_record_does_not_resurrect_earlier_final() {
        let dir = TestDirectory::new();
        let session_id = "33333333-3333-4333-8333-333333333333";
        let sessions = dir.path.join(".pi/agent/sessions/project");
        fs::create_dir_all(&sessions).unwrap();
        let session_file = sessions.join(format!("2026-11-19T00-00-00-000Z_{session_id}.jsonl"));
        let earlier = json!({
            "type": "message",
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": "Earlier turn answer"}],
                "usage": {"totalTokens": 10}
            }
        });
        let tool_only = json!({
            "type": "message",
            "message": {
                "role": "assistant",
                "content": [{"type": "toolCall", "id": "call_1", "name": "bash", "arguments": {}}],
                "usage": {"totalTokens": 25}
            }
        });
        assert_eq!(transcript_final_text(&tool_only.to_string()), Some(None));
        fs::write(&session_file, format!("{earlier}\n{tool_only}\n")).unwrap();

        let env = ProviderEnvironment::from_parts(&dir.path, &dir.path, vec![], []);
        let turn = crate::runtime::lifecycle::TurnEnd {
            session: ProviderSessionId::new(session_id).unwrap(),
            transcript: Some(session_file),
            final_text: None,
            interrupted: false,
        };
        let observation = PiLifecycle.turn_observation(
            &turn,
            &env,
            None,
            1_795_000_000_000,
            Instant::now() + Duration::from_secs(2),
        );
        assert_eq!(observation.final_text, None);
        assert_eq!(
            PiLifecycle
                .state_usage(&observation.state.unwrap())
                .unwrap()
                .tokens,
            25
        );
    }

    #[test]
    fn extension_scans_backward_past_trailing_entries_and_stops_at_user_turn() {
        let dir = TestDirectory::new();
        let hook = dir.path.join("hook.sh");
        let log = dir.path.join("hooks.jsonl");
        fs::write(
            &hook,
            format!(
                "#!/bin/sh\ncat >> '{}'\nprintf '\\n' >> '{}'\n",
                log.display(),
                log.display()
            ),
        )
        .unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o700)).unwrap();

        let ext_path = dir.path.join(EXTENSION_FILE_NAME);
        let rendered = render_extension(hook.to_str().unwrap(), false).unwrap();
        fs::write(&ext_path, rendered).unwrap();

        let driver_path = dir.path.join("driver.mjs");
        let driver = r#"
import { pathToFileURL } from 'node:url';
const [extFile] = process.argv.slice(2);
const handlers = new Map();
const pi = { on(name, fn) { handlers.set(name, fn); } };
const mod = await import(pathToFileURL(extFile).href);
mod.default(pi);
const runCase = (branch) => {
  const ctx = {
    mode: 'tui',
    isIdle: () => true,
    sessionManager: {
      getSessionId: () => '33333333-3333-4333-8333-333333333333',
      getSessionFile: () => '/tmp/session.jsonl',
      getBranch: () => branch,
    },
  };
  handlers.get('agent_settled')({ type: 'agent_settled', aborted: false }, ctx);
};
runCase([
  { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'first' }] } },
  { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'old answer' }] } },
  { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'second' }] } },
  { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'turn reply' }] } },
  { type: 'custom_message', customType: 'note', content: 'trailing', display: false },
]);
runCase([
  { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'first' }] } },
  { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'old answer' }] } },
  { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'second' }] } },
  { type: 'custom_message', customType: 'note', content: 'trailing', display: false },
]);
runCase([
  { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'first' }] } },
  { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'old answer' }] } },
  { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'second' }] } },
  { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'bash' }] } },
  { type: 'custom_message', customType: 'note', content: 'trailing', display: false },
]);
"#;
        fs::write(&driver_path, driver).unwrap();
        let output = std::process::Command::new("node")
            .args([driver_path.to_str().unwrap(), ext_path.to_str().unwrap()])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "node extension driver failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );

        let captured: Vec<serde_json::Value> = fs::read_to_string(&log)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(captured.len(), 3);
        assert_eq!(captured[0]["final_text"], "turn reply");
        assert!(captured[1].get("final_text").is_none());
        assert!(captured[2].get("final_text").is_none());
    }

    #[test]
    fn extension_registers_tmt_commands_and_handles_skill_dispatch_and_failures() {
        let dir = TestDirectory::new();
        let fake_tmt = dir.path.join("tmt-stub.sh");
        fs::write(&fake_tmt, "#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&fake_tmt, fs::Permissions::from_mode(0o700)).unwrap();

        let ext_path = dir.path.join(EXTENSION_FILE_NAME);
        let rendered = render_extension(fake_tmt.to_str().unwrap(), true).unwrap();
        fs::write(&ext_path, rendered).unwrap();

        let driver_path = dir.path.join("commands-driver.mjs");
        let driver = r##"
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const [extFile, expectedBin] = process.argv.slice(2);
const commands = new Map();
const sent = [];
let execMock = async () => ({ code: 0, killed: false, stdout: '', stderr: '' });
let sendMock = (text, options) => {
  sent.push({ text, options });
};

const pi = {
  on() {},
  registerCommand(name, options) {
    commands.set(name, options);
  },
  exec(bin, args, options) {
    return execMock(bin, args, options);
  },
  sendUserMessage(text, options) {
    return sendMock(text, options);
  },
};

const mod = await import(pathToFileURL(extFile).href);
mod.default(pi);

assert.deepEqual([...commands.keys()].sort(), ['tmt', 'tmt-inbox']);
for (const name of ['tmt', 'tmt-inbox']) {
  const cmd = commands.get(name);
  assert.equal(typeof cmd.description, 'string');
  assert.ok(cmd.description.length > 0);
  assert.equal(cmd.getArgumentCompletions, undefined);
}

const notifications = [];
const makeCtx = (idle = true) => ({
  isIdle: () => idle,
  ui: {
    notify(message, level) {
      notifications.push({ message, level });
    },
  },
});

// 1. /tmt strips YAML frontmatter, preserves body `---`, and appends args when idle
execMock = async (bin, args, options) => {
  assert.equal(bin, expectedBin);
  assert.deepEqual(args, ['learn', '--skill', 'tmt']);
  assert.equal(options?.timeout, 5000);
  return {
    code: 0,
    killed: false,
    stdout: "---\nname: tmt\ndescription: 'TMT'\n---\n\n# TMT\nUse tmt.\n\n---\nSection 2\n",
    stderr: '',
  };
};
await commands.get('tmt').handler('  talk reviewer ping  ', makeCtx(true));
assert.equal(sent.length, 1);
assert.equal(sent[0].text, "# TMT\nUse tmt.\n\n---\nSection 2\n\ntalk reviewer ping");
assert.equal(sent[0].options, undefined);

// 2. /tmt-inbox while busy sets deliverAs: 'followUp'
execMock = async (bin, args) => {
  assert.equal(bin, expectedBin);
  assert.deepEqual(args, ['learn', '--skill', 'tmt-inbox']);
  return {
    code: 0,
    killed: false,
    stdout: "---\r\nname: tmt-inbox\r\n---\r\n# TMT inbox\r\nCheck inbox.",
    stderr: '',
  };
};
await commands.get('tmt-inbox').handler('', makeCtx(false));
assert.equal(sent.length, 2);
assert.equal(sent[1].text, "# TMT inbox\r\nCheck inbox.");
assert.deepEqual(sent[1].options, { deliverAs: 'followUp' });
assert.equal(notifications.length, 0);

// 3. Failure paths notify via ctx.ui.notify and never throw or send messages
execMock = async () => ({ code: 1, killed: false, stdout: '', stderr: 'boom' });
await commands.get('tmt').handler('', makeCtx(true));

execMock = async () => ({ code: 0, killed: true, stdout: '# TMT', stderr: '' });
await commands.get('tmt').handler('', makeCtx(true));

execMock = async () => ({ code: 0, killed: false, stdout: "---\nname: tmt\n---\n   \n", stderr: '' });
await commands.get('tmt').handler('', makeCtx(true));

execMock = async () => {
  throw new Error('spawn failed');
};
await commands.get('tmt-inbox').handler('', makeCtx(true));

execMock = async () => ({ code: 0, killed: false, stdout: '# TMT\nBody', stderr: '' });
sendMock = () => {
  throw new Error('compaction active');
};
await commands.get('tmt').handler('', makeCtx(true));

assert.equal(sent.length, 2);
assert.equal(notifications.length, 5);
assert.ok(notifications.every((n) => n.level === 'error' && typeof n.message === 'string' && n.message.length > 0));
assert.match(notifications[0].message, /boom/);
assert.match(notifications[3].message, /spawn failed/);
assert.match(notifications[4].message, /compaction active/);
"##;
        fs::write(&driver_path, driver).unwrap();

        let output = std::process::Command::new("node")
            .args([
                driver_path.to_str().unwrap(),
                ext_path.to_str().unwrap(),
                fake_tmt.to_str().unwrap(),
            ])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "node extension command test failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn extension_guard_deduplicates_user_and_launch_copies_and_upgrades_state() {
        let dir = TestDirectory::new();
        let capture = dir.path.join("hooks.jsonl");
        let user_tmt = dir.path.join("tmt-user.sh");
        let launch_tmt = dir.path.join("tmt-launch.sh");
        let make_stub = |path: &Path, label: &str| {
            let script = format!(
                "#!/bin/sh\npayload=$(cat)\nprintf '%s\\t%s\\n' '{label}' \"$payload\" >> \"{}\"\n",
                capture.display()
            );
            fs::write(path, script).unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
        };
        make_stub(&user_tmt, "user");
        make_stub(&launch_tmt, "launch");

        let user_ext = dir.path.join("index.js");
        let launch_ext = dir.path.join("tmt-pi-extension-ready.mjs");
        fs::write(
            &user_ext,
            render_extension(user_tmt.to_str().unwrap(), false).unwrap(),
        )
        .unwrap();
        fs::write(
            &launch_ext,
            render_extension(launch_tmt.to_str().unwrap(), true).unwrap(),
        )
        .unwrap();

        let driver_path = dir.path.join("guard-driver.mjs");
        let driver = r##"
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const [userExt, launchExt, expectedLaunchBin] = process.argv.slice(2);
const handlers = new Map();
const commands = new Map();
const execCalls = [];

const pi = {
  on(event, fn) {
    const list = handlers.get(event) ?? [];
    list.push(fn);
    handlers.set(event, list);
  },
  registerCommand(name, options) {
    assert.equal(commands.has(name), false, `duplicate command registration: ${name}`);
    commands.set(name, options);
  },
  async exec(bin, args) {
    execCalls.push({ bin, args });
    return { code: 0, killed: false, stdout: '# TMT\nBody', stderr: '' };
  },
  sendUserMessage() {},
};

const userMod = await import(pathToFileURL(userExt).href);
userMod.default(pi);
const launchMod = await import(pathToFileURL(launchExt).href);
launchMod.default(pi);

assert.equal(handlers.get('session_start')?.length, 1);
assert.deepEqual([...commands.keys()].sort(), ['tmt', 'tmt-inbox']);

const ctx = {
  mode: 'tui',
  isIdle: () => true,
  sessionManager: {
    getSessionId: () => 'sess-guard-1',
    getSessionFile: () => '/tmp/sess-guard-1.jsonl',
  },
};
for (const fn of handlers.get('session_start')) {
  fn({ reason: 'startup' }, ctx);
}
await commands.get('tmt').handler('', ctx);
assert.equal(execCalls.length, 1);
assert.equal(execCalls[0].bin, expectedLaunchBin);
"##;
        fs::write(&driver_path, driver).unwrap();

        let output = std::process::Command::new("node")
            .args([
                driver_path.to_str().unwrap(),
                user_ext.to_str().unwrap(),
                launch_ext.to_str().unwrap(),
                launch_tmt.to_str().unwrap(),
            ])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "node guard test failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );

        let lines: Vec<String> = fs::read_to_string(&capture)
            .unwrap()
            .lines()
            .map(ToOwned::to_owned)
            .collect();
        assert_eq!(lines.len(), 1, "expected 1 hook call, got: {lines:?}");
        let (which, json) = lines[0].split_once('\t').unwrap();
        assert_eq!(which, "launch");
        let payload: serde_json::Value = serde_json::from_str(json).unwrap();
        assert_eq!(payload["event"], "session_start");
        assert_eq!(payload["startup_ready"], true);
    }
}
