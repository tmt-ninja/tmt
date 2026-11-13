//! Core's public job list as display rows: one bounded `view:"jobs"` read, no per-job read.
//! The Orchestration tab reads it; the Timers modal can move onto it later (#6370).
use super::{JobKey, schedule_text};
use crate::core::SquadError;
use serde_json::{Value, json};
use tmt_ops::cron::Schedule;

/// One page of the list; the read covers at most `PAGES` of them.
const PAGE: u64 = 64;
const PAGES: usize = 4;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JobState {
    Ready,
    /// The owner's routine holds runs, or a slot waits for its catch-up.
    Held,
    Paused,
    NoOwner,
}
/// Why a held job waits: the owner's routine and where it comes from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hold {
    /// `plan`, `focus`, `member` or `base`, as Core names the routine's source.
    pub kind: String,
    pub plan_id: Option<String>,
    /// When that source stops holding, if it is a slot.
    pub until_ms: Option<u64>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LastRun {
    pub at_ms: u64,
    /// Core's acceptance word: `queued`, `recipient_unavailable`, `route_restricted` or
    /// `held_for_person`.
    pub acceptance: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobRow {
    pub job_id: String,
    /// Core's short name (`j4`).
    pub display_id: String,
    pub revision: u64,
    pub room_id: Option<String>,
    /// The Ops selector writes use; `None` for a job made with `tmt orch job`, which stays
    /// read-only here.
    pub key: Option<JobKey>,
    pub owner_id: Option<String>,
    pub owner_name: Option<String>,
    pub title: Option<String>,
    pub message_preview: String,
    pub schedule: String,
    pub state: JobState,
    pub paused_by: Option<String>,
    pub hold: Option<Hold>,
    pub next_run_ms: Option<u64>,
    pub last_run: Option<LastRun>,
}
impl JobRow {
    /// The title, else the first line of the message.
    pub fn name(&self) -> &str {
        self.title
            .as_deref()
            .filter(|title| !title.trim().is_empty())
            .unwrap_or_else(|| self.message_preview.lines().next().unwrap_or_default())
    }
    /// When it runs next: a held job's next run is when its hold ends.
    pub fn next_ms(&self) -> Option<u64> {
        match (&self.state, &self.hold) {
            (JobState::Held, Some(hold)) => hold.until_ms.or(self.next_run_ms),
            (JobState::Paused | JobState::NoOwner, _) => None,
            _ => self.next_run_ms,
        }
    }
    fn read(row: &Value) -> Option<Self> {
        let text = |v: &Value| v.as_str().map(str::to_owned);
        let job_id = text(&row["jobId"])?;
        let target = &row["target"];
        let legacy = &row["legacy"];
        let key = match (legacy["roomId"].as_str(), legacy["cronId"].as_u64()) {
            (Some(room), Some(number)) => Some(JobKey {
                room_id: room.to_owned(),
                id: format!("c{number}"),
            }),
            _ if legacy.is_null() => None,
            _ => return None,
        };
        let state = match row["state"].as_str()? {
            "on" => JobState::Ready,
            "held" => JobState::Held,
            "paused" => JobState::Paused,
            "no_owner" => JobState::NoOwner,
            _ => return None,
        };
        let routine = &row["routine"];
        let hold = (state == JobState::Held).then(|| Hold {
            kind: routine["source"]["kind"]
                .as_str()
                .unwrap_or("base")
                .to_owned(),
            plan_id: text(&routine["source"]["planId"]),
            until_ms: routine["source"]["slot"]["endMs"].as_u64(),
        });
        let schedule = Schedule::from_document(&row["schedule"]).ok()?;
        Some(Self {
            job_id,
            display_id: text(&row["displayId"])?,
            revision: row["revision"].as_u64()?,
            room_id: text(&target["squadRoomId"]),
            key,
            owner_id: text(&target["identityId"]),
            owner_name: text(&target["identityName"]),
            title: text(&row["title"]),
            message_preview: text(&row["messagePreview"]).unwrap_or_default(),
            schedule: schedule_text(&schedule),
            paused_by: text(&row["manualPause"]["by"]),
            state,
            hold,
            next_run_ms: row["nextRunAtMs"].as_u64(),
            last_run: row["lastRun"].as_object().and_then(|run| {
                Some(LastRun {
                    at_ms: run.get("recordedAtMs")?.as_u64()?,
                    acceptance: run.get("acceptance")?.as_str()?.to_owned(),
                })
            }),
        })
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct JobRows {
    pub rows: Vec<JobRow>,
    /// More jobs exist than the bounded read covers.
    pub more: bool,
}
/// Every job Core lists, in pages, through `api` (Core's public API). An older Core without
/// the view answers `ORCH_INPUT_INVALID`: `None`, the list is not available, never an error.
pub fn read(
    api: &mut impl FnMut(&str, Value) -> Result<Value, SquadError>,
) -> Result<Option<JobRows>, String> {
    let mut rows = JobRows::default();
    let mut cursor = Value::Null;
    for page in 0..PAGES {
        let value = match api(
            "orchestration.read",
            json!({"view": "jobs", "limit": PAGE, "cursor": cursor}),
        ) {
            Ok(value) => value,
            Err(error) if page == 0 && error.code == "ORCH_INPUT_INVALID" => return Ok(None),
            Err(error) => return Err(error.message),
        };
        for row in value["jobs"].as_array().ok_or("Invalid Core job list.")? {
            rows.rows
                .push(JobRow::read(row).ok_or("Invalid Core job row.")?);
        }
        cursor = value["nextCursor"].clone();
        if cursor.is_null() {
            return Ok(Some(rows));
        }
    }
    rows.more = true;
    Ok(Some(rows))
}
