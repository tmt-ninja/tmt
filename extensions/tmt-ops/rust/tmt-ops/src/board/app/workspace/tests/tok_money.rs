//! The TOK figures of the Agents list are a control: a click switches every figure between
//! tokens and the list price of the input tokens behind them. The choice is the one shared
//! unit preference the Digest estimates use, so it never needs a new acquisition.
use super::*;
use crate::{
    board::{
        app::{Choice, Request},
        digest_dashboard::tests::valued_board,
        usage_report::{
            Delivery, Report,
            model::{HourlySeries, Seat, Who},
        },
    },
    config::{SavingsUnit, TokRange},
};
use ratatui::{
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

fn figures(app: &App) -> Vec<Rect> {
    app.workspace_strip_hits
        .borrow()
        .iter()
        .filter_map(|(area, choice)| (*choice == Choice::TokMoney).then_some(*area))
        .collect()
}

fn click(app: &mut App, area: Rect) -> Effect {
    app.mouse(
        MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: area.x,
            row: area.y,
            modifiers: KeyModifiers::NONE,
        },
        Instant::now(),
    )
}

/// One complete day for `MEMBER` with one million priced input tokens (`$2.00` at the held quote).
fn report_for_member(app: &mut App) {
    let seat = Seat {
        who: Who {
            id: Some(MEMBER.into()),
            name: None,
            retired: false,
        },
        model_totals: None,
        window_series: None,
        complete_hour_inputs: None,
        model_inputs: Some(vec![("gpt-6-sol".into(), 1_000_000)]),
        input: 1_000_000,
        output: 100,
        cached: 0,
        covered_ms: 86_400_000,
        window_ms: 86_400_000,
        from_ms: 100_000_000,
        to_ms: 186_400_000,
        observed_at_ms: 186_400_000,
        starts_at_ms: Some(100_000_000),
        complete: true,
        series: HourlySeries::new(100_000_000, [0; 24], [true; 24]),
    };
    app.usage_report.apply(Delivery {
        since: TokRange::Day,
        result: Ok(Report {
            since: TokRange::Day,
            observed_at_ms: 186_400_000,
            window_from_ms: Some(100_000_000),
            seats: vec![seat],
            unavailable: vec![],
            exchange: None,
            warnings: vec![],
        }),
    });
}

fn lists() -> [&'static str; 1] {
    ["squads"]
}

#[test]
fn a_click_on_a_tok_figure_asks_for_the_other_unit_and_selects_nothing() {
    for name in lists() {
        for (held, wanted) in [
            (SavingsUnit::Tokens, SavingsUnit::Cost),
            (SavingsUnit::Percent, SavingsUnit::Cost),
            (SavingsUnit::Cost, SavingsUnit::Tokens),
        ] {
            let mut app = board();
            hold(&mut app, held);
            paint(&app, 160, 40);
            let area = *figures(&app)
                .first()
                .unwrap_or_else(|| panic!("{name}: no TOK figure hit"));
            let selected = app.workspace.selected.clone();
            let Effect::Act(Request::WorkspacePreferences { expected, next, .. }) =
                click(&mut app, area)
            else {
                panic!("{name} {held:?}: the figure must use the preferences writer");
            };
            assert_eq!(next.savings_unit, wanted, "{name} {held:?}");
            let mut rest = next.clone();
            rest.savings_unit = held;
            assert_eq!(rest, expected, "{name}: only the unit changes");
            assert_eq!(
                app.workspace.selected, selected,
                "{name}: a click selects nothing"
            );
        }
    }
}

#[test]
fn tokens_stay_the_default_and_the_heading_names_the_unit() {
    for name in lists() {
        let mut app = board();
        let tokens = paint(&app, 160, 40).join("\n");
        assert!(tokens.contains("TOK 1h"), "{name}: {tokens}");
        assert!(!tokens.contains("≈$"), "{name}: {tokens}");
        hold(&mut app, SavingsUnit::Cost);
        let money = paint(&app, 160, 40).join("\n");
        assert!(money.contains("≈$ 1h"), "{name}: {money}");
        assert!(!money.contains("TOK 1h"), "{name}: {money}");
    }
}

#[test]
fn money_is_the_list_price_of_the_input_tokens_or_a_dash_never_a_partial_sum() {
    let mut app = valued_board();

    hold(&mut app, SavingsUnit::Cost);
    // Until a complete report arrives the figure is unknown, not zero.
    let before = paint(&app, 160, 40).join("\n");
    assert!(!before.contains("≈$2"), "{before}");
    assert!(
        before
            .lines()
            .any(|line| line.contains("worker") && line.contains("working") && line.contains("—")),
        "{before}"
    );
    report_for_member(&mut app);
    let after = paint(&app, 160, 40).join("\n");
    assert!(after.contains("≈$2.00"), "{after}");
    // The same range word stays its own control after the money caption.
    let chip = app
        .workspace_strip_hits
        .borrow()
        .iter()
        .find_map(|(area, choice)| matches!(choice, Choice::TokRange(_)).then_some(*area))
        .unwrap();
    let line = &paint(&app, 160, 40)[usize::from(chip.y)];
    let word: String = line
        .chars()
        .skip(usize::from(chip.x))
        .take(usize::from(chip.width))
        .collect();
    assert_eq!(word, "1d", "{line}");
    // An incomplete report must not look like a price.
    if let crate::board::usage_report::View::Report(_) = app.usage_report.view_for(TokRange::Day) {
        let mut incomplete = app
            .usage_report
            .retained_report(TokRange::Day)
            .unwrap()
            .as_ref()
            .clone();
        incomplete.seats[0].complete = false;
        app.usage_report.apply(Delivery {
            since: TokRange::Day,
            result: Ok(incomplete),
        });
    }
    let partial = paint(&app, 160, 40).join("\n");
    assert!(!partial.contains("≈$2"), "{partial}");
}

#[test]
fn the_squads_tree_sums_the_members_money_the_same_way() {
    let mut app = valued_board();

    hold(&mut app, SavingsUnit::Cost);
    report_for_member(&mut app);
    let shown = paint(&app, 160, 40).join("\n");
    assert!(shown.contains("≈$ 1d"), "{shown}");
    assert!(
        shown
            .lines()
            .any(|line| line.contains("product") && line.contains("≈$2.00")),
        "the squad row carries its only member's price: {shown}"
    );
    assert!(!figures(&app).is_empty(), "a money figure stays a control");
}

#[test]
fn the_usage_report_is_wanted_on_the_agents_tab_only_while_money_is_shown() {
    let mut app = board();
    app.shell.tab = crate::board::shell::OpsTab::Agents;
    app.right_tab = crate::board::shell::RightTab::Talk;
    hold(&mut app, SavingsUnit::Tokens);
    assert!(app.usage_report_want().is_none());
    hold(&mut app, SavingsUnit::Cost);
    assert_eq!(
        app.usage_report_want().map(|want| want.since()),
        Some(app.tok_range())
    );
}

#[test]
fn partial_prices_use_only_complete_attributed_hours_and_keep_unknowns_unknown() {
    let mut app = valued_board();
    hold(&mut app, SavingsUnit::Cost);
    report_for_member(&mut app);
    assert_eq!(app.tok_money_text(&[MEMBER]), "≈$2.00");
    let mut report = app
        .usage_report
        .retained_report(TokRange::Day)
        .unwrap()
        .as_ref()
        .clone();
    report.seats[0].complete = false;
    report.seats[0].complete_hour_inputs = Some((vec![("gpt-6-sol".into(), 500_000)], 23));
    let show = |app: &mut App, report: &Report| {
        app.usage_report.apply(Delivery {
            since: TokRange::Day,
            result: Ok(report.clone()),
        });
        app.tok_money_text(&[MEMBER])
    };
    assert_eq!(show(&mut app, &report), "~$1.00");
    app.usage_report.apply(Delivery {
        since: TokRange::Day,
        result: Ok(report.clone()),
    });
    assert_eq!(app.tok_money_text(&[MEMBER, "missing"]), "~$1.00");
    let mut second = report.seats[0].clone();
    second.who.id = Some("zz-second".into());
    second.complete = true;
    second.complete_hour_inputs = None;
    report.seats.push(second);
    app.usage_report.apply(Delivery {
        since: TokRange::Day,
        result: Ok(report.clone()),
    });
    assert_eq!(app.tok_money_text(&[MEMBER, "zz-second"]), "~$3.00");
    report.seats.pop();
    let mut unpriced = report.seats[0].clone();
    unpriced.who.id = Some("zz-unpriced".into());
    unpriced.complete_hour_inputs = None;
    unpriced.model_inputs = Some(vec![("unpriced".into(), 100)]);
    report.seats.push(unpriced);
    app.usage_report.apply(Delivery {
        since: TokRange::Day,
        result: Ok(report.clone()),
    });
    assert_eq!(app.tok_money_text(&[MEMBER, "zz-unpriced"]), "—");
    report.seats.pop();
    report.seats[0].complete_hour_inputs = None;
    assert_eq!(show(&mut app, &report), "—");
    report.seats[0].complete_hour_inputs = Some((vec![("unpriced".into(), 500_000)], 23));
    report.seats[0].model_inputs = Some(vec![("unpriced".into(), 1_000_000)]);
    assert_eq!(show(&mut app, &report), "—");
}

#[test]
#[ignore = "read-only visual capture for #6083"]
fn capture_agents_cost_cells_at_160_columns() {
    let mut app = valued_board();

    hold(&mut app, SavingsUnit::Cost);
    report_for_member(&mut app);
    let original = app
        .usage_report
        .retained_report(TokRange::Day)
        .unwrap()
        .as_ref()
        .clone();
    for name in ["complete", "partial", "no-hour", "unpriced"] {
        let mut report = original.clone();
        if name != "complete" {
            report.seats[0].complete = false;
            report.seats[0].complete_hour_inputs = Some((vec![("gpt-6-sol".into(), 500_000)], 23));
        }
        if name == "no-hour" {
            report.seats[0].complete_hour_inputs = None;
        }
        if name == "unpriced" {
            report.seats[0].model_inputs = Some(vec![("unpriced".into(), 1_000_000)]);
        }
        app.usage_report.apply(Delivery {
            since: TokRange::Day,
            result: Ok(report),
        });
        println!("--- {name} ---\n{}", paint(&app, 160, 36).join("\n"));
    }
}

#[test]
fn cost_mode_keeps_minute_tokens_and_only_range_unit_is_clickable() {
    use crate::board::{agents_live::AgentsLiveUsage, rate::Reading};
    let mut app = valued_board();
    app.shell.tab = crate::board::shell::OpsTab::Agents;
    hold(&mut app, SavingsUnit::Cost);
    report_for_member(&mut app);
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
    let shown = paint(&app, 240, 40);
    let (y, heading) = shown
        .iter()
        .enumerate()
        .find(|(_, row)| row.contains("TOK/min") && row.contains("≈$ 1d"))
        .expect("cost range and token minute headings");
    let x = heading
        .chars()
        .collect::<Vec<_>>()
        .windows(7)
        .position(|chars| chars.iter().collect::<String>() == "TOK/min")
        .unwrap();
    let row = shown
        .iter()
        .find(|row| row.contains("└ worker") && row.contains("working"))
        .expect("member row");
    assert!(
        row.contains("1.2k") && row.contains("≈$2.00"),
        "minute tokens and range cost: {row}"
    );
    let hits = app.workspace_strip_hits.borrow();
    assert!(
        hits.iter().any(|(_, choice)| *choice == Choice::TokUnit),
        "range unit is clickable"
    );
    assert!(
        !hits.iter().any(|(area, choice)| *choice == Choice::TokUnit
            && area.y == y as u16
            && area.x <= x as u16
            && area.right() > x as u16),
        "minute heading has no unit hit"
    );
}
