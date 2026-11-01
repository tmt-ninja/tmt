//! Consumer-scoped owner retirement. Hook references survive renames and reassignments.
use super::*;

const CONSUMER: &str = "squad-cron";
fn hook(identity: &str, reference: &str) -> Value {
    json!({"consumer": CONSUMER, "identityId": identity, "reference": reference})
}
pub(super) fn register_key(core: &Core, key: &JobKey, owner: &str) -> Result<(), SquadError> {
    core.api(
        "identityHooks.register",
        hook(owner, &format!("{}:{}", key.room_id, key.id)),
    )?;
    Ok(())
}

/// One bounded page per invocation/tick. State is durable before acknowledgment;
/// announcements are best effort and may be lost on process interruption.
pub fn drain_retired(
    core: &Core,
    _config: &Config,
    _now_ms: i64,
) -> Result<Vec<SquadError>, SquadError> {
    ready(core)?;
    let page = core.api(
        "identityHooks.pending",
        json!({"consumer": CONSUMER, "limit": 16}),
    )?;
    let hooks = page["hooks"].as_array().ok_or_else(|| {
        failure(
            "SQUAD_CORE_UNAVAILABLE",
            "identityHooks.pending returned no hook page.",
        )
    })?;
    let mut warnings = Vec::new();
    for pending in hooks {
        let id = text(pending, "identityId")?;
        let reference = text(pending, "reference")?;
        let input = hook(&id, &reference);
        core.api("identityHooks.attempt", input.clone())?;
        let parts: Vec<_> = reference.split(':').collect();
        let key = match parts.as_slice() {
            [room, id] | [room, _, id] => Some(JobKey {
                room_id: (*room).into(),
                id: (*id).into(),
            }),
            _ => None,
        };
        let mut changed = None;
        if let Some(key) = key {
            let current = canonical::list(core, Some(&key.room_id))?
                .into_iter()
                .find(|current| {
                    current.job.id() == key.id && current.job.owner_id.as_deref() == Some(&id)
                });
            if let Some(current) = current {
                let mut definition = candidate(&current.job);
                definition["title"] = current.title;
                definition["ownerIdentityId"] = Value::Null;
                let applied = canonical::mutation(
                    core,
                    None,
                    json!({"kind":"job.set","jobId":current.id,"revision":current.job.revision,"candidate":definition}),
                )?;
                changed = Some(canonical::written(&applied["job"])?);
            }
        }
        if let Some(job) = changed {
            let notice = (|| {
                let selected = room(core, &job.room_id)?;
                let roster = selected.roster(core)?;
                let lead = roster
                    .iter()
                    .find(|member| member.is_lead())
                    .ok_or_else(|| {
                        failure(
                            "SQUAD_CRON_NOTICE_FAILED",
                            "The job has no owner, but its squad has no lead to notify.",
                        )
                    })?;
                let refs = core.api("references.resolve", json!({"identityIds": [&id]}))?;
                let name = refs["identities"][0]["name"].as_str().unwrap_or(&id);
                let message = notices::line(
                    &job,
                    &selected.name,
                    &format!(
                        "no owner ({name} retired) · reassign with tmt ops sq cron reassign {} {} <member>",
                        selected.name,
                        job.id()
                    ),
                );
                notices::send(core, &job, "retired", &lead.id, &message, None)
            })();
            if let Err(error) = notice {
                warnings.push(error);
            }
        }
        core.api("identityHooks.ack", input)?;
    }
    if page["pending"]
        .as_u64()
        .is_some_and(|n| n > hooks.len() as u64)
    {
        warnings.push(failure("SQUAD_CRON_RETIREMENT_PENDING", "More owner retirements remain; the next cron command or clock tick processes another page."));
    }
    Ok(warnings)
}
