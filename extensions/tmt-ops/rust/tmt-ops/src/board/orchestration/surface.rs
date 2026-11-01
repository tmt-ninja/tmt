//! Held Orchestration facts through the shared Strip, button and row styles.
use super::{
    super::app::App,
    input::Control,
    model::{Receiving, RouteSource, Snapshot, Verdict},
};
use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    text::Line,
};
use tmt_cli_style::{
    Role,
    grid::{self, Align, Truncate},
};
use tmt_tui::components::strip;
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
pub(in crate::board) fn render(frame: &mut Frame, app: &App, area: Rect) {
    app.orchestration.invalidate();
    if area.width < 34 || area.height < 6 {
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
    let row = |y, height| Rect::new(area.x + 1, area.y + y, area.width.saturating_sub(2), height);
    let choices = [
        ("Day", Control::Range(1)),
        ("7 days", Control::Range(7)),
        ("30 days", Control::Range(30)),
        ("Plans", Control::Plans),
        ("Now", Control::Now),
    ];
    let buttons: Vec<_> = choices
        .iter()
        .map(|(label, _)| tmt_tui::components::Button::secondary(label))
        .collect();
    let hits = super::super::buttons::paint(
        app,
        frame.buffer_mut(),
        row(0, 1),
        &buttons,
        Align::Left,
        None,
    );
    for ((_, control), hit) in choices.into_iter().zip(hits) {
        if let Some(rect) = hit {
            state.hits.borrow_mut().push((rect, control));
        }
    }
    // What Core reports is said only once Core has answered.
    if let Some(snapshot) = state.snapshot() {
        text(
            frame,
            app,
            row(1, 1),
            if snapshot.sending.routes.is_some() {
                "From ↓ To → · who may message whom at the selected time"
            } else {
                "Member policies at selected time · routes are not available on this Core"
            },
            Role::Muted,
        );
    }
    if state.unavailable {
        text(
            frame,
            app,
            row(3, 1),
            "Orchestration is not available in this Core. Update Core to use this tab.",
            Role::Waiting,
        );
        return;
    }
    let Some(snapshot) = state.snapshot() else {
        text(
            frame,
            app,
            row(3, 1),
            state.failure.as_deref().unwrap_or("Loading Orchestration…"),
            if state.failure.is_some() {
                Role::Blocked
            } else {
                Role::Waiting
            },
        );
        return;
    };
    text(
        frame,
        app,
        row(2, 1),
        &format!(
            "{} · {} · {} · revision {}",
            snapshot.time(snapshot.document.at_ms),
            snapshot.document.time_zone,
            if state.follow_now {
                "following now"
            } else {
                "selected time"
            },
            snapshot.document.configuration_revision
        ),
        Role::Text,
    );
    let warning = state.failure.as_ref().map(|e| {
        format!(
            "Refresh failed · {e} · showing {}",
            snapshot.time(snapshot.document.observed_at_ms)
        )
    });
    text(
        frame,
        app,
        row(3, 1),
        &warning.unwrap_or_else(|| {
            let active = snapshot.document.timeline.iter().find(|i| {
                i.start_ms <= snapshot.document.at_ms && snapshot.document.at_ms < i.end_ms
            });
            active
                .map(|i| {
                    format!(
                        "{} → {} · {} active plans",
                        snapshot.time(i.start_ms),
                        snapshot.time(i.end_ms),
                        i.plan_ids.len()
                    )
                })
                .unwrap_or_else(|| "Base only · no active plan interval".into())
        }),
        if state.failure.is_some() {
            Role::Waiting
        } else {
            Role::Muted
        },
    );
    let content = Rect::new(
        area.x + 1,
        area.y + 5,
        area.width.saturating_sub(2),
        area.height.saturating_sub(5),
    );
    let [table, detail] = if area.width >= 110 {
        Layout::horizontal([Constraint::Percentage(55), Constraint::Percentage(45)]).areas(content)
    } else {
        [content, Rect::default()]
    };
    if state.plans {
        text(
            frame,
            app,
            table,
            "Plans · higher priority wins per configured field",
            Role::Muted,
        );
        if snapshot.document.plans.is_empty() {
            text(
                frame,
                app,
                Rect {
                    y: table.y + 1,
                    height: table.height.saturating_sub(1),
                    ..table
                },
                "Base only · no configured plans",
                Role::Text,
            );
        }
        let selected = snapshot
            .document
            .plans
            .iter()
            .position(|p| p["id"].as_str() == state.plan_selection.as_deref())
            .unwrap_or(0);
        let start = selected.saturating_sub(usize::from(table.height.saturating_sub(2)) / 2);
        for (index, plan) in snapshot
            .document
            .plans
            .iter()
            .enumerate()
            .skip(start)
            .take(usize::from(table.height.saturating_sub(2)))
        {
            let y = table.y + 1 + (index - start) as u16;
            let label = format!(
                "{} {} · priority {} · revision {}",
                if plan["enabled"].as_bool() == Some(true) {
                    "●"
                } else {
                    "○"
                },
                plan["name"].as_str().unwrap_or("?"),
                plan["priority"],
                plan["revision"]
            );
            let style = look.row_span(index == selected, look.role(Role::Text), false);
            let area = Rect::new(table.x, y, table.width.saturating_sub(1), 1);
            strip::paint_left(
                frame.buffer_mut(),
                area,
                Line::styled(cell(&label, usize::from(area.width)), style),
            );
            state.hits.borrow_mut().push((area, Control::Plan(index)));
        }
    } else if snapshot.sending.routes.is_some() {
        matrix(frame, app, snapshot, table);
    } else {
        text(
            frame,
            app,
            table,
            if table.width >= 70 {
                "MEMBER            STATE   RECEIVING       SENDING   ROUTINE"
            } else {
                "MEMBER            STATE   RECEIVING"
            },
            Role::Muted,
        );
        let selected = snapshot
            .document
            .members
            .iter()
            .position(|member| Some(&member.identity_id) == state.selected.as_ref())
            .unwrap_or(0);
        let start = selected.saturating_sub(usize::from(table.height.saturating_sub(2)) / 2);
        if snapshot.document.members.is_empty() {
            text(
                frame,
                app,
                Rect {
                    y: table.y + 1,
                    height: 1,
                    ..table
                },
                "No members match this query",
                Role::Muted,
            );
        }
        for (index, member) in snapshot
            .document
            .members
            .iter()
            .enumerate()
            .skip(start)
            .take(usize::from(table.height.saturating_sub(2)))
        {
            let receiving = member
                .effective
                .receiving
                .value
                .as_ref()
                .map(|r| r.label())
                .unwrap_or_else(|| "unavailable".into());
            let mut value = format!(
                "{} {} {}",
                cell(&member.name, 17),
                cell(&member.effective.state.value, 7),
                cell(&receiving, 15)
            );
            if table.width >= 70 {
                value.push_str(&format!(
                    " {} {}",
                    cell(&member.effective.sending.value, 9),
                    member.effective.routine.value
                ));
            }
            let area = Rect::new(
                table.x,
                table.y + 1 + (index - start) as u16,
                table.width.saturating_sub(1),
                1,
            );
            let style = look.row_span(index == selected, look.role(Role::Text), false);
            strip::paint_left(frame.buffer_mut(), area, Line::styled(value, style));
            state.hits.borrow_mut().push((area, Control::Member(index)));
        }
    }
    if table.height > 1 {
        text(
            frame,
            app,
            Rect::new(table.x, table.bottom() - 1, table.width, 1),
            "Jobs · not available yet",
            Role::Muted,
        );
    }
    if !detail.is_empty() {
        inspector(frame, app, snapshot, detail);
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
const NAME_WIDTH: u16 = 14;
const CELL_WIDTH: u16 = 9;
/// The route matrix: one row per sender, one column per recipient, crosshair on the
/// selection. Every cell is Core's verdict (`✕` blocked, `◆` needs a person) or, when
/// allowed, the recipient's receiving. Nothing is inferred here.
fn matrix(frame: &mut Frame, app: &App, snapshot: &Snapshot, area: Rect) {
    let state = &app.orchestration;
    let look = app.look();
    let members = &snapshot.document.members;
    let sending = &snapshot.sending;
    // Header, legend, talks and jobs lines take four rows.
    let rows = usize::from(area.height.saturating_sub(4));
    let columns = usize::from(area.width.saturating_sub(NAME_WIDTH) / CELL_WIDTH);
    if members.is_empty() || rows == 0 || columns == 0 {
        text(frame, app, area, "No members match this query", Role::Muted);
        return;
    }
    let index = |id: &Option<String>| {
        members
            .iter()
            .position(|m| Some(&m.identity_id) == id.as_ref())
            .unwrap_or(0)
    };
    let (row, column) = (index(&state.selected), index(&state.target));
    let first_row = row.saturating_sub(rows.saturating_sub(1));
    let first_column = column.saturating_sub(columns.saturating_sub(1));
    let line = |y: u16| Rect::new(area.x, area.y + y, area.width, 1);
    let mut header = cell("From ↓ To →", usize::from(NAME_WIDTH));
    for to in members.iter().skip(first_column).take(columns) {
        header.push_str(&cell(&to.name, usize::from(CELL_WIDTH)));
    }
    text(frame, app, line(0), &header, Role::Muted);
    for (r, from) in members.iter().enumerate().skip(first_row).take(rows) {
        let y = area.y + 1 + (r - first_row) as u16;
        strip::paint_left(
            frame.buffer_mut(),
            Rect::new(area.x, y, NAME_WIDTH, 1),
            Line::styled(
                cell(&from.name, usize::from(NAME_WIDTH)),
                look.row_span(r == row, look.role(Role::Text), false),
            ),
        );
        for (c, to) in members.iter().enumerate().skip(first_column).take(columns) {
            let word = if r == c {
                "—".to_owned()
            } else {
                match sending.route(&from.identity_id, &to.identity_id) {
                    None => "·".into(),
                    Some(route) => match route.verdict {
                        Verdict::Blocked => "✕".into(),
                        Verdict::NeedsPerson => "◆".into(),
                        Verdict::Allowed => receiving_cell(to.effective.receiving.value.as_ref()),
                    },
                }
            };
            let x = area.x + NAME_WIDTH + ((c - first_column) as u16) * CELL_WIDTH;
            let rect = Rect::new(x, y, CELL_WIDTH, 1);
            strip::paint_left(
                frame.buffer_mut(),
                rect,
                Line::styled(
                    cell(&word, usize::from(CELL_WIDTH)),
                    look.row_span(r == row && c == column, look.role(Role::Text), false),
                ),
            );
            state.hits.borrow_mut().push((rect, Control::Cell(r, c)));
        }
    }
    let hidden_rows = members.len().saturating_sub(first_row + rows);
    let hidden_columns = members.len().saturating_sub(first_column + columns);
    let mut legend =
        String::from("Dir direct · B batch · Urg urgent · ✕ sender rule · ◆ needs a person");
    if hidden_rows + hidden_columns > 0 || sending.truncated {
        legend = format!("↓ {hidden_rows} more · → {hidden_columns} more · {legend}");
    }
    if sending.truncated {
        legend = format!("Too many members for one matrix; filter with / · {legend}");
    }
    text(frame, app, line(area.height - 3), &legend, Role::Muted);
    let talks = match &sending.talks {
        None => "Talks this hour · not available on this Core".to_owned(),
        Some(pairs) if pairs.is_empty() => "Talks this hour · none".to_owned(),
        Some(pairs) => {
            let shown: Vec<_> = pairs
                .iter()
                .map(|p| {
                    let limit = p.limit.map_or_else(|| "—".to_owned(), |l| l.to_string());
                    format!(
                        "{} ⇄ {} {}/{}{}",
                        p.names.0,
                        p.names.1,
                        p.count,
                        limit,
                        if p.held { " ◆ held" } else { "" }
                    )
                })
                .collect();
            format!("Talks this hour · {}", shown.join("   "))
        }
    };
    text(frame, app, line(area.height - 2), &talks, Role::Text);
}
fn inspector(frame: &mut Frame, app: &App, snapshot: &Snapshot, area: Rect) {
    let Some(member) = snapshot
        .document
        .members
        .iter()
        .find(|m| Some(&m.identity_id) == app.orchestration.selected.as_ref())
    else {
        return;
    };
    let e = &member.effective;
    let mut lines = Vec::new();
    let target = snapshot
        .document
        .members
        .iter()
        .find(|m| Some(&m.identity_id) == app.orchestration.target.as_ref())
        .filter(|t| t.identity_id != member.identity_id);
    if let (Some(to), Some(_)) = (target, &snapshot.sending.routes) {
        lines.push((
            format!(
                "{} → {} at {}",
                member.name,
                to.name,
                snapshot.time(snapshot.document.at_ms)
            ),
            Role::Text,
        ));
        match snapshot.sending.route(&member.identity_id, &to.identity_id) {
            None => lines.push(("Route · not read (filter the members)".into(), Role::Muted)),
            Some(route) => {
                let (result, role) = match route.verdict {
                    Verdict::Allowed => ("allowed", Role::Text),
                    Verdict::Blocked => ("not sent, explained · a allows once", Role::Blocked),
                    Verdict::NeedsPerson => ("held · needs a person · r releases", Role::Waiting),
                };
                lines.push((format!("Result · {result}"), role));
                lines.push((
                    match &route.source {
                        RouteSource::Grant { until_ms } => {
                            format!("from allow once until {}", snapshot.time(*until_ms))
                        }
                        RouteSource::Policy(source) => {
                            format!("from {}", snapshot.document.source_label(source))
                        }
                    },
                    Role::Muted,
                ));
            }
        }
        if let Some(pair) = snapshot.sending.pair(&member.identity_id, &to.identity_id) {
            lines.push((
                format!(
                    "Talks this hour · {}/{}{}",
                    pair.count,
                    pair.limit
                        .map_or_else(|| "unlimited".to_owned(), |l| l.to_string()),
                    if pair.held {
                        format!(" · {} held", pair.held_count)
                    } else {
                        String::new()
                    }
                ),
                Role::Muted,
            ));
        }
        lines.push((String::new(), Role::Muted));
    }
    lines.push((member.name.clone(), Role::Text));
    lines.push((member.identity_id.clone(), Role::Muted));
    for (name, value, source) in [
        ("State", e.state.value.clone(), &e.state.source),
        (
            "Receiving",
            e.receiving
                .value
                .as_ref()
                .map(|r| r.label())
                .unwrap_or_else(|| "unavailable".into()),
            &e.receiving.source,
        ),
        (
            "Configured sending",
            e.sending.value.clone(),
            &e.sending.source,
        ),
        (
            "Configured routine",
            e.routine.value.clone(),
            &e.routine.source,
        ),
        (
            "Configured talk limit",
            e.talk_limit
                .value
                .map(|n| format!("{n}/h"))
                .unwrap_or_else(|| "unlimited".into()),
            &e.talk_limit.source,
        ),
    ] {
        lines.push((format!("{name} · {value}"), Role::Text));
        lines.push((
            format!("from {}", snapshot.document.source_label(source)),
            Role::Muted,
        ));
        if let Some(id) = &source.identity_id {
            lines.push((format!("member source · {id}"), Role::Muted));
        }
        if let Some(slot) = &source.slot {
            lines.push((
                format!(
                    "{} → {}",
                    snapshot.time(slot.start_ms),
                    snapshot.time(slot.end_ms)
                ),
                Role::Muted,
            ));
        }
    }
    if !e.receiving.available {
        if let Some(proposed) = &e.receiving.proposed_value {
            lines.push((
                format!("Proposed receiving · {}", proposed.label()),
                Role::Waiting,
            ));
        }
        lines.push((
            "Digest has not published its settings yet.".into(),
            Role::Waiting,
        ));
    }
    if let Some(next) = member.next_change_at_ms {
        lines.push((
            format!("Next change · {}", snapshot.time(next)),
            Role::Muted,
        ));
    }
    if !member.active_plans.is_empty() {
        lines.push((
            format!(
                "Active plans · {}",
                member
                    .active_plans
                    .iter()
                    .map(|id| snapshot.document.plan_name(id))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            Role::Muted,
        ));
    }
    if let Some((id, why)) = &app.orchestration.why
        && id == &member.identity_id
    {
        lines.push((String::new(), Role::Muted));
        lines.extend(why.iter().map(|line| (line.clone(), Role::Muted)));
    }
    let mut y = area.y;
    for (line, role) in lines {
        for line in super::super::notes::wrap(&safe(&line), usize::from(area.width)) {
            if y >= area.bottom() {
                return;
            }
            text(frame, app, Rect::new(area.x, y, area.width, 1), &line, role);
            y += 1;
        }
    }
}
