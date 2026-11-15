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

/// While a batch runs, Resume all is unavailable: its hint goes and its button is dim.
pub(super) fn buttons(resume_all: bool) -> [Button<'static>; 2] {
    [
        Button::primary("Resume all").enabled(resume_all),
        Button::secondary("Not now"),
    ]
}

/// One width for every state of the dialog, so a result never resizes it.
const WIDTH: usize = 84;

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

/// The keys the selected row allows now, Resume all while it is available, and Esc. A narrow
/// dialog drops `↑↓ select` first, then the row's keys, and always keeps Esc.
fn hints(dialog: &Dialog) -> Vec<(&'static str, &'static str)> {
    let mut hints = vec![("↑↓", "select")];
    if let Some(row) = dialog.rows.get(dialog.selected)
        && row.choosable()
    {
        if row.offers(Kind::Resume) {
            hints.push(("⏎", "resume"));
        }
        if row.offers(Kind::New) {
            hints.push(("n", "new session"));
        }
    }
    if dialog.resume_all_available() {
        hints.push(("a", "resume all"));
    }
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
        hints.remove(if hints[0].0 == "↑↓" {
            0
        } else {
            hints.len() - 2
        });
    }
    hints
}

impl Dialog {
    pub(in crate::board) fn render(&self, frame: &mut Frame, app: &App, body: Rect) {
        let look = app.look();
        let width = WIDTH.min(usize::from(body.width));
        let inner = width.saturating_sub(4).max(1);
        let name_width = self
            .rows
            .iter()
            .map(|row| row.member.name.chars().count())
            .max()
            .unwrap_or_default()
            .min(inner / 3);
        // `› ○ ` before the name and two cells after it; the reason wraps under its own column.
        let indent = 4 + name_width + 2;
        let reason_width = inner.saturating_sub(indent).max(1);
        let lines: Vec<(Vec<String>, Role)> = self
            .rows
            .iter()
            .map(|row| {
                let (words, role) = status(row);
                let wrapped = if words.is_empty() {
                    vec![String::new()]
                } else {
                    crate::board::notes::wrap(&words, reason_width)
                };
                (wrapped, role)
            })
            .collect();
        let intro = crate::board::notes::wrap(INTRO, inner);
        let row_lines: usize = lines.iter().map(|(wrapped, _)| wrapped.len()).sum();
        // The intro, a blank, the rows, a blank and the keys; the frame adds borders and buttons.
        let content = intro.len() + 1 + row_lines + 2;
        let resume_all = self.resume_all_available();
        let dialog = Frame_ {
            title: TITLE.into(),
            kind: DialogKind::List,
            placement: Placement::Center,
            hints: String::new(),
            buttons: buttons(resume_all).into(),
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
        let intro_shown = if intro.len() + 1 + row_lines <= room {
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
        // The first row shown keeps the selected row, all its lines, inside the room left.
        let budget = room.saturating_sub(y);
        let mut first = 0;
        while first < self.selected
            && lines[first..=self.selected]
                .iter()
                .map(|(wrapped, _)| wrapped.len())
                .sum::<usize>()
                > budget
        {
            first += 1;
        }
        let mut row_hits = Vec::new();
        for (index, (row, (wrapped, role))) in self.rows.iter().zip(&lines).enumerate().skip(first)
        {
            if y + wrapped.len() > room.max(y + 1) {
                break;
            }
            let selected = index == self.selected;
            let style = |value: Style| look.selected(selected, value);
            let rect = Rect::new(area.x, area.y + y as u16, area.width, wrapped.len() as u16);
            if selected {
                frame.buffer_mut().set_style(rect, look.selection());
            }
            let name = crate::board::view::fit(&row.member.name, name_width);
            for (line, words) in wrapped.iter().enumerate() {
                let lead = if line == 0 {
                    vec![
                        Span::styled(
                            if selected { "› " } else { "  " },
                            style(look.role(Role::Accent)),
                        ),
                        Span::styled(
                            format!("{} ", Mark::Offline.symbol()),
                            style(look.role(Role::Dim)),
                        ),
                        Span::styled(
                            format!("{name:<name_width$}  "),
                            style(look.role(Role::Text)),
                        ),
                    ]
                } else {
                    vec![Span::styled(
                        " ".repeat(indent),
                        style(look.role(Role::Text)),
                    )]
                };
                let mut spans = lead;
                spans.push(Span::styled(
                    crate::board::view::fit(words, inner.saturating_sub(indent)),
                    style(look.role(*role)),
                ));
                strip::paint_left(frame.buffer_mut(), line_at(y + line), Line::from(spans));
            }
            row_hits.push((rect, index));
            y += wrapped.len();
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
