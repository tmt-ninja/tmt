//! Positive owner observations pause jobs durably. Offline presence and failed
//! reads are not missing ownership; reappearance never clears the stored pause.
use super::*;

pub(super) fn observe(
    core: &Core,
    roster: &[Member],
    id: &str,
) -> Result<Option<String>, SquadError> {
    let refs = core.api("references.resolve", json!({"identityIds": [id]}))?;
    let values = refs["identities"]
        .as_array()
        .filter(|values| values.len() == 1)
        .ok_or_else(|| {
            failure(
                "SQUAD_CORE_UNAVAILABLE",
                "Core did not return the requested owner reference.",
            )
        })?;
    let value = &values[0];
    if value["id"] != id
        || !value["found"].is_boolean()
        || (value["found"] == true && !value["retired"].is_boolean())
    {
        return Err(failure(
            "SQUAD_CORE_UNAVAILABLE",
            "Core returned an incomplete owner reference.",
        ));
    }
    if value["found"] == false
        || value["retired"] == true
        || !roster.iter().any(|member| member.id == id)
    {
        return Ok(None);
    }
    Ok(Some(text(value, "name")?))
}

pub(super) fn pause_current(
    core: &Core,
    current: &canonical::Current,
    by: &str,
) -> Result<Job, SquadError> {
    if current.job.pause.is_some() {
        return Ok(current.job.clone());
    }
    let applied = canonical::mutation(
        core,
        json!({"kind":"job.pause","jobId":current.id,"revision":current.job.revision,"by":by}),
    )?;
    canonical::written(&applied["job"])
}

/// Refresh runs in the worker. Positive owner loss is durable before projection;
/// unavailable references never become an owner-loss assertion.
pub(super) fn project_jobs(
    core: &Core,
    squad: &Squad,
    count: usize,
    now_ms: i64,
) -> Result<Vec<JobView>, SquadError> {
    let rows = canonical::list(core, Some(&squad.room_id))?;
    if rows.is_empty() {
        return Ok(vec![]);
    }
    let roster = squad.roster(core)?;
    let mut observations = std::collections::BTreeMap::new();
    let mut views = Vec::new();
    for mut current in rows {
        let name = if let Some(id) = &current.job.owner_id {
            if !observations.contains_key(id) {
                observations.insert(id.clone(), observe(core, &roster, id)?);
            }
            observations[id].clone()
        } else {
            None
        };
        let missing = current.owner_missing || name.is_none();
        if missing && let Some(id) = current.job.owner_id.as_deref() {
            current.job = pause_current(core, &current, id)?;
        }
        let mut view = project_with_owner(
            current.job,
            squad.name.clone(),
            name,
            missing,
            count,
            now_ms,
        )?;
        // Core owns the first slot, including an explicit lack of one. Later
        // dates are local schedule previews, never admission or catch-up work.
        view.next_ms.clear();
        if !missing
            && view.job.pause.is_none()
            && let Some(first) = current.next
        {
            view.next_ms.push(first);
            let mut after = first;
            for _ in 1..count.min(3) {
                let Some(next) = view.job.schedule.next_after(after)? else {
                    break;
                };
                view.next_ms.push(next);
                after = next;
            }
        }
        if missing {
            view.warnings.push(failure("SQUAD_CRON_OWNER_MISSING","Paused: owner missing from this squad. Reassign if needed, then resume explicitly."));
        }
        views.push(view);
    }
    Ok(views)
}
