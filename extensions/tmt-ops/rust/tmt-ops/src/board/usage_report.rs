//! A bounded background reader of public Core usage and message aggregates.
//! The shared TOK range and acquired UUID roster are its only demand; paint and
//! input project held evidence without starting commands.
mod acquire;
pub(in crate::board) mod budgets;
pub(in crate::board) mod model;
mod reader;
#[cfg(test)]
mod tests;
pub(in crate::board) mod valuation;

pub(super) use acquire::Request;
pub(super) use model::{Report, Since};
pub(super) use reader::{Delivery, Reader, Timing};

/// One held observation and its latest refresh failure.
pub enum View<'a> {
    Loading,
    Failed(&'a str),
    Report(&'a Report),
}

/// The range itself is saved by workspace preferences, never in this cache.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct State {
    report: Option<std::sync::Arc<Report>>,
    failure: Option<(Since, String)>,
    budgets: std::collections::BTreeMap<u64, Result<budgets::SpendReport, String>>,
}

impl State {
    pub(in crate::board) fn apply_budget(&mut self, delivery: budgets::Delivery, starts: &[u64]) {
        self.budgets.retain(|start, _| starts.contains(start));
        if starts.contains(&delivery.start) {
            self.budgets.insert(delivery.start, delivery.result);
        }
    }

    pub(in crate::board) fn budget(
        &self,
        start: u64,
    ) -> Option<&Result<budgets::SpendReport, String>> {
        self.budgets.get(&start)
    }

    /// Keeps the last good report when a later read fails; the rule's own time
    /// says how old it is.
    pub fn apply(&mut self, delivery: Delivery) {
        match delivery.result {
            Ok(report) => {
                self.failure = None;
                self.report = Some(std::sync::Arc::new(report));
            }
            Err(message) => self.failure = Some((delivery.since, message)),
        }
    }

    pub fn refresh_error(&self, since: Since) -> Option<&str> {
        self.failure
            .as_ref()
            .filter(|(range, _)| *range == since)
            .map(|(_, message)| message.as_str())
    }

    /// Immutable acquisition identity, shared without copying retained history.
    pub(super) fn retained_report(&self, since: Since) -> Option<std::sync::Arc<Report>> {
        self.report
            .as_ref()
            .filter(|report| report.since == since)
            .cloned()
    }

    pub fn view_for(&self, since: Since) -> View<'_> {
        if let Some(report) = self.report.as_ref().filter(|report| report.since == since) {
            return View::Report(report);
        }
        match &self.failure {
            Some((failed_since, message)) if *failed_since == since => View::Failed(message),
            _ => View::Loading,
        }
    }
}
