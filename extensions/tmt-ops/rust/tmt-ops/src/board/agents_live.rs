//! Frame-bounded, evidence-keyed Agents usage projections; no acquisition or I/O.
use super::{app::App, workspace::OpsObservation};
use std::{
    cell::{Cell, RefCell},
    collections::{BTreeMap, BTreeSet},
    time::{Duration, Instant},
};

#[derive(Debug, Clone, PartialEq)]
pub(in crate::board) struct AgentsLiveUsage {
    pub activity: [Option<f64>; 12],
}

#[derive(Default)]
struct RowFlash {
    prior: Option<(bool, bool, u64)>,
    started: Option<Instant>,
    shown: u8,
}

impl RowFlash {
    fn stage(&self, now: Instant) -> u8 {
        let Some(started) = self.started else {
            return 0;
        };
        let elapsed = now.saturating_duration_since(started);
        if elapsed < Duration::from_millis(400) {
            2
        } else if elapsed < Duration::from_millis(1_200) {
            1
        } else {
            0
        }
    }

    fn observe(
        &mut self,
        waiting: bool,
        blocked: bool,
        unread: u64,
        motion: bool,
        now: Instant,
    ) -> u8 {
        if motion
            && let Some((old_waiting, old_blocked, old_unread)) = self.prior
            && ((!old_waiting && waiting) || (!old_blocked && blocked) || unread > old_unread)
        {
            self.started = Some(now);
        }
        if !motion {
            self.started = None;
        }
        self.prior = Some((waiting, blocked, unread));
        self.shown = self.stage(now);
        self.shown
    }
}

#[derive(Default)]
pub(in crate::board) struct Projection {
    pub(in crate::board) usage: RefCell<BTreeMap<String, AgentsLiveUsage>>,
    pub(in crate::board) missing: RefCell<BTreeSet<String>>,
    seen: RefCell<BTreeSet<String>>,
    generation: RefCell<Vec<(u64, u64)>>,
    at: Cell<Option<Instant>>,
    window: Cell<crate::config::ActivityWindow>,
    burn: BTreeMap<String, Instant>,
    visible_burn_deadline: Cell<Option<Instant>>,
    flashes: RefCell<BTreeMap<String, RowFlash>>,
    flash_seen: RefCell<BTreeSet<String>>,
    motion_off: Cell<bool>,
    flash_active: Cell<bool>,
}

impl Projection {
    pub fn invalidate(&mut self) {
        self.usage.get_mut().clear();
        self.missing.get_mut().clear();
        self.generation.get_mut().clear();
        self.at.set(None);
    }

    pub fn observe_burn(&mut self, observations: BTreeMap<String, Option<bool>>, now: Instant) {
        self.burn
            .retain(|id, until| *until > now && observations.contains_key(id));
        for (id, update) in observations {
            match update {
                Some(true) => {
                    self.burn.insert(id, now + Duration::from_secs(30));
                }
                Some(false) => {}
                None => {
                    self.burn.remove(&id);
                }
            }
        }
    }

    pub fn burning(&self, id: &str, now: Instant) -> bool {
        let Some(until) = self.burn.get(id).copied().filter(|until| *until > now) else {
            return false;
        };
        self.visible_burn_deadline.set(Some(
            self.visible_burn_deadline
                .get()
                .map_or(until, |held| held.min(until)),
        ));
        true
    }

    pub fn burn_wait(&self, now: Instant) -> Option<Duration> {
        self.visible_burn_deadline
            .get()
            .map(|until| until.saturating_duration_since(now))
    }

    pub fn expire_burn(&self, now: Instant) -> bool {
        self.visible_burn_deadline.get().is_some_and(|until| {
            if until <= now {
                self.visible_burn_deadline.set(None);
                true
            } else {
                false
            }
        })
    }

    /// Admit one clock instant and check evidence once for the entire frame.
    pub fn begin(&self, app: &App, now: Instant) {
        let motion_off = app.motion_off();
        let motion_changed = self.motion_off.replace(motion_off) != motion_off;
        let generation = app
            .view
            .as_ref()
            .into_iter()
            .flat_map(|view| &view.home_rate)
            .filter(|(_, rate)| rate.settings.enabled)
            .filter_map(|(name, _)| app.home_meter(name).map(|meter| meter.evidence_key(now)))
            .map(|(evidence, time)| (evidence, if motion_off { 0 } else { time }))
            .collect::<Vec<_>>();
        self.visible_burn_deadline.set(None);
        let window = app.activity_window();
        if motion_changed || *self.generation.borrow() != generation || self.window.get() != window
        {
            self.usage.borrow_mut().clear();
            self.missing.borrow_mut().clear();
            *self.generation.borrow_mut() = generation;
            self.window.set(window);
        }
        self.at.set(Some(now));
        self.seen.borrow_mut().clear();
        self.flash_seen.borrow_mut().clear();
    }

    pub fn finish(&self) {
        let seen = self.seen.borrow();
        self.usage.borrow_mut().retain(|id, _| seen.contains(id));
        self.missing.borrow_mut().retain(|id| seen.contains(id));
        let seen = self.flash_seen.borrow();
        self.flashes.borrow_mut().retain(|id, _| seen.contains(id));
    }

    pub fn row_flash(
        &self,
        key: String,
        waiting: bool,
        blocked: bool,
        unread: u64,
        motion: bool,
        now: Instant,
    ) -> u8 {
        self.flash_seen.borrow_mut().insert(key.clone());
        let stage = self
            .flashes
            .borrow_mut()
            .entry(key)
            .or_default()
            .observe(waiting, blocked, unread, motion, now);
        if stage > 0 {
            self.flash_active.set(true);
        }
        stage
    }

    pub fn tick_flashes(&self, now: Instant) -> bool {
        if !self.flash_active.get() {
            return false;
        }
        let mut changed = false;
        let mut active = false;
        for flash in self.flashes.borrow_mut().values_mut() {
            let stage = flash.stage(now);
            changed |= stage != flash.shown;
            active |= stage > 0;
            flash.shown = stage;
            if stage == 0 {
                flash.started = None;
            }
        }
        self.flash_active.set(active);
        changed
    }

    pub fn flash_wait(&self) -> Option<Duration> {
        if !self.flash_active.get() {
            return None;
        }
        self.flashes
            .borrow()
            .values()
            .any(|flash| flash.started.is_some())
            .then_some(Duration::from_millis(200))
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
                let activity = meter.member_trend_window(id, now, self.window.get().token_window());
                best = Some((rank, AgentsLiveUsage { activity }));
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

    pub fn squad_activity(&self, app: &App, room: &str) -> [Option<f64>; 12] {
        let Some(squad) = app.workspace_snapshot().and_then(|snapshot| {
            snapshot
                .roster
                .squads
                .iter()
                .find(|squad| squad.room_id == room)
        }) else {
            return [None; 12];
        };
        if squad.observation != OpsObservation::Complete {
            return [None; 12];
        }
        let mut seen = BTreeSet::new();
        let mut total = [Some(0.0); 12];
        for id in &squad.members {
            if !seen.insert(id) {
                continue;
            }
            let values = self
                .member(app, id)
                .map_or([None; 12], |usage| usage.activity);
            for (sum, value) in total.iter_mut().zip(values) {
                *sum = sum.zip(value).map(|(a, b)| a + b);
            }
        }
        if seen.is_empty() { [None; 12] } else { total }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_flash_only_fires_on_new_attention_and_stops() {
        let start = Instant::now();
        let mut flash = RowFlash::default();
        assert_eq!(flash.observe(false, false, 0, true, start), 0);
        assert_eq!(flash.observe(true, false, 0, true, start), 2);
        assert_eq!(flash.stage(start + Duration::from_millis(500)), 1);
        assert_eq!(flash.stage(start + Duration::from_millis(1200)), 0);
        assert_eq!(
            flash.observe(true, false, 0, true, start + Duration::from_secs(2)),
            0
        );
        assert_eq!(
            flash.observe(true, true, 0, false, start + Duration::from_secs(3)),
            0
        );
        assert_eq!(
            flash.observe(true, true, 1, true, start + Duration::from_secs(4)),
            2
        );
    }
}
