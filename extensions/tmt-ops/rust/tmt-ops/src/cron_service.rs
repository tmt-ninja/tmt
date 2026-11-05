//! One management boundary for CLI, clock and board. Core remains a public port.
use crate::{
    config::Config,
    core::{Core, SquadError},
    squad::{Member, Squad},
};
use serde_json::{Value, json};
use std::path::PathBuf;
use tmt_ops::cron::{self, Job, Pause, Schedule, ScheduleInput, Store};

mod adoption;
mod canonical;
mod notices;
mod owners;
mod retirement;
pub use retirement::drain_retired;

impl From<cron::Error> for SquadError {
    fn from(error: cron::Error) -> Self {
        if error.code == cron::STORE_BUSY {
            return Self::hinted(&error.code, &error.message, " ", cron::BUSY_RETRY);
        }
        Self::new(&error.code, error.message)
    }
}
fn failure(code: &str, message: &str) -> SquadError {
    SquadError::new(code, message)
}

pub use crate::management::ManagementActor as CronActor;

/// Retained selectors never silently follow a reused room name or c-id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobKey {
    pub room_id: String,
    pub id: String,
}
impl JobKey {
    pub fn of(job: &Job) -> Self {
        Self {
            room_id: job.room_id.clone(),
            id: job.id(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct JobView {
    pub job: Job,
    pub squad: String,
    pub owner_name: Option<String>,
    pub owner_missing: bool,
    pub next_ms: Vec<i64>,
    pub warnings: Vec<SquadError>,
}
impl JobView {
    pub fn state_label(&self) -> &'static str {
        if self.owner_missing {
            "paused · owner missing"
        } else {
            self.job.state()
        }
    }
    pub fn document(&self) -> Value {
        let mut value = self.job.document();
        value["squad"] = json!(self.squad);
        value["owner"] = json!(self.owner_name);
        value["ownerMissing"] = json!(self.owner_missing);
        value["stateLabel"] = json!(self.state_label());
        value["scheduleText"] = json!(schedule_text(&self.job.schedule));
        value["nextMs"] = json!(self.next_ms);
        value["warnings"] = json!(
            self.warnings
                .iter()
                .map(SquadError::to_json)
                .collect::<Vec<_>>()
        );
        value
    }
}
pub struct List {
    pub jobs: Vec<JobView>,
    pub warnings: Vec<SquadError>,
}
pub struct Applied {
    pub job: JobView,
    pub changed: bool,
    pub warnings: Vec<SquadError>,
}

pub enum Mutation {
    Edit {
        message: Option<String>,
        schedule: Option<Schedule>,
    },
    Remove,
    Pause,
    Resume,
    Reassign {
        owner_id: String,
    },
}
pub enum Change {
    Add {
        squad: String,
        room_id: String,
        owner_id: String,
        message: String,
        schedule: Schedule,
        paused: bool,
    },
    Existing {
        key: JobKey,
        expected_revision: u64,
        mutation: Mutation,
    },
}

pub fn root(core: &Core) -> Result<PathBuf, SquadError> {
    crate::migration::state_root(core)
}
fn store(core: &Core) -> Result<(Store, crate::migration::LegacyGuard), SquadError> {
    let guard = crate::migration::state_guard(core)?;
    let store = Store::new(&root(core)?)?;
    if store.frozen_for_core()?.is_none() && store.needs_v1_migration()? {
        store.migrate_v1(&migration_rooms(core)?)?;
    }
    Ok((store, guard))
}

fn migration_rooms(core: &Core) -> Result<Vec<(String, String)>, SquadError> {
    let squads = Squad::list(core)?;
    let mut rooms = Vec::with_capacity(squads.len());
    for squad in squads {
        if !crate::config::uuid_like(&squad.room_id) {
            return Err(failure(
                "SQUAD_CRON_STORE_INVALID",
                "Core returned an invalid squad room UUID; resolve the room and retry.",
            ));
        }
        rooms.push((squad.name, squad.room_id));
    }
    Ok(rooms)
}

/// A validated in-progress rename journal can prove the former name of its
/// already-renamed room. Any independently reused name remains ambiguous.
pub(crate) fn prepare_rename_repair(
    core: &Core,
    old: &str,
    new: &str,
    room_id: &str,
) -> Result<(), SquadError> {
    let _guard = crate::migration::state_guard(core)?;
    let store = Store::new(&root(core)?)?;
    if store.frozen_for_core()?.is_none() && store.needs_v1_migration()? {
        let mut rooms = migration_rooms(core)?;
        if !rooms.iter().any(|(name, id)| name == new && id == room_id) {
            return Err(failure(
                "SQUAD_CRON_STORE_INVALID",
                "The renamed room is unavailable; resolve the squad room and retry.",
            ));
        }
        rooms.push((old.into(), room_id.into()));
        store.migrate_v1(&rooms)?;
    }
    Ok(())
}

/// Prepare the exact legacy cutover before any public job operation.
pub(crate) fn ready(core: &Core) -> Result<(), SquadError> {
    let (store, _migration) = store(core)?;
    adoption::ensure(core, &store)
}

pub fn actor(core: &Core, explicit: Option<&str>) -> Result<CronActor, SquadError> {
    crate::management::actor(core, explicit, &crate::management::CRON)
}
pub fn member(core: &Core, selector: &str) -> Result<CronActor, SquadError> {
    crate::management::member(core, selector, &crate::management::CRON)
}
fn text(value: &Value, key: &str) -> Result<String, SquadError> {
    crate::management::text(value, key, &crate::management::CRON)
}
fn active_identity(core: &Core, id: &str) -> Result<String, SquadError> {
    crate::management::active_identity(core, id, &crate::management::CRON)
}
fn room(core: &Core, expected: &str) -> Result<Squad, SquadError> {
    let shown = core.json(&["room", "show", expected])?;
    let observed = &shown["room"];
    let current = observed["name"]
        .as_str()
        .and_then(|name| name.strip_prefix("squad-"));
    if observed["id"] != expected
        || observed["retired"] != false
        || !crate::config::uuid_like(expected)
        || current.is_none_or(|name| !crate::squad::valid_name(name))
    {
        return Err(failure(
            "SQUAD_CRON_ROOM_CONFLICT",
            "The squad room is unavailable; reload the job list.",
        ));
    }
    Ok(Squad {
        name: current.expect("checked name").into(),
        room_id: expected.into(),
    })
}
fn admit(core: &Core, selected: &Squad, actor: &CronActor) -> Result<Vec<Member>, SquadError> {
    crate::management::admit(core, selected, actor, &crate::management::CRON)
}
fn owner(core: &Core, roster: &[Member], id: &str) -> Result<(), SquadError> {
    active_identity(core, id)?;
    if !roster.iter().any(|member| member.id == id) {
        return Err(failure(
            "SQUAD_NOT_A_MEMBER",
            "The job owner must be a current member of this squad.",
        ));
    }
    Ok(())
}
fn increment(job: &mut Job) -> Result<(), SquadError> {
    job.revision = job.revision.checked_add(1).ok_or_else(|| {
        failure(
            "SQUAD_CRON_REVISION_CONFLICT",
            "Job revision space exhausted.",
        )
    })?;
    Ok(())
}

/// Manual send shares management admission and an immutable locked snapshot.
/// Dispatch happens after return, never while the jobs lock is held.
pub(crate) fn authorize_write(
    core: &Core,
    key: &JobKey,
    actor: &CronActor,
    expected_revision: u64,
) -> Result<(Job, String), SquadError> {
    admitted_job(core, key, expected_revision, Some(actor))
}

fn admitted_job(
    core: &Core,
    key: &JobKey,
    expected_revision: u64,
    actor: Option<&CronActor>,
) -> Result<(Job, String), SquadError> {
    ready(core)?;
    let selected = room(core, &key.room_id)?;
    let roster = match actor {
        Some(actor) => admit(core, &selected, actor)?,
        None => selected.roster(core)?,
    };
    let current = canonical::selected(core, key, expected_revision)?;
    let id = current.job.owner_id.as_deref().ok_or_else(|| {
        failure(
            "SQUAD_CRON_NO_OWNER",
            "Reassign this job before sending or resuming it.",
        )
    })?;
    if owners::observe(core, &roster, id)?.is_none() {
        owners::pause_current(core, &current, id)?;
        return Err(failure(
            "SQUAD_NOT_A_MEMBER",
            "The job owner is missing from this squad; the job remains paused.",
        ));
    }
    Ok((current.job, selected.name))
}

/// Manual execution is a canonical Automation job run with an explicitly retained actor.
pub(crate) fn run_manual(
    core: &Core,
    key: &JobKey,
    actor: &CronActor,
    revision: u64,
    operation_id: &str,
) -> Result<(Job, String, Value), SquadError> {
    let (job, squad) = authorize_write(core, key, actor, revision)?;
    let current = canonical::selected(core, key, revision)?;
    let result = core.api_write("orchestration.job.run", json!({"jobId":current.id,"revision":revision,"slotMs":crate::status::now_ms(),"manualOperationId":operation_id,"consent":true}), Some(&actor.id))?;
    if result["schemaVersion"] != 1
        || result["outcome"] != "accepted"
        || result["jobId"] != current.id
        || !result["dispatch"].is_object()
    {
        return Err(failure(
            "SQUAD_CRON_DISPATCH_UNAVAILABLE",
            "Core did not confirm the job run. Inspect the retained operation before another send.",
        ));
    }
    Ok((job, squad, result["dispatch"].clone()))
}

fn project(
    core: &Core,
    job: Job,
    squad: String,
    count: usize,
    now_ms: i64,
) -> Result<JobView, SquadError> {
    let owner_name = job
        .owner_id
        .as_deref()
        .map(|id| active_identity(core, id))
        .transpose()?;
    let missing = job.owner_id.is_none();
    project_with_owner(job, squad, owner_name, missing, count, now_ms)
}
fn project_with_owner(
    job: Job,
    squad: String,
    owner_name: Option<String>,
    owner_missing: bool,
    count: usize,
    now_ms: i64,
) -> Result<JobView, SquadError> {
    let mut next_ms = Vec::new();
    if job.state() == "on" {
        let mut after = now_ms;
        for _ in 0..count.min(3) {
            let Some(next) = job.schedule.next_after(after)? else {
                break;
            };
            next_ms.push(next);
            after = next;
        }
    }
    Ok(JobView {
        squad,
        job,
        owner_name,
        owner_missing,
        next_ms,
        warnings: vec![],
    })
}
/// Migrate any legacy timers before the room name can change.
pub(crate) fn prepare_rename(core: &Core) -> Result<(), SquadError> {
    let (_store, _migration) = store(core)?;
    Ok(())
}

/// The membership service calls this before committing a leave/move. This is
/// departure admission, not a manual pause command; it cannot resume any job.
pub(crate) fn with_departure_pause<T>(
    core: &Core,
    room_id: &str,
    identity_id: &str,
    now_ms: i64,
    leave_or_move: impl FnOnce() -> T,
) -> Result<(Vec<String>, T), SquadError> {
    ready(core)?;
    let pause = || -> Result<Vec<String>, SquadError> {
        let mut paused = Vec::new();
        for current in canonical::list(core, Some(room_id))? {
            if current.job.owner_id.as_deref() == Some(identity_id) && current.job.pause.is_none() {
                owners::pause_current(core, &current, identity_id)?;
                paused.push(current.job.id());
            }
        }
        Ok(paused)
    };
    let paused = pause()?;
    let effect = leave_or_move();
    // Preserve the former second scan: catch a job added during departure,
    // without turning a confirmed departure into an apparent rollback.
    let _ = pause();
    let _ = now_ms; // Core stamps pauses; caller observations are not clock authority.
    Ok((paused, effect))
}

fn migration_warning(core: &Core, store: &Store) -> Result<Option<SquadError>, SquadError> {
    let board = core.paths.is_board();
    let Some(path) = store.take_migration_notice(board)? else {
        return Ok(None);
    };
    let message = format!(
        "Conflicting timers were retained in {path}; review the export before recreating them."
    );
    if board {
        core.paths.cron_notice(message);
        Ok(None)
    } else {
        Ok(Some(failure("SQUAD_CRON_MIGRATION_CONFLICT", &message)))
    }
}

/// Deferred path migration keeps the old authority readable, without retirement
/// writes, ownership pauses or Core import. Frozen/adopted sources never fall back.
fn deferred_jobs(
    core: &Core,
    scope: Option<&str>,
    count: usize,
    now_ms: i64,
) -> Result<Option<Vec<JobView>>, SquadError> {
    if !crate::migration::paths(core, None)?.legacy {
        return Ok(None);
    }
    let _guard = crate::migration::state_guard(core)?;
    let store = Store::new(&root(core)?)?;
    if store.frozen_for_core()?.is_some() {
        return Ok(None);
    }
    let squads = if let Some(name) = scope {
        vec![Squad::resolve(core, Some(name))?]
    } else {
        Squad::list(core)?
    };
    let source = store.read_before_cutover(&migration_rooms(core)?)?;
    let mut views = Vec::new();
    for squad in squads {
        let roster = squad.roster(core)?;
        for job in source
            .jobs()
            .iter()
            .filter(|job| job.room_id == squad.room_id)
        {
            let name = job
                .owner_id
                .as_deref()
                .map(|id| owners::observe(core, &roster, id))
                .transpose()?
                .flatten();
            let missing = name.is_none();
            views.push(project_with_owner(
                job.clone(),
                squad.name.clone(),
                name,
                missing,
                if missing { 0 } else { count },
                now_ms,
            )?);
        }
    }
    Ok(Some(views))
}

pub fn list_jobs(
    core: &Core,
    config: &Config,
    scope: Option<&str>,
    now_ms: i64,
) -> Result<List, SquadError> {
    if let Some(jobs) = deferred_jobs(core, scope, 1, now_ms)? {
        return Ok(List {
            jobs,
            warnings: vec![],
        });
    }
    ready(core)?;
    let mut warnings = drain_retired(core, config, now_ms)?;
    let squads = if let Some(name) = scope {
        vec![Squad::resolve(core, Some(name))?]
    } else {
        Squad::list(core)?
    };
    let mut jobs = Vec::new();
    for squad in squads {
        jobs.extend(owners::project_jobs(core, &squad, 1, now_ms)?);
    }
    let (store, _migration) = store(core)?;
    warnings.extend(migration_warning(core, &store)?);
    Ok(List { jobs, warnings })
}
pub fn show_job(
    core: &Core,
    config: &Config,
    key: &JobKey,
    now_ms: i64,
) -> Result<JobView, SquadError> {
    if let Some(jobs) = deferred_jobs(core, None, 3, now_ms)? {
        return jobs
            .into_iter()
            .find(|view| view.job.room_id == key.room_id && view.job.id() == key.id)
            .ok_or_else(|| {
                failure(
                    "SQUAD_CRON_NOT_FOUND",
                    "The job does not exist in this squad room.",
                )
            });
    }
    ready(core)?;
    let warnings = drain_retired(core, config, now_ms)?;
    let squad = room(core, &key.room_id)?;
    let mut view = owners::project_jobs(core, &squad, 3, now_ms)?
        .into_iter()
        .find(|view| view.job.id() == key.id)
        .ok_or_else(|| {
            failure(
                "SQUAD_CRON_NOT_FOUND",
                "The job does not exist in this squad room.",
            )
        })?;
    view.warnings.extend(warnings);
    let (store, _migration) = store(core)?;
    view.warnings.extend(migration_warning(core, &store)?);
    Ok(view)
}
fn candidate(job: &Job) -> Value {
    json!({"ownerIdentityId":job.owner_id,"squadRoomId":job.room_id,"title":null,"message":job.message,"schedule":job.schedule.document()})
}
fn valid_message(message: &str) -> Result<(), SquadError> {
    if message.trim().is_empty() || message.len() > 1048576 {
        return Err(failure(
            "SQUAD_CRON_MESSAGE_INVALID",
            "Use a nonempty message of at most 1 MiB.",
        ));
    }
    Ok(())
}
pub fn apply(
    core: &Core,
    config: &Config,
    actor: &CronActor,
    change: Change,
    now_ms: i64,
) -> Result<Applied, SquadError> {
    ready(core)?;
    let mut warnings = drain_retired(core, config, now_ms)?;
    let room_id = match &change {
        Change::Add { room_id, .. } => room_id,
        Change::Existing { key, .. } => &key.room_id,
    };
    let selected = room(core, room_id)?;
    let roster = admit(core, &selected, actor)?;
    let (before, mut after, action, mutation) = match change {
        Change::Add {
            room_id,
            owner_id,
            message,
            schedule,
            paused,
            ..
        } => {
            owner(core, &roster, &owner_id)?;
            valid_message(&message)?;
            let mut job = Job::new(room_id, owner_id, message, schedule);
            if paused {
                job.pause = Some(Pause {
                    by: actor.id.clone(),
                    at_ms: now_ms,
                });
            }
            let mutation = json!({"kind":"job.addSquad","candidate":candidate(&job),"pausedBy":job.pause.as_ref().map(|p|p.by.clone())});
            (None, job, "added", mutation)
        }
        Change::Existing {
            key,
            expected_revision,
            mutation,
        } => {
            let mut current = canonical::selected(core, &key, expected_revision)?;
            let before = current.job.clone();
            let mut job = before.clone();
            let (action, kind) = match mutation {
                Mutation::Edit { message, schedule } => {
                    if let Some(message) = message {
                        valid_message(&message)?;
                        job.message = message;
                    }
                    if let Some(schedule) = schedule {
                        job.schedule = schedule;
                    }
                    ("edited", "job.set")
                }
                Mutation::Remove => ("removed", "job.rm"),
                Mutation::Pause => ("paused", "job.pause"),
                Mutation::Resume => {
                    let id = job.owner_id.as_deref().ok_or_else(|| {
                        failure(
                            "SQUAD_CRON_NO_OWNER",
                            "Reassign this job before resuming it.",
                        )
                    })?;
                    if owners::observe(core, &roster, id)?.is_none() {
                        owners::pause_current(core, &current, id)?;
                        return Err(failure(
                            "SQUAD_NOT_A_MEMBER",
                            "The owner is missing from this squad; the job stays paused.",
                        ));
                    }
                    ("resumed", "job.resume")
                }
                Mutation::Reassign { owner_id } => {
                    owner(core, &roster, &owner_id)?;
                    if job.pause.is_none()
                        && let Some(old) = &job.owner_id
                        && owners::observe(core, &roster, old)?.is_none()
                    {
                        let paused = owners::pause_current(core, &current, old)?;
                        job.pause = paused.pause.clone();
                        current.job = paused;
                    }
                    job.owner_id = Some(owner_id);
                    ("reassigned", "job.set")
                }
            };
            let mut update =
                json!({"kind":kind,"jobId":current.id,"revision":current.job.revision});
            if kind == "job.set" {
                update["candidate"] = candidate(&job);
                update["candidate"]["title"] = current.title;
            }
            if kind == "job.pause" {
                update["by"] = json!(actor.id);
            }
            (Some(before), job, action, update)
        }
    };
    let preview = canonical::preview(core, &mutation)?;
    if matches!(action, "added" | "reassigned") {
        let key = if action == "added" {
            let proposed = &preview["proposedLegacy"];
            let number = proposed["cronId"]
                .as_u64()
                .filter(|number| *number > 0)
                .ok_or_else(|| {
                    failure(
                        "SQUAD_CORE_UNAVAILABLE",
                        "Core did not propose a squad job number.",
                    )
                })?;
            if proposed["roomId"] != selected.room_id {
                return Err(failure(
                    "SQUAD_CRON_ROOM_CONFLICT",
                    "Core proposed a different squad room.",
                ));
            }
            JobKey {
                room_id: selected.room_id.clone(),
                id: format!("c{number}"),
            }
        } else {
            JobKey::of(&after)
        };
        if let Some(owner) = &after.owner_id {
            retirement::register_key(core, &key, owner)?;
        }
    }
    let applied = canonical::apply_preview(core, &preview)?;
    let changed = applied["changed"].as_bool().unwrap();
    if action == "removed" {
        if changed {
            increment(&mut after)?;
        }
    } else {
        after = canonical::written(&applied["job"])?;
    }
    if changed {
        warnings.extend(notices::changed(
            core,
            actor,
            before.as_ref(),
            &after,
            &selected.name,
            action,
        ));
    }
    let job = match project(core, after.clone(), selected.name.clone(), 3, now_ms) {
        Ok(view) => view,
        Err(error) => {
            warnings.push(error);
            JobView {
                squad: selected.name,
                job: after,
                owner_name: None,
                owner_missing: false,
                next_ms: vec![],
                warnings: vec![],
            }
        }
    };
    match store(core) {
        Ok((store, _migration)) => match migration_warning(core, &store) {
            Ok(warning) => warnings.extend(warning),
            Err(error) => warnings.push(error),
        },
        Err(error) => warnings.push(error),
    }
    Ok(Applied {
        job,
        changed,
        warnings,
    })
}

pub fn schedule_text(schedule: &Schedule) -> String {
    let value = schedule.document();
    match value["kind"].as_str() {
        Some("every") => {
            let seconds = value["seconds"].as_i64().unwrap_or_default();
            let (n, unit) = [(86400, "d"), (3600, "h"), (60, "m"), (1, "s")]
                .into_iter()
                .find(|(scale, _)| seconds % scale == 0)
                .map(|(scale, unit)| (seconds / scale, unit))
                .expect("seconds fit");
            let from = value["from"]
                .as_str()
                .map(|v| format!(" from {v}"))
                .unwrap_or_default();
            format!("every {n}{unit}{from}")
        }
        Some("at") => format!(
            "{} {}",
            value["on"].as_str().unwrap_or("daily"),
            value["at"].as_str().unwrap_or_default()
        ),
        _ => format!("cron {}", value["expression"].as_str().unwrap_or_default()),
    }
}

/// The inverse of [`schedule_text`], for the board's one-line editor:
/// `every 3h [from 09:00]`, `daily 23:00`, `weekdays 09:00`, `mon,thu 10:00`,
/// or a five-field cron expression (optionally after `cron `). Parsing is
/// delegated to `Schedule::parse`, which owns grammar, zones and next-slot math.
pub fn parse_schedule_text(text: &str, zone: &str, now_ms: i64) -> Result<Schedule, SquadError> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let input = match words.as_slice() {
        ["every", duration] => ScheduleInput::Every {
            duration,
            from: None,
        },
        ["every", duration, "from", from] => ScheduleInput::Every {
            duration,
            from: Some(from),
        },
        ["daily", time] => ScheduleInput::At { time, on: None },
        ["cron", ..] if words.len() == 6 => ScheduleInput::Cron(text.trim_start()[4..].trim()),
        [on, time] if time.contains(':') => ScheduleInput::At { time, on: Some(on) },
        _ if words.len() == 5 => ScheduleInput::Cron(text.trim()),
        _ => {
            return Err(failure(
                "SQUAD_CRON_SCHEDULE_INVALID",
                "Use every 30m [from 09:00], daily 09:00, weekdays 09:00, mon,thu 10:00 or a five-field cron expression.",
            ));
        }
    };
    Ok(Schedule::parse(input, zone, now_ms)?)
}

#[cfg(test)]
pub(crate) mod test_support;
#[cfg(test)]
mod tests;
