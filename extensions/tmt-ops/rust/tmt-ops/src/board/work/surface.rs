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
use tmt_tui::components::{
    Button, Dialog, DialogInput, DialogKind, DialogLook, DialogState, FieldKind, Focus,
    design_system::{
        self as ds, CellGrid, Chip, ChipRow, ChipRowProps, Component, Gauge, GaugeProps,
        MoreDirection, MoreHint, MoreHintProps, PaneRule, PaneRuleProps, SectionRule,
        SectionRuleProps, Sparkline, SparklineProps, Token,
    },
    design_system_ratatui, strip,
};

use crate::board::{
    app::{App, Choice, Effect, Menu, MenuEntry, Request},
    shell::OpsTab,
    view::fit,
};
use crate::config::WorkView;

use super::{Item, List, Progress, Status, ViewDialog, ViewSelection, age_label};

#[derive(Clone, Debug)]
pub(in crate::board) enum Hit {
    Row(String),
    Open(String),
    Move(String),
    Talk(String),
    Project,
    Recent,
    More(Option<String>),
    Period,
    ToggleDetail,
    Search,
    Section(usize),
    View(ViewSelection),
    SaveView,
}

const MAX_ROWS: usize = 5;
const DAY: i64 = 86_400_000;
const HOUR: i64 = 3_600_000;
const WIDE: usize = 145;
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

fn done_buckets(
    list: &List,
    state: &super::State,
    now: i64,
    zone: &jiff::tz::TimeZone,
) -> (Vec<Option<u64>>, u64) {
    let days = [1, 7, 30][state.period];
    let start = |days_back| local_start(now, zone, days_back).unwrap_or(now);
    let from = if days == 1 {
        now.saturating_sub(11 * HOUR)
    } else {
        start(days - 1)
    };
    let buckets = if days == 1 { 12 } else { days as usize };
    let bounds: Vec<_> = if days == 1 {
        (0..buckets)
            .map(|index| from + index as i64 * HOUR)
            .collect()
    } else {
        (0..days).rev().map(start).collect()
    };
    let mut cells = vec![0_u64; bounds.len()];
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
    let scale = cells.iter().copied().max().unwrap_or(0).max(1);
    (cells.into_iter().map(Some).collect(), scale)
}

fn saved_views(app: &App) -> &[WorkView] {
    app.workspace_snapshot()
        .map_or(&[], |snapshot| snapshot.preferences.work_views.as_slice())
}

fn active_filter<'a>(state: &super::State, views: &'a [WorkView]) -> Option<&'a str> {
    match &state.active_view {
        ViewSelection::All => None,
        ViewSelection::NeedsYou => Some("needs-you"),
        ViewSelection::Blocked => Some("blocked"),
        ViewSelection::Saved(name) => views
            .iter()
            .find(|view| view.name == *name)
            .and_then(|view| view.filter.as_deref()),
    }
}

fn matches_view(item: &Item, filter: Option<&str>) -> bool {
    match filter {
        Some("needs-you") => item.status == Status::NeedsYou || item.needs_you > 0,
        Some("blocked") => item.status == Status::Blocked,
        _ => true,
    }
}

struct RowInputs<'a> {
    now: i64,
    zone: &'a jiff::tz::TimeZone,
    width: usize,
    roster: Option<&'a crate::board::workspace::OpsRoster>,
    query: &'a str,
    view_filter: Option<&'a str>,
}

fn rows<'a>(list: &'a List, state: &super::State, inputs: RowInputs<'_>) -> Vec<Row<'a>> {
    let RowInputs {
        now,
        zone,
        width,
        roster,
        query,
        view_filter,
    } = inputs;
    let filter = state.project.as_deref();
    let trimmed = query.trim();
    let mut rows = Vec::new();
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
        return rows;
    }
    let visible = || {
        list.items.iter().filter(|item| {
            in_project(item, filter)
                && matches_view(item, view_filter)
                && item.matches_query(trimmed, roster)
        })
    };
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
        let expanded = !trimmed.is_empty() || state.expanded.contains(&project.map(str::to_owned));
        let count = open.len();
        rows.extend(
            open.into_iter()
                .take(if expanded { count } else { MAX_ROWS })
                .map(|item| Row::item(item, &section)),
        );
        if count > MAX_ROWS && trimmed.is_empty() {
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
        if let Some(preview) = preview
            && !preview.is_empty()
        {
            rows.push(Row::label(format!("Next: {preview}"), Role::Muted));
        }
    }
    if trimmed.is_empty() {
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
    } else if !rows.iter().any(|row| row.item.is_some()) {
        rows.push(Row::label(
            format!("No matching work for \"{trimmed}\"."),
            Role::Muted,
        ));
    }
    rows
}

fn paint_ds<C: Component>(frame: &mut Frame, app: &App, area: Rect, props: &C::Props) {
    if area.is_empty() {
        return;
    }
    let mut grid = CellGrid::new(ds::Size {
        width: area.width,
        height: area.height,
    });
    let _ = C::render(
        props,
        ds::Rect {
            x: 0,
            y: 0,
            width: area.width,
            height: area.height,
        },
        &mut grid,
    );
    design_system_ratatui::paint(
        &grid,
        area,
        frame.buffer_mut(),
        &app.look().theme,
        app.look().depth,
    );
}

fn mini_bar(progress: Option<Progress>, width: usize) -> String {
    match progress {
        Some(progress) if progress.total > 0 => {
            let filled = ((progress.done.min(progress.total) * width as u64 + progress.total / 2)
                / progress.total) as usize;
            let bar = format!(
                "{}{}",
                "▓".repeat(filled.min(width)),
                "░".repeat(width.saturating_sub(filled))
            );
            format!("{bar} {}/{}", progress.done, progress.total)
        }
        _ => "—".into(),
    }
}

fn role(status: Status) -> Role {
    match status {
        Status::Blocked => Role::Blocked,
        Status::Stalled | Status::NeedsYou => Role::Waiting,
        Status::Unchecked | Status::Unknown => Role::Muted,
        _ => Role::Text,
    }
}

fn ascii_mode(app: &App) -> bool {
    matches!(
        app.cron_glyphs,
        crate::board::overview::cron_counts::GlyphSet::Ascii
    )
}

fn paint_dashboard_band(
    frame: &mut Frame,
    app: &App,
    list: &List,
    area: Rect,
    now: i64,
    zone: &jiff::tz::TimeZone,
    roster: Option<&crate::board::workspace::OpsRoster>,
) -> u16 {
    let state = &app.work;
    let filter = state.project.as_deref();
    let query = app.work.search.as_str().trim();
    if state.detail_collapsed || !query.is_empty() {
        let label =
            filter.unwrap_or_else(|| list.projects.first().map(String::as_str).unwrap_or("all"));
        let progress = filter
            .and_then(|name| list.project_progress(name))
            .or_else(|| {
                list.projects
                    .first()
                    .and_then(|name| list.project_progress(name))
            });
        let (numerator, denominator, ratio) = match progress {
            Some(p) => (p.done, p.total, format!("{}/{} chapters", p.done, p.total)),
            None => (0, 0, "—".into()),
        };
        if denominator > 0 {
            paint_ds::<Gauge>(
                frame,
                app,
                Rect::new(area.x, area.y, area.width, 1),
                &GaugeProps {
                    label: label.into(),
                    label_width: 9,
                    numerator,
                    denominator,
                    total: Some(ratio),
                    filled_role: Token(Role::Working),
                    rest_role: Token(Role::Dim),
                },
            );
        } else {
            strip::paint_left(
                frame.buffer_mut(),
                Rect::new(area.x, area.y, area.width, 1),
                Line::styled(
                    fit(&format!("{label:<9} {ratio}"), usize::from(area.width)),
                    app.look().role(Role::Muted),
                ),
            );
        }
        return 1;
    }
    if area.width < 96 || area.height < 16 {
        return 0;
    }
    let left_w = (area.width / 2).saturating_sub(1);
    let right_x = area.x + left_w + 1;
    let right_w = area.width.saturating_sub(left_w + 1);
    let ascii = ascii_mode(app);
    let look = app.look();

    paint_ds::<PaneRule>(
        frame,
        app,
        Rect::new(area.x, area.y, left_w, 1),
        &PaneRuleProps {
            title: "Projects".into(),
            note: Some("chapters".into()),
            note_role: Some(Token(Role::Dim)),
            focused: false,
            ascii,
        },
    );
    paint_ds::<PaneRule>(
        frame,
        app,
        Rect::new(right_x, area.y, right_w, 1),
        &PaneRuleProps {
            title: "Squad Pulse".into(),
            note: Some(PERIODS[state.period].into()),
            note_role: Some(Token(Role::Dim)),
            focused: false,
            ascii,
        },
    );

    let projects: Vec<&str> = match filter {
        Some(name) => vec![name],
        None => list.projects.iter().take(4).map(String::as_str).collect(),
    };
    let rows_used = 4_u16;
    for (idx, project) in projects.iter().enumerate() {
        let y = area.y + 1 + idx as u16;
        let progress = list.project_progress(project);
        let ratio = match progress {
            Some(p) => format!("{}/{}", p.done, p.total),
            None => "—".into(),
        };
        let mut needs = 0_usize;
        let mut working = 0_usize;
        let mut blocked = 0_usize;
        for item in &list.items {
            if item.projects.iter().any(|p| p == project) {
                match item.status {
                    Status::NeedsYou => needs += 1,
                    Status::Working => working += 1,
                    Status::Blocked => blocked += 1,
                    _ => {}
                }
            }
        }
        let mut total = vec![ratio];
        if needs > 0 {
            total.push(format!("◆{needs}"));
        }
        if working > 0 {
            total.push(format!("●{working}"));
        }
        if blocked > 0 {
            total.push(format!("✗{blocked}"));
        }
        if let Some(p) = progress {
            total[0] = format!("{}/{}", p.done, p.total);
            paint_ds::<Gauge>(
                frame,
                app,
                Rect::new(area.x, y, left_w, 1),
                &GaugeProps {
                    label: (*project).into(),
                    label_width: 8,
                    numerator: p.done,
                    denominator: p.total,
                    total: Some(total.join(" ")),
                    filled_role: Token(Role::Working),
                    rest_role: Token(Role::Dim),
                },
            );
        } else {
            let badges = total.into_iter().skip(1).collect::<Vec<_>>().join(" ");
            let badge_w = unicode_width::UnicodeWidthStr::width(badges.as_str());
            let numbers_col = 9_usize;
            let bar_w = usize::from(left_w)
                .saturating_sub(8 + 1 + 2 + numbers_col + 1 + badge_w)
                .min(24);
            let line = if badges.is_empty() {
                format!("{project:<8} {}{}", " ".repeat(bar_w + 2), "—")
            } else {
                format!(
                    "{project:<8} {}{:<numbers_col$} {badges}",
                    " ".repeat(bar_w + 2),
                    "—",
                )
            };
            strip::paint_left(
                frame.buffer_mut(),
                Rect::new(area.x, y, left_w, 1),
                Line::styled(fit(&line, usize::from(left_w)), look.role(Role::Muted)),
            );
        }
    }

    // Right column: Velocity Sparkline + status counts + Active + Stuck.
    let (points, scale) = done_buckets(list, state, now, zone);
    let label = " Velocity ";
    let label_w = label.len() as u16;
    strip::paint_left(
        frame.buffer_mut(),
        Rect::new(right_x, area.y + 1, label_w.min(right_w), 1),
        Line::styled(label, look.role(Role::Muted)),
    );
    if right_w > label_w {
        let spark_w = (right_w - label_w).min(40);
        paint_ds::<Sparkline>(
            frame,
            app,
            Rect::new(right_x + label_w, area.y + 1, spark_w, 1),
            &SparklineProps {
                points,
                scale,
                unavailable: false,
            },
        );
    }
    let visible = || list.items.iter().filter(|item| in_project(item, filter));
    let working_count = visible().filter(|i| i.status == Status::Working).count();
    let needs_count = visible().filter(|i| i.status == Status::NeedsYou).count();
    let blocked_count = visible().filter(|i| i.status == Status::Blocked).count();
    strip::paint_left(
        frame.buffer_mut(),
        Rect::new(right_x, area.y + 2, right_w, 1),
        Line::from(vec![
            Span::styled(" ● ", look.role(Role::Working)),
            Span::styled(format!("{working_count} working  "), look.role(Role::Muted)),
            Span::styled("◆ ", look.role(Role::Waiting)),
            Span::styled(format!("{needs_count} needs you  "), look.role(Role::Muted)),
            Span::styled("✗ ", look.role(Role::Blocked)),
            Span::styled(format!("{blocked_count} blocked"), look.role(Role::Muted)),
        ]),
    );
    let active_owners: std::collections::BTreeSet<_> = visible()
        .filter(|i| i.status == Status::Working)
        .filter_map(|i| i.owner_name(roster))
        .collect();
    let active_text = if active_owners.is_empty() {
        "—".into()
    } else {
        active_owners.into_iter().collect::<Vec<_>>().join(", ")
    };
    strip::paint_left(
        frame.buffer_mut(),
        Rect::new(right_x, area.y + 3, right_w, 1),
        Line::styled(
            fit(&format!(" Active   {active_text}"), usize::from(right_w)),
            look.role(Role::Muted),
        ),
    );
    let stuck = visible()
        .filter(|i| matches!(i.status, Status::Blocked | Status::Stalled))
        .min_by_key(|i| (i.blocked_since.or(i.last).unwrap_or(i64::MAX), &i.key))
        .map(|i| {
            let num = i.number.as_deref().unwrap_or(&i.title);
            let owner = i.owner_name(roster).unwrap_or("unassigned");
            let age = age_label(i.blocked_since.or(i.last), now);
            format!("{num} ({owner} · {age})")
        })
        .unwrap_or_else(|| "—".into());
    strip::paint_left(
        frame.buffer_mut(),
        Rect::new(right_x, area.y + 4, right_w, 1),
        Line::styled(
            fit(&format!(" Stuck    {stuck}"), usize::from(right_w)),
            look.role(Role::Muted),
        ),
    );

    1 + rows_used
}

fn inspector_line(frame: &mut Frame, area: Rect, y: &mut u16, line: Line<'static>) {
    if *y < area.bottom() {
        strip::paint_left(
            frame.buffer_mut(),
            Rect::new(area.x, *y, area.width, 1),
            line,
        );
        *y += 1;
    }
}

fn paint_inspector(
    frame: &mut Frame,
    app: &App,
    state: &super::State,
    item: &Item,
    area: Rect,
    roster: Option<&crate::board::workspace::OpsRoster>,
    hits: &mut Vec<(Rect, Hit)>,
) {
    if area.is_empty() {
        return;
    }
    let look = app.look();
    let width = usize::from(area.width);
    let number = item.number.as_deref().unwrap_or(&item.title);
    paint_ds::<PaneRule>(
        frame,
        app,
        Rect::new(area.x, area.y, area.width, 1),
        &PaneRuleProps {
            title: format!("Detail · {number}"),
            note: Some("Tab focus · Space collapse".into()),
            note_role: Some(Token(Role::Dim)),
            focused: state.inspector_focused,
            ascii: ascii_mode(app),
        },
    );
    let mut y = area.y + 1;

    let needs_answer = item.needs_you > 0 || item.status == Status::NeedsYou;
    let mut status_spans = vec![Span::styled(
        format!(" {}", item.status.marked_label().to_uppercase()),
        look.role(role(item.status)).add_modifier(Modifier::BOLD),
    )];
    if needs_answer {
        status_spans.push(Span::styled("  answer in Colab", look.role(Role::Muted)));
    }
    inspector_line(frame, area, &mut y, Line::from(status_spans));
    if let Some(next) = &item.next {
        inspector_line(
            frame,
            area,
            &mut y,
            Line::styled(fit(&format!(" {next}"), width), look.role(Role::Text)),
        );
    }

    if y < area.bottom() {
        if let Some(p) = item.progress {
            paint_ds::<Gauge>(
                frame,
                app,
                Rect::new(area.x, y, area.width, 1),
                &GaugeProps {
                    label: " Chapters".into(),
                    label_width: 10,
                    numerator: p.done,
                    denominator: p.total,
                    total: Some(format!("{}/{} verified", p.done, p.total)),
                    filled_role: Token(Role::Working),
                    rest_role: Token(Role::Dim),
                },
            );
        } else {
            strip::paint_left(
                frame.buffer_mut(),
                Rect::new(area.x, y, area.width, 1),
                Line::styled(" Chapters  —", look.role(Role::Muted)),
            );
        }
        y += 1;
    }

    if item.sections.is_empty() {
        let msg = if item.sections_omitted || item.progress.is_some() {
            "   More sections in Colab · o open"
        } else {
            "   No sections"
        };
        inspector_line(
            frame,
            area,
            &mut y,
            Line::styled(fit(msg, width), look.role(Role::Muted)),
        );
    } else {
        let total = item.sections.len();
        let available = usize::from(area.bottom().saturating_sub(y).saturating_sub(2));
        let show_hints = total > available && available > 1;
        let shown = total.min(available - usize::from(show_hints));
        let cursor = if state.inspector_focused {
            state.inspector_cursor.min(total - 1)
        } else {
            0
        };
        // Follow the cursor past the first screen without storing a second selection.
        let start = cursor.saturating_sub(shown.saturating_sub(1));
        let end = start + shown;
        for (idx, section) in item.sections.iter().enumerate().take(end).skip(start) {
            let active = state.inspector_focused && cursor == idx;
            let cursor = if active { " ▸ " } else { "   " };
            let mark = section.state.mark();
            let waiting_note = if matches!(section.state, Status::NeedsYou | Status::Working) {
                "  ← waiting"
            } else {
                ""
            };
            let line_rect = Rect::new(area.x, y, area.width, 1);
            let text = format!(
                "{cursor}{mark}  {}. {}{waiting_note}",
                idx + 1,
                section.title
            );
            let style = look.selected(active, look.role(role(section.state)));
            strip::paint_left(
                frame.buffer_mut(),
                line_rect,
                Line::styled(fit(&text, width), style),
            );
            hits.push((line_rect, Hit::Section(idx)));
            y += 1;
        }
        if show_hints {
            let hints = [
                (start, MoreDirection::Up),
                (total - end, MoreDirection::Down),
            ]
            .into_iter()
            .filter(|(count, _)| *count > 0)
            .map(|(count, direction)| MoreHint::label(count as u64, direction, ascii_mode(app)))
            .collect::<Vec<_>>()
            .join(" · ");
            inspector_line(
                frame,
                area,
                &mut y,
                Line::styled(fit(&hints, width), look.role(Role::Dim)),
            );
        }
        if item.sections_omitted && y < area.bottom().saturating_sub(2) {
            inspector_line(
                frame,
                area,
                &mut y,
                Line::styled(
                    fit("   More sections in Colab · o open", width),
                    look.role(Role::Muted),
                ),
            );
        }
    }

    if y < area.bottom() {
        let owner = item.owner_name(roster).unwrap_or("unassigned");
        inspector_line(
            frame,
            area,
            &mut y,
            Line::styled(
                fit(&format!(" Owner   ● {owner}"), width),
                look.role(Role::Muted),
            ),
        );
    }
    if y < area.bottom() {
        let section = selected_section(state, item);
        let action = format!("  o / ⏎  {}", item.open_label(section));
        let mut actions = vec![Span::styled(action, look.role(Role::Text))];
        if roster.is_some_and(|r| item.owner_target(r).is_some()) {
            actions.push(Span::styled("   t  Talk", look.role(Role::Text)));
        }
        if needs_answer {
            actions.push(Span::styled("   · answer in Colab", look.role(Role::Muted)));
        }
        let action_rect = Rect::new(area.x, y, area.width, 1);
        strip::paint_left(frame.buffer_mut(), action_rect, Line::from(actions));
        if !state.stale && item.can_open {
            hits.push((action_rect, Hit::Open(item.key.clone())));
        }
    }
}

fn selected_section(state: &super::State, item: &super::Item) -> Option<usize> {
    (!state.detail_collapsed && state.inspector_focused && !item.sections.is_empty())
        .then(|| state.inspector_cursor.min(item.sections.len() - 1))
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

    // Row 0: project/filter controls on left + `/` search field on right.
    let project_label = format!(" p  {}", state.project.as_deref().unwrap_or("All projects"));
    let recent_label = if state.recent {
        "  c  Hide done"
    } else {
        "  c  Done"
    };
    let period_label = format!("  d  {}", PERIODS[state.period]);
    let search_w = (area.width / 3).clamp(18, 34).min(area.width);
    let left_w = area.width.saturating_sub(search_w);
    let controls_text = format!("{project_label}{recent_label}{period_label}");
    strip::paint_left(
        frame.buffer_mut(),
        Rect::new(area.x, area.y, left_w, 1),
        Line::styled(
            fit(&controls_text, usize::from(left_w)),
            look.role(Role::Muted),
        ),
    );
    let p_w = unicode_width::UnicodeWidthStr::width(project_label.as_str()).min(usize::from(left_w))
        as u16;
    if p_w > 0 {
        hits.push((Rect::new(area.x, area.y, p_w, 1), Hit::Project));
    }
    let search_rect = Rect::new(area.x + left_w, area.y, search_w, 1);
    hits.push((search_rect, Hit::Search));
    super::super::search_field::paint(
        frame.buffer_mut(),
        search_rect,
        &app.work.search,
        app.work.searching,
        Some("/"),
        look,
        None,
    );

    let mut top = 1_u16;
    let now = crate::status::now_ms() as i64;
    let order_notice = state
        .order_notice
        .as_ref()
        .filter(|(target, _)| state.order_target().as_ref() == Some(target))
        .map(|(_, notice)| notice);
    if let Some(notice) = state.notice.as_ref().or(order_notice)
        && top < area.height
    {
        let label = if state.stale {
            let age = age_label(state.last_read_at, now);
            format!(" Stale · read {age} ago · {notice}")
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
    let utc = jiff::tz::TimeZone::UTC;
    let zone = app.local_zone.as_ref().unwrap_or(&utc);
    let roster = app.workspace_snapshot().map(|snapshot| &snapshot.roster);

    top += paint_dashboard_band(
        frame,
        app,
        list,
        Rect::new(
            area.x,
            area.y + top,
            area.width,
            area.height.saturating_sub(top),
        ),
        now,
        zone,
        roster,
    );

    let views = saved_views(app);
    if area.height.saturating_sub(top) >= 8 {
        let all_count = list
            .items
            .iter()
            .filter(|item| {
                item.status != Status::Done && in_project(item, state.project.as_deref())
            })
            .count();
        let needs_count = list
            .items
            .iter()
            .filter(|item| {
                item.status != Status::Done
                    && in_project(item, state.project.as_deref())
                    && (item.status == Status::NeedsYou || item.needs_you > 0)
            })
            .count();
        let blocked_count = list
            .items
            .iter()
            .filter(|item| {
                item.status != Status::Done
                    && in_project(item, state.project.as_deref())
                    && item.status == Status::Blocked
            })
            .count();
        let mut chips = vec![
            Chip {
                id: 0,
                label: format!("All ({all_count})"),
                gap: " ".into(),
                enabled: true,
            },
            Chip {
                id: 1,
                label: format!("Needs you ({needs_count})"),
                gap: " ".into(),
                enabled: true,
            },
        ];
        let mut selected_chip = match &state.active_view {
            ViewSelection::All => Some(0),
            ViewSelection::NeedsYou => Some(1),
            _ => None,
        };
        for (idx, view) in views.iter().enumerate() {
            let chip_idx = chips.len();
            if matches!(&state.active_view, ViewSelection::Saved(name) if name == &view.name) {
                selected_chip = Some(chip_idx);
            }
            let label = if view.default {
                format!("{} *", view.name)
            } else {
                view.name.clone()
            };
            chips.push(Chip {
                id: (2 + idx) as u64,
                label,
                gap: " ".into(),
                enabled: true,
            });
        }
        let blocked_idx = chips.len();
        if state.active_view == ViewSelection::Blocked {
            selected_chip = Some(blocked_idx);
        }
        let blocked_id = (2 + views.len()) as u64;
        chips.push(Chip {
            id: blocked_id,
            label: format!("Blocked ({blocked_count})"),
            gap: " ".into(),
            enabled: true,
        });
        let save_id = blocked_id + 1;
        chips.push(Chip {
            id: save_id,
            label: "+ Save".into(),
            gap: String::new(),
            enabled: true,
        });
        let chip_area = Rect::new(area.x, area.y + top, area.width, 1);
        let mut grid = CellGrid::new(ds::Size {
            width: chip_area.width,
            height: 1,
        });
        let chip_hits = ChipRow::render(
            &ChipRowProps {
                label: " View  ".into(),
                chips,
                selected: selected_chip,
                cursor: None,
                active: false,
            },
            ds::Rect {
                x: 0,
                y: 0,
                width: chip_area.width,
                height: 1,
            },
            &mut grid,
        );
        design_system_ratatui::paint(
            &grid,
            chip_area,
            frame.buffer_mut(),
            &app.look().theme,
            app.look().depth,
        );
        for (rect, id) in chip_hits {
            let mapped = Rect::new(
                chip_area.x + rect.x,
                chip_area.y + rect.y,
                rect.width,
                rect.height,
            );
            let hit = if id == 0 {
                Hit::View(ViewSelection::All)
            } else if id == 1 {
                Hit::View(ViewSelection::NeedsYou)
            } else if id == blocked_id {
                Hit::View(ViewSelection::Blocked)
            } else if id == save_id {
                Hit::SaveView
            } else if let Some(view) = views.get((id - 2) as usize) {
                Hit::View(ViewSelection::Saved(view.name.clone()))
            } else {
                continue;
            };
            hits.push((mapped, hit));
        }
        top += 1;
    }

    let view_filter = active_filter(state, views);
    let rows = rows(
        list,
        state,
        RowInputs {
            now,
            zone,
            width,
            roster,
            query: app.work.search.as_str(),
            view_filter,
        },
    );
    let selected_row = state.selected.as_ref().and_then(|key| {
        rows.iter()
            .position(|row| row.selection.as_ref() == Some(key))
    });
    let selected = selected_row.or_else(|| rows.iter().position(|row| row.selection.is_some()));
    let selected_item = selected.and_then(|index| rows[index].item);

    let split = !state.detail_collapsed && area.width >= 96 && selected_item.is_some();
    let collapsed_bar = u16::from(
        state.detail_collapsed && selected_item.is_some() && area.height.saturating_sub(top) >= 5,
    );
    let reserved =
        u16::from(!split && selected_item.is_some() && area.height.saturating_sub(top) >= 4);
    let body_h = area.height.saturating_sub(top + reserved + collapsed_bar);
    let list_w = if split {
        (area.width / 2).saturating_sub(1)
    } else {
        area.width
    };
    let list_area = Rect::new(area.x, area.y + top, list_w, body_h);

    if !list_area.is_empty() {
        let open_count = rows
            .iter()
            .filter_map(|r| r.item.map(|item| item.key.as_str()))
            .collect::<std::collections::BTreeSet<_>>()
            .len();
        let trimmed_query = app.work.search.as_str().trim();
        let list_title = if !trimmed_query.is_empty() {
            if open_count == 1 {
                "Work · 1 match".into()
            } else {
                format!("Work · {open_count} matches")
            }
        } else {
            "Work".into()
        };
        let mut note_parts = Vec::new();
        if state.detail_collapsed || !trimmed_query.is_empty() {
            if let Some(project) = state.project.as_deref() {
                note_parts.push(format!("project:{project}"));
            }
            if !trimmed_query.is_empty() {
                note_parts.push(format!("query:{trimmed_query}"));
            }
        }
        let list_note = if state.detail_collapsed {
            note_parts.push(format!("{open_count} open"));
            note_parts.push("Space detail".into());
            note_parts.join(" · ")
        } else {
            note_parts.push(format!("{open_count} open"));
            note_parts.push("j/k move".into());
            note_parts.join(" · ")
        };
        paint_ds::<PaneRule>(
            frame,
            app,
            Rect::new(list_area.x, list_area.y, list_area.width, 1),
            &PaneRuleProps {
                title: list_title,
                note: Some(list_note),
                note_role: Some(Token(Role::Dim)),
                focused: !state.inspector_focused,
                ascii: ascii_mode(app),
            },
        );
        let content_top = list_area.y + 1;
        let content_bottom = list_area.bottom();
        let row_height = |row: &Row<'_>| if row.item.is_some() { 3_u16 } else { 1_u16 };
        let avail_h = content_bottom.saturating_sub(content_top);
        let mut offset = 0_usize;
        if let Some(sel) = selected {
            let mut needed = 0_u16;
            for idx in (0..=sel).rev() {
                let h = row_height(&rows[idx]);
                if needed + h > avail_h {
                    offset = idx + 1;
                    break;
                }
                needed += h;
            }
        }
        let mut y = content_top;
        let mut clipped_below = 0_u64;
        for (index, row) in rows.iter().enumerate().skip(offset) {
            let h = row_height(row);
            if y + h.min(2) > content_bottom {
                clipped_below = rows[index..]
                    .iter()
                    .filter(|r| r.selection.is_some())
                    .count() as u64;
                break;
            }
            if let Some(item) = row.item {
                let active = selected == Some(index);
                let prefix = if active { " ▸ " } else { "   " };
                let mark = item.status.mark();
                let number = item.number.as_deref().unwrap_or("—");
                let owner = item
                    .owner_name(roster)
                    .map(crate::board::notes::single_line)
                    .unwrap_or_else(|| "—".into());
                let progress_label = mini_bar(item.progress, 6);
                let age = age_label(item.last, now);
                let line1_rect = Rect::new(list_area.x, y, list_area.width, 1);
                let line2_rect = Rect::new(list_area.x, y + 1, list_area.width, 1);
                let lw = usize::from(list_area.width);
                let right_meta = format!("{owner}  {progress_label}  {age}");
                let left_title = format!("{prefix}{mark} {number:<8} {}", item.title);
                let line1_text = if !split && lw > right_meta.len() + 20 {
                    format!(
                        "{} {}",
                        fit(&left_title, lw - right_meta.len() - 1),
                        right_meta
                    )
                } else {
                    fit(&left_title, lw)
                };
                strip::paint_left(
                    frame.buffer_mut(),
                    line1_rect,
                    Line::styled(
                        line1_text,
                        look.selected(active, look.role(role(item.status))),
                    ),
                );
                let line2_text = if !split {
                    let reason = item
                        .next
                        .as_deref()
                        .or(item.release.as_deref())
                        .or(item.parent.as_deref())
                        .unwrap_or_else(|| item.status.label());
                    fit(&format!("            {reason}"), lw)
                } else {
                    fit(
                        &format!("            {owner:<12} {progress_label:<11} {age}"),
                        lw,
                    )
                };
                strip::paint_left(
                    frame.buffer_mut(),
                    line2_rect,
                    Line::styled(line2_text, look.selected(active, look.role(Role::Muted))),
                );
                if let Some(key) = &row.selection {
                    hits.push((
                        Rect::new(list_area.x, y, list_area.width, 2),
                        Hit::Row(key.clone()),
                    ));
                }
                y += 3;
            } else {
                let line_rect = Rect::new(list_area.x, y, list_area.width, 1);
                strip::paint_left(
                    frame.buffer_mut(),
                    line_rect,
                    Line::styled(
                        fit(&format!(" {}", row.label), usize::from(list_area.width)),
                        look.selected(selected == Some(index), look.role(row.role)),
                    ),
                );
                if let Some(hit) = row.hit.clone() {
                    hits.push((line_rect, hit));
                }
                y += 1;
            }
        }
        if clipped_below > 0 && content_bottom > content_top {
            paint_ds::<MoreHint>(
                frame,
                app,
                Rect::new(list_area.x, content_bottom - 1, list_area.width, 1),
                &MoreHintProps {
                    count: clipped_below,
                    direction: MoreDirection::Down,
                    ascii: ascii_mode(app),
                },
            );
        }
    }

    if split && let Some(item) = selected_item {
        let right_x = area.x + list_w + 1;
        let right_w = area.width.saturating_sub(list_w + 1);
        paint_inspector(
            frame,
            app,
            state,
            item,
            Rect::new(right_x, area.y + top, right_w, body_h),
            roster,
            &mut hits,
        );
    } else if collapsed_bar != 0
        && let Some(item) = selected_item
    {
        let number = item.number.as_deref().unwrap_or(&item.title);
        let bar_rect = Rect::new(area.x, area.y + top + body_h, area.width, 1);
        paint_ds::<SectionRule>(
            frame,
            app,
            bar_rect,
            &SectionRuleProps {
                title: format!("Detail · {number}"),
                note: Some("Space detail".into()),
                note_role: Some(Token(Role::Dim)),
                focused: false,
            },
        );
        hits.push((bar_rect, Hit::ToggleDetail));
    }

    if reserved != 0
        && let Some(item) = selected_item
    {
        let line = band(area.height - 1);
        let can_open = !state.stale && item.can_open;
        let open_action = if state.stale {
            " Stale"
        } else if !can_open {
            " No link · check Colab serve and pairing"
        } else if item.opens_block(selected_section(state, item)) {
            " ⏎ open block"
        } else {
            " ⏎ open page"
        };
        let order_context = state.project.as_ref().is_some_and(|name| {
            list.orders.contains_key(name) || list.omitted_orders.contains(name)
        });
        let choices = order_context.then(|| state.move_choices(&item.key));
        let move_label = choices.as_ref().and_then(|choices| match choices {
            Ok(_) => Some(" m move"),
            Err(_) => None,
        });
        let separator = if move_label.is_some() && !can_open {
            " ·"
        } else {
            ""
        };
        let action = format!("{}{separator}{open_action}", move_label.unwrap_or_default());
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
            || self.work.searching
            || key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
        {
            return None;
        }
        if key.code == KeyCode::Esc && !self.work.inspector_focused {
            return None;
        }
        if !matches!(
            key.code,
            KeyCode::Up
                | KeyCode::Down
                | KeyCode::Left
                | KeyCode::Right
                | KeyCode::Tab
                | KeyCode::Esc
                | KeyCode::Home
                | KeyCode::End
                | KeyCode::PageUp
                | KeyCode::PageDown
                | KeyCode::Enter
                | KeyCode::Char(' ' | 'j' | 'k' | 'o' | 't' | 'p' | 'c' | 'd' | 'm' | 'v' | '/')
        ) {
            return None;
        }
        if key.code == KeyCode::Char('v') {
            self.work.view_dialog = Some(ViewDialog::Manage {
                state: DialogState::new(&[], &[Button::secondary("Close")]),
                cursor: 0,
                hits: Default::default(),
            });
            return Some(Effect::None);
        }
        if key.code == KeyCode::Char('/') {
            self.work.inspector_focused = false;
            self.work.searching = true;
            return Some(Effect::None);
        }
        if key.code == KeyCode::Char(' ') {
            self.work.detail_collapsed = !self.work.detail_collapsed;
            if self.work.detail_collapsed {
                self.work.inspector_focused = false;
            }
            return Some(Effect::None);
        }
        if key.code == KeyCode::Esc && self.work.inspector_focused {
            self.work.inspector_focused = false;
            return Some(Effect::None);
        }
        if key.code == KeyCode::Left && self.work.inspector_focused {
            self.work.inspector_focused = false;
            return Some(Effect::None);
        }
        let roster = self
            .view
            .as_ref()
            .and_then(|view| view.home.as_ref())
            .map(|home| &home.workspace.roster);
        let views = saved_views(self).to_vec();
        let query = self.work.search.as_str().to_owned();
        let state = &mut self.work;
        let Some(list) = &state.list else {
            return matches!(
                key.code,
                KeyCode::Char('p' | 'c' | 'd' | 'm' | 'o' | 't' | 'v') | KeyCode::Enter
            )
            .then_some(Effect::None);
        };
        let utc = jiff::tz::TimeZone::UTC;
        let zone = self.local_zone.as_ref().unwrap_or(&utc);
        let view_filter = active_filter(state, &views);
        let rows = rows(
            list,
            state,
            RowInputs {
                now: crate::status::now_ms() as i64,
                zone,
                width: 0,
                roster,
                query: &query,
                view_filter,
            },
        );
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
        if matches!(key.code, KeyCode::Tab | KeyCode::Right) {
            if !state.detail_collapsed && items.get(index).and_then(|r| r.item).is_some() {
                state.inspector_focused = if key.code == KeyCode::Tab {
                    !state.inspector_focused
                } else {
                    true
                };
                state.inspector_cursor = 0;
            }
            return Some(Effect::None);
        }
        match key.code {
            KeyCode::Up
            | KeyCode::Down
            | KeyCode::Char('k' | 'j')
            | KeyCode::Home
            | KeyCode::End
            | KeyCode::PageUp
            | KeyCode::PageDown => {
                if state.inspector_focused
                    && let Some(item) = items.get(index).and_then(|row| row.item)
                {
                    let end = item.sections.len().saturating_sub(1);
                    state.inspector_cursor = match key.code {
                        KeyCode::Up | KeyCode::Char('k') => {
                            state.inspector_cursor.saturating_sub(1)
                        }
                        KeyCode::Down | KeyCode::Char('j') => (state.inspector_cursor + 1).min(end),
                        KeyCode::Home => 0,
                        _ => end,
                    };
                    return Some(Effect::None);
                }
                let end = items.len().saturating_sub(1);
                let index = match key.code {
                    KeyCode::Up | KeyCode::Char('k') => index.saturating_sub(1),
                    KeyCode::Down | KeyCode::Char('j') => (index + 1).min(end),
                    KeyCode::Home => 0,
                    KeyCode::PageUp => index.saturating_sub(5),
                    KeyCode::PageDown => (index + 5).min(end),
                    _ => end,
                };
                state.selected = items.get(index).and_then(|row| row.selection.clone());
                state.inspector_cursor = 0;
            }
            KeyCode::Enter | KeyCode::Char('o') => {
                let hit = items.get(index).and_then(|row| {
                    row.item
                        .map(|item| Hit::Open(item.key.clone()))
                        .or_else(|| row.hit.clone())
                });
                return Some(hit.map_or(Effect::None, |hit| self.work_hit(hit)));
            }
            KeyCode::Char('t') => {
                let key = items
                    .get(index)
                    .and_then(|row| row.item)
                    .map(|item| item.key.clone());
                return Some(key.map_or(Effect::None, |key| self.work_hit(Hit::Talk(key))));
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

    pub(super) fn work_hit(&mut self, hit: Hit) -> Effect {
        if let Hit::Move(key) = hit {
            return self.open_work_order(&key);
        }
        if let Hit::Search = hit {
            self.work.inspector_focused = false;
            self.work.searching = true;
            return Effect::None;
        }
        if let Hit::SaveView = hit {
            self.work.view_dialog = Some(ViewDialog::Save {
                state: DialogState::new(
                    &[FieldKind::Text, FieldKind::Choice],
                    &[Button::primary("Save"), Button::secondary("Cancel")],
                ),
                hits: Default::default(),
            });
            return Effect::None;
        }
        if let Hit::View(selection) = hit {
            self.apply_work_view_selection(selection);
            return Effect::None;
        }
        if let Hit::Talk(key) = hit {
            let target = self
                .work
                .list
                .as_ref()
                .and_then(|list| list.items.iter().find(|item| item.key == key))
                .and_then(|item| {
                    self.workspace_snapshot()
                        .and_then(|snapshot| item.owner_target(&snapshot.roster))
                });
            if let Some(target) = target {
                self.work.searching = false;
                self.workspace.selected = Some(target.clone());
                self.show_conversation_of(&target);
                if !self.search.is_empty()
                    && !self.workspace_rows().iter().any(|row| row.target == target)
                {
                    super::super::search_field::clear(&mut self.search, &mut self.searching);
                    self.workspace.selected = Some(target);
                    self.workspace_reconcile();
                }
            }
            return Effect::None;
        }
        let state = &mut self.work;
        let Some(list) = &state.list else {
            return Effect::None;
        };
        match hit {
            Hit::Row(key) => {
                state.selected = Some(key);
                state.inspector_cursor = 0;
            }
            Hit::Open(key) => {
                if !state.stale
                    && let Some(item) = list
                        .items
                        .iter()
                        .find(|item| item.key == key && item.can_open)
                {
                    let section = selected_section(state, item);
                    return Effect::OpenWorkPage(item.open_target(section));
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
                state.inspector_cursor = 0;
            }
            Hit::Recent => state.recent = !state.recent,
            Hit::More(project) => {
                if !state.expanded.remove(&project) {
                    state.expanded.insert(project);
                }
            }
            Hit::Period => state.period = (state.period + 1) % 3,
            Hit::ToggleDetail => {
                state.detail_collapsed = !state.detail_collapsed;
                if state.detail_collapsed {
                    state.inspector_focused = false;
                }
            }
            Hit::Section(idx) => {
                state.inspector_focused = true;
                state.inspector_cursor = idx;
            }
            Hit::Move(_) | Hit::Search | Hit::Talk(_) | Hit::View(_) | Hit::SaveView => {
                unreachable!("handled above")
            }
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

    pub(in crate::board) fn apply_default_work_view(&mut self) {
        if self.work.default_view_applied {
            return;
        }
        let Some(default_view) = saved_views(self).iter().find(|view| view.default).cloned() else {
            return;
        };
        self.work.default_view_applied = true;
        self.work.project = default_view.project.clone();
        self.work.search.clear();
        if !default_view.query.is_empty() {
            self.work.search.insert(&default_view.query, 4096);
        }
        self.work.searching = false;
        self.work.detail_collapsed = default_view.detail_collapsed;
        if self.work.detail_collapsed {
            self.work.inspector_focused = false;
        }
        self.work.active_view = ViewSelection::Saved(default_view.name);
        self.work.selected = None;
        self.work.inspector_cursor = 0;
    }

    pub(in crate::board) fn apply_work_view_selection(&mut self, selection: ViewSelection) {
        if let ViewSelection::Saved(name) = &selection
            && let Some(view) = saved_views(self)
                .iter()
                .find(|view| &view.name == name)
                .cloned()
        {
            self.work.project = view.project;
            self.work.search.clear();
            if !view.query.is_empty() {
                self.work.search.insert(&view.query, 4096);
            }
            self.work.searching = false;
            self.work.detail_collapsed = view.detail_collapsed;
            if self.work.detail_collapsed {
                self.work.inspector_focused = false;
            }
        }
        self.work.active_view = selection;
        self.work.selected = None;
        self.work.inspector_cursor = 0;
    }

    fn save_current_work_view(&mut self) -> Effect {
        let name = self.work.view_draft_name.trim().to_owned();
        if name.is_empty() || name.len() > 48 {
            return self.say("Saved view name must be 1–48 bytes.");
        }
        let expected = saved_views(self).to_vec();
        let mut next = expected.clone();
        if self.work.view_draft_default {
            for view in &mut next {
                view.default = false;
            }
        }
        let filter = match &self.work.active_view {
            ViewSelection::NeedsYou => Some("needs-you".to_owned()),
            ViewSelection::Blocked => Some("blocked".to_owned()),
            ViewSelection::Saved(existing) => expected
                .iter()
                .find(|v| v.name == *existing)
                .and_then(|v| v.filter.clone()),
            ViewSelection::All => None,
        };
        let entry = WorkView {
            name: name.clone(),
            project: self.work.project.clone(),
            query: self.work.search.as_str().trim().to_owned(),
            filter,
            detail_collapsed: self.work.detail_collapsed,
            default: self.work.view_draft_default,
        };
        if let Some(pos) = next.iter().position(|v| v.name.eq_ignore_ascii_case(&name)) {
            next[pos] = entry;
        } else if next.len() >= crate::config::MAX_WORK_VIEWS {
            return self.say("At most 16 saved views are allowed.");
        } else {
            next.push(entry);
        }
        self.work.view_dialog = None;
        self.work.active_view = ViewSelection::Saved(name.clone());
        Effect::Act(Request::WorkViews {
            expected,
            next,
            saved: format!("Saved view \"{name}\"."),
        })
    }

    pub(in crate::board) fn render_work_view_dialog(&self, frame: &mut Frame, body: Rect) {
        let Some(dialog_state) = &self.work.view_dialog else {
            return;
        };
        let look = self.look();
        let d_look = DialogLook {
            theme: &look.theme,
            depth: look.depth,
            active: true,
            hovered: None,
        };
        let views = saved_views(self);
        match dialog_state {
            ViewDialog::Save { state, hits } => {
                let buttons = [Button::primary("Save"), Button::secondary("Cancel")];
                let dialog = Dialog {
                    title: "Save Work view".into(),
                    kind: DialogKind::Form,
                    placement: tmt_tui::components::Placement::Center,
                    buttons: buttons.to_vec(),
                    hints: "Tab/↑↓ field · ←→ toggle · Enter save · Esc cancel".into(),
                };
                let areas = dialog.areas(body, [62, 8], false);
                let mut painted = dialog.paint(areas, state, frame.buffer_mut(), d_look);
                let c = areas.content;
                let name_area = Rect::new(c.x, c.y, c.width, 1);
                let def_area = Rect::new(c.x, c.y + 1, c.width, 1);
                let summary_area = Rect::new(c.x, c.y + 3, c.width, 1);
                let focused_name = state.focus == Focus::Field(0);
                let focused_def = state.focus == Focus::Field(1);
                strip::paint_left(
                    frame.buffer_mut(),
                    name_area,
                    Line::styled(
                        fit(
                            &format!(
                                " Name: {}{}",
                                self.work.view_draft_name,
                                if focused_name { "▏" } else { "" }
                            ),
                            usize::from(c.width),
                        ),
                        look.selected(focused_name, look.role(Role::Text)),
                    ),
                );
                strip::paint_left(
                    frame.buffer_mut(),
                    def_area,
                    Line::styled(
                        fit(
                            &format!(
                                " [{}] Default on open",
                                if self.work.view_draft_default {
                                    "x"
                                } else {
                                    " "
                                }
                            ),
                            usize::from(c.width),
                        ),
                        look.selected(focused_def, look.role(Role::Text)),
                    ),
                );
                let query = self.work.search.as_str().trim();
                let proj = self.work.project.as_deref().unwrap_or("All projects");
                strip::paint_left(
                    frame.buffer_mut(),
                    summary_area,
                    Line::styled(
                        fit(
                            &format!(
                                " Scope: {proj} · query: {}",
                                if query.is_empty() { "—" } else { query }
                            ),
                            usize::from(c.width),
                        ),
                        look.role(Role::Muted),
                    ),
                );
                painted.fields = vec![name_area, def_area];
                *hits.borrow_mut() = painted;
            }
            ViewDialog::Manage {
                state,
                cursor,
                hits,
            } => {
                let buttons = [Button::secondary("Close")];
                let dialog = Dialog {
                    title: "Saved Work views".into(),
                    kind: DialogKind::List,
                    placement: tmt_tui::components::Placement::Center,
                    buttons: buttons.to_vec(),
                    hints: "⏎ apply · d set default · x delete · s save · Esc close".into(),
                };
                let rows_h = views.len().clamp(3, 12) as u16 + 2;
                let width = (dialog.footer_width() + 4).max(66).min(body.width);
                let areas = dialog.areas(body, [width, rows_h], false);
                let painted = dialog.paint(areas, state, frame.buffer_mut(), d_look);
                let c = areas.content;
                if views.is_empty() {
                    strip::paint_left(
                        frame.buffer_mut(),
                        Rect::new(c.x, c.y, c.width, 1),
                        Line::styled(
                            " No saved views yet. Press s to save current.",
                            look.role(Role::Muted),
                        ),
                    );
                } else {
                    for (idx, view) in views.iter().enumerate() {
                        if idx as u16 >= c.height {
                            break;
                        }
                        let active = *cursor == idx;
                        let mark = if view.default { "* " } else { "  " };
                        let proj = view.project.as_deref().unwrap_or("All");
                        let q = if view.query.is_empty() {
                            "—"
                        } else {
                            &view.query
                        };
                        let line = format!(
                            "{} {}{}  ({proj} · {q})",
                            if active { "▸" } else { " " },
                            mark,
                            view.name
                        );
                        strip::paint_left(
                            frame.buffer_mut(),
                            Rect::new(c.x, c.y + idx as u16, c.width, 1),
                            Line::styled(
                                fit(&line, usize::from(c.width)),
                                look.selected(active, look.role(Role::Text)),
                            ),
                        );
                    }
                }
                *hits.borrow_mut() = painted;
            }
            ViewDialog::ConfirmDelete { name, state, hits } => {
                let buttons = [
                    Button::primary("Delete").destructive(true),
                    Button::secondary("Cancel"),
                ];
                let dialog = Dialog {
                    title: "Delete saved view".into(),
                    kind: DialogKind::Confirm,
                    placement: tmt_tui::components::Placement::Center,
                    buttons: buttons.to_vec(),
                    hints: "y delete · Esc cancel".into(),
                };
                let areas = dialog.areas(body, [52, 5], false);
                let painted = dialog.paint(areas, state, frame.buffer_mut(), d_look);
                let c = areas.content;
                strip::paint_left(
                    frame.buffer_mut(),
                    Rect::new(c.x, c.y, c.width, 1),
                    Line::styled(
                        fit(&format!(" Delete \"{name}\"?"), usize::from(c.width)),
                        look.role(Role::Text),
                    ),
                );
                *hits.borrow_mut() = painted;
            }
        }
    }

    pub(in crate::board) fn work_view_dialog_key(&mut self, key: KeyEvent) -> Option<Effect> {
        let mut dialog = self.work.view_dialog.take()?;
        let views = saved_views(self).to_vec();
        let effect = match &mut dialog {
            ViewDialog::Save { state, .. } => {
                let buttons = [Button::primary("Save"), Button::secondary("Cancel")];
                match state.key(
                    DialogKind::Form,
                    &key,
                    &[FieldKind::Text, FieldKind::Choice],
                    &buttons,
                ) {
                    DialogInput::Field(0, ev) => {
                        match ev.code {
                            KeyCode::Backspace => {
                                self.work.view_draft_name.pop();
                            }
                            KeyCode::Char(ch)
                                if !ch.is_control() && self.work.view_draft_name.len() < 48 =>
                            {
                                self.work.view_draft_name.push(ch);
                            }
                            _ => {}
                        }
                        self.work.view_dialog = Some(dialog);
                        Effect::None
                    }
                    DialogInput::Field(1, ev) => {
                        if matches!(ev.code, KeyCode::Left | KeyCode::Right | KeyCode::Char(' ')) {
                            self.work.view_draft_default = !self.work.view_draft_default;
                        }
                        self.work.view_dialog = Some(dialog);
                        Effect::None
                    }
                    DialogInput::Choose(0) => self.save_current_work_view(),
                    DialogInput::Choose(1) | DialogInput::Cancel => Effect::None,
                    DialogInput::Choose(_)
                    | DialogInput::Moved
                    | DialogInput::Ignored
                    | DialogInput::Content(_)
                    | DialogInput::Field(_, _) => {
                        self.work.view_dialog = Some(dialog);
                        Effect::None
                    }
                }
            }
            ViewDialog::Manage { state, cursor, .. } => {
                let buttons = [Button::secondary("Close")];
                match state.key(DialogKind::List, &key, &[], &buttons) {
                    DialogInput::Content(ev) => match ev.code {
                        KeyCode::Up | KeyCode::Char('k') => {
                            *cursor = cursor.saturating_sub(1);
                            self.work.view_dialog = Some(dialog);
                            Effect::None
                        }
                        KeyCode::Down | KeyCode::Char('j') => {
                            if !views.is_empty() {
                                *cursor = (*cursor + 1).min(views.len() - 1);
                            }
                            self.work.view_dialog = Some(dialog);
                            Effect::None
                        }
                        KeyCode::Enter => {
                            if let Some(view) = views.get(*cursor) {
                                self.apply_work_view_selection(ViewSelection::Saved(
                                    view.name.clone(),
                                ));
                            }
                            Effect::None
                        }
                        KeyCode::Char('s') => {
                            self.work.view_dialog = Some(ViewDialog::Save {
                                state: DialogState::new(
                                    &[FieldKind::Text, FieldKind::Choice],
                                    &[Button::primary("Save"), Button::secondary("Cancel")],
                                ),
                                hits: Default::default(),
                            });
                            Effect::None
                        }
                        KeyCode::Char('d') => {
                            if let Some(target) = views.get(*cursor) {
                                let name = target.name.clone();
                                let mut next = views.clone();
                                for v in &mut next {
                                    v.default = v.name == name;
                                }
                                self.work.view_dialog = Some(dialog);
                                Effect::Act(Request::WorkViews {
                                    expected: views,
                                    next,
                                    saved: format!("Default view set to \"{name}\"."),
                                })
                            } else {
                                self.work.view_dialog = Some(dialog);
                                Effect::None
                            }
                        }
                        KeyCode::Char('x') => {
                            if let Some(target) = views.get(*cursor) {
                                let buttons = [
                                    Button::primary("Delete").destructive(true),
                                    Button::secondary("Cancel"),
                                ];
                                let mut confirm = DialogState::new(&[], &buttons);
                                confirm.focus = Focus::Buttons(1);
                                self.work.view_dialog = Some(ViewDialog::ConfirmDelete {
                                    name: target.name.clone(),
                                    state: confirm,
                                    hits: Default::default(),
                                });
                            } else {
                                self.work.view_dialog = Some(dialog);
                            }
                            Effect::None
                        }
                        _ => {
                            self.work.view_dialog = Some(dialog);
                            Effect::None
                        }
                    },
                    DialogInput::Choose(0) | DialogInput::Cancel => Effect::None,
                    DialogInput::Moved
                    | DialogInput::Ignored
                    | DialogInput::Choose(_)
                    | DialogInput::Field(_, _) => {
                        self.work.view_dialog = Some(dialog);
                        Effect::None
                    }
                }
            }
            ViewDialog::ConfirmDelete { name, state, .. } => {
                let buttons = [
                    Button::primary("Delete").destructive(true),
                    Button::secondary("Cancel"),
                ];
                if key.code == KeyCode::Char('y') {
                    let mut next = views.clone();
                    next.retain(|v| v.name != *name);
                    if matches!(&self.work.active_view, ViewSelection::Saved(n) if n == name) {
                        self.work.active_view = ViewSelection::All;
                    }
                    Effect::Act(Request::WorkViews {
                        expected: views,
                        next,
                        saved: format!("Deleted view \"{name}\"."),
                    })
                } else {
                    match state.key(DialogKind::Confirm, &key, &[], &buttons) {
                        DialogInput::Choose(0) => {
                            let mut next = views.clone();
                            next.retain(|v| v.name != *name);
                            if matches!(&self.work.active_view, ViewSelection::Saved(n) if n == name)
                            {
                                self.work.active_view = ViewSelection::All;
                            }
                            Effect::Act(Request::WorkViews {
                                expected: views,
                                next,
                                saved: format!("Deleted view \"{name}\"."),
                            })
                        }
                        DialogInput::Choose(1) | DialogInput::Cancel => Effect::None,
                        _ => {
                            self.work.view_dialog = Some(dialog);
                            Effect::None
                        }
                    }
                }
            }
        };
        Some(effect)
    }

    pub(in crate::board) fn work_view_dialog_mouse(&mut self, event: MouseEvent) -> Option<Effect> {
        let mut dialog = self.work.view_dialog.take()?;
        let effect = match &mut dialog {
            ViewDialog::Save { state, hits } => {
                let h = hits.borrow().clone();
                let buttons = [Button::primary("Save"), Button::secondary("Cancel")];
                match state.mouse(&event, &h, &buttons) {
                    DialogInput::Choose(0) => self.save_current_work_view(),
                    DialogInput::Choose(1) | DialogInput::Cancel => Effect::None,
                    _ => {
                        self.work.view_dialog = Some(dialog);
                        Effect::None
                    }
                }
            }
            ViewDialog::Manage { state, hits, .. } => {
                let h = hits.borrow().clone();
                let buttons = [Button::secondary("Close")];
                match state.mouse(&event, &h, &buttons) {
                    DialogInput::Choose(0) | DialogInput::Cancel => Effect::None,
                    _ => {
                        self.work.view_dialog = Some(dialog);
                        Effect::None
                    }
                }
            }
            ViewDialog::ConfirmDelete { name, state, hits } => {
                let h = hits.borrow().clone();
                let buttons = [
                    Button::primary("Delete").destructive(true),
                    Button::secondary("Cancel"),
                ];
                let views = saved_views(self).to_vec();
                match state.mouse(&event, &h, &buttons) {
                    DialogInput::Choose(0) => {
                        let mut next = views.clone();
                        next.retain(|v| v.name != *name);
                        if matches!(&self.work.active_view, ViewSelection::Saved(n) if n == name) {
                            self.work.active_view = ViewSelection::All;
                        }
                        Effect::Act(Request::WorkViews {
                            expected: views,
                            next,
                            saved: format!("Deleted view \"{name}\"."),
                        })
                    }
                    DialogInput::Choose(1) | DialogInput::Cancel => Effect::None,
                    _ => {
                        self.work.view_dialog = Some(dialog);
                        Effect::None
                    }
                }
            }
        };
        Some(effect)
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
