//! The only door to TMT: public JSON output and `tmt api`, run through the
//! invoking executable. Squad never opens TMT storage or configuration itself.

mod api_session;
mod retained_reads;
pub(crate) use retained_reads::RetainedReads;

use crate::runner::{self, RunError};
use serde_json::{Value, json};
use std::{
    ffi::OsString,
    fmt,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

const TIMEOUT: Duration = Duration::from_secs(15);
// Above `tmt api`'s own advertised output bound, so its errors stay readable.
const OUTPUT_LIMIT: usize = 16 * 1024 * 1024;
const CONFIG_LOOKUP: &str = "TMT_OPS_CONFIG_LOOKUP";
// Serializes shell API spawning with board exec, including macOS pipe CLOEXEC setup.
static SHELL_SPAWNS: std::sync::OnceLock<std::sync::Mutex<std::collections::BTreeSet<u32>>> =
    std::sync::OnceLock::new();
pub(crate) fn shell_spawn_guard() -> std::sync::MutexGuard<'static, std::collections::BTreeSet<u32>>
{
    SHELL_SPAWNS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}
pub(crate) fn signal_shell_apis(pids: &std::collections::BTreeSet<u32>) {
    for pid in pids {
        if let Ok(pid) = i32::try_from(*pid) {
            let _ = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(pid),
                nix::sys::signal::Signal::SIGTERM,
            );
        }
    }
}

/// A squad or passed-through core failure. Core codes are never renamed.
/// `message` is the whole text `--json` reports; human output shows it as
/// `error:`, or as `error:` plus `hint:` when the failure names a next step.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SquadError {
    pub code: String,
    pub message: String,
    /// Transaction conflict snapshot supplied by the public metadata API.
    pub current: Option<Box<Value>>,
    /// A request Core accepted before failing; it is retained, never resent.
    pub request: Option<String>,
    /// Public verified-stop evidence; absence remains unknown.
    pub signalled: Option<bool>,
    /// Where `message` splits into what failed and the next step.
    hint: Option<(usize, usize)>,
    /// Local process cancellation, never inferred from a public error document.
    cancelled: bool,
}

impl SquadError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            hint: None,
            current: None,
            request: None,
            signalled: None,
            cancelled: false,
        }
    }

    /// `message` is `what`, `separator` and `hint` joined, exactly as
    /// `--json` has always reported it; human output shows the two parts.
    pub fn hinted(code: &str, what: &str, separator: &str, hint: &str) -> Self {
        Self {
            code: code.into(),
            message: format!("{what}{separator}{hint}"),
            hint: Some((what.len(), what.len() + separator.len())),
            current: None,
            request: None,
            signalled: None,
            cancelled: false,
        }
    }

    /// What failed, and the next step when there is one.
    pub fn human(&self) -> (&str, Option<&str>) {
        match self.hint {
            Some((what, hint)) => (&self.message[..what], Some(&self.message[hint..])),
            None => (&self.message, None),
        }
    }

    pub fn to_json(&self) -> Value {
        let mut value = json!({"error": {"code": self.code, "message": self.message}});
        if let Some(signalled) = self.signalled {
            value["error"]["signalled"] = json!(signalled);
        }
        value
    }

    pub(crate) fn was_cancelled(&self) -> bool {
        self.cancelled
    }
}

impl fmt::Display for SquadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{} ({})", self.message, self.code)
    }
}

fn unavailable(message: &str) -> SquadError {
    SquadError::new("SQUAD_CORE_UNAVAILABLE", message)
}

#[derive(Clone)]
pub struct Core {
    executable: PathBuf,
    cancellation: Option<runner::Cancellation>,
    deadline: Option<Instant>,
    session: Option<Arc<ApiSessions>>,
    interactive: bool,
    retained: Option<Arc<RetainedReads>>,
    pub(crate) paths: Arc<crate::migration::Decision>,
}

struct ApiSessions {
    background: api_session::Session,
    interaction: api_session::Session,
}

impl Core {
    /// Extension dispatch supplies `TMT_EXECUTABLE`; a direct run falls back
    /// to the first executable `tmt` on PATH.
    pub fn discover() -> Result<Self, SquadError> {
        Self::discover_with(
            std::env::var_os("TMT_EXECUTABLE").map(PathBuf::from),
            std::env::var_os("PATH"),
        )
    }

    fn discover_with(
        supplied: Option<PathBuf>,
        search: Option<OsString>,
    ) -> Result<Self, SquadError> {
        let executable = match supplied {
            Some(path) if path.is_absolute() => Some(path),
            Some(_) => return Err(unavailable("TMT_EXECUTABLE must be an absolute path.")),
            None => search.and_then(|search| {
                std::env::split_paths(&search)
                    .map(|directory| directory.join("tmt"))
                    .find(|candidate| executable(candidate))
            }),
        };
        let executable = executable.ok_or_else(|| {
            unavailable("Could not find the tmt executable; run through `tmt ops squad`.")
        })?;
        reject_self(&executable)?;
        Ok(Self {
            executable,
            cancellation: None,
            deadline: None,
            session: None,
            interactive: false,
            retained: None,
            paths: Arc::new(crate::migration::Decision::default()),
        })
    }

    /// A given executable, for tests that stand a script in for tmt.
    #[cfg(test)]
    pub fn at(executable: PathBuf) -> Self {
        Self {
            executable,
            cancellation: None,
            deadline: None,
            session: None,
            interactive: false,
            retained: None,
            paths: Arc::new(crate::migration::Decision::default()),
        }
    }

    pub fn cancellable(&self, cancellation: runner::Cancellation) -> Self {
        Self {
            cancellation: Some(cancellation),
            ..self.clone()
        }
    }

    /// The board shares distinct background and interaction channels across clones.
    pub(crate) fn with_api_session(mut self) -> Result<Self, SquadError> {
        self.session = Some(Arc::new(ApiSessions {
            background: api_session::Session::new(self.executable.clone())
                .map_err(invocation_error)?,
            interaction: api_session::Session::new(self.executable.clone())
                .map_err(invocation_error)?,
        }));
        Ok(self)
    }

    pub(crate) fn interactive(&self) -> Self {
        Self {
            interactive: true,
            retained: None,
            ..self.clone()
        }
    }

    /// A long-running effect must not occupy either shared serial API session.
    pub(crate) fn one_shot(&self) -> Self {
        Self {
            session: None,
            retained: None,
            deadline: None,
            cancellation: None,
            ..self.clone()
        }
    }

    pub(crate) fn with_retained_reads(&self, retained: Arc<RetainedReads>) -> Self {
        Self {
            retained: Some(retained),
            ..self.clone()
        }
    }

    /// Context calls share their invocation deadline and the host-owned group.
    pub fn until(mut self, deadline: Instant) -> Self {
        self.deadline = Some(deadline);
        self
    }

    /// The tmt this invocation reaches, as extension dispatch supplied it.
    pub fn executable(&self) -> &Path {
        &self.executable
    }

    /// Runs `tmt <argv>` exactly as given and reports whether it exited zero. The
    /// caller owns what `argv` may contain; nothing is added, joined or parsed.
    pub fn succeeds(&self, argv: &[String]) -> Result<bool, SquadError> {
        let argv: Vec<OsString> = argv.iter().map(OsString::from).collect();
        Ok(self
            .finish(&argv, b"", TIMEOUT, tmt_invoke::EnvironmentPolicy::Inherit)?
            .success)
    }

    /// The installed `tmt` version, from `tmt --version`; `None` when it cannot be read.
    pub(crate) fn cli_version(&self) -> Option<String> {
        let finished = self
            .finish(
                &["--version".into()],
                b"",
                TIMEOUT,
                tmt_invoke::EnvironmentPolicy::Inherit,
            )
            .ok()?;
        finished
            .success
            .then(|| version_of(&finished.stdout))
            .flatten()
    }

    /// The executable selected by the extension dispatch, using the same runner as its reads.
    pub(crate) fn colab_version(&self, timeout: Duration) -> Option<semver::Version> {
        let finished = self
            .finish(
                &["colab".into(), "--version".into()],
                b"",
                timeout,
                tmt_invoke::EnvironmentPolicy::Inherit,
            )
            .ok()?;
        if !finished.success {
            return None;
        }
        std::str::from_utf8(&finished.stdout)
            .ok()?
            .trim()
            .strip_prefix("colab ")?
            .parse()
            .ok()
    }

    /// `resume --show` emits JSON itself and rejects the generic --json flag.
    pub(crate) fn resume_show(&self, identity: &str) -> Result<Value, SquadError> {
        self.call_within(
            &[
                "resume".into(),
                "--show".into(),
                "--".into(),
                identity.into(),
            ],
            b"",
            Duration::from_secs(5),
        )
    }

    /// Runs `tmt <args>` in human mode and returns its stdout text; on failure the error is its
    /// first stderr line without the `error:` mark, under the code `COMMAND_FAILED`.
    pub fn text(&self, args: &[&str]) -> Result<String, SquadError> {
        let argv: Vec<OsString> = args.iter().map(OsString::from).collect();
        let finished = self.finish(&argv, b"", TIMEOUT, tmt_invoke::EnvironmentPolicy::Inherit)?;
        if finished.success {
            return Ok(String::from_utf8_lossy(&finished.stdout).into_owned());
        }
        let stderr = String::from_utf8_lossy(&finished.stderr);
        let message = stderr
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .map(|line| {
                line.strip_prefix("error:")
                    .unwrap_or(line)
                    .trim()
                    .to_owned()
            })
            .unwrap_or_else(|| "tmt failed without a message.".to_owned());
        Err(SquadError::new("COMMAND_FAILED", message))
    }

    /// Runs `tmt <args> --json` and returns its document, or core's own error.
    pub fn json(&self, args: &[&str]) -> Result<Value, SquadError> {
        let mut argv: Vec<OsString> = args.iter().map(OsString::from).collect();
        argv.push("--json".into());
        self.call(&argv, b"")
    }

    /// Bootstrap discovery alone carries the marker through indirect Core launchers.
    pub(crate) fn config_show(&self) -> Result<Value, SquadError> {
        if std::env::var_os(CONFIG_LOOKUP).is_some() {
            return Err(unavailable(
                "Core configuration lookup reentered Ops; select the Core tmt executable.",
            ));
        }
        let overlay = [(CONFIG_LOOKUP.into(), "1".into())];
        self.call_with_environment(
            &["config".into(), "show".into(), "--json".into()],
            b"",
            tmt_invoke::EnvironmentPolicy::InheritWith(&overlay),
        )
    }

    /// Like [`Core::json`], with operands after `--` so text that starts with
    /// `-` is never read as an option.
    pub fn json_with_operands(
        &self,
        args: &[&str],
        operands: &[&str],
    ) -> Result<Value, SquadError> {
        document(self.json_finished_with_operands(args, operands, TIMEOUT)?)
    }

    /// A dedicated session keeps its request pipe open as the shell's lifeline.
    pub(crate) fn shell_run(
        &self,
        input: Value,
        stopped: &std::sync::atomic::AtomicBool,
    ) -> Result<Value, SquadError> {
        runner::assert_commands_allowed("shell API request");
        let deadline = Instant::now() + Duration::from_secs(130);
        let (mut channel, pid) = self.start_shell_channel(deadline, stopped)?;
        let unregister = || {
            shell_spawn_guard().remove(&pid);
        };
        let request = json!({"version": 1, "operation": "shell.run", "input": input}).to_string();
        let response = channel.exchange_lifeline(
            request.as_bytes(),
            deadline,
            || stopped.load(std::sync::atomic::Ordering::Acquire),
            unregister,
        );
        unregister();
        let response = response.map_err(|e| invocation_error(runner::run_error(e.kind)))?;
        let exit = channel
            .close(deadline, || false)
            .map_err(|e| invocation_error(runner::run_error(e.kind)))?;
        if !exit.status.success() {
            return Err(unavailable(
                "Shell result unconfirmed; do not retry automatically.",
            ));
        }
        let document: Value = serde_json::from_slice(&response)
            .map_err(|_| unavailable("Shell result unconfirmed; do not retry automatically."))?;
        if document.get("error").is_some() {
            resource_error(&document)
        } else {
            Ok(document)
        }
    }

    pub(crate) fn standalone_session(
        &self,
        stopped: &std::sync::atomic::AtomicBool,
    ) -> Result<StandaloneSession, SquadError> {
        runner::assert_commands_allowed("standalone command API session");
        let (channel, pid) = self.start_shell_channel(Instant::now() + TIMEOUT, stopped)?;
        Ok(StandaloneSession {
            channel: Some(channel),
            pid,
            keep_tag: None,
        })
    }

    fn start_shell_channel(
        &self,
        deadline: Instant,
        stopped: &std::sync::atomic::AtomicBool,
    ) -> Result<(tmt_invoke::LineChannel, u32), SquadError> {
        let args = ["api".into(), "--session".into()];
        let mut spawns = shell_spawn_guard();
        let channel = tmt_invoke::LineChannel::start(
            tmt_invoke::LineChannelOptions {
                program: &self.executable,
                args: &args,
                deadline,
                max_frame_bytes: OUTPUT_LIMIT,
                launch: Default::default(),
            },
            || stopped.load(std::sync::atomic::Ordering::Acquire),
        )
        .map_err(|e| invocation_error(runner::run_error(e.kind)))?;
        let pid = channel.pid().expect("started channel owns child");
        spawns.insert(pid);
        drop(spawns);
        Ok((channel, pid))
    }

    /// One versioned `tmt api` request.
    pub fn api(&self, operation: &str, input: Value) -> Result<Value, SquadError> {
        let request = json!({"version": 1, "operation": operation, "input": input});
        self.api_request(request, TIMEOUT)
    }

    /// One public API read within a caller-owned remaining budget. Cancellation
    /// keeps the same runner ownership as ordinary board reads.
    pub fn api_within(
        &self,
        operation: &str,
        input: Value,
        timeout: Duration,
    ) -> Result<Value, SquadError> {
        let request = json!({"version": 1, "operation": operation, "input": input});
        self.api_request(request, timeout)
    }

    fn api_request(&self, request: Value, timeout: Duration) -> Result<Value, SquadError> {
        runner::assert_commands_allowed("API request");
        if self
            .cancellation
            .as_ref()
            .is_some_and(runner::Cancellation::cancelled)
        {
            return Err(invocation_error(RunError::Cancelled));
        }
        if self
            .deadline
            .is_some_and(|deadline| deadline <= Instant::now())
            || (self.deadline.is_none() && timeout.is_zero())
        {
            return Err(invocation_error(RunError::Timeout));
        }
        let result = self.api_resource(&request, timeout);
        if result.is_err()
            && let Some(retained) = &self.retained
        {
            retained.clear();
        }
        result
    }

    fn api_resource(&self, request: &Value, timeout: Duration) -> Result<Value, SquadError> {
        let payload = request.to_string();
        if let Some(document) = self
            .retained
            .as_ref()
            .and_then(|retained| retained.get(&payload))
        {
            return Ok(document);
        }
        let result = self.api_resource_fresh(&payload, timeout)?;
        if let Some(retained) = &self.retained {
            retained.keep(request, &result);
        }
        Ok(result)
    }

    fn api_resource_fresh(&self, payload: &str, timeout: Duration) -> Result<Value, SquadError> {
        let Some(session) = &self.session else {
            return self.call_within(&["api".into()], payload.as_bytes(), timeout);
        };
        let deadline = self.deadline.unwrap_or_else(|| Instant::now() + timeout);
        let lane = if self.interactive {
            &session.interaction
        } else {
            &session.background
        };
        if let Some(document) = lane
            .call(payload.as_bytes(), deadline, self.cancellation.as_ref())
            .map_err(invocation_error)?
        {
            return if document.get("error").is_some() {
                resource_error(&document)
            } else {
                Ok(document)
            };
        }
        // Capability negotiation consumed part of this same request's budget.
        self.call_within(
            &["api".into()],
            payload.as_bytes(),
            deadline.saturating_duration_since(Instant::now()),
        )
    }

    /// Like [`Core::json`], bounded by `timeout` instead of the usual limit.
    pub fn json_within(&self, args: &[&str], timeout: Duration) -> Result<Value, SquadError> {
        document(self.json_finished(args, timeout)?)
    }

    /// Typed consumers may receive a partial result document on a nonzero exit.
    /// They own that command's success/error schema; ordinary calls keep theirs.
    pub(crate) fn json_finished(
        &self,
        args: &[&str],
        timeout: Duration,
    ) -> Result<runner::Finished, SquadError> {
        let mut argv: Vec<OsString> = args.iter().map(OsString::from).collect();
        argv.push("--json".into());
        self.finish(&argv, b"", timeout, tmt_invoke::EnvironmentPolicy::Inherit)
    }

    /// The same completed-output seam, with literal operands after `--`.
    pub(crate) fn json_finished_with_operands(
        &self,
        args: &[&str],
        operands: &[&str],
        timeout: Duration,
    ) -> Result<runner::Finished, SquadError> {
        let mut argv: Vec<OsString> = args.iter().map(OsString::from).collect();
        argv.extend(["--json".into(), "--".into()]);
        argv.extend(operands.iter().map(OsString::from));
        self.finish(&argv, b"", timeout, tmt_invoke::EnvironmentPolicy::Inherit)
    }

    fn call(&self, argv: &[OsString], input: &[u8]) -> Result<Value, SquadError> {
        self.call_within(argv, input, TIMEOUT)
    }

    fn call_with_environment(
        &self,
        argv: &[OsString],
        input: &[u8],
        environment: tmt_invoke::EnvironmentPolicy<'_>,
    ) -> Result<Value, SquadError> {
        document(self.finish(argv, input, TIMEOUT, environment)?)
    }

    fn call_within(
        &self,
        argv: &[OsString],
        input: &[u8],
        timeout: Duration,
    ) -> Result<Value, SquadError> {
        document(self.finish(argv, input, timeout, tmt_invoke::EnvironmentPolicy::Inherit)?)
    }

    fn finish(
        &self,
        argv: &[OsString],
        input: &[u8],
        timeout: Duration,
        environment: tmt_invoke::EnvironmentPolicy<'_>,
    ) -> Result<runner::Finished, SquadError> {
        let result = match self.deadline {
            Some(deadline) => runner::run_inherited(
                &self.executable,
                argv,
                input,
                deadline,
                OUTPUT_LIMIT,
                environment,
            ),
            None => runner::run_cancellable_with_environment(
                &self.executable,
                argv,
                input,
                timeout,
                OUTPUT_LIMIT,
                self.cancellation.as_ref(),
                environment,
            ),
        };
        result.map_err(invocation_error)
    }

    /// A write explicitly attributes its originator, including anonymous clocks.
    pub fn api_write(
        &self,
        operation: &str,
        input: Value,
        identity: Option<&str>,
    ) -> Result<Value, SquadError> {
        let mut request = json!({"version": 1, "operation": operation, "input": input});
        if let Some(identity) = identity {
            request["identity"] = json!(identity);
        } else {
            request["originator"] = json!("anonymous");
        }
        self.api_request(request, TIMEOUT)
    }

    /// `dispatch.create` for traffic no person typed (scheduled sends and their change
    /// announcements). It declares `origin: "automation"`. A Core from before origins refuses
    /// that unknown input without storing anything, so the same operation is repeated once
    /// without it: the request is then recorded as a person's, which readers already treat
    /// as the conservative `unknown`. Any other refusal is returned as is.
    pub fn dispatch_automated(
        &self,
        mut input: Value,
        identity: Option<&str>,
    ) -> Result<Value, SquadError> {
        input["origin"] = json!("automation");
        match self.api_write("dispatch.create", input.clone(), identity) {
            Err(error) if error.code == "API_INPUT_INVALID" => {
                input
                    .as_object_mut()
                    .expect("dispatch input is an object")
                    .remove("origin");
                self.api_write("dispatch.create", input, identity)
            }
            result => result,
        }
    }

    /// An automated dispatch to the one recipient in `input`, proven accepted as `queued`.
    /// An uncertain outcome (Core or storage unavailable) recovers the same operation with
    /// `dispatch.show`: nothing is created twice and a replay is never re-woken. `unqueued` is the
    /// error code and the recipient's role for a receipt that is not the single queued item for
    /// that recipient. Any other refusal keeps its code and names the operation.
    pub fn dispatch_queued(
        &self,
        input: Value,
        identity: Option<&str>,
        unqueued: (&str, &str),
    ) -> Result<Value, SquadError> {
        let operation_id = input["operationId"].as_str().unwrap_or_default().to_owned();
        let recipient = input["recipientIds"][0].clone();
        let receipt = match self.dispatch_automated(input, identity) {
            Ok(receipt) => receipt,
            Err(error)
                if matches!(
                    error.code.as_str(),
                    "SQUAD_CORE_UNAVAILABLE" | "STORAGE_UNAVAILABLE"
                ) =>
            {
                // Recover acceptance only. Missing evidence never causes another create;
                // neither this path nor a replay re-wakes input.
                self.api("dispatch.show", json!({"operationId": operation_id}))
                    .map_err(|_| {
                        SquadError::new(
                            &error.code,
                            format!(
                                "{} Operation {operation_id}; recover acceptance with dispatch.show before retrying.",
                                error.message
                            ),
                        )
                    })?
            }
            Err(error) => {
                return Err(SquadError::new(
                    &error.code,
                    format!("{} Operation {operation_id}.", error.message),
                ));
            }
        };
        if receipt["operationId"] != operation_id
            || receipt["items"].as_array().is_none_or(|items| {
                items.len() != 1
                    || items[0]["recipientId"] != recipient
                    || items[0]["acceptance"] != "queued"
                    || items[0]["requestId"].as_str().is_none()
            })
        {
            let (code, role) = unqueued;
            return Err(SquadError::new(
                code,
                format!(
                    "Operation {operation_id} was not accepted for the {role}; inspect its receipt before retrying."
                ),
            ));
        }
        Ok(receipt)
    }
}

/// The JSON document a finished call printed, or the structured error it carried.
fn document(finished: runner::Finished) -> Result<Value, SquadError> {
    let document: Value = serde_json::from_slice(&finished.stdout)
        .map_err(|_| unavailable("tmt returned no JSON document."))?;
    if finished.success {
        return Ok(document);
    }
    resource_error(&document)
}

fn invocation_error(error: RunError) -> SquadError {
    let cancelled = error == RunError::Cancelled;
    let mut failure = unavailable(match error {
        RunError::Spawn => "Could not start tmt.",
        RunError::Timeout => "tmt did not finish in time; the outcome is unknown.",
        RunError::OutputLimit => "tmt output exceeded squad's bound.",
        RunError::Io => "Could not read tmt output; the outcome is unknown.",
        RunError::Cancelled => "The board load was superseded.",
    });
    failure.cancelled = cancelled;
    failure
}

fn resource_error(document: &Value) -> Result<Value, SquadError> {
    let error = &document["error"];
    match (error["code"].as_str(), error["message"].as_str()) {
        (Some(code), Some(message)) => {
            let mut failure = SquadError::new(code, message);
            failure.current = error.get("current").cloned().map(Box::new);
            failure.signalled = error.get("signalled").and_then(Value::as_bool);
            failure.request = document["requestId"].as_str().map(str::to_owned);
            Err(failure)
        }
        _ => Err(unavailable("tmt failed without a structured error.")),
    }
}

// Config loading calls `config show` before Squad dispatches its own config
// command. Selecting this executable as Core would repeat startup recursively.
fn reject_self(selected: &Path) -> Result<(), SquadError> {
    use std::os::unix::fs::MetadataExt;

    let current = std::env::current_exe().map_err(|_| {
        unavailable("Could not identify Squad's executable to verify TMT_EXECUTABLE.")
    })?;
    let same_path = selected
        .canonicalize()
        .ok()
        .zip(current.canonicalize().ok())
        .is_some_and(|(selected, current)| selected == current);
    let same_file = std::fs::metadata(selected)
        .ok()
        .zip(std::fs::metadata(current).ok())
        .is_some_and(|(selected, current)| {
            selected.dev() == current.dev() && selected.ino() == current.ino()
        });
    if same_path || same_file {
        return Err(unavailable(
            "TMT_EXECUTABLE (or tmt on PATH) selects Squad itself; select the Core tmt executable.",
        ));
    }
    Ok(())
}

/// Keeps Core's staged result and stdin lifeline together.
pub(crate) struct StandaloneSession {
    channel: Option<tmt_invoke::LineChannel>,
    pid: u32,
    keep_tag: Option<u64>,
}

pub(crate) enum StandaloneProgress<'a> {
    Legacy,
    Text { stderr: bool, text: &'a str },
}

impl StandaloneSession {
    pub(crate) fn run(
        &mut self,
        mut input: Value,
        stopped: &std::sync::atomic::AtomicBool,
        mut progress: impl FnMut(StandaloneProgress<'_>),
    ) -> Result<Value, SquadError> {
        let channel = self.channel.as_mut().expect("open session");
        let stopped = || stopped.load(std::sync::atomic::Ordering::Acquire);
        let advertisement = channel.exchange(
            br#"{"version":1,"operation":"capabilities","input":{}}"#,
            Instant::now() + TIMEOUT,
            stopped,
        );
        let advertisement = Self::decode(advertisement).map_err(|_| {
            if stopped() {
                SquadError::new("SHELL_RUN_CANCELLED", "Command stopped before it started.")
            } else {
                unavailable("Could not verify command capabilities. Nothing was started.")
            }
        })?;
        if !advertisement.is_object() {
            return Err(unavailable(
                "Could not verify command capabilities. Nothing was started.",
            ));
        }
        let stream = advertisement["session"]["terminalCommandOutput"] == true;
        self.keep_tag = stream.then_some(0);
        if stream {
            input["stream"] = true.into();
        } else {
            progress(StandaloneProgress::Legacy);
        }
        let request =
            json!({"version": 1, "operation": "terminal.command.run", "input": input}).to_string();
        let deadline = Instant::now() + Duration::from_secs(130);
        let frame = if stream {
            let mut sequence = 0;
            let mut bytes = 0;
            channel.exchange_lifeline_frames(request.as_bytes(), deadline, stopped, |frame| {
                let invalid = || {
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "Invalid command output frame",
                    )
                };
                if frame.len() > 512 * 1024 {
                    return Err(invalid());
                }
                let mut document: Value = serde_json::from_slice(frame).map_err(|_| invalid())?;
                let object = document.as_object_mut().ok_or_else(invalid)?;
                let Some(output) = object.remove("commandOutput") else {
                    if object.get("error").is_some_and(Value::is_object)
                        || (object.get("runId").is_some_and(Value::is_string)
                            && object.get("stdout").is_some_and(Value::is_string)
                            && object.get("stderr").is_some_and(Value::is_string))
                    {
                        return Ok(true);
                    }
                    return Err(invalid());
                };
                let fields = output.as_object().ok_or_else(invalid)?;
                let text = output["text"].as_str().ok_or_else(invalid)?;
                let stderr = match output["stream"].as_str() {
                    Some("stdout") => false,
                    Some("stderr") => true,
                    _ => return Err(invalid()),
                };
                bytes += text.len();
                if !object.is_empty()
                    || fields.len() != 3
                    || output["sequence"].as_u64() != Some(sequence)
                    || text.is_empty()
                    || text.len() > 4096
                    || bytes > 4 * 65_536
                {
                    return Err(invalid());
                }
                sequence += 1;
                progress(StandaloneProgress::Text { stderr, text });
                Ok(false)
            })
        } else {
            channel.exchange_lifeline_drain(request.as_bytes(), deadline, stopped)
        };
        let session_closed = channel.pid().is_none();
        if session_closed {
            self.channel.take();
            shell_spawn_guard().remove(&self.pid);
        }
        let mut outcome = Self::decode(frame);
        if session_closed {
            if let Ok(Value::Object(result)) = &mut outcome {
                // Completion can race Stop. EOF releases the staged result,
                // so the output remains useful without a Keep action.
                result.remove("runId");
            }
        } else if outcome
            .as_ref()
            .is_err_and(|error| error.code == "SHELL_RUN_CANCELLED")
        {
            let channel = self.channel.take().expect("open session");
            let confirmed = channel
                .close(Instant::now() + Duration::from_secs(2), || false)
                .is_ok_and(|exit| exit.status.success() && exit.stdout.is_empty());
            shell_spawn_guard().remove(&self.pid);
            if !confirmed {
                return Err(unavailable(
                    "Command outcome unconfirmed. Check before retrying.",
                ));
            }
        }
        outcome
    }

    pub(crate) fn keep(&mut self, run_id: &str) -> Result<Value, SquadError> {
        let mut input = json!({"runId": run_id});
        if let Some(tag) = &mut self.keep_tag {
            *tag += 1;
            input["replyTag"] = json!(*tag);
        }
        let request =
            json!({"version": 1, "operation": "terminal.command.keep", "input": input}).to_string();
        let channel = self
            .channel
            .as_mut()
            .ok_or_else(|| SquadError::new("API_UNAVAILABLE", "The result session has closed."))?;
        let deadline = Instant::now() + TIMEOUT;
        let unconfirmed = || unavailable("Keep outcome unconfirmed. Check the saved list.");
        let result = if let Some(tag) = self.keep_tag {
            let mut resource = None;
            channel
                .exchange_lifeline_frames(
                    request.as_bytes(),
                    deadline,
                    || false,
                    |frame| {
                        let invalid = || {
                            std::io::Error::new(
                                std::io::ErrorKind::InvalidData,
                                "Unmatched Keep response",
                            )
                        };
                        let mut document: Value =
                            serde_json::from_slice(frame).map_err(|_| invalid())?;
                        let reply = document
                            .as_object_mut()
                            .filter(|object| object.len() == 1)
                            .and_then(|object| object.get_mut("keepReply"))
                            .and_then(Value::as_object_mut)
                            .ok_or_else(invalid)?;
                        if reply.len() != 2
                            || reply.get("replyTag").and_then(Value::as_u64) != Some(tag)
                        {
                            return Err(invalid());
                        }
                        resource = reply.remove("resource").filter(Value::is_object);
                        if resource.is_none() {
                            return Err(invalid());
                        }
                        Ok(true)
                    },
                )
                .map_err(|_| unconfirmed())?;
            Self::resource(resource.ok_or_else(unconfirmed)?)?
        } else {
            Self::decode(channel.exchange(request.as_bytes(), deadline, || false))?
        };
        if result["terminalId"].as_str().is_none() {
            return Err(unconfirmed());
        }
        Ok(result)
    }

    fn decode(frame: Result<Vec<u8>, tmt_invoke::InvokeError>) -> Result<Value, SquadError> {
        let bytes = frame
            .map_err(|_| unavailable("Command outcome unconfirmed. Check before retrying."))?;
        let document: Value = serde_json::from_slice(&bytes)
            .map_err(|_| unavailable("Command outcome unconfirmed. Check before retrying."))?;
        Self::resource(document)
    }

    fn resource(document: Value) -> Result<Value, SquadError> {
        if document.get("error").is_some() {
            resource_error(&document)
        } else {
            Ok(document)
        }
    }
}

impl Drop for StandaloneSession {
    fn drop(&mut self) {
        if let Some(channel) = self.channel.take() {
            let _ = channel.close(Instant::now() + TIMEOUT, || false);
            shell_spawn_guard().remove(&self.pid);
        }
    }
}

fn executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

/// The bare version `tmt --version` prints, or `tmt <version>`; anything else is unknown.
fn version_of(stdout: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(stdout).ok()?.trim();
    let version = text.strip_prefix("tmt ").unwrap_or(text);
    let plain = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+');
    (version.starts_with(|c: char| c.is_ascii_digit())
        && version.len() <= 64
        && version.chars().all(plain))
    .then(|| version.to_owned())
}

#[cfg(test)]
mod tests;
