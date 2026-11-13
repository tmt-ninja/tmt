//! The TOK heading has unit and window controls, each with its own hit area and hover.
//! The unit switches the whole column like a figure does.
use super::*;
use crate::{
    board::app::{Choice, Request},
    config::SavingsUnit,
};
use ratatui::{
    Terminal,
    backend::TestBackend,
    buffer::Buffer,
    crossterm::event::{KeyModifiers, MouseButton, MouseEvent, MouseEventKind},
    layout::Rect,
};
use std::time::Instant;

fn hold(app: &mut App, unit: SavingsUnit) {
    app.view
        .as_mut()
        .unwrap()
        .home
        .as_mut()
        .unwrap()
        .workspace
        .preferences
        .savings_unit = unit;
}

fn open(unit: SavingsUnit) -> App {
    let mut app = board();
    app.shell.tab = crate::board::shell::OpsTab::Agents;
    hold(&mut app, unit);
    app
}

fn frame(app: &App, width: u16) -> Buffer {
    let mut terminal = Terminal::new(TestBackend::new(width, 40)).unwrap();
    terminal
        .draw(|frame| crate::board::view::render(frame, app))
        .unwrap();
    terminal.backend().buffer().clone()
}

#[test]
fn live_projection_only_visits_painted_members_and_painted_squads() {
    use crate::board::workspace::OpsTarget;
    use std::collections::BTreeSet;

    let app = populated_board(36, 10_000);
    frame(&app, 160);
    let rows = app.workspace_rows();
    let mut allowed = BTreeSet::new();
    let mut painted = 0;
    for hit in app.hits.borrow().iter() {
        let Some(index) = hit.row() else { continue };
        let Some(row) = rows.get(index) else { continue };
        painted += 1;
        match &row.target {
            OpsTarget::Member { identity_id, .. } => {
                allowed.insert(identity_id.clone());
            }
            OpsTarget::Squad(room) => {
                if let Some(squad) = app
                    .workspace_snapshot()
                    .unwrap()
                    .roster
                    .squads
                    .iter()
                    .find(|squad| &squad.room_id == room)
                {
                    allowed.extend(squad.members.iter().cloned());
                }
            }
            _ => {}
        }
    }
    assert!(painted > 0 && painted <= 36, "painted {painted} rows");
    let attempted = app.agents_live.missing.borrow().clone();
    assert!(!attempted.is_empty());
    assert!(attempted.is_subset(&allowed));
    frame(&app, 160);
    assert_eq!(*app.agents_live.missing.borrow(), attempted);
}

#[test]
fn live_projection_retains_only_the_last_painted_rows_and_their_squads() {
    use crate::board::workspace::OpsTarget;
    use std::collections::BTreeSet;

    let mut app = populated_board(36, 10_000);
    let rooms: Vec<_> = app
        .workspace_snapshot()
        .unwrap()
        .roster
        .squads
        .iter()
        .map(|squad| squad.room_id.clone())
        .collect();
    for room in &rooms {
        app.workspace.visibility.scope = vec![room.clone()];
        app.workspace_reconcile();
        app.invalidate_frame_geometry();
        frame(&app, 160);
    }
    let rows = app.workspace_rows();
    let mut allowed = BTreeSet::new();
    for hit in app.hits.borrow().iter() {
        let Some(row) = hit.row().and_then(|index| rows.get(index)) else {
            continue;
        };
        match &row.target {
            OpsTarget::Member { identity_id, .. } => {
                allowed.insert(identity_id.clone());
            }
            OpsTarget::Squad(room) => {
                if let Some(squad) = app
                    .workspace_snapshot()
                    .unwrap()
                    .roster
                    .squads
                    .iter()
                    .find(|squad| &squad.room_id == room)
                {
                    allowed.extend(squad.members.iter().cloned());
                }
            }
            _ => {}
        }
    }
    let missing = app.agents_live.missing.borrow();
    let live = app.agents_live.usage.borrow();
    assert!(
        missing
            .iter()
            .chain(live.keys())
            .all(|id| allowed.contains(id)),
        "memo retained identities outside the last painted frame"
    );
}

fn area_of(app: &App, wanted: impl Fn(&Choice) -> bool) -> Option<Rect> {
    app.workspace_strip_hits
        .borrow()
        .iter()
        .find_map(|(area, choice)| wanted(choice).then_some(*area))
}

struct Parts {
    mark: Option<Rect>,
    unit: Rect,
    window: Rect,
}

fn parts(app: &App) -> Parts {
    Parts {
        mark: None,
        unit: area_of(app, |choice| *choice == Choice::TokUnit).expect("no unit hit"),
        window: area_of(app, |choice| matches!(choice, Choice::TokRange(_)))
            .expect("no window hit"),
    }
}

fn text(buffer: &Buffer, area: Rect) -> String {
    (area.x..area.x + area.width)
        .map(|x| buffer[(x, area.y)].symbol().to_owned())
        .collect()
}

fn mouse(app: &mut App, kind: MouseEventKind, area: Rect) -> Effect {
    app.mouse(
        MouseEvent {
            kind,
            column: area.x,
            row: area.y,
            modifiers: KeyModifiers::NONE,
        },
        Instant::now(),
    )
}

fn hover(app: &mut App, area: Rect) {
    app.move_pointer(MouseEvent {
        kind: MouseEventKind::Moved,
        column: area.x,
        row: area.y,
        modifiers: KeyModifiers::NONE,
    });
}

fn accented(app: &App, buffer: &Buffer, x: u16, y: u16) -> bool {
    buffer[(x, y)].fg
        == app
            .look()
            .role(tmt_cli_style::Role::Accent)
            .fg
            .unwrap_or_default()
}

const LISTS: [&str; 1] = ["squads"];

#[test]
fn a_click_on_the_unit_word_switches_every_row_and_selects_nothing() {
    for name in LISTS {
        for (held, wanted) in [
            (SavingsUnit::Tokens, SavingsUnit::Cost),
            (SavingsUnit::Percent, SavingsUnit::Cost),
            (SavingsUnit::Cost, SavingsUnit::Tokens),
        ] {
            let mut app = open(held);
            paint(&app, 160, 40);
            let unit = parts(&app).unit;
            let (selected, order) = (app.workspace.selected.clone(), app.workspace_order());
            let Effect::Act(Request::WorkspacePreferences { expected, next, .. }) =
                mouse(&mut app, MouseEventKind::Down(MouseButton::Left), unit)
            else {
                panic!("{name} {held:?}: the unit word must use the preferences writer");
            };
            assert_eq!(next.savings_unit, wanted, "{name} {held:?}");
            let mut rest = next.clone();
            rest.savings_unit = held;
            assert_eq!(rest, expected, "{name}: only the unit changes");
            assert_eq!(app.workspace.selected, selected, "{name}: selects nothing");
            assert_eq!(app.workspace_order(), order, "{name}: sorts nothing");
        }
    }
}

#[test]
fn each_tok_part_lights_up_alone_under_the_pointer() {
    for width in [120, 80] {
        for name in LISTS {
            let mut app = open(SavingsUnit::Tokens);
            // This assertion compares colours, independent of ambient NO_COLOR.
            let view = app.view.as_mut().unwrap();
            view.look = crate::look::Look::default();
            view.home.as_mut().unwrap().workspace.squad_looks.clear();
            paint(&app, width, 40);
            let at = parts(&app);
            let y = at.unit.y;
            let idle = frame(&app, width);
            assert!(
                (at.unit.x - 1..at.window.x + at.window.width)
                    .all(|x| !accented(&app, &idle, x, y)),
                "{name} {width}: nothing is lit without the pointer"
            );
            let mut controls = vec![("unit", at.unit), ("window", at.window)];
            if let Some(mark) = at.mark {
                controls.push(("sort", mark));
            }
            assert!(
                at.mark.is_none(),
                "{name} {width}: the tree does not sort by tokens"
            );
            for (part, area) in &controls {
                hover(&mut app, *area);
                paint(&app, width, 40);
                let lit = frame(&app, width);
                for (other, rect) in &controls {
                    let on = (rect.x..rect.x + rect.width).all(|x| accented(&app, &lit, x, y));
                    assert_eq!(
                        on,
                        other == part,
                        "{name} {width}: hover {part} lights {other}"
                    );
                }
                assert_eq!(
                    parts(&app).unit,
                    at.unit,
                    "{name} {width}: a hover never moves the hit areas"
                );
            }
        }
    }
}

#[test]
fn hovering_the_unit_word_names_the_other_unit_and_the_hit_stays_put() {
    for name in LISTS {
        for (held, now, other) in [
            (SavingsUnit::Tokens, "TOK", "≈$"),
            (SavingsUnit::Cost, "≈$", "TOK"),
        ] {
            let mut app = open(held);
            paint(&app, 160, 40);
            let at = parts(&app);
            assert_eq!(text(&frame(&app, 160), at.unit), now, "{name} {held:?}");
            hover(&mut app, at.unit);
            paint(&app, 160, 40);
            let lit = frame(&app, 160);
            let row = Rect::new(0, at.unit.y, 160, 1);
            let line = text(&lit, row);
            assert!(
                line.contains(&format!("{other} 1h")),
                "{name} {held:?}: the label names the unit a click gives: {line}"
            );
            assert_eq!(parts(&app).unit, at.unit, "{name} {held:?}");
            assert_eq!(text(&lit, at.window), "1h", "{name} {held:?}");
        }
    }
}

#[test]
fn the_window_keeps_cycling() {
    let mut app = open(SavingsUnit::Tokens);
    paint(&app, 160, 40);
    let window = parts(&app).window;
    let Effect::Act(Request::WorkspacePreferences { expected, next, .. }) =
        mouse(&mut app, MouseEventKind::Down(MouseButton::Left), window)
    else {
        panic!("the window word must use the preferences writer");
    };
    assert_eq!(next.tok_range, expected.tok_range.next());
}

fn sampled_member_row() -> String {
    use crate::board::agents_live::AgentsLiveUsage;
    use crate::board::rate::Reading;

    let mut app = open(SavingsUnit::Tokens);
    // The activity glyph is visible at NO_COLOR depth rather than the color ramp's background.
    let view = app.view.as_mut().unwrap();
    view.look.depth = tmt_cli_style::Depth::None;
    view.home.as_mut().unwrap().workspace.squad_looks.clear();
    let mut activity = [Some(0.0); 12];
    activity[11] = Some(120.0);
    app.agents_live.begin(&app, Instant::now());
    app.agents_live.usage.get_mut().insert(
        MEMBER.into(),
        AgentsLiveUsage {
            minute: Some(Reading {
                tokens: 1_234,
                partial: false,
                span: 60,
            }),
            activity,
        },
    );
    let lines = paint(&app, 240, 40);
    let row = lines
        .iter()
        .find(|line| {
            (line.contains("└ worker") || line.contains("├ worker")) && line.contains("working")
        })
        .unwrap_or_else(|| panic!("visible member row: {lines:?}"));
    row.to_owned()
}

#[test]
fn sampled_member_minute_is_painted_in_the_live_column() {
    let row = sampled_member_row();
    assert!(
        row.contains("1.2k"),
        "the measured per-minute figure: {row}"
    );
}

#[test]
fn sampled_member_activity_is_painted_oldest_to_newest() {
    let row = sampled_member_row();
    assert!(
        row.contains("···········█"),
        "the oldest-to-newest activity cells: {row}"
    );
}

fn minute_cell(reading: Option<crate::board::rate::Reading>) -> String {
    let mut app = open(SavingsUnit::Tokens);
    app.agents_live.begin(&app, Instant::now());
    app.agents_live.usage.get_mut().insert(
        MEMBER.into(),
        crate::board::agents_live::AgentsLiveUsage {
            minute: reading,
            activity: [None; 12],
        },
    );
    let buffer = frame(&app, 240);
    let rows: Vec<_> = buffer.content.chunks(240).collect();
    let heading = rows
        .iter()
        .find(|row| {
            row.windows(7).any(|cells| {
                cells.iter().map(|cell| cell.symbol()).collect::<String>() == "TOK/min"
            })
        })
        .expect("per-minute heading");
    let x = heading
        .windows(7)
        .position(|cells| cells.iter().map(|cell| cell.symbol()).collect::<String>() == "TOK/min")
        .unwrap();
    let row = rows
        .iter()
        .find(|cells| {
            let text: String = cells.iter().map(|cell| cell.symbol()).collect();
            text.contains("└ worker") && text.contains("working")
        })
        .expect("member row");
    row[x..x + 7]
        .iter()
        .map(|cell| cell.symbol())
        .collect::<String>()
        .trim()
        .to_owned()
}

#[test]
fn minute_track_distinguishes_observed_zero_from_unavailable() {
    use crate::board::rate::Reading;
    assert_eq!(minute_cell(None), "—");
    assert_eq!(
        minute_cell(Some(Reading {
            tokens: 0,
            partial: false,
            span: 60
        })),
        "0"
    );
}

#[test]
fn minute_track_marks_partial_evidence() {
    use crate::board::rate::Reading;
    assert_eq!(
        minute_cell(Some(Reading {
            tokens: 1_234,
            partial: true,
            span: 30
        })),
        "~1.2k"
    );
}

#[test]
fn squad_minute_deduplicates_members_and_marks_missing_evidence() {
    use crate::board::{agents_live::AgentsLiveUsage, rate::Reading};

    let mut app = open(SavingsUnit::Tokens);
    let roster = &mut app
        .view
        .as_mut()
        .unwrap()
        .home
        .as_mut()
        .unwrap()
        .workspace
        .roster;
    let mut missing = roster.members[MEMBER].clone();
    missing.id = "missing".into();
    missing.name = "missing".into();
    roster.members.insert(missing.id.clone(), missing);
    roster.squads[0]
        .members
        .extend([MEMBER.into(), "missing".into()]);
    app.agents_live.begin(&app, Instant::now());
    app.agents_live.usage.get_mut().insert(
        MEMBER.into(),
        AgentsLiveUsage {
            minute: Some(Reading {
                tokens: 1_234,
                partial: false,
                span: 60,
            }),
            activity: [None; 12],
        },
    );
    app.workspace_reconcile();
    app.agents_live.squads.get_mut().clear();
    let buffer = frame(&app, 240);
    let rows: Vec<_> = buffer.content.chunks(240).collect();
    let header = rows
        .iter()
        .find(|row| {
            row.windows(7).any(|cells| {
                cells.iter().map(|cell| cell.symbol()).collect::<String>() == "TOK/min"
            })
        })
        .expect("per-minute heading");
    let x = header
        .windows(7)
        .position(|cells| cells.iter().map(|cell| cell.symbol()).collect::<String>() == "TOK/min")
        .unwrap();
    let squad = rows
        .iter()
        .find(|cells| {
            let text: String = cells.iter().map(|cell| cell.symbol()).collect();
            text.contains("▾ product")
        })
        .expect("squad row");
    let value: String = squad[x..x + 7].iter().map(|cell| cell.symbol()).collect();
    assert_eq!(
        value.trim(),
        "~1.2k",
        "sum the identity once and mark missing evidence"
    );
}

#[test]
fn changed_minute_figure_is_bold_in_the_painted_member_row() {
    use crate::board::{agents_live::AgentsLiveUsage, rate::Reading};
    use ratatui::style::Modifier;
    let mut app = open(SavingsUnit::Tokens);
    let view = app.view.as_mut().unwrap();
    view.look.depth = tmt_cli_style::Depth::TrueColor;
    view.home.as_mut().unwrap().workspace.squad_looks.clear();
    let usage = |tokens| AgentsLiveUsage {
        minute: Some(Reading {
            tokens,
            partial: false,
            span: 60,
        }),
        activity: [None; 12],
    };
    app.agents_live
        .usage
        .get_mut()
        .insert(MEMBER.into(), usage(100));
    frame(&app, 240);
    app.agents_live
        .usage
        .get_mut()
        .insert(MEMBER.into(), usage(400));
    let buffer = frame(&app, 240);
    let rows: Vec<_> = buffer.content.chunks(240).collect();
    let heading = rows
        .iter()
        .find(|row| {
            row.windows(7).any(|cells| {
                cells.iter().map(|cell| cell.symbol()).collect::<String>() == "TOK/min"
            })
        })
        .expect("per-minute heading");
    let x = heading
        .windows(7)
        .position(|cells| cells.iter().map(|cell| cell.symbol()).collect::<String>() == "TOK/min")
        .unwrap();
    let row = rows
        .iter()
        .find(|cells| {
            let text: String = cells.iter().map(|cell| cell.symbol()).collect();
            text.contains("└ worker") && text.contains("working")
        })
        .expect("member row");
    assert!(
        row[x..x + 7]
            .iter()
            .any(|cell| cell.modifier.contains(Modifier::BOLD)),
        "changed TOK/min is bold"
    );
}

#[test]
fn selected_activity_keeps_the_no_color_reverse_cue_on_observed_cells() {
    let mut app = open(SavingsUnit::Tokens);
    let view = app.view.as_mut().unwrap();
    view.look.depth = tmt_cli_style::Depth::None;
    view.home.as_mut().unwrap().workspace.squad_looks.clear();
    let mut activity = [None; 12];
    activity[11] = Some(120.0);
    app.agents_live.begin(&app, Instant::now());
    app.agents_live.usage.get_mut().insert(
        MEMBER.into(),
        crate::board::agents_live::AgentsLiveUsage {
            minute: None,
            activity,
        },
    );
    let buffer = frame(&app, 240);
    let hit = app.hits.borrow().iter().find(|hit| hit.row().is_some_and(|index|
        matches!(&app.workspace_rows()[index].target, OpsTarget::Member { identity_id, .. } if identity_id == MEMBER)
    )).copied().unwrap();
    let x = (hit.x..hit.x + hit.width)
        .find(|&x| buffer[(x, hit.y)].symbol() == "█")
        .unwrap();
    assert!(
        buffer[(x, hit.y)]
            .modifier
            .contains(ratatui::style::Modifier::REVERSED)
    );
}

#[test]
#[ignore = "read-only live Agents layout evidence; never records fixtures"]
fn capture_live_agents_widths() {
    use crate::board::{agents_live::AgentsLiveUsage, rate::Reading};
    use tmt_cli_style::{Depth, Theme, theme::Base};
    let output = std::env::var("TMT_LIVE_AGENTS_CAPTURE").expect("task-owned output path");
    let mut frames = Vec::new();
    for width in [160, 120, 100] {
        for layout in [
            crate::config::OpsLayout::Side,
            crate::config::OpsLayout::Stack,
        ] {
            for (base, depth) in [
                (Base::Tmt, Depth::TrueColor),
                (Base::TmtLight, Depth::TrueColor),
                (Base::Terminal, Depth::Ansi16),
                (Base::Tmt, Depth::None),
            ] {
                for squad in [false, true] {
                    let mut app = open(SavingsUnit::Tokens);
                    let view = app.view.as_mut().unwrap();
                    view.look = crate::look::Look {
                        theme: Theme::new(base),
                        depth,
                    };
                    let snapshot = &mut view.home.as_mut().unwrap().workspace;
                    snapshot.preferences.layout = layout;
                    snapshot.squad_looks.clear();
                    snapshot.roster.squads[0].idle_alert =
                        Some(crate::board::workspace::IdleAlertSetting {
                            enabled: true,
                            after_ms: 1_800_000,
                        });
                    let mut activity = [Some(0.0); 12];
                    activity[7] = Some(20.0);
                    activity[9] = Some(60.0);
                    activity[11] = Some(120.0);
                    app.agents_live.begin(&app, Instant::now());
                    app.agents_live.usage.get_mut().insert(
                        MEMBER.into(),
                        AgentsLiveUsage {
                            minute: Some(Reading {
                                tokens: 1_234,
                                partial: false,
                                span: 60_000,
                            }),
                            activity,
                        },
                    );
                    app.agents_live.squads.get_mut().clear();
                    if squad {
                        app.workspace.selected = Some(OpsTarget::Squad(ROOM.into()));
                        app.workspace_reconcile();
                    }
                    let buffer = frame(&app, width);
                    let lines: Vec<String> = buffer
                        .content
                        .chunks(usize::from(width))
                        .map(|row| row.iter().map(|cell| cell.symbol()).collect())
                        .collect();
                    frames.push(serde_json::json!({"width":width,"layout":format!("{layout:?}"),"look":format!("{base:?}/{depth:?}"),"selected":if squad {"squad"} else {"member"},"lines":lines,"hits":format!("{:?}",app.workspace_strip_hits.borrow())}));
                }
            }
        }
    }
    std::fs::write(output, serde_json::to_vec_pretty(&frames).unwrap()).unwrap();
}

#[test]
fn activity_distinguishes_unknown_observed_empty_and_partial_buckets() {
    use crate::board::agents_live::AgentsLiveUsage;
    let mut app = open(SavingsUnit::Tokens);
    let view = app.view.as_mut().unwrap();
    view.look.depth = tmt_cli_style::Depth::None;
    view.home.as_mut().unwrap().workspace.squad_looks.clear();
    let activity_text = |app: &App| {
        let buffer = frame(app, 240);
        let header = buffer
            .content
            .chunks(240)
            .find(|row| {
                row.iter()
                    .map(|c| c.symbol())
                    .collect::<String>()
                    .contains("ACTIVITY 1h")
            })
            .unwrap();
        let x = header
            .windows(11)
            .position(|cells| cells.iter().map(|c| c.symbol()).collect::<String>() == "ACTIVITY 1h")
            .unwrap();
        let row = buffer
            .content
            .chunks(240)
            .find(|row| {
                row.iter()
                    .map(|c| c.symbol())
                    .collect::<String>()
                    .contains("└ worker")
            })
            .unwrap();
        row[x..x + 12]
            .iter()
            .map(|c| c.symbol())
            .collect::<String>()
    };
    assert_eq!(activity_text(&app), "            ");
    app.agents_live.begin(&app, Instant::now());
    app.agents_live.usage.get_mut().insert(
        MEMBER.into(),
        AgentsLiveUsage {
            minute: None,
            activity: [Some(0.0); 12],
        },
    );
    assert_eq!(activity_text(&app), "············");
    let mut partial = [None; 12];
    partial[9] = Some(0.0);
    partial[11] = Some(120.0);
    app.agents_live
        .usage
        .get_mut()
        .get_mut(MEMBER)
        .unwrap()
        .activity = partial;
    assert_eq!(activity_text(&app), "         · █");
}
