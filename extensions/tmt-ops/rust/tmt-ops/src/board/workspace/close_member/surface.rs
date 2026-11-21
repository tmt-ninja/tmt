//! The existing workspace overlay owns one shared Confirm dialog and its painted hits.
use super::*;
use crate::board::app::Overlay;
use ratatui::{Frame, layout::Rect, text::Line};
use tmt_cli_style::Role;
use tmt_tui::components::{Button, Dialog, DialogKind, Placement, strip};

/// One button of the close dialog; its position in [`actions`] is its slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Act {
    Delete,
    DeleteIdentity,
    Jump,
    Cancel,
    Close,
}

impl Act {
    fn label(self) -> &'static str {
        match self {
            Self::Delete => "Delete",
            Self::DeleteIdentity => "Delete identity",
            Self::Jump => "Jump to pane",
            Self::Cancel => "Cancel",
            Self::Close => "Close",
        }
    }
}

/// The primary action first, Cancel beside it.
pub(super) fn actions(draft: &Draft) -> Vec<Act> {
    if draft.stage == Stage::Pending {
        return vec![Act::Cancel];
    }
    match draft.close.as_ref().and_then(|c| c.result.as_ref()) {
        Some(Outcome::Refused { .. }) => vec![Act::DeleteIdentity, Act::Jump, Act::Cancel],
        Some(_) => vec![Act::Close],
        None => vec![Act::Delete, Act::Cancel],
    }
}

fn hints(draft: &Draft) -> &'static str {
    if draft.stage == Stage::Pending {
        return "Esc close";
    }
    match draft.close.as_ref().and_then(|c| c.result.as_ref()) {
        Some(Outcome::Refused { .. }) => "← ⏎ delete · z jump · Esc cancel",
        Some(_) => "Esc close",
        None if draft.review.focus == tmt_tui::components::Focus::Buttons(0) => {
            "⏎ delete · Esc cancel"
        }
        None => "← ⏎ delete · Esc cancel",
    }
}
fn text(draft: &Draft) -> Vec<(String, Role)> {
    let member = draft.member.as_ref().expect("frozen member");
    let mut rows = Vec::new();
    let mut push = |text: String, role| rows.push((text, role));
    if draft.stage == Stage::Pending {
        push(
            "◌ Checking and applying the reviewed operation…".into(),
            Role::Waiting,
        );
        push(
            "Closing this dialog keeps the operation running. Nothing is retried.".into(),
            Role::Muted,
        );
    } else if let Some(result) = draft.close.as_ref().and_then(|c| c.result.as_ref()) {
        match result {
            Outcome::Changed { pane_reason } => {
                push(
                    format!("✗ {} changed or was removed; reopen to retry.", member.name),
                    Role::Blocked,
                );
                push(
                    "No same-name successor is selected and nothing is retried.".into(),
                    Role::Muted,
                );
                if let Some(reason) = pane_reason {
                    push(format!("Pane left open · {reason}"), Role::Muted);
                }
            }
            Outcome::Refused {
                step,
                error,
                pane_reason,
            } => {
                push(
                    format!(
                        "✗ Could not {} {}",
                        if *step == Step::Stop {
                            "stop"
                        } else {
                            "delete"
                        },
                        member.name
                    ),
                    Role::Blocked,
                );
                let unavailable = *step == Step::Stop
                    && error.code == "RESUME_UNAVAILABLE"
                    && error.signalled == Some(false);
                if unavailable {
                    push(
                        "No recorded agent session · nothing was signalled.".into(),
                        Role::Text,
                    );
                    push("Delete may follow; Core checks it.".into(), Role::Text);
                } else if error.code == "AGENT_RUNNING" {
                    push(
                        "Still running or unproven · quit it in its pane, then Delete.".into(),
                        Role::Text,
                    );
                } else if *step == Step::Delete {
                    let stopped = pane_reason.is_some()
                        || matches!(
                            draft.operation.as_ref(),
                            Some(Change::CloseMember(Request {
                                mode: Mode::CloseAndDelete,
                                ..
                            }))
                        );
                    push(
                        format!(
                            "{}Deletion was not confirmed: {}",
                            if stopped { "Agent stopped. " } else { "" },
                            error.message
                        ),
                        Role::Blocked,
                    );
                    push(
                        "Delete asks Core to check again; nothing is retried automatically.".into(),
                        Role::Text,
                    );
                } else {
                    push(error.message.clone(), Role::Blocked);
                    push(
                        match error.signalled {
                            Some(true) => {
                                "A stop was requested · quit it in its pane, then Delete."
                            }
                            Some(false) => "Nothing was signalled.",
                            None => "Whether a stop was requested is unknown.",
                        }
                        .into(),
                        Role::Muted,
                    );
                    if error.signalled != Some(true) {
                        push("Delete may follow; Core checks it.".into(), Role::Text);
                    }
                }
                if let Some(reason) = pane_reason {
                    push(format!("Pane left open · {reason}"), Role::Muted);
                }
            }
            Outcome::Removed { .. } => unreachable!("removed closes the dialog"),
        }
    } else {
        push(
            format!("{} stops and leaves the board.", member.name),
            Role::Text,
        );
        push("Its conversation and notes are kept.".into(), Role::Text);
    }
    rows
}
pub(in crate::board::workspace) fn render(frame: &mut Frame, app: &App, draft: &Draft, body: Rect) {
    let close = draft.close.as_ref().expect("close dialog");
    let look = app.look();
    let compact = body.height < 8 || body.width < 34;
    let body = if compact { frame.area() } else { body };
    let acts = if compact {
        vec![Act::Cancel]
    } else {
        actions(draft)
    };
    let pane = app
        .references
        .agents
        .get(&draft.member.as_ref().unwrap().id)
        .is_some_and(|agent| agent.parameters["pane"].as_str().is_some());
    let make_dialog = |enabled: bool| Dialog {
        title: format!("Delete {}", draft.member.as_ref().unwrap().name),
        kind: DialogKind::Confirm,
        placement: Placement::Center,
        hints: if compact {
            String::new()
        } else {
            hints(draft).into()
        },
        buttons: acts
            .iter()
            .map(|act| match act {
                Act::Cancel | Act::Close => Button::secondary(act.label()),
                Act::Jump => Button::secondary(act.label()).enabled(enabled && pane),
                Act::Delete | Act::DeleteIdentity => Button::primary(act.label())
                    .destructive(true)
                    .enabled(enabled),
            })
            .collect(),
    };
    let probe = make_dialog(false).areas(body, [90, 30], false);
    let wide = |content: &[(String, Role)]| {
        let text = content
            .iter()
            .map(|(text, _)| unicode_width::UnicodeWidthStr::width(text.as_str()))
            .max()
            .unwrap_or(0);
        let title =
            unicode_width::UnicodeWidthStr::width(draft.member.as_ref().unwrap().name.as_str()) + 9;
        let dialog = make_dialog(false);
        let footer = if !compact && draft.stage == Stage::Review && close.result.is_none() {
            Dialog {
                hints: "← ⏎ delete · Esc cancel".into(),
                ..dialog
            }
            .footer_width()
        } else {
            dialog.footer_width()
        };
        let footer = usize::from(footer);
        (text.max(title).max(footer) + 4).min(90) as u16
    };
    let content = if compact {
        vec![("Enlarge to review · Esc close".into(), Role::Muted)]
    } else {
        text(draft)
    };
    let width = wide(&content);
    let lines: Vec<_> = content
        .into_iter()
        .flat_map(|(text, role)| {
            crate::board::notes::wrap(
                &super::super::render::safe(&text),
                usize::from(probe.content.width.min(width.saturating_sub(4))),
            )
            .into_iter()
            .map(move |line| (line, role))
        })
        .collect();
    let areas = make_dialog(false).areas(
        body,
        [
            width,
            lines.len().saturating_add(4).min(u16::MAX as usize) as u16,
        ],
        false,
    );
    let mut scroll = draft.scroll.borrow_mut();
    scroll.update(areas.content, lines.len(), None);
    let readable =
        !compact && areas.content.width >= 20 && lines.len() <= usize::from(areas.content.height);
    let dialog = make_dialog(readable);
    let mut hits = crate::board::buttons::paint_dialog(
        app,
        frame.buffer_mut(),
        &dialog,
        areas,
        &draft.review,
        Overlay::Workspace,
    );
    for (i, (line, role)) in lines
        .iter()
        .skip(scroll.offset())
        .take(usize::from(areas.content.height))
        .enumerate()
    {
        strip::paint_left(
            frame.buffer_mut(),
            Rect::new(
                areas.content.x,
                areas.content.y + i as u16,
                areas.content.width,
                1,
            ),
            Line::styled(line, look.role(*role)),
        );
    }
    if areas.position.height > 0 && scroll.limit() > 0 {
        strip::paint_left(
            frame.buffer_mut(),
            areas.position,
            Line::styled(
                format!("Read · {}", scroll.position()),
                look.role(Role::Muted),
            ),
        );
    }
    // The shared painter reports geometry for disabled chips too. Keep only
    // enabled rectangles in the map used by keyboard and mouse activation.
    for (button, rect) in dialog.buttons.iter().zip(&mut hits.buttons) {
        if !button.is_enabled() {
            *rect = None;
        }
    }
    let mut controls = [None; 3];
    for (i, rect) in hits.buttons.iter().enumerate().take(3) {
        controls[i] = *rect;
    }
    draft.controls.set(controls);
    *close.hits.borrow_mut() = hits;
    *close.painted.borrow_mut() = acts;
    app.input_band.set(Some(areas.outer));
    app.peek_areas.set(Overlay::Workspace, Some(areas.outer));
}
