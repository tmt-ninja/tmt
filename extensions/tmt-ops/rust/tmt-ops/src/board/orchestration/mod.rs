//! Orchestration owns held public observations and local view state; Core owns every policy.
mod input;
mod load;
mod model;
pub(super) mod surface;
#[cfg(test)]
mod tests;
pub(in crate::board) mod write;
pub(in crate::board) use load::{Observation, Read};
use model::{Query, Snapshot};
use std::sync::Arc;

pub(in crate::board) struct State {
    pub query: Query,
    pub follow_now: bool,
    pub selected: Option<String>,
    /// The matrix column: the recipient of the selected route.
    pub target: Option<String>,
    /// The last journal read, for the member it was read for.
    pub why: Option<(String, Vec<String>)>,
    pub plans: bool,
    pub plan_selection: Option<String>,
    cursor: Option<u64>,
    pub hits: std::cell::RefCell<Vec<(ratatui::layout::Rect, input::Control)>>,
    report: Option<(Query, Arc<Snapshot>)>,
    pub failure: Option<String>,
    pub unavailable: bool,
}
impl Default for State {
    fn default() -> Self {
        Self {
            query: Query::default(),
            follow_now: true,
            selected: None,
            target: None,
            why: None,
            plans: false,
            plan_selection: None,
            report: None,
            failure: None,
            unavailable: false,
            cursor: None,
            hits: Default::default(),
        }
    }
}
impl State {
    pub fn read(&self) -> Read {
        Read {
            query: self.query.clone(),
            cursor: self.cursor,
        }
    }
    pub fn observe_cursor(&mut self, cursor: Option<u64>) {
        self.cursor = cursor;
    }
    pub fn invalidate(&self) {
        self.hits.borrow_mut().clear();
    }
    pub fn snapshot(&self) -> Option<&Snapshot> {
        self.report
            .as_ref()
            .filter(|(query, _)| query == &self.query)
            .map(|(_, report)| report.as_ref())
    }
    pub fn apply(&mut self, read: Read, observation: Observation) {
        if read != self.read() {
            return;
        }
        match observation {
            Observation::Ready(snapshot) => {
                if self.selected.as_ref().is_none_or(|id| {
                    !snapshot
                        .document
                        .members
                        .iter()
                        .any(|member| &member.identity_id == id)
                }) {
                    self.selected = snapshot
                        .document
                        .members
                        .first()
                        .map(|member| member.identity_id.clone());
                }
                if self.target.as_ref().is_none_or(|id| {
                    !snapshot
                        .document
                        .members
                        .iter()
                        .any(|member| &member.identity_id == id)
                }) {
                    self.target = snapshot
                        .document
                        .members
                        .iter()
                        .map(|member| &member.identity_id)
                        .find(|id| Some(*id) != self.selected.as_ref())
                        .cloned();
                }
                if self.plan_selection.as_ref().is_none_or(|id| {
                    !snapshot
                        .document
                        .plans
                        .iter()
                        .any(|plan| plan["id"].as_str() == Some(id))
                }) {
                    self.plan_selection = snapshot
                        .document
                        .plans
                        .first()
                        .and_then(|plan| plan["id"].as_str().map(str::to_owned));
                }
                self.report = Some((read.query, Arc::new(snapshot)));
                self.failure = None;
                self.unavailable = false;
            }
            Observation::Unavailable => {
                self.unavailable = true;
                self.failure = None;
                self.report = None;
            }
            Observation::Failed(error) => {
                self.failure = Some(error);
            }
        }
    }
    pub fn tick(&mut self, now: u64) -> bool {
        if !self.follow_now {
            return false;
        }
        let boundary = self
            .snapshot()
            .into_iter()
            .flat_map(|s| {
                s.document
                    .members
                    .iter()
                    .filter_map(|m| m.next_change_at_ms)
                    .chain(
                        s.document
                            .timeline
                            .iter()
                            .flat_map(|i| [i.start_ms, i.end_ms]),
                    )
            })
            .filter(|at| *at > self.query.at_ms)
            .min();
        if boundary.is_some_and(|at| now >= at) {
            self.query.at_ms = now;
            true
        } else {
            false
        }
    }
}
