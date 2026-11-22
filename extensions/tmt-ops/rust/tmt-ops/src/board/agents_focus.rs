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
    let reserved = if admitted_input {
        app.composer_rows(
            area.width.saturating_sub(input_field::GUTTER * 2),
            input_field::padded(frame.area().height),
        ) + 3
    } else {
        2
    };
    let metadata = Rect::new(
        area.x,
        content_y,
        area.width,
        area.bottom()
            .saturating_sub(content_y)
            .saturating_sub(reserved),
    );
    let mut y = metadata.y;
    match selected {
        OpsTarget::DigestAll
        | OpsTarget::Hidden
        | OpsTarget::Terminal { .. }
        | OpsTarget::LocalTerminals
        | OpsTarget::SavedTerminal(_) => {}
        OpsTarget::Member { .. } => {
            if let Some(row) = raw {
                if super::conversation_checklist::Key::of(selected).is_none()
                    && let Some(link) =
                        conversation::link_preview(app, row, &app.workspace_bindings())
                {
                    line(
                        frame,
                        metadata,
                        &mut y,
                        neutral(format!(" link {}", link.value), app.look()),
                    );
                }
                if !app.work.stale
                    && let OpsTarget::Member { identity_id, .. } = selected
                    && let Some(list) = &app.work.list
                    && let Some((item, count)) =
                        list.bindings(&snapshot.roster).get(identity_id.as_str())
                {
                    let detail = item
                        .next
                        .as_ref()
                        .map_or(String::new(), |text| format!(" · {text}"));
                    line(
                        frame,
                        metadata,
                        &mut y,
                        neutral(
                            format!(" Work · {}{detail}", super::work::chip(item, *count)),
                            app.look(),
                        ),
                    );
                }
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
mod tests;
