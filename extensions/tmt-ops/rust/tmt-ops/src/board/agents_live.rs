//! Frame-bounded, evidence-keyed Agents usage projections; no acquisition or I/O.
use super::{app::App, rate::Reading, workspace::OpsObservation};
use std::{
    cell::{Cell, RefCell},
    collections::{BTreeMap, BTreeSet},
    time::Instant,
};

#[derive(Debug, Clone, PartialEq)]
pub(in crate::board) struct AgentsLiveUsage {
    pub minute: Option<Reading>,
    pub activity: [Option<f64>; 12],
}

#[derive(Default)]
pub(in crate::board) struct Projection {
    pub(in crate::board) usage: RefCell<BTreeMap<String, AgentsLiveUsage>>,
    pub(in crate::board) missing: RefCell<BTreeSet<String>>,
    seen: RefCell<BTreeSet<String>>,
    squad_seen: RefCell<BTreeSet<String>>,
    pub(in crate::board) squads: RefCell<BTreeMap<String, Option<Reading>>>,
    generation: RefCell<Vec<(u64, u64)>>,
    at: Cell<Option<Instant>>,
}

impl Projection {
    pub fn invalidate(&mut self) {
        self.usage.get_mut().clear();
        self.missing.get_mut().clear();
        self.squads.get_mut().clear();
        self.generation.get_mut().clear();
        self.at.set(None);
    }

    /// Admit one clock instant and check evidence once for the entire frame.
    pub fn begin(&self, app: &App, now: Instant) {
        let generation = app
            .view
            .as_ref()
            .into_iter()
            .flat_map(|view| &view.home_rate)
            .filter(|(_, rate)| rate.settings.enabled)
            .filter_map(|(name, _)| app.home_meter(name).map(|meter| meter.evidence_key(now)))
            .collect::<Vec<_>>();
        if *self.generation.borrow() != generation {
            self.usage.borrow_mut().clear();
            self.missing.borrow_mut().clear();
            self.squads.borrow_mut().clear();
            *self.generation.borrow_mut() = generation;
        }
        self.at.set(Some(now));
        self.seen.borrow_mut().clear();
        self.squad_seen.borrow_mut().clear();
    }

    pub fn finish(&self) {
        let seen = self.seen.borrow();
        self.usage.borrow_mut().retain(|id, _| seen.contains(id));
        self.missing.borrow_mut().retain(|id| seen.contains(id));
        let squads = self.squad_seen.borrow();
        self.squads.borrow_mut().retain(|id, _| squads.contains(id));
    }

    pub fn member(&self, app: &App, id: &str) -> Option<AgentsLiveUsage> {
        self.seen.borrow_mut().insert(id.to_owned());
        if let Some(value) = self.usage.borrow().get(id) {
            return Some(value.clone());
        }
        if self.missing.borrow().contains(id) {
            return None;
        }
        let now = self
            .at
            .get()
            .expect("begin a live projection frame before painting");
        let mut best = None;
        if let Some(view) = &app.view {
            for (squad, rate) in &view.home_rate {
                if !rate.settings.enabled || !rate.input.resumes.contains_key(id) {
                    continue;
                }
                let Some(meter) = app.home_meter(squad) else {
                    continue;
                };
                let Some((hour, evidence)) =
                    meter.observation(id, crate::config::TokenWindow::HOUR, now)
                else {
                    continue;
                };
                let rank = (evidence, hour.span, !hour.partial);
                if best.as_ref().is_some_and(|(previous, _)| *previous >= rank) {
                    continue;
                }
                let minute = meter
                    .observation(id, crate::config::TokenWindow::MINUTE, now)
                    .map(|(reading, _)| reading);
                let activity = meter.member_trend(id, now);
                best = Some((rank, AgentsLiveUsage { minute, activity }));
            }
        }
        let value = best.map(|(_, usage)| usage);
        if let Some(usage) = &value {
            self.usage.borrow_mut().insert(id.to_owned(), usage.clone());
        } else {
            self.missing.borrow_mut().insert(id.to_owned());
        }
        value
    }

    pub fn squad_minute(&self, app: &App, room: &str) -> Option<Reading> {
        self.squad_seen.borrow_mut().insert(room.to_owned());
        if let Some(value) = self.squads.borrow().get(room) {
            if let Some(squad) = app.workspace_snapshot().and_then(|snapshot| {
                snapshot
                    .roster
                    .squads
                    .iter()
                    .find(|squad| squad.room_id == room)
            }) {
                self.seen.borrow_mut().extend(squad.members.iter().cloned());
            }
            return *value;
        }
        let value = app.workspace_snapshot().and_then(|snapshot| {
            let squad = snapshot
                .roster
                .squads
                .iter()
                .find(|squad| squad.room_id == room)?;
            let mut seen = BTreeSet::new();
            let mut total = 0u128;
            let mut span = u64::MAX;
            let mut known = false;
            let mut partial = squad.observation != OpsObservation::Complete;
            for id in &squad.members {
                if !seen.insert(id) {
                    continue;
                }
                if let Some(reading) = self.member(app, id).and_then(|usage| usage.minute) {
                    total = total.saturating_add(reading.tokens);
                    span = span.min(reading.span);
                    partial |= reading.partial;
                    known = true;
                } else {
                    partial = true;
                }
            }
            known.then_some(Reading {
                tokens: total,
                partial,
                span,
            })
        });
        self.squads.borrow_mut().insert(room.to_owned(), value);
        value
    }
}
