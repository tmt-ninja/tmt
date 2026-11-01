//! Shared manual/scheduled job execution; transport follows the accepted commit.
use crate::{
    dispatch,
    orchestration::OrchReadFailure,
    storage::{JobRunInput, JobRunResult, Storage},
};
use serde::Deserialize;
use serde_json::{Value, json};
use tmt_core::{
    dispatch::canonical_id, limits::MAX_JS_SAFE_INTEGER, orchestration::jobs::JobError,
    request::Originator, settings::Settings,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobRunDocument {
    pub job_id: String,
    pub revision: u64,
    pub slot_ms: i64,
    pub manual_operation_id: Option<String>,
    #[serde(default)]
    pub consent: bool,
}
impl JobRunDocument {
    pub fn decode(bytes: &[u8]) -> Result<Self, JobError> {
        if bytes.len() > 8192 {
            return Err(JobError::Limit);
        }
        let d: Self = serde_json::from_slice(bytes).map_err(|_| JobError::Invalid)?;
        if !canonical_id(&d.job_id)
            || d.revision == 0
            || d.revision >= MAX_JS_SAFE_INTEGER
            || d.slot_ms.unsigned_abs() > MAX_JS_SAFE_INTEGER
            || d.manual_operation_id
                .as_ref()
                .is_some_and(|id| !canonical_id(id) || !d.consent)
        {
            return Err(JobError::Invalid);
        }
        Ok(d)
    }
    pub fn into_input(self, originator: Originator) -> JobRunInput {
        JobRunInput {
            job_id: self.job_id,
            expected_revision: self.revision,
            slot_ms: self.slot_ms,
            manual_operation_id: self.manual_operation_id,
            originator,
        }
    }
}

pub fn execute_job(
    storage: &mut Storage,
    input: JobRunInput,
    settings: &Settings,
    clock: impl Fn() -> u64,
) -> Result<Vec<u8>, OrchReadFailure> {
    let job = storage
        .orchestration_job(&input.job_id)?
        .ok_or(JobError::NotFound)?;
    if job.revision != input.expected_revision {
        return Err(JobError::Conflict.into());
    }
    let sender = match input.originator.identity_id() {
        None => "anonymous".to_owned(),
        Some(id) => {
            storage
                .find_active_identity_by_id(id)?
                .ok_or(JobError::NotAllowed)?
                .name
        }
    };
    let value = match storage.run_orchestration_job(input, settings.retention_days, clock)? {
        JobRunResult::Waiting { next_admission_ms } => {
            json!({"schemaVersion":1,"jobId":job.id,"outcome":"waiting","nextAdmissionAtMs":next_admission_ms})
        }
        JobRunResult::NoOwner => return Err(JobError::NoOwner.into()),
        JobRunResult::Paused => json!({"schemaVersion":1,"jobId":job.id,"outcome":"paused"}),
        JobRunResult::Held { slot, journal_id } => {
            json!({"schemaVersion":1,"jobId":job.id,"outcome":"held","slotMs":slot.at_ms,"journalId":journal_id})
        }
        JobRunResult::Accepted {
            receipt,
            created,
            run_id,
        } => {
            let wake = dispatch::wake_direct(
                storage,
                &receipt,
                created,
                settings,
                dispatch::DispatchWake {
                    sender: &sender,
                    text: &job.message,
                    passthrough: false,
                },
            );
            let encoded = dispatch::encode_receipt_with_wake(&receipt, wake);
            let receipt: Value =
                serde_json::from_slice(&encoded).expect("canonical dispatch receipt JSON");
            json!({"schemaVersion":1,"jobId":job.id,"outcome":"accepted","runId":run_id,"dispatch":receipt})
        }
    };
    serde_json::to_vec(&value).map_err(|_| JobError::Invalid.into())
}
