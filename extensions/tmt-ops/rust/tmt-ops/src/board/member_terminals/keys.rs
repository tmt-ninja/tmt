//! The keys of a member's terminals (#5991): `t` opens one, `⏎` types into the selected one in
//! the right panel, `j` shows it full screen, `x` closes it (asking first while a program runs),
//! and the back key (Ctrl-g) returns to the list. Each one only changes board state or queues a
//! lane task; nothing here calls Core.
use crate::{
    action::OpsUiAction,
    board::{
        app::{App, Choice, Effect},
        terminal_tab::discovery::Address,
        workspace::OpsTarget,
    },
};
use ratatui::crossterm::event::KeyEvent;
use tmt_tui::components::terminal::{key_bytes, paste_bytes};

/// Whether a frame or stream key names one of these terminals rather than a member.
pub(in crate::board) fn is_terminal_key(key: &str) -> bool {
    key.starts_with("term_")
}

impl App {
    pub(in crate::board) fn terminal_action(&mut self, action: OpsUiAction) -> Effect {
        match action {
            OpsUiAction::TerminalNew => {
                let Some(identity) = self.terminals_owner().map(str::to_owned) else {
                    return Effect::None;
                };
                if !self.builtin_member(&identity) {
                    return self.say("Only an agent on the built-in host has terminals.");
                }
                self.terminals.open(&identity);
                Effect::None
            }
            OpsUiAction::TerminalType => {
                let Some((_, row)) = self.selected_terminal() else {
                    return Effect::None;
                };
                if row.ended {
                    return self.say("This terminal has ended; x removes it.");
                }
                let id = row.id.clone();
                self.terminals.set_typing(Some(&id));
                Effect::None
            }
            OpsUiAction::TerminalFullScreen => {
                let Some((_, row)) = self.selected_terminal() else {
                    return Effect::None;
                };
                if row.ended {
                    return self.say("This terminal has ended; x removes it.");
                }
                let id = row.id.clone();
                self.terminals.set_typing(None);
                self.terminal.open_frame(&id);
                self.invalidate_frame_geometry();
                Effect::None
            }
            OpsUiAction::TerminalClose => {
                let Some((identity, row)) = self.selected_terminal() else {
                    return Effect::None;
                };
                let (identity, id, title, ended, busy) = (
                    identity.to_owned(),
                    row.id.clone(),
                    row.title(),
                    row.ended,
                    row.busy,
                );
                if ended {
                    self.terminals.forget(&identity, &id);
                    self.select_member_of(&identity);
                    return Effect::None;
                }
                if busy {
                    return self.confirm(
                        format!("Close {title}?"),
                        vec!["A program is still running. Closing ends it.".into()],
                        "Close".into(),
                        Choice::CloseTerminal {
                            identity,
                            terminal: id,
                        },
                    );
                }
                self.terminals.close(&identity, &id, false);
                Effect::None
            }
            _ => Effect::None,
        }
    }

    /// The confirmed close of a busy terminal ends its program.
    pub(in crate::board) fn close_terminal_confirmed(
        &mut self,
        identity: &str,
        terminal: &str,
    ) -> Effect {
        self.terminals.close(identity, terminal, true);
        Effect::None
    }

    /// Back on the member row after its terminal row went away.
    fn select_member_of(&mut self, identity: &str) {
        if let Some(OpsTarget::Terminal { room_id, .. }) = self.workspace.selected.clone() {
            self.workspace.selected = Some(OpsTarget::Member {
                room_id,
                identity_id: identity.to_owned(),
            });
            self.invalidate_frame_geometry();
        }
    }

    /// The terminal keys go to while typing in the right panel: still selected and live.
    fn typing_terminal(&mut self) -> Option<String> {
        let typing = self.terminals.typing()?.to_owned();
        let live = self
            .selected_terminal()
            .is_some_and(|(_, row)| row.id == typing && !row.ended);
        if !live {
            self.terminals.set_typing(None);
            return None;
        }
        Some(typing)
    }

    /// While typing in the right panel every key is the terminal's, byte for byte, except the
    /// back key, which returns to the list.
    pub(in crate::board) fn terminal_typing_key(&mut self, key: KeyEvent) -> Option<Effect> {
        if self.framed() {
            return None;
        }
        self.typing_terminal()?;
        if self.back_key(key) {
            self.terminals.set_typing(None);
            return Some(Effect::None);
        }
        if let Some(bytes) = key_bytes(&key, self.terminal.modes()) {
            self.terminal.send(&bytes);
        }
        Some(Effect::None)
    }

    pub(in crate::board) fn terminal_typing_paste(&mut self, text: &str) -> Option<Effect> {
        if self.framed() {
            return None;
        }
        self.typing_terminal()?;
        self.terminal
            .send(&paste_bytes(text, self.terminal.modes()));
        Some(Effect::None)
    }

    /// The terminal stream the board keeps open, when it is one of these terminals: the one
    /// full screen, else the live one selected in the list.
    pub(in crate::board) fn wanted_terminal_stream(&self) -> Option<(String, Address)> {
        let id = match self.terminal.framed() {
            Some(key) if is_terminal_key(key) => key.to_owned(),
            Some(_) => return None,
            None => {
                let (_, row) = self.selected_terminal()?;
                if row.ended {
                    return None;
                }
                row.id.clone()
            }
        };
        let (_, row) = self.terminals.find(&id)?;
        Some((
            id.clone(),
            Address {
                socket: row.socket.clone(),
                pane: id,
            },
        ))
    }
}
