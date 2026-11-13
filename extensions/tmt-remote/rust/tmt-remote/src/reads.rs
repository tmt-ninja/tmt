//! Owner browser reads of the Ops board, the sampled limit history and Digest usage. Each read runs one fixed public
//! command through the supplied `tmt` executable and answers `{version,state,...}`; the
//! contract is "Owner browser reads" in `remote-channel-v1.md`. Nothing here grants anything:
//! the route admission is the composed shell's, and no read is a generic command endpoint.
use crate::limits;
use serde_json::{Map, Value, json};
use std::{
    collections::HashMap,
    ffi::OsString,
    path::PathBuf,
    sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError, atomic::AtomicBool},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tmt_invoke::{Cleanup, FailureKind, InvokeError, Request};

mod ops;
#[cfg(test)]
mod tests;

/// The reports `tmt digest usage report` offers; the browser derives shorter windows itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum Range {
    Day,
    Week,
    Month,
}
impl Range {
    fn parse(text: &str) -> Option<Self> {
        match text {
            "24h" => Some(Self::Day),
            "7d" => Some(Self::Week),
            "30d" => Some(Self::Month),
            _ => None,
        }
    }
    fn text(self) -> &'static str {
        match self {
            Self::Day => "24h",
            Self::Week => "7d",
            Self::Month => "30d",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum Target {
    Ops,
    Limits,
    Digest(Range),
}
impl Target {
    /// `rest` is the path after `<prefix>/x/-/`: `ops`, or `digest/24h`, `digest/7d`,
    /// `digest/30d`. The range is a path segment because the edge refuses every query string
    /// outside its two fixed forms; any other path is not a read route.
    pub(crate) fn route(rest: &str) -> Option<Self> {
        match rest {
            "ops" => Some(Self::Ops),
            "limits" => Some(Self::Limits),
            _ => rest
                .strip_prefix("digest/")
                .and_then(Range::parse)
                .map(Self::Digest),
        }
    }
    fn cap(self) -> usize {
        match self {
            Self::Ops => limits::READ_OPS_BYTES,
            Self::Limits => limits::READ_LIMITS_BYTES,
            Self::Digest(_) => limits::READ_DIGEST_BYTES,
        }
    }
}

/// Why a read has nothing to show. The closed set `remote-channel-v1.md` names; each code is
/// one empty state in the web app, and an unavailable read is never an empty list.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Reason {
    /// The extension command is absent.
    NotInstalled,
    CoreUnavailable,
    Timeout,
    /// Non-zero exit, invalid JSON or an unexpected document version.
    ReadFailed,
    TooLarge,
    /// Limits only: the board has kept no samples (it samples only while open).
    NotSampled,
}
impl Reason {
    fn code(self) -> &'static str {
        match self {
            Self::NotInstalled => "not_installed",
            Self::CoreUnavailable => "core_unavailable",
            Self::Timeout => "timeout",
            Self::ReadFailed => "read_failed",
            Self::TooLarge => "too_large",
            Self::NotSampled => "not_sampled",
        }
    }
}
fn reason_of(error: InvokeError) -> Reason {
    if matches!(error.cleanup, Cleanup::Unconfirmed(_)) {
        return Reason::CoreUnavailable;
    }
    match error.kind {
        FailureKind::Deadline => Reason::Timeout,
        FailureKind::OutputLimit(_) => Reason::TooLarge,
        _ => Reason::CoreUnavailable,
    }
}

#[derive(Default)]
struct Slot {
    running: bool,
    fresh: Option<(Instant, Arc<Vec<u8>>)>,
}
/// Browser slots are demand-driven and serve-local: one request at a time per key,
/// with a finished answer shared for `READ_FRESH`. Background summaries bypass
/// those slots; the publisher owns their cadence and separate read deadline.
pub struct Reads {
    executable: PathBuf,
    stop: Arc<AtomicBool>,
    slots: Mutex<HashMap<Target, Slot>>,
    done: Condvar,
    wait: Duration,
}
impl Reads {
    /// `executable` is the absolute public `tmt` the door was started with.
    pub fn new(executable: PathBuf, stop: Arc<AtomicBool>) -> Self {
        Self {
            executable,
            stop,
            slots: Mutex::default(),
            done: Condvar::new(),
            wait: limits::READ_WAIT,
        }
    }
    #[cfg(test)]
    fn with_wait(mut self, wait: Duration) -> Self {
        self.wait = wait;
        self
    }
    fn lock(&self) -> MutexGuard<'_, HashMap<Target, Slot>> {
        self.slots.lock().unwrap_or_else(PoisonError::into_inner)
    }
    /// The cross-machine summary reads only Ops' public roster, never cron or the broad browser projection.
    pub fn squad_summary(
        &self,
        machine_name: &str,
    ) -> Result<crate::squads::Summary, crate::error::RemoteError> {
        let board = self.json(
            &["ops", "squad", "ls", "--json"],
            Instant::now() + limits::SQUAD_SUMMARY_READ_WAIT,
        );
        let observed_at = now_ms();
        match board.and_then(|value| {
            crate::squads::Summary::from_ops(machine_name, observed_at, &value)
                .map_err(|_| Reason::ReadFailed)
        }) {
            Ok(summary) => Ok(summary),
            Err(_) => crate::squads::Summary::unavailable(machine_name, observed_at),
        }
    }
    /// The JSON body to send for `read`, waiting at most `READ_WAIT` in total.
    pub(crate) fn body(&self, read: Target) -> Arc<Vec<u8>> {
        let deadline = Instant::now() + self.wait;
        let mut slots = self.lock();
        loop {
            let slot = slots.entry(read).or_default();
            if let Some((at, body)) = &slot.fresh
                && at.elapsed() < limits::READ_FRESH
            {
                return Arc::clone(body);
            }
            if !slot.running {
                slot.running = true;
                break;
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Arc::new(unavailable(Reason::Timeout));
            }
            slots = self
                .done
                .wait_timeout(slots, left)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        drop(slots);
        let mut flight = Flight {
            reads: self,
            read,
            body: None,
        };
        let body = Arc::new(self.answer(read, deadline));
        flight.body = Some(Arc::clone(&body));
        body
    }
    fn answer(&self, read: Target, deadline: Instant) -> Vec<u8> {
        match self.fetch(read, deadline) {
            Ok(payload) => {
                let mut object = Map::new();
                object.insert("version".into(), json!(1));
                object.insert("state".into(), json!("ok"));
                object.insert("observedAtMs".into(), json!(now_ms()));
                object.extend(payload);
                let bytes = serde_json::to_vec(&Value::Object(object)).expect("JSON value");
                if bytes.len() > read.cap() {
                    return unavailable(Reason::TooLarge);
                }
                bytes
            }
            Err(reason) => unavailable(reason),
        }
    }
    fn fetch(&self, read: Target, deadline: Instant) -> Result<Map<String, Value>, Reason> {
        match read {
            Target::Ops => thread::scope(|scope| {
                let timers =
                    scope.spawn(|| self.json(&["ops", "squad", "cron", "ls", "--json"], deadline));
                let settings =
                    scope.spawn(|| self.json(&["ops", "config", "show", "--json"], deadline));
                let board = self.json(&["ops", "squad", "ls", "--json"], deadline)?;
                // Core owns the room revision; one optional snapshot serves all squads.
                let needs_rooms = board["squads"]
                    .as_array()
                    .is_some_and(|squads| !squads.is_empty());
                let rooms = scope.spawn(move || {
                    if needs_rooms {
                        self.json(&["room", "list", "--json"], deadline).ok()
                    } else {
                        None
                    }
                });
                // The projection owns roster bounds and disclosure. Only its admitted UUIDs
                // select telemetry; no new roster/config/provider reader is introduced.
                let roster = ops::project(&board, None, None).ok_or(Reason::ReadFailed)?;
                let mut seen = std::collections::HashSet::new();
                let ids: Vec<String> = roster.payload["agents"]
                    .as_array()
                    .expect("projected agents")
                    .iter()
                    .filter_map(|agent| agent["id"].as_str())
                    .filter(|id| crate::canonical::is_core_id(id) && seen.insert((*id).to_owned()))
                    .map(str::to_owned)
                    .collect();
                // One read per admitted squad room (at most READ_OPS_SQUADS), never
                // --member or the list reader. Every source shares this read's deadline.
                // Keep pipe descriptors bounded even at the 32-room board cap.
                let rooms_per_worker = roster
                    .checklist_rooms
                    .len()
                    .div_ceil(limits::READ_OPS_CHECKLIST_PARALLEL)
                    .max(1);
                let checklists: Vec<_> = roster
                    .checklist_rooms
                    .chunks(rooms_per_worker)
                    .map(|rooms| {
                        let rooms = rooms.to_vec();
                        scope.spawn(move || {
                            rooms
                                .into_iter()
                                .map(|room| {
                                    let answer = self.json(
                                        &[
                                            "ops",
                                            "squad",
                                            "checklist",
                                            "counts",
                                            "--room",
                                            &room.room_id,
                                            "--json",
                                        ],
                                        deadline,
                                    );
                                    (room, answer)
                                })
                                .collect::<Vec<_>>()
                        })
                    })
                    .collect();
                let usage: Vec<_> = ids
                    .chunks(limits::READ_OPS_USAGE_IDENTITIES)
                    .map(|ids| {
                        let ids = ids.to_vec();
                        scope.spawn(move || {
                            let request = json!({"version":1,"operation":"consumption.history",
                            "input":{"identityIds":ids,"windowsMs":[86_400_000],"maxBuckets":1}});
                            let answer =
                                self.json_input(&["api"], request.to_string().as_bytes(), deadline);
                            (ids, answer)
                        })
                    })
                    .collect();
                // Optional failures affect only their own fields. The board still renders.
                let timers = timers.join().ok().and_then(Result::ok);
                let settings = settings.join().ok().and_then(Result::ok);
                let rooms = rooms.join().ok().flatten();
                let mut payload = ops::project(&board, timers.as_ref(), rooms.as_ref())
                    .ok_or(Reason::ReadFailed)?
                    .payload;
                let idle = settings.as_ref().and_then(ops::idle_default);
                payload.insert(
                    "defaultIdleAlertMs".into(),
                    idle.map_or(Value::Null, |ms| json!(ms)),
                );
                for worker in usage {
                    if let Ok((ids, Ok(document))) = worker.join() {
                        for agent in payload
                            .get_mut("agents")
                            .and_then(Value::as_array_mut)
                            .expect("projected agents")
                        {
                            let id = agent["id"].as_str().expect("projected identity");
                            if ids.iter().any(|selected| selected == id) {
                                agent["tokens1d"] =
                                    ops::tokens1d(&document, id).unwrap_or(Value::Null);
                            }
                        }
                    }
                }
                for worker in checklists {
                    for (room, answer) in worker.join().unwrap_or_default() {
                        if let Ok(document) = answer {
                            for agent in payload
                                .get_mut("agents")
                                .and_then(Value::as_array_mut)
                                .expect("projected agents")
                            {
                                if agent["squad"] == room.squad {
                                    let id = agent["id"].as_str().expect("projected identity");
                                    agent["checklistCount"] =
                                        ops::checklist_count(&document, &room.room_id, id)
                                            .map_or(Value::Null, |open| json!(open));
                                }
                            }
                        }
                    }
                }
                Ok(payload)
            }),
            Target::Limits => {
                let history = self.json(&["ops", "limits", "--json"], deadline)?;
                if history["version"] != 1 {
                    return Err(Reason::ReadFailed);
                }
                match history["limitHistory"].as_array() {
                    None => Err(Reason::ReadFailed),
                    Some(kept) if kept.is_empty() => Err(Reason::NotSampled),
                    Some(_) => {
                        let Value::Object(payload) =
                            json!({"limitHistory": history["limitHistory"]})
                        else {
                            unreachable!("object literal")
                        };
                        Ok(payload)
                    }
                }
            }
            Target::Digest(range) => {
                let report = self.json(
                    &[
                        "digest",
                        "usage",
                        "report",
                        "--since",
                        range.text(),
                        "--json",
                    ],
                    deadline,
                )?;
                if report["version"] != 1 || report["since"] != range.text() {
                    return Err(Reason::ReadFailed);
                }
                let Value::Object(payload) = json!({"since": range.text(), "report": report})
                else {
                    unreachable!("object literal")
                };
                Ok(payload)
            }
        }
    }
    /// One fixed public command; exit 0 must print one JSON document.
    fn json(&self, argv: &[&str], deadline: Instant) -> Result<Value, Reason> {
        self.json_input(argv, &[], deadline)
    }
    fn json_input(&self, argv: &[&str], input: &[u8], deadline: Instant) -> Result<Value, Reason> {
        let args: Vec<OsString> = argv.iter().map(OsString::from).collect();
        let output = tmt_invoke::invoke(
            Request {
                program: &self.executable,
                args: &args,
                input,
                deadline,
                max_stream_bytes: limits::READ_SUBPROCESS_BYTES,
                launch: Default::default(),
            },
            Some(&self.stop),
        )
        .map_err(reason_of)?;
        let document: Option<Value> = serde_json::from_slice(&output.stdout).ok();
        if output.status.success() {
            return document.ok_or(Reason::ReadFailed);
        }
        // A fixed argv can only be a usage error when its extension command is absent.
        Err(
            match document.as_ref().and_then(|d| d["error"]["code"].as_str()) {
                Some("USAGE_ERROR") => Reason::NotInstalled,
                _ => Reason::ReadFailed,
            },
        )
    }
}

/// Ends a read: frees the key (also when the read panics) and publishes its answer.
struct Flight<'a> {
    reads: &'a Reads,
    read: Target,
    body: Option<Arc<Vec<u8>>>,
}
impl Drop for Flight<'_> {
    fn drop(&mut self) {
        let mut slots = self.reads.lock();
        let slot = slots.entry(self.read).or_default();
        slot.running = false;
        if let Some(body) = self.body.take() {
            slot.fresh = Some((Instant::now(), body));
        }
        self.reads.done.notify_all();
    }
}

fn unavailable(reason: Reason) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "version": 1,
        "state": "unavailable",
        "observedAtMs": now_ms(),
        "reason": reason.code(),
    }))
    .expect("JSON value")
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64
}
