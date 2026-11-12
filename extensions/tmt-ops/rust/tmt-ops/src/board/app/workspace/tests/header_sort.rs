//! The Agents column headers sort by click, show the shown order and light up
//! under the pointer. A click only changes the order: never the selection, the
//! saved preferences or anything sent.
use super::*;
use crate::{
    board::{app::Choice, header_sort::Header, shell::OpsTab},
    config::OpsSort,
};
use ratatui::{
    crossterm::event::{KeyModifiers, MouseButton, MouseEvent, MouseEventKind},
    layout::Rect,
};
use std::time::Instant;

fn open() -> App {
    let mut app = board();
    app.shell.tab = OpsTab::Agents;
    app
}

fn sorts(app: &App) -> Vec<(Rect, Header)> {
    app.workspace_strip_hits
        .borrow()
        .iter()
        .filter_map(|(area, choice)| match choice {
            Choice::SortBy(header) => Some((*area, *header)),
            _ => None,
        })
        .collect()
}

fn hit(app: &App, header: Header) -> Rect {
    sorts(app)
        .into_iter()
        .find_map(|(area, other)| (other == header).then_some(area))
        .unwrap_or_else(|| panic!("no hit for {header:?}"))
}

fn header_row(app: &App, header: Header) -> String {
    let rows = paint(app, 160, 40);
    rows[usize::from(hit(app, header).y)].clone()
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

fn click(app: &mut App, area: Rect) -> Effect {
    mouse(app, MouseEventKind::Down(MouseButton::Left), area)
}

fn press(app: &mut App, header: Header) -> Effect {
    let area = hit(app, header);
    click(app, area)
}

#[test]
fn a_squads_header_click_picks_name_or_attention_and_reverses() {
    let mut app = open();
    paint(&app, 160, 40);
    let selected = app.workspace.selected.clone();
    assert_eq!(
        sorts(&app).len(),
        2,
        "only SQUAD / AGENT and STATE have a squad order"
    );
    let name = Header::Squads(OpsSort::Name);
    let state = Header::Squads(OpsSort::Attention);
    // STATE first, so the first SQUAD / AGENT click is a change of order whatever the saved one is.
    press(&mut app, state);
    let order = app.workspace_order();
    assert_eq!((order.agents, order.reversed), (OpsSort::Attention, false));
    let row = header_row(&app, state);
    assert!(row.contains("STATE ↓") && !row.contains("AGENT ↑"), "{row}");
    press(&mut app, state);
    assert!(app.workspace_order().reversed);
    assert!(header_row(&app, state).contains("STATE ↑"));
    press(&mut app, name);
    let order = app.workspace_order();
    assert_eq!((order.agents, order.reversed), (OpsSort::Name, false));
    let row = header_row(&app, name);
    assert!(
        row.contains("SQUAD / AGENT ↑") && !row.contains("STATE ↑"),
        "{row}"
    );
    press(&mut app, name);
    assert!(app.workspace_order().reversed);
    assert!(header_row(&app, name).contains("SQUAD / AGENT ↓"));
    assert_eq!(app.workspace.selected, selected);
}
