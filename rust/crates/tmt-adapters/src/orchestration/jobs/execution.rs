//! Shared manual/scheduled job execution; transport follows the accepted commit.
use crate::{
    dispatch,
    orchestration::OrchReadFailure,
    storage::{JobRunInput, JobRunResult, Storage},
};
use serde_json::{Value, json};
use tmt_core::{orchestration::jobs::JobError, settings::Settings};

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
