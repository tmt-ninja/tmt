//! Digest summary facts, the tab-wide window and decoded scenes, using the existing held-data
//! fixture.
use super::*;
use crate::{
    board::app::{App, Choice, Effect},
    config::{DigestWindow, SavingsUnit, TokRange},
};

pub(in crate::board) const SCENES: &[&str] = &[
    "impact-complete",
    "impact-partial",
    "impact-unknown",
    "impact-stale",
    "impact-zero",
    "impact-mixed-prices",
    "impact-separate-coverage",
    "impact-week",
    "impact-basis",
    "impact-generic-labels",
    "digest-chart-day",
    "digest-chart-month",
    "digest-chart-gaps",
    "digest-inline-mode",
    "digest-populated-timer",
    "digest-zero-and-no-source",
    "digest-dollar-totals",
    "digest-all-readonly",
];

pub(in crate::board) fn capture_case(
    scene: &str,
    look: crate::look::Look,
) -> crate::board::app::App {
    let mut app = super::layout::fixture();
    // Oracle clocks use the same fixed zone as the neighboring Digest captures.
    app.local_zone = Some(jiff::tz::TimeZone::get("Asia/Tokyo").unwrap());
    let now = crate::status::now_ms();
    let mut doc = valued_document();
    doc["observedAtMs"] = serde_json::json!(now);
    doc["tick"] = serde_json::json!({"lastAtMs":now - 30_000});
    doc["global"] = serde_json::json!({"enabled":true,"default":"auto","text":"Digest: on (auto)"});
    let snapshot = app.view.as_mut().unwrap().home.as_mut().unwrap();
    snapshot.workspace.squad_looks.clear();
    let ids: Vec<_> = snapshot.workspace.roster.members.keys().cloned().collect();
    let template = doc["members"][0].clone();
    doc["members"] = ids
        .iter()
        .map(|id| {
            let mut member = template.clone();
            member["identityId"] = serde_json::json!(id);
            member
        })
        .collect();
    let window = if scene == "impact-week" {
        DigestWindow::Week
    } else {
        DigestWindow::Day
    };
    for (index, member) in doc["members"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .enumerate()
    {
        member["savings"]["window"] = serde_json::json!(window.argument());
        match scene {
            "impact-partial" if index > 0 => member["savings"] = serde_json::Value::Null,
            "impact-unknown" => member["savings"] = serde_json::Value::Null,
            "impact-zero" => {
                member["savings"]["estimatedInputTokensAvoided"] = serde_json::json!(0);
                member["savings"]["cost"]["usdMicros"] = serde_json::json!(0);
                member["savings"]["percent"]["basisPoints"] = serde_json::json!(0);
                member["savings"]["percent"]["estimatedInputTokensAvoided"] = serde_json::json!(0);
            }
            "impact-mixed-prices" if index > 0 => {
                member["savings"]["cost"]["pricingVersion"] = serde_json::json!("2026-10-15")
            }
            "impact-separate-coverage" if index > 0 => {
                member["savings"]["cost"] = serde_json::Value::Null
            }
            _ => {}
        }
    }
    app.digest_window = window;
    app.labels = crate::labels::Supplied::from_document("digest", &doc, scene == "impact-stale");
    if scene == "impact-generic-labels" {
        let choose = crate::labels::Choose::parse(
            "digest",
            &serde_json::json!({
                "kind":"choose", "argv":["digest", MEMBER, "{value}"], "current":"auto",
                "options":[{"label":"Auto", "value":"auto"}, {"label":"Off", "value":"off"}]
            }),
        )
        .unwrap();
        let labels = vec![
            crate::labels::Label {
                text: "Auto".into(),
                role: tmt_cli_style::Role::Text,
                action: Some(choose),
            },
            crate::labels::Label {
                text: "3 held".into(),
                role: tmt_cli_style::Role::Muted,
                action: None,
            },
            crate::labels::Label {
                text: "Latest in 4:58".into(),
                role: tmt_cli_style::Role::Muted,
                action: None,
            },
        ];
        app.labels = crate::labels::Supplied::from_rows(vec![(
            "digest".into(),
            std::collections::BTreeMap::from([(MEMBER.into(), labels)]),
        )]);
    }
    app.view.as_mut().unwrap().look = look;
    app.workspace_reconcile();
    if scene.starts_with("digest-") {
        install_chart(&mut app, scene, now);
    }
    app
}

/// Rich contract-shaped observations for the chart, selected panel and inline control matrix.
fn install_chart(app: &mut App, scene: &str, now: u64) {
    use crate::board::usage_report::{
        Delivery,
        model::{Point, WindowSeries},
    };
    let window = if scene == "digest-chart-month" {
        DigestWindow::Month
    } else {
        DigestWindow::Day
    };
    let bucket = if window == DigestWindow::Month {
        86_400_000
    } else {
        3_600_000
    };
    let count = if window == DigestWindow::Month {
        30
    } else {
        24
    };
    let from = now - window.range().milliseconds();
    let mut report = super::super::metrics::report(app).unwrap().clone();
    report.since = window.range();
    report.observed_at_ms = now;
    report.window_from_ms = Some(from);
    let mut doc = valued_document();
    doc["observedAtMs"] = serde_json::json!(now);
    let template = doc["members"][0].clone();
    doc["members"] = report.seats.iter_mut().enumerate().map(|(i, seat)| {
        seat.from_ms = from; seat.to_ms = now; seat.window_ms = window.range().milliseconds(); seat.covered_ms = seat.window_ms;
        let total = (count * (count + 1) / 2 * (i + 1) * 100) as u64;
        seat.input = total * 3 / 4; seat.output = total - seat.input;
        seat.complete = scene != "digest-chart-gaps";
        seat.window_series = Some(WindowSeries { from_ms:from, bucket_ms:bucket, points:(0..count).map(|n| Point { tokens:((n+1)*(i+1)*100) as u64, complete:scene != "digest-chart-gaps" || n != 2 }).collect() });
        seat.model_totals = Some(vec![("claude-opus-5-5".into(), seat.total()*3/4),("unattributed".into(), seat.total()-seat.total()*3/4)]);
        let mut member = template.clone(); member["identityId"] = serde_json::json!(seat.who.id);
        member["nextEligibleAtMs"] = serde_json::json!(now+90_000); member["lastDelivery"] = serde_json::json!({"settledAtMs":now-60_000,"messages":8,"batches":2});
        member["autoCaps"] = serde_json::json!({"maxWaitMs":300_000,"maxCount":5});
        member["savings"]["window"] = serde_json::json!(window.argument()); member["savings"]["fromMs"] = serde_json::json!(from); member["savings"]["throughMs"] = serde_json::json!(now);
        let saved = total / 5;
        member["savings"]["estimatedInputTokensAvoided"] = serde_json::json!(saved);
        member["savings"]["percent"] = serde_json::json!({"basisPoints":saved*10_000/(saved+seat.input),"estimatedInputTokensAvoided":saved,"observedInputTokens":seat.input,"fromMs":from,"throughMs":now});
        member["savings"]["cost"] = serde_json::Value::Null;
        member["savings"]["series"] = (0..count).map(|n| { let gap = scene == "digest-chart-gaps" && n == 3; serde_json::json!({"fromMs":from+n as u64*bucket,"toMs":from+(n+1) as u64*bucket,"estimatedInputTokensAvoided":if gap {None} else {Some(((n+1)*(i+1)*20) as u64)},"avoidedSeparateDeliveries":2,"complete":!gap,"gap":if gap {Some("uncollected_deliveries")} else {None}}) }).collect();
        member
    }).collect();
    if scene == "digest-zero-and-no-source" && report.seats.len() >= 2 {
        let missing = report.seats.remove(0);
        report
            .unavailable
            .push(crate::board::usage_report::model::Unavailable {
                who: missing.who,
                reason: "no usage source".into(),
            });
        let seat = &mut report.seats[0];
        seat.input = 0;
        seat.output = 0;
        if let Some(series) = seat.window_series.as_mut() {
            for point in &mut series.points {
                point.tokens = 0;
                point.complete = true;
            }
        }
    }
    app.digest_window = window;
    app.labels = crate::labels::Supplied::from_document("digest", &doc, false);
    app.usage_report.apply(Delivery {
        since: window.range(),
        result: Ok(report),
    });
    app.workspace_reconcile();
    select_worker(app);
    if scene == "digest-dollar-totals" {
        app.digest_cost = true;
    }
    if scene == "digest-all-readonly" {
        app.workspace.selected = Some(crate::board::workspace::OpsTarget::DigestAll);
    }
    if scene == "digest-populated-timer" {
        let mut job = crate::board::cronboard::test_view(
            "worker",
            "check status",
            Some(now as i64 + 2_460_000),
        );
        job.job.owner_id = Some(MEMBER.into());
        app.cron.replace(Ok(crate::board::cronboard::test_cron(
            vec![job],
            tmt_ops::cron::ClockStatus::NoClock,
        )));
    }
    if scene == "digest-inline-mode" {
        let choose = crate::labels::Choose::parse("digest", &serde_json::json!({"kind":"choose","argv":["digest",MEMBER,"{value}"],"current":"default","options":[{"label":"Use default","value":"default"},{"label":"Auto","value":"auto"},{"label":"Off","value":"off"}]})).unwrap();
        app.digest_inline = Some(crate::board::digest::Inline {
            target: app.workspace.selected.clone().unwrap(),
            granted: Some(crate::board::digest::Granted {
                ask: crate::board::digest::Ask {
                    squad: "product".into(),
                    member: "worker".into(),
                    choose,
                },
                actor: crate::management::ManagementActor {
                    id: "user".into(),
                    name: "User".into(),
                },
            }),
            field: 0,
            mode: 0,
            caps: Some((300_000, 5)),
            visible: Default::default(),
        });
    }
}

#[test]
fn digest_redesign_chart_join_preserves_gaps_clock_alignment_and_cache_identity() {
    let _no_commands = crate::runner::forbid_commands();
    let mut app = capture_case("digest-chart-gaps", crate::look::Look::default());
    let first = super::super::chart_buckets(&app);
    assert!(first[0].used.is_some() && first[0].saved.is_some());
    assert!(first[2].used.is_none());
    assert!(first[3].saved.is_none());
    select_worker(&mut app);
    assert!(std::rc::Rc::ptr_eq(
        &first,
        &super::super::chart_buckets(&app)
    ));
    let mut report = super::super::metrics::report(&app).unwrap().clone();
    report.seats[0].window_series.as_mut().unwrap().from_ms += 1;
    app.usage_report
        .apply(crate::board::usage_report::Delivery {
            since: TokRange::Day,
            result: Ok(report),
        });
    let shifted = super::super::chart_buckets(&app);
    assert!(!std::rc::Rc::ptr_eq(&first, &shifted));
    assert!(shifted.iter().all(|point| point.used.is_none()));
}

#[test]
fn digest_redesign_delivery_eligibility_is_a_countdown_and_null_delivery_is_hidden() {
    let _no_commands = crate::runner::forbid_commands();
    let mut app = capture_case("digest-chart-day", crate::look::Look::default());
    let now = app.labels.digest().unwrap().0.observed_at_ms;
    let panel = super::super::details::panel(&app, now, app.selected_row()).join("\n");
    assert!(panel.contains("next eligible in 1 min"), "{panel}");
    assert!(panel.contains("8 → 2"));
    assert!(panel.contains("unattributed"));
    app.labels = crate::labels::Supplied::from_document("digest", &valued_document(), false);
    let panel = super::super::details::panel(&app, now, app.selected_row()).join("\n");
    assert!(!panel.contains("last "));
}

/// The summary rows alone, as a `width`×`height` string per line.
fn summary_lines(app: &App, width: u16, height: u16) -> Vec<String> {
    let mut terminal =
        ratatui::Terminal::new(ratatui::backend::TestBackend::new(width, height)).unwrap();
    terminal
        .draw(|frame| super::super::summary::paint(frame, app, frame.area()))
        .unwrap();
    let buffer = terminal.backend().buffer();
    (0..height)
        .map(|y| (0..width).map(|x| buffer[(x, y)].symbol()).collect())
        .collect()
}

#[test]
fn both_totals_units_keep_independent_coverage_and_money_never_enters_the_chart() {
    let _no_commands = crate::runner::forbid_commands();
    for scene in SCENES.iter().filter(|scene| **scene != "impact-basis") {
        let mut app = capture_case(scene, crate::look::Look::default());
        let shown = paint(&mut app, 160, 50);
        for label in ["Range", "used TOK", "Saved ·", "Models", "Timers"] {
            assert!(shown.contains(label), "{scene}: {label}: {shown}");
        }
        let sum = super::super::savings(&app);
        if *scene == "impact-separate-coverage" {
            assert_eq!((sum.included, sum.cost.included), (7, 1));
        }
        if *scene == "impact-mixed-prices" {
            assert!(sum.cost.conflict);
        }
        app.digest_cost = true;
        let compact = summary_lines(&app, 160, 3);
        assert!(compact[1].contains("Window list-price equivalent"));
        assert!(compact[1].contains("not a bill"));
        let full = summary_lines(&app, 160, 8);
        assert!(full[1].contains("used TOK") && !full[1].contains("used $"));
    }
}

#[test]
fn the_window_is_the_tabs_own_view_state_and_leaves_the_agents_range_alone() {
    let _no_commands = crate::runner::forbid_commands();
    let mut app = capture_case("impact-complete", crate::look::Look::default());
    let selected = app.workspace.selected.clone();
    paint(&mut app, 160, 50);
    assert_eq!(app.choose(Choice::DigestWindowMenu), Effect::None);
    let menu = app.menu.as_ref().unwrap();
    assert_eq!(menu.title, "Digest window");
    assert_eq!(
        menu.entries
            .iter()
            .map(|entry| entry.choice.clone())
            .collect::<Vec<_>>(),
        DigestWindow::ALL.map(Choice::DigestWindow).to_vec()
    );
    app.menu = None;
    // No Config write: the window changes at once and the next demand reads its range.
    assert_eq!(
        app.choose(Choice::DigestWindow(DigestWindow::Week)),
        Effect::None
    );
    assert_eq!(app.digest_window(), DigestWindow::Week);
    assert_eq!(app.digest_range(), TokRange::Week);
    assert_eq!(
        app.usage_report_want().map(|want| want.range),
        Some(TokRange::Week)
    );
    assert!(paint(&mut app, 160, 50).contains("7d ▾"));
    assert_eq!(app.tok_range(), TokRange::Day);
    assert_eq!(app.savings_unit(), SavingsUnit::Tokens);
    assert_eq!(app.workspace.selected, selected);
    paint(&mut app, 100, 32);
    app.choose(Choice::DigestBasis);
    assert!(
        app.estimate_basis.is_some(),
        "Basis opens the Evidence modal"
    );
    assert_eq!(app.workspace.selected, selected);
    app.estimate_basis = None;
    app.context_menu();
    assert!(
        app.menu
            .as_ref()
            .unwrap()
            .entries
            .iter()
            .any(|entry| entry.choice == Choice::DigestBasis)
    );
}

fn impact_click(app: &App, choice: &Choice) -> ratatui::crossterm::event::MouseEvent {
    use ratatui::crossterm::event::{KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
    let area = app
        .workspace_strip_hits
        .borrow()
        .iter()
        .find_map(|(area, found)| (found == choice).then_some(*area))
        .expect("the control must have painted its own hit");
    MouseEvent {
        kind: MouseEventKind::Down(MouseButton::Left),
        column: area.x,
        row: area.y,
        modifiers: KeyModifiers::NONE,
    }
}

#[test]
fn painted_impact_controls_activate_through_the_digest_mouse_route() {
    let _no_commands = crate::runner::forbid_commands();
    for width in [80, 160] {
        for choice in [Choice::DigestWindowMenu, Choice::DigestBasis] {
            let mut app = capture_case("impact-complete", crate::look::Look::default());
            let selected = app.workspace.selected.clone();
            paint(&mut app, width, 32);
            let click = impact_click(&app, &choice);
            assert_eq!(app.mouse(click, std::time::Instant::now()), Effect::None);
            match choice {
                Choice::DigestWindowMenu => assert_eq!(
                    app.menu.as_ref().map(|menu| menu.title.as_str()),
                    Some("Digest window"),
                    "the painted window chip must open its menu on Digest"
                ),
                Choice::DigestBasis => assert!(
                    app.estimate_basis.is_some(),
                    "the painted Basis button must open its evidence"
                ),
                _ => unreachable!(),
            }
            assert_eq!(app.workspace.selected, selected);
            assert_eq!(app.digest_window(), DigestWindow::Day);
            assert_eq!(app.tok_range(), TokRange::Day);
        }
    }
}

#[test]
fn painted_impact_controls_keep_search_loading_overlay_and_geometry_fences() {
    let _no_commands = crate::runner::forbid_commands();
    for choice in [Choice::DigestWindowMenu, Choice::DigestBasis] {
        for fence in ["search", "loading", "overlay", "invalidated", "tab-change"] {
            let mut app = capture_case("impact-complete", crate::look::Look::default());
            paint(&mut app, 160, 32);
            let click = impact_click(&app, &choice);
            match fence {
                "search" => app.searching = true,
                "loading" => app.current = Some("another-squad".into()),
                "overlay" => app.help = true,
                "invalidated" => app.invalidate_frame_geometry(),
                "tab-change" => {
                    press(&mut app, '1');
                }
                _ => unreachable!(),
            }
            app.mouse(click, std::time::Instant::now());
            assert!(app.menu.is_none(), "{fence}: no window menu");
            assert!(app.estimate_basis.is_none(), "{fence}: no basis modal");
        }
    }
}

#[test]
fn basis_opens_the_evidence_modal_and_leaves_hidden_details_hidden() {
    use crate::config::{DigestPanels, PanelSetting};
    let _no_commands = crate::runner::forbid_commands();
    let mut app = capture_case("impact-complete", crate::look::Look::default());
    let mut panels = DigestPanels::default();
    panels.set_side_shown(false).unwrap();
    app.view
        .as_mut()
        .unwrap()
        .home
        .as_mut()
        .unwrap()
        .workspace
        .preferences
        .digest_panels = Some(PanelSetting::configured(panels));
    paint(&mut app, 100, 32);
    assert_eq!(app.choose(Choice::DigestBasis), Effect::None, "no write");
    assert!(app.estimate_basis.is_some());
    assert!(!app.digest_panels().side_shown());
    let shown = paint(&mut app, 100, 32);
    assert!(shown.contains("Estimate basis · Evidence"), "{shown}");
    assert!(shown.contains("Method: saved"), "{shown}");
}

#[test]
fn the_single_panel_has_amounts_once_and_provenance_stays_in_estimate_basis() {
    use super::super::details;
    let mut app = valued_board();
    press(&mut app, '2');
    select_worker(&mut app);
    let row = app.selected_row();
    let panel = details::panel(&app, 121_000, row).join("\n");
    let evidence = details::evidence(&app, 121_000, row).join("\n");
    for amount in ["18.2k", "18%"] {
        assert_eq!(panel.matches(amount).count(), 1, "{panel}");
        assert!(!evidence.contains(amount));
    }
    for fact in [
        "$2.00 per 1M",
        "price table 2026-10-14",
        "under 1 s",
        "1–2 min",
        details::METHOD,
    ] {
        assert!(evidence.contains(fact), "{evidence}");
        assert!(!panel.contains(fact));
    }
    assert!(panel.contains("inherited from workspace"));
}

#[test]
fn impact_capture_pins_the_clock_zone() {
    let app = capture_case("impact-complete", crate::look::Look::default());
    assert_eq!(
        app.local_zone
            .as_ref()
            .and_then(jiff::tz::TimeZone::iana_name),
        Some("Asia/Tokyo")
    );
}

#[test]
fn money_never_skips_an_unfit_context_field() {
    let _no_commands = crate::runner::forbid_commands();
    let mut app = capture_case("impact-complete", crate::look::Look::default());
    let mut document = valued_document();
    let template = document["members"][0].clone();
    document["members"] = app
        .view
        .as_ref()
        .unwrap()
        .home
        .as_ref()
        .unwrap()
        .workspace
        .roster
        .members
        .keys()
        .map(|id| {
            let mut member = template.clone();
            member["identityId"] = serde_json::json!(id);
            member["savings"]["estimatedInputTokensAvoided"] =
                serde_json::json!(1_000_000_000_000_000u64);
            member["savings"]["cost"]["usdMicros"] = serde_json::json!(0);
            member["savings"]["cost"]["usdMicrosPerMillionInputTokens"] = serde_json::json!(0);
            member["savings"]["percent"] = serde_json::Value::Null;
            member
        })
        .collect();
    app.labels = crate::labels::Supplied::from_document("digest", &document, false);
    for width in 40..=120 {
        let line = &summary_lines(&app, width, 3)[1];
        assert!(
            !line.contains("≈ list price saved") || line.contains("Saved "),
            "money must follow context at width {width}: {line}"
        );
    }
}

#[test]
fn chart_axis_stays_inside_the_plot_and_shows_the_selected_window() {
    let _no_commands = crate::runner::forbid_commands();
    let mut app = capture_case("digest-chart-day", crate::look::Look::default());
    for (window, start, middle) in [
        (DigestWindow::Day, "−24h", "−12h"),
        (DigestWindow::Week, "−7d", "−3.5d"),
        (DigestWindow::Month, "−30d", "−15d"),
    ] {
        app.digest_window = window;
        for width in [100, 120, 160] {
            let rows = summary_lines(&app, width, 8);
            let axis = &rows[4];
            assert!(
                axis.contains(start) && axis.contains(middle) && axis.contains("now"),
                "{window:?} {width}: {axis}"
            );
            if width >= 120 {
                assert!(
                    axis.chars().skip((width - 40) as usize).all(|c| c == ' '),
                    "{axis}"
                );
            }
        }
    }
}

#[test]
fn review_scenes_prove_unavailable_zero_timer_and_all_scope() {
    let _no_commands = crate::runner::forbid_commands();
    for (scene, expected) in [
        ("digest-zero-and-no-source", "no usage source"),
        ("digest-populated-timer", "check status"),
        ("digest-all-readonly", "Details · all"),
        ("digest-dollar-totals", "$ window totals; chart stays TOK"),
    ] {
        let mut app = capture_case(scene, crate::look::Look::default());
        let shown = paint(&mut app, 160, 50);
        assert!(shown.contains(expected), "{scene}: {expected}: {shown}");
    }
}
