//! Frame-bounded, evidence-keyed Agents usage projections; no acquisition or I/O.
use super::{app::App, rate::Reading, workspace::OpsObservation};
use std::{
    cell::{Cell, RefCell},
    collections::{BTreeMap, BTreeSet},
    time::{Duration, Instant},
};

#[derive(Debug, Clone, PartialEq)]
pub(in crate::board) struct AgentsLiveUsage {
    pub minute: Option<Reading>,
    pub activity: [Option<f64>; 12],
}

/// Presentation-only rate from accepted cumulative observations. It decays to
/// zero over a bounded interval after the last moving sample.
#[derive(Default)]
struct SmoothRate {
    baseline: Option<(super::rate::Counter, Instant)>,
    peak: f64,
    peak_at: Option<Instant>,
    observed: bool,
    shown: u128,
    flash_until: Option<Instant>,
    shown_flash: bool,
}

impl SmoothRate {
    const DECAY: Duration = Duration::from_secs(30);
    const FRAME: Duration = Duration::from_millis(250);

    fn value(&self, now: Instant) -> u128 {
        let Some(at) = self.peak_at else { return 0 };
        let fraction =
            1.0 - now.saturating_duration_since(at).as_secs_f64() / Self::DECAY.as_secs_f64();
        (self.peak * fraction.max(0.0)).round() as u128
    }

    fn observe(&mut self, value: &serde_json::Value, now: Instant) {
        let Some(next) = super::rate::Counter::read(value) else {
            self.baseline = None;
            return;
        };
        if let Some((previous, at)) = &self.baseline {
            // Unchanged rows can be re-delivered when another member changes.
            // They do not reset this member's sampling interval.
            if &next == previous {
                return;
            }
            if let Some(delta) = next.delta(previous) {
                self.observed = true;
                let elapsed = now.saturating_duration_since(*at).as_secs_f64();
                if delta > 0 && elapsed > 0.0 {
                    let instantaneous = delta as f64 * 60.0 / elapsed;
                    self.peak = (self.value(now) as f64 + instantaneous) / 2.0;
                    self.peak_at = Some(now);
                    self.flash_until = Some(now + Duration::from_millis(800));
                }
            } else {
                self.peak = 0.0;
                self.peak_at = None;
                self.flash_until = None;
                self.observed = false;
            }
        }
        self.baseline = Some((next, now));
    }
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
    squad_seen: RefCell<BTreeSet<String>>,
    pub(in crate::board) squads: RefCell<BTreeMap<String, Option<Reading>>>,
    generation: RefCell<Vec<(u64, u64)>>,
    at: Cell<Option<Instant>>,
    window: Cell<crate::config::ActivityWindow>,
    rates: RefCell<BTreeMap<String, SmoothRate>>,
    flashes: RefCell<BTreeMap<String, RowFlash>>,
    flash_seen: RefCell<BTreeSet<String>>,
    motion_off: Cell<bool>,
    rate_active: Cell<bool>,
    flash_active: Cell<bool>,
}

impl Projection {
    pub fn invalidate(&mut self) {
        self.usage.get_mut().clear();
        self.missing.get_mut().clear();
        self.squads.get_mut().clear();
        self.generation.get_mut().clear();
        self.at.set(None);
    }

    #[cfg(test)]
    pub(in crate::board) fn set_capture_rate(
        &self,
        id: &str,
        value: u128,
        flash: bool,
        now: Instant,
    ) {
        let at = now + Duration::from_secs(60);
        self.rates.borrow_mut().insert(
            id.into(),
            SmoothRate {
                peak: value as f64,
                peak_at: Some(at),
                observed: true,
                shown: value,
                flash_until: flash.then_some(at),
                shown_flash: flash,
                ..Default::default()
            },
        );
        self.rate_active.set(value > 0 || flash);
    }

    pub fn observe_rates(&mut self, rows: &BTreeMap<String, serde_json::Value>, now: Instant) {
        let rates = self.rates.get_mut();
        rates.retain(|id, _| rows.contains_key(id));
        for (id, row) in rows {
            let rate = rates.entry(id.clone()).or_default();
            rate.observe(row, now);
            rate.shown = rate.value(now);
            rate.shown_flash = rate.flash_until.is_some_and(|until| now < until);
            if rate.shown > 0 || rate.shown_flash {
                self.rate_active.set(true);
            }
        }
    }

    pub fn tick_rates(&self, now: Instant) -> bool {
        if self.motion_off.get() || !self.rate_active.get() {
            return false;
        }
        let seen = self.seen.borrow();
        let mut changed = false;
        let mut rates = self.rates.borrow_mut();
        let mut active = false;
        for id in seen.iter() {
            if let Some(rate) = rates.get_mut(id) {
                let value = rate.value(now);
                let flash = rate.flash_until.is_some_and(|until| now < until);
                changed |= value != rate.shown || flash != rate.shown_flash;
                active |= value > 0 || flash;
                rate.shown = value;
                rate.shown_flash = flash;
            }
        }
        drop(rates);
        self.rate_active.set(active);
        if changed {
            self.usage.borrow_mut().clear();
            self.squads.borrow_mut().clear();
        }
        changed
    }

    pub fn rate_wait(&self, now: Instant) -> Option<Duration> {
        if self.motion_off.get() || !self.rate_active.get() {
            return None;
        }
        let seen = self.seen.borrow();
        let rates = self.rates.borrow();
        seen.iter()
            .any(|id| {
                rates.get(id).is_some_and(|rate| {
                    rate.value(now) > 0 || rate.flash_until.is_some_and(|until| now < until)
                })
            })
            .then_some(SmoothRate::FRAME)
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
        let window = app.activity_window();
        if motion_changed || *self.generation.borrow() != generation || self.window.get() != window
        {
            self.usage.borrow_mut().clear();
            self.missing.borrow_mut().clear();
            self.squads.borrow_mut().clear();
            *self.generation.borrow_mut() = generation;
            self.window.set(window);
        }
        self.at.set(Some(now));
        self.seen.borrow_mut().clear();
        self.squad_seen.borrow_mut().clear();
        self.flash_seen.borrow_mut().clear();
    }

    pub fn finish(&self) {
        let seen = self.seen.borrow();
        self.usage.borrow_mut().retain(|id, _| seen.contains(id));
        self.missing.borrow_mut().retain(|id| seen.contains(id));
        let seen = self.flash_seen.borrow();
        self.flashes.borrow_mut().retain(|id, _| seen.contains(id));
        let squads = self.squad_seen.borrow();
        self.squads.borrow_mut().retain(|id, _| squads.contains(id));
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
                let minute = meter
                    .observation(id, crate::config::TokenWindow::MINUTE, now)
                    .map(|(mut reading, _)| {
                        if let Some(rate) = self.rates.borrow().get(id).filter(|rate| rate.observed)
                        {
                            if rate.value(now) > 0 {
                                self.rate_active.set(true);
                            }
                            reading.tokens = if self.motion_off.get() {
                                rate.shown
                            } else {
                                rate.value(now)
                            };
                        }
                        reading
                    });
                let activity = meter.member_trend_window(id, now, self.window.get().token_window());
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

    pub fn rate_flash(&self, id: &str, now: Instant) -> Option<bool> {
        let rates = self.rates.borrow();
        let rate = rates.get(id).filter(|rate| rate.observed)?;
        Some(rate.flash_until.is_some_and(|until| now < until))
    }

    pub fn squad_rate_flash(&self, app: &App, room: &str, now: Instant) -> Option<bool> {
        let squad = app
            .workspace_snapshot()?
            .roster
            .squads
            .iter()
            .find(|squad| squad.room_id == room)?;
        let mut any_known = false;
        let mut flashing = false;
        for id in &squad.members {
            if let Some(value) = self.rate_flash(id, now) {
                any_known = true;
                flashing |= value;
            }
        }
        any_known.then_some(flashing)
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn counter(tokens: u64, sequence: u64) -> serde_json::Value {
        json!({"driver":"codex", "session":"one", "consumption": {
            "inputTokens":tokens, "outputTokens":0, "cachedInputTokens":0,
            "epoch":"00000000-0000-4000-8000-000000000001", "sequence":sequence,
            "observedAtMs":sequence, "complete":true, "gap":false
        }})
    }

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

    #[test]
    fn hidden_and_motion_off_rates_do_not_schedule_animation() {
        let start = Instant::now();
        let projection = Projection::default();
        let mut rate = SmoothRate::default();
        rate.observe(&counter(1, 1), start);
        rate.observe(&counter(101, 2), start + Duration::from_secs(10));
        projection.rates.borrow_mut().insert("a".into(), rate);
        projection.rate_active.set(true);
        assert_eq!(projection.rate_wait(start + Duration::from_secs(11)), None);
        projection.seen.borrow_mut().insert("a".into());
        assert!(
            projection
                .rate_wait(start + Duration::from_secs(11))
                .is_some()
        );
        projection.motion_off.set(true);
        assert_eq!(projection.rate_wait(start + Duration::from_secs(11)), None);
        assert!(!projection.tick_rates(start + Duration::from_secs(11)));
    }

    #[test]
    fn rate_smooths_accepted_deltas_decays_and_rebaselines_resets() {
        let start = Instant::now();
        let mut rate = SmoothRate::default();
        rate.observe(&counter(100, 1), start);
        assert!(!rate.observed);
        rate.observe(&counter(100, 1), start + Duration::from_secs(9));
        rate.observe(&counter(200, 2), start + Duration::from_secs(10));
        assert_eq!(rate.value(start + Duration::from_secs(10)), 300);
        let flash = rate.flash_until;
        rate.observe(&counter(200, 2), start + Duration::from_millis(10_500));
        assert_eq!(
            rate.flash_until, flash,
            "duplicate observations do not replay a flash"
        );
        assert_eq!(rate.value(start + Duration::from_secs(25)), 150);
        assert_eq!(rate.value(start + Duration::from_secs(40)), 0);
        rate.observe(&counter(1, 3), start + Duration::from_secs(41));
        assert!(!rate.observed);
        assert_eq!(rate.value(start + Duration::from_secs(41)), 0);
    }
}
