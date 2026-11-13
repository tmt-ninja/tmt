//! Held Orchestration facts through the shared rule, key/value, empty-state and row styles.
use super::{
    super::app::App,
    input::Control,
    model::{Member, Receiving, RouteSource, Snapshot, Source, Verdict},
};
use crate::cron_service::rows::{JobRow, JobState};
use crate::{action::OpsUiAction as Ui, look::Look};
use ratatui::{
    Frame,
    layout::Rect,
    style::{Modifier, Style},
    text::{Line, Span},
};
use tmt_cli_style::{
    Role,
    grid::{self, Align, Truncate},
};
use tmt_tui::components::{
    design_system::{MoreDirection, MoreHint},
    strip,
};
use unicode_width::UnicodeWidthStr;
fn safe(text: &str) -> String {
    super::super::workspace::render::safe(text)
}
fn cell(text: &str, width: usize) -> String {
    grid::fit(&safe(text), width, Align::Left, Truncate::End)
}
fn text(frame: &mut Frame, app: &App, area: Rect, value: &str, role: Role) {
    if !area.is_empty() {
        strip::paint_left(
            frame.buffer_mut(),
            area,
            // A cut line ends with an ellipsis, never mid-word without one.
            Line::styled(cell(value, usize::from(area.width)), app.look().role(role)),
        );
    }
}
fn line(area: Rect, y: u16) -> Rect {
    Rect::new(area.x, y, area.width, u16::from(y < area.bottom()))
}
/// A member state as its mark, word and role: the one place these colours are chosen.
fn state_mark(state: &str) -> (&'static str, &'static str, Role) {
    match state {
        "awake" => ("●", "Awake", Role::Working),
        "low" => ("◐", "Low", Role::Text),
        "focus" => ("◑", "Focus", Role::Text),
        _ => ("◌", "Sleep", Role::Muted),
    }
}
/// The selected matrix cell: the conversation tint (reverse without colours) under the cell's own
/// foreground, bold, so it stands out of its selected row in every look.
fn crosshair(look: Look, value: Style) -> Style {
    let style = look.conversation().add_modifier(Modifier::BOLD);
    match value.fg {
        Some(fg) if style.bg.is_some() => style.fg(fg),
        _ => style,
    }
}
pub(in crate::board) fn render(frame: &mut Frame, app: &App, area: Rect) {
    app.orchestration.invalidate();
    app.orchestration
        .enlarge
        .set(area.width < 34 || area.height < 6);
    if app.orchestration.enlarge.get() {
        text(
            frame,
            app,
            area,
            "Enlarge to review Orchestration",
            Role::Muted,
        );
        return;
    }
    let state = &app.orchestration;
    let look = app.look();
    header(frame, app, Rect::new(area.x + 1, area.y, area.width - 2, 1));
    // The timeline strip takes three rows under the header where the height allows; without it,
    // one blank row parts the header from the sections.
    let strip = state
        .snapshot()
        .filter(|_| !state.unavailable && area.height >= 12);
    if let Some(snapshot) = strip {
        timeline(
            frame,
            app,
            snapshot,
            Rect::new(area.x + 1, area.y + 1, area.width - 2, 3),
        );
    }
    let top = if strip.is_some() {
        4
    } else {
        1 + u16::from(area.height >= 12)
    };
    let body = Rect::new(area.x, area.y + top, area.width, area.height - top);
    let (left, right) = if area.width >= 110 {
        let width = body.width * 47 / 100;
        (
            Rect { width, ..body },
            Rect::new(
                body.x + width + 1,
                body.y,
                body.width - width - 1,
                body.height,
            ),
        )
    } else {
        (body, Rect::default())
    };
    let snapshot = state.snapshot();
    // With `⏎` on a plan, the title says whose rows show; the verdicts still come from every plan.
    let only = state
        .only_plan_row()
        .map(|plan| format!(" · members of {}", plan.name))
        .unwrap_or_default();
    let title = match snapshot {
        Some(s) if state.plans => format!("Plans · {}", s.plan_rows.len()),
        Some(s) if s.sending.routes.is_some() => {
            format!(
                "Who may message whom{only} · at {}",
                s.clock(s.document.at_ms)
            )
        }
        Some(s) => format!("Members{only} · at {}", s.clock(s.document.at_ms)),
        None => "Who may message whom".into(),
    };
    // The plans rule notes how many are in effect at the selected time.
    let plans_note = snapshot
        .filter(|_| state.plans)
        .map(|s| {
            let at = s.document.at_ms;
            let on = s
                .document
                .timeline
                .iter()
                .find(|i| i.start_ms <= at && at < i.end_ms)
                .map_or(0, |i| i.plan_ids.len());
            format!("{on} in effect")
        })
        .unwrap_or_default();
    let rule = line(left, left.y);
    let focus = state.focus();
    let mut focused_rule = rule;
    super::super::section_rule::paint(
        frame.buffer_mut(),
        rule,
        &title,
        Line::styled(plans_note, look.role(Role::Muted)),
        focus == super::Section::Routes,
        look,
    );
    let list = Rect::new(left.x, left.y + 1, left.width, left.height - 1);
    if !right.is_empty() {
        super::super::divider::paint(
            frame.buffer_mut(),
            Rect::new(left.right(), body.y, 1, body.height),
            true,
            look,
        );
    }
    match snapshot {
        _ if state.unavailable => empty(
            frame,
            app,
            list,
            "Orchestration is not available in this Core. Update Core to use this tab.",
            None,
        ),
        None => match &state.failure {
            Some(reason) => failed(
                frame,
                app,
                list,
                &format!("✕ Could not read Orchestration · {reason}"),
            ),
            None => empty(frame, app, list, "◌ Loading Orchestration…", None),
        },
        Some(snapshot) => {
            // The totals line closes the column when it has room for it.
            let totals = u16::from(list.height >= 10);
            let list = Rect {
                height: list.height - totals,
                ..list
            };
            // Below 110 columns the inspector stacks under the first section, and Talks and Jobs
            // fold to their rule until Tab focuses one.
            let narrow = right.is_empty();
            let folded = |present: bool, section| narrow && present && focus != section;
            let talks_folded = folded(snapshot.sending.talks.is_some(), super::Section::Talks);
            let jobs_folded = folded(
                !matches!(snapshot.jobs, super::model::Jobs::Unavailable),
                super::Section::Jobs,
            );
            if totals > 0 {
                let mut totals = totals_line(snapshot);
                if talks_folded || jobs_folded {
                    totals.push_str(" · Tab opens Talks or Jobs");
                }
                text(
                    frame,
                    app,
                    Rect::new(list.x + 1, list.bottom(), list.width.saturating_sub(2), 1),
                    &totals,
                    Role::Muted,
                );
            }
            let routes = snapshot.sending.routes.is_some() && !state.plans;
            let members = state.members(snapshot).len() as u16;
            // Each section's whole content: rule (Talks, Jobs), column names and rows; the matrix
            // also has up to two legend lines.
            let full = [
                if state.plans {
                    // Column names and one row per plan; with none, the two commands.
                    1 + (snapshot.plan_rows.len() as u16).max(2)
                } else if routes {
                    members + 3
                } else {
                    members + 1
                },
                snapshot
                    .sending
                    .talks
                    .as_ref()
                    .map_or(0, |pairs| 2 + pairs.len().max(1) as u16),
                match &snapshot.jobs {
                    super::model::Jobs::Listed(jobs) => 2 + jobs.rows.len().max(1) as u16,
                    // The rule, the reason and the retry key.
                    super::model::Jobs::Failed(_) => 3,
                    super::model::Jobs::Unavailable => 0,
                },
            ];
            let full = [
                full[0],
                if talks_folded {
                    full[1].min(1)
                } else {
                    full[1]
                },
                if jobs_folded { full[2].min(1) } else { full[2] },
            ];
            let stack = if narrow {
                inspector_lines(app, Some(snapshot), list.width)
            } else {
                Vec::new()
            };
            let two = list.width >= 90;
            let stack_need = stacked_height(&stack, two);
            let stack_rows = stack_need.min(list.height / 2);
            let stack_gap = u16::from(stack_rows > 0);
            let (sizes, gap) = section_rows(
                full,
                focus,
                list.height.saturating_sub(stack_rows + stack_gap),
            );
            let mut top = Rect {
                height: sizes[0],
                ..list
            };
            if state.plans {
                plans(frame, app, snapshot, top);
            } else if routes {
                let (note, used) = matrix(frame, app, snapshot, top);
                top.height = used;
                if !note.is_empty() {
                    super::super::section_rule::paint(
                        frame.buffer_mut(),
                        rule,
                        &title,
                        Line::styled(note, look.role(Role::Muted)),
                        focus == super::Section::Routes,
                        look,
                    );
                }
            } else {
                table(frame, app, snapshot, top);
            }
            // The stack takes what the first section left, up to its lines, after the rows Talks
            // and Jobs keep below it.
            let stack_y = top.bottom() + gap * stack_gap;
            let tail = [1, 2]
                .into_iter()
                .filter(|index| full[*index] > 0)
                .map(|index| sizes[index] + gap)
                .sum::<u16>();
            let stack_area = Rect::new(
                list.x,
                stack_y,
                list.width,
                stack_need.min(list.bottom().saturating_sub(stack_y + tail)),
            );
            if !stack_area.is_empty() {
                place_columns(frame, app, stack, stack_area, two);
            }
            let above = if stack_area.is_empty() {
                top.bottom()
            } else {
                stack_area.bottom()
            };
            let talk_y = above + if full[1] > 0 { gap } else { 0 };
            let talk_area = Rect::new(
                list.x,
                talk_y,
                list.width,
                sizes[1].min(list.bottom().saturating_sub(talk_y)),
            );
            if full[1] > 0 && !talk_area.is_empty() {
                talk_rows(frame, app, snapshot, talk_area);
                if focus == super::Section::Talks {
                    focused_rule = line(talk_area, talk_area.y);
                }
            }
            let job_y = talk_area.bottom() + if full[2] > 0 { gap } else { 0 };
            let job_area = Rect::new(
                list.x,
                job_y,
                list.width,
                if jobs_folded {
                    full[2].min(list.bottom().saturating_sub(job_y))
                } else {
                    list.bottom().saturating_sub(job_y)
                },
            );
            if full[2] > 0 && !job_area.is_empty() {
                job_rows(frame, app, snapshot, job_area);
                if focus == super::Section::Jobs {
                    focused_rule = line(job_area, job_area.y);
                }
            }
        }
    }
    super::super::pane_chrome::mark_focused_rule(frame.buffer_mut(), app, Some(focused_rule), None);
    if !right.is_empty() {
        inspector(frame, app, snapshot.filter(|_| !state.unavailable), right);
    }
}
fn empty(frame: &mut Frame, app: &App, area: Rect, message: &str, action: Option<(&str, &str)>) {
    if area.height > 0 {
        super::super::empty_state::paint(
            frame.buffer_mut(),
            Rect::new(area.x + 1, area.y, area.width.saturating_sub(2), 1),
            message,
            action,
            app.look(),
        );
    }
}
/// A read that failed: the reason, its `✕` in the Blocked role, and the retry key under it.
fn failed(frame: &mut Frame, app: &App, area: Rect, message: &str) {
    let look = app.look();
    empty(frame, app, area, message, None);
    if area.height == 0 {
        return;
    }
    frame.buffer_mut()[(area.x + 1, area.y)].set_style(look.role(Role::Blocked));
    let retry = super::super::view::footer::effective_key(
        app,
        &app.workspace_bindings(),
        crate::action::Verb::Refresh,
        "ctrl-r",
    )
    .map(|key| super::super::view::footer::key_label(&key).to_owned());
    if let Some(key) = retry
        && area.height > 2
    {
        strip::paint_left(
            frame.buffer_mut(),
            Rect::new(area.x + 1, area.y + 2, area.width.saturating_sub(2), 1),
            super::super::keycap::label(Some(&key), "Retry", false, look),
        );
    }
}
/// The tab's one header line: where and when on the left, the bound controls on the right. When
/// both do not fit, the status uses its short words, then the controls give way.
fn header(frame: &mut Frame, app: &App, area: Rect) {
    let controls = if app.orchestration.snapshot().is_some() {
        controls(app)
    } else {
        Vec::new()
    };
    let controls_width: usize = controls
        .iter()
        .map(|(_, spans)| spans.iter().map(Span::width).sum::<usize>())
        .sum();
    let room = usize::from(area.width);
    let full = Line::from(status(app, false));
    let short = Line::from(status(app, true));
    let fits = |line: &Line| line.width() + 2 + controls_width <= room;
    let (status, width) = if fits(&full) {
        (full, controls_width as u16)
    } else if fits(&short) {
        (short, controls_width as u16)
    } else if full.width() <= room {
        (full, 0)
    } else {
        // Without the controls: the short words, then whole parts drop from the end, never
        // mid-phrase. A refresh failure stays last and is the one part cut with `…`.
        let mut spans = short.spans;
        let failure = spans
            .iter()
            .position(|span| span.content.starts_with("◆ Refresh failed"))
            .map(|at| spans.split_off(at.saturating_sub(1)))
            .unwrap_or_default();
        let failure_width = Line::from(failure.clone()).width();
        while Line::from(spans.clone()).width() + failure_width > room
            && let Some(at) = spans.iter().rposition(|span| span.content == " · ")
        {
            spans.truncate(at);
        }
        spans.extend(failure);
        let mut line = Line::from(spans);
        let total = line.width();
        if total > room
            && let Some(last) = line.spans.last_mut()
        {
            let keep = room.saturating_sub(total - last.width());
            last.content = grid::fit(&last.content, keep, Align::Left, Truncate::End)
                .trim_end()
                .to_owned()
                .into();
        }
        (line, 0)
    };
    strip::paint_left(
        frame.buffer_mut(),
        Rect {
            width: area.width - width,
            ..area
        },
        status,
    );
    if width == 0 {
        return;
    }
    let mut x = area.right() - width;
    for (control, spans) in controls {
        let wide = spans.iter().map(Span::width).sum::<usize>() as u16;
        let rect = Rect::new(x, area.y, wide, 1);
        strip::paint_left(frame.buffer_mut(), rect, Line::from(spans));
        if let Some(control) = control {
            app.orchestration.hits.borrow_mut().push((rect, control));
        }
        x += wide;
    }
}
fn status(app: &App, short: bool) -> Vec<Span<'static>> {
    let state = &app.orchestration;
    let look = app.look();
    let mut status = vec![Span::styled("Orchestration", look.role(Role::Text))];
    let mut part = |spans: Vec<Span<'static>>| {
        status.push(Span::styled(" · ", look.role(Role::Muted)));
        status.extend(spans);
    };
    let Some(snapshot) = state.snapshot() else {
        part(vec![Span::styled(
            if state.unavailable || state.failure.is_some() {
                "not read"
            } else {
                "reading…"
            },
            look.role(Role::Muted),
        )]);
        return status;
    };
    let document = &snapshot.document;
    part(vec![Span::styled(
        format!(
            "{} {}",
            snapshot.short(document.at_ms),
            safe(&document.time_zone)
        ),
        look.role(Role::Text),
    )]);
    part(if state.follow_now {
        vec![
            Span::styled("● ", look.role(Role::Working)),
            Span::styled(
                if short { "now" } else { "following now" },
                look.role(Role::Text),
            ),
        ]
    } else {
        vec![Span::styled("selected time", look.role(Role::Muted))]
    });
    // Plans in effect at the selected time, never across the whole range.
    let active = document
        .timeline
        .iter()
        .find(|i| i.start_ms <= document.at_ms && document.at_ms < i.end_ms)
        .map_or(0, |i| i.plan_ids.len());
    part(vec![Span::styled(
        match (active, short) {
            (0, _) => "Base only".to_owned(),
            (1, false) => "1 plan in effect".to_owned(),
            (1, true) => "1 plan".to_owned(),
            (n, false) => format!("{n} plans in effect"),
            (n, true) => format!("{n} plans"),
        },
        look.role(Role::Text),
    )]);
    if let Some(note) = &state.note {
        part(vec![Span::styled(safe(note), look.role(Role::Muted))]);
    }
    if let Some(reason) = &state.failure {
        part(vec![Span::styled(
            format!(
                "◆ Refresh failed · {} · showing {}",
                safe(reason),
                snapshot.clock(document.observed_at_ms)
            ),
            look.role(Role::Waiting),
        )]);
    }
    status
}
/// The label column of the timeline strip.
const STRIP_LABEL: u16 = 15;
/// The timeline strip: the range's axis, the plans in effect per cell, and the selected time with
/// the earlier and later controls. Cells are laid out by their instants, so every range and day
/// length lands on the same columns as its axis; a column covering several cells shows the
/// highest count.
fn timeline(frame: &mut Frame, app: &App, snapshot: &Snapshot, area: Rect) {
    let state = &app.orchestration;
    let look = app.look();
    let strip = &snapshot.strip;
    let range = &snapshot.document.range;
    if area.width <= STRIP_LABEL + 4 || strip.cells.is_empty() {
        return;
    }
    let x0 = area.x + STRIP_LABEL;
    let width = area.right() - x0 - 1;
    let span = range.end_ms.saturating_sub(range.start_ms).max(1);
    let column = |ms: u64| -> u16 {
        let offset = ms.clamp(range.start_ms, range.end_ms) - range.start_ms;
        ((u128::from(offset) * u128::from(width)) / u128::from(span)) as u16
    };
    let row = |y: u16| Rect::new(area.x, area.y + y, area.width, 1);
    text(frame, app, row(0), strip.axis, Role::Muted);
    text(frame, app, row(1), strip.row, Role::Muted);
    // Axis ticks: a label never covers the one before it.
    let mut free = 0;
    for (at, label) in &strip.ticks {
        let wide = label.width() as u16;
        let mut x = column(*at);
        if *at >= range.end_ms {
            x = x.saturating_sub(wide.saturating_sub(1));
        }
        if x < free || x + wide > width {
            continue;
        }
        strip::paint_left(
            frame.buffer_mut(),
            Rect::new(x0 + x, area.y, wide, 1),
            Line::styled(label.clone(), look.role(Role::Muted)),
        );
        free = x + wide + 1;
    }
    // In the plans list, the strip marks only the selected plan's cells, named.
    let plan = state.selected_plan().filter(|_| state.plans);
    let marked =
        |cell: &super::model::StripCell| plan.is_some_and(|p| cell.plan_ids.contains(&p.id));
    // Which cell each column shows: a marked cell first, then the highest count it covers.
    let mut shown: Vec<Option<usize>> = vec![None; usize::from(width)];
    for (index, cell) in strip.cells.iter().enumerate() {
        let from = column(cell.start_ms).min(width - 1);
        let to = column(cell.end_ms).max(from + 1).min(width);
        for slot in &mut shown[usize::from(from)..usize::from(to)] {
            if slot.is_none_or(|other| {
                let other = &strip.cells[other];
                (marked(other), other.count) < (marked(cell), cell.count)
            }) {
                *slot = Some(index);
            }
        }
    }
    let selected = strip.cells.iter().position(|cell| {
        cell.start_ms <= snapshot.document.at_ms && snapshot.document.at_ms < cell.end_ms
    });
    let mut x = 0;
    while x < width {
        let Some(index) = shown[usize::from(x)] else {
            x += 1;
            continue;
        };
        let run = shown[usize::from(x)..]
            .iter()
            .take_while(|slot| **slot == Some(index))
            .count() as u16;
        let cell = &strip.cells[index];
        let mark = match cell.count {
            0 => "·".to_owned(),
            n if n < 10 => n.to_string(),
            _ => "+".to_owned(),
        };
        let fill = if strip.spans && cell.count == 0 {
            "·"
        } else {
            " "
        };
        let body = match plan {
            Some(plan) if marked(cell) => grid::fit(
                &safe(&format!(" {}", plan.name)),
                usize::from(run),
                Align::Left,
                Truncate::End,
            ),
            Some(_) => "·".repeat(usize::from(run)),
            None => format!("{mark}{}", fill.repeat(usize::from(run.saturating_sub(1)))),
        };
        let role = if cell.count == 0 || (plan.is_some() && !marked(cell)) {
            Role::Dim
        } else {
            Role::Text
        };
        let mut style = look.role(role);
        if plan.is_some() && marked(cell) {
            style = look.selected(true, style);
        }
        if Some(index) == selected {
            style = look.role(Role::Text).add_modifier(Modifier::BOLD);
        }
        let rect = Rect::new(x0 + x, area.y + 1, run, 1);
        strip::paint_left(frame.buffer_mut(), rect, Line::styled(body, style));
        state
            .hits
            .borrow_mut()
            .push((rect, Control::At(cell.at_ms)));
        x += run;
    }
    // The selected time: a marker under it, what is in effect then, and the step controls.
    let at = snapshot.document.at_ms;
    // One cell per Core interval (1 day) places the marker in proportion; a bucketed range puts
    // it under the first column of the selected bucket, where its count stands.
    let marker = selected
        .filter(|_| !strip.spans)
        .and_then(|index| shown.iter().position(|slot| *slot == Some(index)))
        .map_or_else(|| column(at).min(width - 1), |x| x as u16);
    let mut controls = Vec::new();
    for (action, preferred, label, control) in [
        (
            Ui::OrchestrationEarlier,
            "[",
            "earlier",
            Control::PreviousTime,
        ),
        (Ui::OrchestrationLater, "]", "later", Control::NextTime),
    ] {
        if let Some(key) = super::super::keycap::key(app, action, preferred) {
            let line = super::super::keycap::label(Some(&key), label, false, look);
            controls.push((line, control));
        }
    }
    let controls_width: u16 = controls
        .iter()
        .map(|(line, _)| line.width() as u16 + 3)
        .sum();
    let names: Vec<&str> = snapshot
        .document
        .timeline
        .iter()
        .find(|interval| interval.start_ms <= at && at < interval.end_ms)
        .map(|interval| {
            interval
                .plan_ids
                .iter()
                .map(|id| snapshot.document.plan_name(id))
                .collect()
        })
        .unwrap_or_default();
    let label = format!(
        "at {} · {}",
        snapshot.clock(at),
        if names.is_empty() {
            "base only".to_owned()
        } else {
            names.join(" · ")
        }
    );
    // The label sits before the marker when it fits there, else after it; it yields first. The
    // step controls stand at the right, or at the left when the marker is under them.
    let marker_x = x0 + marker;
    strip::paint_left(
        frame.buffer_mut(),
        Rect::new(marker_x, area.y + 2, 1, 1),
        Line::styled("▲", look.role(Role::Text).add_modifier(Modifier::BOLD)),
    );
    let label = safe(&label);
    let wide = label.width() as u16;
    let right = area.right().saturating_sub(controls_width);
    let before = (wide < marker_x.saturating_sub(area.x + 1)).then(|| marker_x - 1 - wide);
    let controls_x = if right > marker_x + 2 {
        Some(right)
    } else {
        let left = area.x + 1;
        let free = before.unwrap_or(marker_x);
        (left + controls_width < free).then_some(left)
    };
    if let Some(mut x) = controls_x {
        for (line, control) in controls {
            let wide = line.width() as u16;
            let rect = Rect::new(x, area.y + 2, wide, 1);
            strip::paint_left(frame.buffer_mut(), rect, line);
            state.hits.borrow_mut().push((rect, control));
            x += wide + 3;
        }
    }
    if let Some(x) = before {
        text(
            frame,
            app,
            Rect::new(x, area.y + 2, wide, 1),
            &label,
            Role::Muted,
        );
    } else {
        let limit = match controls_x {
            Some(x) if x > marker_x => x.saturating_sub(1),
            _ => area.right(),
        };
        if limit > marker_x + 2 {
            text(
                frame,
                app,
                Rect::new(marker_x + 2, area.y + 2, limit - marker_x - 2, 1),
                &label,
                Role::Muted,
            );
        }
    }
}
/// Range, plans and now as keycap controls, from the keys bound now; an unbound one keeps no cap.
fn controls(app: &App) -> Vec<(Option<Control>, Vec<Span<'static>>)> {
    let state = &app.orchestration;
    let look = app.look();
    let gap = || (None, vec![Span::raw("   ")]);
    let control = |action: Ui, preferred: &str, label: &str, on: bool, control: Control| {
        let mut spans = Vec::new();
        if let Some(key) = super::super::keycap::key(app, action, preferred) {
            spans.push(super::super::keycap::span(&key, on, look));
            spans.push(Span::raw(" "));
        }
        spans.push(Span::styled(
            label.to_owned(),
            look.role(if on { Role::Text } else { Role::Muted }),
        ));
        spans.push(Span::raw(" "));
        (Some(control), spans)
    };
    let mut row = vec![(None, vec![Span::styled("Range ", look.role(Role::Muted))])];
    for (action, preferred, days, label) in [
        (Ui::OrchestrationDay, "d", 1, "1d"),
        (Ui::OrchestrationWeek, "7", 7, "7d"),
        (Ui::OrchestrationMonth, "0", 30, "30d"),
    ] {
        row.push(control(
            action,
            preferred,
            label,
            state.query.days == days,
            Control::Range(days),
        ));
    }
    row.push(gap());
    row.push(control(
        Ui::OrchestrationPlans,
        "P",
        "Plans",
        state.plans,
        Control::Plans,
    ));
    if !state.follow_now {
        row.push(gap());
        row.push(control(
            Ui::OrchestrationNow,
            "N",
            "Now",
            false,
            Control::Now,
        ));
    }
    row
}
fn plans(frame: &mut Frame, app: &App, snapshot: &Snapshot, area: Rect) {
    let state = &app.orchestration;
    let look = app.look();
    let plans = &snapshot.plan_rows;
    if plans.is_empty() {
        empty(frame, app, area, "Base only · no plans yet", None);
        for (offset, (label, command)) in [
            ("Preview a plan:", "tmt orch preview --file plan.json"),
            ("Then save it:", "tmt orch plan add --file plan.json"),
        ]
        .into_iter()
        .enumerate()
        {
            let row = line(area, area.y + 1 + offset as u16);
            if row.height > 0 {
                strip::paint_left(
                    frame.buffer_mut(),
                    Rect::new(row.x + 1, row.y, row.width.saturating_sub(2), 1),
                    Line::from(vec![
                        Span::styled(format!("{label:<17}"), look.role(Role::Muted)),
                        Span::styled(command, look.role(Role::Text)),
                    ]),
                );
            }
        }
        return;
    }
    // Columns sized to their widest value; WHEN yields first, any cut ends in `…`, and one cell
    // of gutter stays before the divider.
    let widest = |header: &str, values: &mut dyn Iterator<Item = &str>| {
        values
            .map(|v| safe(v).width())
            .fold(header.width(), usize::max)
    };
    let name_w = widest("PLAN", &mut plans.iter().map(|p| p.name.as_str()));
    let who_w = widest("WHO", &mut plans.iter().map(|p| p.who.as_str()));
    let prio_w = plans
        .iter()
        .map(|p| p.priority.to_string().len())
        .fold("PRIO".len(), usize::max);
    let when_full = widest("WHEN", &mut plans.iter().map(|p| p.when.as_str()));
    // A leading space, the on/off mark, a space between columns and the gutter.
    let fixed = 1 + 2 + name_w + 1 + who_w + 1 + 1 + prio_w + 1;
    let when_w = usize::from(area.width).saturating_sub(fixed).min(when_full);
    let columns = |name: &str, who: &str, when: &str, prio: &str| {
        format!(
            "{} {} {} {}",
            cell(name, name_w),
            cell(who, who_w),
            cell(when, when_w),
            grid::fit(prio, prio_w, Align::Right, Truncate::End)
        )
    };
    text(
        frame,
        app,
        line(area, area.y),
        &format!("   {}", columns("PLAN", "WHO", "WHEN", "PRIO")),
        Role::Muted,
    );
    let selected = plans
        .iter()
        .position(|p| Some(&p.id) == state.plan_selection.as_ref())
        .unwrap_or(0);
    let focused = state.focus() == super::Section::Routes;
    let room = usize::from(area.height.saturating_sub(1));
    let (start, shown, above, below) = window(plans.len(), room, Some(selected));
    let mut y = area.y + 1;
    let hint = |frame: &mut Frame, y: u16, hidden: usize, direction| {
        text(
            frame,
            app,
            Rect::new(area.x + 1, y, area.width.saturating_sub(2), 1),
            &MoreHint::label(hidden as u64, direction, false),
            Role::Muted,
        );
    };
    if above > 0 {
        hint(frame, y, above, MoreDirection::Up);
        y += 1;
    }
    for (index, plan) in plans.iter().enumerate().skip(start).take(shown) {
        let chosen = focused && index == selected;
        let row = Rect::new(area.x, y, area.width, 1);
        let base = look.selected(chosen, look.role(Role::Text));
        strip::paint_left(
            frame.buffer_mut(),
            row,
            Line::from(vec![
                Span::styled(" ", base),
                Span::styled(
                    if plan.enabled { "● " } else { "○ " },
                    look.selected(
                        chosen,
                        look.role(if plan.enabled {
                            Role::Working
                        } else {
                            Role::Muted
                        }),
                    ),
                ),
                Span::styled(
                    format!(
                        "{} ",
                        columns(
                            &plan.name,
                            &plan.who,
                            &plan.when,
                            &plan.priority.to_string()
                        )
                    ),
                    base,
                ),
            ]),
        );
        if chosen {
            app.workspace_state_cells
                .borrow_mut()
                .push(Rect::new(row.x + 1, row.y, 1, 1));
        }
        state.hits.borrow_mut().push((row, Control::Plan(index)));
        y += 1;
    }
    if below > 0 {
        hint(frame, y, below, MoreDirection::Down);
    }
}
fn table(frame: &mut Frame, app: &App, snapshot: &Snapshot, area: Rect) {
    let state = &app.orchestration;
    let look = app.look();
    let wide = area.width >= 70;
    text(
        frame,
        app,
        line(area, area.y),
        if wide {
            " MEMBER            STATE     RECEIVING       SENDING   ROUTINE"
        } else {
            " MEMBER            STATE     RECEIVING"
        },
        Role::Muted,
    );
    let members = state.members(snapshot);
    if members.is_empty() {
        empty(
            frame,
            app,
            Rect::new(
                area.x,
                area.y + 1,
                area.width,
                area.height.saturating_sub(1),
            ),
            &no_members(app, snapshot),
            None,
        );
        return;
    }
    let selected = members
        .iter()
        .position(|member| Some(&member.identity_id) == state.selected.as_ref())
        .unwrap_or(0);
    let rows = usize::from(area.height.saturating_sub(1));
    let start = selected.saturating_sub(rows / 2);
    for (index, member) in members.iter().enumerate().skip(start).take(rows) {
        let chosen = index == selected;
        let row = Rect::new(area.x, area.y + 1 + (index - start) as u16, area.width, 1);
        let (mark, word, role) = state_mark(&member.effective.state.value);
        let base = look.selected(chosen, look.role(Role::Text));
        let mut spans = vec![
            Span::styled(format!(" {} ", cell(&member.name, 17)), base),
            Span::styled(
                cell(&format!("{mark} {word}"), 9),
                look.selected(chosen, look.role(role)),
            ),
            Span::styled(format!(" {}", cell(&receiving_label(member), 15)), base),
        ];
        if wide {
            spans.push(Span::styled(
                format!(
                    " {} {}",
                    cell(sending_word(&member.effective.sending.value), 9),
                    safe(&member.effective.routine.value)
                ),
                base,
            ));
        }
        strip::paint_left(frame.buffer_mut(), row, Line::from(spans));
        if chosen {
            app.workspace_state_cells
                .borrow_mut()
                .push(Rect::new(row.x + 19, row.y, 9, 1));
        }
        state.hits.borrow_mut().push((row, Control::Member(index)));
    }
}
/// Why no member row shows: the plan filter names its plan and when, else the query matched none.
fn no_members(app: &App, snapshot: &Snapshot) -> String {
    match app.orchestration.only_plan_row() {
        Some(plan) => format!(
            "{} applies to no one at {}",
            plan.name,
            snapshot.clock(snapshot.document.at_ms)
        ),
        None => "No members match this query".into(),
    }
}
fn receiving_label(member: &Member) -> String {
    member
        .effective
        .receiving
        .value
        .as_ref()
        .map(|r| r.label())
        .unwrap_or_else(|| "unavailable".into())
}
fn sending_word(value: &str) -> &str {
    match value {
        "leads" => "leads only",
        other => other,
    }
}
/// The short cell word for a recipient's receiving: what a message to it does now.
fn receiving_cell(receiving: Option<&Receiving>) -> String {
    match receiving {
        None => "?".into(),
        Some(Receiving::Direct) => "Dir".into(),
        Some(Receiving::Auto) => "Auto".into(),
        Some(Receiving::Urgent) => "Urg".into(),
        Some(Receiving::Hold) => "Hold".into(),
        Some(batch @ Receiving::Batch { .. }) => batch.label().replace("batch ", "B"),
    }
}
/// The widest a matrix name column or recipient column grows, in cells.
const NAME_CAP: usize = 13;
const COLUMN_CAP: usize = 12;
/// Labels no wider than `width` that never show two different names as the same text: a long
/// name keeps both ends, then its tail, then its position.
fn distinct_labels(names: &[&str], width: usize) -> Vec<String> {
    let cut = |name: &str, truncate| {
        grid::fit(&safe(name), width, Align::Left, truncate)
            .trim_end()
            .to_owned()
    };
    let mut labels: Vec<String> = names.iter().map(|n| cut(n, Truncate::Middle)).collect();
    // Indices whose label another, different name also shows: one pass over a map, so the cost
    // grows with the roster, not its square.
    let clashes = |labels: &[String]| -> Vec<usize> {
        let mut groups: std::collections::HashMap<&str, Vec<usize>> =
            std::collections::HashMap::with_capacity(labels.len());
        for (index, label) in labels.iter().enumerate() {
            groups.entry(label.as_str()).or_default().push(index);
        }
        let mut clashing: Vec<usize> = groups
            .into_values()
            .filter(|group| group.iter().any(|&i| names[i] != names[group[0]]))
            .flatten()
            .collect();
        clashing.sort_unstable();
        clashing
    };
    for index in clashes(&labels) {
        let name = safe(names[index]);
        let tail: String = name
            .chars()
            .rev()
            .scan(0, |used, c| {
                *used += c.to_string().width();
                (*used < width).then_some(c)
            })
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        labels[index] = if tail.width() < name.width() {
            format!("…{tail}")
        } else {
            name
        };
    }
    for index in clashes(&labels) {
        let mark = format!("#{}", index + 1);
        labels[index] = format!(
            "{}{mark}",
            cut(names[index], Truncate::End)
                .chars()
                .scan(0, |used, c| {
                    *used += c.to_string().width();
                    (*used + mark.width() <= width).then_some(c)
                })
                .collect::<String>()
        );
    }
    labels
}
/// The route matrix: one row per sender, one column per recipient, each column as wide as its
/// own name or receiving word (capped). The selected sender's row carries the selection, the selected route the
/// crosshair and its recipient a bold name. Every cell is Core's verdict (`✕` blocked, `◆` needs a
/// person) or, when allowed, the recipient's receiving. Nothing is inferred here. Returns the
/// section rule's note (how many senders and recipients lie outside the view) and the rows used.
fn matrix(frame: &mut Frame, app: &App, snapshot: &Snapshot, area: Rect) -> (String, u16) {
    let state = &app.orchestration;
    let look = app.look();
    let members = state.members(snapshot);
    let sending = &snapshot.sending;
    let names: Vec<&str> = members.iter().map(|m| m.name.as_str()).collect();
    let widest = names.iter().map(|n| safe(n).width()).max().unwrap_or(0);
    // The column header label sets the name column's floor.
    let name_width = widest.clamp("From ↓ To →".width(), NAME_CAP);
    let (rows_labels, column_labels) = (
        distinct_labels(&names, name_width),
        distinct_labels(&names, COLUMN_CAP),
    );
    let name_cells = (name_width + 2) as u16;
    // Each recipient column is as wide as its own label or the receiving word its cells show,
    // whichever is wider, plus a one-cell gutter.
    let widths: Vec<u16> = members
        .iter()
        .zip(&column_labels)
        .map(|(to, label)| {
            let word = receiving_cell(to.effective.receiving.value.as_ref()).width();
            (label.width().max(word).max(1) + 1) as u16
        })
        .collect();
    // Column names and up to two legend lines take three rows.
    let rows = usize::from(area.height.saturating_sub(3).max(area.height.min(1)));
    let room = area.width.saturating_sub(name_cells + 1);
    let index = |id: &Option<String>| {
        members
            .iter()
            .position(|m| Some(&m.identity_id) == id.as_ref())
            .unwrap_or(0)
    };
    let (row, column) = (index(&state.selected), index(&state.target));
    // The selected recipient stays in view: from the first column when it fits, else as the
    // last column shown.
    let mut first_column = 0;
    if widths.iter().take(column + 1).sum::<u16>() > room {
        first_column = column;
        let mut used = widths.get(column).copied().unwrap_or(0);
        while first_column > 0 && used + widths[first_column - 1] <= room {
            first_column -= 1;
            used += widths[first_column];
        }
    }
    let mut used = 0;
    let columns = widths[first_column.min(widths.len())..]
        .iter()
        .take_while(|width| {
            used += **width;
            used <= room
        })
        .count();
    if members.is_empty() || rows == 0 || columns == 0 {
        empty(frame, app, area, "No members match this query", None);
        return (String::new(), area.height.min(1));
    }
    let first_row = row.saturating_sub(rows.saturating_sub(1));
    // Where each shown column starts, from the name column's edge.
    let starts: Vec<u16> = widths[first_column..first_column + columns]
        .iter()
        .scan(0, |at, width| {
            let start = *at;
            *at += width;
            Some(start)
        })
        .collect();
    let pad = |text: &str, width: usize| grid::fit(text, width, Align::Left, Truncate::End);
    let mut header = vec![Span::styled(
        format!(" {} ", pad("From ↓ To →", name_width)),
        look.role(Role::Muted),
    )];
    for c in (first_column..members.len()).take(columns) {
        header.push(Span::styled(
            pad(&column_labels[c], usize::from(widths[c])),
            if c == column {
                look.role(Role::Text).add_modifier(Modifier::BOLD)
            } else {
                look.role(Role::Muted)
            },
        ));
    }
    strip::paint_left(frame.buffer_mut(), line(area, area.y), Line::from(header));
    let mut words: Vec<String> = Vec::new();
    let mut y = area.y + 1;
    for (r, from) in members.iter().enumerate().skip(first_row).take(rows) {
        let selected = r == row;
        strip::paint_left(
            frame.buffer_mut(),
            Rect::new(area.x, y, area.width, 1),
            Line::styled(
                format!(" {} ", pad(&rows_labels[r], name_width)),
                look.selected(selected, look.role(Role::Text)),
            ),
        );
        for (c, to) in members.iter().enumerate().skip(first_column).take(columns) {
            let (word, role) = if r == c {
                ("—".to_owned(), Role::Dim)
            } else {
                match sending.route(&from.identity_id, &to.identity_id) {
                    None => ("·".into(), Role::Dim),
                    Some(route) => match route.verdict {
                        Verdict::Blocked => ("✕".into(), Role::Blocked),
                        Verdict::NeedsPerson => ("◆".into(), Role::Waiting),
                        Verdict::Allowed => {
                            let word = receiving_cell(to.effective.receiving.value.as_ref());
                            if !words.contains(&word) {
                                words.push(word.clone());
                            }
                            (word, Role::Text)
                        }
                    },
                }
            };
            let x = area.x + name_cells + starts[c - first_column];
            let rect = Rect::new(x, y, widths[c], 1);
            let style = if selected && c == column {
                crosshair(look, look.role(role))
            } else {
                look.selected(selected, look.role(role))
            };
            strip::paint_left(
                frame.buffer_mut(),
                rect,
                Line::styled(pad(&word, usize::from(widths[c])), style),
            );
            if selected && matches!(role, Role::Blocked | Role::Waiting) {
                // A verdict keeps its colour on the selection: the frame pass's state-cell contract.
                app.workspace_state_cells
                    .borrow_mut()
                    .push(Rect::new(x, y, 1, 1));
            }
            state.hits.borrow_mut().push((rect, Control::Cell(r, c)));
        }
        y += 1;
    }
    // The legend explains the words exactly as the cells write them.
    let mut legend: Vec<String> = [
        ("Dir", "direct"),
        ("Auto", "auto"),
        ("Urg", "urgent only"),
        ("Hold", "hold all"),
    ]
    .into_iter()
    .filter(|(word, _)| words.iter().any(|w| w == word))
    .map(|(word, meaning)| format!("{word} {meaning}"))
    .collect();
    legend.extend(words.iter().filter_map(|w| {
        w.strip_prefix('B')
            .map(|interval| format!("{w} batch {interval}"))
    }));
    legend.extend(["✕ sender rule".to_owned(), "◆ needs a person".to_owned()]);
    // Whole items per line: the legend wraps between items rather than cutting one.
    let room = usize::from(area.width).saturating_sub(2);
    let mut lines: Vec<String> = Vec::new();
    for item in legend {
        match lines.last_mut() {
            Some(last) if last.width() + 3 + item.width() <= room => {
                last.push_str(" · ");
                last.push_str(&item);
            }
            _ => lines.push(item),
        }
    }
    for legend in lines {
        if y >= area.bottom() {
            break;
        }
        text(
            frame,
            app,
            line(area, y),
            &format!(" {legend}"),
            Role::Muted,
        );
        y += 1;
    }
    let hidden_rows = members.len().saturating_sub(first_row + rows);
    let hidden_columns = members.len().saturating_sub(first_column + columns);
    let mut note: Vec<String> = Vec::new();
    if sending.truncated {
        note.push("too many to read · filter with /".into());
    }
    for (hidden, direction) in [
        (first_row, MoreDirection::Up),
        (hidden_rows, MoreDirection::Down),
        (hidden_columns, MoreDirection::Right),
    ] {
        if hidden > 0 {
            note.push(MoreHint::label(hidden as u64, direction, false));
        }
    }
    (note.join(" · "), y - area.y)
}
/// Rows for the left column's sections (routes, talks, jobs) from their whole content `full`, and
/// whether a blank row parts them. Everything fits: each gets its content and a blank row parts
/// them. Otherwise nothing is parted, the focused section takes its rows first, up to its content,
/// and the others keep their rule, column names and one row before sharing what is left in order.
fn section_rows(full: [u16; 3], focus: super::Section, height: u16) -> ([u16; 3], u16) {
    let gaps = full[1..].iter().filter(|rows| **rows > 0).count() as u16;
    if full.iter().sum::<u16>() + gaps <= height {
        return (full, 1);
    }
    // The matrix notes its hidden rows in its rule; Talks and Jobs need a row for their count.
    let mut sizes = [full[0].min(3), full[1].min(4), full[2].min(4)];
    let mut left = height.saturating_sub(sizes.iter().sum::<u16>());
    let first = match focus {
        super::Section::Routes => 0,
        super::Section::Talks => 1,
        super::Section::Jobs => 2,
    };
    for index in std::iter::once(first).chain(0..3) {
        let more = (full[index] - sizes[index]).min(left);
        sizes[index] += more;
        left -= more;
    }
    (sizes, 0)
}
/// Talks this hour: one row per pair Core counts, its limit, last message and whether it is held.
fn talk_rows(frame: &mut Frame, app: &App, snapshot: &Snapshot, area: Rect) {
    let look = app.look();
    let Some(pairs) = &snapshot.sending.talks else {
        return;
    };
    let held = pairs.iter().filter(|p| p.held).count();
    super::super::section_rule::paint(
        frame.buffer_mut(),
        line(area, area.y),
        &format!(
            "Talks this hour · {} {}",
            pairs.len(),
            if pairs.len() == 1 { "pair" } else { "pairs" }
        ),
        if held > 0 {
            Line::styled(format!("{held} held"), look.role(Role::Waiting))
        } else {
            Line::default()
        },
        app.orchestration.focus() == super::Section::Talks,
        look,
    );
    if pairs.is_empty() {
        empty(
            frame,
            app,
            Rect::new(
                area.x,
                area.y + 1,
                area.width,
                area.height.saturating_sub(1),
            ),
            "No talks this hour",
            None,
        );
        return;
    }
    text(
        frame,
        app,
        line(area, area.y + 1),
        " PAIR                    LAST HOUR  LAST      STATE",
        Role::Muted,
    );
    let at = snapshot.document.at_ms;
    let focused = app.orchestration.focus() == super::Section::Talks;
    let chosen_pair = pairs.iter().position(|pair| {
        let (from, to) = (
            app.orchestration.selected.as_ref(),
            app.orchestration.target.as_ref(),
        );
        (Some(&pair.ids.0), Some(&pair.ids.1)) == (from, to)
            || (Some(&pair.ids.1), Some(&pair.ids.0)) == (from, to)
    });
    let room = usize::from(area.height.saturating_sub(2));
    let (start, shown, above, below) = window(pairs.len(), room, chosen_pair.filter(|_| focused));
    let hint = |frame: &mut Frame, y: u16, hidden: usize, direction| {
        text(
            frame,
            app,
            Rect::new(area.x + 1, y, area.width.saturating_sub(2), 1),
            &MoreHint::label(hidden as u64, direction, false),
            Role::Muted,
        );
    };
    let first_y = area.y + 2 + u16::from(above > 0);
    if above > 0 {
        hint(frame, area.y + 2, above, MoreDirection::Up);
    }
    if below > 0 {
        hint(frame, first_y + shown as u16, below, MoreDirection::Down);
    }
    for (offset, pair) in pairs.iter().enumerate().skip(start).take(shown) {
        let y = first_y + (offset - start) as u16;
        let limit = pair.limit.map_or_else(|| "—".to_owned(), |l| l.to_string());
        let last = pair.last_at_ms.map_or_else(
            || "—".to_owned(),
            |last| match at.saturating_sub(last) / 60_000 {
                0 => "just now".to_owned(),
                m if m < 60 => format!("{m}m ago"),
                m => format!("{}h ago", m / 60),
            },
        );
        let (status, role) = if pair.held {
            (
                format!("◆ held {} · needs a person", pair.held_count),
                Role::Waiting,
            )
        } else {
            ("● open".to_owned(), Role::Working)
        };
        let state = &app.orchestration;
        let chosen = state.focus() == super::Section::Talks && {
            let (from, to) = (state.selected.as_ref(), state.target.as_ref());
            (Some(&pair.ids.0), Some(&pair.ids.1)) == (from, to)
                || (Some(&pair.ids.1), Some(&pair.ids.0)) == (from, to)
        };
        let row = Rect::new(area.x, y, area.width, 1);
        state.hits.borrow_mut().push((row, Control::Talk(offset)));
        if chosen {
            app.workspace_state_cells.borrow_mut().push(Rect::new(
                row.x + 46,
                row.y,
                row.width.saturating_sub(46),
                1,
            ));
        }
        let (base, role_style) = (
            look.selected(chosen, look.role(Role::Text)),
            look.selected(chosen, look.role(role)),
        );
        strip::paint_left(
            frame.buffer_mut(),
            row,
            Line::from(vec![
                Span::styled(
                    format!(
                        " {} {}  {} ",
                        cell(&format!("{} ⇄ {}", pair.names.0, pair.names.1), 23),
                        grid::fit(
                            &format!("{} / {limit}", pair.count),
                            9,
                            Align::Right,
                            Truncate::End
                        ),
                        cell(&last, 9)
                    ),
                    base,
                ),
                Span::styled(
                    cell(&status, usize::from(area.width.saturating_sub(46))),
                    role_style,
                ),
            ]),
        );
    }
}
/// `1 pair`, `2 pairs`: a count with its noun in the right number.
fn count(n: impl std::fmt::Display, one: &str) -> String {
    let n = n.to_string();
    if n == "1" {
        format!("1 {one}")
    } else {
        format!("{n} {one}s")
    }
}
/// The bottom line of the left column: what the tab counts.
fn totals_line(snapshot: &Snapshot) -> String {
    let mut parts = vec![
        count(snapshot.document.members.len(), "member"),
        count(snapshot.document.plans.len(), "plan"),
    ];
    if let Some(pairs) = &snapshot.sending.talks {
        parts.push(count(pairs.len(), "pair"));
    }
    if let Some(jobs) = snapshot.jobs.listed() {
        parts.push(count(job_count(jobs), "job"));
    }
    parts.join(" · ")
}
/// How many jobs the read holds: past the bounded read, `256+`.
fn job_count(jobs: &crate::cron_service::rows::JobRows) -> String {
    format!("{}{}", jobs.rows.len(), if jobs.more { "+" } else { "" })
}
/// Why a held job waits, by name: the plan, the owner's focus, a member setting or Base.
fn hold_reason(snapshot: &Snapshot, job: &JobRow) -> Option<String> {
    let hold = job.hold.as_ref()?;
    Some(match hold.kind.as_str() {
        "plan" => hold.plan_id.as_deref().map_or_else(
            || "a plan".to_owned(),
            |id| snapshot.document.plan_name(id).to_owned(),
        ),
        "focus" => format!("{} focus", job.owner_name.as_deref().unwrap_or("owner")),
        "member" => "member setting".to_owned(),
        _ => "Base".to_owned(),
    })
}
/// A job's state as its words and role: the one place these are chosen.
fn job_state(snapshot: &Snapshot, job: &JobRow) -> (String, &'static str, Role) {
    match job.state {
        JobState::Ready => ("● ready".into(), "● ready", Role::Working),
        JobState::Held => (
            hold_reason(snapshot, job)
                .map_or_else(|| "◆ held".to_owned(), |why| format!("◆ held · {why}")),
            "◆ held",
            Role::Waiting,
        ),
        JobState::Paused => {
            let by = job.paused_by.as_deref().and_then(|id| {
                snapshot
                    .document
                    .members
                    .iter()
                    .find(|m| m.identity_id == id)
                    .map(|m| m.name.clone())
            });
            (
                by.map_or_else(|| "⏸ paused".to_owned(), |by| format!("⏸ paused by {by}")),
                "⏸ paused",
                Role::Muted,
            )
        }
        JobState::NoOwner => ("○ no owner".into(), "○ no owner", Role::Muted),
    }
}
fn job_next(snapshot: &Snapshot, job: &JobRow) -> String {
    job.next_ms()
        .map_or_else(|| "—".to_owned(), |at| snapshot.clock(at))
}
/// The Jobs section: one row per job Core lists, in the snapshot's order.
fn job_rows(frame: &mut Frame, app: &App, snapshot: &Snapshot, area: Rect) {
    let look = app.look();
    let state = &app.orchestration;
    let jobs = match &snapshot.jobs {
        super::model::Jobs::Listed(jobs) => jobs,
        super::model::Jobs::Unavailable => return,
        super::model::Jobs::Failed(reason) => {
            super::super::section_rule::paint(
                frame.buffer_mut(),
                line(area, area.y),
                "Jobs",
                Line::default(),
                state.focus() == super::Section::Jobs,
                look,
            );
            let body = Rect::new(
                area.x,
                area.y + 1,
                area.width,
                area.height.saturating_sub(1),
            );
            failed(
                frame,
                app,
                body,
                &format!("✕ Could not read jobs · {reason}"),
            );
            return;
        }
    };
    let count = |s: JobState| jobs.rows.iter().filter(|j| j.state == s).count();
    let mut note: Vec<String> = [
        (count(JobState::Ready), "ready"),
        (count(JobState::Held), "held"),
        (count(JobState::Paused), "paused"),
        (count(JobState::NoOwner), "no owner"),
    ]
    .into_iter()
    .filter(|(n, _)| *n > 0)
    .map(|(n, word)| format!("{n} {word}"))
    .collect();
    if !state.follow_now {
        note.push("now".into());
    }
    super::super::section_rule::paint(
        frame.buffer_mut(),
        line(area, area.y),
        &format!("Jobs · {}", job_count(jobs)),
        Line::styled(note.join(" · "), look.role(Role::Muted)),
        state.focus() == super::Section::Jobs,
        look,
    );
    let body = Rect::new(
        area.x,
        area.y + 1,
        area.width,
        area.height.saturating_sub(1),
    );
    if jobs.rows.is_empty() {
        empty(frame, app, body, "No jobs · tmt ops sq cron add …", None);
        return;
    }
    // Columns sized to their widest value; the title yields first, and any cut ends in `…`.
    let states: Vec<(String, Role)> = jobs
        .rows
        .iter()
        .map(|job| {
            let (words, _, role) = job_state(snapshot, job);
            (words, role)
        })
        .collect();
    let nexts: Vec<String> = jobs
        .rows
        .iter()
        .map(|job| job_next(snapshot, job))
        .collect();
    let widest = |header: &str, values: &mut dyn Iterator<Item = &str>| {
        values
            .map(UnicodeWidthStr::width)
            .fold(header.width(), usize::max)
    };
    let id_w = widest("ID", &mut jobs.rows.iter().map(|j| j.display_id.as_str()));
    let owner_w = widest(
        "OWNER",
        &mut jobs
            .rows
            .iter()
            .map(|j| j.owner_name.as_deref().unwrap_or("—")),
    );
    let schedule_w = widest(
        "SCHEDULE",
        &mut jobs.rows.iter().map(|j| j.schedule.as_str()),
    );
    let next_w = widest("NEXT", &mut nexts.iter().map(String::as_str));
    let title_full = widest("TITLE", &mut jobs.rows.iter().map(JobRow::name));
    let state_full = widest("STATE", &mut states.iter().map(|(w, _)| w.as_str()));
    // A leading space, one between columns and one gutter before the divider.
    let fixed = 1 + id_w + 1 + owner_w + 1 + schedule_w + 1 + next_w + 1;
    let room_w = usize::from(area.width).saturating_sub(fixed + 2);
    let title_w = room_w
        .saturating_sub(state_full)
        .clamp(5.min(title_full), title_full);
    let state_w = room_w.saturating_sub(title_w);
    let columns = |id: &str, owner: &str, title: &str, schedule: &str, next: &str| {
        format!(
            " {} {} {} {} {} ",
            cell(id, id_w),
            cell(owner, owner_w),
            cell(title, title_w),
            cell(schedule, schedule_w),
            cell(next, next_w),
        )
    };
    let state_x = (fixed + title_w + 1) as u16;
    text(
        frame,
        app,
        line(body, body.y),
        &format!(
            "{}STATE",
            columns("ID", "OWNER", "TITLE", "SCHEDULE", "NEXT")
        ),
        Role::Muted,
    );
    let room = usize::from(body.height.saturating_sub(1));
    let selected = jobs
        .rows
        .iter()
        .position(|job| Some(&job.job_id) == state.job.as_ref())
        .unwrap_or(0);
    let focused = state.focus() == super::Section::Jobs;
    let (start, shown, above, below) = window(jobs.rows.len(), room, focused.then_some(selected));
    let mut y = body.y + 1;
    let hint = |frame: &mut Frame, y: u16, hidden: usize, direction| {
        text(
            frame,
            app,
            Rect::new(area.x + 1, y, area.width.saturating_sub(2), 1),
            &MoreHint::label(hidden as u64, direction, false),
            Role::Muted,
        );
    };
    if above > 0 {
        hint(frame, y, above, MoreDirection::Up);
        y += 1;
    }
    for (index, job) in jobs.rows.iter().enumerate().skip(start).take(shown) {
        let chosen = focused && index == selected;
        let row = Rect::new(area.x, y, area.width, 1);
        let (words, role) = &states[index];
        let base = look.selected(chosen, look.role(Role::Text));
        strip::paint_left(
            frame.buffer_mut(),
            row,
            Line::from(vec![
                Span::styled(
                    columns(
                        &job.display_id,
                        job.owner_name.as_deref().unwrap_or("—"),
                        job.name(),
                        &job.schedule,
                        &nexts[index],
                    ),
                    base,
                ),
                Span::styled(
                    cell(words, state_w),
                    look.selected(chosen, look.role(*role)),
                ),
            ]),
        );
        if chosen {
            app.workspace_state_cells.borrow_mut().push(Rect::new(
                row.x + state_x,
                row.y,
                state_w as u16,
                1,
            ));
        }
        state.hits.borrow_mut().push((row, Control::Job(index)));
        y += 1;
    }
    if below > 0 {
        hint(frame, y, below, MoreDirection::Down);
    }
}
/// Which rows of `len` fit in `room` with `selected` shown: (first, shown, hidden above, hidden
/// below). A count of hidden rows takes a row of its own at the top or bottom.
fn window(len: usize, room: usize, selected: Option<usize>) -> (usize, usize, usize, usize) {
    if len <= room {
        return (0, len, 0, 0);
    }
    if room < 2 {
        // No room for a count: the selected row alone.
        let at = selected.unwrap_or(0).min(len - 1);
        return (at, room, 0, 0);
    }
    let selected = selected.unwrap_or(0);
    // Room for rows with a count below only.
    let rows = room.saturating_sub(1);
    if selected < rows {
        return (0, rows, 0, len - rows);
    }
    // Room with a count above; and below, unless the window reaches the end.
    let rows = room.saturating_sub(2).max(1);
    let start = selected + 1 - rows.min(selected + 1);
    if start + rows >= len {
        let rows = room.saturating_sub(1).max(1);
        let start = len - rows;
        return (start, rows, start, 0);
    }
    (start, rows, start, len - start - rows)
}
/// The inspector: the selected route, then the selected member, one key/value line per field with
/// where it comes from. Lines that do not fit end in a count of what is below.
fn inspector(frame: &mut Frame, app: &App, snapshot: Option<&Snapshot>, area: Rect) {
    place(frame, app, inspector_lines(app, snapshot, area.width), area);
}
/// What the inspector shows, as lines: the selected plan or job when one is focused, else the
/// selected route and member.
fn inspector_lines(app: &App, snapshot: Option<&Snapshot>, width: u16) -> Vec<InspectorLine> {
    let look = app.look();
    let member = snapshot.and_then(|snapshot| {
        snapshot
            .document
            .members
            .iter()
            .find(|m| Some(&m.identity_id) == app.orchestration.selected.as_ref())
    });
    if let Some(snapshot) = snapshot
        && let Some(plan) = app
            .orchestration
            .selected_plan()
            .filter(|_| app.orchestration.plans)
            .filter(|_| app.orchestration.focus() == super::Section::Routes)
    {
        return plan_lines(app, snapshot, plan);
    }
    if let Some(snapshot) = snapshot
        && let Some(job) = app
            .orchestration
            .selected_job()
            .filter(|_| app.orchestration.focus() == super::Section::Jobs)
    {
        return job_lines(app, snapshot, job, width);
    }
    let (Some(snapshot), Some(member)) = (snapshot, member) else {
        return vec![InspectorLine::Rule(
            if snapshot.is_some_and(|s| s.document.members.is_empty()) {
                "No member selected"
            } else {
                "Details"
            }
            .into(),
            Line::default(),
        )];
    };
    let mut lines: Vec<InspectorLine> = Vec::new();
    let target = snapshot
        .document
        .members
        .iter()
        .find(|m| Some(&m.identity_id) == app.orchestration.target.as_ref())
        .filter(|t| t.identity_id != member.identity_id)
        .filter(|_| !app.orchestration.plans);
    if let (Some(to), Some(_)) = (target, &snapshot.sending.routes) {
        let route = snapshot.sending.route(&member.identity_id, &to.identity_id);
        let (note, role) = match route.map(|r| &r.verdict) {
            None => ("not read", Role::Muted),
            Some(Verdict::Allowed) => ("● allowed", Role::Working),
            Some(Verdict::Blocked) => ("✕ not sent", Role::Blocked),
            Some(Verdict::NeedsPerson) => ("◆ held", Role::Waiting),
        };
        lines.push(InspectorLine::Rule(
            format!("{} → {}", member.name, to.name),
            Line::styled(note, look.role(role)),
        ));
        lines.push(InspectorLine::Row(
            "Sending",
            sending_word(&member.effective.sending.value).to_owned(),
            Role::Text,
            Some(
                snapshot
                    .document
                    .source_label(&member.effective.sending.source),
            ),
        ));
        match route {
            None => lines.push(InspectorLine::Row(
                "Result",
                "not read · filter the members".into(),
                Role::Muted,
                None,
            )),
            Some(route) => {
                let (result, role) = match route.verdict {
                    Verdict::Allowed => {
                        (format!("delivered · {}", receiving_label(to)), Role::Text)
                    }
                    Verdict::Blocked => ("✕ not sent, explained".to_owned(), Role::Blocked),
                    Verdict::NeedsPerson => ("◆ held · needs a person".to_owned(), Role::Waiting),
                };
                lines.push(InspectorLine::Row("Result", result, role, None));
                match &route.source {
                    RouteSource::Grant { until_ms } => lines.push(InspectorLine::Row(
                        "Until",
                        snapshot.clock(*until_ms),
                        Role::Text,
                        Some("allow once".into()),
                    )),
                    RouteSource::Policy(source) => {
                        if let Some(slot) = &source.slot {
                            lines.push(InspectorLine::Row(
                                "Until",
                                snapshot.clock(slot.end_ms),
                                Role::Text,
                                Some(format!(
                                    "when {} ends",
                                    snapshot.document.source_label(source)
                                )),
                            ));
                        }
                    }
                }
            }
        }
        if let Some(pair) = snapshot.sending.pair(&member.identity_id, &to.identity_id) {
            lines.push(InspectorLine::Row(
                "Talks",
                format!(
                    "{} / {} this hour{}",
                    pair.count,
                    pair.limit
                        .map_or_else(|| "unlimited".to_owned(), |l| l.to_string()),
                    if pair.held {
                        format!(" · {} held", pair.held_count)
                    } else {
                        String::new()
                    }
                ),
                if pair.held { Role::Waiting } else { Role::Text },
                None,
            ));
        }
        let (blocked, held) = app.orchestration.cell_actions();
        if blocked && snapshot.writes {
            let until = member.next_change_at_ms.map_or_else(
                || "for up to 24 hours".to_owned(),
                |end| format!("until {}", snapshot.clock(end)),
            );
            lines.push(InspectorLine::Button(
                super::super::keycap::key(app, Ui::AllowOnce, "a"),
                format!("Allow once {until}"),
                Control::Allow,
            ));
        }
        if held && snapshot.writes {
            lines.push(InspectorLine::Button(
                super::super::keycap::key(app, Ui::ReleaseHeld, "r"),
                "Release held".into(),
                Control::Resume,
            ));
        }
        lines.push(InspectorLine::Blank);
    }
    let e = &member.effective;
    let (mark, word, state_role) = state_mark(&e.state.value);
    lines.push(InspectorLine::Rule(
        member.name.clone(),
        Line::styled(format!("{mark} {word}"), look.role(state_role)),
    ));
    let source = |source: &Source| Some(snapshot.document.source_label(source));
    lines.push(InspectorLine::Row(
        "State",
        format!("{mark} {word}"),
        state_role,
        source(&e.state.source),
    ));
    lines.push(InspectorLine::Row(
        "Receiving",
        receiving_label(member),
        if e.receiving.available {
            Role::Text
        } else {
            Role::Dim
        },
        source(&e.receiving.source),
    ));
    if !e.receiving.available {
        if let Some(proposed) = &e.receiving.proposed_value {
            lines.push(InspectorLine::Row(
                "Proposed",
                proposed.label(),
                Role::Waiting,
                Some("not published yet".into()),
            ));
        }
        lines.push(InspectorLine::Text(
            "Digest has not published its settings yet.".into(),
            Role::Waiting,
        ));
    }
    lines.push(InspectorLine::Row(
        "Sending",
        sending_word(&e.sending.value).to_owned(),
        Role::Text,
        source(&e.sending.source),
    ));
    lines.push(InspectorLine::Row(
        "Routine",
        e.routine.value.clone(),
        Role::Text,
        source(&e.routine.source),
    ));
    lines.push(InspectorLine::Row(
        "Talk limit",
        e.talk_limit
            .value
            .map_or_else(|| "unlimited".into(), |n| format!("{n} / hour")),
        Role::Text,
        source(&e.talk_limit.source),
    ));
    if let Some(next) = member.next_change_at_ms {
        lines.push(InspectorLine::Row(
            "Next change",
            snapshot.clock(next),
            Role::Text,
            None,
        ));
    }
    if !member.active_plans.is_empty() {
        lines.push(InspectorLine::Row(
            "Plans",
            member
                .active_plans
                .iter()
                .map(|id| snapshot.document.plan_name(id))
                .collect::<Vec<_>>()
                .join(", "),
            Role::Text,
            None,
        ));
    }
    if let Some(jobs) = snapshot.jobs.listed() {
        let own: Vec<&JobRow> = jobs
            .rows
            .iter()
            .filter(|job| job.owner_id.as_ref() == Some(&member.identity_id))
            .collect();
        if !own.is_empty() {
            lines.push(InspectorLine::Blank);
            lines.push(InspectorLine::Rule(
                format!("Jobs of {} · {}", member.name, own.len()),
                Line::default(),
            ));
            for job in own {
                let (words, _, role) = job_state(snapshot, job);
                lines.push(InspectorLine::Styled(Line::from(vec![
                    Span::styled(
                        format!(
                            " {} {} {} {} ",
                            cell(&job.display_id, 4),
                            cell(job.name(), 16),
                            cell(&job.schedule, 13),
                            cell(&job_next(snapshot, job), 9),
                        ),
                        look.role(Role::Text),
                    ),
                    Span::styled(words, look.role(role)),
                ])));
            }
        }
    }
    lines
}
/// How many rows `lines` take, with two Row lines side by side when `two`.
fn stacked_height(lines: &[InspectorLine], two: bool) -> u16 {
    let mut rows = 0u16;
    let mut index = 0;
    while index < lines.len() {
        let pair = two
            && matches!(lines[index], InspectorLine::Row(..))
            && matches!(lines.get(index + 1), Some(InspectorLine::Row(..)));
        index += if pair { 2 } else { 1 };
        rows += 1;
    }
    rows
}
/// The stacked inspector under the first section: as `place`, with consecutive key/value rows
/// two to a line when `two` (90 columns and wider).
fn place_columns(frame: &mut Frame, app: &App, lines: Vec<InspectorLine>, area: Rect, two: bool) {
    if !two {
        return place(frame, app, lines, area);
    }
    let mut slots: Vec<Vec<InspectorLine>> = Vec::new();
    let mut lines = lines.into_iter().peekable();
    while let Some(first) = lines.next() {
        let pair = matches!(first, InspectorLine::Row(..))
            && matches!(lines.peek(), Some(InspectorLine::Row(..)));
        let mut slot = vec![first];
        if pair {
            slot.extend(lines.next());
        }
        slots.push(slot);
    }
    let rows = usize::from(area.height);
    let (shown, hidden) = if slots.len() > rows {
        let shown = rows.saturating_sub(1);
        (shown, slots[shown..].iter().map(Vec::len).sum::<usize>())
    } else {
        (slots.len(), 0)
    };
    let half = area.width / 2;
    for (offset, slot) in slots.into_iter().take(shown).enumerate() {
        let row = line(area, area.y + offset as u16);
        let paired = slot.len() == 2;
        for (index, painted) in slot.into_iter().enumerate() {
            let rect = if !paired {
                row
            } else if index == 0 {
                Rect { width: half, ..row }
            } else {
                Rect::new(row.x + half, row.y, row.width - half, 1)
            };
            painted.paint(frame, app, rect);
        }
    }
    if hidden > 0 {
        text(
            frame,
            app,
            line(area, area.y + shown as u16),
            &format!(
                " {}",
                MoreHint::label(hidden as u64, MoreDirection::Down, false)
            ),
            Role::Muted,
        );
    }
}
/// The inspector lines from the top of `area`; what does not fit ends in a count of what is below.
fn place(frame: &mut Frame, app: &App, lines: Vec<InspectorLine>, area: Rect) {
    let rows = usize::from(area.height);
    let (shown, hidden) = if lines.len() > rows {
        (rows.saturating_sub(1), lines.len() - rows.saturating_sub(1))
    } else {
        (lines.len(), 0)
    };
    for (offset, painted) in lines.into_iter().take(shown).enumerate() {
        painted.paint(frame, app, line(area, area.y + offset as u16));
    }
    if hidden > 0 {
        text(
            frame,
            app,
            line(area, area.y + shown as u16),
            &format!(
                " {}",
                MoreHint::label(hidden as u64, MoreDirection::Down, false)
            ),
            Role::Muted,
        );
    }
}
/// The selected job: its schedule and next run, what holds it, its last run and message, then
/// what it offers. A job made with `tmt orch job` is read-only here.
fn job_lines(app: &App, snapshot: &Snapshot, job: &JobRow, width: u16) -> Vec<InspectorLine> {
    let look = app.look();
    let (_, mark, role) = job_state(snapshot, job);
    let mut lines = vec![InspectorLine::Rule(
        format!("{} · {}", job.display_id, job.name()),
        Line::styled(mark, look.role(role)),
    )];
    lines.push(InspectorLine::Row(
        "Owner",
        job.owner_name.clone().unwrap_or_else(|| "no owner".into()),
        if job.owner_name.is_some() {
            Role::Text
        } else {
            Role::Muted
        },
        None,
    ));
    lines.push(InspectorLine::Row(
        "Schedule",
        job.schedule.clone(),
        Role::Text,
        None,
    ));
    let reason = hold_reason(snapshot, job);
    lines.push(InspectorLine::Row(
        "Next",
        job_next(snapshot, job),
        Role::Text,
        match (
            &job.state,
            &reason,
            job.hold.as_ref().and_then(|h| h.until_ms),
        ) {
            (JobState::Held, Some(why), Some(_)) => Some(format!("when {why} ends")),
            _ => None,
        },
    ));
    if let (Some(why), Some(hold)) = (reason, &job.hold) {
        lines.push(InspectorLine::Row(
            "Held by",
            why,
            Role::Waiting,
            Some(hold.kind.clone()),
        ));
    }
    if job.state == JobState::Paused {
        let (words, _, _) = job_state(snapshot, job);
        lines.push(InspectorLine::Row(
            "Paused",
            words.trim_start_matches("⏸ paused").trim().to_owned(),
            Role::Muted,
            None,
        ));
    }
    let (last, last_role) = match &job.last_run {
        None => ("no run recorded".to_owned(), Role::Muted),
        Some(run) => {
            let (words, role) = match run.acceptance.as_str() {
                "queued" => ("✓ accepted", Role::Text),
                "recipient_unavailable" => ("✕ not accepted · owner unavailable", Role::Blocked),
                "route_restricted" => ("✕ not accepted · route restricted", Role::Blocked),
                "held_for_person" => ("◆ held for a person", Role::Waiting),
                other => (other, Role::Text),
            };
            (format!("{} {words}", snapshot.clock(run.at_ms)), role)
        }
    };
    lines.push(InspectorLine::Row("Last run", last, last_role, None));
    let message = app
        .orchestration
        .job_message
        .as_ref()
        .filter(|(id, _)| id == &job.job_id)
        .map_or(job.message_preview.as_str(), |(_, message)| {
            message.as_str()
        });
    let wrapped = super::super::notes::wrap(&safe(message), usize::from(width.saturating_sub(14)));
    for (index, part) in wrapped.into_iter().enumerate() {
        if index == 0 {
            lines.push(InspectorLine::Row("Message", part, Role::Text, None));
        } else {
            lines.push(InspectorLine::Row("", part, Role::Text, None));
        }
    }
    if job.key.is_none() {
        lines.push(InspectorLine::Text(
            "Made with tmt orch job; change it there.".into(),
            Role::Muted,
        ));
        return lines;
    }
    let key = |action, preferred| super::super::keycap::key(app, action, preferred);
    let mut buttons = Vec::new();
    match job.state {
        JobState::Paused => buttons.push((key(Ui::JobPause, "p"), "Resume", Control::JobPause)),
        JobState::NoOwner => {}
        _ => buttons.push((key(Ui::JobPause, "p"), "Pause", Control::JobPause)),
    }
    buttons.push((key(Ui::JobRun, "x"), "Run now", Control::JobRun));
    buttons.push((key(Ui::OrchestrationEdit, "e"), "Edit…", Control::JobEdit));
    buttons.push((key(Ui::JobNew, "n"), "New job…", Control::JobNew));
    lines.push(InspectorLine::Buttons(buttons));
    lines
}
/// The selected plan: when, for whom, what it sets and leaves, whether it is in effect now, its
/// next start in the read range, its keys, and the members it applies to at the selected time.
fn plan_lines(app: &App, snapshot: &Snapshot, plan: &super::model::PlanRow) -> Vec<InspectorLine> {
    let look = app.look();
    let at = snapshot.document.at_ms;
    let key = |action, preferred| super::super::keycap::key(app, action, preferred);
    let (mark, role) = if plan.enabled {
        ("● on", Role::Working)
    } else {
        ("○ off", Role::Muted)
    };
    let mut lines = vec![InspectorLine::Rule(
        plan.name.clone(),
        Line::from(vec![
            Span::styled(mark, look.role(role)),
            Span::styled(
                format!(" · priority {}", plan.priority),
                look.role(Role::Text),
            ),
        ]),
    )];
    lines.push(InspectorLine::Row(
        "When",
        plan.when.clone(),
        Role::Text,
        None,
    ));
    let members = snapshot.plan_members(&plan.id);
    // Who it applies to now, as Core matched it; the target itself in parentheses.
    let who = if members.is_empty() || !plan.open {
        plan.who.clone()
    } else {
        format!(
            "{}  ({})",
            members
                .iter()
                .map(|m| m.name.as_str())
                .collect::<Vec<_>>()
                .join(", "),
            plan.who
        )
    };
    lines.push(InspectorLine::Row("Who", who, Role::Text, None));
    lines.push(InspectorLine::Row(
        "Sets",
        plan.sets.clone(),
        Role::Text,
        None,
    ));
    if !plan.leaves.is_empty() {
        // While it is in effect, the left fields' sources are what its members show.
        let mut from: Vec<String> = Vec::new();
        for member in &members {
            let e = &member.effective;
            for (word, source) in [
                ("state", &e.state.source),
                ("sending", &e.sending.source),
                ("receiving", &e.receiving.source),
                ("routine", &e.routine.source),
                ("talk limit", &e.talk_limit.source),
            ] {
                let label = snapshot.document.source_label(source);
                if plan.leaves.contains(&word) && !from.contains(&label) {
                    from.push(label);
                }
            }
        }
        let from = if from.is_empty() {
            "lower plans or Base".to_owned()
        } else {
            from.join(", ")
        };
        lines.push(InspectorLine::Row(
            "Leaves",
            plan.leaves.join(", "),
            Role::Text,
            Some(from),
        ));
    }
    let (until, next) = snapshot.plan_now_next(&plan.id);
    lines.push(match until {
        Some(end) => InspectorLine::Row(
            "Now",
            format!("in effect until {}", snapshot.clock(end)),
            Role::Text,
            None,
        ),
        None => InspectorLine::Row(
            "Now",
            format!("not in effect at {}", snapshot.clock(at)),
            Role::Muted,
            None,
        ),
    });
    let next = match next {
        Some(start) => snapshot.short(start),
        None => {
            // Past the read range: the range key that widens it.
            let wider = match app.orchestration.query.days {
                1 => key(Ui::OrchestrationWeek, "7"),
                7 => key(Ui::OrchestrationMonth, "0"),
                _ => None,
            };
            match wider {
                Some(k) => format!("not in this range · {k} widens"),
                None => "not in this range".into(),
            }
        }
    };
    lines.push(InspectorLine::Row("Next", next, Role::Text, None));
    lines.push(InspectorLine::Buttons(vec![
        (key(Ui::PlanOnly, "enter"), "Its members", Control::PlanOnly),
        (
            key(Ui::PlanToggle, "o"),
            if plan.enabled { "Turn off" } else { "Turn on" },
            Control::PlanToggle,
        ),
        (key(Ui::OrchestrationEdit, "e"), "Edit…", Control::PlanEdit),
    ]));
    lines.push(InspectorLine::Blank);
    lines.push(InspectorLine::Rule(
        format!(
            "Effect at {} · {} member{}",
            snapshot.clock(at),
            members.len(),
            if members.len() == 1 { "" } else { "s" }
        ),
        Line::default(),
    ));
    if members.is_empty() {
        lines.push(InspectorLine::Text(
            "No member at this time".into(),
            Role::Muted,
        ));
    }
    let name_w = members
        .iter()
        .map(|m| safe(&m.name).width())
        .max()
        .unwrap_or(0);
    for member in members {
        let (mark, word, role) = state_mark(&member.effective.state.value);
        lines.push(InspectorLine::Styled(Line::from(vec![
            Span::styled(
                format!(" {} ", cell(&member.name, name_w)),
                look.role(Role::Text),
            ),
            Span::styled(format!("{mark} {word:<6} "), look.role(role)),
            Span::styled(
                format!(
                    "{} {}",
                    cell(&receiving_label(member), 12),
                    sending_word(&member.effective.sending.value)
                ),
                look.role(Role::Text),
            ),
        ])));
    }
    lines
}
/// One inspector line before it is placed.
enum InspectorLine {
    Rule(String, Line<'static>),
    Row(&'static str, String, Role, Option<String>),
    Button(Option<String>, String, Control),
    /// Several keycap buttons on one line, as far as they fit.
    Buttons(Vec<(Option<String>, &'static str, Control)>),
    Text(String, Role),
    Styled(Line<'static>),
    Blank,
}
impl InspectorLine {
    fn paint(self, frame: &mut Frame, app: &App, area: Rect) {
        let look = app.look();
        if area.is_empty() {
            return;
        }
        match self {
            Self::Rule(title, note) => super::super::section_rule::paint(
                frame.buffer_mut(),
                area,
                &title,
                note,
                false,
                look,
            ),
            Self::Row(key, value, role, source) => {
                let shown = super::super::key_value::line(
                    &super::super::key_value::Row {
                        key,
                        value: super::super::key_value::Value::InRole(&value, role),
                        // Every inspector row keeps the sourced columns, with or without a source.
                        source: Some(source.as_deref().unwrap_or_default()),
                    },
                    usize::from(area.width),
                    look,
                );
                strip::paint_left(frame.buffer_mut(), area, shown);
            }
            Self::Button(key, label, control) => {
                let mut spans = vec![Span::raw(" ")];
                if let Some(key) = key {
                    spans.push(super::super::keycap::span(&key, false, look));
                    spans.push(Span::raw(" "));
                }
                spans.push(Span::styled(label, look.role(Role::Text)));
                let width = Line::from(spans.clone())
                    .width()
                    .min(usize::from(area.width)) as u16;
                strip::paint_left(frame.buffer_mut(), area, Line::from(spans));
                app.orchestration
                    .hits
                    .borrow_mut()
                    .push((Rect { width, ..area }, control));
            }
            Self::Buttons(buttons) => {
                let mut x = area.x + 1;
                for (key, label, control) in buttons {
                    let mut spans = Vec::new();
                    if let Some(key) = key {
                        spans.push(super::super::keycap::span(&key, false, look));
                        spans.push(Span::raw(" "));
                    }
                    spans.push(Span::styled(label, look.role(Role::Text)));
                    let width = Line::from(spans.clone()).width() as u16;
                    if x + width > area.right() {
                        break;
                    }
                    let rect = Rect::new(x, area.y, width, 1);
                    strip::paint_left(frame.buffer_mut(), rect, Line::from(spans));
                    app.orchestration.hits.borrow_mut().push((rect, control));
                    x += width + 3;
                }
            }
            Self::Styled(value) => strip::paint_left(
                frame.buffer_mut(),
                Rect::new(area.x, area.y, area.width, 1),
                value,
            ),
            Self::Text(value, role) => text(
                frame,
                app,
                Rect::new(area.x + 1, area.y, area.width.saturating_sub(2), 1),
                &value,
                role,
            ),
            Self::Blank => {}
        }
    }
}
