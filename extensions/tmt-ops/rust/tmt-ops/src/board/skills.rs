//! The recipient's skills menu in the composer (#5532, #5924). `/` at the start of any
//! token opens the skills that member's agent reports through Core's `skills.list`; Ops
//! never reads a provider directory. A chosen skill is a fold over `/name`, written in the
//! recipient's own syntax only when the message is sent, so typed text is never rewritten.
use super::app::{App, Compose, Effect, MESSAGE_LIMIT};
use crate::core::Core;
use ratatui::{
    Frame,
    crossterm::event::{KeyCode, KeyEvent, MouseButton, MouseEvent, MouseEventKind},
    layout::Rect,
    text::{Line, Span},
};
use serde_json::{Value, json};
use std::{
    cell::RefCell,
    collections::HashMap,
    time::{Duration, Instant},
};
use tmt_cli_style::{
    Role,
    grid::{Align, Truncate, fit},
};
use tmt_tui::components::{Candidate, Completion, Editor, strip};

/// The one trigger for every recipient; the sent form follows the recipient's syntax.
pub(super) const TRIGGER: &str = "/";
/// A chosen skill is an expanded fold over its `/name` text whose label holds the name;
/// editing the text drops the fold, and with it the conversion.
const SKILL: &str = "tmt-skill:";
/// A held report is asked again, by stamp, at most this often while its composer is open.
const REFRESH: Duration = Duration::from_secs(30);
/// Menu rows above the hint row, headers included, as the `@` picker shows.
const ROWS: usize = 6;

/// The skill a chosen fold stands for.
pub(super) fn chosen(fold: &tmt_tui::components::Fold) -> Option<&str> {
    fold.label.strip_prefix(SKILL)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Syntax {
    /// The name follows this character: Claude Code `/`, Codex `$`.
    Prefix(char),
    /// No skill invocation: the menu lists TMT's skills and writes a sentence.
    Unsupported,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Group {
    Tmt,
    Own,
    Project,
}

impl Group {
    fn kind(self) -> &'static str {
        match self {
            Self::Tmt => "tmt",
            Self::Own => "own",
            Self::Project => "project",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Skill {
    pub name: String,
    pub description: String,
    pub group: Group,
}

/// One member's `skills.list` answer. Every name and description is display data.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Report {
    pub syntax: Syntax,
    pub driver: Option<String>,
    pub skills: Vec<Skill>,
    stamp: String,
}

impl Report {
    pub(super) fn parse(value: &Value) -> Option<Self> {
        let syntax = match value["syntax"]["kind"].as_str()? {
            "prefix" => {
                let sigil = value["syntax"]["sigil"].as_str()?;
                let mut chars = sigil.chars();
                let (Some(sigil), None) = (chars.next(), chars.next()) else {
                    return None;
                };
                Syntax::Prefix(sigil)
            }
            "unsupported" => Syntax::Unsupported,
            _ => return None,
        };
        let skills = value["skills"]
            .as_array()?
            .iter()
            .filter_map(|skill| {
                let group = match skill["source"]["group"].as_str()? {
                    "tmt" => Group::Tmt,
                    "user" | "plugin" => Group::Own,
                    "project" => Group::Project,
                    _ => return None,
                };
                Some(Skill {
                    name: skill["name"].as_str()?.to_owned(),
                    description: skill["description"].as_str().unwrap_or_default().to_owned(),
                    group,
                })
            })
            .collect();
        Some(Self {
            syntax,
            driver: value["driver"].as_str().map(str::to_owned),
            skills,
            stamp: value["rootsStamp"].as_str()?.to_owned(),
        })
    }

    /// How a chosen skill is written for this recipient.
    pub(super) fn sent(&self, name: &str) -> String {
        match self.syntax {
            Syntax::Prefix(sigil) => format!("{sigil}{name}"),
            Syntax::Unsupported => format!("Please use {name}:"),
        }
    }

    /// The hint's example of what a chosen skill becomes.
    fn sent_as(&self) -> String {
        match self.syntax {
            Syntax::Prefix(sigil) => format!("sent as {sigil}name"),
            Syntax::Unsupported => "sent as a sentence".to_owned(),
        }
    }

    fn own_title(&self) -> String {
        match self.driver.as_deref() {
            Some("claude") => "Claude Code's own".to_owned(),
            Some("codex") => "Codex's own".to_owned(),
            _ => "The agent's own".to_owned(),
        }
    }

    fn candidates(&self) -> Vec<(Candidate, String)> {
        self.skills
            .iter()
            .map(|skill| {
                (
                    Candidate {
                        id: format!("skill:{}", skill.name),
                        kind: skill.group.kind().to_owned(),
                        label: skill.name.clone(),
                        insertion: format!("{TRIGGER}{}", skill.name),
                    },
                    skill.description.clone(),
                )
            })
            .collect()
    }

    fn skill(&self, id: &str) -> Option<&Skill> {
        let name = id.strip_prefix("skill:")?;
        self.skills.iter().find(|skill| skill.name == name)
    }
}

/// One read for the board's I/O lane.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct Task {
    identity: String,
    stamp: Option<String>,
}

#[derive(Debug)]
enum Outcome {
    Report(Report),
    Unchanged,
    /// An older Core, a refusal or a failed read: no skills, never an error to show.
    Unavailable,
}

#[derive(Debug)]
pub(in crate::board) struct Completed {
    identity: String,
    outcome: Outcome,
}

/// Runs on the I/O lane, never on paint or input.
pub(in crate::board) fn complete(core: &Core, task: Task) -> Completed {
    let mut input = json!({"identityId": task.identity});
    if let Some(stamp) = &task.stamp {
        input["ifStamp"] = json!(stamp);
    }
    let outcome = match core.api("skills.list", input) {
        Ok(value) if value["unchanged"] == json!(true) && task.stamp.is_some() => {
            Outcome::Unchanged
        }
        Ok(value) => Report::parse(&value).map_or(Outcome::Unavailable, Outcome::Report),
        Err(_) => Outcome::Unavailable,
    };
    Completed {
        identity: task.identity,
        outcome,
    }
}

struct Entry {
    /// `None` when the member's agent reports no skills Ops can show.
    report: Option<Report>,
    at: Instant,
}

#[derive(Default)]
pub(super) struct State {
    pub completion: Completion,
    hits: RefCell<Vec<(Rect, usize)>>,
    cache: HashMap<String, Entry>,
    pending: Option<String>,
}

impl State {
    pub(super) fn invalidate(&self) {
        self.hits.borrow_mut().clear();
    }
    /// Closes the menu and keeps the held reports.
    pub(super) fn reset(&mut self) {
        self.completion = Completion::default();
        self.invalidate();
    }
    /// The next read for an open composer's recipient: the first one, or a stamped
    /// refresh once the held report is older than [`REFRESH`]. One read at a time.
    pub(super) fn offer(&mut self, recipient: Option<&str>, now: Instant) -> Option<Task> {
        let recipient = recipient?;
        if self.pending.is_some() {
            return None;
        }
        let stamp = match self.cache.get(recipient) {
            Some(entry) if now.saturating_duration_since(entry.at) < REFRESH => return None,
            Some(entry) => entry.report.as_ref().map(|report| report.stamp.clone()),
            None => None,
        };
        self.pending = Some(recipient.to_owned());
        Some(Task {
            identity: recipient.to_owned(),
            stamp,
        })
    }
    pub(super) fn finished(&mut self, completed: Completed, now: Instant) {
        if self.pending.as_deref() == Some(completed.identity.as_str()) {
            self.pending = None;
        }
        match completed.outcome {
            Outcome::Unchanged => {
                if let Some(entry) = self.cache.get_mut(&completed.identity) {
                    entry.at = now;
                }
            }
            Outcome::Report(report) => {
                self.cache.insert(
                    completed.identity,
                    Entry {
                        report: Some(report),
                        at: now,
                    },
                );
            }
            Outcome::Unavailable => {
                self.cache.insert(
                    completed.identity,
                    Entry {
                        report: None,
                        at: now,
                    },
                );
            }
        }
    }
    /// `None` while the first read is outstanding; `Some(None)` when nothing can be shown.
    pub(super) fn report(&self, recipient: &str) -> Option<Option<&Report>> {
        self.cache.get(recipient).map(|entry| entry.report.as_ref())
    }
    #[cfg(test)]
    pub(super) fn hold(&mut self, recipient: &str, report: Option<Report>) {
        self.cache.insert(
            recipient.to_owned(),
            Entry {
                report,
                at: Instant::now(),
            },
        );
    }
}

/// Whether the token before the caret can still be a skill: the trigger, then name
/// characters only. `/Users`, `a/b` or `$HOME` never open the menu.
fn skill_shaped(editor: &Editor) -> Option<&str> {
    let token = editor.as_str()[..editor.cursor()]
        .rsplit(char::is_whitespace)
        .next()
        .unwrap_or_default();
    token.strip_prefix(TRIGGER).filter(|query| {
        query.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b':')
        })
    })
}

impl App {
    /// The open composer's recipient whose skills the menu may list: a Talk or Ask-lead
    /// draft to an agent. A plain program never gets a menu (#5787).
    pub(super) fn skill_recipient(&self) -> Option<(String, String)> {
        let input = self.input.as_ref()?;
        let to = match &input.compose {
            Compose::Talk { to } | Compose::AskLead { to, .. } => to.clone(),
            _ => return None,
        };
        let (_, recipient) = self.draft_identity(input)?;
        if self
            .references
            .agents
            .get(&recipient)
            .is_some_and(|agent| agent.plain_program().is_some())
        {
            return None;
        }
        Some((recipient, to))
    }

    pub(super) fn update_skills(&mut self) {
        let mut completion = std::mem::take(&mut self.skills.completion);
        match (self.skill_recipient(), self.reference_editor()) {
            (Some((recipient, _)), Some(editor)) => {
                let query = skill_shaped(editor);
                match (query, self.skills.report(&recipient)) {
                    // Still loading: the menu says so while the token stays skill-shaped.
                    (Some(_), None) => completion.update(editor, &[], TRIGGER),
                    (Some(_), Some(Some(report))) if !report.skills.is_empty() => {
                        completion.update_grouped(editor, &report.candidates(), TRIGGER)
                    }
                    // Nothing reported: say so on the bare trigger, then step aside.
                    (Some(""), Some(Some(_))) => completion.update(editor, &[], TRIGGER),
                    // An empty trigger never matches, so this closes and keeps a dismissal.
                    _ => completion.update(editor, &[], ""),
                }
            }
            _ => completion = Completion::default(),
        }
        self.skills.completion = completion;
        self.skills.hits.borrow_mut().clear();
    }

    /// How a chosen skill is sent to this draft's recipient, from the held report. With no
    /// report the typed `/name` goes as written.
    pub(super) fn skill_sent(&self, input: &super::app::Input, name: &str) -> Option<String> {
        let (_, recipient) = self.draft_identity(input)?;
        Some(self.skills.report(&recipient)??.sent(name))
    }

    fn accept_skill(&mut self) -> bool {
        let mut completion = std::mem::take(&mut self.skills.completion);
        let accepted = completion.chosen().is_some_and(|(range, candidate)| {
            self.reference_editor_mut()
                .is_some_and(|editor| insert_skill(editor, range, &candidate))
        });
        if accepted {
            completion.close();
        }
        self.skills.completion = completion;
        accepted
    }

    pub(super) fn skill_key(&mut self, key: KeyEvent) -> Option<Effect> {
        if !self.skills.completion.open() {
            return None;
        }
        let choosing = !self.skills.completion.matches.is_empty();
        match key.code {
            KeyCode::Up if choosing => self.skills.completion.move_by(-1),
            KeyCode::Down if choosing => self.skills.completion.move_by(1),
            KeyCode::PageUp if choosing => self.skills.completion.move_by(-6),
            KeyCode::PageDown if choosing => self.skills.completion.move_by(6),
            KeyCode::Enter | KeyCode::Tab if choosing => {
                self.accept_skill();
            }
            KeyCode::Esc => {
                let mut completion = std::mem::take(&mut self.skills.completion);
                if let Some(editor) = self.reference_editor() {
                    completion.dismiss(editor);
                }
                self.skills.completion = completion;
            }
            _ => return None,
        }
        Some(Effect::None)
    }

    pub(super) fn skill_mouse(&mut self, event: MouseEvent) -> bool {
        if !self.skills.completion.open() {
            return false;
        }
        let hit = self
            .skills
            .hits
            .borrow()
            .iter()
            .find(|(rect, _)| rect.contains((event.column, event.row).into()))
            .map(|(_, index)| *index);
        let Some(index) = hit else {
            return false;
        };
        match event.kind {
            MouseEventKind::Down(MouseButton::Left) => {
                self.skills.completion.selected = index;
                self.accept_skill();
            }
            MouseEventKind::ScrollUp => self.skills.completion.move_by(-1),
            MouseEventKind::ScrollDown => self.skills.completion.move_by(1),
            _ => {}
        }
        true
    }
}

/// Replace the typed token with a skill fold over `/name`, then a space, all or nothing.
fn insert_skill(editor: &mut Editor, range: std::ops::Range<usize>, candidate: &Candidate) -> bool {
    let Some(name) = candidate.id.strip_prefix("skill:") else {
        return false;
    };
    let mut next = editor.clone();
    let start = range.start;
    if !next.replace_range(range, "", MESSAGE_LIMIT)
        || !next.insert_folded(
            &candidate.insertion,
            format!("{SKILL}{name}"),
            MESSAGE_LIMIT,
        )
    {
        return false;
    }
    let Some(id) = next
        .folds()
        .iter()
        .find(|fold| fold.source.start == start && chosen(fold).is_some())
        .map(|fold| fold.id)
    else {
        return false;
    };
    if !next.set_expanded(id, true) || !next.insert(" ", MESSAGE_LIMIT) {
        return false;
    }
    *editor = next;
    true
}

/// One menu row: a group title or a match by its index in the completion.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Row {
    Title(Group),
    Skill(usize),
}

pub(super) fn render(frame: &mut Frame, app: &App) {
    app.skills.hits.borrow_mut().clear();
    let completion = &app.skills.completion;
    if !completion.open() {
        return;
    }
    let Some((editor, _)) = app.input_viewport.get() else {
        return;
    };
    let Some((recipient, to)) = app.skill_recipient() else {
        return;
    };
    let report = app.skills.report(&recipient).flatten();
    let mut rows = Vec::new();
    let mut last = None;
    for (index, candidate) in completion.matches.iter().enumerate() {
        let group = report
            .and_then(|report| report.skill(&candidate.id))
            .map(|skill| skill.group);
        if let Some(group) = group.filter(|group| last != Some(*group)) {
            rows.push(Row::Title(group));
            last = Some(group);
        }
        rows.push(Row::Skill(index));
    }
    let screen = frame.area();
    let count = rows.len().clamp(1, ROWS);
    let height = (count as u16 + 1).min(screen.height);
    let anchor = app.input_band.get().unwrap_or(editor).intersection(screen);
    let y = if screen.bottom().saturating_sub(anchor.bottom()) >= height {
        anchor.bottom()
    } else if anchor.y.saturating_sub(screen.y) >= height {
        anchor.y - height
    } else {
        editor.bottom().min(screen.bottom().saturating_sub(height))
    };
    let width = anchor.width.min(76);
    let x = anchor.x.min(screen.right().saturating_sub(width));
    let look = app.look();
    let selected_row = rows
        .iter()
        .position(|row| *row == Row::Skill(completion.selected))
        .unwrap_or(0);
    let shown = usize::from(height.saturating_sub(1));
    let start = selected_row.saturating_sub(shown.saturating_sub(1));
    let name_cells = completion
        .matches
        .iter()
        .map(|candidate| unicode_width::UnicodeWidthStr::width(candidate.label.as_str()))
        .max()
        .unwrap_or(0)
        .min(24);
    for row in 0..height {
        let rect = Rect::new(x, y + row, width, 1);
        let selected = rows.get(start + usize::from(row)) == Some(&Row::Skill(completion.selected))
            && row != height - 1;
        let line = if row == height - 1 {
            let sent = report.map_or_else(|| "sent as /name".to_owned(), Report::sent_as);
            // A narrow menu drops the key hints before it cuts the recipient.
            let info = [
                format!("Skills · {TRIGGER} · ↑↓ choose · Tab insert · {sent} to {to}"),
                format!("Skills · {TRIGGER} · Tab insert · {sent} to {to}"),
                format!("{TRIGGER}  Tab insert  {sent} to {to}"),
                format!("{sent} to {to}"),
            ]
            .into_iter()
            .find(|info| unicode_width::UnicodeWidthStr::width(info.as_str()) <= usize::from(width))
            .unwrap_or_else(|| format!("{sent} to {to}"));
            Line::styled(info, look.role(Role::Muted))
        } else {
            match rows.get(start + usize::from(row)) {
                Some(Row::Title(group)) => Line::styled(
                    format!(
                        "  {}",
                        match group {
                            Group::Tmt => "TMT".to_owned(),
                            Group::Own => report.map_or_else(String::new, Report::own_title),
                            Group::Project => "This project".to_owned(),
                        }
                    ),
                    look.role(Role::Dim),
                ),
                Some(Row::Skill(index)) => {
                    let candidate = &completion.matches[*index];
                    let style = if selected {
                        look.role(Role::Text).patch(look.role(Role::Track))
                    } else {
                        look.role(Role::Text)
                    };
                    app.skills.hits.borrow_mut().push((rect, *index));
                    let mut spans = vec![Span::styled(
                        format!("{}   {TRIGGER}", if selected { "›" } else { " " }),
                        style,
                    )];
                    let mut at = 0;
                    for matched in completion.matched_ranges(*index) {
                        spans.push(Span::styled(&candidate.label[at..matched.start], style));
                        spans.push(Span::styled(
                            &candidate.label[matched.clone()],
                            style.add_modifier(ratatui::style::Modifier::BOLD),
                        ));
                        at = matched.end;
                    }
                    spans.push(Span::styled(&candidate.label[at..], style));
                    let label = unicode_width::UnicodeWidthStr::width(candidate.label.as_str());
                    let used = 5 + label.max(name_cells) + 2;
                    spans.push(Span::styled(
                        " ".repeat(name_cells.saturating_sub(label) + 2),
                        style,
                    ));
                    // The description ends with `…` inside the row; it never wraps.
                    let description = report
                        .and_then(|report| report.skill(&candidate.id))
                        .map_or("", |skill| skill.description.as_str());
                    let room = usize::from(width).saturating_sub(used);
                    if room > 0 && !description.is_empty() {
                        spans.push(Span::styled(
                            fit(description, room, Align::Left, Truncate::End)
                                .trim_end()
                                .to_owned(),
                            style.patch(look.role(Role::Muted)),
                        ));
                    }
                    Line::from(spans)
                }
                None => Line::styled(
                    match app.skills.report(&recipient) {
                        None => "Loading skills".to_owned(),
                        Some(Some(report)) if report.skills.is_empty() => {
                            format!("No skills reported by {to}")
                        }
                        _ => "No matching skill".to_owned(),
                    },
                    look.role(Role::Muted),
                ),
            }
        };
        // Explicit opaque cell fill keeps pane text from leaking into short rows; strip
        // owns escaping and cell clipping.
        for col in rect.x..rect.right() {
            let cell = &mut frame.buffer_mut()[(col, rect.y)];
            cell.reset();
            if selected {
                cell.set_style(look.role(Role::Text).patch(look.role(Role::Track)));
            }
        }
        strip::paint_left(frame.buffer_mut(), rect, line);
    }
}

#[cfg(test)]
pub(in crate::board) mod tests;
