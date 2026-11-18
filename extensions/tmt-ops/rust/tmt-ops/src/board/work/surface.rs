use ratatui::crossterm::event::{
    KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind,
};
use ratatui::{
    Frame,
    layout::Rect,
    style::Modifier,
    text::{Line, Span},
};
use tmt_cli_style::Role;
use tmt_tui::components::strip;

use crate::board::{
    app::{App, Choice, Effect, Menu, MenuEntry},
    shell::OpsTab,
    view::{fit, scene},
};

use super::{Item, List, Status};

#[derive(Clone, Debug)]
pub(in crate::board) enum Hit {
    Row(String),
    Open(String),
    Move(String),
    Project,
    Recent,
    More(Option<String>),
    Period,
}

const MAX_ROWS: usize = 5;
const DAY: i64 = 86_400_000;
const HOUR: i64 = 3_600_000;
const GUTTER: usize = 3;
const NUMBER: usize = 13;
const STATUS: usize = 22;
const OWNER: usize = 16;
const AGE: usize = 5;
const WIDE: usize = 145;
const TABLE: usize = 69;
const PERIODS: [&str; 3] = ["Today", "7 days", "30 days"];

fn in_project(item: &Item, project: Option<&str>) -> bool {
    project.is_none_or(|name| item.projects.iter().any(|value| value == name))
}

struct Row<'a> {
    label: String,
    role: Role,
    item: Option<&'a Item>,
    hit: Option<Hit>,
    selection: Option<String>,
}

impl Row<'_> {
    fn label(label: impl Into<String>, role: Role) -> Self {
        Self {
            label: label.into(),
            role,
            item: None,
            hit: None,
            selection: None,
        }
    }
}

impl<'a> Row<'a> {
    fn item(item: &'a Item, section: &str) -> Self {
        Self {
            label: String::new(),
            role: Role::Text,
            item: Some(item),
            hit: None,
            selection: Some(format!("{section}:{}", item.key)),
        }
    }
}

fn counts(items: impl Iterator<Item = Status>, include_zeros: bool) -> String {
    let mut counts = [0; 7];
    for status in items {
        if let Some(index) = status.overview() {
            counts[index] += 1;
        }
    }
    let total: usize = counts.iter().sum();
    let mut words = vec![format!("{total} open")];
    for (index, name) in [
        "In progress",
        "Waiting for CI or release",
        "Needs you",
        "Blocked",
        "Possibly stalled",
        "Discussing",
        "Not checked yet",
    ]
    .into_iter()
    .enumerate()
    {
        if counts[index] > 0 || include_zeros && index < 5 {
            words.push(format!("{} {name}", counts[index]));
        }
    }
    words.join(" · ")
}

fn wrap_counts(summary: &str, width: usize) -> Vec<String> {
    use unicode_width::UnicodeWidthStr;

    const SEPARATOR: &str = " · ";
    let mut lines = Vec::new();
    let mut line = String::new();
    for item in summary.split(SEPARATOR) {
        if !line.is_empty() {
            if line.width() + SEPARATOR.width() + item.width() > width {
                lines.push(std::mem::take(&mut line));
            } else {
                line.push_str(SEPARATOR);
            }
        }
        line.push_str(item);
    }
    lines.push(line);
    lines
}

fn local_start(now: i64, zone: &jiff::tz::TimeZone, days_back: i32) -> Option<i64> {
    let date = jiff::Timestamp::from_millisecond(now)
        .ok()?
        .to_zoned(zone.clone())
        .date();
    let date = date.checked_sub(jiff::Span::new().days(days_back)).ok()?;
    Some(
        zone.to_zoned(date.at(0, 0, 0, 0))
            .ok()?
            .timestamp()
            .as_millisecond(),
    )
}

fn done_counts<'a>(
    items: impl Iterator<Item = &'a Item>,
    now: i64,
    zone: &jiff::tz::TimeZone,
) -> [usize; 3] {
    let bounds = [0, 6, 29].map(|days| local_start(now, zone, days));
    let mut totals = [0; 3];
    for at in items.filter_map(|item| item.done).filter(|&at| at <= now) {
        for (total, bound) in totals.iter_mut().zip(bounds) {
            if bound.is_some_and(|start| at >= start) {
                *total += 1;
            }
        }
    }
    totals
}

fn done_chart(list: &List, state: &super::State, now: i64, zone: &jiff::tz::TimeZone) -> String {
    let days = [1, 7, 30][state.period];
    let start = |days_back| local_start(now, zone, days_back).unwrap_or(now);
    let from = if days == 1 { start(0) } else { start(days - 1) };
    let hours = if days == 1 {
        jiff::Timestamp::from_millisecond(now).map_or(1, |timestamp| {
            usize::try_from(timestamp.to_zoned(zone.clone()).hour()).unwrap_or(0) + 1
        })
    } else {
        days as usize
    };
    let bounds: Vec<_> = if days == 1 {
        (0..hours).map(|index| from + index as i64 * HOUR).collect()
    } else {
        (0..days).rev().map(start).collect()
    };
    let mut cells = vec![0_u32; bounds.len()];
    for at in list
        .items
        .iter()
        .filter(|item| in_project(item, state.project.as_deref()))
        .filter_map(|item| item.done)
        .filter(|at| (from..=now).contains(at))
    {
        let index = bounds.partition_point(|&bound| bound <= at).checked_sub(1);
        if let Some(index) = index {
            cells[index] += 1;
        }
    }
    let top = cells.iter().copied().max().unwrap_or(0).max(1);
    let bars = ['·', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    cells
        .iter()
        .map(|&count| bars[(count * 8).div_ceil(top) as usize])
        .collect()
}

fn rows<'a>(
    list: &'a List,
    state: &super::State,
    now: i64,
    zone: &jiff::tz::TimeZone,
    width: usize,
    roster: Option<&crate::board::workspace::OpsRoster>,
) -> Vec<Row<'a>> {
    let filter = state.project.as_deref();
    let summary = counts(
        list.items
            .iter()
            .filter(|item| in_project(item, filter))
            .map(|item| item.status),
        true,
    );
    let mut rows: Vec<_> = wrap_counts(
        &summary,
        if width == 0 {
            usize::MAX
        } else {
            width.saturating_sub(1).max(1)
        },
    )
    .into_iter()
    .map(|text| Row::label(text, Role::Muted))
    .collect();
    if list.missing > 0 || list.omitted > 0 {
        let mut notes = Vec::new();
        if list.missing > 0 {
            notes.push(format!("{} summaries unavailable", list.missing));
        }
        if list.omitted > 0 {
            notes.push(if list.omitted == 1 {
                "To-dos omitted on 1 page".into()
            } else {
                format!("To-dos omitted on {} pages", list.omitted)
            });
        }
        rows.push(Row::label(notes.join(" · "), Role::Waiting));
    }
    if list.items.is_empty() && list.missing == 0 {
        rows.push(Row::label("No work yet.", Role::Muted));
    }
    let visible = || list.items.iter().filter(|item| in_project(item, filter));
    let moving: std::collections::BTreeSet<_> = visible()
        .filter(|item| item.status == Status::Working)
        .filter_map(|item| item.owner_name(roster))
        .collect();
    let oldest = |status, timestamp: fn(&Item) -> Option<i64>| {
        visible()
            .filter(|item| item.status == status)
            .filter_map(|item| Some((timestamp(item)?, &item.key, item)))
            .min_by_key(|&(at, key, _)| (at, key))
            .map(|(_, _, item)| item.number.as_deref().unwrap_or(&item.title))
    };
    let mut overview = Vec::new();
    if !moving.is_empty() {
        overview.push(format!(
            "Moving · {}",
            moving.into_iter().collect::<Vec<_>>().join(", ")
        ));
    }
    if let Some(item) = oldest(Status::Blocked, |item| item.blocked_since.or(item.last)) {
        overview.push(format!("Stuck longest · {item}"));
    }
    if let Some(item) = oldest(Status::Stalled, |item| item.last) {
        overview.push(format!("Quietest · {item}"));
    }
    if !overview.is_empty() {
        rows.push(Row::label(overview.join("   "), Role::Muted));
    }
    let selected_project = filter.map(Some);
    let mut groups = std::collections::BTreeMap::<Option<&str>, Vec<&Item>>::new();
    for item in visible() {
        if item.projects.is_empty() {
            groups.entry(None).or_default().push(item);
        } else {
            for name in item.projects.iter().map(|name| Some(name.as_str())) {
                groups.entry(name).or_default().push(item);
            }
        }
    }
    let mut headings = false;
    for project in list
        .projects
        .iter()
        .map(|name| Some(name.as_str()))
        .chain([None])
    {
        if selected_project.is_some_and(|selected| selected != project) {
            continue;
        }
        let section = format!("{project:?}");
        let mut open = Vec::new();
        let mut recent = false;
        for item in groups.remove(&project).into_iter().flatten() {
            if item.status != Status::Done {
                open.push(item);
            }
            recent |= item.done.is_some_and(|at| at <= now && now - at < 7 * DAY);
        }
        if open.is_empty() && !recent {
            continue;
        }
        rows.push(Row::label(
            format!(
                "── {} · {} ──",
                project.unwrap_or("No project"),
                counts(open.iter().map(|item| item.status), false)
            ),
            Role::Muted,
        ));
        if !headings && !open.is_empty() {
            headings = true;
            let heading = table_cells(
                width,
                ["NUMBER", "STATUS", "TITLE", "OWNER", "AGE", "NEXT / REASON"],
            );
            rows.push(Row::label(format!("  {heading}"), Role::Dim));
        }
        let order = project.and_then(|name| list.orders.get(name));
        if let Some(order) = order
            && filter.is_some()
        {
            let next = order.next(&open);
            let ranked: std::collections::BTreeSet<_> =
                next.iter().map(|item| item.key.as_str()).collect();
            rows.push(Row::label("── Now", Role::Muted));
            rows.extend(
                open.iter()
                    .filter(|item| super::order::now(item.status))
                    .map(|item| Row::item(item, &section)),
            );
            rows.push(Row::label("── Next", Role::Muted));
            rows.extend(next.into_iter().map(|item| Row::item(item, &section)));
            rows.push(Row::label("── No preference", Role::Muted));
            rows.extend(
                open.into_iter()
                    .filter(|item| {
                        !super::order::now(item.status) && !ranked.contains(item.key.as_str())
                    })
                    .map(|item| Row::item(item, &section)),
            );
            continue;
        }
        let preview = order.map(|order| {
            order
                .next(&open)
                .into_iter()
                .take(3)
                .map(|item| {
                    if width < WIDE {
                        item.number.as_deref().unwrap_or(&item.title)
                    } else {
                        &item.title
                    }
                })
                .collect::<Vec<_>>()
                .join(" → ")
        });
        let expanded = state.expanded.contains(&project.map(str::to_owned));
        let count = open.len();
        rows.extend(
            open.into_iter()
                .take(if expanded { count } else { MAX_ROWS })
                .map(|item| Row::item(item, &section)),
        );
        if count > MAX_ROWS {
            rows.push(Row {
                label: if expanded {
                    "Enter Show fewer".into()
                } else {
                    format!("Enter Show {} more", count - MAX_ROWS)
                },
                role: Role::Muted,
                item: None,
                hit: Some(Hit::More(project.map(str::to_owned))),
                selection: Some(format!("more:{section}")),
            });
        }
        if let Some(preview) = preview {
            let preview = if preview.is_empty() {
                "No ranked items"
            } else {
                &preview
            };
            rows.push(Row::label(format!("Next: {preview}"), Role::Muted));
        }
    }
    let [today, week, month] = done_counts(
        list.items.iter().filter(|item| in_project(item, filter)),
        now,
        zone,
    );
    rows.push(Row {
        label: format!(
            "── Done · Today {today} · 7 days {week} · 30 days {month} ──   c {}",
            if state.recent {
                "Hide recently done"
            } else {
                "Recently done"
            }
        ),
        role: Role::Muted,
        item: None,
        hit: Some(Hit::Recent),
        selection: None,
    });
    rows.push(Row {
        label: format!(
            "d {}  {}",
            PERIODS[state.period],
            done_chart(list, state, now, zone)
        ),
        role: Role::Text,
        item: None,
        hit: Some(Hit::Period),
        selection: None,
    });
    if state.recent {
        let mut done: Vec<_> = list
            .items
            .iter()
            .filter(|item| {
                item.status == Status::Done
                    && item.done.is_some_and(|at| at <= now)
                    && in_project(item, filter)
            })
            .collect();
        done.sort_by_key(|item| (std::cmp::Reverse(item.done), &item.key));
        rows.extend(
            done.into_iter()
                .take(10)
                .map(|item| Row::item(item, "done")),
        );
    }
    rows
}

fn title_width(width: usize) -> usize {
    if width >= WIDE {
        42
    } else {
        width.saturating_sub(GUTTER + NUMBER + STATUS + OWNER + AGE + 4)
    }
}

fn table_cells(width: usize, [number, status, title, owner, age, detail]: [&str; 6]) -> String {
    if width < TABLE {
        return format!("{} {} {title}", fit(number, NUMBER), fit(status, STATUS));
    }
    let width_left = title_width(width);
    let main = format!(
        "{} {} {} {} {}",
        fit(number, NUMBER),
        fit(status, STATUS),
        fit(title, width_left),
        fit(owner, OWNER),
        fit(age, AGE),
    );
    if width >= WIDE {
        format!("{main} {detail}")
    } else {
        main
    }
}

fn row_text(item: &Item, width: usize, owned: &str, now: i64) -> String {
    use unicode_width::UnicodeWidthStr;
    let number = item.number.as_deref().unwrap_or("—");
    let status = item.status.marked_label();
    let age = item.last.filter(|at| *at <= now).map_or_else(
        || "—".into(),
        |at| {
            let minutes = (now - at) / 60_000;
            match minutes {
                0..=59 => format!("{minutes}m"),
                60..=1439 => format!("{}h", minutes / 60),
                _ => format!("{}d", minutes / 1440),
            }
        },
    );
    let available = if width >= TABLE {
        title_width(width)
    } else {
        width.saturating_sub(GUTTER + NUMBER + STATUS + 2)
    };
    let title = item.parent.as_ref().map_or_else(
        || item.title.clone(),
        |parent| {
            let separator = " · ";
            let context = parent.width() + separator.width();
            if available <= context {
                item.title.clone()
            } else {
                let shown = fit(&item.title, available - context);
                format!("{}{separator}{parent}", shown.trim_end())
            }
        },
    );
    let detail = if item.status == Status::Done {
        item.release.as_deref()
    } else {
        item.next.as_deref()
    };
    table_cells(
        width,
        [number, &status, &title, owned, &age, detail.unwrap_or("")],
    )
}

fn role(status: Status) -> Role {
    match status {
        Status::Blocked => Role::Blocked,
        Status::Stalled | Status::NeedsYou => Role::Waiting,
        Status::Unchecked | Status::Unknown => Role::Muted,
        _ => Role::Text,
    }
}

pub(in crate::board) fn render(frame: &mut Frame, app: &App, area: Rect) {
    let state = &app.work;
    let look = app.look();
    if area.is_empty() {
        return;
    }
    let mut hits = state.hits.borrow_mut();
    let width = usize::from(area.width);
    let band = |offset| Rect::new(area.x, area.y + offset, area.width, 1);
    let project = format!(" p  {}", state.project.as_deref().unwrap_or("All projects"));
    let project_width = unicode_width::UnicodeWidthStr::width(project.as_str());
    let project_width = project_width.min(width.saturating_sub(10));
    strip::paint_left(
        frame.buffer_mut(),
        band(0),
        Line::styled(
            format!(
                "{}{}",
                scene::rule("Work", width - project_width),
                fit(&project, project_width)
            ),
            look.role(Role::Muted),
        ),
    );
    if project_width > 0 {
        hits.push((
            Rect::new(
                area.right() - project_width as u16,
                area.y,
                project_width as u16,
                1,
            ),
            Hit::Project,
        ));
    }
    super::super::pane_chrome::mark_focused_rule(frame.buffer_mut(), app, Some(band(0)), None);
    let mut top = 1;
    let order_notice = state
        .order_notice
        .as_ref()
        .filter(|(target, _)| state.order_target().as_ref() == Some(target))
        .map(|(_, notice)| notice);
    if let Some(notice) = state.notice.as_ref().or(order_notice)
        && top < area.height
    {
        let label = if state.stale {
            format!(" Stale · {notice}")
        } else {
            format!(" {notice}")
        };
        strip::paint_left(
            frame.buffer_mut(),
            band(top),
            Line::styled(fit(&label, width), look.role(Role::Waiting)),
        );
        top += 1;
    }
    let Some(list) = &state.list else {
        if state.notice.is_none() && top < area.height {
            strip::paint_left(
                frame.buffer_mut(),
                band(top),
                Line::styled(" Loading Colab work…", look.role(Role::Muted)),
            );
        }
        return;
    };
    let now = crate::status::now_ms() as i64;
    let utc = jiff::tz::TimeZone::UTC;
    let zone = app.local_zone.as_ref().unwrap_or(&utc);
    let roster = app.workspace_snapshot().map(|snapshot| &snapshot.roster);
    let rows = rows(list, state, now, zone, width, roster);
    let selected_row = state.selected.as_ref().and_then(|key| {
        rows.iter()
            .position(|row| row.selection.as_ref() == Some(key))
    });
    let selected = selected_row.or_else(|| rows.iter().position(|row| row.selection.is_some()));
    let reserved = u16::from(
        selected.and_then(|index| rows[index].item).is_some()
            && area.height.saturating_sub(top) >= 4,
    );
    let count = usize::from(area.height.saturating_sub(top + reserved));
    let offset = selected.map_or(0, |index| (index + 1).saturating_sub(count));
    for (index, row) in rows.iter().enumerate().skip(offset).take(count) {
        let line = band(top + (index - offset) as u16);
        if let Some(item) = row.item {
            let active = selected == Some(index);
            let owned = item
                .owner_name(roster)
                .map(crate::board::notes::single_line);
            let prefix = if active { " › " } else { "   " };
            let style = look.selected(active, look.role(Role::Text));
            let text = format!(
                "{prefix}{}",
                row_text(item, width, owned.as_deref().unwrap_or("—"), now)
            );
            strip::paint_left(
                frame.buffer_mut(),
                line,
                Line::styled(fit(&text, width), style),
            );
            if width >= TABLE {
                let area = Rect::new(
                    line.x + (GUTTER + NUMBER + 1) as u16,
                    line.y,
                    STATUS as u16,
                    1,
                );
                let style = look.selected(active, look.role(role(item.status)));
                strip::paint_left(
                    frame.buffer_mut(),
                    area,
                    Line::styled(fit(&item.status.marked_label(), STATUS), style),
                );
            }
            if let Some(key) = &row.selection {
                hits.push((line, Hit::Row(key.clone())));
            }
        } else {
            strip::paint_left(
                frame.buffer_mut(),
                line,
                Line::styled(
                    fit(&format!(" {}", row.label), width),
                    look.selected(selected == Some(index), look.role(row.role)),
                ),
            );
            if let Some(hit) = row.hit.clone() {
                hits.push((line, hit));
            }
        }
    }
    if reserved != 0
        && let Some(item) = selected.and_then(|selected| rows[selected].item)
    {
        let line = band(area.height - 1);
        let can_open = !state.stale && item.can_open;
        let open_action = if state.stale {
            " Stale"
        } else if can_open {
            " ⏎ open page"
        } else {
            " No link · check Colab serve and pairing"
        };
        let order_context = state.project.as_ref().is_some_and(|name| {
            list.orders.contains_key(name) || list.omitted_orders.contains(name)
        });
        let choices = order_context.then(|| state.move_choices(&item.key));
        let move_label = choices.as_ref().and_then(|choices| match choices {
            Ok(_) => Some(" m move"),
            Err(_) => None,
        });
        let action = format!("{}{open_action}", move_label.unwrap_or_default());
        let action = if unicode_width::UnicodeWidthStr::width(action.as_str()) > width {
            open_action.to_owned()
        } else {
            action
        };
        let action_cells = unicode_width::UnicodeWidthStr::width(action.as_str());
        let action_width = action_cells.min(width);
        let detail = item
            .release
            .as_ref()
            .or(item.next.as_ref())
            .or(item.parent.as_ref());
        let number = item.number.as_deref().unwrap_or(&item.title);
        let mut detail = detail.map_or_else(
            || format!(" {number}"),
            |detail| format!(" {number} · {detail}"),
        );
        if let Some(Err(reason)) = choices {
            detail.push_str(" · ");
            detail.push_str(reason);
        }
        strip::paint_left(
            frame.buffer_mut(),
            line,
            Line::from(vec![
                Span::styled(fit(&detail, width - action_width), look.role(Role::Muted)),
                Span::styled(
                    fit(&action, action_width),
                    look.role(Role::Text).add_modifier(Modifier::BOLD),
                ),
            ]),
        );
        if let Some(move_label) = move_label
            && action.starts_with(move_label)
        {
            hits.push((
                Rect::new(
                    line.right() - action_width as u16,
                    line.y,
                    move_label.len() as u16,
                    1,
                ),
                Hit::Move(item.key.clone()),
            ));
        }
        if can_open && action_width == action_cells {
            let open_width = unicode_width::UnicodeWidthStr::width(open_action) as u16;
            hits.push((
                Rect::new(line.right() - open_width, line.y, open_width, 1),
                Hit::Open(item.key.clone()),
            ));
        }
    }
}

impl App {
    pub(in crate::board) fn work_key(&mut self, key: KeyEvent) -> Option<Effect> {
        if self.shell.tab != OpsTab::Work
            || key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
        {
            return None;
        }
        if !matches!(
            key.code,
            KeyCode::Up
                | KeyCode::Down
                | KeyCode::Home
                | KeyCode::End
                | KeyCode::PageUp
                | KeyCode::PageDown
                | KeyCode::Enter
                | KeyCode::Char('p' | 'c' | 'd' | 'm' | '/')
        ) {
            return None;
        }
        let state = &mut self.work;
        let Some(list) = &state.list else {
            return matches!(
                key.code,
                KeyCode::Char('/' | 'p' | 'c' | 'd' | 'm') | KeyCode::Enter
            )
            .then_some(Effect::None);
        };
        let utc = jiff::tz::TimeZone::UTC;
        let zone = self.local_zone.as_ref().unwrap_or(&utc);
        let rows = rows(list, state, crate::status::now_ms() as i64, zone, 0, None);
        let items: Vec<_> = rows.iter().filter(|row| row.selection.is_some()).collect();
        let index = state
            .selected
            .as_ref()
            .and_then(|key| {
                items
                    .iter()
                    .position(|row| row.selection.as_ref() == Some(key))
            })
            .unwrap_or(0);
        match key.code {
            KeyCode::Up
            | KeyCode::Down
            | KeyCode::Home
            | KeyCode::End
            | KeyCode::PageUp
            | KeyCode::PageDown => {
                let end = items.len().saturating_sub(1);
                let index = match key.code {
                    KeyCode::Up => index.saturating_sub(1),
                    KeyCode::Down => (index + 1).min(end),
                    KeyCode::Home => 0,
                    KeyCode::PageUp => index.saturating_sub(5),
                    KeyCode::PageDown => (index + 5).min(end),
                    _ => end,
                };
                state.selected = items.get(index).and_then(|row| row.selection.clone());
            }
            KeyCode::Enter => {
                let hit = items.get(index).and_then(|row| {
                    row.item
                        .map(|item| Hit::Open(item.key.clone()))
                        .or_else(|| row.hit.clone())
                });
                return Some(hit.map_or(Effect::None, |hit| self.work_hit(hit)));
            }
            KeyCode::Char('p') => return Some(self.work_hit(Hit::Project)),
            KeyCode::Char('c') => return Some(self.work_hit(Hit::Recent)),
            KeyCode::Char('d') => return Some(self.work_hit(Hit::Period)),
            KeyCode::Char('m') => {
                let key = items
                    .get(index)
                    .and_then(|row| row.item)
                    .map(|item| item.key.clone());
                return Some(key.map_or(Effect::None, |key| self.work_hit(Hit::Move(key))));
            }
            KeyCode::Char('/') => {}
            _ => return None,
        }
        Some(Effect::None)
    }

    pub(in crate::board) fn work_mouse(&mut self, event: MouseEvent) -> Option<Effect> {
        if self.shell.tab == OpsTab::Work
            && matches!(
                event.kind,
                MouseEventKind::ScrollUp | MouseEventKind::ScrollDown
            )
        {
            let code = if event.kind == MouseEventKind::ScrollUp {
                KeyCode::Up
            } else {
                KeyCode::Down
            };
            return self.work_key(KeyEvent::new(code, KeyModifiers::NONE));
        }
        if self.shell.tab != OpsTab::Work || event.kind != MouseEventKind::Down(MouseButton::Left) {
            return None;
        }
        let hit = self.work.hits.borrow().iter().find_map(|(area, hit)| {
            area.contains((event.column, event.row).into())
                .then(|| hit.clone())
        });
        hit.map(|hit| self.work_hit(hit))
    }

    fn work_hit(&mut self, hit: Hit) -> Effect {
        if let Hit::Move(key) = hit {
            return self.open_work_order(&key);
        }
        let state = &mut self.work;
        let Some(list) = &state.list else {
            return Effect::None;
        };
        match hit {
            Hit::Row(key) => state.selected = Some(key),
            Hit::Open(key) => {
                if !state.stale
                    && let Some(item) = list
                        .items
                        .iter()
                        .find(|item| item.key == key && item.can_open)
                {
                    return Effect::OpenWorkPage(item.page.clone());
                }
            }
            Hit::Project => {
                let previous = state
                    .project
                    .as_ref()
                    .and_then(|name| list.projects.iter().position(|candidate| name == candidate));
                let next = previous.map_or(0, |index| index + 1);
                state.project = list.projects.get(next).cloned();
                state.selected = None;
            }
            Hit::Recent => state.recent = !state.recent,
            Hit::More(project) => {
                if !state.expanded.remove(&project) {
                    state.expanded.insert(project);
                }
            }
            Hit::Period => state.period = (state.period + 1) % 3,
            Hit::Move(_) => unreachable!("move handled above"),
        }
        Effect::None
    }

    fn open_work_order(&mut self, key: &str) -> Effect {
        let choices = match self.work.move_choices(key) {
            Ok(choices) => choices,
            Err(reason) => return self.say(reason),
        };
        self.menu = Some(Menu {
            link: None,
            prefill: String::new(),
            title: "Move work".into(),
            entries: choices
                .into_iter()
                .map(|(key, label, task)| MenuEntry {
                    chip: None,
                    separator: false,
                    key: key.into(),
                    label: label.into(),
                    choice: Choice::WorkOrder(task),
                })
                .collect(),
            selected: 0,
            anchor: None,
            surface: Default::default(),
        });
        Effect::None
    }

    pub(in crate::board) fn confirm_work_order(&mut self, task: super::OrderMove) -> Effect {
        if self.shell.tab == OpsTab::Work && self.work.confirm_move(&task) {
            Effect::WorkOrder(task)
        } else {
            self.say("Project order changed · choose the move again.")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn colab_work_done_bounds_use_local_midnight_across_a_short_day() {
        let at = |iso: &str| iso.parse::<jiff::Timestamp>().unwrap().as_millisecond();
        let zone = jiff::tz::TimeZone::get("America/New_York").unwrap();
        let now = at("2026-03-09T04:30:00Z");
        assert_eq!(local_start(now, &zone, 0), Some(at("2026-03-09T04:00:00Z")));
        assert_eq!(local_start(now, &zone, 1), Some(at("2026-03-08T05:00:00Z")));
        let dates = [
            at("2026-03-09T04:00:00Z"),
            at("2026-03-09T03:59:59Z"),
            at("2026-03-03T05:00:00Z"),
            at("2026-03-03T04:59:59Z"),
            now + 1,
        ];
        let list = List::decode(&json!({
            "spaceId":"test",
            "pages": dates.iter().enumerate().map(|(i, date)| json!({
                "pageId": format!("11111111-1111-4111-8111-{i:012}"),
                "title": "Done",
                "summary": {"status": "done", "doneAtMs":date}
            })).collect::<Vec<_>>()
        }))
        .unwrap();
        assert_eq!(done_counts(list.items.iter(), now, &zone), [1, 3, 4]);
    }
}
