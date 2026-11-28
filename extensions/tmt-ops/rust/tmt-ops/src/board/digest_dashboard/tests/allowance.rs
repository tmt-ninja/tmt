//! The allowance tile of the Digest summary: one row per provider with what is left, the
//! worst projection and the reset, scrolling inside the tile. Fixed clock, UTC, no I/O.
use super::*;
use crate::board::{
    app::App,
    limits::{Provider, Rates, Reading, Standing, Window},
    overview::cron_counts::GlyphSet,
    shell::OpsTab,
};
use ratatui::{Terminal, backend::TestBackend, buffer::Buffer};

const NOW: u64 = 1_791_600_000_000; // Sat 2026-10-10 02:40 UTC
const HOUR: u64 = 3_600_000;

fn standing(
    provider: &str,
    left: f64,
    resets_in_hours: u64,
    observed_ago_ms: u64,
    rates: Rates,
) -> Standing {
    Standing {
        current: None,
        provider: Provider::named(provider),
        latest: Some(Reading {
            observed_at_ms: NOW - observed_ago_ms,
            weekly: Window {
                left,
                resets_at_ms: NOW + resets_in_hours * HOUR,
            },
            short: None,
        }),
        burn: None,
        trend: None,
        rates,
    }
}

fn digest(limits: Vec<Standing>) -> App {
    let mut app = quota_board();
    app.shell.tab = OpsTab::Digest;
    app.local_zone = Some(jiff::tz::TimeZone::UTC);
    app.limits = Some(limits);
    app
}

fn claude() -> Standing {
    // 26 % left, 40 h to the reset (Sun 18:40): 1.0 pt/h empties at Sun 04:40,
    // 0.5 leaves 6 %, 0.2 leaves 18 %, and no burn since the reset leaves 26 %.
    standing(
        "claude",
        26.0,
        40,
        10 * 60_000,
        Rates::measured(Some(1.0), Some(0.5), Some(0.2), Some(0.0)),
    )
}

fn buffer(app: &mut App, width: u16, height: u16) -> Buffer {
    let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
    crate::status::with_now_ms(NOW, || {
        terminal
            .draw(|frame| {
                crate::board::view::prepare(app, frame.area());
                crate::board::view::render(frame, app);
            })
            .unwrap();
    });
    terminal.backend().buffer().clone()
}

fn rows(buffer: &Buffer) -> Vec<String> {
    let width = usize::from(buffer.area.width);
    buffer
        .content
        .chunks(width)
        .map(|row| row.iter().map(|cell| cell.symbol()).collect())
        .collect()
}

fn words(row: &str) -> Vec<&str> {
    row.split_whitespace().collect()
}

/// The tile's words on the row whose provider is `source`: what follows the tile's rule.
fn row_of(rows: &[String], source: &str) -> Vec<String> {
    rows.iter()
        .filter_map(|row| row.split_once("Allowance ").map(|(_, row)| row))
        .filter_map(|row| row.find(source).map(|start| &row[start..]))
        .map(words)
        .next()
        .map(|row| {
            row.into_iter()
                .filter(|word| *word != "·")
                .take_while(|word| {
                    *word == source
                        || !matches!(*word, "Claude" | "Openai" | "Muse" | "Codex" | "saved")
                })
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_else(|| panic!("no {source} in {}", rows.join("\n")))
}

#[test]
fn a_row_shows_left_the_worst_projection_and_the_reset() {
    let mut app = digest(vec![claude()]);
    let view = app.view.as_mut().unwrap();
    view.look = crate::look::Look::default();
    view.home.as_mut().unwrap().workspace.squad_looks.clear();
    let frame = buffer(&mut app, 240, 40);
    let rows = rows(&frame);
    assert!(
        rows.iter().any(|row| row.contains("Allowance Claude")),
        "{}",
        rows.join("\n")
    );
    // 1.0 pt/h over the last 3 h empties it first, at Su 04:40; it resets Su 18:40.
    assert_eq!(
        row_of(&rows, "Claude"),
        ["Claude", "26%", "✗", "runs", "out", "Su", "04:40"]
    );
    assert!(
        !rows.iter().any(|row| row.contains("NEED")),
        "no NEED column"
    );
    let (y, row) = rows
        .iter()
        .enumerate()
        .find(|(_, row)| row.contains("Allowance Claude"))
        .unwrap();
    let x = row.find("26%").unwrap();
    assert!(
        frame[(x as u16, y as u16)]
            .modifier
            .contains(ratatui::style::Modifier::BOLD)
    );
    // The spaces around the separator inherit the board foreground.
    for column in [x + 3, x + 5] {
        let separator = &frame[(column as u16, y as u16)];
        assert_eq!(separator.fg, ratatui::style::Color::Reset);
        assert!(!separator.modifier.contains(ratatui::style::Modifier::BOLD));
    }
    assert_eq!(
        frame[(239, y as u16)].fg,
        app.look().role(tmt_cli_style::Role::Muted).fg.unwrap()
    );
}

#[test]
fn only_a_window_that_runs_out_takes_the_attention_colour() {
    let steady = standing(
        "openai",
        55.0,
        100,
        60_000,
        Rates::measured(Some(0.3), Some(0.3), None, Some(0.3)),
    );
    let mut app = digest(vec![claude(), steady]);
    let view = app.view.as_mut().unwrap();
    view.look = crate::look::Look::default();
    view.home.as_mut().unwrap().workspace.squad_looks.clear();
    let buffer = buffer(&mut app, 240, 40);
    let rows = rows(&buffer);
    let waiting = app
        .look()
        .role(tmt_cli_style::Role::Waiting)
        .fg
        .expect("the pinned colour assertion needs an attention foreground");
    let coloured = |source: &str| {
        let y = rows
            .iter()
            .position(|row| row.contains("Allowance ") && row.contains(source))
            .unwrap();
        {
            let row = &rows[y];
            let start = row.find(source).unwrap() as u16;
            let end = row[usize::from(start)..]
                .find("  resets")
                .map_or(buffer.area.width, |end| start + end as u16);
            start..end
        }
        .map(|x| &buffer[(x, y as u16)])
        .filter(|cell| cell.fg == waiting && cell.symbol() != " ")
        .map(|cell| cell.symbol())
        .collect::<String>()
    };
    assert_eq!(coloured("Claude"), "✗runsoutSu04:40", "{rows:?}");
    assert_eq!(row_of(&rows, "Openai")[2..5], ["lasts", "past", "reset"]);
    assert_eq!(coloured("Openai"), "", "{rows:?}");
}

#[test]
fn a_stale_reading_is_not_quoted_and_an_unsampled_provider_has_no_row() {
    let stale = standing("muse", 81.0, 100, 3 * HOUR, Rates::default());
    let unsampled = Standing {
        current: None,
        provider: Provider::named("codex"),
        latest: None,
        burn: None,
        trend: None,
        rates: Rates::default(),
    };
    let fresh_without_rates = standing("openai", 55.0, 100, 60_000, Rates::default());
    let mut app = digest(vec![claude(), stale, unsampled, fresh_without_rates]);
    let rows = rows(&buffer(&mut app, 240, 40));
    assert_eq!(
        row_of(&rows, "Muse"),
        ["Muse", "—", "no", "recent", "reading"]
    );
    assert_eq!(
        row_of(&rows, "Openai"),
        ["Openai", "55%", "—", "resets", "We", "06:40"]
    );
    assert!(
        rows.iter().any(|row| row.contains("Allowance Claude")),
        "a provider never sampled has no row: {rows:?}"
    );
}

#[test]
fn providers_share_one_line_and_the_wheel_can_reveal_the_last_provider() {
    let providers = ["claude", "codex", "gemini", "muse", "openai"]
        .map(|name| standing(name, 50.0, 100, 60_000, Rates::default()));
    let mut app = digest(providers.to_vec());
    let shown = rows(&buffer(&mut app, 120, 40));
    let y = shown
        .iter()
        .position(|row| row.starts_with("Allowance "))
        .unwrap();
    assert_eq!(
        shown
            .iter()
            .filter(|row| row.starts_with("Allowance "))
            .count(),
        1
    );
    row_of(&shown, "Claude");
    let inside = ratatui::layout::Position::new(1, y as u16);
    for _ in 0..5 {
        assert!(app.digest_allowance.wheel(inside, true));
    }
    let scrolled = rows(&buffer(&mut app, 120, 40));
    row_of(&scrolled, "Openai");
    assert!(!scrolled[y].contains("Claude"));
    assert!(
        !app.digest_allowance
            .wheel(ratatui::layout::Position::new(0, 0), false)
    );
}

#[test]
fn an_ascii_terminal_gets_an_ascii_marker_and_rule() {
    let mut app = digest(vec![claude()]);
    app.cron_glyphs = GlyphSet::Ascii;
    let rows = rows(&buffer(&mut app, 240, 40));
    assert_eq!(
        row_of(&rows, "Claude")[2..7],
        ["x", "runs", "out", "Su", "04:40"]
    );
}

#[test]
fn no_reading_or_no_height_shows_no_allowance() {
    for (limits, height) in [(Vec::new(), 40), (vec![claude()], 12)] {
        let mut app = digest(limits);
        let rows = rows(&buffer(&mut app, 120, height));
        assert!(
            !rows.iter().any(|row| row.contains("ALLOWANCE")),
            "{height}: {}",
            rows.join("\n")
        );
    }
}

#[test]
fn a_narrow_frame_keeps_allowance_to_one_line_under_the_window_totals() {
    for width in [60, 80, 120] {
        let mut app = digest(vec![claude()]);
        let rows = rows(&buffer(&mut app, width, 40));
        let at = rows
            .iter()
            .position(|row| row.starts_with("Allowance "))
            .unwrap();
        if width < 120 {
            assert!(rows[at - 1].starts_with("TOK "));
        } else {
            assert!(rows.iter().any(|row| row.contains("≈ $ saved")));
        }
        assert!(rows[at].contains("Claude") && rows[at].contains("26%"));
        assert!(!rows[at].contains("r…"), "reset label must not be cut");
    }
}

/// A claude window at 20 % left, 40 h to the reset, that lost 0.5 points an hour over the last
/// day (12 points), with one member "a" on claude spending `cells` tokens an hour-cell.
fn claude_with_tokens(cells: [u64; 24], complete: [bool; 24], ends_ago_ms: u64) -> App {
    let mut app = digest(vec![standing(
        "claude",
        20.0,
        40,
        10 * 60_000,
        Rates::measured(Some(0.5), Some(0.5), Some(0.5), Some(0.5)),
    )]);
    crate::board::app::workspace::tests::install_hourly_tokens(
        &mut app,
        NOW,
        ends_ago_ms,
        complete,
        &[("a", "claude", cells)],
    );
    app
}

fn claude_row(app: &mut App) -> Vec<String> {
    row_of(&rows(&buffer(app, 120, 40)), "Claude")
}

/// The claude row above (20 % left, 40 h to the reset, 0.5 points an hour on every sampled line,
/// so each empties it at Su 18:40) when the worst projection runs out at `at`.
fn row_running_out(at: &str) -> Vec<String> {
    let (day, time) = at.split_once(' ').unwrap();
    ["Claude", "20%", "✗", "runs", "out", day, time]
        .map(str::to_owned)
        .to_vec()
}

#[test]
fn the_tokens_line_projects_the_last_three_hours_at_the_cost_of_the_last_day() {
    // 12 points (0.5 an hour for 24 h) over 27 000 tokens, of which 6 000 in the last three
    // cells: 2 000 tokens an hour at 12 / 27 000 points a token is 0.89 points an hour, which
    // empties the 20 % in 22.5 h, at Su 01:10.
    let mut cells = [1_000u64; 24];
    cells[21..].copy_from_slice(&[1_000, 2_000, 3_000]);
    let mut app = claude_with_tokens(cells, [true; 24], 0);
    assert_eq!(claude_row(&mut app), row_running_out("Su 01:10"));
}

#[test]
fn the_tokens_line_is_unknown_without_a_usable_report_or_complete_cells() {
    // No report yet.
    let mut app = digest(vec![standing(
        "claude",
        20.0,
        40,
        10 * 60_000,
        Rates::measured(Some(0.5), Some(0.5), Some(0.5), Some(0.5)),
    )]);
    assert_eq!(claude_row(&mut app), row_running_out("Su 18:40"));
    let mut incomplete = [true; 24];
    incomplete[5] = false;
    for (label, complete, ends_ago) in [
        ("an incomplete cell", incomplete, 0),
        ("a stale series", [true; 24], 3 * HOUR),
    ] {
        let mut app = claude_with_tokens([1_000; 24], complete, ends_ago);
        assert_eq!(claude_row(&mut app), row_running_out("Su 18:40"), "{label}");
    }
}

#[test]
fn direction_a_narrow_allowance_never_clips_resets_mid_word() {
    crate::status::with_now_ms(NOW, || {
        for (name, look) in crate::board::home::tests::oracle::looks() {
            let mut app = super::impact::capture_case("digest-spec", look);
            let screen = rows(&buffer(&mut app, 100, 36));
            let row = screen
                .iter()
                .find(|row| row.starts_with("Allowance "))
                .unwrap();
            let codex = row.split_once("Codex").unwrap().1.trim_end();
            assert!(
                codex.ends_with('…') || codex.contains("runs out"),
                "{name}: {row}"
            );
            assert!(!codex.ends_with("r…"), "{name}: partial reset label: {row}");
        }
    });
}

#[test]
fn direction_a_allowance_has_at_most_one_ellipsis_at_each_width() {
    for (name, look) in crate::board::home::tests::oracle::looks() {
        for width in [160, 100, 80] {
            let mut app =
                crate::board::app::workspace::tests::capture_case("digest-allowance", look);
            app.view.as_mut().unwrap().look = look;
            app.view
                .as_mut()
                .unwrap()
                .home
                .as_mut()
                .unwrap()
                .workspace
                .squad_looks
                .clear();
            let screen = rows(&buffer(&mut app, width, 36));
            let row = screen
                .iter()
                .find(|row| row.starts_with("Allowance "))
                .unwrap();
            assert!(!row.contains("……"), "{name} {width}: {row}");
        }
    }
}

pub(in crate::board) fn budget_fixture(look: crate::look::Look) -> App {
    use crate::{
        board::{
            limits::budget_period,
            usage_report::budgets::{Delivery, SpendReport},
        },
        config::{AllowanceBudget, BudgetPeriod},
    };
    let mut app = super::impact::spec_fixture(look);
    let zone = jiff::tz::TimeZone::UTC;
    app.local_zone = Some(zone.clone());
    let (start, _) = budget_period(BudgetPeriod::Month, NOW, &zone).unwrap();
    let cut = NOW / 300_000 * 300_000;
    app.view
        .as_mut()
        .unwrap()
        .home
        .as_mut()
        .unwrap()
        .workspace
        .allowance_budgets = [
        ("openai", "OpenAI budget"),
        ("google", "Google budget"),
        ("anthropic", "Anthropic budget"),
    ]
    .into_iter()
    .map(|(provider, name)| AllowanceBudget {
        name: name.into(),
        provider: provider.into(),
        limit_usd_micros: 500_000_000,
        period: BudgetPeriod::Month,
    })
    .collect();
    let quote = |provider, model, micros: Option<u64>, reasons: &[&str]| {
        let pace: Vec<_> = [(3, 30_000_000), (6, 6_000_000), (24, 0)]
            .into_iter()
            .map(|(hours, micros)| {
                serde_json::json!({
                    "windowMs": hours * HOUR,
                    "fromMs": cut - hours * HOUR, "toMs": cut,
                    "usdMicros": micros, "complete": true, "lowerBound": false, "reasons": [],
                })
            })
            .collect();
        serde_json::json!({
            "provider": provider, "models": [model], "fromMs": start, "toMs": cut,
            "total": {
                "usdMicros": micros, "complete": reasons.is_empty(),
                "lowerBound": micros.is_some() && !reasons.is_empty(), "reasons": reasons
            },
            "pace": pace,
        })
    };
    let document = serde_json::json!({
        "version": 1, "since": null,
        "pricing": {
            "version": "2026-10-01", "asOf": "2026-10-01",
            "basis": "standard-list", "origin": "built-in",
            "models": [
                {"modelId": "gemini-4-argon", "effectiveFrom": "2026-10-01",
                 "usdMicrosPerMillion": {"input": 1000000},
                 "source": "https://ai.google.dev/gemini-api/docs/pricing", "asOf": "2026-10-01"},
                {"modelId": "gpt-5", "effectiveFrom": null,
                 "usdMicrosPerMillion": {"input": 1250000},
                 "source": "https://openai.com/api/pricing/", "asOf": "2026-10-01"}
            ]
        },
        "spend": {
            "requestedFromMs": start, "fromMs": start, "toMs": cut,
            "providers": [
                quote("anthropic", "claude-x", None, &["no_price"]),
                quote("google", "gemini-4-argon", Some(6_000_000), &["coverage_partial", "unattributed"]),
                quote("openai", "gpt-5", Some(480_000_000), &[]),
            ]
        }
    });
    let starts = crate::status::with_now_ms(NOW, || app.usage_report_want().unwrap().budget_starts);
    assert_eq!(starts, [start]);
    app.usage_report.apply_budget(
        Delivery {
            start,
            result: SpendReport::decode(&document, start),
        },
        &starts,
    );
    app
}

#[test]
fn allowance_budget_rows_distinguish_missing_floors_and_exact_spend() {
    let mut app = budget_fixture(crate::look::Look::default());
    let shown = buffer(&mut app, 160, 36);
    let lines = rows(&shown);
    let heading = lines.iter().find(|row| row.contains("NEED/h")).unwrap();
    let tokens = heading.find("tokens").unwrap();
    let resets = heading.find("RESETS").unwrap();
    let budget = |name: &str| lines.iter().find(|row| row.contains(name)).unwrap();
    assert!(budget("OpenAI budget").contains("✗ Oct 10 04:40"));
    assert_eq!(budget("Google budget").matches("≤ $").count(), 2);
    assert!(budget("Anthropic budget").contains("—"));
    for name in ["OpenAI budget", "Google budget", "Anthropic budget"] {
        assert!(
            budget(name)
                .chars()
                .skip(tokens)
                .take(resets - tokens)
                .all(char::is_whitespace),
            "{name}"
        );
    }
    let narrow = rows(&buffer(&mut app, 80, 36)).join("\n");
    assert!(narrow.contains("OpenAI budget $20 left"));
    assert!(narrow.contains("✗ Oct 10 04:40"));
    assert!(narrow.contains("Google budget ≤ $494 left · ≤ $0.95/h needed · —"));
    assert!(narrow.contains("Anthropic budget · spend unknown"));
    let details = super::super::allowance::budget_details(&app, NOW).join("\n");
    assert!(details.contains("All google usage on this machine; other machines not included."));
    assert!(details.contains("Spend: coverage partial, unattributed"));
    assert!(details.contains("Spend: no price"));
    assert!(details.contains("Period: Oct 01 00:00–Nov 01 00:00"));
    assert!(details.contains("Digest list-price table 2026-10-01 · as of 2026-10-01"));
    assert!(details.contains(
        "gemini-4-argon from 2026-10-01 · https://ai.google.dev/gemini-api/docs/pricing"
    ));
    assert_eq!(details.matches("phase:").count(), 3);
    assert!(!details.contains("tokens:"));
}
