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

fn visual_row_start(visual: &[Visual<'_>], mut index: usize, id: &str) -> usize {
    while index > 0 && visual[index - 1].row_id() == Some(id) {
        index -= 1;
    }
    index
}
fn visual_row_end(visual: &[Visual<'_>], mut index: usize, id: &str) -> usize {
    while index < visual.len() && visual[index].row_id() == Some(id) {
        index += 1;
    }
    index
}
impl Visual<'_> {
    fn row_id(&self) -> Option<&str> {
        match self {
            Self::Heading(..) | Self::Form(..) | Self::Kind => None,
            Self::Item(row, ..) | Self::Link(row, ..) => Some(row.id.as_str()),
        }
    }
}

enum Visual<'a> {
    Heading(&'static str, usize),
    Form(String, Role),
    Kind,
    Item(&'a Row, String, usize, bool),
    Link(&'a Row, String, bool),
}

fn append_form(visual: &mut Vec<Visual<'_>>, draft: &super::Draft, notice: Option<&str>) {
    if draft.seed.is_some() {
        visual.push(Visual::Kind);
    }
    for (field, label) in [(0, "Title"), (1, "Link")] {
        let focused = draft.field() == Some(field);
        let value = if focused {
            super::surface::with_caret(draft, field)
        } else {
            draft.text(field).to_owned()
        };
        visual.push(Visual::Form(
            crate::board::notes::single_line(&format!("  {label:<5} › {value}")),
            if focused { Role::Accent } else { Role::Muted },
        ));
    }
    if let Some(seed) = &draft.seed {
        visual.push(Visual::Form(
            crate::board::notes::single_line(&format!("  From    {}", seed.source.label())),
            Role::Muted,
        ));
    }
    if draft.reopened {
        visual.push(Visual::Form(
            if draft.on_discard() {
                "› Discard"
            } else {
                "  Discard"
            }
            .into(),
            if draft.on_discard() {
                Role::Accent
            } else {
                Role::Muted
            },
        ));
    }
    if let Some(notice) = notice {
        visual.push(Visual::Form(
            crate::board::notes::single_line(&format!("  {notice}")),
            Role::Waiting,
        ));
    }
}

impl Controller {
    pub(in crate::board) fn render_page(&self, frame: &mut Frame, app: &App, area: Rect) {
        if area.is_empty() {
            return;
        }
        let look = app.look();
        let draft = app.notes.draft(&self.key);
        let loaded = app.notes.preview(&self.key).is_some();
        if !loaded && draft.is_none() {
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
        let status = if draft.is_some() {
            String::new()
        } else if let Some(notice) = &self.notice {
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
        let mut visual = Vec::new();
        for (heading, count, completed) in [("Todo", todo, false), ("Done", done, true)] {
            if !loaded && completed {
                continue;
            }
            if loaded {
                visual.push(Visual::Heading(heading, count));
            } else {
                visual.push(Visual::Form("Reading the checklist…".into(), Role::Muted));
            }
            if !completed
                && draft.is_some_and(|draft| match &draft.aim {
                    super::draft::Aim::Add => true,
                    super::draft::Aim::Edit { item, .. } => {
                        !items.iter().any(|row| &row.id == item)
                    }
                })
            {
                append_form(&mut visual, draft.unwrap(), self.notice.as_deref());
            }
            for item in items.iter().filter(|item| item.completed == completed) {
                if let Some(draft) = draft
                    && matches!(&draft.aim, super::draft::Aim::Edit { item: id, .. } if id == &item.id)
                {
                    if draft.differs_from_original(&item.title, item.reference.as_deref()) {
                        visual.push(Visual::Form(
                            format!(
                                "  Current: {}",
                                crate::board::notes::single_line(&item.title)
                            ),
                            Role::Muted,
                        ));
                    }
                    append_form(&mut visual, draft, self.notice.as_deref());
                    continue;
                }
                let byline_width = if item.byline.is_empty() {
                    0
                } else {
                    item.byline.width() + 2
                };
                let available = usize::from(area.width).saturating_sub(5);
                let reserved = if byline_width + 8 <= available {
                    byline_width
                } else {
                    0
                };
                let width = available.saturating_sub(reserved).max(1) as u16;
                let title = crate::board::notes::single_line(&item.title);
                let mut cursor = 0;
                for (index, line) in
                    tmt_tui::text::lines(&title, width, tmt_tui::style::TextFlow::Wrap)
                        .into_iter()
                        .enumerate()
                {
                    let text = line.trim_end().to_owned();
                    let start = title[cursor..]
                        .find(&text)
                        .map_or(cursor, |offset| cursor + offset);
                    cursor = start.saturating_add(text.len()).min(title.len());
                    visual.push(Visual::Item(item, text, start, index == 0));
                }
                if item.reference.is_some() {
                    let width = area.width.saturating_sub(7).max(1);
                    for (index, line) in
                        tmt_tui::text::lines(&item.address, width, tmt_tui::style::TextFlow::Wrap)
                            .into_iter()
                            .enumerate()
                    {
                        visual.push(Visual::Link(item, line.trim_end().to_owned(), index == 0));
                    }
                }
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
        let selected_range = visual
            .iter()
            .position(|line| matches!(line, Visual::Form(..)))
            .map(|i| i..i + 1)
            .or_else(|| {
                selected
                    .as_ref()
                    .and_then(|id| {
                        visual.iter().position(
                    |line| matches!(line, Visual::Item(item, _, _, true) if item.id.as_str() == id),
                )
                    })
                    .map(|i| i..i + 1)
            });
        ui.picker
            .list
            .scroll
            .update(area, visual.len(), selected_range);
        let offset = ui.picker.list.scroll.offset();
        let mut geometry = Vec::new();
        *self.ask_hit.borrow_mut() = None;
        self.kind_hits.borrow_mut().clear();
        let mut hits = Vec::new();
        let mut link_hits = Vec::new();
        for (index, line) in visual
            .iter()
            .enumerate()
            .skip(offset)
            .take(usize::from(area.height))
        {
            let y = area.y + (index - offset) as u16;
            let rect = Rect::new(area.x, y, area.width, 1);
            match line {
                Visual::Kind => {
                    if let Some(draft) = draft {
                        self.paint_kind(frame, app, draft, rect, None);
                    }
                }
                Visual::Form(text, role) => {
                    strip::paint_left(
                        frame.buffer_mut(),
                        rect,
                        Line::styled(
                            crate::board::view::fit(text, usize::from(rect.width)),
                            look.role(*role),
                        ),
                    );
                }
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
                Visual::Item(item, title, start_byte, first) => {
                    let current = selected.as_deref() == Some(item.id.as_str());
                    let mark = if item.completed { "✓" } else { "○" };
                    let prefix = if *first {
                        format!(" {} {mark} ", if current { "›" } else { " " })
                    } else {
                        "     ".into()
                    };
                    let byline = if !first || item.byline.is_empty() {
                        String::new()
                    } else {
                        format!("  {}", item.byline)
                    };
                    let available = usize::from(rect.width).saturating_sub(prefix.width());
                    let byline = if byline.is_empty() || byline.width() + 8 <= available {
                        byline
                    } else {
                        String::new()
                    };
                    let title_width = available.saturating_sub(byline.width());
                    let safe_title = crate::board::notes::single_line(&item.title);
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
                            Span::styled(title.clone(), style),
                            Span::raw(gap),
                            Span::styled(byline, look.role(Role::Muted)),
                        ]),
                    );
                    for (index, range) in crate::board::member_links::bare_urls(&safe_title)
                        .into_iter()
                        .enumerate()
                    {
                        let part_end = start_byte.saturating_add(title.len());
                        let overlap_start = range.start.max(*start_byte);
                        let overlap_end = range.end.min(part_end);
                        if overlap_start >= overlap_end {
                            continue;
                        }
                        let start = safe_title[*start_byte..overlap_start].width();
                        let end = start + safe_title[overlap_start..overlap_end].width();
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
                    let start = visual_row_start(&visual, index, item.id.as_str());
                    let end = visual_row_end(&visual, index, item.id.as_str());
                    if geometry
                        .iter()
                        .all(|row: &RowGeometry| row.id != item.id.as_str())
                    {
                        geometry.push(RowGeometry {
                            id: item.id.as_str().into(),
                            lines: start..end,
                            visible: Rect {
                                height: (end - index)
                                    .min(usize::from(area.bottom().saturating_sub(rect.y)))
                                    as u16,
                                ..rect
                            },
                        });
                    }
                }
                Visual::Link(item, part, first) => {
                    if geometry
                        .iter()
                        .all(|row: &RowGeometry| row.id != item.id.as_str())
                    {
                        let start = visual_row_start(&visual, index, item.id.as_str());
                        let end = visual_row_end(&visual, index, item.id.as_str());
                        geometry.push(RowGeometry {
                            id: item.id.as_str().into(),
                            lines: start..end,
                            visible: Rect {
                                height: (end - index)
                                    .min(usize::from(area.bottom().saturating_sub(rect.y)))
                                    as u16,
                                ..rect
                            },
                        });
                    }
                    let text = format!("{}{}", if *first { "     ↗ " } else { "       " }, part);
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
