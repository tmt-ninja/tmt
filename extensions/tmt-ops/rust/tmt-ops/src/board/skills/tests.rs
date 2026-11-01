use super::*;
use crate::board::app::{Request, workspace::tests::MEMBER};
use ratatui::crossterm::event::KeyModifiers;

fn key(app: &mut App, code: KeyCode) -> Effect {
    app.key(KeyEvent::new(code, KeyModifiers::NONE))
}

pub(in crate::board) fn report(syntax: Value, driver: Option<&str>) -> Report {
    Report::parse(&json!({
        "syntax": syntax,
        "driver": driver,
        "skills": [
            {"name": "tmt-checklist", "description": "Add an item to the conversation Checklist, or mark it done", "source": {"group": "tmt"}},
            {"name": "tmt-colab", "description": "Create and update Colab pages, answer page comments", "source": {"group": "tmt"}},
            {"name": "code-review", "description": "Review the current change for correctness bugs", "source": {"group": "user"}},
            {"name": "tmt-dev", "description": "The development workflow to read before changing this repository", "source": {"group": "project"}},
        ],
        "truncated": false,
        "rootsStamp": "a".repeat(64),
        "observedAtMs": 1,
    }))
    .unwrap()
}

pub(in crate::board) fn claude() -> Report {
    report(json!({"kind": "prefix", "sigil": "/"}), Some("claude"))
}
pub(in crate::board) fn codex() -> Report {
    report(json!({"kind": "prefix", "sigil": "$"}), Some("codex"))
}
pub(in crate::board) fn unsupported() -> Report {
    report(json!({"kind": "unsupported"}), Some("gemini"))
}

/// A member's Talk composer, with `held` as the member's skills read.
pub(in crate::board) fn composer(held: Option<Option<Report>>) -> App {
    let mut app = crate::board::app::workspace::tests::board();
    assert_eq!(key(&mut app, KeyCode::Enter), Effect::None);
    assert!(app.input.is_some());
    assert_eq!(
        app.skill_recipient().map(|(id, _)| id).as_deref(),
        Some(MEMBER)
    );
    if let Some(report) = held {
        app.skills.hold(MEMBER, report);
    }
    app
}

fn sent(effect: Effect) -> String {
    match effect {
        Effect::Act(Request::Chat { text, .. } | Request::Talk { text, .. }) => text,
        other => panic!("not sent: {other:?}"),
    }
}

#[test]
fn slash_at_any_token_start_opens_only_while_the_token_is_skill_shaped() {
    for typed in ["/co", "ask /co", "line\n/co", "/"] {
        let mut app = composer(Some(Some(claude())));
        app.paste(typed);
        assert!(app.skills.completion.open(), "{typed:?}");
    }
    for typed in ["/Users/ben", "/Users", "a/b", "$HOME", "x/co", "/co!", "//"] {
        let mut app = composer(Some(Some(claude())));
        app.paste(typed);
        assert!(!app.skills.completion.open(), "{typed:?}");
    }
}

#[test]
fn a_codex_pick_reads_slash_in_the_composer_and_is_sent_as_dollar() {
    for (held, expected) in [
        (codex(), "ask $tmt-colab ben"),
        (claude(), "ask /tmt-colab ben"),
        (unsupported(), "ask Please use tmt-colab: ben"),
    ] {
        let mut app = composer(Some(Some(held)));
        app.paste("ask /colab");
        assert_eq!(app.skills.completion.matches[0].label, "tmt-colab");
        assert_eq!(key(&mut app, KeyCode::Tab), Effect::None);
        let input = app.input.as_ref().unwrap();
        assert_eq!(input.text.as_str(), "ask /tmt-colab ");
        assert_eq!(chosen(&input.text.folds()[0]), Some("tmt-colab"));
        app.paste("ben");
        assert_eq!(sent(key(&mut app, KeyCode::Enter)), expected);
    }
}

#[test]
fn typed_paths_text_after_escape_and_edited_picks_are_sent_unchanged() {
    // A typed path never converts, even for Codex.
    let mut app = composer(Some(Some(codex())));
    app.paste("see /Users/ben and a/b $HOME");
    assert_eq!(
        sent(key(&mut app, KeyCode::Enter)),
        "see /Users/ben and a/b $HOME"
    );
    // Escape keeps every typed character and the token stays dismissed.
    let mut app = composer(Some(Some(codex())));
    app.paste("/tmt-colab");
    assert!(app.skills.completion.open());
    assert_eq!(key(&mut app, KeyCode::Esc), Effect::None);
    app.update_mentions();
    assert!(!app.skills.completion.open());
    assert_eq!(app.input.as_ref().unwrap().text.as_str(), "/tmt-colab");
    assert_eq!(sent(key(&mut app, KeyCode::Enter)), "/tmt-colab");
    // A mid-message pick converts; editing inside it drops the skill.
    let mut app = composer(Some(Some(codex())));
    app.paste("please /colab");
    key(&mut app, KeyCode::Tab);
    app.paste("now");
    let mut edited = composer(Some(Some(codex())));
    edited.paste("please /colab");
    key(&mut edited, KeyCode::Tab);
    for _ in 0..3 {
        key(&mut edited, KeyCode::Left);
    }
    edited.paste("x");
    assert!(
        edited
            .input
            .as_ref()
            .unwrap()
            .text
            .folds()
            .iter()
            .all(|fold| chosen(fold).is_none()),
        "an edit inside the pick drops its span"
    );
    assert_eq!(sent(key(&mut app, KeyCode::Enter)), "please $tmt-colab now");
    assert_eq!(
        sent(key(&mut edited, KeyCode::Enter)),
        "please /tmt-colxab "
    );
}

#[test]
fn loading_empty_and_plain_program_states() {
    // Before the first read the menu says it is loading, and Enter still sends.
    let mut app = composer(None);
    app.paste("/");
    assert!(app.skills.completion.open() && app.skills.completion.matches.is_empty());
    assert_eq!(sent(key(&mut app, KeyCode::Enter)), "/");
    // Nothing reported: the bare trigger says so, and the next name character closes it.
    let mut empty = claude();
    empty.skills.clear();
    let mut app = composer(Some(Some(empty)));
    app.paste("/");
    assert!(app.skills.completion.open());
    app.paste("x");
    assert!(!app.skills.completion.open());
    // A member whose skills cannot be read gets no menu at all.
    let mut app = composer(Some(None));
    app.paste("/");
    assert!(!app.skills.completion.open());
    // A plain program never gets a menu (#5787).
    let mut app = composer(Some(Some(claude())));
    app.references = crate::board::inventory::Inventory::from_listed(&Ok(json!({
        "identities": [{"id": MEMBER, "name": "worker", "plainProgram": "bash"}]
    })));
    assert!(app.skill_recipient().is_none());
    app.paste("/co");
    assert!(!app.skills.completion.open());
    assert_eq!(sent(key(&mut app, KeyCode::Enter)), "/co");
}

#[test]
fn reads_are_offered_once_then_refreshed_by_stamp() {
    let mut state = State::default();
    let start = Instant::now();
    let first = state.offer(Some(MEMBER), start).unwrap();
    assert_eq!(first.stamp, None);
    assert!(
        state.offer(Some(MEMBER), start).is_none(),
        "one read at a time"
    );
    state.finished(
        Completed {
            identity: MEMBER.into(),
            outcome: Outcome::Report(claude()),
        },
        start,
    );
    assert!(state.offer(Some(MEMBER), start + REFRESH / 2).is_none());
    let refresh = state.offer(Some(MEMBER), start + REFRESH).unwrap();
    assert_eq!(refresh.stamp.as_deref(), Some("a".repeat(64).as_str()));
    state.finished(
        Completed {
            identity: MEMBER.into(),
            outcome: Outcome::Unchanged,
        },
        start + REFRESH,
    );
    assert_eq!(state.report(MEMBER), Some(Some(&claude())));
    assert!(state.offer(None, start + REFRESH * 3).is_none());
}

#[test]
fn an_older_core_or_a_malformed_answer_is_no_skills() {
    assert!(Report::parse(&json!({"error": {"code": "API_INPUT_INVALID"}})).is_none());
    assert!(
        Report::parse(
            &json!({"syntax": {"kind": "prefix", "sigil": "//"}, "skills": [], "rootsStamp": "a"})
        )
        .is_none()
    );
    // A report without `driver` (an older Core) still parses.
    let older = Report::parse(&json!({
        "syntax": {"kind": "prefix", "sigil": "/"}, "skills": [], "rootsStamp": "a"
    }))
    .unwrap();
    assert_eq!(older.driver, None);
}
