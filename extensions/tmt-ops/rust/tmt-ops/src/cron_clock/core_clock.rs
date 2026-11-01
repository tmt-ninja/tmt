//! One Core clock child, bounded frame reads and joined graceful shutdown.
use super::*;
use std::{ffi::OsString, sync::Mutex};
use tmt_invoke::{LineChannel, LineChannelOptions};
const FRAME: usize = 1024 * 1024;
const READ: Duration = Duration::from_secs(90);
const CLEANUP: Duration = Duration::from_secs(15);
#[derive(Default)]
struct State {
    latest: Option<Value>,
    ended: Option<Result<(), SquadError>>,
}
/// Only the latest projection is buffered; durable run evidence stays in Core.
pub(super) struct Feed {
    state: Arc<Mutex<State>>,
    cancellation: Cancellation,
    thread: Option<std::thread::JoinHandle<()>>,
}
struct Owned(Option<LineChannel>);
impl Drop for Owned {
    fn drop(&mut self) {
        if let Some(channel) = self.0.take() {
            let _ = channel.terminate(Instant::now() + CLEANUP);
        }
    }
}
fn error(error: impl std::fmt::Display) -> SquadError {
    failed(
        "SQUAD_CRON_CLOCK_FAILED",
        &format!("Core clock could not be confirmed: {error}"),
    )
}
fn cleanup_error(error: impl std::fmt::Display) -> SquadError {
    failed(
        "SQUAD_CRON_CLOCK_CLEANUP_UNCONFIRMED",
        &format!("Core clock cleanup could not be confirmed: {error}"),
    )
}
fn projection(value: &Value) -> Result<Value, SquadError> {
    if let (Some(code), Some(message)) = (
        value["error"]["code"].as_str(),
        value["error"]["message"].as_str(),
    ) {
        return Err(SquadError::new(code, message));
    }
    if value["schemaVersion"] != 1
        || !value["complete"].is_boolean()
        || !value["jobs"]["accepted"].is_u64()
        || !value["jobs"]["failures"].is_array()
    {
        return Err(error("invalid tick report"));
    }
    let warnings=value["jobs"]["failures"].as_array().unwrap().iter().map(|failure|{
        let code=failure["code"].as_str().unwrap_or("SQUAD_CRON_CLOCK_FAILED");
        SquadError::new(code,format!("Job {} at slot {} was not confirmed (operation {}). Inspect its retained evidence before another send.",failure["jobId"],failure["slotMs"],failure["operationId"])).to_json()
    }).collect::<Vec<_>>();
    Ok(
        json!({"action":"tick","accepted":value["jobs"]["accepted"],"complete":value["complete"],"warnings":warnings}),
    )
}
impl Feed {
    pub fn spawn(core: &Core, continuous: bool) -> Result<Self, SquadError> {
        let state = Arc::new(Mutex::new(State::default()));
        let observed = state.clone();
        let cancellation = Cancellation::default();
        let stop = cancellation.clone();
        let program = core.executable().to_owned();
        let thread = std::thread::Builder::new()
            .name("ops-core-clock".into())
            .spawn(move || {
                let result = (|| {
                    let args: Vec<OsString> = if continuous {
                        vec!["tick".into(), "run".into(), "--json".into()]
                    } else {
                        vec!["tick".into(), "--json".into()]
                    };
                    let channel = LineChannel::start(
                        LineChannelOptions {
                            program: &program,
                            args: &args,
                            deadline: Instant::now() + CLEANUP,
                            max_frame_bytes: FRAME,
                            launch: Default::default(),
                        },
                        || stop.cancelled(),
                    )
                    .map_err(error)?;
                    let mut owned = Owned(Some(channel));
                    let work: Result<bool, SquadError> = (|| {
                        let mut complete = true;
                        loop {
                            let bytes = owned
                                .0
                                .as_mut()
                                .unwrap()
                                .receive(Instant::now() + READ, || stop.cancelled());
                            let bytes = match bytes {
                                Err(_) if stop.cancelled() => break,
                                other => other.map_err(error)?,
                            };
                            let value: Value = serde_json::from_slice(&bytes).map_err(error)?;
                            let report = projection(&value)?;
                            complete = value["complete"].as_bool().unwrap();
                            observed.lock().unwrap().latest = Some(report);
                            if !continuous || value["stopped"] == true {
                                break;
                            }
                        }
                        Ok(complete)
                    })();
                    // The supervisor owns isolated component groups. Let it terminate and
                    // reap them before the neutral owner considers forced cleanup.
                    let channel = owned.0.take().unwrap();
                    let cleaned = if continuous || work.is_err() || stop.cancelled() {
                        channel.terminate(Instant::now() + CLEANUP)
                    } else {
                        channel.close(Instant::now() + CLEANUP, || false)
                    };
                    let output = cleaned.map_err(cleanup_error)?;
                    let complete = work?;
                    if !stop.cancelled()
                        && !output.status.success()
                        && (complete
                            || output.status.code != Some(1)
                            || output.status.signal.is_some())
                    {
                        return Err(error("unexpected exit after report"));
                    }
                    Ok(())
                })();
                observed.lock().unwrap().ended = Some(result);
            })
            .map_err(error)?;
        Ok(Self {
            state,
            cancellation,
            thread: Some(thread),
        })
    }
    pub fn take(&self) -> (Option<Value>, Option<Result<(), SquadError>>) {
        let mut state = self.state.lock().unwrap();
        (state.latest.take(), state.ended.take())
    }
    pub fn stop(&mut self) -> Result<(), SquadError> {
        self.cancellation.cancel();
        if let Some(thread) = self.thread.take() {
            thread
                .join()
                .map_err(|_| cleanup_error("worker panicked"))?;
        }
        if let Some(Err(error)) = self.state.lock().unwrap().ended.take() {
            return Err(error);
        }
        Ok(())
    }
}
impl Drop for Feed {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}
