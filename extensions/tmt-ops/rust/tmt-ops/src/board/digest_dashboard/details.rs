//! Selected-agent totals and delivery, with full provenance behind Estimate basis.
use super::{metrics, model};
use crate::board::app::{App, Effect, Request};
use ratatui::{Frame, crossterm::event::Event, layout::Rect};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::OnceLock};
use tmt_tui::{
    binding::{Schema, Schemas, Scopes, Sources},
    components::{
        ScrollState,
        surface::{self, ModalSurface, RenderStyle},
    },
};

pub(super) const METHOD: &str =
    "Method: saved = context each message would have reread if delivered alone";

#[derive(Clone, Debug)]
pub(super) enum PanelRow {
    Rule {
        title: String,
        note: Option<String>,
    },
    ModeChips {
        text: String,
        selected: Option<usize>,
        cursor: Option<usize>,
    },
    Trend {
        saved: bool,
        total: String,
    },
    Model {
        name: String,
        amount: u128,
        total: u128,
        partial: bool,
    },
    Text(String),
}

impl std::fmt::Display for PanelRow {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Rule { title, note } => write!(
                f,
                "── {title}{} ──",
                note.as_ref().map_or(String::new(), |n| format!(" | {n}"))
            ),
            Self::ModeChips { text, .. } | Self::Text(text) => f.write_str(text),
            Self::Trend { saved, total } => {
                write!(f, "{} trend {total}", if *saved { "saved" } else { "used" })
            }
            Self::Model {
                name,
                amount,
                total,
                partial,
            } => write!(
                f,
                "{name} · {}% · {}{}",
                amount * 100 / total,
                crate::source::tokens(*amount),
                if *partial { " · partial" } else { "" }
            ),
        }
    }
}

struct Panel(Vec<PanelRow>);
impl Panel {
    fn push(&mut self, text: String) {
        self.0.push(PanelRow::Text(text));
    }
    fn row(&mut self, row: PanelRow) {
        self.0.push(row);
    }
    fn extend(&mut self, texts: impl IntoIterator<Item = String>) {
        self.0.extend(texts.into_iter().map(PanelRow::Text));
    }
    fn contains(&self, text: &str) -> bool {
        self.0.iter().any(|row| row.to_string() == text)
    }
}

/// The selected row and the identities it stands for.
struct Selection<'a> {
    all: bool,
    ids: Vec<&'a str>,
    id: Option<&'a str>,
}

fn selection<'a>(
    rows: &'a [crate::board::workspace::OpsTreeRow],
    app: &App,
    row: Option<&'a Value>,
) -> Selection<'a> {
    let selected = rows
        .iter()
        .find(|row| Some(&row.target) == app.workspace.selected.as_ref());
    Selection {
        all: selected.is_some_and(|row| metrics::id(row).is_none()),
        ids: selected.map_or_else(Vec::new, |row| metrics::identities(row, rows)),
        id: row.and_then(|row| row["id"].as_str()),
    }
}

fn zone(app: &App) -> jiff::tz::TimeZone {
    app.local_zone.clone().unwrap_or(jiff::tz::TimeZone::UTC)
}

/// The pane title: what the tab describes and over which window.
pub(super) fn title(app: &App) -> String {
    let rows = app.workspace_rows();
    let name = rows
        .iter()
        .find(|row| Some(&row.target) == app.workspace.selected.as_ref())
        .map_or("none".into(), |row| row.title.clone());
    format!("{name} · {}", app.digest_window().label())
}

/// What the supplier holds now: modes, held messages and its own clocks.
pub(super) fn delivery(app: &App, now_ms: u64, row: Option<&Value>) -> Vec<String> {
    let rows = app.workspace_rows();
    let selected = selection(&rows, app, row);
    let zone = zone(app);
    let Some((status, stale)) = app.labels.digest() else {
        // Valid supplier labels keep their priority and chooser even without typed stats.
        return selected.id.map_or_else(
            || vec!["Settings and statistics unavailable".into()],
            |id| {
                model::delivery(&app.labels, id, now_ms, &zone, |id| {
                    metrics::name(app, Some(id))
                })
            },
        );
    };
    if let Some(id) = selected.id {
        return model::delivery(&app.labels, id, now_ms, &zone, |id| {
            metrics::name(app, Some(id))
        });
    }
    if !selected.all {
        return vec!["Select a visible agent or all".into()];
    }
    let mut text = Vec::new();
    if let Some(global) = &status.global {
        text.push(global.text.clone());
    }
    if stale {
        text.push("Stale observation · retained values; refresh before acting".into());
    }
    text.push(format!("Held now {}", super::held_text(app)));
    let (mut auto, mut timed, mut off, mut unknown) = (0, 0, 0, 0);
    for id in &selected.ids {
        match status.members.get(*id).map(|member| member.mode) {
            Some(crate::labels::digest::Mode::Auto) => auto += 1,
            Some(crate::labels::digest::Mode::Interval) => timed += 1,
            Some(crate::labels::digest::Mode::Off) => off += 1,
            None => unknown += 1,
        }
    }
    let mut modes = format!("Modes: Auto {auto} · Every {timed} · Off {off}");
    if unknown > 0 {
        modes.push_str(&format!(" · {unknown} not reported"));
    }
    text.push(modes);
    if let Some(notice) = model::tick_notice(&app.labels) {
        text.push(notice);
    }
    if let Some(tick) = status.tick {
        text.push(format!(
            "Last tick: {}",
            model::observation_time(tick.last_at_ms, now_ms, &zone)
        ));
    }
    text.push(format!(
        "Status observed: {}",
        model::observation_time(Some(status.observed_at_ms), now_ms, &zone)
    ));
    text
}

/// The basis behind the figures: source windows, observation times, prices and method.
pub(super) fn evidence(app: &App, now_ms: u64, row: Option<&Value>) -> Vec<String> {
    let rows = app.workspace_rows();
    let selected = selection(&rows, app, row);
    let report = metrics::report(app);
    let zone = zone(app);
    let mut text = Vec::new();
    if let Some(price) = metrics::input_price(app, report, &selected.ids) {
        text.push(format!(
            "Observed input at list price: {} · not a bill",
            crate::board::savings::usd_text(price)
        ));
    }
    if let Some((_, covered, total)) =
        crate::board::usage_report::valuation::partial_input_price(app, report, &selected.ids)
        && covered < total
    {
        text.push(format!(
            "Price estimate coverage: {covered} of {total} member-hours"
        ));
    }
    if let Some(id) = selected.id {
        if let Some(member) = app
            .labels
            .digest()
            .and_then(|(status, _)| status.members.get(id))
        {
            text.extend(model::evidence(member));
        }
        if let Some(seat) = report.and_then(|report| report.seat(id)) {
            text.push(format!(
                "Usage coverage: {}% of {}{}",
                seat.covered_ms.saturating_mul(100) / seat.window_ms.max(1),
                app.digest_range().argument(),
                if seat.complete {
                    " · complete"
                } else {
                    " · partial"
                }
            ));
            let timestamp = |ms: u64, format: &str| {
                i64::try_from(ms)
                    .ok()
                    .and_then(|ms| jiff::Timestamp::from_millisecond(ms).ok())
                    .map_or("unknown".into(), |at| {
                        at.to_zoned(zone.clone()).strftime(format).to_string()
                    })
            };
            text.push(format!(
                "Usage window: {}–{}",
                timestamp(seat.from_ms, "%m-%d %H:%M"),
                timestamp(seat.to_ms, "%m-%d %H:%M")
            ));
            text.push(format!(
                "Usage observed: {}",
                model::observation_time(Some(seat.observed_at_ms), now_ms, &zone)
            ));
            if seat.series.iter().any(|point| !point.complete) {
                text.push("Hourly activity is partial; fills show observed lower bounds".into());
            }
            if let Some(point) = report.and_then(|report| metrics::busiest(report, id)) {
                text.push(format!(
                    "Busiest hour: {}–{} · {}{} TOK",
                    timestamp(point.from_ms, "%H:%M"),
                    timestamp(point.to_ms, "%H:%M"),
                    if point.complete { "" } else { "≥" },
                    crate::source::tokens(u128::from(point.tokens))
                ));
            }
        } else if let Some(unavailable) = report.and_then(|report| {
            report
                .unavailable
                .iter()
                .find(|row| row.who.id.as_deref() == Some(id))
        }) {
            text.push(format!("Usage unavailable: {}", unavailable.reason));
        }
    }
    if let Some(report) = report {
        if selected.id.is_none() {
            text.push(format!(
                "Latest usage observed: {}",
                model::observation_time(Some(report.observed_at_ms), now_ms, &zone)
            ));
            text.push("Totals combine matching source windows only".into());
        }
        text.extend(
            report
                .warnings
                .iter()
                .map(|warning| format!("{}: {}", warning.section, warning.message)),
        );
    }
    if let Some((status, _)) = app.labels.digest() {
        text.push(format!(
            "Status observed: {}",
            model::observation_time(Some(status.observed_at_ms), now_ms, &zone)
        ));
        text.extend(model::pricing_details(status));
    }
    text.push(METHOD.into());
    text
}

/// The distinct price-table source addresses, in table order: what `y` copies.
pub(super) fn links(app: &App) -> Vec<String> {
    let mut links: Vec<String> = Vec::new();
    for model in app
        .labels
        .digest()
        .and_then(|(status, _)| status.pricing.as_ref())
        .into_iter()
        .flat_map(|pricing| &pricing.models)
    {
        if !links.contains(&model.source) {
            links.push(model.source.clone());
        }
    }
    links
}

/// The single agent panel shares the held status/report, never acquires on paint.
pub(super) fn panel(app: &App, now_ms: u64, row: Option<&Value>) -> Vec<PanelRow> {
    let rows = app.workspace_rows();
    let selected = selection(&rows, app, row);
    let mut lines = Panel(vec![PanelRow::Rule {
        title: "Delivery".into(),
        note: None,
    }]);
    if let Some(id) = selected.id {
        if let Some((status, stale)) = app.labels.digest() {
            if let Some(member) = status.members.get(id) {
                let inline = app
                    .digest_inline
                    .as_ref()
                    .filter(|edit| Some(&edit.target) == app.workspace.selected.as_ref());
                let edit_lines = inline.map(|edit| edit.lines());
                if let Some(edit) = &edit_lines {
                    if let Some(mode) = edit.first() {
                        lines.row(PanelRow::ModeChips {
                            text: mode.clone(),
                            selected: inline.map(|edit| edit.mode),
                            cursor: inline.filter(|edit| edit.field == 0).map(|edit| edit.mode),
                        });
                    }
                } else {
                    lines.row(PanelRow::ModeChips {
                        text: "mode Auto Interval Off Use default".into(),
                        selected: Some(match member.mode {
                            crate::labels::digest::Mode::Auto => 0,
                            crate::labels::digest::Mode::Interval => 1,
                            crate::labels::digest::Mode::Off => 2,
                        }),
                        cursor: None,
                    });
                }
                lines.0[0] = PanelRow::Rule {
                    title: "Delivery".into(),
                    note: Some(format!(
                        "{} · {}",
                        metrics::mode(app, Some(id)),
                        if member.setting_source == crate::labels::digest::SettingSource::Default {
                            "inherited from workspace"
                        } else {
                            "member override"
                        }
                    )),
                };
                let mut delivery = format!(
                    "held {} · next eligible {}",
                    member
                        .held_count
                        .map_or("unavailable".into(), |n| n.to_string()),
                    member
                        .next_eligible_at_ms
                        .map_or("unavailable".into(), |at| {
                            if at > now_ms {
                                format!("in {}", model::human_duration(at - now_ms))
                            } else {
                                "now".into()
                            }
                        })
                );
                if let Some(last) = &member.last_delivery {
                    delivery.push_str(&format!(
                        " · last {} ({} → {})",
                        model::observation_clock(Some(last.settled_at_ms), now_ms, &zone(app)),
                        last.messages,
                        last.batches
                    ));
                }
                lines.push(delivery);
                if let Some(edit) = &edit_lines {
                    lines.extend(edit.iter().skip(1).cloned());
                } else if let Some((wait, count)) = member.auto_caps {
                    lines.push(format!(
                        "max hold {} ▾ · max messages {count} ▾",
                        model::human_duration(wait)
                    ));
                }
                if stale {
                    lines.push("Stale observation · refresh before acting".into());
                }
            } else {
                lines.push("Delivery unavailable".into());
            }
        } else {
            let fields = model::delivery(&app.labels, id, now_ms, &zone(app), |id| {
                metrics::name(app, Some(id))
            });
            let (unavailable, labels) =
                fields.split_last().expect("delivery includes availability");
            if !labels.is_empty() {
                lines.push(labels.join(" · ").replace(" ▾", ""));
            }
            lines.push("Digest not available".into());
            lines.push("tmt extension install digest".into());
            lines.push(unavailable.clone());
        }
    } else {
        if app.labels.digest().is_none() {
            lines.push("Digest not available".into());
            lines.push("tmt extension install digest".into());
        }
        lines.extend(delivery(app, now_ms, row));
    }
    if let Some(edit) = app
        .digest_inline
        .as_ref()
        .filter(|edit| Some(&edit.target) == app.workspace.selected.as_ref())
    {
        let edit_lines = edit.lines();
        if edit_lines
            .first()
            .is_some_and(|first| !lines.contains(first))
        {
            lines.extend(edit_lines);
        }
    }
    if !selected.all
        && let Some((status, _)) = app.labels.digest()
    {
        lines.push(format!(
            "Status observed: {}",
            model::observation_time(Some(status.observed_at_ms), now_ms, &zone(app))
        ));
    }
    if let Some(error) = app.usage_report.refresh_error(app.digest_range()) {
        lines.push(format!("Stale usage retained · refresh failed: {error}"));
    }
    if let crate::board::usage_report::View::Failed(error) =
        app.usage_report.view_for(app.digest_range())
    {
        lines.push(format!("Usage unavailable: {error}"));
    }
    let sum = if selected.all {
        super::savings(app)
    } else {
        std::rc::Rc::new(metrics::savings(app, &selected.ids))
    };
    let percent = sum.percent.value;
    lines.row(PanelRow::Rule {
        title: format!("Saved · {}", app.digest_window().label()),
        note: Some(percent.map_or("saved % unavailable".into(), |value| {
            format!("{} of input", crate::board::savings::percent_text(value))
        })),
    });
    lines.row(PanelRow::Trend {
        saved: false,
        total: metrics::token_text(metrics::tokens(metrics::report(app), &selected.ids)),
    });
    lines.row(PanelRow::Trend {
        saved: true,
        total: super::table::saved(&sum, crate::config::SavingsUnit::Tokens),
    });
    if percent.is_some() && sum.percent.included < sum.total {
        lines.push(format!(
            "SAVED % covers {} of {} agents",
            sum.percent.included, sum.total
        ));
    }
    lines.push(format!(
        "{} at list price · messages/batches unavailable",
        super::table::saved(&sum, crate::config::SavingsUnit::Cost).replace("≈$", "≈ $")
    ));
    lines.row(PanelRow::Rule {
        title: format!("Models · {}", app.digest_window().label()),
        note: Some("by TOK".into()),
    });
    let mut models = BTreeMap::<String, u128>::new();
    let mut missing = false;
    for id in &selected.ids {
        if let Some(values) = metrics::report(app)
            .and_then(|report| report.seat(id))
            .and_then(|seat| seat.model_totals.as_ref())
        {
            for (name, value) in values {
                *models.entry(name.clone()).or_default() += u128::from(*value);
            }
        } else {
            missing = true;
        }
    }
    let models_empty = models.is_empty();
    let reading = metrics::tokens(metrics::report(app), &selected.ids);
    missing |= matches!(reading, Some((_, true)));
    let total = reading.map_or(0, |(total, _)| total);
    if let Some(total) = std::num::NonZeroU128::new(total) {
        for (name, value) in models {
            lines.row(PanelRow::Model {
                name,
                amount: value,
                total: total.get(),
                partial: missing,
            });
        }
    }
    if total == 0 || missing && models_empty {
        lines.push("Model distribution unavailable".into());
    }
    let timer_note = app.cron.cron.as_ref().map(|cron| {
        cron.jobs
            .iter()
            .filter(|job| {
                (selected.all
                    || job
                        .job
                        .owner_id
                        .as_deref()
                        .is_some_and(|id| selected.ids.contains(&id)))
                    && job.state_label() == "on"
            })
            .count()
    });
    lines.row(PanelRow::Rule {
        title: "Timers".into(),
        note: timer_note.map(|count| format!("{count} on")),
    });
    if let Some(cron) = app.cron.cron.as_ref() {
        let jobs = cron
            .jobs
            .iter()
            .filter(|job| {
                selected.all
                    || job
                        .job
                        .owner_id
                        .as_deref()
                        .is_some_and(|id| selected.ids.contains(&id))
            })
            .collect::<Vec<_>>();
        if jobs.is_empty() {
            lines.push("No timers".into());
        }
        for job in jobs {
            lines.push(format!(
                "{} {} {} {} {}{}",
                job.job.id(),
                job.squad,
                crate::cron_service::schedule_text(&job.job.schedule),
                job.next_ms.first().map_or("next unavailable".into(), |at| {
                    crate::board::cronboard::countdown(
                        *at,
                        i64::try_from(now_ms).unwrap_or(i64::MAX),
                    )
                }),
                crate::board::notes::single_line(&job.job.message),
                if job.state_label() == "on" {
                    ""
                } else {
                    " · paused"
                }
            ));
        }
    } else {
        lines.push("Timers unavailable".into());
    }
    lines.0
}

#[cfg(test)]
pub(super) fn panel_text(app: &App, now_ms: u64, row: Option<&Value>) -> Vec<String> {
    panel(app, now_ms, row)
        .iter()
        .map(ToString::to_string)
        .collect()
}

const FILE: &str = "digest.estimate-basis.xml";
const MARKUP: &str = r#"<tmt-view version="1"><tmt-modal id="estimate-basis" title="Estimate basis · Evidence" placement="body"><tmt-scroll id="estimate-basis-body"><tmt-repeat each="$.lines" as="line"><tmt-text bind="line.text" token="text" wrap="true"/></tmt-repeat></tmt-scroll><tmt-text slot="footer" token="muted" bind="$.footer"/></tmt-modal></tmt-view>"#;
const FOOTER: &str = "↑↓ scroll · y copy links · Esc close";
struct Data;
impl Sources for Data {
    type Source = ();
    fn compile(&self, _: &str, _: &str, _: &Schemas<'_>) -> Result<(), String> {
        Err("the estimate basis has no field sources".into())
    }
    fn resolve(&self, _: &(), _: &Scopes<'_>) -> Result<Option<String>, String> {
        Err("the estimate basis has no field sources".into())
    }
}
fn template() -> &'static surface::Template<()> {
    static TEMPLATE: OnceLock<surface::Template<()>> = OnceLock::new();
    TEMPLATE.get_or_init(|| {
        let parsed = tmt_tui::parse(FILE, MARKUP).expect("embedded estimate basis markup");
        let schema = Schema::Object(BTreeMap::from([
            (
                "lines".into(),
                Schema::Collection(Box::new(Schema::Object(BTreeMap::from([(
                    "text".into(),
                    Schema::Scalar,
                )])))),
            ),
            ("footer".into(), Schema::Scalar),
        ]));
        surface::compile(FILE, &parsed, &schema, &Data).expect("embedded estimate basis schema")
    })
}

/// The read-only Estimate basis modal over the held Evidence lines of the selected row.
#[derive(Default)]
pub(in crate::board) struct Basis {
    scroll: ScrollState,
    scene: Option<(Value, ModalSurface)>,
}

impl Basis {
    pub fn input(&mut self, event: &Event) {
        if self.scroll.viewport().height > 0 {
            self.scroll.input(event);
        }
    }

    pub fn invalidate(&mut self) {
        self.scroll
            .update(Rect::default(), self.scroll.content(), None);
    }

    /// The wrapped text admitted to the last modal viewport, for clock-only repaints.
    pub fn clock_mark(&self, app: &App, now: u64) -> String {
        let area = self.scroll.viewport();
        if area.height == 0 {
            return String::new();
        }
        evidence(app, now, app.selected_row())
            .into_iter()
            .flat_map(|line| crate::board::notes::wrap(&line, usize::from(area.width)))
            .skip(self.scroll.offset())
            .take(usize::from(area.height))
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn render(&mut self, frame: &mut Frame, app: &App, body: Rect) {
        let lines = evidence(app, crate::status::now_ms(), app.selected_row());
        let value = json!({
            "lines": lines.into_iter().map(|text| json!({"text": text})).collect::<Vec<_>>(),
            "footer": FOOTER,
        });
        if self.scene.as_ref().is_none_or(|(old, _)| old != &value) {
            self.scene = Some((
                value.clone(),
                template()
                    .materialize(FILE, &value, &Data)
                    .expect("typed estimate basis"),
            ));
        }
        let look = app.look();
        let outer = surface::render(
            &self.scene.as_ref().unwrap().1,
            &mut self.scroll,
            body,
            frame.buffer_mut(),
            RenderStyle {
                theme: &look.theme,
                depth: look.depth,
            },
            |role| look.role(role),
        )
        .expect("admitted estimate basis surface")
        .areas
        .outer;
        app.peek_areas
            .set(crate::board::app::Overlay::EstimateBasis, Some(outer));
        if self.scroll.viewport().height > 0 {
            app.frame_clocks
                .borrow_mut()
                .push(crate::board::view::ClockSurface::EstimateBasis);
        }
    }
}

impl App {
    /// Opens the Estimate basis modal over the selected row's Evidence.
    pub(in crate::board) fn open_estimate_basis(&mut self) -> Effect {
        self.estimate_basis = Some(Default::default());
        self.invalidate_frame_geometry();
        Effect::None
    }

    /// Esc or q closes; `y` copies the price-table sources; other input scrolls.
    pub(in crate::board) fn estimate_basis_event(&mut self, event: &Event) -> Option<Effect> {
        use ratatui::crossterm::event::KeyCode;
        let Event::Key(key) = event else {
            self.estimate_basis.as_ref()?.borrow_mut().input(event);
            return Some(Effect::None);
        };
        match key.code {
            KeyCode::Esc | KeyCode::Char('q') => {
                self.estimate_basis = None;
                self.invalidate_frame_geometry();
                Some(Effect::None)
            }
            KeyCode::Char('y') if key.modifiers.is_empty() => {
                let links = links(self);
                if links.is_empty() {
                    return Some(self.say("Digest reported no price sources to copy."));
                }
                Some(Effect::Act(Request::Copy {
                    text: links.join("\n"),
                    program: self.view.as_ref().and_then(|view| view.clipboard.clone()),
                    feedback: crate::board::app::CopyFeedback::Destination,
                }))
            }
            _ => {
                self.estimate_basis.as_ref()?.borrow_mut().input(event);
                Some(Effect::None)
            }
        }
    }
}
