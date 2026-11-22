//! Member identity and observed statistics; conversation retains its session.
use super::*;

pub(super) fn render_header(
    frame: &mut Frame,
    app: &App,
    area: Rect,
    name: &str,
    row: &serde_json::Value,
    target: &OpsTarget,
    squad: Option<&OpsSquad>,
) -> u16 {
    use ratatui::style::Modifier;
    use unicode_width::UnicodeWidthStr;

    let OpsTarget::Member { identity_id, .. } = target else {
        return area.y;
    };
    let look = app.look();
    let mut y = area.y;
    let tab = Rect::new(area.x, y, area.width, area.height.min(1));
    let used = crate::board::talk_measure::paint_member_tabs(frame.buffer_mut(), app, tab, target);
    if app.right_tab == crate::board::shell::RightTab::Talk
        && !app.screen_mode()
        && tab.width >= used.saturating_add(2)
        && let Some(glyph) = app.conversation_spinner(&RowTarget::Workspace(target.clone()))
    {
        strip::paint_left(
            frame.buffer_mut(),
            Rect::new(tab.x + used + 1, tab.y, 1, 1),
            neutral(glyph, look),
        );
    }
    y += tab.height;
    if y >= area.bottom() {
        return y;
    }

    let mut status = app
        .workspace_snapshot()
        .and_then(|snapshot| super::super::workspace::member_target_row(&snapshot.roster, target))
        .and_then(|row| app.activity_label(&row))
        .map_or_else(
            || neutral("?", look),
            |label| {
                let mark = if label.state == "working" {
                    Span::styled("●", look.role(Role::Working))
                } else {
                    state_cell::mark(Some(label.state), look)
                };
                Line::from(vec![
                    mark,
                    Span::styled(format!(" {}", label.state), look.role(Role::Muted)),
                ])
            },
        );
    let count = app.unread_target(target);
    let unread = state_cell::unread(count, look).unwrap_or_else(|| neutral("○ 0 unread", look));
    if status.width() + unread.width() + 3 < usize::from(area.width) {
        status.spans.push(Span::raw("  "));
    } else {
        status = Line::default();
    }
    let unread_start = status.width();
    status.spans.extend(unread.spans);
    let status_width = status.width().min(usize::from(area.width)) as u16;
    let name_width = area.width.saturating_sub(status_width);
    let name_area = Rect::new(area.x, y, name_width, 1);
    let name = super::super::notes::single_line(name);
    let scope = squad.map_or_else(
        || "COMMON POOL".to_owned(),
        |squad| super::super::notes::single_line(&squad.name).to_uppercase(),
    );
    let label = format!("   {scope} / MEMBER");
    let mut title = vec![Span::styled(
        format!(
            " {}",
            super::super::view::fit(&name, usize::from(name_width.saturating_sub(1))).trim_end()
        ),
        look.role(Role::Text).add_modifier(Modifier::BOLD),
    )];
    if title[0].width() + label.width() < usize::from(name_width) {
        title.push(Span::styled(label, look.role(Role::Muted)));
        if let Some(label) = app.workspace_snapshot().and_then(|snapshot| {
            let labels = &snapshot.preferences.labels;
            let assigned = labels.members.get(identity_id)?;
            labels
                .definitions
                .iter()
                .find(|label| &label.id == assigned)
        }) {
            let label = format!(" · {}", super::super::notes::single_line(&label.name));
            if title.iter().map(Span::width).sum::<usize>() + label.width()
                <= usize::from(name_width)
            {
                title.push(Span::styled(label, look.role(Role::Muted)));
            }
        }
    }
    strip::paint_left(frame.buffer_mut(), name_area, Line::from(title));
    let status_area = Rect::new(name_area.right(), y, status_width, 1);
    strip::paint_left(frame.buffer_mut(), status_area, status);
    if unread_start < usize::from(status_width) {
        app.push_unread_row_hit(
            Rect::new(
                status_area.x + unread_start as u16,
                y,
                status_width - unread_start as u16,
                1,
            ),
            target,
        );
    }
    y += 1;

    let observed = app.references.agents.get(identity_id);
    let runtime = observed
        .and_then(|agent| agent.runtime.as_deref())
        .or_else(|| row["runningDriver"].as_str());
    let model = observed
        .and_then(|agent| agent.model.as_deref())
        .or_else(|| row["fields"]["model"].as_str());
    let effort = row["resume"]["launch"]["effort"].as_str();
    let driver = row["pane"]["location"]["host"].as_str();
    let context = observed.and_then(|agent| agent.context).and_then(|usage| {
        usage
            .window_tokens
            .filter(|window| *window > 0)
            .map(|window| {
                let percent =
                    (u128::from(usage.used_tokens) * 100 / u128::from(window)).min(100) as usize;
                let full = (percent * 8 + 50) / 100;
                vec![
                    Span::styled("ctx ", look.role(Role::Muted)),
                    Span::styled("█".repeat(full), look.role(Role::Working)),
                    Span::styled("░".repeat(8 - full), look.role(Role::Dim)),
                    Span::styled(format!(" {percent}%"), look.role(Role::Working)),
                ]
            })
    });
    let provider = runtime.map_or_else(
        || "—".into(),
        |id| {
            super::super::limits::Provider::from_driver(id)
                .map_or_else(|| id.to_owned(), |provider| provider.label())
        },
    );
    let provider_role =
        observed
            .and_then(|agent| agent.provider_hue)
            .unwrap_or(if runtime.is_some() {
                Role::Waiting
            } else {
                Role::Muted
            });
    use tmt_cli_style::theme::screen::{Fill, fill};
    let provider_style =
        fill(&look.theme, provider_role, look.depth, Fill::Solid).add_modifier(Modifier::BOLD);
    let provider_style = if provider_style.bg.is_none() {
        provider_style.add_modifier(Modifier::REVERSED)
    } else {
        provider_style
    };
    let model = model.map_or_else(
        || "—".into(),
        |model| effort.map_or_else(|| model.into(), |effort| format!("{model} · {effort}")),
    );
    let tokens = app
        .member_usage_observation(
            identity_id,
            crate::config::TokenWindow::HOUR,
            crate::status::now_instant(),
        )
        .map_or_else(
            || "—".into(),
            |(_, reading)| format!("{} tok 1h", token_label(Some(reading))),
        );
    let host_label = driver.map(|host| {
        row["pane"]["target"]
            .as_str()
            .filter(|target| !target.is_empty())
            .map_or_else(|| host.to_owned(), |target| format!("{host} {target}"))
    });
    let fields = [
        vec![Span::styled(
            format!(" {} ", super::super::notes::single_line(&provider)),
            provider_style,
        )],
        vec![Span::styled(
            super::super::notes::single_line(&model),
            look.role(Role::Accent),
        )],
        vec![Span::styled(
            super::super::notes::single_line(host_label.as_deref().unwrap_or("—")),
            look.role(Role::Waiting),
        )],
        context.unwrap_or_else(|| vec![Span::styled("—", look.role(Role::Dim))]),
        vec![Span::styled(tokens, look.role(Role::Text))],
    ];
    let mut info = vec![Span::raw(" ")];
    let mut used = 1;
    let mut driver_hit = None;
    for (index, field) in fields.into_iter().enumerate() {
        let width: usize = field.iter().map(Span::width).sum();
        let separator = if index == 0 {
            ""
        } else if index == 1 {
            " "
        } else {
            "  ·  "
        };
        let start = used + separator.width();
        if start + width > usize::from(area.width) {
            break;
        }
        if index == 2 && driver.is_some() {
            driver_hit = Some(Rect::new(area.x + start as u16, y, width as u16, 1));
        }
        info.push(Span::styled(separator, look.role(Role::Dim)));
        info.extend(field);
        used = start + width;
    }
    let info_y = y;
    line(frame, area, &mut y, Line::from(info));
    if y > info_y
        && app.workspace_selection_visible()
        && let Some(hit) = driver_hit
        && let Some(action) = app.bindings().get("z").cloned()
    {
        app.workspace_action_hits.borrow_mut().push((
            hit,
            target.clone(),
            crate::board::app::Choice::Action(action),
        ));
    }
    y
}

/// The four Measure cells of one agent: TOK 1h, STATE, DIGEST and TIMERS.
pub(in crate::board) fn tiles(
    frame: &mut Frame,
    app: &App,
    area: Rect,
    y: &mut u16,
    row: &serde_json::Value,
    target: &OpsTarget,
    squad: Option<&OpsSquad>,
) {
    let OpsTarget::Member {
        identity_id: id,
        room_id,
    } = target
    else {
        return;
    };
    let room = room_id.as_deref();
    let look = app.look();
    if area.bottom().saturating_sub(*y) >= stat_tiles::ROWS {
        let tile_area = Rect::new(area.x, *y, area.width, stat_tiles::ROWS);
        let tracks = stat_tiles::tracks(tile_area, 4);
        let reading = app.overview_member_usage(id);
        let trend = app
            .overview_member_trend::<8>(id)
            .map(|value| value.map(|n| n as u64));
        let scale = spark_row::scale(trend.into_iter()).unwrap_or(0);
        let spark = trend
            .into_iter()
            .map(|value| spark_row::glyph(value, scale))
            .collect::<String>();
        let token_value = if reading.is_some() {
            use unicode_width::UnicodeWidthStr;
            let token = token_label(reading);
            let width = tracks
                .first()
                .map_or(0, |rect| usize::from(rect.width.saturating_sub(2)));
            let gap = width.saturating_sub(token.width() + spark.width()).min(2);
            let spark = if gap > 0 { spark } else { String::new() };
            Line::from(vec![
                Span::styled(token, look.role(Role::Text)),
                Span::raw(" ".repeat(gap)),
                Span::styled(spark, look.role(Role::Muted)),
            ])
        } else {
            Line::styled("—", look.role(Role::Dim))
        };
        let detail = squad.map_or_else(
            || "—".into(),
            |squad| {
                use unicode_width::UnicodeWidthStr;
                let share = share(reading, app.overview_squad_usage(squad));
                let detail = format!("{share} of {}", squad.name);
                let width = tracks
                    .first()
                    .map_or(0, |rect| usize::from(rect.width.saturating_sub(2)));
                if detail.width() <= width {
                    detail
                } else {
                    format!("{share} {}", squad.name)
                }
            },
        );
        let mut labels = crate::board::workspace::columns::member_digest_labels(&app.labels, id);
        // Supplied modes win; otherwise keep Core's live Digest policy labels.
        let policy = labels.is_empty() && app.labels.of(id).next().is_none();
        if policy {
            labels = super::super::row_chips::of(&app.labels, row, crate::status::now_ms())
                .into_iter()
                .map(
                    |chip| crate::board::workspace::columns::WorkspaceColumnLabel {
                        text: chip.text,
                        actionable: false,
                    },
                )
                .collect();
        }
        let primary = labels.first();
        let digest = primary.map_or_else(
            || "—".into(),
            |label| {
                format!(
                    "{}{}",
                    crate::board::notes::single_line(&label.text),
                    if label.actionable { " ▾" } else { "" }
                )
            },
        );
        let detail_width = tracks
            .get(2)
            .map_or(0, |rect| usize::from(rect.width.saturating_sub(2)));
        let detail_chips: Vec<_> = labels
            .iter()
            .skip(1)
            .enumerate()
            .map(|(index, label)| crate::board::row_chips::Chip {
                text: format!(
                    "{}{}",
                    if index > 0 { " · " } else { "" },
                    crate::board::notes::single_line(&label.text)
                ),
                role: Role::Muted,
                head: false,
            })
            .collect();
        let detail_count = crate::board::row_chips::prefix(&detail_chips, detail_width);
        let savings = app.digest_savings([id.as_str()]);
        let estimate = app.compact_savings_caption(&savings, detail_width);
        let digest_detail = detail_chips[..detail_count]
            .iter()
            .map(|chip| chip.text.as_str())
            .collect::<String>();
        let timers = app.cron.counts.count(CronCountScope::Owner { id, room });
        let tiles = [
            Tile {
                label: app.tok_range().caption(),
                value: token_value,
                detail: neutral(detail, look),
            },
            Tile {
                label: "STATE",
                value: member_state(
                    app,
                    target,
                    tracks
                        .get(1)
                        .map_or(0, |rect| usize::from(rect.width.saturating_sub(2))),
                ),
                detail: Line::default(),
            },
            Tile {
                label: "DIGEST",
                value: Line::styled(
                    digest.clone(),
                    look.role(if primary.is_some() {
                        Role::Text
                    } else {
                        Role::Dim
                    }),
                ),
                detail: neutral(estimate.clone().unwrap_or(digest_detail), look),
            },
            Tile {
                label: "TIMERS",
                value: Line::styled(
                    timers.map_or_else(
                        || "—".into(),
                        |count| {
                            if count.total == 0 {
                                "none".into()
                            } else {
                                count.total.to_string()
                            }
                        },
                    ),
                    look.role(Role::Text),
                ),
                detail: timers
                    .filter(|count| count.total > 0)
                    .map_or_else(Line::default, |count| {
                        neutral(format!("{} on", count.active), look)
                    }),
            },
        ];
        let rects = stat_tiles::paint(frame.buffer_mut(), tile_area, &tiles, look);
        if let Some(rect) = rects.get(2) {
            if let Some(estimate) = &estimate
                && app.workspace_selection_visible()
            {
                app.savings_hit(
                    rect.x + 1,
                    rect.y + 2,
                    unicode_width::UnicodeWidthStr::width(estimate.as_str()),
                    rect.width.saturating_sub(2),
                );
            }
            if policy
                && super::super::row_chips::clock(&app.labels, row, crate::status::now_ms())
                    .is_some()
                && (primary.is_some_and(|label| {
                    unicode_width::UnicodeWidthStr::width(label.text.as_str())
                        <= usize::from(rect.width.saturating_sub(2))
                }))
            {
                let primary_width = primary.map_or(0, |label| {
                    unicode_width::UnicodeWidthStr::width(label.text.as_str())
                });
                let shown = primary_width
                    + if estimate.is_none() && detail_count > 0 {
                        detail_width
                    } else {
                        0
                    };
                app.frame_clocks
                    .borrow_mut()
                    .push(super::super::view::ClockSurface::Labels {
                        target: RowTarget::Workspace(target.clone()),
                        width: shown,
                    });
            }
        }
        if app.workspace_selection_visible()
            && primary.is_some_and(|label| label.actionable)
            && rects.get(2).is_some_and(|rect| {
                unicode_width::UnicodeWidthStr::width(digest.as_str())
                    <= usize::from(rect.width.saturating_sub(2))
            })
        {
            let rect = rects[2];
            app.chip_hits.borrow_mut().push((
                Rect::new(
                    rect.x + 1,
                    rect.y + 1,
                    unicode_width::UnicodeWidthStr::width(digest.as_str()) as u16,
                    1,
                ),
                app.selected,
            ));
        }
        *y += stat_tiles::ROWS;
    }
}
