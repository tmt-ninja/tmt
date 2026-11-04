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
        let id = self.framed_identity()?;
        self.terminal
            .needs_locating(&id, crate::status::now_ms())
            .then_some(id)
    }

    /// How long until the framed member's answer is old enough to ask again.
    pub(in crate::board) fn terminal_wait(&self) -> Option<Duration> {
        let id = self.framed_identity()?;
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
        self.framed_identity()
            .and_then(|id| self.member_link_target(&id))
            .and_then(|target| self.notes.row_label(&target))
            .and_then(|label| label.split_whitespace().next().map(str::to_owned))
            .filter(|count| count.chars().all(|ch| ch.is_ascii_digit()))
            .unwrap_or_default()
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

    /// Other built-in members the frame can switch to, by name, with their row state.
    pub(in crate::board) fn frame_members(&self) -> Vec<(String, String, String)> {
        let framed = self.framed_identity();
        let mut members: Vec<_> = self
            .rows()
            .into_iter()
            .map(|(_, row)| row)
            .filter(|row| {
                row["pane"]["location"]["host"] == crate::board::new_member::model::BUILT_IN_HOST
                    && row["id"].as_str().is_some()
                    && row["id"].as_str() != framed.as_deref()
            })
            .map(|row| {
                (
                    row["id"].as_str().unwrap_or_default().to_owned(),
                    row["name"].as_str().unwrap_or("agent").to_owned(),
                    row["state"].as_str().unwrap_or("").to_owned(),
                )
            })
            .collect();
        members.sort_by(|a, b| a.1.cmp(&b.1));
        members.dedup_by(|a, b| a.0 == b.0);
        members
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
        let wanted = self.framed_identity().and_then(|id| {
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
    fn back_key(&self, key: KeyEvent) -> bool {
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
        let entries = self.menu_entries(menu);
        match key.code {
            KeyCode::Esc => self.terminal.set_menu(None),
            KeyCode::Up => self.terminal.move_cursor(-1, entries.len()),
            KeyCode::Down => self.terminal.move_cursor(1, entries.len()),
            KeyCode::Enter => {
                if let Some((_, Some(hit))) = entries.get(self.terminal.cursor()) {
                    return self.frame_act(hit.clone());
                }
            }
            _ => {}
        }
        Effect::None
    }

    /// The rows of an open header menu: its text and what it does, `None` for a dim row.
    pub(in crate::board) fn menu_entries(
        &self,
        menu: FrameMenu,
    ) -> Vec<(String, Option<FrameHit>)> {
        let term = self.framed_term().unwrap_or_default();
        let ended = term.ended.is_some();
        match menu {
            FrameMenu::Members => {
                let mut rows: Vec<_> = self
                    .frame_members()
                    .into_iter()
                    .map(|(id, name, state)| {
                        (
                            format!("{} {name}", state_mark(&state)),
                            Some(FrameHit::Member(id)),
                        )
                    })
                    .collect();
                rows.push(("回看板".into(), Some(FrameHit::Back)));
                rows
            }
            FrameMenu::Session => vec![
                (
                    "接續上一次".into(),
                    ended.then_some(FrameHit::Relaunch(RelaunchKind::Resume)),
                ),
                (
                    "開新的工作階段".into(),
                    ended.then_some(FrameHit::Relaunch(RelaunchKind::New)),
                ),
                (
                    "重新啟動".into(),
                    ended.then_some(FrameHit::Relaunch(RelaunchKind::New)),
                ),
                (
                    if term.paused {
                        "繼續".into()
                    } else {
                        "繼續（現在沒有暫停）".into()
                    },
                    term.paused.then_some(FrameHit::Resume),
                ),
            ],
            FrameMenu::Checklist => vec![("打開 Checklist".into(), Some(FrameHit::Checklist))],
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
            FrameHit::Member(id) => self.open_member_frame(&id),
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
            ("恢復", FrameHit::Resume, None),
            ("回看板", FrameHit::Back, None),
        ],
        Dialog::Ended => vec![
            (
                "接續上一次的工作階段",
                FrameHit::Relaunch(RelaunchKind::Resume),
                None,
            ),
            (
                "開新的工作階段",
                FrameHit::Relaunch(RelaunchKind::New),
                Some('n'),
            ),
            (
                "在這裡開一個 shell",
                FrameHit::Relaunch(RelaunchKind::Shell),
                Some('s'),
            ),
            ("回看板", FrameHit::Back, None),
        ],
    }
}

/// One state dot per member, as the board marks rows.
fn state_mark(state: &str) -> &'static str {
    match state {
        "working" => "●",
        "waiting" | "needs-you" | "pending" => "◆",
        "blocked" => "✗",
        _ => "?",
    }
}
