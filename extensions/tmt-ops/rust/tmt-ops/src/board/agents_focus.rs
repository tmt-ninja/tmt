//! Selection-driven Agents focus over the acquired workspace and existing sessions.
use super::{
    app::{App, RowTarget},
    conversation, identity_line, input_field,
    overview::{cron_counts::CronCountScope, timers},
    section_rule, spark_row,
    stat_tiles::{self, Tile},
    state_cell, timer_rows,
    workspace::{OpsSquad, OpsTarget},
};
use crate::{config::Pane, look::Look};
use ratatui::{
    Frame,
    buffer::Buffer,
    layout::Rect,
    text::{Line, Span},
};
use tmt_cli_style::Role;
use tmt_tui::components::strip;

// Metadata yields before the one response viewport and admitted input.
fn line(frame: &mut Frame, area: Rect, y: &mut u16, text: Line<'static>) {
    if *y < area.bottom() {
        strip::paint_left(
            frame.buffer_mut(),
            Rect::new(area.x, *y, area.width, 1),
            text,
        );
        *y += 1;
    }
}
fn rule(frame: &mut Frame, app: &App, area: Rect, y: &mut u16, title: &str, note: Line<'static>) {
    if area.bottom().saturating_sub(*y) < 2 {
        *y = area.bottom();
        return;
    }
    if *y < area.bottom() {
        // The pane's top rule carries the Talk/Measure control.
        let line = Rect::new(area.x, *y, area.width, 1);
        let line = if *y == area.y {
            crate::board::talk_measure::paint(frame.buffer_mut(), app, line, None, 0)
        } else {
            line
        };
        section_rule::paint(frame.buffer_mut(), line, title, note, false, app.look());
        *y += 1;
    }
}
fn blank(area: Rect, y: &mut u16) {
    *y = y.saturating_add(1).min(area.bottom());
}
fn neutral(text: impl Into<String>, look: Look) -> Line<'static> {
    Line::styled(text.into(), look.role(Role::Muted))
}
fn token_label(reading: Option<super::rate::Reading>) -> String {
    reading.map_or_else(
        || "—".into(),
        |reading| {
            format!(
                "{}{}",
                if reading.partial { "~" } else { "" },
                crate::source::tokens(reading.tokens)
            )
        },
    )
}
fn member_state(app: &App, target: &OpsTarget, width: usize) -> Line<'static> {
    let Some(row) = app
        .workspace_snapshot()
        .and_then(|snapshot| super::workspace::member_target_row(&snapshot.roster, target))
    else {
        return neutral("—", app.look());
    };
    let Some(label) = app.activity_label(&row) else {
        return neutral("?", app.look());
    };
    let (primary, task, todo) =
        super::workspace::columns::activity_spans(app, &row, &label, width, false);
    Line::from_iter(primary.into_iter().chain(task).chain(todo))
}

fn share(reading: Option<super::rate::Reading>, total: Option<(u128, bool)>) -> String {
    reading
        .zip(total)
        .filter(|(_, (total, _))| *total > 0)
        .map_or_else(
            || "—".into(),
            |(reading, (total, partial))| {
                format!(
                    "{}{:.0}%",
                    if reading.partial || partial { "~" } else { "" },
                    reading.tokens as f64 / total as f64 * 100.0
                )
            },
        )
}

const TALK_WORK_TOGGLE: char = 'w';

#[derive(Clone, Copy)]
enum WorkControl {
    Toggle,
    Open,
    Move(ratatui::crossterm::event::KeyCode),
}

#[derive(Default)]
pub(super) struct TalkWork {
    target: Option<(OpsTarget, String)>,
    expanded: bool,
    toggle_hit: Option<Rect>,
    open_hit: Option<Rect>,
    section: Option<String>,
    section_visible: bool,
}

impl TalkWork {
    pub(super) fn clear_hits(&mut self) {
        self.toggle_hit = None;
        self.open_hit = None;
        self.section_visible = false;
    }

    #[cfg(test)]
    pub(super) fn captured_hits(&self) -> (Option<Rect>, Option<Rect>) {
        (self.toggle_hit, self.open_hit)
    }

    fn selected_section(&self, item: &super::work::Item) -> Option<usize> {
        let id = self.section.as_deref()?;
        item.sections.iter().position(|section| section.id == id)
    }

    fn matches(&self, member: &OpsTarget, item: &super::work::Item) -> bool {
        self.target
            .as_ref()
            .is_some_and(|(target, key)| target == member && key == &item.key)
    }
}

fn talk_work_item(app: &App) -> Option<(&OpsTarget, &super::work::Item, usize)> {
    use super::shell::{OpsTab, RightTab};
    if app.shell.tab != OpsTab::Agents
        || app.right_tab != RightTab::Talk
        || app.screen_mode()
        || app.workspace_retained_search_target().is_some()
        || !app.workspace_selection_visible()
    {
        return None;
    }
    let member = app.workspace.selected.as_ref()?;
    let OpsTarget::Member { identity_id, .. } = member else {
        return None;
    };
    let snapshot = app.workspace_snapshot()?;
    if !snapshot.rows.get(member)?["plainProgram"].is_null() {
        return None;
    }
    let list = app.work.list.as_ref()?;
    let (item, count) = list
        .bindings(&snapshot.roster)
        .get(identity_id.as_str())
        .copied()?;
    Some((member, item, count))
}

fn talk_work_action(app: &mut App, control: WorkControl) -> Option<super::app::Effect> {
    use super::app::Effect;
    let (member, item, _) = talk_work_item(app)?;
    let mut work = app.talk_work.borrow_mut();
    if !work.matches(member, item) {
        return None;
    }
    match control {
        WorkControl::Toggle if work.toggle_hit.is_some() => {
            work.expanded = !work.expanded;
            drop(work);
            app.invalidate_frame_geometry();
            Some(Effect::None)
        }
        WorkControl::Open if work.open_hit.is_some() && !app.work.stale && item.can_open => {
            let section = if work.section_visible {
                Some(work.selected_section(item)?)
            } else {
                None
            };
            Some(Effect::OpenWorkPage(item.open_target(section)))
        }
        WorkControl::Move(code) if work.section_visible => {
            use ratatui::crossterm::event::KeyCode;
            let selected = work.selected_section(item)?;
            let last = item.sections.len() - 1;
            let index = match code {
                KeyCode::Up => selected.saturating_sub(1),
                KeyCode::Down => (selected + 1).min(last),
                KeyCode::Home => 0,
                KeyCode::End => last,
                _ => return None,
            };
            work.section = Some(item.sections[index].id.clone());
            drop(work);
            app.invalidate_frame_geometry();
            Some(Effect::None)
        }
        _ => None,
    }
}

pub(super) fn talk_work_key(
    app: &mut App,
    key: ratatui::crossterm::event::KeyEvent,
) -> Option<super::app::Effect> {
    use ratatui::crossterm::event::{KeyCode, KeyEventKind};
    if !key.modifiers.is_empty()
        || key.kind != KeyEventKind::Press
        || app.focused() != Pane::Replies
    {
        return None;
    }
    match key.code {
        KeyCode::Char(TALK_WORK_TOGGLE) => talk_work_action(app, WorkControl::Toggle),
        KeyCode::Enter | KeyCode::Char('o') => talk_work_action(app, WorkControl::Open),
        KeyCode::Up | KeyCode::Down | KeyCode::Home | KeyCode::End => {
            talk_work_action(app, WorkControl::Move(key.code))
        }
        KeyCode::Esc if app.talk_work.borrow().expanded => {
            let (member, item, _) = talk_work_item(app)?;
            if !app.talk_work.borrow().matches(member, item) {
                return None;
            }
            app.talk_work.borrow_mut().expanded = false;
            app.invalidate_frame_geometry();
            Some(super::app::Effect::None)
        }
        _ => None,
    }
}

pub(super) fn talk_work_mouse(
    app: &mut App,
    event: ratatui::crossterm::event::MouseEvent,
) -> Option<super::app::Effect> {
    use ratatui::crossterm::event::{MouseButton, MouseEventKind};
    if event.kind != MouseEventKind::Down(MouseButton::Left) {
        return None;
    }
    let point = (event.column, event.row).into();
    let control = {
        let work = app.talk_work.borrow();
        if work.toggle_hit.is_some_and(|rect| rect.contains(point)) {
            WorkControl::Toggle
        } else if work.open_hit.is_some_and(|rect| rect.contains(point)) {
            WorkControl::Open
        } else {
            return None;
        }
    };
    talk_work_action(app, control)
}

fn paint_talk_work(frame: &mut Frame, app: &App, area: Rect, y: &mut u16) {
    use super::work::Status;
    use unicode_width::UnicodeWidthStr;

    let Some((member, item, count)) = talk_work_item(app) else {
        *app.talk_work.borrow_mut() = TalkWork::default();
        return;
    };
    if *y >= area.bottom() {
        return;
    }
    let mut work = app.talk_work.borrow_mut();
    if !work.matches(member, item) {
        *work = TalkWork {
            target: Some((member.clone(), item.key.clone())),
            ..TalkWork::default()
        };
    }

    let room = area.bottom() - *y;
    let toggle = if work.expanded { "Collapse" } else { "Expand" };
    let hint = format!(" {TALK_WORK_TOGGLE} {toggle}");
    let hint_width = hint.width() as u16;
    let show_toggle = room >= 4 && area.width >= hint_width + 24;
    let expanded = show_toggle && work.expanded;
    let marker = if expanded { "▾" } else { "▸" };
    let progress = item.progress.map_or_else(
        || "—".to_owned(),
        |progress| format!("{}/{}", progress.done, progress.total),
    );
    let more = if count > 1 {
        format!(" +{}", count - 1)
    } else {
        String::new()
    };
    let stale = if app.work.stale {
        let age = super::work::age_label(app.work.last_read_at, crate::status::now_ms() as i64);
        format!(" · stale · read {age} ago")
    } else {
        String::new()
    };
    let role = match item.status {
        Status::NeedsYou => Role::Waiting,
        Status::Blocked => Role::Blocked,
        _ => Role::Muted,
    };
    if show_toggle {
        let hit = Rect::new(area.right() - hint_width, *y, hint_width, 1);
        strip::paint_left(
            frame.buffer_mut(),
            hit,
            Line::styled(hint, app.look().role(Role::Link)),
        );
        if !app.modal_open() {
            work.toggle_hit = Some(hit);
        }
    }
    let summary = Rect::new(
        area.x,
        area.y,
        area.width - if show_toggle { hint_width } else { 0 },
        area.height,
    );
    line(
        frame,
        summary,
        y,
        Line::from(vec![
            Span::styled(
                format!(" {marker} Work {}  ", item.number.as_deref().unwrap_or("—")),
                app.look().role(Role::Text),
            ),
            Span::styled(item.status.marked_label(), app.look().role(role)),
            Span::styled(
                format!("  {progress}{more}{stale}"),
                app.look().role(Role::Muted),
            ),
        ]),
    );
    if !expanded {
        return;
    }

    let heading = if app.focused() == Pane::Replies && item.sections.len() > 1 {
        " WORK DETAILS · ↑↓ select section"
    } else {
        " WORK DETAILS"
    };
    line(frame, area, y, neutral(heading, app.look()));
    // Keep one row for the rule even when the drawer reaches its height limit.
    let details = Rect {
        x: area.x + 2,
        width: area.width - 2,
        height: area.height - 1,
        ..area
    };
    let can_open = !app.work.stale && item.can_open;
    let show_more = item.sections_omitted || (item.progress.is_some() && item.sections.is_empty());
    let remaining = details.bottom() - *y;
    let section_rows =
        usize::from(remaining.saturating_sub(u16::from(can_open) + u16::from(show_more)));
    let more_sections = item.sections.len() > section_rows;
    let section_rows = section_rows.saturating_sub(usize::from(more_sections && !show_more));
    let next = item
        .sections
        .iter()
        .position(|section| section.state != Status::Done);
    let selected = work
        .selected_section(item)
        .or(next)
        .or_else(|| (!item.sections.is_empty()).then_some(0));
    work.section = selected.map(|index| item.sections[index].id.clone());
    work.section_visible = selected.is_some() && section_rows > 0 && !app.modal_open();
    let start = selected
        .unwrap_or(0)
        .saturating_sub(section_rows.saturating_sub(1));
    for (offset, section) in item
        .sections
        .iter()
        .skip(start)
        .take(section_rows)
        .enumerate()
    {
        let index = start + offset;
        let pointer = if next == Some(index) { " ← next" } else { "" };
        let head = format!(" {} ", section.state.mark());
        let title = super::view::fit(
            &section.title,
            usize::from(details.width).saturating_sub(head.width() + pointer.width()),
        );
        line(
            frame,
            details,
            y,
            Line::styled(
                format!("{head}{}{pointer}", title.trim_end()),
                app.look().selected(
                    selected == Some(index) && app.focused() == Pane::Replies,
                    app.look().role(Role::Muted),
                ),
            ),
        );
    }
    if (show_more || more_sections) && details.bottom() - *y > u16::from(can_open) {
        line(
            frame,
            details,
            y,
            neutral(" More sections in Colab", app.look()),
        );
    }
    let visible_section = selected.filter(|_| section_rows > 0);
    let open = format!(" o {}", item.open_label(visible_section));
    if can_open && *y < details.bottom() && details.width >= open.width() as u16 {
        if !app.modal_open() {
            work.open_hit = Some(Rect::new(details.x, *y, open.width() as u16, 1));
        }
        line(
            frame,
            details,
            y,
            Line::styled(open, app.look().role(Role::Link)),
        );
    }
    line(
        frame,
        area,
        y,
        section_rule::line(
            "",
            Line::default(),
            usize::from(area.width),
            false,
            app.look(),
        ),
    );
}

pub(in crate::board) fn render(frame: &mut Frame, app: &App, area: Rect) {
    if area.is_empty() {
        return;
    }
    // Non-message editors retain their existing modal owner and bottom band.
    let area = if app.input.is_some()
        && app.composer_projection().is_none()
        && app.conversation_input_area().is_some()
    {
        let height =
            super::view::waiting::input_lines(app, area, input_field::padded(frame.area().height))
                .min(usize::from(area.height)) as u16;
        app.input_band.set(Some(Rect::new(
            area.x,
            area.bottom() - height,
            area.width,
            height,
        )));
        Rect {
            height: area.height - height,
            ..area
        }
    } else {
        area
    };
    if area.is_empty() {
        return;
    }
    if app.show_saved_summary(frame, area) {
        return;
    }
    if app.selected_terminal().is_some() {
        super::member_terminals::panel::render(frame, app, area);
        return;
    }
    let Some(snapshot) = app.workspace_snapshot() else {
        return;
    };
    let retained = app.workspace_retained_search_target();
    if retained.is_none() && !app.workspace_selection_visible() {
        let mut y = area.y;
        rule(frame, app, area, &mut y, "Selection", Line::default());
        line(
            frame,
            area,
            &mut y,
            neutral(
                super::workspace::render::selection_message(app.workspace_selection_state()),
                app.look(),
            ),
        );
        app.conversation.borrow_mut().active = None;
        return;
    }
    let Some(selected) = retained.or(app.workspace.selected.as_ref()) else {
        return;
    };
    let raw = snapshot.rows.get(selected);
    let title = raw
        .and_then(|row| row["name"].as_str())
        .unwrap_or("Selection unavailable");
    let squad = match selected {
        OpsTarget::Squad(room)
        | OpsTarget::Member {
            room_id: Some(room),
            ..
        } => snapshot
            .roster
            .squads
            .iter()
            .find(|squad| &squad.room_id == room),
        _ => None,
    };
    let recipient = if retained.is_some() {
        app.workspace_preview_member()
    } else {
        app.workspace_message_target()
    }
    .map(RowTarget::Workspace);
    let row = recipient.as_ref().and_then(|target| app.target_row(target));
    let note = if matches!(selected, OpsTarget::Squad(_)) {
        squad.map_or_else(
            || neutral("unavailable", app.look()),
            |squad| {
                let members = squad
                    .members
                    .iter()
                    .collect::<std::collections::BTreeSet<_>>()
                    .len();
                let waiting = squad
                    .member_states
                    .values()
                    .filter(|state| state.waiting)
                    .count();
                let partial = if squad.observation == super::workspace::OpsObservation::Complete {
                    ""
                } else {
                    "~"
                };
                let mut spans = vec![Span::styled(
                    format!(
                        "{partial}{members} {}",
                        if members == 1 { "member" } else { "members" }
                    ),
                    app.look().role(Role::Muted),
                )];
                if waiting > 0 {
                    spans.push(Span::raw(" · "));
                    spans.push(state_cell::mark(Some("waiting"), app.look()));
                    spans.push(Span::styled(
                        format!(" {partial}{waiting} waiting"),
                        app.look().role(Role::Muted),
                    ));
                }
                Line::from(spans)
            },
        )
    } else {
        member_state(app, selected, usize::from(area.width.saturating_sub(8)))
    };
    let member_header = matches!(selected, OpsTarget::Member { .. }) && raw.is_some();
    let content_y = if let Some(row) = raw.filter(|_| member_header) {
        member::render_header(frame, app, area, title, row, selected, squad)
    } else {
        let title_rule = crate::board::talk_measure::paint(
            frame.buffer_mut(),
            app,
            Rect {
                height: area.height.min(1),
                ..area
            },
            Some(selected),
            section_rule::needed(title, note.width()),
        );
        if matches!(selected, OpsTarget::Member { .. })
            && let Some(area) = section_rule::note_area(title, note.width(), title_rule)
        {
            app.push_unread_row_hit(area, selected);
        }
        section_rule::paint(
            frame.buffer_mut(),
            title_rule,
            title,
            note,
            app.focused() == Pane::Replies,
            app.look(),
        );
        area.y.saturating_add(1).min(area.bottom())
    };
    if app.right_tab == crate::board::shell::RightTab::Talk
        && app.input.is_none()
        && let OpsTarget::Member { identity_id, .. } = selected
        && snapshot
            .forms
            .as_ref()
            .is_some_and(|forms| forms.iter().any(|form| &form.identity_id == identity_id))
    {
        let mut lines = Vec::new();
        let mut push = |text: &str| {
            let text = super::notes::sanitize(text);
            for wrapped in super::notes::wrap(&text, usize::from(area.width.saturating_sub(2))) {
                lines.push(neutral(format!(" {wrapped}"), app.look()));
            }
        };
        for form in snapshot
            .forms
            .iter()
            .flatten()
            .filter(|form| &form.identity_id == identity_id)
        {
            push(match (snapshot.forms_stale, form.kind.as_str()) {
                (true, "question") => "◆ Question form · stale",
                (true, "permission") => "◆ Permission form · stale",
                (true, _) => "◆ Plan approval · stale",
                (false, "question") => "◆ Question form",
                (false, "permission") => "◆ Permission form",
                (false, _) => "◆ Plan approval",
            });
            if let Some(message) = app.provider_answer.message(form) {
                push(message);
            }
            if snapshot.forms_stale {
                push(if form.truncated {
                    "Last observed · current status unavailable · truncated, read-only"
                } else {
                    "Last observed · current status unavailable"
                });
            }
            if form.truncated && !snapshot.forms_stale {
                push("Truncated · read-only");
            }
            let jump_key = super::view::footer::effective_key(
                app,
                &app.workspace_bindings(),
                crate::action::Verb::Jump,
                "z",
            );
            let terminal_available = raw.is_some_and(|row| {
                (row["pane"]["location"]["host"] == super::new_member::model::BUILT_IN_HOST
                    && row["presence"] == "active")
                    || super::overview::actions::host(row, app.invoker_tmux).is_ok()
            });
            let check = snapshot.forms_stale || app.provider_answer.terminal_only(form);
            let hint = match (check, jump_key, terminal_available) {
                (true, Some(key), true) => format!(
                    "{} jump · check the terminal",
                    super::view::footer::key_label(&key)
                ),
                (true, _, _) => "Check the terminal · jump unavailable.".into(),
                (false, Some(key), true) if app.provider_answer.eligible(form) => format!(
                    "{} jump · answer here or in the terminal",
                    super::view::footer::key_label(&key)
                ),
                (false, _, _) if app.provider_answer.eligible(form) => "Answer from Talk.".into(),
                (false, Some(key), true) => format!(
                    "{} jump · answer in terminal",
                    super::view::footer::key_label(&key)
                ),
                (false, _, _) => "Answer in terminal · jump unavailable.".into(),
            };
            push(&hint);
            for question in &form.questions {
                if let Some(header) = &question.header {
                    push(header);
                }
                push(&question.text);
                for option in &question.options {
                    let description = option
                        .description
                        .as_ref()
                        .map_or_else(String::new, |description| format!(" · {description}"));
                    push(&format!("  • {}{description}", option.label));
                }
                push(&format!(
                    "{} choice{}",
                    question.choice,
                    if question.free_text {
                        " · Other text allowed"
                    } else {
                        ""
                    }
                ));
            }
            if let Some(tool) = &form.tool {
                push(&format!("{} · {}", tool.name, tool.summary));
            }
            if let Some(plan) = &form.plan {
                push(plan);
            }
        }
        app.conversation.borrow_mut().active = None;
        let action = app
            .provider_answer_hint()
            .filter(|_| area.bottom().saturating_sub(content_y) >= 2);
        if let Some(label) = action {
            let hit = Rect::new(
                area.x + 1,
                content_y,
                (label.chars().count() as u16).min(area.width.saturating_sub(1)),
                1,
            );
            if !hit.is_empty() {
                if !app.modal_open() {
                    app.provider_answer.action_hit.set(Some(hit));
                }
                tmt_tui::components::strip::paint_left(
                    frame.buffer_mut(),
                    hit,
                    ratatui::text::Line::styled(label, app.look().role(tmt_cli_style::Role::Link)),
                );
            }
        }
        let body_top = content_y + u16::from(action.is_some());
        let body = Rect::new(
            area.x,
            body_top,
            area.width,
            area.bottom().saturating_sub(body_top),
        );
        app.scrolls
            .show(frame, Pane::Replies, body, &lines, app.look());
        return;
    }
    if app.right_tab == crate::board::shell::RightTab::Checklist
        && let Some(controller) = &app.notes_overlay
        && raw.is_some()
    {
        let y = content_y;
        controller.render_page(
            frame,
            app,
            Rect::new(area.x, y, area.width, area.bottom().saturating_sub(y)),
        );
        return;
    }
    // A member running a plain program has no chat: a message would run as a command (#5770).
    let admitted_input = retained.is_none()
        && row.is_none_or(|row| row["plainProgram"].is_null())
        && app.composer_projection().is_some_and(|projection| {
            projection.key.is_some() && (projection.focused || app.composer_start().is_some())
        });
    let input_rows = admitted_input.then(|| {
        app.composer_rows(
            area.width.saturating_sub(input_field::GUTTER * 2),
            input_field::padded(frame.area().height),
        )
    });
    let metadata = conversation::layout::talk_metadata(area, content_y, input_rows);
    let mut y = metadata.y;
    match selected {
        OpsTarget::DigestAll
        | OpsTarget::Hidden
        | OpsTarget::Terminal { .. }
        | OpsTarget::LocalTerminals
        | OpsTarget::SavedTerminal(_) => {}
        OpsTarget::Member { .. } => {
            paint_talk_work(frame, app, metadata, &mut y);
            if let Some(row) = raw
                && super::conversation_checklist::Key::of(selected).is_none()
                && let Some(link) = conversation::link_preview(app, row, &app.workspace_bindings())
            {
                line(
                    frame,
                    metadata,
                    &mut y,
                    neutral(format!(" link {}", link.value), app.look()),
                );
            }
        }
        OpsTarget::Squad(_) => squad::render(frame, app, metadata, &mut y, squad, row),
        OpsTarget::Pool => {
            line(
                frame,
                metadata,
                &mut y,
                neutral(
                    " Common pool · select a member to read its exchanges.",
                    app.look(),
                ),
            );
            blank(metadata, &mut y);
        }
    }
    let remaining = area.bottom().saturating_sub(y);
    if remaining == 0 {
        return;
    }
    if !member_header && y == area.y + 1 {
        // At the smallest heights metadata has yielded entirely. The optional
        // exchange rule yields too, keeping one gap below the focus title.
        blank(area, &mut y);
    } else if !member_header || app.screen_mode() {
        let shown = recipient
            .as_ref()
            .filter(|_| app.screen_mode() && retained.is_none());
        rule(
            frame,
            app,
            area,
            &mut y,
            &shown.map_or_else(
                || "Conversation".to_owned(),
                |target| conversation::screen::title(app, target, usize::from(area.width)),
            ),
            recipient
                .as_ref()
                .and_then(|target| app.conversation_spinner(target))
                .map_or_else(Line::default, |glyph| neutral(glyph, app.look())),
        );
    }
    let Some(target) = recipient else {
        line(
            frame,
            area,
            &mut y,
            neutral(" No current recipient observed.", app.look()),
        );
        app.conversation.borrow_mut().active = None;
        return;
    };
    let surface = conversation::exchange::Surface {
        target,
        interactive: retained.is_none(),
    };
    let available = area.bottom().saturating_sub(y);
    let input = if admitted_input {
        app.composer_rows(
            area.width.saturating_sub(input_field::GUTTER * 2),
            input_field::padded(frame.area().height),
        )
        .min(available)
    } else {
        0
    };
    let gap = u16::from(input > 0 && available > input);
    if app.screen_mode() && retained.is_none() {
        // The live screen takes the exchanges' place; the composer below stays.
        conversation::screen::render(
            frame,
            app,
            Rect::new(area.x, y, area.width, available.saturating_sub(input + gap)),
            &surface.target,
        );
    } else {
        let height = conversation::exchange::desired_height(app, area.width, &surface)
            .min(available.saturating_sub(input + gap));
        conversation::exchange::render(
            frame,
            app,
            Rect::new(area.x, y, area.width, height),
            &surface,
        );
    }
    if admitted_input {
        app.input_band.set(Some(Rect::new(
            area.x + area.width.min(input_field::GUTTER),
            area.bottom() - input,
            area.width.saturating_sub(input_field::GUTTER * 2),
            input,
        )));
    }
}

pub(in crate::board) mod member;
mod squad;

#[cfg(test)]
pub(in crate::board) mod tests;
