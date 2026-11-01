//! Slot math and finite passes. The port revalidates policy/ownership at commit.
use super::TickError;
use crate::storage::JobListRow;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use tmt_core::orchestration::jobs::job_slot_operation_id;
#[derive(Clone)]
pub struct TickJob {
    pub job: JobListRow,
    pub routine_hold: bool,
}
pub struct TickPage {
    pub jobs: Vec<TickJob>,
    pub next_after: Option<u64>,
}
pub trait TickPort {
    fn ready(&self) -> bool;
    fn page(&mut self, after: u64, now: u64) -> Result<TickPage, TickError>;
    fn next_wake_admission(&mut self) -> Result<u64, TickError>;
    fn execute(&mut self, job: &JobListRow, slot: i64) -> Result<Value, TickError>;
}
#[derive(Default)]
pub struct TickReport {
    pub accepted: u64,
    pub recovered: u64,
    pub held: u64,
    pub waiting: u64,
    pub failures: Vec<Value>,
    pub omitted_failures: u64,
    pub complete: bool,
}
impl TickReport {
    fn failure(&mut self, job: &JobListRow, slot: i64, code: &str) {
        self.complete = false;
        if self.failures.len() < 32 {
            let recorded = job.pending.map_or(slot, |p| p.at_ms);
            self.failures.push(json!({"jobId":job.id,"slotMs":slot,"operationId":job_slot_operation_id(&job.id,job.legacy.as_ref(),recorded),"code":code}));
        } else {
            self.omitted_failures += 1;
        }
    }
    pub fn document(&self) -> Value {
        json!({"accepted":self.accepted,"recovered":self.recovered,"held":self.held,"waiting":self.waiting,"failures":self.failures,"omittedFailures":self.omitted_failures,"complete":self.complete})
    }
}
pub struct TickWindow {
    previous_ms: i64,
    latest_minute: Option<u64>,
    failed: BTreeSet<String>,
}
impl TickWindow {
    pub fn new(now: i64, standalone: bool) -> Self {
        Self {
            previous_ms: if standalone {
                now.saturating_sub(60_000)
            } else {
                now
            },
            latest_minute: None,
            failed: BTreeSet::new(),
        }
    }
    /// One invocation admits only a later wall minute. The Core clock uses the
    /// same gate for jobs, Digest and capture, including after a clock rollback.
    pub fn begin_minute(&mut self, now: u64) -> bool {
        let minute = now / 60_000;
        if self
            .latest_minute
            .is_some_and(|previous| minute <= previous)
        {
            return false;
        }
        self.latest_minute = Some(minute);
        self.failed.clear();
        true
    }
    pub fn pass(&mut self, now: u64, port: &mut impl TickPort) -> Result<TickReport, TickError> {
        if now == 0 || now > tmt_core::limits::MAX_JS_SAFE_INTEGER {
            return Err(TickError::Invalid);
        }
        let now = i64::try_from(now).map_err(|_| TickError::Invalid)?;
        let after = if now < self.previous_ms {
            now
        } else {
            self.previous_ms
                .max(now.saturating_sub(crate::orchestration::jobs::OBSERVATION_MS))
        };
        self.previous_ms = now;
        let mut report = TickReport {
            complete: true,
            ..Default::default()
        };
        let mut cursor = 0;
        loop {
            if !port.ready() {
                report.complete = false;
                return Ok(report);
            }
            let page = port.page(cursor, now as u64)?;
            for entry in page.jobs {
                let job = entry.job;
                if job.pause.is_some() || !job.owner_available || self.failed.contains(&job.id) {
                    continue;
                }
                if let Some(pending) = job.pending {
                    if entry.routine_hold || (now as u64) < port.next_wake_admission()? {
                        continue;
                    }
                    self.run(&job, pending.at_ms, port, &mut report);
                    continue;
                }
                let calendar = crate::orchestration::jobs::calendar(&job.schedule)
                    .map_err(|_| TickError::Invalid)?;
                let mut previous = after;
                while port.ready() {
                    let Some(slot) = calendar
                        .next_after(previous)
                        .map_err(|_| TickError::Invalid)?
                    else {
                        break;
                    };
                    if slot > now {
                        break;
                    }
                    if slot <= previous {
                        return Err(TickError::Invalid);
                    }
                    previous = slot;
                    if !self.run(&job, slot, port, &mut report) || entry.routine_hold {
                        break;
                    }
                }
            }
            if !port.ready() {
                report.complete = false;
                return Ok(report);
            }
            match page.next_after {
                None => return Ok(report),
                Some(next) if next > cursor => cursor = next,
                _ => return Err(TickError::Invalid),
            }
        }
    }
    fn run(
        &mut self,
        job: &JobListRow,
        slot: i64,
        port: &mut impl TickPort,
        report: &mut TickReport,
    ) -> bool {
        if !port.ready() {
            report.complete = false;
            return false;
        }
        match port.execute(job, slot) {
            Ok(v) => match v["outcome"].as_str() {
                Some("accepted") if v["created"].is_boolean() => {
                    if v["created"] == false {
                        report.recovered += 1;
                    } else {
                        report.accepted += 1;
                    }
                    true
                }
                Some("held") => {
                    report.held += 1;
                    false
                }
                Some("waiting") => {
                    report.waiting += 1;
                    false
                }
                Some("paused") => false,
                _ => {
                    let code = v["error"]["code"]
                        .as_str()
                        .filter(|s| {
                            s.len() <= 64
                                && s.bytes().all(|b| {
                                    b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_'
                                })
                        })
                        .unwrap_or("TICK_PROTOCOL_INVALID");
                    report.failure(job, slot, code);
                    self.failed.insert(job.id.clone());
                    false
                }
            },
            Err(error) => {
                report.failure(job, slot, error.code());
                self.failed.insert(job.id.clone());
                false
            }
        }
    }
}
#[cfg(test)]
mod tests;
