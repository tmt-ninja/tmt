//! Pi coding agent (`pi`): descriptor, file locations, runtime, per-launch
//! extension materialization, hook wire mapping, and bounded JSONL transcript
//! parsing. Payloads describe observations, never bindings.

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
const VERSION_TIMEOUT: Duration = Duration::from_secs(3);
const EXTENSION_FILE_NAME: &str = "tmt-pi-extension.mjs";
const EMBEDDED_EXTENSION: &str = include_str!("pi/tmt-pi-extension.mjs");

/// Pi has one runtime mode.
pub const MODE_DEFAULT: &str = "default";

pub static DRIVER: super::DriverDefinition = super::DriverDefinition {
    descriptor: &tmt_core::driver::descriptor::PI,
    env: &["PI_CODING_AGENT_DIR"],
    locate,
    runtime: Some(super::Runtime {
        session_env: &[],
        driver: || Box::new(PiRuntime),
        lifecycle: || Box::new(PiLifecycle),
        channel: None,
        identify_caller: None,
    }),
};

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
            let mut next = current.transition(&key, self.transition, None)?;
            if matches!(
                self.transition,
                SessionTransition::Cleared | SessionTransition::Resumed | SessionTransition::Forked
            ) {
                next.state = RuntimeState::Unknown;
            }
            return Some(next);
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
                let mut next = current.transition(&key, self.transition, None)?;
                if matches!(
                    self.transition,
                    SessionTransition::Cleared
                        | SessionTransition::Resumed
                        | SessionTransition::Forked
                ) {
                    next.state = RuntimeState::Unknown;
                }
                return Some(next);
            }
        }
        current.admit(key, self.transition, RuntimeLiveness::Alive)
    }
}

impl crate::runtime::lifecycle::LifecycleObservation for PiObservation {
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

fn concrete_model(raw: Option<&str>) -> Option<String> {
    let model = raw?.trim();
    (!model.is_empty() && crate::runtime::driver_state::valid_model(model))
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
    Ok(PiObservation {
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

fn check_version(runner: &dyn CommandRunner, executable: &OsString) -> io::Result<()> {
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
    Ok(())
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

fn render_extension(launcher: &str) -> io::Result<String> {
    let quoted = serde_json::to_string(launcher).map_err(io::Error::other)?;
    Ok(EMBEDDED_EXTENSION.replace("__TMT_HOOK_BIN__", &quoted))
}

fn materialize_extension(state_directory: &Path, launcher: &str) -> io::Result<PathBuf> {
    let pi_dir = state_directory.join(NAME);
    crate::private_file::ensure_private_directory(&pi_dir)?;
    let path = pi_dir.join(EXTENSION_FILE_NAME);
    let content = render_extension(launcher)?;
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
    check_version(runner, &plan.command.executable)?;
    let extension_path = materialize_extension(state_directory, launcher)?;
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

fn transcript_final_text(line: &str) -> Option<tmt_core::responses::FinalText> {
    let entry: serde_json::Value = serde_json::from_str(line).ok()?;
    if entry.get("type").and_then(serde_json::Value::as_str) != Some("message") {
        return None;
    }
    let message = entry.get("message")?;
    if message.get("role").and_then(serde_json::Value::as_str) != Some("assistant") {
        return None;
    }
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
        _target: &Self::Target,
        _message: &str,
    ) -> tmt_core::driver::ActionResult<
        tmt_core::driver::DeliveryAcceptance,
        tmt_core::driver::SendFailure<Self::Error>,
    > {
        tmt_core::driver::ActionResult::Unsupported
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
        if let Some(model) = model {
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
    fn launch_settings(&self, args: &[OsString]) -> crate::runtime::launch_preset::LaunchSettings {
        crate::runtime::launch_preset::flags(args, &["--model"], &["--thinking"], false)
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

    fn observe_main_caller(
        &self,
        runner: &dyn CommandRunner,
        caller: u64,
        pane: u64,
        deadline: Instant,
    ) -> Option<ProcessIncarnation> {
        crate::runtime::evidence::observe_main_in_pane(&runner, caller, pane, deadline, NAME)
    }

    fn prepare_launch_hooks(
        &self,
        plan: &crate::runtime::hook_protocol::LaunchHooks<'_>,
    ) -> io::Result<Option<crate::runtime::RuntimeCommand>> {
        prepare_launch_with_runner(plan, &crate::process::SupervisedProbeRunner).map(Some)
    }

    fn decode_digest_turn(&self, payload: &[u8]) -> Option<ProviderSessionId> {
        let (parsed, session) = parse_payload(payload).ok()?;
        (parsed.event == "agent_settled").then_some(session)
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
        crate::runtime::driver_state::state_model(state)
    }

    fn state_observed_model(
        &self,
        state: &tmt_core::binding::session::DriverState,
    ) -> Option<crate::runtime::driver_state::ObservedModel> {
        crate::runtime::driver_state::state_observed_model(state)
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
            "ui_prompt_start" => EventKind::ApprovalPrompt,
            "ui_prompt_end" => EventKind::ToolFinished,
            "agent_settled" => EventKind::TurnEnded,
            _ => return None,
        };
        Some(crate::runtime::hook_protocol::ActivityObservation {
            event: Event { kind, turn: None },
            model: concrete_model(payload.model.as_deref()),
        })
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

    fn decode_turn(&self, payload: &[u8]) -> Option<crate::runtime::lifecycle::TurnEnd> {
        let (parsed, session) = parse_payload(payload).ok()?;
        (parsed.event == "agent_settled").then(|| crate::runtime::lifecycle::TurnEnd {
            session,
            transcript: parsed.session_file.map(PathBuf::from),
            final_text: None,
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
            final_text: turn.final_text.clone().or(final_text),
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
            render_extension("/usr/local/bin/tmt").unwrap()
        );
        let quoted_ext = render_extension("/a b/tm\"t\\x").unwrap();
        assert!(quoted_ext.contains("const HOOK_BIN = \"/a b/tm\\\"t\\\\x\";"));

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
            render_extension("/usr/local/bin/tmt").unwrap()
        );
        let quoted_ext = render_extension("/a b/tm\"t\\x").unwrap();
        assert!(quoted_ext.contains("const HOOK_BIN = \"/a b/tm\\\"t\\\\x\";"));
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
            ("ui_prompt_start", EventKind::ApprovalPrompt),
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
            tmt_core::responses::FinalText::new("Done!")
        );
    }
}
