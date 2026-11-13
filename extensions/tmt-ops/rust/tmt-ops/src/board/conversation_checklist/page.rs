//! Selected member's Checklist in the Agents right pane.
use super::{overlay::Controller, rows::Row};
use crate::board::{app::App, section_rule};
use ratatui::{
    Frame,
    layout::Rect,
    text::{Line, Span},
};
use tmt_cli_style::Role;
use tmt_tui::components::{
    ListFrame, ModalAreas, RowGeometry, strip,
    surface::{FrameMap, Hit},
};
use unicode_width::UnicodeWidthStr;

enum Visual<'a> {
    Heading(&'static str, usize),
    Item(&'a Row),
    Link(&'a Row),
}

impl Controller {
    pub(in crate::board) fn render_page(&self, frame: &mut Frame, app: &App, area: Rect) {
        if area.is_empty() {
            return;
        }
        let look = app.look();
        if app.notes.draft(&self.key).is_some() {
            self.render(frame, app, look, area);
            return;
        }
        if app.notes.preview(&self.key).is_none() {
            *self.ask_hit.borrow_mut() = None;
            let message = match app.notes.summary(&self.key) {
                Some(super::Summary::Unavailable(words)) => words.as_str(),
                _ => "Reading the checklist…",
            };
            strip::paint_left(
                frame.buffer_mut(),
                Rect { height: 1, ..area },
                Line::styled(message.to_owned(), look.role(Role::Muted)),
            );
            self.ui.borrow_mut().invalidate();
            return;
        }
        let items = self.items(&app.notes);
        let todo = items.iter().filter(|item| !item.completed).count();
        let done = items.len().saturating_sub(todo);
        let mut visual = vec![Visual::Heading("Todo", todo)];
        for item in items.iter().filter(|item| !item.completed) {
            visual.push(Visual::Item(item));
            if item.reference.is_some() {
                visual.push(Visual::Link(item));
            }
        }
        visual.push(Visual::Heading("Done", done));
        for item in items.iter().filter(|item| item.completed) {
            visual.push(Visual::Item(item));
            if item.reference.is_some() {
                visual.push(Visual::Link(item));
            }
        }
        let list = Self::list_rows(&items);
        let mut ui = self.ui.borrow_mut();
        ui.reconcile(list.clone());
        if let Some(id) = self.reveal.borrow_mut().take()
            && items.iter().any(|row| row.id == id)
        {
            ui.select(id.as_str());
        }
        let selected = ui.picker.list.selected().map(str::to_owned);
        let selected_range = selected
            .as_ref()
            .and_then(|id| {
                visual
                    .iter()
                    .position(|line| matches!(line, Visual::Item(item) if item.id.as_str() == id))
            })
            .map(|i| i..i + 1);
        ui.picker
            .list
            .scroll
            .update(area, visual.len(), selected_range);
        let offset = ui.picker.list.scroll.offset();
        let mut geometry = Vec::new();
        *self.ask_hit.borrow_mut() = None;
        let mut hits = Vec::new();
        let mut link_hits = Vec::new();
        for (index, visual) in visual
            .iter()
            .enumerate()
            .skip(offset)
            .take(usize::from(area.height))
        {
            let y = area.y + (index - offset) as u16;
            let rect = Rect::new(area.x, y, area.width, 1);
            match visual {
                Visual::Heading(title, count) => {
                    let heading = format!("{title} · {count}");
                    let note = if *title == "Todo" {
                        self.key
                            .member()
                            .and_then(|id| {
                                let name = app
                                    .workspace_snapshot()?
                                    .roster
                                    .members
                                    .get(id)?
                                    .name
                                    .as_str();
                                Some(app.notes.ask_caption(
                                    id,
                                    &crate::board::notes::single_line(name),
                                    crate::status::now_ms(),
                                ))
                            })
                            .unwrap_or_default()
                    } else {
                        String::new()
                    };
                    let note = Line::styled(note, look.role(Role::Muted));
                    if !note.spans.is_empty() {
                        *self.ask_hit.borrow_mut() =
                            section_rule::note_area(&heading, note.width(), rect);
                    }
                    section_rule::paint(frame.buffer_mut(), rect, &heading, note, false, look);
                }
                Visual::Item(item) => {
                    let current = selected.as_deref() == Some(item.id.as_str());
                    let mark = if item.completed { "✓" } else { "○" };
                    let prefix = format!(" {} {mark} ", if current { "›" } else { " " });
                    let byline = if item.byline.is_empty() {
                        String::new()
                    } else {
                        format!("  {}", item.byline)
                    };
                    let available = usize::from(rect.width).saturating_sub(prefix.width());
                    let byline = if byline.width() <= available {
                        byline
                    } else {
                        String::new()
                    };
                    let title_width = available.saturating_sub(byline.width());
                    let title = crate::board::view::fit(
                        &crate::board::notes::single_line(&item.title),
                        title_width,
                    );
                    let style = look.role(if item.completed {
                        Role::Dim
                    } else {
                        Role::Text
                    });
                    strip::paint_left(
                        frame.buffer_mut(),
                        rect,
                        Line::from(vec![
                            Span::styled(prefix, style),
                            Span::styled(title, style),
                            Span::styled(byline, look.role(Role::Muted)),
                        ]),
                    );
                    geometry.push(RowGeometry {
                        id: item.id.as_str().into(),
                        lines: index..index + 1 + usize::from(item.reference.is_some()),
                        visible: rect,
                    });
                }
                Visual::Link(item) => {
                    let text = format!("     ↗ {}", item.address);
                    strip::paint_left(
                        frame.buffer_mut(),
                        rect,
                        Line::styled(
                            crate::board::view::fit(&text, usize::from(rect.width)),
                            look.role(if item.completed {
                                Role::Dim
                            } else {
                                Role::Unread
                            }),
                        ),
                    );
                    if let Some(url) = &item.reference {
                        let link_area = Rect::new(
                            rect.x.saturating_add(5).min(rect.right()),
                            rect.y,
                            rect.width
                                .saturating_sub(5)
                                .min(text.width().saturating_sub(5) as u16),
                            1,
                        );
                        link_hits.push(super::surface::LinkHit {
                            area: link_area,
                            row: item.id.as_str().into(),
                            link: 0,
                            url: url.clone(),
                        });
                        hits.push(Hit {
                            rect: link_area,
                            id: vec!["link".into()],
                            row_id: Some(item.id.as_str().into()),
                        });
                    }
                }
            }
        }
        *self.link_hits.borrow_mut() = link_hits;
        ui.frame = Some(FrameMap {
            areas: ModalAreas {
                outer: area,
                content: area,
                footer: Rect::default(),
                status: Rect::default(),
                position: Rect::default(),
            },
            hits,
            list: Some(ListFrame {
                rows: list,
                geometry,
                viewport: area,
                offset,
            }),
            query: Rect::default(),
        });
    }
}
