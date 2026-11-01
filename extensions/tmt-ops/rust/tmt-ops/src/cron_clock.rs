//! Clock commands and lifecycle; all job/actor admission stays in cron_service.
use crate::{
    config::Config,
    core::{Core, SquadError},
    cron_service::{self as service, CronActor, JobKey},
    idle_alert,
    runner::Cancellation,
    specs,
    squad::Squad,
};
use clap::{Arg, ArgMatches, Command};
use serde_json::{Value, json};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
    },
    time::{Duration, Instant},
};
use tmt_cli_style::{Terminal, detail, message};
use tmt_ops::cron::{ClockStatus, Holder};

mod core_clock;

const EVERY: Duration = Duration::from_secs(1);

fn now() -> i64 {
    jiff::Timestamp::now().as_millisecond()
}
fn failed(code: &str, message: &str) -> SquadError {
    SquadError::new(code, message)
}

pub fn extend(command: Command) -> Command {
    let build = tmt_cli_style::command;
    command
        .subcommand(
            build(specs::CRON_SEND)
                .arg(Arg::new("squad").required(true).help("Squad name"))
                .arg(Arg::new("id").required(true).help("Job id, such as c1")),
        )
        .subcommand(build(specs::CRON_RUN))
        .subcommand(build(specs::CRON_TICK))
        .subcommand(build(specs::CRON_CLOCK))
}

fn status_document(status: ClockStatus) -> Value {
    match status {
        ClockStatus::Running(holder) => {
            json!({"state":"running","pane":holder.pane,"pid":holder.pid,"sinceMs":holder.since_ms,"expiresMs":holder.expires_ms})
        }
        ClockStatus::NoClock => json!({"state":"no clock"}),
        ClockStatus::Unknown => json!({"state":"unknown"}),
    }
}

pub(crate) fn manual_operation() -> Result<String, SquadError> {
    crate::send::new_operation()
        .map_err(|error| SquadError::new("SQUAD_CRON_CLOCK_IO", error.message))
}

/// Retains the operator and viewed revision; never silently sends a newer job.
pub fn send_now(
    core: &Core,
    key: &JobKey,
    actor: &CronActor,
    expected_revision: u64,
    operation_id: &str,
) -> Result<Value, SquadError> {
    let (job, squad, receipt) =
        service::run_manual(core, key, actor, expected_revision, operation_id)?;
    let mut document = job.document();
    document["squad"] = json!(squad);
    Ok(json!({"action":"send","job":document,"dispatch":receipt,"warnings":[]}))
}

pub fn run(core: &Core, config: &Config, parent: &ArgMatches) -> Result<Value, SquadError> {
    let (action, flags) = parent.subcommand().expect("cron action");
    if action == "send" {
        let actor = service::actor(
            core,
            flags.get_one::<String>("identity").map(String::as_str),
        )?;
        let squad = Squad::resolve(core, flags.get_one::<String>("squad").map(String::as_str))?;
        let key = JobKey {
            room_id: squad.room_id,
            id: flags.get_one::<String>("id").expect("job id").clone(),
        };
        let shown = service::show_job(core, config, &key, now())?;
        let mut sent = send_now(core, &key, &actor, shown.job.revision, &manual_operation()?)?;
        sent["warnings"] = json!(
            shown
                .warnings
                .iter()
                .map(SquadError::to_json)
                .collect::<Vec<_>>()
        );
        return Ok(sent);
    }
    if action == "run" {
        return foreground(core, config);
    }
    if action == "clock" {
        let status = status(core);
        return Ok(
            json!({"action":"clock","complete":status != ClockStatus::Unknown,"clock":status_document(status)}),
        );
    }
    foreground_mode(core, config, false)
}

/// Independent of the refresh generation, selected tab, repaint and refresh-off.
pub struct ClockWorker {
    cancellation: Cancellation,
    stop: Option<Sender<()>>,
    finished: Receiver<()>,
    thread: Option<std::thread::JoinHandle<Result<Value, SquadError>>>,
}
impl ClockWorker {
    pub fn spawn(core: Core, config: Config, foreground: bool) -> Self {
        Self::spawn_mode(core, config, foreground, true)
    }
    fn spawn_mode(core: Core, config: Config, foreground: bool, continuous: bool) -> Self {
        Self::spawn_clock(core, config, foreground, continuous, now)
    }
    fn spawn_clock(
        core: Core,
        config: Config,
        foreground: bool,
        continuous: bool,
        mut clock: impl FnMut() -> i64 + Send + 'static,
    ) -> Self {
        let cancellation = Cancellation::default();
        let reader = core.cancellable(cancellation.clone());
        let token = cancellation.clone();
        let (stop, waiting) = mpsc::channel();
        let (completed, finished) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            let result = match serve(
                &reader, &config, &waiting, &token, foreground, continuous, &mut clock,
            ) {
                Err(error) if token.cancelled() && error.was_cancelled() => {
                    Ok(json!({"action":"run","warnings":[],"complete":true}))
                }
                result => result,
            };
            let _ = completed.send(());
            result
        });
        Self {
            cancellation,
            stop: Some(stop),
            finished,
            thread: Some(thread),
        }
    }
    pub fn stop(&mut self) -> Result<Value, SquadError> {
        self.cancellation.cancel();
        self.stop.take(); // Disconnect wakes an idle receiver immediately.
        self.thread.take().map_or_else(
            || Ok(json!({"action":"run"})),
            |thread| {
                thread
                    .join()
                    .map_err(|_| failed("SQUAD_CRON_CLOCK_FAILED", "The clock worker failed."))?
            },
        )
    }
}
impl Drop for ClockWorker {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

/// Public clock evidence is projected only on the refresh/action worker.
pub(crate) fn status(core: &Core) -> ClockStatus {
    let value = match core.api("tick.status", json!({})) {
        Ok(value) => value,
        Err(_) => return ClockStatus::Unknown,
    };
    if value["schemaVersion"] != 1 {
        return ClockStatus::Unknown;
    }
    if value["state"] == "stopped" && value["holder"].is_null() {
        return ClockStatus::NoClock;
    }
    if value["state"] != "running" {
        return ClockStatus::Unknown;
    }
    let holder = &value["holder"];
    let decode = || {
        Some(Holder {
            pane: if holder["pane"].is_null() {
                None
            } else {
                Some(holder["pane"].as_str()?.to_owned())
            },
            pid: u32::try_from(holder["pid"].as_u64()?)
                .ok()
                .filter(|pid| *pid > 0)?,
            since_ms: holder["startedAtMs"].as_i64()?,
            expires_ms: holder["expiresAtMs"].as_i64()?,
            build: Some(holder["build"].as_str()?.to_owned()),
        })
    };
    decode()
        .filter(|holder| holder.since_ms > 0 && holder.expires_ms > holder.since_ms)
        .map_or(ClockStatus::Unknown, ClockStatus::Running)
}

// A natural end and a requested stop share one presentation disposition after
// joined cleanup. A UI clock refusal is a warning, never a reason to lose its
// independent idle-alert duty or a different error solely due to stop timing.
fn clock_result(
    last: &mut Value,
    result: Result<(), SquadError>,
    foreground: bool,
) -> Result<(), SquadError> {
    match result {
        Ok(()) => Ok(()),
        Err(error) if foreground || error.code == "SQUAD_CRON_CLOCK_CLEANUP_UNCONFIRMED" => {
            Err(error)
        }
        Err(error) => {
            last["complete"] = json!(false);
            last["warnings"]
                .as_array_mut()
                .unwrap()
                .push(error.to_json());
            Ok(())
        }
    }
}

fn serve(
    core: &Core,
    config: &Config,
    stop: &Receiver<()>,
    cancellation: &Cancellation,
    foreground: bool,
    continuous: bool,
    clock: &mut impl FnMut() -> i64,
) -> Result<Value, SquadError> {
    let migrated_config;
    let config = if !foreground && crate::migration::paths(core, None)?.legacy {
        // The automatic UI clock must not become another legacy migration blocker.
        // Reuse the clock's interruptible cadence without creating a lease or store.
        loop {
            match stop.recv_timeout(EVERY) {
                Err(RecvTimeoutError::Timeout) if !cancellation.cancelled() => {}
                _ => return Ok(json!({"action":"run","warnings":[],"complete":true})),
            }
            match crate::migration::retry(core) {
                Ok(paths) if !paths.legacy => break,
                Ok(_) => {}
                Err(_) if cancellation.cancelled() => {
                    return Ok(json!({"action":"run","warnings":[],"complete":true}));
                }
                Err(error) if error.code == "SQUAD_CORE_UNAVAILABLE" => {}
                Err(error) => return Err(error),
            }
        }
        migrated_config = Config::load(core)?;
        &migrated_config
    } else {
        config
    };
    service::ready(core)?;
    let mut feed = Some(core_clock::Feed::spawn(core, continuous)?);
    let mut idle = idle_alert::Watch::new();
    let zone = jiff::tz::TimeZone::system();
    let mut last = json!({"action":"tick","accepted":0,"warnings":[],"complete":true});
    let result: Result<(), SquadError> = (|| {
        while !cancellation.cancelled() {
            if let Some(current) = &feed {
                let (report, ended) = current.take();
                if let Some(report) = report {
                    last = report;
                }
                if let Some(ended) = ended {
                    let cleaned = feed.take().unwrap().stop();
                    clock_result(&mut last, cleaned.and(ended), foreground)?;
                    if foreground || !continuous {
                        break;
                    }
                    // Another Core owner or a stopped child never suppresses idle alerts.
                    // No uncertain tick is automatically restarted.
                }
            }
            if continuous {
                let warnings = idle.advance(core, config.path(), clock(), &zone, &mut || {
                    !cancellation.cancelled()
                });
                if !warnings.is_empty() {
                    last["complete"] = json!(false);
                    last["warnings"]
                        .as_array_mut()
                        .unwrap()
                        .extend(warnings.iter().map(SquadError::to_json));
                }
            }
            match stop.recv_timeout(EVERY) {
                Err(RecvTimeoutError::Timeout) => {}
                _ => break,
            }
        }
        Ok(())
    })();
    if let Some(mut owned) = feed {
        clock_result(&mut last, owned.stop(), foreground)?;
    }
    result?;
    last["action"] = json!(if continuous { "run" } else { "tick" });
    Ok(last)
}

fn foreground(core: &Core, config: &Config) -> Result<Value, SquadError> {
    foreground_mode(core, config, true)
}
fn foreground_mode(core: &Core, config: &Config, continuous: bool) -> Result<Value, SquadError> {
    let flag = Arc::new(AtomicUsize::new(0));
    let mut registrations = Vec::new();
    for signal in [
        signal_hook::consts::SIGINT,
        signal_hook::consts::SIGTERM,
        signal_hook::consts::SIGHUP,
    ] {
        match signal_hook::flag::register_usize(signal, flag.clone(), signal as usize) {
            Ok(id) => registrations.push(id),
            Err(error) => {
                for id in registrations {
                    signal_hook::low_level::unregister(id);
                }
                return Err(SquadError::new("SQUAD_CRON_CLOCK_IO", error.to_string()));
            }
        }
    }
    let mut worker = ClockWorker::spawn_mode(core.clone(), config.clone(), true, continuous);
    while flag.load(Ordering::Relaxed) == 0 {
        match worker.finished.recv_timeout(Duration::from_millis(200)) {
            Err(RecvTimeoutError::Timeout) => {}
            _ => break,
        }
    }
    let result = worker.stop();
    for id in registrations {
        signal_hook::low_level::unregister(id);
    }
    result
}

pub fn text(document: &Value, terminal: Terminal) -> String {
    text_at(document, terminal, now())
}

fn text_at(document: &Value, terminal: Terminal, now_ms: i64) -> String {
    let mut out = Vec::new();
    if document["action"] == "send" {
        let job = &document["job"];
        let _ = message::success(
            &mut out,
            terminal,
            &format!(
                "Accepted {} {}",
                job["squad"].as_str().unwrap_or_default(),
                job["id"].as_str().unwrap_or_default()
            ),
        );
    } else if document["action"] == "run" {
        let _ = message::success(&mut out, terminal, "Stopped clock");
    } else if document["action"] == "tick" {
        let _ = detail::write(
            &mut out,
            terminal,
            "cron tick",
            &[("accepted", document["accepted"].to_string())],
        );
    } else {
        let clock = &document["clock"];
        let mut fields = vec![("state", clock["state"].as_str().unwrap_or("unknown").into())];
        if clock["state"] == "running" {
            fields.extend([
                (
                    "pane",
                    clock["pane"].as_str().unwrap_or("(outside tmux)").into(),
                ),
                ("pid", clock["pid"].to_string()),
                (
                    "since",
                    clock["sinceMs"]
                        .as_i64()
                        .map(|since| {
                            tmt_cli_style::value::relative_time(
                                now_ms.saturating_sub(since).max(0) as u64
                            )
                        })
                        .unwrap_or_default(),
                ),
            ]);
        } else if clock["state"] == "no clock" {
            fields.push(("start", "tmt ops sq cron run".into()));
        }
        let _ = detail::write(&mut out, terminal, "cron clock", &fields);
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests;
