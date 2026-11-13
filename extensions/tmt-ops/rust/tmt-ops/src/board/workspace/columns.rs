//! Shared cell values over admitted workspace rows; callers own scope and actions.
use super::{OpsTarget, OpsTreeRow, observe::OpsWorkspaceSnapshot};
use crate::{
    board::{inventory::Agent, rate::Reading},
    labels::Supplied,
};
use ratatui::layout::Rect;
use tmt_cli_style::Role;

pub use crate::config::OverviewColumn as Column;

impl Column {
    pub fn title(self) -> &'static str {
        match self {
            Self::Agent => "Agent",
            Self::Squad => "Squad",
            Self::State => "State",
            Self::TokensPerHour => "TOK/h",
            Self::Digest => "Digest",
            Self::Cron => "Cron",
            Self::Runtime => "Runtime",
            Self::Model => "Model",
        }
    }
}

/// Both host profiles materialize their tracks through this one TUI solver.
fn solve_tracks<K: Copy>(width: u16, tracks: &[(K, u16, &str, u16)]) -> Vec<(K, Rect)> {
    if width == 0 || tracks.is_empty() {
        return Vec::new();
    }
    let mut markup = String::from("<tmt-view version=\"1\"><tmt-row class=\"flex-row h-1\">");
    for (index, (_, cells, title, gap)) in tracks.iter().enumerate() {
        markup.push_str(&format!(
            "<tmt-text id=\"c{index}\" class=\"w-{cells} shrink-0 truncate\">{title}</tmt-text>"
        ));
        if index + 1 < tracks.len() {
            markup.push_str(&format!(
                "<tmt-text class=\"w-{gap} shrink-0\"> </tmt-text>"
            ));
        }
    }
    markup.push_str("</tmt-row></tmt-view>");
    let file = "ops.workspace.columns.xml";
    let template = crate::board::view::scene::compile(
        file,
        &markup,
        &tmt_tui::binding::Schema::Object(Default::default()),
    );
    let root = template
        .materialize(
            file,
            &serde_json::json!({}),
            &crate::board::picker_surface::Data,
        )
        .expect("admitted workspace columns");
    let solved = tmt_tui::geometry::layout(&root, [width, 1], tmt_tui::text::measure)
        .expect("workspace column geometry");
    tracks
        .iter()
        .enumerate()
        .filter_map(|(index, (column, _, _, _))| {
            let id = format!("c{index}");
            let cell = solved.iter().find(|cell| {
                cell.node
                    .id
                    .as_ref()
                    .is_some_and(|path| path.last() == Some(&id))
            })?;
            Some((
                *column,
                Rect::new(
                    cell.rect.x.max(0) as u16,
                    0,
                    cell.rect.width.min(u32::from(u16::MAX)) as u16,
                    1,
                )
                .intersection(Rect::new(0, 0, width, 1)),
            ))
        })
        .collect()
}

/// Agents fields are presentation vocabulary, not configurable Overview columns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentsField {
    Agent,
    State,
    Session,
    Activity,
    PerMinute,
    Tokens,
    Cron,
}

impl AgentsField {
    pub fn caption(self, glyphs: crate::board::overview::cron_counts::GlyphSet) -> &'static str {
        match self {
            Self::Agent => "SQUAD / AGENT",
            Self::State => "STATE",
            Self::Session => "HOST",
            Self::Activity => "ACTIVITY 1h",
            Self::PerMinute => "TOK/min",
            Self::Tokens => crate::config::TokRange::Hour.caption(),
            Self::Cron => match glyphs {
                crate::board::overview::cron_counts::GlyphSet::Unicode => "◷",
                crate::board::overview::cron_counts::GlyphSet::Ascii => "CRON",
            },
        }
    }
    fn minimum(self) -> u16 {
        match self {
            Self::Agent => 18,
            Self::State => 15,
            Self::Session => 20,
            Self::Activity => 12,
            Self::PerMinute => 7,
            Self::Tokens => 7,
            Self::Cron => 3,
        }
    }
    fn gap(self) -> u16 {
        1
    }
}

type AgentSlots = Vec<(AgentsField, Rect)>;

#[derive(Default)]
pub(in crate::board) struct AgentsLayout {
    held: Option<(u16, bool, AgentSlots)>,
    roster: Option<(u16, Vec<(RosterField, Rect)>)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RosterField {
    Member,
    State,
    Task,
}

impl RosterField {
    pub fn caption(self) -> &'static str {
        match self {
            Self::Member => "MEMBER",
            Self::State => "STATE",
            Self::Task => "TASK / NEXT ACTION",
        }
    }
}
impl AgentsLayout {
    pub fn roster_slots(&mut self, area: Rect) -> Vec<(RosterField, Rect)> {
        if self
            .roster
            .as_ref()
            .is_none_or(|(width, _)| *width != area.width)
        {
            let member = if area.width >= 66 { 22 } else { 12 };
            let state = 15;
            let task = area.width.saturating_sub(member + state + 2);
            self.roster = Some((
                area.width,
                solve_tracks(
                    area.width,
                    &[
                        (RosterField::Member, member, "MEMBER", 1),
                        (RosterField::State, state, "STATE", 1),
                        (RosterField::Task, task, "TASK / NEXT ACTION", 0),
                    ],
                ),
            ));
        }
        self.roster
            .as_ref()
            .unwrap()
            .1
            .iter()
            .map(|(field, slot)| {
                (
                    *field,
                    Rect::new(area.x + slot.x, area.y, slot.width, 1).intersection(area),
                )
            })
            .collect()
    }
    /// `inside` is the list rectangle after canonical placement and pane chrome.
    #[cfg(test)]
    pub fn slots(&mut self, inside: Rect) -> Vec<(AgentsField, Rect)> {
        self.slots_with_labels(inside, false)
    }

    pub fn slots_with_labels(&mut self, inside: Rect, labels: bool) -> Vec<(AgentsField, Rect)> {
        if self
            .held
            .as_ref()
            .is_none_or(|(width, held_labels, _)| *width != inside.width || *held_labels != labels)
        {
            let width = inside.width;
            let mut fields = vec![
                AgentsField::Agent,
                AgentsField::State,
                AgentsField::Session,
                AgentsField::Activity,
                AgentsField::PerMinute,
                AgentsField::Tokens,
                AgentsField::Cron,
            ];
            let demand = |fields: &[AgentsField]| {
                fields.iter().map(|f| f.minimum()).sum::<u16>()
                    + fields
                        .iter()
                        .take(fields.len().saturating_sub(1))
                        .map(|f| f.gap())
                        .sum::<u16>()
            };
            for optional in [
                AgentsField::Session,
                AgentsField::Activity,
                AgentsField::PerMinute,
            ] {
                if demand(&fields) <= width {
                    break;
                }
                fields.retain(|f| *f != optional);
            }
            let mut state_width = AgentsField::State.minimum().min(width.saturating_sub(2));
            let mut name_width = AgentsField::Agent.minimum();
            let mut spare = width.saturating_sub(demand(&fields));
            // Approved Agents mock: first widen names, then state, then names again.
            const NAME_FIRST_TARGET: u16 = 21;
            const STATE_TARGET: u16 = 20;
            const NAME_FINAL_TARGET: u16 = 24;
            let name_first = spare
                .min((NAME_FIRST_TARGET + if labels { 4 } else { 0 }).saturating_sub(name_width));
            name_width += name_first;
            spare -= name_first;
            let state_extra = spare.min(STATE_TARGET.saturating_sub(state_width));
            state_width += state_extra;
            spare -= state_extra;
            let name_last = spare
                .min((NAME_FINAL_TARGET + if labels { 4 } else { 0 }).saturating_sub(name_width));
            name_width += name_last;
            let tracks: Vec<_> = fields
                .iter()
                .copied()
                .map(|field| {
                    (
                        field,
                        if field == AgentsField::Agent {
                            name_width
                        } else if field == AgentsField::State {
                            state_width
                        } else {
                            field.minimum()
                        },
                        field.caption(Default::default()),
                        field.gap(),
                    )
                })
                .collect();
            self.held = Some((inside.width, labels, solve_tracks(width, &tracks)));
        }
        self.held
            .as_ref()
            .unwrap()
            .2
            .iter()
            .map(|(field, slot)| {
                let width = slot.width;
                (
                    *field,
                    Rect::new(inside.x.saturating_add(slot.x), inside.y, width, 1)
                        .intersection(inside),
                )
            })
            .collect()
    }
}

/// How the TOK column is headed: its saved range, in tokens or in money.
#[derive(Clone, Copy, Default)]
pub struct TokHeading {
    pub range: crate::config::TokRange,
    pub money: bool,
}

impl TokHeading {
    pub fn caption(self) -> &'static str {
        self.range.caption_in(self.money)
    }

    /// The unit word on screen: `TOK` or `≈$`.
    pub fn unit(self) -> &'static str {
        if self.money { "≈$" } else { "TOK" }
    }

    /// The unit a click on the unit word switches to.
    pub fn other_unit(self) -> &'static str {
        Self {
            money: !self.money,
            ..self
        }
        .unit()
    }
}

/// Paints the Agents column header and returns the hit areas of its controls:
/// the TOK unit and window words when the TOK column is present, and the sortable words.
pub fn paint_agents_header(
    buffer: &mut ratatui::buffer::Buffer,
    area: Rect,
    slots: &[(AgentsField, Rect)],
    look: crate::look::Look,
    glyphs: crate::board::overview::cron_counts::GlyphSet,
    tok: TokHeading,
    marks: &crate::board::header_sort::Marks,
) -> AgentsHeaderHits {
    use crate::board::header_sort::{Header, word_hit};
    let mut hits = AgentsHeaderHits::default();
    if area.height == 0 {
        return hits;
    }
    for (field, slot) in slots {
        let sorts = match field {
            AgentsField::Agent => Some((Header::Squads(crate::config::OpsSort::Name), 2)),
            AgentsField::State => Some((Header::Squads(crate::config::OpsSort::Attention), 0)),
            _ => None,
        };
        let base = look.role(Role::Muted);
        let mut word = field.caption(glyphs);
        let mut style = base;
        let caption = if *field == AgentsField::Tokens {
            if let Some(cell) = marks.tokens(None, tok, slot.width, base, look) {
                for (from, size, control) in cell.parts {
                    let hit =
                        Rect::new(slot.x.saturating_add(from), slot.y, size, 1).intersection(*slot);
                    hits.tok.push((hit, control));
                }
                tmt_tui::components::strip::paint_left(
                    buffer,
                    *slot,
                    ratatui::text::Line::from(cell.spans),
                );
                continue;
            }
            word = tok.caption();
            word.to_owned()
        } else if let Some((header, lead)) = sorts {
            if let Some(hit) = word_hit(*slot, lead, word) {
                hits.sorts.push((hit, header));
            }
            style = marks.style(header, base, look);
            let lead = " ".repeat(usize::from(lead));
            match marks.mark(header) {
                Some(mark) => format!("{lead}{word} {mark}"),
                None => format!("{lead}{word}"),
            }
        } else {
            word.to_owned()
        };
        let align = if matches!(*field, AgentsField::Tokens | AgentsField::PerMinute) {
            tmt_cli_style::grid::Align::Right
        } else if *field == AgentsField::Cron {
            tmt_cli_style::grid::Align::Center
        } else {
            tmt_cli_style::grid::Align::Left
        };
        tmt_tui::components::strip::paint_left(
            buffer,
            *slot,
            ratatui::text::Line::styled(
                tmt_tui::text::fit_line(
                    &caption,
                    slot.width,
                    tmt_tui::style::TextFlow::Truncate,
                    align,
                ),
                style,
            ),
        );
    }
    hits
}

/// What the Agents header made clickable.
#[derive(Default)]
pub struct AgentsHeaderHits {
    /// The unit and window words of `TOK 1h`.
    pub tok: Vec<(Rect, crate::board::header_sort::Control)>,
    pub sorts: Vec<(Rect, crate::board::header_sort::Header)>,
}

pub fn paint_roster_header(
    buffer: &mut ratatui::buffer::Buffer,
    area: Rect,
    slots: &[(RosterField, Rect)],
    look: crate::look::Look,
) {
    paint_header_tracks(
        buffer,
        area,
        slots,
        look,
        |field| field.caption().into(),
        |_| ("", false),
    );
}

fn paint_header_tracks<K: Copy>(
    buffer: &mut ratatui::buffer::Buffer,
    area: Rect,
    slots: &[(K, Rect)],
    look: crate::look::Look,
    caption: impl Fn(K) -> String,
    annotation: impl Fn(K) -> (&'static str, bool),
) {
    use ratatui::{style::Modifier, text::Line};
    use tmt_tui::components::strip;
    if area.height == 0 {
        return;
    }
    let row = Rect { height: 1, ..area };
    let base = if look.depth == tmt_cli_style::Depth::None {
        look.role(Role::Muted)
    } else {
        look.role(Role::Track).patch(look.role(Role::Muted))
    }
    .add_modifier(
        Modifier::BOLD
            | if area.height == 1 {
                Modifier::UNDERLINED
            } else {
                Modifier::empty()
            },
    );
    buffer.set_style(row, base);
    for (column, slot) in slots {
        let (mark, hot) = annotation(*column);
        let mark_width = unicode_width::UnicodeWidthStr::width(mark) as u16;
        let label = crate::board::view::fit(
            &caption(*column),
            usize::from(slot.width.saturating_sub(mark_width)),
        );
        let style = if hot {
            base.patch(look.role(Role::Accent))
        } else {
            base
        };
        strip::paint_left(buffer, *slot, Line::styled(format!("{label}{mark}"), style));
    }
    if area.height > 1 {
        strip::paint_left(
            buffer,
            Rect::new(area.x, area.y + 1, area.width, 1),
            Line::styled("─".repeat(usize::from(area.width)), look.role(Role::Dim)),
        );
    }
}

pub fn state_symbol(state: Option<&str>) -> &'static str {
    match crate::board::state_cell::glyph(state) {
        "?" => "—",
        known => known,
    }
}

/// State semantics apply only to the state cell; other table cells stay neutral.
pub fn state_style(app: &crate::board::app::App, row: &OpsTreeRow) -> ratatui::style::Style {
    let look = app.look();
    let role = match row.state.as_deref() {
        Some("waiting") => Role::Waiting,
        Some("blocked") => Role::Blocked,
        _ => Role::Text,
    };
    app.workspace_snapshot()
        .and_then(|snapshot| snapshot.rows.get(&row.target))
        .and_then(|raw| raw["colors"]["state"].as_str())
        .filter(|_| row.state.as_deref() != Some("waiting"))
        .map_or_else(|| look.role(role), |color| look.named(color))
}

/// The activity glyph: only a request that waits on the user uses attention
/// colour; the `?` of stale or unknown activity is muted.
pub fn activity_style(app: &crate::board::app::App, state: &str) -> ratatui::style::Style {
    app.look().role(activity_role(state))
}

fn activity_role(state: &str) -> Role {
    match state {
        "waiting" => Role::Waiting,
        "stale" | "unknown" => Role::Muted,
        _ => Role::Text,
    }
}

/// The secondary task state is muted; only a blocked-type (`✗`) task is red.
/// `◆` and `✗` are the board's only attention colours, so no authored task
/// colour applies here.
fn task_role(row: &OpsTreeRow) -> Role {
    let task = row
        .activity
        .as_ref()
        .and_then(|member| member.task.as_deref());
    if crate::board::state_cell::glyph(task) == "✗" {
        Role::Blocked
    } else {
        Role::Muted
    }
}

/// A member's STATE cell in `width` cells: the glyph, the activity words and
/// the task state when it fits. Only the glyph carries request attention colour;
/// the words stay neutral and only a blocked-type task is red. Unread replies
/// replace the glyph and the activity words with the shared unread mark
/// (`● N unread`, blue on the glyph only); the task still follows.
pub fn activity_spans(
    app: &crate::board::app::App,
    row: &OpsTreeRow,
    label: &crate::board::activity::Label,
    width: usize,
    selected: bool,
) -> (
    Vec<ratatui::text::Span<'static>>,
    Option<ratatui::text::Span<'static>>,
    Option<ratatui::text::Span<'static>>,
) {
    let projected = activity_projection(app, row, label, width);
    let native = |span: tmt_tui::components::design_system::TextSpan| {
        ratatui::text::Span::styled(
            span.text,
            table_style(app, selected, app.look().role(span.role.0)),
        )
    };
    (
        projected.primary.into_iter().map(native).collect(),
        projected.task.map(native),
        projected.todo.map(native),
    )
}

fn todo_text(
    app: &crate::board::app::App,
    row: &OpsTreeRow,
    used: usize,
    width: usize,
) -> Option<String> {
    use unicode_width::UnicodeWidthStr;
    let label = app.notes.row_label(&row.target)?;
    let full = format!(" · {label}");
    (used + full.width() <= width).then_some(full)
}

/// Counts are optional: the existing state and task keep their whole width first.
pub fn todo_span(
    app: &crate::board::app::App,
    row: &OpsTreeRow,
    used: usize,
    width: usize,
    selected: bool,
) -> Option<ratatui::text::Span<'static>> {
    todo_text(app, row, used, width).map(|text| {
        ratatui::text::Span::styled(
            text,
            table_style(app, selected, app.look().role(Role::Muted)),
        )
    })
}

pub(in crate::board) struct ActivityProjection {
    pub primary: Vec<tmt_tui::components::design_system::TextSpan>,
    pub task: Option<tmt_tui::components::design_system::TextSpan>,
    pub todo: Option<tmt_tui::components::design_system::TextSpan>,
}

pub(in crate::board) fn activity_projection(
    app: &crate::board::app::App,
    row: &OpsTreeRow,
    label: &crate::board::activity::Label,
    width: usize,
) -> ActivityProjection {
    use tmt_tui::components::design_system::{TextSpan, Token};
    use unicode_width::UnicodeWidthStr;
    let span = |text: String, role| TextSpan {
        text,
        role: Token(role),
        bold: false,
    };
    let (primary, task) = if width == 0 {
        (Vec::new(), None)
    } else if let Some(unread) =
        crate::board::state_cell::unread(app.unread_target(&row.target), app.look())
    {
        let mut used = 0;
        let mut primary = Vec::new();
        for (index, part) in unread.spans.into_iter().enumerate() {
            let room = width.saturating_sub(used);
            let content = crate::board::view::fit(&part.content, part.content.width().min(room));
            if content.is_empty() {
                break;
            }
            used += content.width();
            primary.push(span(
                content,
                if index == 0 {
                    Role::Unread
                } else {
                    Role::Muted
                },
            ));
        }
        let room = width.saturating_sub(used);
        // The unread words replace the activity word, so a task equal to that
        // word still follows; only a repeat of the shown words is left out.
        let shown: String = primary
            .iter()
            .skip(1)
            .map(|part| part.text.as_str())
            .collect();
        let task = label
            .task
            .as_ref()
            .filter(|task| *task != shown.trim())
            .and_then(|task| {
                let tail = format!(" · {task}");
                // A suffix that does not fit whole is dropped, never cut inside a word.
                (tail.width() <= room).then_some(tail)
            })
            .map(|text| span(text, task_role(row)));
        (primary, task)
    } else {
        let over = label
            .idle_over
            .then(|| crate::board::state_cell::over(app.cron_glyphs, app.look()));
        let symbol = over.as_ref().map_or_else(
            || crate::board::state_cell::glyph(Some(label.state)),
            |mark| mark.content.as_ref(),
        );
        let unknown = label.state == "unknown";
        let (head, task) = label.fit(if unknown {
            width
        } else {
            width.saturating_sub(symbol.width() + 1)
        });
        let words = if unknown {
            String::new()
        } else {
            format!(" {head}")
        };
        let room = width.saturating_sub(symbol.width());
        let words = crate::board::view::fit(&words, words.width().min(room));
        let mut primary = vec![span(
            symbol.to_owned(),
            if over.is_some() {
                Role::Waiting
            } else if label.state == "working"
                && app.shell.tab == crate::board::shell::OpsTab::Agents
            {
                Role::Working
            } else {
                activity_role(label.state)
            },
        )];
        if !words.is_empty() {
            primary.push(span(words, Role::Text));
        }
        (primary, task.map(|text| span(text, task_role(row))))
    };
    let used = primary.iter().map(|part| part.text.width()).sum::<usize>()
        + task.as_ref().map_or(0, |part| part.text.width());
    let todo = todo_text(app, row, used, width).map(|text| span(text, Role::Muted));
    ActivityProjection {
        primary,
        task,
        todo,
    }
}

pub(in crate::board) fn record_activity_geometry(
    app: &crate::board::app::App,
    row: &OpsTreeRow,
    cell: ratatui::layout::Rect,
    primary: u16,
    task: u16,
) {
    use ratatui::layout::Rect;
    let mut states = app.workspace_state_cells.borrow_mut();
    if primary > 0 {
        states.push(Rect::new(cell.x, cell.y, primary, 1));
        app.push_unread_row_hit(Rect::new(cell.x, cell.y, primary, 1), &row.target);
    }
    if task > 0 {
        states.push(Rect::new(cell.x + primary, cell.y, task, 1));
    }
}

/// Reverse-only selection suppresses per-state foregrounds, as `table_style` does.
pub(in crate::board) fn activity_selection(
    spans: &mut [tmt_tui::components::design_system::TextSpan],
    app: &crate::board::app::App,
    selected: bool,
) {
    if selected && app.look().selection().bg.is_none() {
        for span in spans {
            span.role = tmt_tui::components::design_system::Token(Role::Selection);
        }
    }
}

/// Paints a member's STATE words into `cell` and records their areas as state
/// cells, so selection keeps their colours. Returns the painted width.
pub fn paint_activity(
    buffer: &mut ratatui::buffer::Buffer,
    app: &crate::board::app::App,
    row: &OpsTreeRow,
    label: &crate::board::activity::Label,
    cell: ratatui::layout::Rect,
    selected: bool,
) -> u16 {
    let (primary, task, todo) = activity_spans(app, row, label, usize::from(cell.width), selected);
    let width = primary.iter().map(|span| span.width()).sum::<usize>() as u16;
    let task_width = task.as_ref().map_or(0, |task| {
        (task.width() as u16).min(cell.width.saturating_sub(width))
    });
    record_activity_geometry(app, row, cell, width, task_width);
    let todo_width = todo.as_ref().map_or(0, |span| span.width() as u16);
    tmt_tui::components::strip::paint_left(
        buffer,
        cell,
        ratatui::text::Line::from_iter(primary.into_iter().chain(task).chain(todo)),
    );
    width + task_width + todo_width
}

pub fn table_style(
    app: &crate::board::app::App,
    selected: bool,
    style: ratatui::style::Style,
) -> ratatui::style::Style {
    if selected {
        app.look()
            .selection()
            .patch(app.look().row_span(true, style, false))
            .remove_modifier(ratatui::style::Modifier::BOLD)
    } else {
        style
    }
}

#[derive(Clone)]
pub struct WorkspaceColumnLabel {
    pub text: String,
    pub actionable: bool,
}

pub struct WorkspaceColumnInput<'a> {
    pub row: &'a OpsTreeRow,
    pub snapshot: &'a OpsWorkspaceSnapshot,
    pub labels: &'a Supplied,
    pub usage: Option<Reading>,
    pub agent: Option<&'a Agent>,
    /// Supplied by the caller's existing global or room/owner count projection.
    pub timers: Option<(u32, u32)>,
}

#[derive(Clone)]
pub struct WorkspaceColumnValues {
    pub squad: Option<String>,
    pub tokens: Option<f64>,
    pub partial: bool,
    pub digest: Option<String>,
    pub cron: Option<(u32, u32)>,
    pub runtime: Option<String>,
    pub model: Option<String>,
    /// A basic driver observes no runtime: say `basic` where the runtime is blank.
    pub basic: bool,
}

impl WorkspaceColumnValues {
    pub fn text(&self, column: Column, row: &OpsTreeRow) -> String {
        match column {
            Column::Agent => row.title.clone(),
            Column::Squad => self.squad.clone().unwrap_or_else(|| "—".into()),
            Column::State => row.state.clone().unwrap_or_else(|| "—".into()),
            Column::TokensPerHour => self.tokens.map_or_else(
                || "—".into(),
                |tokens| {
                    format!(
                        "{}{}",
                        if self.partial { "~" } else { "" },
                        crate::source::tokens(tokens.round() as u128)
                    )
                },
            ),
            Column::Digest => self.digest.clone().unwrap_or_else(|| "—".into()),
            Column::Cron => self
                .cron
                .map_or_else(|| "unknown".into(), |(on, total)| format!("{on}/{total}")),
            Column::Runtime => self
                .runtime
                .clone()
                .unwrap_or_else(|| if self.basic { "basic" } else { "—" }.into()),
            Column::Model => self.model.clone().unwrap_or_else(|| "—".into()),
        }
    }
}

pub fn member_digest_labels(labels: &Supplied, id: &str) -> Vec<WorkspaceColumnLabel> {
    labels
        .of(id)
        .filter(|(source, _)| *source == "digest")
        .map(|(_, label)| WorkspaceColumnLabel {
            text: label.text.clone(),
            actionable: label.action.is_some(),
        })
        .collect()
}

pub fn project(input: WorkspaceColumnInput<'_>) -> Option<WorkspaceColumnValues> {
    let OpsTarget::Member {
        room_id,
        identity_id,
    } = &input.row.target
    else {
        return None;
    };
    let squad = room_id
        .as_ref()
        .and_then(|room| {
            input
                .snapshot
                .roster
                .squads
                .iter()
                .find(|squad| &squad.room_id == room)
                .map(|squad| squad.name.clone())
        })
        .or_else(|| room_id.is_none().then(|| "Common pool".into()));
    let verified = input
        .labels
        .digest()
        .is_some_and(|(status, stale)| !stale && status.members.contains_key(identity_id));
    let digest_labels = member_digest_labels(input.labels, identity_id);
    // A plain program is not an agent: no tokens and no Digest, its program as the model.
    let plain = input
        .agent
        .and_then(|agent| agent.plain_program())
        .map(str::to_owned);
    let digest = verified
        .then(|| digest_labels.first().map(|label| label.text.clone()))
        .flatten()
        .filter(|_| plain.is_none());
    // The cell's primary value is the supplier's mode label; secondary labels
    // remain available to the painter and Details without becoming a policy.
    Some(WorkspaceColumnValues {
        squad,
        tokens: input
            .usage
            .filter(|_| plain.is_none())
            .map(|reading| reading.tokens as f64),
        partial: input.usage.is_some_and(|reading| reading.partial),
        digest,
        cron: input.timers,
        runtime: input.agent.and_then(|agent| agent.runtime.clone()),
        model: plain.or_else(|| input.agent.and_then(|agent| agent.model.clone())),
        basic: input.agent.is_some_and(|agent| agent.basic),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_activity_tracks_drop_optional_columns_in_spec_order() {
        use crate::board::overview::cron_counts::GlyphSet;
        let mut layout = AgentsLayout::default();
        for (width, expected) in [
            (
                88,
                vec![
                    "SQUAD / AGENT",
                    "STATE",
                    "HOST",
                    "ACTIVITY 1h",
                    "TOK/min",
                    "TOK 1h",
                    "◷",
                ],
            ),
            (
                67,
                vec![
                    "SQUAD / AGENT",
                    "STATE",
                    "ACTIVITY 1h",
                    "TOK/min",
                    "TOK 1h",
                    "◷",
                ],
            ),
            (54, vec!["SQUAD / AGENT", "STATE", "TOK/min", "TOK 1h", "◷"]),
            (46, vec!["SQUAD / AGENT", "STATE", "TOK 1h", "◷"]),
        ] {
            let slots = layout.slots(Rect::new(0, 0, width, 1));
            assert_eq!(
                slots
                    .iter()
                    .map(|(field, _)| field.caption(GlyphSet::Unicode))
                    .collect::<Vec<_>>(),
                expected,
                "width {width}"
            );
        }
    }

    #[test]
    fn agents_tracks_follow_pane_width_and_drop_only_whole_optional_fields() {
        let mut layout = AgentsLayout::default();
        let wide = layout.slots(Rect::new(0, 7, 75, 1));
        assert_eq!(
            wide.iter()
                .map(|(field, slot)| (*field, slot.x, slot.width))
                .collect::<Vec<_>>(),
            vec![
                (AgentsField::Agent, 0, 21),
                (AgentsField::State, 22, 20),
                (AgentsField::Activity, 43, 12),
                (AgentsField::PerMinute, 56, 7),
                (AgentsField::Tokens, 64, 7),
                (AgentsField::Cron, 72, 3),
            ]
        );
        let labelled = layout.slots_with_labels(Rect::new(0, 7, 75, 1), true);
        assert_eq!(
            labelled
                .iter()
                .find(|(field, _)| *field == AgentsField::Agent)
                .unwrap()
                .1
                .width,
            25
        );
        assert_eq!(
            labelled
                .iter()
                .find(|(field, _)| *field == AgentsField::State)
                .unwrap()
                .1
                .width,
            16
        );
        assert_eq!(layout.slots(Rect::new(0, 7, 75, 1)), wide);
        let stacked = layout.slots_with_labels(Rect::new(0, 7, 160, 1), true);
        assert_eq!(
            stacked
                .iter()
                .find(|(field, _)| *field == AgentsField::Agent)
                .unwrap()
                .1
                .width,
            28
        );
        assert_eq!(
            stacked
                .iter()
                .find(|(field, _)| *field == AgentsField::State)
                .unwrap()
                .1
                .width,
            20
        );
        for width in 0..=160 {
            let area = Rect::new(4, 8, width, 1);
            let slots = layout.slots(area);
            assert!(
                slots
                    .iter()
                    .all(|(_, slot)| slot.intersection(area) == *slot)
            );
            assert!(
                slots
                    .windows(2)
                    .all(|pair| pair[0].1.right() <= pair[1].1.x)
            );
            for (field, threshold) in [
                (AgentsField::Session, 88),
                (AgentsField::Activity, 67),
                (AgentsField::PerMinute, 54),
            ] {
                let slot = slots.iter().find(|(held, _)| *held == field);
                assert_eq!(slot.is_some(), width >= threshold, "{field:?} at {width}");
                if let Some((_, slot)) = slot {
                    assert_eq!(slot.width, field.minimum(), "optional fields fit whole");
                }
            }
            if width >= 46 {
                for field in [AgentsField::Tokens, AgentsField::Cron] {
                    assert_eq!(
                        slots
                            .iter()
                            .find(|(held, _)| *held == field)
                            .unwrap()
                            .1
                            .width,
                        field.minimum()
                    );
                }
            }
        }
        assert_eq!(AgentsField::Cron.caption(Default::default()), "◷");
    }

    #[test]
    fn timer_header_matches_the_timer_value_column() {
        let look = crate::look::Look::default();
        let slot = Rect::new(0, 0, 4, 1);
        let mut buffer = ratatui::buffer::Buffer::empty(slot);
        paint_agents_header(
            &mut buffer,
            slot,
            &[(AgentsField::Cron, slot)],
            look,
            Default::default(),
            Default::default(),
            &crate::board::header_sort::Marks::new(Default::default(), None, Default::default()),
        );
        let x = (0..slot.width)
            .find(|&x| buffer[(x, 0)].symbol() == "◷")
            .unwrap();
        let value = tmt_tui::text::fit_line(
            "1",
            slot.width,
            tmt_tui::style::TextFlow::Truncate,
            tmt_cli_style::grid::Align::Center,
        );
        assert_eq!(usize::from(x), value.find('1').unwrap());
    }

    #[test]
    fn shared_header_stays_bounded_and_neutral_at_every_depth() {
        use ratatui::buffer::Buffer;
        for base in [tmt_cli_style::Base::Tmt, tmt_cli_style::Base::TmtLight] {
            for depth in [tmt_cli_style::Depth::TrueColor, tmt_cli_style::Depth::None] {
                let look = crate::look::Look {
                    theme: tmt_cli_style::Theme::new(base),
                    depth,
                };
                let mut layout = AgentsLayout::default();
                let area = Rect::new(0, 0, 100, 3);
                let slots = layout.slots(area);
                let mut buffer = Buffer::empty(area);
                paint_agents_header(
                    &mut buffer,
                    Rect { height: 2, ..area },
                    &slots,
                    look,
                    Default::default(),
                    Default::default(),
                    &crate::board::header_sort::Marks::new(
                        Default::default(),
                        None,
                        Default::default(),
                    ),
                );
                assert_eq!(
                    buffer[(0, 2)].symbol(),
                    " ",
                    "header cannot paint into its data row"
                );
                assert_eq!(buffer[(0, 1)].symbol(), " ");
                assert!(
                    buffer
                        .content
                        .iter()
                        .all(|cell| !cell.symbol().contains('↕'))
                );
                assert_eq!(
                    buffer[(0, 0)].fg,
                    look.role(Role::Muted).fg.unwrap_or_default()
                );
            }
        }
    }

    #[test]
    fn a_plain_program_row_shows_its_program_as_model_and_no_tokens_or_digest() {
        let mut app = crate::board::app::workspace::tests::board();
        let rows = app.workspace_rows();
        let row = rows
            .iter()
            .find(|row| matches!(row.target, OpsTarget::Member { .. }))
            .unwrap();
        let OpsTarget::Member { identity_id, .. } = &row.target else {
            unreachable!()
        };
        app.labels = Supplied::from_rows(vec![(
            "digest".into(),
            [(
                identity_id.clone(),
                vec![crate::labels::Label {
                    text: "supplier mode".into(),
                    role: Role::Muted,
                    action: None,
                }],
            )]
            .into(),
        )]);
        let usage = Reading {
            tokens: 1200,
            partial: false,
            span: 0,
        };
        let cells = |listed: serde_json::Value| {
            let agent = crate::board::inventory::Inventory::from_listed(&Ok(
                serde_json::json!({"identities": [listed]}),
            ))
            .agents
            .remove("a")
            .unwrap();
            project(WorkspaceColumnInput {
                row,
                snapshot: app.workspace_snapshot().unwrap(),
                labels: &app.labels,
                usage: Some(usage),
                agent: Some(&agent),
                timers: None,
            })
            .unwrap()
        };
        let agent = cells(serde_json::json!({"id": "a", "name": "w",
            "runningDriver": "codex", "resume": {"model": "gpt-6.1-sol"}}));
        assert_eq!(agent.text(Column::Model, row), "gpt-6.1-sol");
        assert_eq!(agent.text(Column::TokensPerHour, row), "1.2k");
        let plain = cells(serde_json::json!({"id": "a", "name": "w", "plainProgram": "zsh"}));
        assert_eq!(plain.text(Column::Model, row), "zsh");
        assert_eq!(plain.text(Column::TokensPerHour, row), "—");
        assert_eq!(plain.text(Column::Digest, row), "—");
    }

    #[test]
    fn supplier_choice_labels_survive_missing_typed_statistics() {
        let mut app = crate::board::app::workspace::tests::board();
        let rows = app.workspace_rows();
        let row = rows
            .iter()
            .find(|row| matches!(row.target, OpsTarget::Member { .. }))
            .unwrap();
        let OpsTarget::Member { identity_id, .. } = &row.target else {
            unreachable!()
        };
        app.labels = Supplied::from_rows(vec![(
            "digest".into(),
            [(
                identity_id.clone(),
                vec![crate::labels::Label {
                    text: "supplier mode".into(),
                    role: Role::Waiting,
                    action: None,
                }],
            )]
            .into(),
        )]);
        let projected = project(WorkspaceColumnInput {
            row,
            snapshot: app.workspace_snapshot().unwrap(),
            labels: &app.labels,
            usage: None,
            agent: None,
            timers: Some((0, 0)),
        })
        .unwrap();
        assert!(
            projected.digest.is_none(),
            "generic labels cannot invent typed mode evidence"
        );
        assert_eq!(
            member_digest_labels(&app.labels, identity_id)[0].text,
            "supplier mode"
        );
        assert_eq!(
            app.labels.of(identity_id).next().unwrap().1.role,
            Role::Waiting
        );
        assert_eq!(
            projected.cron,
            Some((0, 0)),
            "an admitted zero stays distinct from missing"
        );
        assert_eq!(projected.text(Column::Runtime, row), "—");
    }

    #[test]
    fn a_basic_driver_says_basic_where_its_runtime_is_blank_and_nowhere_else() {
        let row = OpsTreeRow {
            target: OpsTarget::Pool,
            title: "pi-1".into(),
            depth: 0,
            lead: false,
            state: None,
            presence: None,
            usage: None,
            activity: None,
            count: None,
            observation: crate::board::workspace::OpsObservation::Complete,
        };
        let values = |runtime: Option<&str>, basic: bool| WorkspaceColumnValues {
            squad: None,
            tokens: None,
            partial: false,
            digest: None,
            cron: None,
            runtime: runtime.map(str::to_owned),
            model: None,
            basic,
        };
        assert_eq!(values(None, true).text(Column::Runtime, &row), "basic");
        assert_eq!(values(None, false).text(Column::Runtime, &row), "—");
        // An observed runtime always wins, and no other cell changes.
        assert_eq!(values(Some("pi"), true).text(Column::Runtime, &row), "pi");
        assert_eq!(values(None, true).text(Column::Model, &row), "—");
        assert_eq!(values(None, true).text(Column::State, &row), "—");
    }
}

#[cfg(test)]
mod live_width_review {
    use super::*;
    #[test]
    fn spare_cells_first_widen_the_name_then_state_then_name_again() {
        let mut layout = AgentsLayout::default();
        for (width, name, state) in [
            (67, 18, 15),
            (70, 21, 15),
            (75, 21, 20),
            (78, 24, 20),
            (100, 24, 20),
        ] {
            let slots = layout.slots(Rect::new(0, 0, width, 1));
            let get = |field| slots.iter().find(|(f, _)| *f == field).unwrap().1;
            assert_eq!(
                (get(AgentsField::Agent).width, get(AgentsField::State).width),
                (name, state),
                "width {width}"
            );
            assert_eq!(
                get(AgentsField::Cron).x,
                get(AgentsField::Tokens).right() + 1,
                "timer stays adjacent to the TOK range"
            );
        }
    }
}
