//! What the board does for the member frame (#5989): `j` on a built-in member fills the board with
//! its terminal under one TMT header row. Every key but the back key is the program's; the header,
//! its menus and the paused and ended dialogs answer the mouse, and the dialogs their own keys. The
//! state itself is [`Tab`](super::tab::Tab).
use super::{
    discovery::{Located, MemberTerm},
    stream::StreamEvent,
    tab::{FrameHit, FrameMenu},
};
use crate::{
    action::{OpsUiAction, Verb},
    board::app::{App, CopyFeedback, Effect, Request, TerminalOp, event_name},
};
use ratatui::{
    crossterm::event::{KeyCode, KeyEvent, MouseButton, MouseEvent, MouseEventKind},
    layout::Position,
};
use std::time::Duration;
use tmt_pty_protocol::RelaunchKind;
use tmt_tui::components::terminal::{MouseMode, key_bytes, paste_bytes, wheel_bytes};

/// What a dialog over the frame asks about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::board) enum Dialog {
    /// Stopped by job control (#5994): resume, or back to the board.
    Paused,
    /// The agent ended on its kept terminal (#5988): resume, a new session, a shell, or back.
    Ended,
}

impl App {
    /// After a draw: a program that hides its cursor still has the real cursor moved to where it
    /// parked its own, kept hidden, so an input method draws there.
    pub(in crate::board) fn park_hidden_caret<B: ratatui::backend::Backend>(
        &self,
        screen: &mut ratatui::Terminal<B>,
    ) -> Result<(), B::Error> {
        match self.terminal.caret() {
            Some(caret) if !caret.shown => {
                let backend = screen.backend_mut();
                backend.set_cursor_position(caret.at)?;
                backend.flush()
            }
            _ => Ok(()),
        }
    }

    /// The member that fills the board.
    pub(in crate::board) fn framed_identity(&self) -> Option<String> {
        self.terminal.framed().map(str::to_owned)
    }

    /// The board is a member's frame.
    pub(in crate::board) fn framed(&self) -> bool {
        self.terminal.framed().is_some()
    }

    /// What the open stream shows, when it is the framed member's.
    pub(in crate::board) fn terminal_view(&self) -> Option<&super::tab::View> {
        self.terminal.view(self.terminal.framed()?)
    }

    /// What core last said runs on the framed member's terminal.
    pub(in crate::board) fn framed_term(&self) -> Option<MemberTerm> {
        self.terminal.member_term(self.terminal.framed()?)
    }

    /// The member core should be asked about next: only the framed one.
    pub(in crate::board) fn terminal_locate(&self) -> Option<String> {
        let id = self
            .framed_identity()
            .filter(|key| !crate::board::member_terminals::is_terminal_key(key))?;
        self.terminal
            .needs_locating(&id, crate::status::now_ms())
            .then_some(id)
    }

    /// How long until the framed member's answer is old enough to ask again.
    pub(in crate::board) fn terminal_wait(&self) -> Option<Duration> {
        let id = self
            .framed_identity()
            .filter(|key| !crate::board::member_terminals::is_terminal_key(key))?;
        self.terminal.locating_wait(&id, crate::status::now_ms())
    }

    pub(in crate::board) fn apply_terminal_located(&mut self, identity: &str, located: Located) {
        let gone = matches!(located, Located::NoStream) && self.terminal.framed() == Some(identity);
        self.terminal
            .located(identity, located, crate::status::now_ms());
        if gone {
            // The member's supervisor is gone (closed or removed): nothing is left to show.
            self.terminal.close_frame();
            self.say("The member's terminal is gone; back on the board.");
        }
    }

    /// The row of `identity`, from the rows the board has.
    fn identity_row(&self, identity: &str) -> Option<serde_json::Value> {
        self.rows()
            .into_iter()
            .map(|(_, row)| row)
            .find(|row| row["id"].as_str() == Some(identity))
            .cloned()
    }

    /// The framed member's name, for the header and the dialogs.
    pub(in crate::board) fn terminal_member_name(&self) -> String {
        if let Some((_, row)) = self
            .framed_identity()
            .and_then(|key| self.terminals.find(&key))
        {
            return row.title();
        }
        self.framed_identity()
            .and_then(|id| self.identity_row(&id))
            .and_then(|row| row["name"].as_str().map(str::to_owned))
            .unwrap_or_else(|| "agent".to_owned())
    }

    /// The framed member's held Digest items, as its row reports them.
    pub(in crate::board) fn framed_digest_held(&self) -> u64 {
        self.framed_identity()
            .and_then(|id| self.identity_row(&id))
            .and_then(|row| row["digest"]["heldCount"].as_u64())
            .unwrap_or(0)
    }

    /// The framed member's open Checklist items, as the number the board shows; empty when none
    /// or not read yet.
    pub(in crate::board) fn framed_checklist_open(&self) -> String {
        use crate::board::conversation_checklist::Summary;
        match self
            .framed_checklist_key()
            .and_then(|key| self.notes.summary(&key))
        {
            Some(Summary::Counts(counts)) if counts.todo > 0 => counts.todo.to_string(),
            _ => String::new(),
        }
    }

    /// The key bound to `member-back`, as the board writes keys.
    pub(in crate::board) fn member_back_label(&self) -> String {
        let bindings = self.workspace_bindings();
        let mut keys: Vec<_> = bindings
            .iter()
            .filter(|(_, action)| action.verb == Verb::Ui(OpsUiAction::MemberBack))
            .map(|(key, _)| crate::board::view::footer::key_label(key).to_owned())
            .collect();
        keys.sort();
        keys.into_iter().next().unwrap_or_else(|| "Ctrl-g".into())
    }

    /// Every roster member by name, with the state its dot shows: waiting or blocked when its
    /// squad or Core says so, otherwise its activity word.
    pub(in crate::board) fn frame_roster(&self) -> Vec<RosterEntry> {
        let Some(snapshot) = self.workspace_snapshot() else {
            return Vec::new();
        };
        let stale = self.activity_stale(std::time::Instant::now());
        let now = crate::status::now_ms();
        let mut entries: Vec<_> = snapshot
            .roster
            .members
            .values()
            .map(|member| {
                let squad = snapshot
                    .roster
                    .squads
                    .iter()
                    .filter_map(|squad| squad.member_states.get(&member.id))
                    .collect::<Vec<_>>();
                let flagged = |word: &str| {
                    member.state.as_deref() == Some(word)
                        || squad
                            .iter()
                            .any(|state| state.state.as_deref() == Some(word))
                };
                let state = if member.waiting || squad.iter().any(|state| state.waiting) {
                    "waiting".to_owned()
                } else if flagged("blocked") {
                    "blocked".to_owned()
                } else {
                    crate::board::activity::Member {
                        activity: member.activity,
                        waiting: false,
                        idle_over: false,
                        task: None,
                    }
                    .label(stale, now)
                    .state
                    .to_owned()
                };
                RosterEntry {
                    id: member.id.clone(),
                    name: crate::board::notes::single_line(&member.name),
                    state,
                }
            })
            .collect();
        entries.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
        entries
    }

    /// After the framed member in name order, the first member waiting on you or blocked.
    pub(in crate::board) fn next_member_needing_you(&self) -> Option<String> {
        let roster = self.frame_roster();
        let framed = self.framed_identity();
        let at = roster
            .iter()
            .position(|entry| Some(&entry.id) == framed.as_ref())
            .map_or(0, |at| at + 1);
        roster
            .iter()
            .cycle()
            .skip(at)
            .take(roster.len())
            .find(|entry| {
                Some(&entry.id) != framed.as_ref()
                    && matches!(entry.state.as_str(), "waiting" | "blocked")
            })
            .map(|entry| entry.id.clone())
    }

    /// The framed member's conversation checklist.
    pub(in crate::board) fn framed_checklist_key(
        &self,
    ) -> Option<crate::board::conversation_checklist::Key> {
        let id = self.framed_identity()?;
        // The row the frame was opened from, else the member's acquired membership.
        let selected = self.workspace_selected_member().filter(|target| {
            matches!(target, crate::board::workspace::OpsTarget::Member { identity_id, .. } if *identity_id == id)
        });
        match selected {
            Some(target) => crate::board::conversation_checklist::Key::of(target),
            None => crate::board::conversation_checklist::Key::of(&self.member_link_target(&id)?),
        }
    }

    /// Whether the board row of `identity` runs on the built-in host, so the frame can show it.
    fn built_in_row(&self, identity: &str) -> bool {
        self.identity_row(identity).is_some_and(|row| {
            row["pane"]["location"]["host"] == crate::board::new_member::model::BUILT_IN_HOST
        })
    }

    /// The selected row is a built-in-host member, which `j` opens full screen.
    pub(in crate::board) fn selected_built_in(&self) -> bool {
        self.selected_row().is_some_and(|row| {
            row["pane"]["location"]["host"] == crate::board::new_member::model::BUILT_IN_HOST
        })
    }

    /// `j` on a built-in member fills the board with its terminal. `None` for any other member,
    /// which keeps the host jump.
    pub(in crate::board) fn jump_to_terminal(&mut self, row: &serde_json::Value) -> Option<Effect> {
        if row["pane"]["location"]["host"] != crate::board::new_member::model::BUILT_IN_HOST {
            return None;
        }
        let id = row["id"].as_str()?;
        if !crate::board::recent_responses::canonical_identity(id) {
            return None;
        }
        Some(self.open_member_frame(id))
    }

    /// Fills the board with `identity`'s terminal.
    pub(in crate::board) fn open_member_frame(&mut self, identity: &str) -> Effect {
        self.terminal.open_frame(identity);
        self.invalidate_frame_geometry();
        Effect::None
    }

    /// Back to the board; the stream detaches on the next pass.
    pub(in crate::board) fn close_member_frame(&mut self) -> Effect {
        self.terminal.close_frame();
        self.invalidate_frame_geometry();
        Effect::None
    }

    /// Opens, replaces or drops the one stream so it matches the frame. True when it changed.
    pub(in crate::board) fn terminal_sync(&mut self) -> bool {
        let wanted = self.wanted_terminal_stream().or_else(|| {
            let id = self.framed_identity()?;
            let address = self.terminal.address(&id)?.clone();
            Some((id, address))
        });
        let changed = self
            .terminal
            .sync(wanted.as_ref().map(|(id, address)| (id.as_str(), address)));
        self.terminal.fit_window();
        changed
    }

    /// The dialog the frame shows now, unless it was dismissed for this state.
    pub(in crate::board) fn frame_dialog(&self) -> Option<Dialog> {
        let term = self.framed_term()?;
        let dialog = if term.paused {
            Dialog::Paused
        } else if term.ended.is_some() {
            Dialog::Ended
        } else {
            return None;
        };
        (self.terminal.dismissed() != Some(dialog)).then_some(dialog)
    }

    /// The key is bound to `member-back` (Ctrl-g by default). It never reaches the member.
    pub(in crate::board) fn back_key(&self, key: KeyEvent) -> bool {
        event_name(key).is_some_and(|name| {
            self.workspace_bindings()
                .get(&name)
                .is_some_and(|action| action.verb == Verb::Ui(OpsUiAction::MemberBack))
        })
    }

    /// While the frame is up every key is the program's, byte for byte, except the back key; a
    /// dialog or a menu takes its own keys first.
    pub(in crate::board) fn frame_key(&mut self, key: KeyEvent) -> Option<Effect> {
        self.terminal.framed()?;
        if self.back_key(key) {
            return Some(self.close_member_frame());
        }
        if let Some(dialog) = self.frame_dialog() {
            return Some(self.dialog_key(dialog, key));
        }
        if let Some(menu) = self.terminal.menu() {
            return Some(self.frame_menu_key(menu, key));
        }
        if self
            .terminal_view()
            .is_some_and(|view| view.condition.ended())
        {
            if key.code == KeyCode::Enter {
                self.terminal.reattach();
            }
            return Some(Effect::None);
        }
        if let Some(bytes) = key_bytes(&key, self.terminal.modes()) {
            self.terminal.send(&bytes);
        }
        Some(Effect::None)
    }

    fn dialog_key(&mut self, dialog: Dialog, key: KeyEvent) -> Effect {
        let choices = dialog_choices(dialog);
        match key.code {
            KeyCode::Esc => {
                self.terminal.dismiss(dialog);
                Effect::None
            }
            KeyCode::Up => {
                self.terminal.move_cursor(-1, choices.len());
                Effect::None
            }
            KeyCode::Down | KeyCode::Tab => {
                self.terminal.move_cursor(1, choices.len());
                Effect::None
            }
            KeyCode::Enter => {
                let hit = choices[self.terminal.cursor().min(choices.len() - 1)]
                    .1
                    .clone();
                self.frame_act(hit)
            }
            KeyCode::Char(letter) => choices
                .iter()
                .find(|(_, _, key)| *key == Some(letter))
                .map(|(_, hit, _)| hit.clone())
                .map_or(Effect::None, |hit| self.frame_act(hit)),
            _ => Effect::None,
        }
    }

    fn frame_menu_key(&mut self, menu: FrameMenu, key: KeyEvent) -> Effect {
        let rows = self.menu_entries(menu);
        match key.code {
            KeyCode::Esc => self.terminal.set_menu(None),
            KeyCode::Up => self.terminal.move_cursor_over(-1, &rows),
            KeyCode::Down => self.terminal.move_cursor_over(1, &rows),
            KeyCode::Enter => {
                if let Some(hit) = rows.get(self.terminal.cursor()).and_then(MenuRow::hit) {
                    return self.frame_act(hit.clone());
                }
            }
            KeyCode::Char(letter) => {
                let typed = letter.to_string();
                if let Some(hit) = rows
                    .iter()
                    .find(|row| row.key() == Some(typed.as_str()))
                    .and_then(MenuRow::hit)
                {
                    return self.frame_act(hit.clone());
                }
            }
            _ => {}
        }
        Effect::None
    }

    /// The rows of an open header menu (mocks 2 and 7 on the #5926 spec page).
    pub(in crate::board) fn menu_entries(&self, menu: FrameMenu) -> Vec<MenuRow> {
        let term = self.framed_term().unwrap_or_default();
        let ended = term.ended.is_some();
        let choice = |label: &str, hit: Option<FrameHit>| MenuRow::Choice {
            mark: None,
            label: label.to_owned(),
            key: None,
            hit,
        };
        match menu {
            FrameMenu::Members => {
                // The other members (mock 2): the framed one is already on screen.
                let framed = self.framed_identity();
                let mut rows: Vec<_> = self
                    .frame_roster()
                    .into_iter()
                    .filter(|entry| Some(&entry.id) != framed.as_ref())
                    .map(|entry| MenuRow::Choice {
                        mark: Some(Mark::State(entry.state)),
                        label: entry.name,
                        key: None,
                        hit: Some(FrameHit::Member(entry.id)),
                    })
                    .collect();
                rows.push(MenuRow::Divider);
                rows.push(MenuRow::Choice {
                    mark: None,
                    label: "Back to board".into(),
                    key: Some(self.member_back_label()),
                    hit: Some(FrameHit::Back),
                });
                rows.push(MenuRow::Choice {
                    mark: None,
                    label: "Next member needing you".into(),
                    key: Some("n".into()),
                    hit: self.next_member_needing_you().map(FrameHit::Member),
                });
                rows
            }
            FrameMenu::Session => vec![
                choice(
                    "Resume the last session",
                    ended.then_some(FrameHit::Relaunch(RelaunchKind::Resume)),
                ),
                choice(
                    "Start a new session",
                    ended.then_some(FrameHit::Relaunch(RelaunchKind::New)),
                ),
                choice(
                    "Restart",
                    ended.then_some(FrameHit::Relaunch(RelaunchKind::New)),
                ),
                choice(
                    if term.paused {
                        "Continue"
                    } else {
                        "Continue (not paused now)"
                    },
                    term.paused.then_some(FrameHit::Resume),
                ),
            ],
            FrameMenu::Checklist => {
                let preview = self
                    .framed_checklist_key()
                    .and_then(|key| self.notes.preview(&key));
                let mut rows = Vec::new();
                match preview {
                    None => rows.push(MenuRow::Note("Reading the checklist…".into())),
                    Some(preview) => {
                        let items = &preview.current.items;
                        rows.extend(
                            items
                                .iter()
                                .filter(|view| {
                                    crate::board::conversation_checklist::open_item(view)
                                })
                                .map(|view| MenuRow::Choice {
                                    mark: Some(Mark::Open),
                                    label: crate::board::notes::single_line(
                                        &view.item.content.title,
                                    ),
                                    key: None,
                                    hit: Some(FrameHit::Checklist),
                                }),
                        );
                        let done = items
                            .iter()
                            .filter(|view| {
                                !view.item.archived
                                    && view.item.completion
                                        == crate::checklist::model::Completion::Complete
                            })
                            .count();
                        if done > 0 {
                            rows.push(MenuRow::Note(format!("▸ Done {done}")));
                        }
                    }
                }
                rows.push(MenuRow::Divider);
                rows.push(choice("+ Add item", Some(FrameHit::AddItem)));
                rows
            }
        }
    }

    /// A click on the header, a menu row or a dialog choice.
    pub(in crate::board) fn frame_act(&mut self, hit: FrameHit) -> Effect {
        let Some(identity) = self.framed_identity() else {
            return Effect::None;
        };
        self.terminal.set_menu(None);
        let request = |op| {
            Effect::Act(Request::Terminal {
                identity: identity.clone(),
                op,
            })
        };
        match hit {
            FrameHit::Back => self.close_member_frame(),
            FrameHit::Menu(menu) => {
                let open = self.terminal.menu() != Some(menu);
                self.terminal.set_menu(open.then_some(menu));
                if open {
                    // The highlight starts on the first row that can be chosen.
                    let rows = self.menu_entries(menu);
                    let start = rows.iter().position(|row| row.hit().is_some()).unwrap_or(0);
                    self.terminal.set_cursor(start);
                }
                Effect::None
            }
            FrameHit::Resume => {
                self.terminal.recheck(&identity);
                request(TerminalOp::Resume)
            }
            FrameHit::Relaunch(kind) => {
                self.terminal.recheck(&identity);
                request(TerminalOp::Relaunch(kind))
            }
            FrameHit::Colab => request(TerminalOp::Colab),
            FrameHit::Member(id) if self.built_in_row(&id) => self.open_member_frame(&id),
            // A member on another host has no frame: the board selects its row instead.
            FrameHit::Member(id) => {
                self.close_member_frame();
                match self.member_link_target(&id) {
                    Some(target) => self.member_link_action(&target, false),
                    None => self.say("This member is unavailable; refresh the board."),
                }
            }
            FrameHit::AddItem => {
                let key = self.framed_checklist_key();
                self.close_member_frame();
                match key {
                    Some(key) => self.open_notes_adding(key),
                    None => self.say("This member's checklist is unavailable; refresh the board."),
                }
            }
            FrameHit::Checklist => {
                self.close_member_frame();
                self.workspace_action(OpsUiAction::MemberNotes)
            }
            FrameHit::Dismiss(dialog) => {
                self.terminal.dismiss(dialog);
                Effect::None
            }
        }
    }

    /// The header and its menus are the mouse's; over the screen a drag selects and copies
    /// unless the program asked for the mouse, and the wheel is the program's.
    pub(in crate::board) fn frame_mouse(&mut self, event: MouseEvent) -> Option<Effect> {
        self.terminal.framed()?;
        let at = Position::new(event.column, event.row);
        if let MouseEventKind::Down(MouseButton::Left) = event.kind
            && let Some(hit) = self.terminal.hit(at)
        {
            return Some(self.frame_act(hit));
        }
        if matches!(event.kind, MouseEventKind::Down(_)) && self.terminal.menu().is_some() {
            self.terminal.set_menu(None);
            return Some(Effect::None);
        }
        let area = self.terminal.area()?;
        if !area.contains(at) || self.frame_dialog().is_some() {
            return Some(Effect::None);
        }
        let cell = (event.column - area.x, event.row - area.y);
        let program_mouse = self.terminal.modes().mouse != MouseMode::Off;
        match event.kind {
            MouseEventKind::Down(MouseButton::Left) if !program_mouse => {
                self.terminal.select_from(cell);
            }
            MouseEventKind::Drag(MouseButton::Left) if !program_mouse => {
                self.terminal.select_to(cell);
            }
            MouseEventKind::Up(MouseButton::Left) if !program_mouse => {
                self.terminal.select_to(cell);
                if let Some(text) = self.terminal.selected_text() {
                    return Some(Effect::Act(Request::Copy {
                        text,
                        program: self.view.as_ref().and_then(|view| view.clipboard.clone()),
                        feedback: CopyFeedback::Selection,
                    }));
                }
            }
            MouseEventKind::ScrollUp | MouseEventKind::ScrollDown => {
                if let Some(bytes) = wheel_bytes(
                    event.kind == MouseEventKind::ScrollUp,
                    cell.0,
                    cell.1,
                    self.terminal.modes(),
                ) {
                    self.terminal.send(&bytes);
                }
            }
            _ => {}
        }
        Some(Effect::None)
    }

    /// While the frame is up, a paste is the program's.
    pub(in crate::board) fn frame_paste(&mut self, text: &str) -> Option<Effect> {
        self.terminal.framed()?;
        if self.frame_dialog().is_none() {
            self.terminal
                .send(&paste_bytes(text, self.terminal.modes()));
        }
        Some(Effect::None)
    }

    pub(in crate::board) fn apply_terminal(&mut self, epoch: u64, event: StreamEvent) -> bool {
        self.terminal.apply(epoch, event)
    }
}

/// A dialog's choices: the words, what each does, and its letter key.
pub(in crate::board) fn dialog_choices(
    dialog: Dialog,
) -> Vec<(&'static str, FrameHit, Option<char>)> {
    match dialog {
        Dialog::Paused => vec![
            ("Resume", FrameHit::Resume, None),
            ("Back to board", FrameHit::Back, None),
        ],
        Dialog::Ended => vec![
            (
                "Resume the last session",
                FrameHit::Relaunch(RelaunchKind::Resume),
                None,
            ),
            (
                "Start a new session",
                FrameHit::Relaunch(RelaunchKind::New),
                Some('n'),
            ),
            (
                "Open a shell here",
                FrameHit::Relaunch(RelaunchKind::Shell),
                Some('s'),
            ),
            ("Back to board", FrameHit::Back, None),
        ],
    }
}

/// One roster member in the Members menu.
pub(in crate::board) struct RosterEntry {
    pub id: String,
    pub name: String,
    /// The state word its dot shows (`state_cell`).
    pub state: String,
}

/// What stands before a menu row's words.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) enum Mark {
    /// A member's state word, painted as the Agents tree paints its dot.
    State(String),
    /// An open checklist item, `☐`.
    Open,
}

/// One row of a header menu.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) enum MenuRow {
    /// Something to choose: `key` is its letter; with no `hit` it shows dim and cannot be chosen.
    Choice {
        mark: Option<Mark>,
        label: String,
        key: Option<String>,
        hit: Option<FrameHit>,
    },
    /// A dim line that does nothing, such as the collapsed done count.
    Note(String),
    Divider,
}

impl MenuRow {
    pub(in crate::board) fn hit(&self) -> Option<&FrameHit> {
        match self {
            Self::Choice { hit, .. } => hit.as_ref(),
            _ => None,
        }
    }

    fn key(&self) -> Option<&str> {
        match self {
            Self::Choice { key, .. } => key.as_deref(),
            _ => None,
        }
    }
}
