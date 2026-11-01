//! Job preview, explicit consent and exact configuration/row publication.
use super::{JobScheduleDocument, calendar};
use crate::{
    orchestration::{OrchMutationDocument as Mutation, OrchReadFailure},
    storage::{Storage, orchestration::jobs::JobWriteFence},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tmt_core::{
    content_digest, dispatch::canonical_id, limits::MAX_JS_SAFE_INTEGER, orchestration::jobs::*,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobDefinitionDocument {
    pub owner_identity_id: Option<String>,
    pub squad_room_id: Option<String>,
    pub title: Option<String>,
    pub message: String,
    pub schedule: JobScheduleDocument,
}
impl JobDefinitionDocument {
    fn definition(&self, pause: Option<JobPause>, at: u64) -> JobDefinition {
        JobDefinition {
            owner_id: self.owner_identity_id.clone(),
            room_id: self.squad_room_id.clone(),
            title: self.title.clone(),
            message: self.message.clone(),
            schedule: self.schedule.clone().into(),
            pause: pause.or_else(|| {
                self.owner_identity_id.is_none().then(|| JobPause {
                    by: "no owner".into(),
                    at_ms: at as i64,
                })
            }),
        }
    }
    pub fn from_job(job: &OrchJob) -> Self {
        Self {
            owner_identity_id: job.owner_id.clone(),
            squad_room_id: job.room_id.clone(),
            title: job.title.clone(),
            message: job.message.clone(),
            schedule: (&job.schedule).into(),
        }
    }
}
pub(crate) fn is_job(m: &Mutation) -> bool {
    matches!(
        m,
        Mutation::AddJob { .. }
            | Mutation::AddSquadJob { .. }
            | Mutation::SetJob { .. }
            | Mutation::PauseJob { .. }
            | Mutation::ResumeJob { .. }
            | Mutation::RemoveJob { .. }
    )
}
fn selector(m: &Mutation) -> Option<(&str, u64)> {
    match m {
        Mutation::SetJob {
            job_id, revision, ..
        }
        | Mutation::PauseJob {
            job_id, revision, ..
        }
        | Mutation::ResumeJob { job_id, revision }
        | Mutation::RemoveJob { job_id, revision } => Some((job_id, *revision)),
        _ => None,
    }
}
pub(crate) fn validate(m: &Mutation) -> Result<(), JobError> {
    if let Some((id, revision)) = selector(m)
        && (!canonical_id(id) || revision == 0 || revision >= MAX_JS_SAFE_INTEGER)
    {
        return Err(JobError::Invalid);
    }
    if let Mutation::AddSquadJob {
        candidate,
        paused_by,
    } = m
        && (candidate.squad_room_id.is_none()
            || paused_by.as_ref().is_some_and(|by| {
                by.is_empty() || by.len() > 128 || by.chars().any(char::is_control)
            }))
    {
        return Err(JobError::Invalid);
    }
    match m {
        Mutation::AddJob { candidate }
        | Mutation::AddSquadJob { candidate, .. }
        | Mutation::SetJob { candidate, .. } => {
            // Validation allocates no identity and publishes no preview-only ID.
            let definition = candidate.definition(None, 1);
            definition
                .clone()
                .with_identity("11111111-1111-4111-8111-111111111111".into(), 1)
                .validate()?;
            calendar(&definition.schedule)?;
        }
        Mutation::PauseJob { by, .. }
            if by.is_empty() || by.len() > 128 || by.chars().any(char::is_control) =>
        {
            return Err(JobError::Invalid);
        }
        _ if !is_job(m) => return Err(JobError::Invalid),
        _ => {}
    }
    Ok(())
}
fn definition(
    m: &Mutation,
    fence: &JobWriteFence,
    at: u64,
) -> Result<Option<JobDefinition>, JobError> {
    match m {
        Mutation::AddJob { candidate } => return Ok(Some(candidate.definition(None, at))),
        Mutation::AddSquadJob {
            candidate,
            paused_by,
        } => {
            return Ok(Some(candidate.definition(
                paused_by.as_ref().map(|by| JobPause {
                    by: by.clone(),
                    at_ms: at as i64,
                }),
                at,
            )));
        }
        _ => {}
    }
    let current = fence.job.as_ref().ok_or(JobError::NotFound)?;
    if selector(m).is_none_or(|(_, r)| r != current.revision) {
        return Err(JobError::Conflict);
    }
    let mut next = JobDefinitionDocument::from_job(current).definition(current.pause.clone(), at);
    match m {
        Mutation::SetJob { candidate, .. } => {
            next = candidate.definition(current.pause.clone(), at)
        }
        Mutation::PauseJob { by, .. } => {
            if next.pause.is_none() {
                next.pause = Some(JobPause {
                    by: by.clone(),
                    at_ms: at as i64,
                });
            }
        }
        Mutation::ResumeJob { .. } => {
            if next.owner_id.is_none() {
                return Err(JobError::NoOwner);
            }
            next.pause = None;
        }
        Mutation::RemoveJob { .. } => return Ok(None),
        _ => return Err(JobError::Invalid),
    }
    Ok(Some(next))
}
fn document(job: &OrchJob) -> Value {
    json!({"id":job.id,"displayId":job.display_id(),"revision":job.revision,"definition":JobDefinitionDocument::from_job(job),"manualPause":job.pause.as_ref().map(|p|json!({"by":p.by,"atMs":p.at_ms})),"legacy":job.legacy.as_ref().map(|l|json!({"roomId":l.room_id,"cronId":l.cron_id})),"heldSlot":job.pending.map(|p|json!({"revision":p.revision,"atMs":p.at_ms}))})
}
fn projected(m: &Mutation, fence: &JobWriteFence, at: u64) -> Result<Value, OrchReadFailure> {
    validate(m)?;
    if at == 0 || at > MAX_JS_SAFE_INTEGER {
        return Err(JobError::Invalid.into());
    }
    let after = definition(m, fence, at)?;
    if let Some(after) = &after {
        calendar(&after.schedule)?;
        after
            .clone()
            .with_identity(
                fence
                    .job
                    .as_ref()
                    .map_or("11111111-1111-4111-8111-111111111111", |j| j.id.as_str())
                    .into(),
                1,
            )
            .validate()?;
    }
    let pause = after
        .as_ref()
        .and_then(|d| d.pause.as_ref())
        .map(|p| json!({"by":p.by,"atMs":p.at_ms}));
    let after=after.map(|d|json!({"ownerIdentityId":d.owner_id,"squadRoomId":d.room_id,"title":d.title,"message":d.message,"schedule":JobScheduleDocument::from(&d.schedule),"manualPause":pause}));
    let mut p = json!({"schemaVersion":1,"configurationRevision":fence.revision,"previewAtMs":at,"mutation":m,"before":fence.job.as_ref().map(document),"after":after,"validUntilMs":null,"requiresConsent":true});
    if let Mutation::AddSquadJob { candidate, .. } = m {
        let room = candidate
            .squad_room_id
            .as_deref()
            .ok_or(JobError::Invalid)?;
        let proposed = fence
            .proposed_legacy
            .as_ref()
            .filter(|legacy| legacy.room_id == room)
            .ok_or(JobError::Invalid)?;
        p["proposedLegacy"] = json!({"roomId":proposed.room_id,"cronId":proposed.cron_id});
    }
    p["previewDigest"] = json!(content_digest::framed_sha256(
        b"tmt-orchestration-job-preview-v1",
        &serde_json::to_vec(&p).map_err(|_| JobError::Invalid)?
    ));
    Ok(p)
}
fn mutation_fence(s: &Storage, m: &Mutation) -> Result<JobWriteFence, OrchReadFailure> {
    Ok(match m {
        Mutation::AddSquadJob { candidate, .. } => s.squad_job_write_fence(
            candidate
                .squad_room_id
                .as_deref()
                .ok_or(JobError::Invalid)?,
        )?,
        _ => s.job_write_fence(selector(m).map(|(id, _)| id))?,
    })
}
pub(crate) fn preview(s: &Storage, m: &Mutation, at: u64) -> Result<Value, OrchReadFailure> {
    let fence = mutation_fence(s, m)?;
    projected(m, &fence, at)
}
pub(crate) fn apply(
    s: &mut Storage,
    m: &Mutation,
    revision: u64,
    at: u64,
    digest: &str,
    now: u64,
) -> Result<Value, OrchReadFailure> {
    if now == 0 || now > MAX_JS_SAFE_INTEGER || at > now {
        return Err(JobError::Invalid.into());
    }
    let fence = mutation_fence(s, m)?;
    let p = projected(m, &fence, at)?;
    if fence.revision != revision || p["previewDigest"].as_str() != Some(digest) {
        return Err(JobError::Conflict.into());
    }
    let candidate = definition(m, &fence, at)?;
    let result = if matches!(m, Mutation::AddJob { .. } | Mutation::AddSquadJob { .. }) {
        Some(
            s.create_job_fenced(
                candidate
                    .ok_or(JobError::Invalid)?
                    .with_identity(uuid::Uuid::new_v4().to_string(), 1),
                Some(&fence),
                matches!(m, Mutation::AddSquadJob { .. }),
            )?,
        )
    } else {
        let (id, expected) = selector(m).ok_or(JobError::Invalid)?;
        match candidate {
            None => {
                s.remove_job_fenced(id, expected, Some(&fence))?;
                None
            }
            Some(d) => Some(s.change_job_fenced(id, expected, Some(&fence), |job| {
                job.owner_id = d.owner_id;
                job.room_id = d.room_id;
                job.title = d.title;
                job.message = d.message;
                job.schedule = d.schedule;
                job.pause = d.pause;
                Ok(())
            })?),
        }
    };
    let changed = result.as_ref() != fence.job.as_ref();
    Ok(
        json!({"schemaVersion":1,"requiresConsent":false,"configurationRevision":fence.revision+u64::from(changed),"changed":changed,"job":result.as_ref().map(document),"removed":result.is_none(),"preview":p}),
    )
}
