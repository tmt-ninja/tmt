//! Orchestration owns held public observations and local view state; Core owns every policy.
mod input;
mod load;
mod model;
pub(super) mod surface;
#[cfg(test)]
pub(in crate::board) mod tests;
pub(in crate::board) mod why;
pub(in crate::board) mod write;
pub(in crate::board) use load::{Observation, Read};
use model::{Query, Snapshot};
use std::sync::Arc;

/// The left column's sections, in Tab order.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(in crate::board) enum Section {
    /// Who may message whom, the Members table or the plans list.
    #[default]
    Routes,
    Talks,
    Jobs,
}
pub(in crate::board) struct State {
    pub query: Query,
    pub section: Section,
    /// The selected job, by Core's job UUID.
    pub job: Option<String>,
    /// The selected job's full message, read when it was selected: (job UUID, message).
    pub job_message: Option<(String, String)>,
    pub follow_now: bool,
    pub selected: Option<String>,
    /// The matrix column: the recipient of the selected route.
    pub target: Option<String>,
    /// The last journal read, for the member it was read for.
    /// The Why dialog, while open.
    pub why: Option<std::cell::RefCell<why::Why>>,
    pub plans: bool,
    pub plan_selection: Option<String>,
    /// `⏎` on a plan: the matrix and member rows show only the members it applies to at the
    /// selected time. Verdicts still come from every plan.
    pub only_plan: Option<String>,
    cursor: Option<u64>,
    pub hits: std::cell::RefCell<Vec<(ratatui::layout::Rect, input::Control)>>,
    /// The last paint was too small to show the tab: its footer then offers moves only.
    pub enlarge: std::cell::Cell<bool>,
    report: Option<(Query, Arc<Snapshot>)>,
    pub failure: Option<String>,
    pub unavailable: bool,
    /// What the last time step could not do (`no earlier change`), shown until the next step.
    pub note: Option<String>,
    /// A step past the held range: the one read it asked for, and what to keep if it finds nothing.
    edge: Option<Edge>,
}
/// A step that reads the neighbouring range: its direction, the instant it started from and the
/// observation to restore when that range holds no further change.
struct Edge {
    later: bool,
    from_ms: u64,
    /// Whether the view followed now before the step, restored when nothing changes there.
    follow_now: bool,
    prior: Option<(Query, Arc<Snapshot>)>,
}
/// Every instant where the effective policy may change: interval bounds and next changes.
fn boundaries(snapshot: &Snapshot) -> Vec<u64> {
    let mut at: Vec<u64> = snapshot
        .document
        .timeline
        .iter()
        .flat_map(|interval| [interval.start_ms, interval.end_ms])
        .chain(
            snapshot
                .document
                .members
                .iter()
                .filter_map(|member| member.next_change_at_ms),
        )
        .collect();
    at.sort_unstable();
    at.dedup();
    at
}
fn beyond(boundaries: &[u64], from: u64, later: bool) -> Option<u64> {
    if later {
        boundaries.iter().copied().find(|at| *at > from)
    } else {
        boundaries.iter().copied().rev().find(|at| *at < from)
    }
}
impl Default for State {
    fn default() -> Self {
        Self {
            query: Query::default(),
            section: Section::default(),
            job: None,
            job_message: None,
            follow_now: true,
            selected: None,
            target: None,
            why: None,
            plans: false,
            plan_selection: None,
            only_plan: None,
            report: None,
            failure: None,
            unavailable: false,
            note: None,
            edge: None,
            cursor: None,
            hits: Default::default(),
            enlarge: Default::default(),
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
    /// The selected job's row, when Core lists it.
    pub fn selected_job(&self) -> Option<&crate::cron_service::rows::JobRow> {
        let id = self.job.as_ref()?;
        self.snapshot()?
            .jobs
            .listed()?
            .rows
            .iter()
            .find(|job| &job.job_id == id)
    }
    /// The members the matrix and member rows show: all of them, or with `⏎` on a plan, those it
    /// applies to at the selected time.
    pub fn members<'a>(&self, snapshot: &'a Snapshot) -> Vec<&'a model::Member> {
        match &self.only_plan {
            Some(id) => snapshot.plan_members(id),
            None => snapshot.document.members.iter().collect(),
        }
    }
    /// The plan `⏎` filters the members by, while Core still lists it.
    pub fn only_plan_row(&self) -> Option<&model::PlanRow> {
        let id = self.only_plan.as_ref()?;
        self.snapshot()?.plan_rows.iter().find(|p| &p.id == id)
    }
    /// The plan selected in the plans list.
    pub fn selected_plan(&self) -> Option<&model::PlanRow> {
        let id = self.plan_selection.as_ref()?;
        self.snapshot()?.plan_rows.iter().find(|p| &p.id == id)
    }
    /// Why the jobs read failed, when it did; the rest of the tab still shows.
    pub fn jobs_failure(&self) -> Option<&str> {
        match &self.snapshot()?.jobs {
            model::Jobs::Failed(reason) => Some(reason),
            _ => None,
        }
    }
    /// The sections Tab moves through: Talks and Jobs only when Core reports them.
    pub fn sections(&self) -> Vec<Section> {
        let Some(snapshot) = self.snapshot() else {
            return vec![Section::Routes];
        };
        let mut sections = vec![Section::Routes];
        if snapshot
            .sending
            .talks
            .as_ref()
            .is_some_and(|t| !t.is_empty())
        {
            sections.push(Section::Talks);
        }
        if !matches!(snapshot.jobs, model::Jobs::Unavailable) {
            sections.push(Section::Jobs);
        }
        sections
    }
    /// The focused section, or Routes when the focused one is not shown.
    pub fn focus(&self) -> Section {
        if self.sections().contains(&self.section) {
            self.section
        } else {
            Section::Routes
        }
    }
    pub fn snapshot(&self) -> Option<&Snapshot> {
        self.report
            .as_ref()
            .filter(|(query, _)| query == &self.query)
            .map(|(_, report)| report.as_ref())
    }
    /// What the selected matrix cell offers: (a blocked route to allow once, a held pair to
    /// release). Both are false without a reported route matrix or in the plans list.
    pub fn cell_actions(&self) -> (bool, bool) {
        let Some(snapshot) = self.snapshot().filter(|_| !self.plans) else {
            return (false, false);
        };
        let (Some(from), Some(to)) = (self.selected.as_deref(), self.target.as_deref()) else {
            return (false, false);
        };
        let blocked = snapshot
            .sending
            .route(from, to)
            .is_some_and(|route| route.verdict == model::Verdict::Blocked);
        let held = snapshot
            .sending
            .pair(from, to)
            .is_some_and(|pair| pair.held);
        (blocked, held)
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
                // A plan filter outlives a read only while Core still lists the plan; the selected
                // members stay among the members it shows.
                if let Some(id) = &self.only_plan {
                    if snapshot.plan_rows.iter().all(|p| &p.id != id) {
                        self.only_plan = None;
                        self.note = Some("that plan is gone · all members".into());
                    } else {
                        let shown = snapshot.plan_members(id);
                        let keep = |at: &Option<String>| {
                            at.as_ref()
                                .is_some_and(|id| shown.iter().any(|m| &m.identity_id == id))
                        };
                        if !keep(&self.selected) {
                            self.selected = shown.first().map(|m| m.identity_id.clone());
                        }
                        if !keep(&self.target) {
                            self.target = shown
                                .iter()
                                .map(|m| &m.identity_id)
                                .find(|id| Some(*id) != self.selected.as_ref())
                                .cloned();
                        }
                    }
                }
                let jobs = snapshot
                    .jobs
                    .listed()
                    .into_iter()
                    .flat_map(|jobs| &jobs.rows);
                if self
                    .job
                    .as_ref()
                    .is_none_or(|id| !jobs.clone().any(|job| &job.job_id == id))
                {
                    self.job = jobs.clone().next().map(|job| job.job_id.clone());
                }
                self.report = Some((read.query, Arc::from(snapshot)));
                self.failure = None;
                self.unavailable = false;
                if let Some(edge) = self.edge.take() {
                    self.finish_edge(edge);
                }
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
    /// `[` or `]`: the previous or next change in the held range. Past its first or last change,
    /// one read of the neighbouring range is asked for; [`Self::finish_edge`] ends the step on it.
    pub fn step(&mut self, later: bool) -> bool {
        let Some(snapshot) = self.snapshot() else {
            return false;
        };
        let from = self.query.at_ms;
        let next = beyond(&boundaries(snapshot), from, later);
        let target = if later {
            snapshot.document.range.end_ms
        } else {
            snapshot.document.range.start_ms.saturating_sub(1)
        };
        self.note = None;
        if let Some(at) = next {
            self.query.at_ms = at;
            self.follow_now = false;
            return true;
        }
        if target == from {
            return false;
        }
        self.edge = Some(Edge {
            later,
            from_ms: from,
            follow_now: self.follow_now,
            prior: self.report.clone(),
        });
        self.query.at_ms = target;
        self.follow_now = false;
        true
    }
    /// The neighbouring range's change nearest the step's start, or, with none there, the
    /// observation the step started from: never a second edge read.
    fn finish_edge(&mut self, edge: Edge) {
        let found = self
            .snapshot()
            .and_then(|snapshot| beyond(&boundaries(snapshot), edge.from_ms, edge.later));
        match (found, edge.prior) {
            (Some(at), _) => self.query.at_ms = at,
            (None, Some((query, report))) => {
                self.follow_now = edge.follow_now;
                self.query = query.clone();
                self.report = Some((query, report));
                self.note = Some(
                    if edge.later {
                        "no later change"
                    } else {
                        "no earlier change"
                    }
                    .into(),
                );
            }
            (None, None) => {}
        }
    }
    /// The person chose a time: a pending edge step no longer decides where the view lands.
    pub fn at(&mut self, at: u64) {
        self.edge = None;
        self.note = None;
        self.query.at_ms = at;
        self.follow_now = false;
    }
    /// Back to now, dropping any pending edge step.
    pub fn now(&mut self, now: u64) {
        self.edge = None;
        self.note = None;
        self.follow_now = true;
        self.query.at_ms = now;
    }
    /// Another range around the same time, dropping any pending edge step.
    pub fn range(&mut self, days: u8) {
        self.edge = None;
        self.query.days = days;
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
