//! Read policy locally; each due effect crosses the canonical finite API owner.
use super::{Lease, TickError, TickJob, TickPage, TickPort};
use crate::{
    interrupt::Interrupt,
    orchestration::OrchZone,
    process::{CommandRequest, CommandRunner},
    storage::{JobListQuery, JobListRow, Storage},
};
use serde_json::{Value, json};
use std::{
    path::Path,
    time::{Duration, Instant},
};
use tmt_core::orchestration::{OrchRoutine, effective};

pub struct JobPort<'a> {
    pub storage: &'a Storage,
    pub lease: &'a Lease,
    pub interrupt: &'a Interrupt,
    pub runner: &'a dyn CommandRunner,
    pub executable: &'a Path,
    pub boundary: Instant,
    pub boundary_ms: u64,
}
impl JobPort<'_> {
    fn current(&self) -> Result<(), TickError> {
        self.lease.verify()?;
        if self.storage.schema_version()? != Storage::compiled_schema_version() {
            return Err(TickError::SchemaChanged);
        }
        Ok(())
    }
}
impl TickPort for JobPort<'_> {
    fn ready(&self) -> bool {
        !self.interrupt.is_interrupted()
            && Instant::now() < self.boundary
            && crate::request_runtime::wall_time_ms() < self.boundary_ms
    }
    fn page(&mut self, after: u64, now: u64) -> Result<TickPage, TickError> {
        self.current()?;
        let selected = self
            .storage
            .read_orchestration_jobs(
                JobListQuery {
                    after_number: after,
                    limit: 128,
                    ..Default::default()
                },
                false,
                now,
            )
            .map_err(crate::orchestration::OrchReadFailure::from)?;
        let zone = OrchZone::load(selected.policy.time_zone.as_deref())
            .map_err(crate::orchestration::OrchReadFailure::from)?;
        let mut jobs = Vec::with_capacity(selected.page.items.len());
        for job in selected.page.items {
            let routine_hold = if job.owner_available {
                let owner = job.owner_id.as_deref().ok_or(TickError::Invalid)?;
                effective(&selected.policy.snapshot, owner, now, &zone)
                    .map_err(crate::orchestration::OrchReadFailure::from)?
                    .routine
                    .value
                    == OrchRoutine::Hold
            } else {
                false
            };
            jobs.push(TickJob { job, routine_hold });
        }
        Ok(TickPage {
            jobs,
            next_after: selected.page.next_after,
        })
    }
    fn next_wake_admission(&mut self) -> Result<u64, TickError> {
        Ok(self.storage.orchestration_wake_admission_ms()?)
    }
    fn execute(&mut self, job: &JobListRow, slot: i64) -> Result<Value, TickError> {
        self.current()?;
        if !self.ready() {
            return Err(TickError::Stopped);
        }
        let input = serde_json::to_vec(&json!({"version":1,"operation":"orchestration.job.run",
            "originator":"anonymous","input":{"jobId":job.id,"revision":job.revision,"slotMs":slot}}))
            .map_err(|_| TickError::Invalid)?;
        let output = match self.runner.execute_cancellable(
            CommandRequest {
                program: self.executable.as_os_str(),
                args: &["api".into()],
                input: &input,
                deadline: Instant::now() + Duration::from_secs(15),
                max_output_bytes: 1024 * 1024,
            },
            8192,
            &mut |_| {},
            self.interrupt,
        ) {
            Ok(output) => output,
            Err(mut error) => {
                // A confirmed API refusal is useful evidence. A killed, truncated
                // or unconfirmed child never becomes a presumed unpublished run.
                if !error.cleanup_failed()
                    && let Some(output) = error.output.take()
                    && let Ok(document) = serde_json::from_slice::<Value>(&output.stdout)
                    && document["error"]["code"].is_string()
                {
                    return Ok(document);
                }
                return Err(TickError::Command(error));
            }
        };
        let document: Value =
            serde_json::from_slice(&output.stdout).map_err(|_| TickError::Protocol)?;
        if document["schemaVersion"] != 1 || document["jobId"] != job.id {
            return Err(TickError::Protocol);
        }
        Ok(document)
    }
}
