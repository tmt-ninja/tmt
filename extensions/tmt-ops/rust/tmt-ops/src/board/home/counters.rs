//! Disposable HOME digits. Evidence, shares and sampling remain with Rate/App.
use crate::board::{meter::Counter, rate::Reading};
use ratatui::layout::Rect;
use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};
use tmt_cli_style::grid::Align;
use tmt_tui::style::TextFlow;

#[derive(Default)]
pub(crate) struct Counters {
    fields: BTreeMap<String, Field>,
}

struct Field {
    counter: Counter,
    partial: bool,
    money: bool,
    requested: bool,
    visible: Option<Visible>,
    next_visible: Option<Visible>,
    live_last: Option<(u128, bool)>,
    emphasis_until: Option<Instant>,
}

#[derive(Clone)]
struct Visible {
    area: Rect,
    prefix: String,
    align: Align,
    body: bool,
}

impl Field {
    fn text(&self) -> String {
        if !self.money {
            return self.counter.digits(self.partial);
        }
        self.counter.displayed().map_or_else(
            || "—".into(),
            |micros| {
                let text =
                    crate::board::savings::usd_compact(micros.min(u128::from(u64::MAX)) as u64);
                if self.partial {
                    format!("~{}", text.trim_start_matches('≈'))
                } else {
                    text
                }
            },
        )
    }
}

impl Visible {
    fn text(&self, field: &Field) -> String {
        tmt_tui::text::fit_line(
            &format!("{}{}", self.prefix, field.text()),
            self.area.width,
            TextFlow::Truncate,
            self.align,
        )
    }
}

impl Counters {
    pub(crate) fn clear(&mut self) {
        self.fields.clear();
    }

    pub(crate) fn begin(&mut self) {
        for field in self.fields.values_mut() {
            field.requested = false;
            field.next_visible = None;
        }
    }

    pub(crate) fn digits(
        &mut self,
        key: String,
        reading: Option<Reading>,
        reduced: bool,
        now: Instant,
    ) -> String {
        let field = self.fields.entry(key).or_insert_with(|| Field {
            counter: Counter::default(),
            partial: false,
            money: false,
            requested: false,
            visible: None,
            next_visible: None,
            live_last: None,
            emphasis_until: None,
        });
        field.requested = true;
        field.partial = reading.is_some_and(|reading| reading.partial);
        field.counter.retarget(
            reading.map(|reading| reading.tokens),
            reduced || field.visible.is_none(),
            false,
            now,
        );
        field.counter.digits(field.partial)
    }

    /// The live row's digits and whether their recent change is emphasized.
    pub(crate) fn live_digits(
        &mut self,
        key: String,
        reading: Option<Reading>,
        reduced: bool,
        now: Instant,
    ) -> (String, bool) {
        let prior = self.fields.get(&key).and_then(|field| field.live_last);
        let visible = self
            .fields
            .get(&key)
            .is_some_and(|field| field.visible.is_some());
        let current = reading.map(|reading| (reading.tokens, reading.partial));
        let digits = self.digits(key.clone(), reading, reduced, now);
        let field = self.fields.get_mut(&key).expect("requested counter cell");
        if reduced || !visible || current.is_none() {
            field.emphasis_until = None;
        } else if prior.is_some() && prior != current {
            field.emphasis_until = Some(now + Duration::from_secs(2));
        }
        field.live_last = current;
        (
            digits,
            field.emphasis_until.is_some_and(|until| now < until),
        )
    }

    /// Price remains based on the held report; only its displayed digits move.
    pub(crate) fn live_money(
        &mut self,
        key: String,
        price: Option<(u64, bool)>,
        reduced: bool,
        now: Instant,
    ) -> (String, bool) {
        let reading = price.map(|(micros, partial)| Reading {
            tokens: u128::from(micros),
            partial,
            span: 0,
        });
        let (_, bold) = self.live_digits(key.clone(), reading, reduced, now);
        let field = self.fields.get_mut(&key).expect("requested counter cell");
        field.money = true;
        (field.text(), bold)
    }

    /// Fit motion to the painter's admitted numeric budget.
    /// An animated value that outgrows that cell settles instead of moving its
    /// neighbours or showing a truncated token total.
    pub(crate) fn admitted_digits(&mut self, key: &str, width: u16) -> String {
        let field = self.fields.get_mut(key).expect("requested counter cell");
        let digits = field.text();
        if unicode_width::UnicodeWidthStr::width(digits.as_str()) > usize::from(width) {
            field.counter.stop();
        }
        field.text()
    }

    /// The painter supplies its admitted cell after normal geometry/scrolling.
    pub(crate) fn visible(
        &mut self,
        key: &str,
        area: Rect,
        prefix: String,
        align: Align,
        body: bool,
    ) {
        if area.width > 0
            && area.height > 0
            && let Some(field) = self.fields.get_mut(key)
        {
            field.next_visible = Some(Visible {
                area,
                prefix,
                align,
                body,
            });
        }
    }

    /// Frame orchestration owns the actual header row, including buffer origin.
    pub(crate) fn place_header(&mut self, area: Rect) {
        for field in self.fields.values_mut() {
            if let Some(visible) = field.next_visible.as_mut().filter(|visible| !visible.body) {
                visible.area.x = visible.area.x.saturating_add(area.x);
                visible.area.y = area.y;
                visible.area = visible.area.intersection(area);
            }
        }
    }

    pub(crate) fn finish(&mut self, covered: Option<Rect>, body_hidden: bool) {
        self.fields.retain(|_, field| field.requested);
        for field in self.fields.values_mut() {
            field.visible = field.next_visible.take().filter(|visible| {
                visible.area.width > 0
                    && visible.area.height > 0
                    && !(body_hidden && visible.body)
                    && covered.is_none_or(|covered| !covered.intersects(visible.area))
            });
            if field.visible.is_none() {
                field.counter.stop();
                field.emphasis_until = None;
            }
        }
    }

    pub(crate) fn tick(&mut self, now: Instant) -> bool {
        let mut changed = false;
        for field in self.fields.values_mut() {
            if let Some(visible) = field.visible.clone() {
                if field.emphasis_until.is_some_and(|until| now >= until) {
                    field.emphasis_until = None;
                    changed = true;
                }
                let before = visible.text(field);
                field.counter.tick(now);
                changed |= before != visible.text(field);
            }
        }
        changed
    }

    pub(crate) fn wait(&self, now: Instant) -> Option<Duration> {
        self.fields
            .values()
            .filter(|field| field.visible.is_some())
            .filter_map(|field| {
                field
                    .counter
                    .wait(now)
                    .into_iter()
                    .chain(
                        field
                            .emphasis_until
                            .map(|until| until.saturating_duration_since(now)),
                    )
                    .min()
            })
            .min()
    }
}

#[cfg(test)]
mod tests;
