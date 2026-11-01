//! Public Core job projection. Legacy IDs remain room-scoped selectors, never authority.
use super::*;
use std::collections::BTreeSet;

pub(super) struct Current {
    pub id: String,
    pub title: Value,
    pub job: Job,
    pub owner_missing: bool,
    pub next: Option<i64>,
}
fn malformed() -> SquadError {
    failure(
        "SQUAD_CORE_UNAVAILABLE",
        "Core returned an invalid canonical job projection.",
    )
}
fn decode(row: &Value) -> Result<Current, SquadError> {
    let id = row["jobId"]
        .as_str()
        .filter(|id| crate::config::uuid_like(id))
        .ok_or_else(malformed)?;
    let legacy = &row["legacy"];
    let room = legacy["roomId"]
        .as_str()
        .filter(|id| crate::config::uuid_like(id))
        .ok_or_else(malformed)?;
    let number = legacy["cronId"]
        .as_u64()
        .filter(|n| *n > 0)
        .ok_or_else(malformed)?;
    let definition = &row["definition"];
    if definition["squadRoomId"] != room
        || !row["revision"].is_u64()
        || !definition["message"].is_string()
    {
        return Err(malformed());
    }
    let missing = row["state"] == "no_owner";
    let owner = &definition["ownerIdentityId"];
    let pause = &definition["pause"];
    let state = if owner.is_null() {
        "no owner"
    } else if !pause.is_null() {
        "paused"
    } else {
        "on"
    };
    let job = Job::from_document(
        &json!({"id":format!("c{number}"),"roomId":room,"ownerId":owner,"message":definition["message"],"schedule":definition["schedule"],"revision":row["revision"],"pause":pause,"state":state}),
    )?;
    let next = if row["nextRunAtMs"].is_null() {
        None
    } else {
        Some(row["nextRunAtMs"].as_i64().ok_or_else(malformed)?)
    };
    Ok(Current {
        id: id.into(),
        title: definition["title"].clone(),
        job,
        owner_missing: missing,
        next,
    })
}
fn read(core: &Core, input: Value, deadline: std::time::Instant) -> Result<Value, SquadError> {
    let remaining = deadline.saturating_duration_since(std::time::Instant::now());
    if remaining.is_zero() {
        return Err(failure(
            "SQUAD_CORE_UNAVAILABLE",
            "The bounded timer projection did not finish; reload to observe current state.",
        ));
    }
    core.api_within("orchestration.read", input, remaining)
}
fn show(core: &Core, id: &str, deadline: std::time::Instant) -> Result<Current, SquadError> {
    let document = read(core, json!({"view":"job","jobId":id}), deadline)?;
    if document["schemaVersion"] != 1 || document["job"]["jobId"] != id {
        return Err(malformed());
    }
    decode(&document["job"])
}
pub(super) fn list(core: &Core, room: Option<&str>) -> Result<Vec<Current>, SquadError> {
    // Keep the existing public-port cancellation/group owner. Core::until is
    // reserved for caller-owned inherited command contexts, not board readers.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    let mut bytes = 0usize;
    let mut cursor = Value::Null;
    let mut cursors = BTreeSet::new();
    let mut ids = BTreeSet::new();
    let mut result = Vec::new();
    loop {
        let document = read(
            core,
            json!({"view":"jobs","squadRoomId":room,"limit":128,"cursor":cursor}),
            deadline,
        )?;
        if document["schemaVersion"] != 1 {
            return Err(malformed());
        }
        let rows = document["jobs"]
            .as_array()
            .filter(|rows| rows.len() <= 128)
            .ok_or_else(malformed)?;
        for row in rows {
            bytes = bytes
                .checked_add(row.to_string().len())
                .ok_or_else(malformed)?;
            if bytes > 16 * 1024 * 1024 {
                return Err(failure(
                    "SQUAD_CRON_STORE_INVALID",
                    "The projected timers exceed 16 MiB; select a squad to narrow the read.",
                ));
            }
            let id = row["jobId"]
                .as_str()
                .filter(|id| crate::config::uuid_like(id))
                .ok_or_else(malformed)?;
            if !ids.insert(id.to_owned()) {
                return Err(malformed());
            }
            if row["legacy"].is_null() {
                continue;
            }
            let current = show(core, id, deadline)?;
            if room.is_some_and(|room| current.job.room_id != room) {
                return Err(malformed());
            }
            bytes = bytes
                .checked_add(current.job.document().to_string().len())
                .ok_or_else(malformed)?;
            if bytes > 16 * 1024 * 1024 {
                return Err(failure(
                    "SQUAD_CRON_STORE_INVALID",
                    "The projected timers exceed 16 MiB; select a squad to narrow the read.",
                ));
            }
            result.push(current);
        }
        cursor = document["nextCursor"].clone();
        if cursor.is_null() {
            break;
        }
        let token = cursor
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 512)
            .ok_or_else(malformed)?;
        if rows.is_empty() || !cursors.insert(token.to_owned()) {
            return Err(malformed());
        }
    }
    Ok(result)
}
pub(super) fn selected(core: &Core, key: &JobKey, revision: u64) -> Result<Current, SquadError> {
    let current = list(core, Some(&key.room_id))?
        .into_iter()
        .find(|current| current.job.id() == key.id)
        .ok_or_else(|| {
            failure(
                "SQUAD_CRON_NOT_FOUND",
                "The job no longer exists in this squad room.",
            )
        })?;
    if current.job.revision != revision {
        return Err(failure(
            "SQUAD_CRON_REVISION_CONFLICT",
            "The job changed; reload before trying again.",
        ));
    }
    Ok(current)
}
pub(super) fn preview(core: &Core, mutation: &Value) -> Result<Value, SquadError> {
    let preview = core.api(
        "orchestration.write",
        json!({"phase":"preview","mutation":mutation}),
    )?;
    if preview["schemaVersion"] != 1
        || preview["mutation"] != *mutation
        || preview["requiresConsent"] != true
        || !preview["configurationRevision"].is_u64()
        || !preview["previewAtMs"].is_u64()
        || !preview["previewDigest"].is_string()
    {
        return Err(malformed());
    }
    Ok(preview)
}
pub(super) fn apply_preview(core: &Core, preview: &Value) -> Result<Value, SquadError> {
    let applied=core.api("orchestration.write",json!({"phase":"apply","mutation":preview["mutation"],"expectedConfigurationRevision":preview["configurationRevision"],"previewAtMs":preview["previewAtMs"],"previewDigest":preview["previewDigest"],"consent":true}))?;
    if applied["schemaVersion"] != 1
        || applied["preview"] != *preview
        || applied["requiresConsent"] != false
        || !applied["changed"].is_boolean()
        || !applied["removed"].is_boolean()
    {
        return Err(malformed());
    }
    Ok(applied)
}
pub(super) fn mutation(core: &Core, mutation: Value) -> Result<Value, SquadError> {
    let preview = preview(core, &mutation)?;
    apply_preview(core, &preview)
}

/// The apply response itself supplies the committed projection; a failed later read
/// must not make an accepted write look rolled back.
pub(super) fn written(row: &Value) -> Result<Job, SquadError> {
    let mut definition = row["definition"].clone();
    if !definition.is_object() {
        return Err(malformed());
    }
    definition["pause"] = row["manualPause"].clone();
    Ok(decode(&json!({"jobId":row["id"],"revision":row["revision"],"legacy":row["legacy"],"definition":definition,"state":if definition["ownerIdentityId"].is_null(){"no_owner"}else if definition["pause"].is_null(){"on"}else{"paused"},"nextRunAtMs":null}))?.job)
}
