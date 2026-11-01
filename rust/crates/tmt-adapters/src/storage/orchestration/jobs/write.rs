//! The same writer admits job configuration, exact row fences and publication.
use super::*;
use rusqlite::TransactionBehavior;

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct JobWriteFence {
    pub revision: u64,
    pub job: Option<OrchJob>,
}
fn observe(db: &Connection, id: Option<&str>) -> Result<JobWriteFence, JobStoreError> {
    let revision: Option<i64> = db
        .query_row(
            "SELECT revision FROM orchestration_settings WHERE id=1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| classify(error, "Read job configuration fence"))?;
    Ok(JobWriteFence {
        revision: revision.map(unsigned).transpose()?.unwrap_or(0),
        job: id.map(|id| read_job(db, id)).transpose()?.flatten(),
    })
}
impl Storage {
    pub(crate) fn job_write_fence(&self, id: Option<&str>) -> Result<JobWriteFence, JobStoreError> {
        if id.is_some_and(|id| !canonical_id(id)) {
            return Err(JobError::Invalid.into());
        }
        let tx = self
            .connection()?
            .unchecked_transaction()
            .map_err(|error| classify(error, "Begin job preview snapshot"))?;
        let fence = observe(&tx, id)?;
        tx.commit()
            .map_err(|error| classify(error, "Finish job preview snapshot"))?;
        Ok(fence)
    }
    pub(super) fn write_job<T>(
        &mut self,
        id: Option<&str>,
        expected: Option<&JobWriteFence>,
        change: impl FnOnce(&Connection, Option<OrchJob>) -> Result<T, JobStoreError>,
    ) -> Result<T, JobStoreError> {
        let tx = self
            .connection_mut()?
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| classify(error, "Begin job configuration write"))?;
        let current = observe(&tx, id)?;
        if expected.is_some_and(|expected| *expected != current) {
            return Err(JobError::Conflict.into());
        }
        let result = change(&tx, current.job)?;
        tx.commit()
            .map_err(|error| classify(error, "Commit job configuration write"))?;
        Ok(result)
    }
}
