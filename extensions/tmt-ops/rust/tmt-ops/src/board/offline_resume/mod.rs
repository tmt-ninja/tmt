//! After a reboot, the built-in host's members are offline and there is no pane to type
//! `tmt resume` in. Once per board run the board reads the built-in capture
//! (`tmt workspace show --host pty`, as Recovery does) and, when it names offline members, asks
//! once whether to resume them. Each choice is one `terminal.relaunch` on the lane, one at a
//! time, so the board keeps drawing while Core answers; every row keeps its own result.
#[cfg(test)]
pub(in crate::board) mod scenes;
mod surface;
#[cfg(test)]
mod tests;

use super::app::{App, Effect};
use crate::core::{Core, SquadError};
use ratatui::crossterm::event::{Event, KeyCode, KeyEvent, MouseButton, MouseEventKind};
use std::cell::RefCell;
use tmt_tui::components::{DialogHits, DialogInput, DialogKind, DialogState};

/// What a row starts: the remembered conversation, or a new one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::board) enum Kind {
    Resume,
    New,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) enum Task {
    /// Read which members the built-in capture names, and what each would do now.
    Preview,
    Relaunch {
        identity: String,
        kind: Kind,
    },
}

pub(in crate::board) struct Completed {
    task: Task,
    result: Result<Vec<Captured>, SquadError>,
}

/// One member the capture names, with Core's word for what a restore would do now.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct Captured {
    pub identity: String,
    pub name: String,
    pub action: String,
}

/// The capture's actions the dialog lists: the member is offline and the capture knows it.
/// `live` and `ended` (a kept terminal) are not offline; `identity_missing` has no one to resume.
const OFFLINE: [&str; 4] = [
    "resumable",
    "stale_requires_retry",
    "no_remembered_session",
    "folder_missing",
];

pub(in crate::board) fn complete(core: &Core, task: Task) -> Completed {
    let result = match &task {
        Task::Preview => super::recovery::load::builtin_members(core),
        Task::Relaunch { identity, kind } => core
            .api_within(
                "terminal.relaunch",
                serde_json::json!({
                    "identityId": identity,
                    "kind": match kind { Kind::Resume => "resume", Kind::New => "new" },
                }),
                super::terminal_tab::discovery::RELAUNCH_WITHIN,
            )
            .and_then(|answer| {
                if answer["identityId"] == *identity.as_str() {
                    Ok(Vec::new())
                } else {
                    Err(SquadError::new(
                        "SQUAD_CORE_INVALID",
                        "Core's relaunch answer named another member.",
                    ))
                }
            }),
    };
    Completed { task, result }
}

/// Where one row is now.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) enum Now {
    Idle,
    /// Chosen; it waits for the row ahead of it.
    Queued(Kind),
    Running(Kind),
    Done(Kind),
    /// Core refused or the launch failed; its words, on one line.
    Failed(String),
}

#[derive(Clone, Debug)]
pub(in crate::board) struct Row {
    pub member: Captured,
    pub now: Now,
}

impl Row {
    /// Resume needs a remembered conversation; New needs a folder. A missing folder allows neither.
    pub fn offers(&self, kind: Kind) -> bool {
        match kind {
            Kind::Resume => matches!(
                self.member.action.as_str(),
                "resumable" | "stale_requires_retry"
            ),
            Kind::New => self.member.action != "folder_missing",
        }
    }
    fn choosable(&self) -> bool {
        matches!(self.now, Now::Idle | Now::Failed(_))
    }
}

pub(in crate::board) struct Dialog {
    pub rows: Vec<Row>,
    pub selected: usize,
    /// Esc hides it; a running relaunch goes on and its row keeps the result.
    pub shown: bool,
    pub state: DialogState,
    pub hits: RefCell<DialogHits>,
    /// Painted rows, by index into `rows`.
    pub row_hits: RefCell<Vec<(ratatui::layout::Rect, usize)>>,
}

impl Dialog {
    fn new(rows: Vec<Row>) -> Self {
        Self {
            rows,
            selected: 0,
            shown: true,
            state: DialogState::new(&[], &surface::buttons()),
            hits: RefCell::default(),
            row_hits: RefCell::default(),
        }
    }
    pub fn invalidate(&self) {
        *self.hits.borrow_mut() = DialogHits::default();
        self.row_hits.borrow_mut().clear();
    }
    fn choose(&mut self, index: usize, kind: Kind) -> bool {
        let Some(row) = self.rows.get_mut(index) else {
            return false;
        };
        if !row.choosable() || !row.offers(kind) {
            return false;
        }
        row.now = Now::Queued(kind);
        true
    }
    /// Every row Resume is offered on and not yet started; the others keep what they show.
    fn resume_all(&mut self) {
        for index in 0..self.rows.len() {
            self.choose(index, Kind::Resume);
        }
    }
}

#[derive(Default)]
pub(in crate::board) struct State {
    /// The capture is read once per board run, whatever it answers.
    asked: bool,
    reading: bool,
    pub dialog: Option<Dialog>,
}

impl State {
    pub fn shown(&self) -> bool {
        self.dialog.as_ref().is_some_and(|dialog| dialog.shown)
    }
    fn running(&self) -> bool {
        self.reading
            || self.dialog.as_ref().is_some_and(|dialog| {
                dialog
                    .rows
                    .iter()
                    .any(|row| matches!(row.now, Now::Running(_)))
            })
    }
    /// Opens the dialog on what the capture named offline, if anything.
    fn captured(&mut self, members: Vec<Captured>) {
        let rows: Vec<Row> = members
            .into_iter()
            .filter(|member| OFFLINE.contains(&member.action.as_str()))
            .map(|member| Row {
                member,
                now: Now::Idle,
            })
            .collect();
        if !rows.is_empty() {
            self.dialog = Some(Dialog::new(rows));
        }
    }
    fn relaunched(&mut self, identity: &str, kind: Kind, result: Result<(), SquadError>) {
        let Some(dialog) = &mut self.dialog else {
            return;
        };
        let Some(index) = dialog
            .rows
            .iter()
            .position(|row| row.member.identity == identity)
        else {
            return;
        };
        match result {
            Ok(()) => dialog.rows[index].now = Now::Done(kind),
            // Core cannot relaunch it here (a binding on another host): the row goes.
            Err(error) if error.code == "TERMINAL_RELAUNCH_UNSUPPORTED" => {
                dialog.rows.remove(index);
                if dialog.selected >= dialog.rows.len() {
                    dialog.selected = dialog.rows.len().saturating_sub(1);
                }
                dialog.invalidate();
            }
            Err(error) => {
                dialog.rows[index].now = Now::Failed(super::notes::single_line(&error.message));
            }
        }
        if dialog.rows.is_empty() {
            self.dialog = None;
        }
    }
}

impl App {
    /// The lane's next offline-resume call: the capture read once the first view is up, then the
    /// next chosen row, one at a time.
    pub(in crate::board) fn offline_resume_offer(&mut self) -> Option<Task> {
        let ready = !self.popup && self.view.is_some() && !self.loading();
        let offline = &mut self.offline_resume;
        if offline.running() {
            return None;
        }
        if !offline.asked {
            if !ready {
                return None;
            }
            offline.asked = true;
            offline.reading = true;
            return Some(Task::Preview);
        }
        let dialog = offline.dialog.as_mut()?;
        let row = dialog
            .rows
            .iter_mut()
            .find(|row| matches!(row.now, Now::Queued(_)))?;
        let Now::Queued(kind) = row.now else {
            unreachable!("found a queued row");
        };
        row.now = Now::Running(kind);
        Some(Task::Relaunch {
            identity: row.member.identity.clone(),
            kind,
        })
    }

    /// A failed capture read shows nothing: the board works as before.
    pub(in crate::board) fn offline_resume_done(&mut self, completed: Completed) {
        let offline = &mut self.offline_resume;
        match completed.task {
            Task::Preview => {
                offline.reading = false;
                if let Ok(members) = completed.result {
                    offline.captured(members);
                }
            }
            Task::Relaunch { identity, kind } => {
                offline.relaunched(&identity, kind, completed.result.map(|_| ()));
            }
        }
        self.invalidate_frame_geometry();
    }

    /// Enter on an offline row the capture named opens the dialog on that member. `None` keeps
    /// what Enter does today.
    pub(in crate::board) fn offline_resume_row(&mut self, identity: &str) -> Option<Effect> {
        let dialog = self.offline_resume.dialog.as_mut()?;
        let index = dialog
            .rows
            .iter()
            .position(|row| row.member.identity == identity)?;
        if matches!(dialog.rows[index].now, Now::Done(_)) {
            return None;
        }
        dialog.selected = index;
        dialog.shown = true;
        dialog.invalidate();
        Some(Effect::None)
    }

    pub(in crate::board) fn offline_resume_event(&mut self, event: &Event) -> Option<Effect> {
        let dialog = self.offline_resume.dialog.as_mut()?;
        let buttons = surface::buttons();
        let input = match event {
            Event::Key(key) => dialog.state.key(DialogKind::List, key, &[], &buttons),
            Event::Mouse(mouse) => {
                if mouse.kind == MouseEventKind::Down(MouseButton::Left)
                    && let Some(&(_, index)) = dialog
                        .row_hits
                        .borrow()
                        .iter()
                        .find(|(rect, _)| rect.contains((mouse.column, mouse.row).into()))
                {
                    dialog.selected = index;
                    return Some(Effect::None);
                }
                let hits = dialog.hits.borrow().clone();
                dialog.state.mouse(mouse, &hits, &buttons)
            }
            Event::Resize(..) => {
                dialog.invalidate();
                DialogInput::Ignored
            }
            _ => DialogInput::Ignored,
        };
        Some(match input {
            DialogInput::Cancel | DialogInput::Choose(1) => {
                dialog.shown = false;
                self.invalidate_frame_geometry();
                Effect::None
            }
            DialogInput::Choose(_) => {
                dialog.resume_all();
                Effect::None
            }
            DialogInput::Content(key) => self.offline_resume_key(key),
            _ => Effect::None,
        })
    }

    fn offline_resume_key(&mut self, key: KeyEvent) -> Effect {
        let Some(dialog) = self.offline_resume.dialog.as_mut() else {
            return Effect::None;
        };
        let last = dialog.rows.len().saturating_sub(1);
        match key.code {
            KeyCode::Up => dialog.selected = dialog.selected.saturating_sub(1),
            KeyCode::Down => dialog.selected = (dialog.selected + 1).min(last),
            KeyCode::Home => dialog.selected = 0,
            KeyCode::End => dialog.selected = last,
            KeyCode::Enter => {
                let index = dialog.selected;
                // A member that came back opens full screen, as `j` on its row does.
                if let Some(row) = dialog.rows.get(index)
                    && matches!(row.now, Now::Done(_))
                {
                    let identity = row.member.identity.clone();
                    dialog.shown = false;
                    return self.open_member_frame(&identity);
                }
                dialog.choose(index, Kind::Resume);
            }
            KeyCode::Char('n') => {
                let index = dialog.selected;
                dialog.choose(index, Kind::New);
            }
            KeyCode::Char('a') => dialog.resume_all(),
            _ => {}
        }
        Effect::None
    }
}
