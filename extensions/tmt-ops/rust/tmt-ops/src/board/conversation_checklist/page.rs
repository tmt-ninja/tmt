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
        let status = if let Some(notice) = &self.notice {
            notice.clone()
        } else if app.notes.writing(&self.key) {
            "Saving…".into()
        } else if let Some(item) = self
            .deleting()
            .and_then(|id| items.iter().find(|row| &row.id == id))
        {
            format!(
                "Delete “{}”? Enter deletes · Esc keeps it",
                crate::board::notes::single_line(&item.title)
            )
        } else {
            String::new()
        };
        let area = if !status.is_empty() && area.height > 1 {
            let status_area = Rect::new(area.x, area.bottom() - 1, area.width, 1);
            strip::paint_left(
                frame.buffer_mut(),
                status_area,
                Line::styled(
                    crate::board::view::fit(&status, usize::from(status_area.width)),
                    look.role(Role::Waiting),
                ),
            );
            Rect {
                height: area.height - 1,
                ..area
            }
        } else {
            area
        };
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
                    let note = if app.bindings().contains_key("U") {
                        note.strip_prefix("U  ").unwrap_or(&note).to_owned()
                    } else {
                        note
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
                    let safe_title = crate::board::notes::single_line(&item.title);
                    let title = crate::board::view::fit(&safe_title, title_width);
                    let gap = if byline.is_empty() {
                        String::new()
                    } else {
                        " ".repeat(title_width.saturating_sub(title.width()))
                    };
                    let title_x = rect.x.saturating_add(prefix.width() as u16);
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
                            Span::raw(gap),
                            Span::styled(byline, look.role(Role::Muted)),
                        ]),
                    );
                    for (index, range) in crate::board::member_links::bare_urls(&safe_title)
                        .into_iter()
                        .enumerate()
                    {
                        let start = safe_title[..range.start].width();
                        let end = start + safe_title[range.clone()].width();
                        if end > title_width {
                            continue;
                        }
                        let url = safe_title[range].to_owned();
                        let hovered = self.hovered.borrow().as_ref()
                            == Some(&(item.id.as_str().to_owned(), index + 1));
                        for cell in start..end {
                            let x = title_x.saturating_add(cell as u16);
                            if x >= rect.right() {
                                break;
                            }
                            let hit = Rect::new(x, rect.y, 1, 1);
                            link_hits.push(super::surface::LinkHit {
                                area: hit,
                                row: item.id.as_str().into(),
                                link: index + 1,
                                url: url.clone(),
                            });
                            if hovered {
                                frame.buffer_mut()[(x, rect.y)].set_style(
                                    look.selection()
                                        .add_modifier(ratatui::style::Modifier::UNDERLINED),
                                );
                            }
                        }
                    }
                    geometry.push(RowGeometry {
                        id: item.id.as_str().into(),
                        lines: index..index + 1 + usize::from(item.reference.is_some()),
                        visible: Rect {
                            height: (1 + u16::from(item.reference.is_some()))
                                .min(area.bottom().saturating_sub(rect.y)),
                            ..rect
                        },
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
                        let hovered = selected.as_deref() == Some(item.id.as_str())
                            || self.hovered.borrow().as_ref()
                                == Some(&(item.id.as_str().to_owned(), 0));
                        for x in link_area.left()..link_area.right() {
                            link_hits.push(super::surface::LinkHit {
                                area: Rect::new(x, link_area.y, 1, 1),
                                row: item.id.as_str().into(),
                                link: 0,
                                url: url.clone(),
                            });
                            if hovered {
                                frame.buffer_mut()[(x, link_area.y)].set_style(
                                    look.selection()
                                        .add_modifier(ratatui::style::Modifier::UNDERLINED),
                                );
                            }
                        }
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
