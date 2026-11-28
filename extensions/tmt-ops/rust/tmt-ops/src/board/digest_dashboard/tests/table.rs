//! Agents by TOK: saved columns, their unit switch, the width order and the shared sum.
use super::super::table::{Field, narrow_hint, tracks};
use super::{MEMBER, paint, press, valued_board, valued_document};
use crate::{
    board::app::App,
    config::{DigestWindow, SavingsUnit},
};
use std::rc::Rc;

fn fields(width: u16, unit: SavingsUnit) -> Vec<Field> {
    tracks(width, unit)
        .into_iter()
        .map(|(field, _)| field)
        .collect()
}

#[test]
fn fixed_token_columns_fit_whole_and_do_not_change_with_the_totals_unit() {
    use Field::*;
    for width in [60, 75, 76, 80, 100, 112, 120, 160] {
        let shown = fields(width, SavingsUnit::Tokens);
        assert!(shown.contains(&Tokens) && shown.contains(&Saved) && shown.contains(&Percent));
        assert_eq!(shown, fields(width, SavingsUnit::Cost));
        let total = tracks(width, SavingsUnit::Tokens)
            .iter()
            .map(|(_, w)| w + 1)
            .sum::<u16>()
            - 1;
        assert!(total <= width);
    }
    assert_eq!(
        fields(160, SavingsUnit::Tokens),
        vec![Agent, State, Activity, Tokens, Saved, Percent, Held, Mode]
    );
}

#[test]
fn the_narrow_hint_names_only_columns_which_are_not_painted() {
    for width in [60, 80, 100, 120, 160] {
        let shown = fields(width, SavingsUnit::Tokens);
        let hint = narrow_hint(width, SavingsUnit::Tokens, usize::MAX);
        assert_eq!(
            hint.is_some(),
            !shown.contains(&Field::Activity) || !shown.contains(&Field::Mode)
        );
        if let Some(hint) = hint {
            assert!(!hint.contains("price") && !hint.contains("recipients"));
        }
    }
}

/// Each painted row as its cells, so a column reads from its heading's position.
fn grid(app: &mut App, width: u16, height: u16) -> Vec<Vec<String>> {
    use ratatui::{Terminal, backend::TestBackend};
    let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
    terminal
        .draw(|frame| {
            crate::board::view::prepare(app, frame.area());
            crate::board::view::render(frame, app);
        })
        .unwrap();
    let buffer = terminal.backend().buffer();
    (0..height)
        .map(|y| {
            (0..width)
                .map(|x| buffer[(x, y)].symbol().to_owned())
                .collect()
        })
        .collect()
}

fn text(row: &[String], from: usize, width: usize) -> String {
    row[from..(from + width).min(row.len())]
        .concat()
        .trim()
        .to_owned()
}

/// The value under `heading` on the row whose AGENT cell starts with `agent`.
fn cell(grid: &[Vec<String>], heading: &str, agent: &str) -> Option<String> {
    let width = heading.chars().count();
    let (header, column) = grid
        .iter()
        .enumerate()
        .filter(|(_, row)| row.concat().contains("AGENT"))
        .find_map(|(y, row)| {
            (0..row.len().saturating_sub(width))
                .find(|&x| row[x..x + width].concat() == heading)
                .map(|x| (y, x))
        })?;
    let agent_column = (0..grid[header].len())
        .find(|&x| grid[header][x..].concat().starts_with("AGENT"))
        .unwrap();
    grid[header + 1..]
        .iter()
        .find(|row| text(row, agent_column, 12).starts_with(agent))
        .map(|row| text(row, column, width.max(7)))
}

fn digest(app: &mut App) -> Vec<Vec<String>> {
    press(app, '2');
    grid(app, 160, 36)
}

#[test]
fn saved_cells_show_the_supplied_estimate_in_the_shared_unit_and_at_list_price() {
    let _no_commands = crate::runner::forbid_commands();
    let mut app = valued_board();
    let shown = digest(&mut app);
    for agent in ["worker", "all"] {
        assert_eq!(
            cell(&shown, "SAVED", agent).as_deref(),
            Some("18.2k"),
            "{agent}"
        );
        assert_eq!(
            cell(&shown, "SAVED %", agent).as_deref(),
            Some("18%"),
            "{agent}"
        );
        assert!(cell(&shown, "≈ $ USED", agent).is_none(), "{agent}");
    }
    assert!(cell(&shown, "≈ $ in", "worker").is_none());
}

/// Seven agents of which only `MEMBER` has an estimate.
fn crowd(document: serde_json::Value) -> App {
    let mut app = super::layout::fixture();
    app.labels = crate::labels::Supplied::from_document("digest", &document, false);
    app
}

#[test]
fn a_sum_that_leaves_agents_out_is_a_lower_bound_and_unknown_never_reads_zero() {
    let _no_commands = crate::runner::forbid_commands();
    let mut app = crowd(valued_document());
    let shown = grid(&mut app, 160, 40);
    assert_eq!(cell(&shown, "SAVED", "all").as_deref(), Some("≥18.2k"));
    assert_eq!(cell(&shown, "SAVED", "agent-1").as_deref(), Some("—"));
    assert_eq!(cell(&shown, "SAVED %", "all").as_deref(), Some("18%"));
    assert!(
        shown
            .concat()
            .concat()
            .contains("SAVED % covers 1 of 7 agents")
    );
    assert_eq!(sum(&app).cost.value, Some(12_398_600));
    let mut zero = valued_document();
    zero["members"][0]["savings"]["estimatedInputTokensAvoided"] = serde_json::json!(0);
    zero["members"][0]["savings"]["cost"]["usdMicros"] = serde_json::json!(0);
    let mut app = valued_board();
    app.labels = crate::labels::Supplied::from_document("digest", &zero, false);
    let shown = digest(&mut app);
    assert_eq!(cell(&shown, "SAVED", "worker").as_deref(), Some("0"));
    assert_eq!(sum(&app).cost.value, Some(0));
    for labels in [
        crate::labels::Supplied::from_document("digest", &valued_document(), true),
        Default::default(),
    ] {
        let mut app = valued_board();
        app.labels = labels;
        let shown = digest(&mut app);
        for agent in ["all", "worker"] {
            assert_eq!(cell(&shown, "SAVED", agent).as_deref(), Some("—"));
            assert_eq!(cell(&shown, "SAVED %", agent).as_deref(), Some("—"));
        }
    }
}

#[test]
fn quotes_under_different_price_tables_never_combine() {
    let _no_commands = crate::runner::forbid_commands();
    let mut document = valued_document();
    let mut other = document["members"][0].clone();
    other["identityId"] = serde_json::json!("40000000-0000-4000-8000-000000000001");
    other["savings"]["cost"]["pricingVersion"] = serde_json::json!("2026-10-01");
    other["savings"]["percent"]["fromMs"] = serde_json::json!(0);
    document["members"].as_array_mut().unwrap().push(other);
    let mut app = crowd(document);
    let shown = grid(&mut app, 160, 40);
    let all = sum(&app);
    assert!(all.cost.conflict && all.cost.value.is_none());
    assert!(all.percent.conflict && all.percent.value.is_none());
    assert_eq!(cell(&shown, "SAVED", "all").as_deref(), Some("≥36.4k"));
}

#[test]
fn the_totals_switch_is_local_and_never_changes_list_units_or_writes_config() {
    let _no_commands = crate::runner::forbid_commands();
    let mut app = valued_board();
    let before = digest(&mut app);
    let preferences = app.workspace_snapshot().unwrap().preferences.clone();
    assert_eq!(
        app.perform(&crate::action::Action::parse("savings-unit").unwrap()),
        crate::board::app::Effect::None
    );
    let after = grid(&mut app, 160, 36);
    assert!(app.digest_cost);
    assert_eq!(app.workspace_snapshot().unwrap().preferences, preferences);
    for heading in ["SAVED", "SAVED %", "TOK"] {
        assert_eq!(
            cell(&before, heading, "worker"),
            cell(&after, heading, "worker")
        );
    }
    assert!(after.concat().concat().contains("≈ $ saved"));
    app.perform(&crate::action::Action::parse("savings-unit").unwrap());
    assert!(!app.digest_cost);
}

fn sum(app: &App) -> Rc<crate::labels::digest::SavingsSummary> {
    super::super::savings(app)
}

#[test]
fn the_summary_and_the_all_row_share_one_sum_until_its_status_or_window_changes() {
    let _no_commands = crate::runner::forbid_commands();
    let mut app = crowd(valued_document());
    paint(&mut app, 160, 40);
    let first = sum(&app);
    assert_eq!(first.tokens, Some(18_200));
    paint(&mut app, 160, 40);
    assert!(
        Rc::ptr_eq(&first, &sum(&app)),
        "a frame reuses the held sum"
    );

    // A member's Details read its own estimate and leave the shared sum in place.
    let index = app
        .workspace_rows()
        .iter()
        .position(|row| super::super::metrics::id(row) == Some(MEMBER))
        .unwrap();
    app.workspace.selected = Some(app.workspace_rows()[index].target.clone());
    paint(&mut app, 160, 40);
    assert!(Rc::ptr_eq(&first, &sum(&app)));

    app.digest_window = DigestWindow::Week;
    paint(&mut app, 160, 40);
    let week = sum(&app);
    assert!(!Rc::ptr_eq(&first, &week), "a window change sums again");
    assert_eq!(week.tokens, None, "the supplier read the day window");

    app.digest_window = DigestWindow::Day;
    app.labels = crate::labels::Supplied::from_document("digest", &valued_document(), false);
    paint(&mut app, 160, 40);
    let read = sum(&app);
    assert!(!Rc::ptr_eq(&first, &read), "a new read sums again");
    assert_eq!(*read, *first);
}

#[test]
fn digest_redesign_list_has_window_saved_percent_without_used_price() {
    let _no_commands = crate::runner::forbid_commands();
    let mut app = valued_board();
    let shown = digest(&mut app).concat().concat();
    assert!(
        shown.contains("SAVED %"),
        "range percentage is an independent column"
    );
    assert!(
        !shown.contains("≈ $ USED"),
        "uncomputable used-price column is removed"
    );
}
