//! Saved terminal projection and revision-guarded row actions.

use super::{App, Controller, Effect, Form, Page, Target, Task};
use crate::{
    board::{
        self,
        workspace::{OpsObservation, OpsTarget, OpsTreeRow},
    },
    core::{Core, SquadError},
};
use ratatui::{Frame, crossterm::event::KeyCode, layout::Rect, text::Line};
use serde_json::{Value, json};
use tmt_tui::components::{Editor, strip};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedRow {
    terminal_id: String,
    revision: u64,
    pub(super) command: String,
    cwd: String,
    exit_code: Option<i64>,
    signal: Option<i64>,
    timed_out: bool,
    truncated: bool,
    placement: SavedPlacement,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SavedPlacement {
    Local,
    Room {
        room_id: String,
    },
    Member {
        identity_id: String,
        room_id: Option<String>,
    },
}

impl SavedPlacement {
    fn parse(value: &Value) -> Option<Self> {
        match value["kind"].as_str()? {
            "local" => Some(Self::Local),
            "room" => Some(Self::Room {
                room_id: value["roomId"].as_str()?.into(),
            }),
            "member" => Some(Self::Member {
                room_id: value["roomId"].as_str().map(str::to_owned),
                identity_id: value["identityId"].as_str()?.into(),
            }),
            _ => None,
        }
    }

    fn document(&self) -> Value {
        match self {
            Self::Local => json!({"kind":"local"}),
            Self::Room { room_id } => json!({"kind":"room","roomId":room_id}),
            Self::Member {
                identity_id,
                room_id,
            } => json!({"kind":"member","identityId":identity_id,"roomId":room_id}),
        }
    }

    fn target(&self) -> OpsTarget {
        match self {
            Self::Local => OpsTarget::LocalTerminals,
            Self::Room { room_id } => OpsTarget::Squad(room_id.clone()),
            Self::Member {
                identity_id,
                room_id,
            } => OpsTarget::Member {
                identity_id: identity_id.clone(),
                room_id: room_id.clone(),
            },
        }
    }

    fn of(target: &OpsTarget) -> Option<Self> {
        match target {
            OpsTarget::LocalTerminals => Some(Self::Local),
            OpsTarget::Squad(room_id) => Some(Self::Room {
                room_id: room_id.clone(),
            }),
            OpsTarget::Member {
                identity_id,
                room_id,
            } => Some(Self::Member {
                identity_id: identity_id.clone(),
                room_id: room_id.clone(),
            }),
            _ => None,
        }
    }
}

impl SavedRow {
    pub(super) fn parse(value: &Value) -> Option<Self> {
        Some(Self {
            terminal_id: value["terminalId"].as_str()?.into(),
            revision: value["revision"].as_u64()?,
            command: value["command"].as_str()?.into(),
            cwd: value["cwd"].as_str()?.into(),
            exit_code: value["exitCode"].as_i64(),
            signal: value["signal"].as_i64(),
            timed_out: value["timedOut"].as_bool()?,
            truncated: value["truncated"].as_bool()?,
            placement: SavedPlacement::parse(&value["placement"])?,
        })
    }

    fn target(&self) -> OpsTarget {
        OpsTarget::SavedTerminal(self.terminal_id.clone())
    }

    fn expected(&self) -> Value {
        json!({"terminalId":self.terminal_id,"expectedRevision":self.revision})
    }

    fn tree_row(&self, depth: usize) -> OpsTreeRow {
        let mut row = tree_row(
            self.target(),
            board::notes::single_line(&self.command),
            depth,
        );
        row.state = Some(if self.timed_out {
            "✗ timed out".into()
        } else if let Some(code) = self.exit_code {
            format!("{} exit {code}", if code == 0 { "✓" } else { "✗" })
        } else if let Some(signal) = self.signal {
            format!("✗ signal {signal}")
        } else if self.truncated {
            "output truncated".into()
        } else {
            "finished".into()
        });
        row
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SavedTask {
    List {
        check_capability: bool,
        generation: u64,
    },
    Get(String),
    Move(SavedRow, SavedPlacement),
    Shell(SavedRow),
    Remove(SavedRow, bool),
}

impl SavedTask {
    pub(in crate::board) fn complete(&self, core: &Core) -> Result<Value, SquadError> {
        if matches!(
            self,
            Self::List {
                check_capability: true,
                ..
            }
        ) {
            let capabilities = core.api("capabilities", json!({}))?;
            let supported = capabilities["operations"]
                .as_array()
                .is_some_and(|operations| {
                    operations
                        .iter()
                        .any(|name| name.as_str() == Some("terminal.saved.list"))
                });
            if !supported {
                return Err(SquadError::new(
                    "SAVED_TERMINALS_UNSUPPORTED",
                    "Core does not support saved terminals.",
                ));
            }
        }
        let (operation, input) = self.request();
        core.api(operation, input)
    }

    fn request(&self) -> (&'static str, Value) {
        match self {
            Self::List { .. } => ("terminal.saved.list", json!({})),
            Self::Get(id) => ("terminal.saved.get", json!({"terminalId":id})),
            Self::Move(row, placement) => {
                let mut input = row.expected();
                input["placement"] = placement.document();
                ("terminal.saved.move", input)
            }
            Self::Shell(row) => ("terminal.saved.openShell", row.expected()),
            Self::Remove(row, force) => {
                let mut input = row.expected();
                input["force"] = json!(force);
                ("terminal.saved.remove", input)
            }
        }
    }
}

pub(super) struct Moving {
    row: SavedRow,
    parent: SavedPlacement,
}

fn tree_row(target: OpsTarget, title: String, depth: usize) -> OpsTreeRow {
    OpsTreeRow {
        target,
        title,
        depth,
        lead: false,
        state: None,
        presence: None,
        usage: None,
        activity: None,
        count: None,
        observation: OpsObservation::Complete,
    }
}

impl Controller {
    pub(in crate::board) fn offer_list(&mut self) -> Option<Task> {
        if !self.enabled || self.list_unsupported || self.list_pending || !self.refresh_due {
            return None;
        }
        self.refresh_due = false;
        self.list_pending = true;
        Some(Task::Saved(SavedTask::List {
            check_capability: !self.list_supported,
            generation: self.saved_generation,
        }))
    }

    pub(super) fn saved_changed(&mut self) {
        self.saved_generation += 1;
        self.refresh_due = true;
    }

    pub(super) fn update_row(&mut self, row: SavedRow) {
        self.saved_rows
            .retain(|saved| saved.terminal_id != row.terminal_id);
        self.saved_rows.insert(0, row);
    }

    pub(in crate::board) fn lifted_name(&self) -> Option<&str> {
        self.moving
            .as_ref()
            .map(|moving| moving.row.command.as_str())
    }

    pub(in crate::board) fn has_children(&self, target: &OpsTarget) -> bool {
        self.saved_rows
            .iter()
            .any(|row| row.placement.target() == *target)
    }

    pub(in crate::board) fn moving(&self) -> bool {
        self.moving.is_some()
    }

    pub(in crate::board) fn moving_placement(
        &self,
        rows: &[OpsTreeRow],
    ) -> Option<board::workspace::moving::Placement> {
        let moving = self.moving.as_ref()?;
        let source = rows
            .iter()
            .position(|row| row.target == moving.row.target())?;
        let parent = moving.parent.target();
        let index = rows.iter().position(|row| row.target == parent)?;
        let depth = rows[index].depth + 1;
        let after = if moving.parent == moving.row.placement {
            None
        } else {
            Some(
                index
                    + rows[index + 1..]
                        .iter()
                        .take_while(|row| row.depth >= depth)
                        .count(),
            )
        };
        Some(board::workspace::moving::Placement {
            source,
            after,
            depth,
        })
    }

    pub(in crate::board) fn moving_title(&self, rows: &[OpsTreeRow]) -> Option<String> {
        let moving = self.moving.as_ref()?;
        let target = moving.parent.target();
        let parent = rows.iter().find(|row| row.target == target)?;
        Some(format!(
            "{} → {}",
            board::notes::single_line(&moving.row.command),
            parent.title
        ))
    }

    pub(in crate::board) fn framed_shell(
        &self,
        key: Option<&str>,
    ) -> Option<(&str, &board::terminal_tab::discovery::Address)> {
        let (id, title, address) = self.shell.as_ref()?;
        (Some(id.as_str()) == key).then_some((title, address))
    }
}

impl App {
    pub(in crate::board) fn show_saved_summary(&self, frame: &mut Frame, area: Rect) -> bool {
        let Some(row) = self
            .selected_saved()
            .filter(|_| self.workspace_selection_visible())
        else {
            return false;
        };
        let look = self.look();
        let heading = Rect { height: 1, ..area };
        board::section_rule::paint(
            frame.buffer_mut(),
            heading,
            "Saved terminal",
            Line::default(),
            false,
            look,
        );
        let lines = [
            board::notes::single_line(&row.command),
            board::notes::single_line(&row.cwd),
            "Enter opens output · s opens a shell here".into(),
        ];
        for (offset, line) in lines
            .into_iter()
            .take(usize::from(area.height.saturating_sub(1)))
            .enumerate()
        {
            let rect = Rect::new(area.x, area.y + offset as u16 + 1, area.width, 1);
            strip::paint_left(
                frame.buffer_mut(),
                rect,
                Line::styled(
                    board::view::fit(&line, rect.width.into()),
                    look.role(tmt_cli_style::Role::Muted),
                ),
            );
        }
        true
    }

    pub(in crate::board) fn with_saved_rows(&self, rows: Vec<OpsTreeRow>) -> Vec<OpsTreeRow> {
        if self.standalone.saved_rows.is_empty() || self.shell.tab != board::shell::OpsTab::Agents {
            return rows;
        }
        let searching = !self.workspace.query.is_empty();
        let matches = |row: &SavedRow| {
            !searching || board::search_field::matches_query(&row.command, &self.workspace.query)
        };
        let local = self
            .standalone
            .saved_rows
            .iter()
            .filter(|row| row.placement == SavedPlacement::Local && matches(row));
        let mut result = Vec::with_capacity(rows.len() + self.standalone.saved_rows.len() + 1);
        if local.clone().next().is_some() || self.standalone.moving() {
            result.push(tree_row(OpsTarget::LocalTerminals, "Local".into(), 0));
            if !self.standalone.local_folded || searching {
                result.extend(local.map(|row| row.tree_row(1)));
            }
        }
        // Insert leaves after each visible parent's existing children. Filtering or folding
        // a parent never promotes a saved result into another scope.
        let mut parents: Vec<(OpsTarget, usize)> = Vec::new();
        let append = |rows: &mut Vec<OpsTreeRow>, (parent, depth): (OpsTarget, usize)| {
            rows.extend(
                self.standalone
                    .saved_rows
                    .iter()
                    .filter(|row| matches(row) && row.placement.target() == parent)
                    .map(|row| row.tree_row(depth + 1)),
            );
        };
        for row in rows {
            while parents.last().is_some_and(|(_, depth)| *depth >= row.depth) {
                append(&mut result, parents.pop().expect("checked parent"));
            }
            let accepts = match &row.target {
                OpsTarget::Squad(id) => searching || self.workspace.expanded.contains(id),
                OpsTarget::Member { .. } => searching || !self.workspace.member_folded(&row.target),
                _ => false,
            };
            if accepts {
                parents.push((row.target.clone(), row.depth));
            }
            result.push(row);
        }
        while let Some(parent) = parents.pop() {
            append(&mut result, parent);
        }
        result
    }

    pub(in crate::board) fn selected_saved(&self) -> Option<&SavedRow> {
        let OpsTarget::SavedTerminal(id) = self.workspace.selected.as_ref()? else {
            return None;
        };
        self.standalone
            .saved_rows
            .iter()
            .find(|row| &row.terminal_id == id)
    }

    pub(in crate::board) fn saved_row_key(
        &mut self,
        key: ratatui::crossterm::event::KeyEvent,
    ) -> Option<Effect> {
        if self.shell.tab != board::shell::OpsTab::Agents
            || self.focused() != crate::config::Pane::Rows
            || !key.modifiers.is_empty()
            || !self.workspace_selection_visible()
        {
            return None;
        }
        let selected = self.workspace.selected.as_ref()?;
        if *selected == OpsTarget::LocalTerminals {
            return match key.code {
                KeyCode::Enter | KeyCode::Left | KeyCode::Right => {
                    self.standalone.local_folded = match key.code {
                        KeyCode::Left => true,
                        KeyCode::Right => false,
                        _ => !self.standalone.local_folded,
                    };
                    self.invalidate_frame_geometry();
                    Some(Effect::None)
                }
                _ => None,
            };
        }
        let OpsTarget::SavedTerminal(id) = selected else {
            return None;
        };
        let row = self
            .standalone
            .saved_rows
            .iter()
            .find(|row| row.terminal_id == *id)?
            .clone();
        if self.standalone.pending
            || matches!(
                self.standalone.page,
                Some(Page::Running { .. } | Page::Finished { .. })
            )
        {
            return matches!(
                key.code,
                KeyCode::Enter | KeyCode::Char('r' | 's' | 'm' | 'x')
            )
            .then(|| self.say("Open or close the current command result first."));
        }
        let task = match key.code {
            KeyCode::Enter => SavedTask::Get(row.terminal_id),
            KeyCode::Char('r') => {
                let mut target = row.expected();
                target["kind"] = "saved".into();
                self.standalone.show(Page::Form(Form {
                    command: Editor::from(row.command),
                    saved: Some(json!({"target": target})),
                    targets: vec![Target {
                        label: "Saved terminal".into(),
                        input: json!({"cwd":row.cwd}),
                    }],
                    member: None,
                    observing: false,
                    selected: 0,
                    history: None,
                }));
                return Some(Effect::None);
            }
            KeyCode::Char('s') => SavedTask::Shell(row),
            KeyCode::Char('x') => SavedTask::Remove(row, false),
            KeyCode::Char('m') => {
                self.standalone.moving = Some(Moving {
                    parent: row.placement.clone(),
                    row,
                });
                self.invalidate_frame_geometry();
                return Some(Effect::None);
            }
            _ => return None,
        };
        self.standalone.pending = true;
        Some(Effect::Standalone(Task::Saved(task)))
    }

    pub(in crate::board) fn standalone_moving_key(
        &mut self,
        key: ratatui::crossterm::event::KeyEvent,
    ) -> Option<Effect> {
        let moving = self.standalone.moving.as_ref()?;
        if key.code == KeyCode::Esc {
            self.standalone.moving = None;
            self.invalidate_frame_geometry();
            return Some(Effect::None);
        }
        let rows = self.workspace_rows();
        let visible_parent = moving.parent.target();
        let Some(parent_index) = rows.iter().position(|row| row.target == visible_parent) else {
            return Some(self.say("The destination is no longer visible. Esc cancels the move."));
        };
        let depth = rows[parent_index].depth;
        let next = match key.code {
            KeyCode::Enter => {
                let moving = self.standalone.moving.take().expect("checked drag");
                self.invalidate_frame_geometry();
                if moving.parent == moving.row.placement {
                    return Some(Effect::None);
                }
                self.standalone.pending = true;
                return Some(Effect::Standalone(Task::Saved(SavedTask::Move(
                    moving.row,
                    moving.parent,
                ))));
            }
            KeyCode::Up => rows[..parent_index]
                .iter()
                .rev()
                .filter(|row| row.depth <= depth)
                .find_map(|row| SavedPlacement::of(&row.target)),
            KeyCode::Down => rows[parent_index + 1..]
                .iter()
                .filter(|row| row.depth <= depth)
                .find_map(|row| SavedPlacement::of(&row.target)),
            KeyCode::Left => rows[..parent_index]
                .iter()
                .rev()
                .find(|row| row.depth < depth)
                .and_then(|row| SavedPlacement::of(&row.target))
                .or(Some(SavedPlacement::Local)),
            KeyCode::Right => rows[parent_index + 1..]
                .iter()
                .take_while(|row| row.depth > depth)
                .find_map(|row| SavedPlacement::of(&row.target)),
            _ => None,
        };
        if let Some(parent) = next {
            if let Some(moving) = self.standalone.moving.as_mut() {
                moving.parent = parent;
            }
            self.invalidate_frame_geometry();
        }
        Some(Effect::None)
    }

    pub(super) fn saved_completed(&mut self, task: SavedTask, result: Result<Value, SquadError>) {
        if let SavedTask::List { generation, .. } = task {
            self.standalone.list_pending = false;
            if generation != self.standalone.saved_generation {
                return;
            }
            match result {
                Ok(value) => match value["terminals"]
                    .as_array()
                    .and_then(|rows| rows.iter().map(SavedRow::parse).collect())
                {
                    Some(rows) => {
                        self.standalone.list_supported = true;
                        self.standalone.saved_rows = rows;
                    }
                    None => {
                        self.say("Saved terminal list is stale.");
                    }
                },
                Err(error) if error.code == "SAVED_TERMINALS_UNSUPPORTED" => {
                    self.standalone.list_unsupported = true
                }
                Err(_) => {
                    self.say("Saved terminal list is stale.");
                }
            }
        } else {
            self.standalone.pending = false;
            match (task, result) {
                (SavedTask::Get(id), Ok(result)) if self.workspace.selected.as_ref().is_some_and(|target| matches!(target, OpsTarget::SavedTerminal(selected) if *selected == id)) => {
                    self.standalone.show(Page::Saved(result));
                }
                (SavedTask::Shell(row), Ok(value)) if self.workspace.selected == Some(row.target()) => {
                    if let Some((id, socket)) = value["shellId"].as_str().zip(value["socket"].as_str()) {
                        self.standalone.shell = Some((id.into(), board::notes::single_line(&row.command), board::terminal_tab::discovery::Address {
                            socket: socket.into(),
                            pane: id.into(),
                        }));
                        self.open_member_frame(id);
                    }
                    self.standalone.refresh_due = true;
                }
                (SavedTask::Remove(row, _), Ok(_)) => {
                    self.standalone.saved_rows.retain(|saved| saved.terminal_id != row.terminal_id);
                    if self.workspace.selected == Some(row.target()) {
                        self.workspace.selected = None;
                    }
                    if matches!(self.standalone.page, Some(Page::Remove { .. })) {
                        self.standalone.close();
                    }
                    self.standalone.saved_changed();
                    self.say("Saved terminal removed.");
                }
                (SavedTask::Remove(row, false), Err(error)) if error.code == "TERMINAL_SAVED_SHELL_BUSY" => {
                    self.standalone.show(Page::Remove { row });
                }
                (SavedTask::Move(_, _), Ok(value)) => {
                    if let Some(row) = SavedRow::parse(&value) {
                        match &row.placement {
                            SavedPlacement::Local => self.standalone.local_folded = false,
                            SavedPlacement::Room { room_id } => { self.workspace.expanded.insert(room_id.clone()); }
                            SavedPlacement::Member { room_id, .. } => {
                                let parent = row.placement.target();
                                if let Some(room) = room_id {
                                    self.workspace.expanded.insert(room.clone());
                                } else {
                                    self.workspace.pool_expanded = true;
                                }
                                self.workspace.reveal_member_ancestors(&parent);
                                self.workspace.set_member_folded(&parent, false);
                            }
                        }
                        self.standalone.update_row(row);
                    }
                    self.standalone.saved_changed();
                    self.say("Saved terminal moved.");
                }
                (_, Err(error)) => {
                    if matches!(self.standalone.page, Some(Page::Remove { .. })) {
                        self.standalone.notice = Some(error.message);
                    } else {
                        self.say(error.message);
                    }
                    self.standalone.refresh_due = true;
                }
                _ => {}
            }
        }
        self.workspace_reconcile();
        self.invalidate_frame_geometry();
    }
}
