//! One pinned read for selected job metadata, policy and canonical outcomes.
use super::*;
use crate::storage::requests::TransactionRequests;
use std::collections::{BTreeMap, BTreeSet};
use tmt_core::{
    dispatch::DispatchReceipt,
    request::{RequestError, RequestService, history::HistoryItem},
};

pub struct JobRunEvidence {
    pub id: u64,
    pub revision: u64,
    pub slot_ms: i64,
    pub recorded_ms: u64,
    pub receipt: DispatchReceipt,
    pub request: Option<HistoryItem>,
}
pub struct JobReadPage {
    pub policy: super::super::OrchStoredState,
    pub page: JobListPage,
    /// Up to five runs per job, newest first; only the newest carries its request.
    pub recent_runs: BTreeMap<String, Vec<JobRunEvidence>>,
    pub full_message: Option<String>,
}
impl Storage {
    /// Filtering, current policy and request evidence observe one SQLite
    /// snapshot. List reads never select message or response bodies.
    pub fn read_orchestration_jobs(
        &self,
        query: JobListQuery<'_>,
        full_message: bool,
        now: u64,
    ) -> Result<JobReadPage, JobStoreError> {
        if now == 0 || now > MAX_JS_SAFE_INTEGER || full_message && query.job_id.is_none() {
            return Err(JobError::Invalid.into());
        }
        let full_id = query.job_id.map(str::to_owned);
        let receiving = super::super::ReceivingCalendar::load(self.connection()?)?;
        let tx = self
            .connection()?
            .unchecked_transaction()
            .map_err(|error| classify(error, "Begin job projection"))?;
        let page = list_jobs(&tx, query)?;
        let owners = page
            .items
            .iter()
            .filter_map(|job| job.owner_id.as_deref())
            .collect::<BTreeSet<_>>();
        let ids = serde_json::to_string(&owners).map_err(|_| JobError::Invalid)?;
        let policy = super::super::read_snapshot_selected(&tx, None, None, Some(&ids))?;
        let mut recent_runs = BTreeMap::new();
        {
            let mut records = TransactionRequests(&tx, &receiving);
            let mut requests = RequestService::new(&mut records, || now);
            let mut statement = tx
                .prepare(
                    "SELECT id,revision,slot_ms,recorded_ms,operation_id FROM orchestration_job_runs
                     WHERE job_id=? ORDER BY id DESC LIMIT 5",
                )
                .map_err(|error| classify(error, "Read recent job runs"))?;
            for job in &page.items {
                let rows = statement
                    .query_map([&job.id], |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, String>(4)?,
                        ))
                    })
                    .and_then(Iterator::collect::<Result<Vec<_>, _>>)
                    .map_err(|error| classify(error, "Read recent job runs"))?;
                let mut runs = Vec::with_capacity(rows.len());
                for (id, revision, slot_ms, recorded_ms, operation) in rows {
                    let (_, receipt) =
                        crate::storage::dispatch::read_dispatch_operation(&tx, &operation)?
                            .ok_or_else(corrupt)?;
                    if receipt.items.len() != 1 {
                        return Err(corrupt().into());
                    }
                    // Only the newest run carries its request; older runs report acceptance.
                    let request = if runs.is_empty() {
                        match requests.request_summary(&receipt.items[0].request_id) {
                            Ok(summary) => Some(summary),
                            Err(RequestError::NotFound) => None,
                            Err(error) => {
                                return Err(crate::storage::DispatchError::from(error).into());
                            }
                        }
                    } else {
                        None
                    };
                    runs.push(JobRunEvidence {
                        id: unsigned(id)?,
                        revision: unsigned(revision)?,
                        slot_ms,
                        recorded_ms: unsigned(recorded_ms)?,
                        receipt,
                        request,
                    });
                }
                if !runs.is_empty() {
                    recent_runs.insert(job.id.clone(), runs);
                }
            }
        }
        let full_message = if full_message {
            full_id
                .as_deref()
                .map(|id| read_job(&tx, id))
                .transpose()?
                .flatten()
                .map(|job| job.message)
        } else {
            None
        };
        tx.commit()
            .map_err(|error| classify(error, "Finish job projection"))?;
        Ok(JobReadPage {
            policy,
            page,
            recent_runs,
            full_message,
        })
    }
}
