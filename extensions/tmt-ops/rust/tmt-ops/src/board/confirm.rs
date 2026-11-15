//! The board's confirm dialog: a question, a few lines about it and Cancel / the action. Choosing
//! the action applies its `Choice`; everything else closes it and changes nothing. The cursor
//! starts on Cancel, so a stray Enter never applies a destructive action.
use super::app::{App, Choice, Effect, Overlay};
use ratatui::{
    Frame,
    crossterm::event::{Event, KeyCode},
    layout::Rect,
    text::Line,
};
use std::cell::RefCell;
use tmt_cli_style::Role;
use tmt_tui::components::{
    Button, Dialog, DialogHits, DialogInput, DialogKind, DialogState, Focus, Placement, strip,
};

pub(super) struct Confirm {
    title: String,
    lines: Vec<String>,
    action: String,
    /// A destroying action: its button is red and the row says y applies it.
    destructive: bool,
    choice: Choice,
    state: DialogState,
    hits: RefCell<DialogHits>,
}

impl Confirm {
    fn dialog_full(&self) -> Dialog<'_> {
        Dialog {
            title: self.title.clone(),
            kind: DialogKind::Confirm,
            placement: Placement::Center,
            hints: if self.destructive {
                "y delete · Esc cancel".into()
            } else {
                String::new()
            },
            buttons: buttons(&self.action, self.destructive).into(),
        }
    }
    #[cfg(test)]
    pub(super) fn title(&self) -> &str {
        &self.title
    }

    #[cfg(test)]
    pub(super) fn lines(&self) -> &[String] {
        &self.lines
    }

    pub(super) fn invalidate(&self) {
        *self.hits.borrow_mut() = DialogHits::default();
    }

    pub(super) fn render(&self, frame: &mut Frame, app: &App, body: Rect) {
        let look = app.look();
        // The body wraps inside the content-sized dialog rather than being cut (#5890 review).
        let longest = self
            .lines
            .iter()
            .map(|line| line.chars().count())
            .max()
            .unwrap_or_default()
            .max(self.title.chars().count() + 4)
            .max(self.dialog_full().footer_width().into())
            .saturating_add(4)
            .max(40);
        let width = longest.min(usize::from(body.width));
        let lines: Vec<String> = self
            .lines
            .iter()
            .flat_map(|line| super::notes::wrap(line, width.saturating_sub(4)))
            .collect();
        // Frame, body, one empty row, then the buttons: like the other dialogs.
        let height = lines.len().saturating_add(4);
        let size = [
            u16::try_from(width).unwrap_or(u16::MAX),
            u16::try_from(height).unwrap_or(u16::MAX),
        ];
        let full = self.dialog_full();
        let areas = full.areas(body, size, false);
        // Never offer an action whose question cannot be shown in full: a short terminal keeps
        // only Cancel and asks for room, as the close dialog does.
        let short = lines.len() > usize::from(areas.content.height);
        // A terminal too short for the body has no row for a note either: the title asks for room.
        let dialog = if short {
            Dialog {
                title: "Enlarge to review · Esc close".into(),
                buttons: vec![Button::secondary("Cancel")],
                hints: String::new(),
                ..full
            }
        } else {
            full
        };
        let hits = super::buttons::paint_dialog(
            app,
            frame.buffer_mut(),
            &dialog,
            areas,
            &self.state,
            Overlay::Confirm,
        );
        app.peek_areas.set(Overlay::Confirm, Some(areas.outer));
        let content = areas.content;
        let shown = if short { Vec::new() } else { lines };
        for (row, line) in shown.iter().take(usize::from(content.height)).enumerate() {
            strip::paint_left(
                frame.buffer_mut(),
                Rect::new(content.x, content.y + row as u16, content.width, 1),
                Line::styled(
                    super::view::fit(line, usize::from(content.width)),
                    look.role(Role::Text),
                ),
            );
        }
        *self.hits.borrow_mut() = hits;
    }
}

impl App {
    /// Asks before `choice`: `action` names the button that applies it.
    pub(super) fn confirm(
        &mut self,
        title: String,
        lines: Vec<String>,
        action: String,
        choice: Choice,
    ) -> Effect {
        self.confirm_with(title, lines, action, false, choice)
    }

    /// [`Self::confirm`] for an action that destroys something, such as Delete timer.
    pub(super) fn confirm_destructive(
        &mut self,
        title: String,
        lines: Vec<String>,
        action: String,
        choice: Choice,
    ) -> Effect {
        self.confirm_with(title, lines, action, true, choice)
    }

    fn confirm_with(
        &mut self,
        title: String,
        lines: Vec<String>,
        action: String,
        destructive: bool,
        choice: Choice,
    ) -> Effect {
        self.menu = None;
        self.confirm = Some(Confirm {
            title,
            lines,
            action,
            destructive,
            choice,
            // Opens on Cancel: a stray Enter never applies.
            state: DialogState {
                focus: Focus::Buttons(1),
            },
            hits: RefCell::default(),
        });
        Effect::None
    }

    pub(super) fn confirm_event(&mut self, event: &Event) -> Option<Effect> {
        let confirm = self.confirm.as_mut()?;
        let action = confirm.action.clone();
        let buttons = buttons(&action, false);
        let input = match event {
            Event::Key(key) => confirm.state.key(DialogKind::Confirm, key, &[], &buttons),
            Event::Mouse(mouse) => {
                let hits = confirm.hits.borrow().clone();
                confirm.state.mouse(mouse, &hits, &buttons)
            }
            _ => DialogInput::Ignored,
        };
        // The letters the menu this replaced used: n keeps, y chooses the action like its button.
        let input = match (input, event) {
            (DialogInput::Ignored, Event::Key(key)) if key.code == KeyCode::Char('n') => {
                DialogInput::Choose(1)
            }
            (DialogInput::Ignored, Event::Key(key)) if key.code == KeyCode::Char('y') => {
                DialogInput::Choose(0)
            }
            (input, _) => input,
        };
        Some(match input {
            DialogInput::Cancel | DialogInput::Choose(1) => self.close_overlay(Overlay::Confirm),
            DialogInput::Choose(_) => {
                let confirm = self.confirm.take().expect("open confirm");
                // Only a painted action applies, never one from a stale or clipped frame; a
                // short terminal paints Cancel alone.
                let hits = confirm.hits.borrow().buttons.clone();
                if hits.len() != 2 || hits[0].is_none() {
                    self.confirm = Some(confirm);
                    return Some(Effect::None);
                }
                self.choose(confirm.choice)
            }
            _ => Effect::None,
        })
    }
}

/// The action first, Cancel beside it.
fn buttons(action: &str, destructive: bool) -> [Button<'_>; 2] {
    [
        Button::primary(action).destructive(destructive),
        Button::secondary("Cancel"),
    ]
}

#[cfg(test)]
mod tests;
