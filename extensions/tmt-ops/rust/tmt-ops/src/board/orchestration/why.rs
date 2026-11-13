//! The Why dialog: Core's recorded decisions for a member, newest first, over the frame at any
//! width. Rows come from Core's `why` items and their `sources`; nothing is inferred locally.
use super::model::Snapshot;
use crate::board::app::{App, Effect, Overlay};
use ratatui::{Frame, crossterm::event::Event, layout::Rect};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use tmt_cli_style::{
    Role,
    grid::{self, Align, Truncate},
};
use tmt_tui::{
    binding::{Schema, Schemas, Scopes, Sources},
    components::{
        ScrollState,
        surface::{self, ModalSurface, RenderStyle},
    },
};
use unicode_width::UnicodeWidthStr;

const FILE: &str = "orchestration.why.xml";
/// What Core's journal records today: the dialog says so rather than implying it is complete.
const COVERS: &str = "holds, claims and settlements";

/// The dialog's state: whose decisions, the pages read so far and where the view is.
pub(in crate::board) struct Why {
    pub identity_id: String,
    pub name: String,
    /// The matrix cell's recipient: only decisions to them, until `a` shows all.
    pub recipient: Option<(String, String)>,
    pub all: bool,
    pub items: Vec<Value>,
    pub next_before: Option<u64>,
    pub loading: bool,
    pub failure: Option<String>,
    scroll: ScrollState,
    scene: Option<(Value, String, ModalSurface)>,
    template: Option<(String, surface::Template<()>)>,
}

impl Why {
    pub fn new(identity_id: String, name: String, recipient: Option<(String, String)>) -> Self {
        Self {
            identity_id,
            name,
            recipient,
            all: false,
            items: Vec::new(),
            next_before: None,
            loading: true,
            failure: None,
            scroll: ScrollState::default(),
            scene: None,
            template: None,
        }
    }
    /// One page from Core: the first replaces, a later one (read with `before`) appends.
    pub fn page(&mut self, before: Option<u64>, page: &Value) {
        let items = page["items"].as_array().cloned().unwrap_or_default();
        if before.is_some() {
            self.items.extend(items);
        } else {
            self.items = items;
        }
        self.next_before = page["nextBefore"].as_u64();
        self.loading = false;
        self.failure = None;
    }
    pub fn fail(&mut self, reason: String) {
        self.loading = false;
        self.failure = Some(reason);
    }
    fn filtered(&self) -> Option<&(String, String)> {
        self.recipient.as_ref().filter(|_| !self.all)
    }
    fn title(&self) -> String {
        match self.filtered() {
            Some((_, to)) => format!("Why · {} → {to}", self.name),
            None => format!("Why · {}", self.name),
        }
    }
    /// The rows shown: each decision as pieces with their roles.
    fn rows(&self, snapshot: Option<&Snapshot>, inner: usize) -> Vec<Value> {
        // One row: time, result in its role, recipient, reason, and where it came from.
        let row = |id: String,
                   time: String,
                   result: String,
                   role: Role,
                   to: String,
                   reason: String,
                   source: String| {
            json!({"id": id, "time": time, "result": result, "role": role.name(), "to": to,
                "reason": reason, "source": source})
        };
        let note = |id: &str, text: String, role: Role| {
            row(
                id.into(),
                " ".into(),
                text,
                role,
                String::new(),
                String::new(),
                String::new(),
            )
        };
        if let Some(reason) = &self.failure {
            return vec![
                note(
                    "failed",
                    format!("✕ Could not read decisions · {reason}"),
                    Role::Blocked,
                ),
                note("retry", "ctrl-r retries".into(), Role::Muted),
            ];
        }
        let name = |id: &str| {
            snapshot
                .and_then(|s| s.document.members.iter().find(|m| m.identity_id == id))
                .map_or_else(|| "a former member".to_owned(), |m| m.name.clone())
        };
        let zone = snapshot.and_then(|s| jiff::tz::TimeZone::get(&s.document.time_zone).ok());
        let day = |ms: u64| {
            jiff::Timestamp::from_millisecond(ms as i64)
                .ok()
                .zip(zone.clone())
                .map(|(t, z)| t.to_zoned(z))
        };
        let selected_day = snapshot
            .and_then(|s| day(s.document.at_ms))
            .map(|z| z.date());
        let clock = |ms: u64| {
            day(ms).map_or_else(
                || "--:--".to_owned(),
                |z| {
                    let format = if Some(z.date()) == selected_day {
                        "%H:%M"
                    } else {
                        "%a %H:%M"
                    };
                    z.strftime(format).to_string()
                },
            )
        };
        let plan = |source: &Value| -> String {
            match source["kind"].as_str() {
                Some("plan") => {
                    let id = source["planId"].as_str().unwrap_or_default();
                    let name = snapshot.map_or(id, |s| s.document.plan_name(id)).to_owned();
                    match (
                        source["slot"]["startMs"].as_u64(),
                        source["slot"]["endMs"].as_u64(),
                    ) {
                        (Some(start), Some(end)) => {
                            let hm = |ms| {
                                day(ms)
                                    .map_or_else(String::new, |z| z.strftime("%H:%M").to_string())
                            };
                            format!("← {name} ({}–{})", hm(start), hm(end))
                        }
                        _ => format!("← {name}"),
                    }
                }
                Some("focus") => "← Personal focus".into(),
                Some("member") => "← Member setting".into(),
                _ => "← Base".into(),
            }
        };
        // One time column: as wide as the widest time on the page (`Tue 21:00` beside `22:58`).
        let time_w = self
            .items
            .iter()
            .map(|item| clock(item["recordedAtMs"].as_u64().unwrap_or(0)).width())
            .max()
            .unwrap_or(5);
        let rows: Vec<Value> = self
            .items
            .iter()
            .filter(|item| {
                self.filtered()
                    .is_none_or(|(id, _)| item["recipientId"].as_str() == Some(id.as_str()))
            })
            .map(|item| {
                let outcome = item["outcome"].as_str().unwrap_or("?");
                let (mark, role) = if outcome.contains("block") {
                    ("✕", Role::Blocked)
                } else if outcome.contains("held") || outcome.contains("hold") {
                    ("◆", Role::Waiting)
                } else if outcome.contains("deliver")
                    || outcome.contains("accept")
                    || outcome.contains("claim")
                    || outcome.contains("settle")
                {
                    ("✓", Role::Working)
                } else {
                    ("·", Role::Text)
                };
                let to = item["recipientId"]
                    .as_str()
                    .filter(|_| self.filtered().is_none())
                    .map_or_else(String::new, |to| format!("{} ", name(to)));
                let sources: Vec<String> = item["sources"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|s| plan(&s["source"]))
                    .fold(Vec::new(), |mut all, s| {
                        if !all.contains(&s) {
                            all.push(s);
                        }
                        all
                    });
                let time = format!(
                    " {:<time_w$}  ",
                    clock(item["recordedAtMs"].as_u64().unwrap_or(0))
                );
                let result = format!("{mark} {outcome:<10} ");
                let reason = format!("{} ", item["reason"].as_str().unwrap_or("?"));
                let source = sources.join(" ");
                // What does not fit is cut with `…`: the source yields first, then the reason.
                let left = inner.saturating_sub(time.width() + result.width() + to.width());
                let fit = |text: &str, width: usize| {
                    grid::fit(text, width, Align::Left, Truncate::End)
                        .trim_end()
                        .to_owned()
                };
                let (reason, source) = if reason.width() + source.width() <= left {
                    (reason, source)
                } else if reason.width() < left {
                    let room = left - reason.width();
                    (reason, fit(&source, room))
                } else {
                    (fit(&reason, left), String::new())
                };
                row(
                    format!("d{}", item["id"]),
                    time,
                    result,
                    role,
                    to,
                    reason,
                    source,
                )
            })
            .collect();
        if rows.is_empty() && !self.loading {
            let whom = match self.filtered() {
                Some((_, to)) => format!("{} to {to}", self.name),
                None => self.name.clone(),
            };
            return vec![note(
                "empty",
                format!("No recorded decision for {whom} in the last 30 days"),
                Role::Muted,
            )];
        }
        if self.loading && rows.is_empty() {
            return vec![note("loading", "◌ Reading decisions…".into(), Role::Muted)];
        }
        rows
    }
    fn footer(&self, shown: usize) -> String {
        let all = self.recipient.as_ref().map(|(_, to)| {
            if self.all {
                format!(" · a only {to}")
            } else {
                " · a all decisions".to_owned()
            }
        });
        let more = if self.next_before.is_some() {
            " · ↓ reads more"
        } else {
            ""
        };
        format!(
            "↑↓ scroll{} · Esc close · {shown} recorded decision{}, newest first ({COVERS}){more}",
            all.unwrap_or_default(),
            if shown == 1 { "" } else { "s" }
        )
    }
    /// The box's markup for its title and size: at most 92 columns, as tall as its rows.
    fn template(&mut self, width: u16, height: u16) -> &surface::Template<()> {
        let title = self.title();
        let key = format!("{title}\u{0}{width}x{height}");
        if self.template.as_ref().is_none_or(|(t, _)| t != &key) {
            let escaped = title
                .replace('&', "&amp;")
                .replace('"', "&quot;")
                .replace('<', "&lt;")
                .replace('>', "&gt;");
            let markup = format!(
                r#"<tmt-view version="1"><tmt-modal id="orchestration-why" title="{escaped}" placement="center" class="w-{width} h-{height}"><tmt-scroll id="orchestration-why-body"><tmt-repeat each="$.rows" as="row"><tmt-row id-bind="row.id" class="w-full h-1"><tmt-text bind="row.time" token="muted" class="shrink-0"/><tmt-text bind="row.result" token-bind="row.role" class="shrink-0"/><tmt-text bind="row.to" token="text" class="shrink-0"/><tmt-text bind="row.reason" token="text" class="shrink-0"/><tmt-text bind="row.source" token="muted" class="shrink-0"/></tmt-row></tmt-repeat></tmt-scroll><tmt-text slot="footer" token="muted" bind="$.footer" wrap="true"/></tmt-modal></tmt-view>"#
            );
            let parsed = tmt_tui::parse(FILE, &markup).expect("Why markup");
            let row = Schema::Object(BTreeMap::from([
                ("id".into(), Schema::StableId),
                ("time".into(), Schema::Scalar),
                ("result".into(), Schema::Scalar),
                ("role".into(), Schema::Scalar),
                ("to".into(), Schema::Scalar),
                ("reason".into(), Schema::Scalar),
                ("source".into(), Schema::Scalar),
            ]));
            let schema = Schema::Object(BTreeMap::from([
                ("rows".into(), Schema::Collection(Box::new(row))),
                ("footer".into(), Schema::Scalar),
            ]));
            let template = surface::compile(FILE, &parsed, &schema, &Data).expect("Why schema");
            self.template = Some((key, template));
            self.scene = None;
        }
        &self.template.as_ref().unwrap().1
    }
    pub fn invalidate(&mut self) {
        self.scroll
            .update(Rect::default(), self.scroll.content(), None);
    }
    /// Whether the view shows the last row, where `↓` reads the next page.
    pub fn at_end(&self) -> bool {
        let viewport = usize::from(self.scroll.viewport().height);
        self.scroll.offset() + viewport >= self.scroll.content()
    }
    pub fn input(&mut self, event: &Event) {
        if self.scroll.viewport().height > 0 {
            self.scroll.input(event);
        }
    }
    pub fn render(&mut self, frame: &mut Frame, app: &App, body: Rect) {
        let width = body.width.min(92);
        let rows = self.rows(
            app.orchestration.snapshot(),
            usize::from(width.saturating_sub(4)),
        );
        let shown = rows
            .iter()
            .filter(|r| r["id"].as_str().is_some_and(|id| id.starts_with('d')))
            .count();
        let footer = self.footer(shown);
        // Borders, the rows, a blank line and the footer as it wraps inside the box.
        let inner = usize::from(width.saturating_sub(4)).max(1);
        let footer_lines = footer.chars().count().div_ceil(inner) as u16;
        let height = body.height.min(rows.len() as u16 + 3 + footer_lines).max(5);
        let value = json!({"rows": rows, "footer": footer});
        self.template(width, height);
        if self.scene.as_ref().is_none_or(|(old, _, _)| old != &value) {
            let scene = self
                .template
                .as_ref()
                .unwrap()
                .1
                .materialize(FILE, &value, &Data)
                .expect("typed Why");
            self.scene = Some((value.clone(), String::new(), scene));
        }
        let look = app.look();
        let outer = surface::render(
            &self.scene.as_ref().unwrap().2,
            &mut self.scroll,
            body,
            frame.buffer_mut(),
            RenderStyle {
                theme: &look.theme,
                depth: look.depth,
            },
            |role| look.role(role),
        )
        .expect("admitted Why surface")
        .areas
        .outer;
        app.peek_areas.set(Overlay::OrchestrationWhy, Some(outer));
    }
}

struct Data;
impl Sources for Data {
    type Source = ();
    fn compile(&self, _: &str, _: &str, _: &Schemas<'_>) -> Result<(), String> {
        Err("the Why dialog has no field sources".into())
    }
    fn resolve(&self, _: &(), _: &Scopes<'_>) -> Result<Option<String>, String> {
        Err("the Why dialog has no field sources".into())
    }
}

impl App {
    /// Esc or q closes; `a` switches between the cell's recipient and all decisions; ctrl-r
    /// reads again after a failure; other input scrolls, and `↓` at the end reads one more page.
    pub(in crate::board) fn orchestration_why_event(&mut self, event: &Event) -> Option<Effect> {
        use ratatui::crossterm::event::{KeyCode, KeyModifiers};
        let why = self.orchestration.why.as_ref()?;
        if let Event::Key(key) = event {
            match key.code {
                KeyCode::Esc | KeyCode::Char('q') => {
                    self.orchestration.why = None;
                    self.invalidate_frame_geometry();
                    return Some(Effect::None);
                }
                KeyCode::Char('a') if key.modifiers.is_empty() => {
                    let mut why = why.borrow_mut();
                    if why.recipient.is_some() {
                        why.all = !why.all;
                        why.invalidate();
                    }
                    return Some(Effect::None);
                }
                KeyCode::Char('r') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    let mut why = why.borrow_mut();
                    why.loading = true;
                    why.failure = None;
                    return Some(read(&why, None));
                }
                _ => {}
            }
        }
        let mut why = why.borrow_mut();
        let was_end = why.at_end();
        why.input(event);
        let down = matches!(event, Event::Key(key) if key.code == KeyCode::Down)
            || matches!(event, Event::Mouse(m) if m.kind == ratatui::crossterm::event::MouseEventKind::ScrollDown);
        if was_end
            && down
            && !why.loading
            && why.failure.is_none()
            && let Some(before) = why.next_before
        {
            why.loading = true;
            return Some(read(&why, Some(before)));
        }
        Some(Effect::None)
    }
}

/// The one `why` read for a page of the dialog's member.
pub(super) fn read(why: &Why, before: Option<u64>) -> Effect {
    Effect::Orchestration(super::write::Task {
        step: super::write::Step::Why {
            identity_id: why.identity_id.clone(),
            before,
        },
    })
}
