//! Details tabs, the Estimate basis modal and its copy of the price sources.
use super::{paint, press, select_worker, valued_board, valued_document};
use crate::board::app::{App, Choice, CopyFeedback, Effect, Request};
use ratatui::crossterm::event::{
    KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind,
};

fn click(app: &mut App, choice: &Choice) -> Effect {
    let area = app
        .workspace_strip_hits
        .borrow()
        .iter()
        .find_map(|(area, found)| (found == choice).then_some(*area))
        .unwrap_or_else(|| panic!("{choice:?} must paint its own hit"));
    left(app, area.x, area.y)
}

fn left(app: &mut App, column: u16, row: u16) -> Effect {
    app.mouse(
        MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column,
            row,
            modifiers: KeyModifiers::NONE,
        },
        std::time::Instant::now(),
    )
}

fn key(app: &mut App, code: KeyCode) -> Effect {
    app.key(KeyEvent::new(code, KeyModifiers::NONE))
}

fn digest() -> App {
    let mut app = valued_board();
    press(&mut app, '2');
    select_worker(&mut app);
    app
}

#[test]
fn one_panel_keeps_delivery_totals_models_and_timers_and_range_keys_do_not_change_selection() {
    let _no_commands = crate::runner::forbid_commands();
    let mut app = digest();
    let shown = paint(&mut app, 160, 50);
    for label in ["worker · 1d", "Delivery", "Saved · 1d", "Models", "Timers"] {
        assert!(shown.contains(label), "{label}: {shown}");
    }
    assert!(!shown.contains("▸ Impact") && !shown.contains("▸ Evidence"));
    let selected = app.workspace.selected.clone();
    key(&mut app, KeyCode::Char(']'));
    assert_eq!(app.digest_window(), crate::config::DigestWindow::Week);
    key(&mut app, KeyCode::Char('['));
    assert_eq!(app.digest_window(), crate::config::DigestWindow::Day);
    assert_eq!(app.workspace.selected, selected);
    app.workspace.selected = Some(crate::board::workspace::OpsTarget::DigestAll);
    app.workspace_reconcile();
    assert!(paint(&mut app, 160, 50).contains("all · 1d"));
}

#[test]
fn the_key_is_offered_only_on_the_digest_tab() {
    let _no_commands = crate::runner::forbid_commands();
    let mut app = valued_board();
    paint(&mut app, 160, 44);
    assert!(!app.bindings().contains_key("]"));
    key(&mut app, KeyCode::Char(']'));
    press(&mut app, '2');
    assert!(app.bindings().contains_key("]"));
}

#[test]
fn the_all_rows_delivery_counts_modes_and_names_the_switch() {
    let _no_commands = crate::runner::forbid_commands();
    let mut document = valued_document();
    document["global"] =
        serde_json::json!({"enabled":true,"default":"auto","text":"Digest: on (auto)"});
    let mut app = valued_board();
    app.labels = crate::labels::Supplied::from_document("digest", &document, false);
    press(&mut app, '2');
    app.workspace.selected = Some(crate::board::workspace::OpsTarget::DigestAll);
    app.workspace_reconcile();
    let lines = super::super::details::delivery(&app, 121_000, app.selected_row());
    assert!(lines.contains(&"Digest: on (auto)".into()), "{lines:?}");
    assert!(
        lines.contains(&"Modes: Auto 1 · Every 0 · Off 0".into()),
        "{lines:?}"
    );
    assert!(lines.iter().any(|line| line.starts_with("Held now ")));
}

#[test]
fn the_basis_modal_shows_evidence_copies_its_sources_and_closes_on_esc_or_outside() {
    let _no_commands = crate::runner::forbid_commands();
    let mut app = digest();
    paint(&mut app, 160, 44);
    assert_eq!(click(&mut app, &Choice::DigestBasis), Effect::None);
    let shown = paint(&mut app, 160, 44);
    assert!(shown.contains("Estimate basis · Evidence"), "{shown}");
    assert!(shown.contains("y copy links"), "{shown}");
    // The modal and the Evidence tab read the same lines.
    let evidence = super::super::details::evidence(&app, 121_000, app.selected_row());
    assert!(shown.contains(&evidence[0]), "{shown}");

    match key(&mut app, KeyCode::Char('y')) {
        Effect::Act(Request::Copy { text, feedback, .. }) => {
            assert_eq!(
                text,
                "https://example.test/anthropic-pricing\nhttps://example.test/openai-pricing"
            );
            assert_eq!(feedback, CopyFeedback::Destination);
        }
        other => panic!("y copies the sources, got {other:?}"),
    }
    assert!(app.estimate_basis.is_some(), "copying keeps the modal open");
    assert_eq!(key(&mut app, KeyCode::Esc), Effect::None);
    assert!(app.estimate_basis.is_none());

    // An outside click closes it, too.
    app.choose(Choice::DigestBasis);
    paint(&mut app, 160, 44);
    left(&mut app, 0, 43);
    assert!(app.estimate_basis.is_none(), "an outside click closes it");
}

#[test]
fn a_long_source_address_stays_whole_and_copyable_in_estimate_basis() {
    let _no_commands = crate::runner::forbid_commands();
    let long = format!("https://example.test/{}", "pricing/".repeat(12));
    let mut document = valued_document();
    document["pricing"]["models"][0]["source"] = serde_json::json!(long);
    let mut app = digest();
    app.labels = crate::labels::Supplied::from_document("digest", &document, false);
    app.choose(Choice::DigestBasis);
    paint(&mut app, 80, 60);
    let evidence = super::super::details::evidence(&app, 121_000, app.selected_row());
    let wrapped: Vec<_> = evidence
        .iter()
        .flat_map(|line| crate::board::notes::wrap(line, 40))
        .collect();
    assert!(
        wrapped
            .iter()
            .all(|line| unicode_width::UnicodeWidthStr::width(line.as_str()) <= 40)
    );
    assert!(wrapped.concat().replace(' ', "").contains(&long));
    let Effect::Act(Request::Copy { text, .. }) = key(&mut app, KeyCode::Char('y')) else {
        panic!("copy source");
    };
    assert!(text.lines().any(|line| line == long));
}

#[test]
fn the_modal_takes_input_before_the_board() {
    let _no_commands = crate::runner::forbid_commands();
    let mut app = digest();
    paint(&mut app, 160, 44);
    app.choose(Choice::DigestBasis);
    paint(&mut app, 160, 44);
    let selected = app.workspace.selected.clone();
    app.key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
    key(&mut app, KeyCode::Char(']'));
    assert_eq!(app.workspace.selected, selected);
}
