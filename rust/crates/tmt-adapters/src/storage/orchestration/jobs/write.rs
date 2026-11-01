//! The same writer admits job configuration, exact row fences and publication.
use super::*;
use rusqlite::TransactionBehavior;

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct JobWriteFence {
    pub revision: u64,
    pub job: Option<OrchJob>,
    pub proposed_legacy: Option<LegacyJob>,
}
fn observe(
    db: &Connection,
    id: Option<&str>,
    squad: Option<&str>,
) -> Result<JobWriteFence, JobStoreError> {
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
        proposed_legacy: squad
            .map(|room| {
                next_squad_number(db, room).map(|cron_id| LegacyJob {
                    room_id: room.into(),
                    cron_id,
                })
            })
            .transpose()?,
    })
}
pub(super) fn next_squad_number(db: &Connection, room: &str) -> Result<u64, JobStoreError> {
    let previous: Option<i64> = db
        .query_row(
            "SELECT last_id FROM orchestration_job_legacy_counters WHERE room_id=?",
            [room],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| classify(error, "Read squad job counter"))?;
    previous
        .map(unsigned)
        .transpose()?
        .unwrap_or(0)
        .checked_add(1)
        .filter(|number| *number <= MAX_JS_SAFE_INTEGER)
        .ok_or_else(|| JobError::Limit.into())
}
impl Storage {
    pub(crate) fn squad_job_write_fence(&self, room: &str) -> Result<JobWriteFence, JobStoreError> {
        if !canonical_id(room) {
            return Err(JobError::Invalid.into());
        }
        self.read_job_write_fence(None, Some(room))
    }
    pub(crate) fn job_write_fence(&self, id: Option<&str>) -> Result<JobWriteFence, JobStoreError> {
        self.read_job_write_fence(id, None)
    }
    fn read_job_write_fence(
        &self,
        id: Option<&str>,
        squad: Option<&str>,
    ) -> Result<JobWriteFence, JobStoreError> {
        if id.is_some_and(|id| !canonical_id(id)) {
            return Err(JobError::Invalid.into());
        }
        let tx = self
            .connection()?
            .unchecked_transaction()
            .map_err(|error| classify(error, "Begin job preview snapshot"))?;
        let fence = observe(&tx, id, squad)?;
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
        let current = observe(
            &tx,
            id,
            expected
                .and_then(|fence| fence.proposed_legacy.as_ref())
                .map(|legacy| legacy.room_id.as_str()),
        )?;
        if expected.is_some_and(|expected| *expected != current) {
            return Err(JobError::Conflict.into());
        }
        let result = change(&tx, current.job)?;
        tx.commit()
            .map_err(|error| classify(error, "Commit job configuration write"))?;
        Ok(result)
    }
}
