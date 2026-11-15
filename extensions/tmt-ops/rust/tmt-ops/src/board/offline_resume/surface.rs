//! The dialog: a line about why it asks, one row per member with what it does now, the keys, and
//! the Resume all / Not now buttons.
use super::{Dialog, Kind, Now, Row};
use crate::board::app::{App, Overlay};
use ratatui::{
    Frame,
    layout::Rect,
    style::Style,
    text::{Line, Span},
};
use tmt_cli_style::{Role, mark::Mark};
use tmt_tui::components::{Button, Dialog as Frame_, DialogKind, Placement, strip};

const TITLE: &str = "Resume offline members";
const INTRO: &str = "These members ran on the built-in host and are offline now. Resume continues each one's last conversation.";

pub(super) fn buttons() -> [Button<'static>; 2] {
    [Button::primary("Resume all"), Button::secondary("Not now")]
}

/// What the row says after its name, and in which role.
fn status(row: &Row) -> (String, Role) {
    match &row.now {
        Now::Idle if row.member.action == "resumable" => (String::new(), Role::Muted),
        Now::Idle => (
            crate::board::recovery::member_action(&row.member.action),
            Role::Waiting,
        ),
        Now::Queued(_) => ("Waiting…".into(), Role::Dim),
        Now::Running(Kind::Resume) => ("Resuming…".into(), Role::Waiting),
        Now::Running(Kind::New) => ("Starting a new session…".into(), Role::Waiting),
        Now::Done(Kind::Resume) => (format!("{} Resumed", Mark::Done.symbol()), Role::Working),
        Now::Done(Kind::New) => (
            format!("{} New session started", Mark::Done.symbol()),
            Role::Working,
        ),
        Now::Failed(message) => (
            format!("{} {message}", Mark::Failed.symbol()),
            Role::Blocked,
        ),
    }
}

/// The keys the selected row allows, and those that always work; a narrow dialog keeps the
/// first that fit and always the last.
fn hints(dialog: &Dialog) -> Vec<(&'static str, &'static str)> {
    let row = dialog.rows.get(dialog.selected);
    let mut hints = vec![("↑↓", "select")];
    match row.map(|row| (&row.now, row)) {
        Some((Now::Done(_), _)) => hints.push(("⏎", "open")),
        Some((Now::Idle | Now::Failed(_), row)) => {
            if row.offers(Kind::Resume) {
                hints.push(("⏎", "resume"));
            }
            if row.offers(Kind::New) {
                hints.push(("n", "new session"));
            }
        }
        _ => {}
    }
    hints.push(("a", "resume all"));
    hints.push(("esc", "not now"));
    hints
}

fn fit_hints(
    mut hints: Vec<(&'static str, &'static str)>,
    width: usize,
) -> Vec<(&'static str, &'static str)> {
    let wide = |hints: &[(&str, &str)]| {
        hints
            .iter()
            .map(|(key, label)| key.chars().count() + 1 + label.chars().count())
            .sum::<usize>()
            + 2 * hints.len().saturating_sub(1)
    };
    while hints.len() > 1 && wide(&hints) > width {
        hints.remove(hints.len() - 2);
    }
    hints
}

impl Dialog {
    pub(in crate::board) fn render(&self, frame: &mut Frame, app: &App, body: Rect) {
        let look = app.look();
        let name_width = self
            .rows
            .iter()
            .map(|row| row.member.name.chars().count())
            .max()
            .unwrap_or_default();
        let status_width = self
            .rows
            .iter()
            .map(|row| status(row).0.chars().count())
            .max()
            .unwrap_or_default()
            .max(24);
        // `› ○ ` before the name, two cells between name and status, the frame's four.
        let demand = (4 + name_width + 2 + status_width + 4).clamp(66, 96);
        let width = demand.min(usize::from(body.width));
        let intro = crate::board::notes::wrap(INTRO, width.saturating_sub(4).max(1));
        // The intro, a blank, the rows, a blank and the keys; the frame adds borders and buttons.
        let content = intro.len() + 1 + self.rows.len() + 2;
        let dialog = Frame_ {
            title: TITLE.into(),
            kind: DialogKind::List,
            placement: Placement::Center,
            buttons: buttons().into(),
        };
        let areas = dialog.areas(
            body,
            [
                u16::try_from(width).unwrap_or(u16::MAX),
                u16::try_from(content + 4).unwrap_or(u16::MAX),
            ],
            false,
        );
        let hits = crate::board::buttons::paint_dialog(
            app,
            frame.buffer_mut(),
            &dialog,
            areas,
            &self.state,
            Overlay::OfflineResume,
        );
        app.peek_areas
            .set(Overlay::OfflineResume, Some(areas.outer));
        let area = areas.content;
        let inner = usize::from(area.width);
        let height = usize::from(area.height);
        let mut y = 0usize;
        let line_at = |y: usize| Rect::new(area.x, area.y + y as u16, area.width, 1);
        // The keys take the last line; the intro gives way to the rows on a short terminal.
        let keys_line = height.saturating_sub(1);
        let room = keys_line.saturating_sub(1);
        let intro_shown = if intro.len() + 1 + self.rows.len() <= room {
            intro.len()
        } else {
            0
        };
        for line in intro.iter().take(intro_shown) {
            strip::paint_left(
                frame.buffer_mut(),
                line_at(y),
                Line::styled(line.clone(), look.role(Role::Text)),
            );
            y += 1;
        }
        if intro_shown > 0 {
            y += 1;
        }
        let visible = room.saturating_sub(y).max(1).min(self.rows.len());
        let first = self
            .selected
            .saturating_sub(visible.saturating_sub(1))
            .min(self.rows.len().saturating_sub(visible));
        let mut row_hits = Vec::new();
        for (index, row) in self.rows.iter().enumerate().skip(first).take(visible) {
            if y >= keys_line {
                break;
            }
            let selected = index == self.selected;
            let (words, role) = status(row);
            let name =
                crate::board::view::fit(&row.member.name, name_width.min(inner.saturating_sub(4)));
            let used = 4 + name.chars().count() + 2;
            let words = crate::board::view::fit(&words, inner.saturating_sub(used));
            let style = |value: Style| look.selected(selected, value);
            let rect = line_at(y);
            if selected {
                frame.buffer_mut().set_style(rect, look.selection());
            }
            strip::paint_left(
                frame.buffer_mut(),
                rect,
                Line::from(vec![
                    Span::styled(
                        if selected { "› " } else { "  " },
                        style(look.role(Role::Accent)),
                    ),
                    Span::styled(
                        format!("{} ", Mark::Offline.symbol()),
                        style(look.role(Role::Dim)),
                    ),
                    Span::styled(
                        format!(
                            "{name:<width$}  ",
                            width = name_width.min(inner.saturating_sub(4))
                        ),
                        style(look.role(Role::Text)),
                    ),
                    Span::styled(words, style(look.role(role))),
                ]),
            );
            row_hits.push((rect, index));
            y += 1;
        }
        let keys = fit_hints(hints(self), inner);
        if height > 0 {
            strip::paint_left(
                frame.buffer_mut(),
                line_at(keys_line),
                crate::board::key_hints::line(&keys, look, look.role(Role::Text), "  "),
            );
        }
        *self.hits.borrow_mut() = hits;
        *self.row_hits.borrow_mut() = row_hits;
    }
}
