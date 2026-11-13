//! Real App transitions; no worker or ambient terminal is involved.
use super::*;

pub(super) fn label_capture(scene: &str, look: crate::look::Look) -> App {
    let mut app = populated_board(1, 5);
    let first = "66666666-6666-4666-8666-000000000000";
    let second = "66666666-6666-4666-8666-000000000001";
    let view = app.view.as_mut().unwrap();
    view.look = look;
    let workspace = &mut view.home.as_mut().unwrap().workspace;
    for squad in &workspace.roster.squads {
        workspace.squad_looks.insert(squad.room_id.clone(), look);
    }
    for (id, name) in [(first, "tmt-remote-lead"), (second, "tmt-infra-lead")] {
        workspace.roster.members.get_mut(id).unwrap().name = name.into();
        for (target, row) in &mut workspace.rows {
            if matches!(target, OpsTarget::Member { identity_id, .. } if identity_id == id) {
                row["name"] = json!(name);
            }
        }
    }
    if scene != "agents-label-none" {
        let mut preferences = workspace.preferences.clone();
        preferences.labels.members.insert(first.into(), "pr".into());
        preferences
            .labels
            .members
            .insert(second.into(), "review".into());
        for (index, id) in [(2, "waiting"), (3, "blocked"), (4, "watch")] {
            preferences
                .labels
                .members
                .insert(format!("66666666-6666-4666-8666-{index:012}"), id.into());
        }
        workspace.set_preferences(preferences);
    }
    let index = app.workspace_rows().iter().position(|row| matches!(&row.target, OpsTarget::Member { identity_id, .. } if identity_id == first)).unwrap();
    app.workspace_select(index);
    if matches!(scene, "agents-label-menu" | "agents-label-editor") {
        paint(&app, 160, 36);
        key(&mut app, KeyCode::Char('l'));
        if scene == "agents-label-editor" {
            app.choose(Choice::EditLabels);
        }
    }
    app
}

#[test]
fn label_key_on_a_squad_only_reports_the_required_target() {
    let mut app = populated_board(1, 2);
    let index = app
        .workspace_rows()
        .iter()
        .position(|row| matches!(row.target, OpsTarget::Squad(_)))
        .unwrap();
    app.workspace_select(index);
    paint(&app, 160, 36);
    assert_eq!(key(&mut app, KeyCode::Char('l')), Effect::None);
    assert_eq!(app.notice.as_deref(), Some("Select an agent to label."));
    assert!(app.menu.is_none());
}

#[test]
fn label_key_on_the_common_pool_only_reports_the_required_target() {
    let mut app = populated_board(1, 2);
    paint(&app, 160, 36);
    assert_eq!(key(&mut app, KeyCode::Char('l')), Effect::None);
    assert_eq!(app.notice.as_deref(), Some("Select an agent to label."));
    assert!(app.menu.is_none());
}

#[test]
fn labels_after_nine_remain_reachable_without_digit_bindings() {
    let mut app = populated_board(1, 2);
    let labels = &mut app
        .view
        .as_mut()
        .unwrap()
        .home
        .as_mut()
        .unwrap()
        .workspace
        .preferences
        .labels;
    for index in 5..11 {
        labels.definitions.push(crate::config::BoardLabel {
            id: format!("label-{index}"),
            glyph: "X".into(),
            color: "working".into(),
            name: format!("Label {index}"),
        });
    }
    let index = app
        .workspace_rows()
        .iter()
        .position(|row| matches!(row.target, OpsTarget::Member { .. }))
        .unwrap();
    app.workspace_select(index);
    paint(&app, 160, 36);
    key(&mut app, KeyCode::Char('l'));
    let menu = app.menu.as_ref().unwrap();
    assert_eq!(menu.entries[9].key, "9");
    assert_eq!(menu.entries[10].key, "");
    paint(&app, 160, 36);
    for _ in 0..9 {
        key(&mut app, KeyCode::Down);
    }
    assert!(
        matches!(key(&mut app, KeyCode::Enter), Effect::Act(Request::MemberLabel { label: Some(ref id), .. }) if id == "label-9")
    );
}

#[test]
fn every_numbered_label_and_clear_reach_their_exact_value() {
    for (number, expected) in [
        ('0', None),
        ('1', Some("pr")),
        ('2', Some("review")),
        ('3', Some("waiting")),
        ('4', Some("blocked")),
        ('5', Some("watch")),
        ('6', Some("extra-6")),
        ('7', Some("extra-7")),
        ('8', Some("extra-8")),
        ('9', Some("extra-9")),
    ] {
        let mut app = populated_board(1, 2);
        let labels = &mut app
            .view
            .as_mut()
            .unwrap()
            .home
            .as_mut()
            .unwrap()
            .workspace
            .preferences
            .labels;
        for index in 6..=9 {
            labels.definitions.push(crate::config::BoardLabel {
                id: format!("extra-{index}"),
                glyph: "X".into(),
                color: "working".into(),
                name: format!("Extra {index}"),
            });
        }
        let index = app
            .workspace_rows()
            .iter()
            .position(|row| matches!(row.target, OpsTarget::Member { .. }))
            .unwrap();
        app.workspace_select(index);
        paint(&app, 160, 36);
        key(&mut app, KeyCode::Char('l'));
        let menu = app.menu.as_ref().expect("l opens the label menu");
        assert!(menu.title.contains("Label"));
        assert!(
            menu.entries
                .iter()
                .any(|entry| entry.key == "0" && entry.label.contains("clear"))
        );
        assert!(
            menu.entries
                .iter()
                .any(|entry| entry.label.contains("Edit labels"))
        );
        paint(&app, 160, 36);
        let effect = key(&mut app, KeyCode::Char(number));
        assert!(
            matches!(effect, Effect::Act(Request::MemberLabel { label, .. }) if label.as_deref() == expected),
            "number {number}"
        );
    }
}

#[test]
fn editor_refuses_a_thirty_third_label() {
    let mut app = populated_board(1, 2);
    let labels = &mut app
        .view
        .as_mut()
        .unwrap()
        .home
        .as_mut()
        .unwrap()
        .workspace
        .preferences
        .labels;
    for index in 5..32 {
        labels.definitions.push(crate::config::BoardLabel {
            id: format!("extra-{index}"),
            glyph: "X".into(),
            color: "working".into(),
            name: format!("Extra {index}"),
        });
    }
    assert_eq!(app.choose(Choice::LabelNew), Effect::None);
    assert!(
        app.notice
            .as_deref()
            .is_some_and(|notice| notice.contains("32 labels"))
    );
}

#[test]
fn editor_picks_an_unused_id_at_the_definition_limit() {
    let mut app = populated_board(1, 2);
    let labels = &mut app
        .view
        .as_mut()
        .unwrap()
        .home
        .as_mut()
        .unwrap()
        .workspace
        .preferences
        .labels;
    labels.definitions = (1..=31)
        .map(|index| crate::config::BoardLabel {
            id: format!("label-{index}"),
            glyph: "X".into(),
            color: "working".into(),
            name: format!("Label {index}"),
        })
        .collect();
    app.choose(Choice::LabelNew);
    app.choose(Choice::LabelField(super::super::LabelField::Name));
    app.input.as_mut().unwrap().text = "New".into();
    app.input_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
    assert!(
        matches!(app.choose(Choice::LabelSave), Effect::Act(Request::LabelEdit { expected, edit: crate::config::LabelEdit::Upsert(label) }) if expected.definitions.iter().all(|existing| existing.id != label.id)),
        "a new label must not replace any existing definition"
    );
}

#[test]
fn assigned_labels_reserve_aligned_chips_for_member_rows_only() {
    let mut app = populated_board(1, 2);
    let before = paint(&app, 160, 36);
    let member = "66666666-6666-4666-8666-000000000000";
    let workspace = &mut app.view.as_mut().unwrap().home.as_mut().unwrap().workspace;
    let mut preferences = workspace.preferences.clone();
    preferences
        .labels
        .members
        .insert(member.into(), "pr".into());
    workspace.set_preferences(preferences);
    let after = paint(&app, 160, 36);
    let line = |rows: &[String], needle: &str| {
        rows.iter()
            .find(|row| row.contains(needle))
            .unwrap()
            .clone()
    };
    let before_labeled = line(&before, "agent-00000");
    let after_labeled = line(&after, "agent-00000");
    let before_plain = line(&before, "agent-00001");
    let after_plain = line(&after, "agent-00001");
    assert!(after_labeled.contains(" P  "), "{after_labeled}");
    assert_eq!(
        after_labeled.find("agent-00000").unwrap(),
        before_labeled.find("agent-00000").unwrap() + 4
    );
    assert_eq!(
        after_plain.find("agent-00001").unwrap(),
        before_plain.find("agent-00001").unwrap() + 4
    );
    assert_eq!(line(&before, "squad-00"), line(&after, "squad-00"));
}

#[test]
fn label_chips_use_palette_roles_and_reverse_without_color() {
    use ratatui::style::Modifier;
    use tmt_cli_style::{Base, Depth, Role};
    for (base, depth) in [
        (Base::Tmt, Depth::TrueColor),
        (Base::TmtLight, Depth::TrueColor),
        (Base::Terminal, Depth::Ansi16),
        (Base::Tmt, Depth::None),
    ] {
        let mut app = populated_board(1, 2);
        let look = crate::look::Look {
            theme: tmt_cli_style::Theme::new(base),
            depth,
        };
        app.view.as_mut().unwrap().look = look;
        let workspace = &mut app.view.as_mut().unwrap().home.as_mut().unwrap().workspace;
        let mut preferences = workspace.preferences.clone();
        preferences
            .labels
            .members
            .insert("66666666-6666-4666-8666-000000000000".into(), "pr".into());
        workspace.set_preferences(preferences);
        let mut terminal = Terminal::new(TestBackend::new(160, 36)).unwrap();
        terminal
            .draw(|frame| crate::board::view::render(frame, &app))
            .unwrap();
        let buffer = terminal.backend().buffer();
        let row = buffer
            .content
            .chunks(160)
            .find(|row| {
                row.iter()
                    .map(|cell| cell.symbol())
                    .collect::<String>()
                    .contains("agent-00000")
            })
            .unwrap();
        let glyph = row.iter().position(|cell| cell.symbol() == "P").unwrap();
        if depth == Depth::None {
            assert!(row[glyph].modifier.contains(Modifier::REVERSED));
            assert!(!row[glyph + 2].modifier.contains(Modifier::REVERSED));
        } else {
            assert_eq!(row[glyph].bg, look.role(Role::Waiting).fg.unwrap());
            assert_eq!(row[glyph].fg, ratatui::style::Color::Black);
            assert!(!row[glyph].modifier.contains(Modifier::DIM));
            assert_ne!(row[glyph + 2].bg, row[glyph].bg);
        }
        assert_eq!(row[glyph - 1].bg, row[glyph].bg);
        assert_eq!(row[glyph + 1].bg, row[glyph].bg);
    }
}

#[test]
fn selected_member_identity_line_names_its_label() {
    let mut app = populated_board(1, 2);
    let member = "66666666-6666-4666-8666-000000000000";
    let workspace = &mut app.view.as_mut().unwrap().home.as_mut().unwrap().workspace;
    let mut preferences = workspace.preferences.clone();
    preferences
        .labels
        .members
        .insert(member.into(), "review".into());
    workspace.set_preferences(preferences);
    let index = app.workspace_rows().iter().position(|row| matches!(&row.target, OpsTarget::Member { identity_id, .. } if identity_id == member)).unwrap();
    app.workspace_select(index);
    let screen = paint(&app, 160, 36).join("\n");
    assert!(
        screen
            .lines()
            .any(|line| line.contains("squad-00") && line.contains("review")),
        "{screen}"
    );
}

#[test]
fn clicking_a_label_chip_selects_its_member_and_opens_the_menu() {
    use ratatui::crossterm::event::{MouseButton, MouseEvent, MouseEventKind};
    use unicode_width::UnicodeWidthStr;
    let mut app = populated_board(1, 2);
    let member = "66666666-6666-4666-8666-000000000001";
    let workspace = &mut app.view.as_mut().unwrap().home.as_mut().unwrap().workspace;
    let mut preferences = workspace.preferences.clone();
    preferences
        .labels
        .members
        .insert(member.into(), "pr".into());
    workspace.set_preferences(preferences);
    let screen = paint(&app, 160, 36);
    let (y, row) = screen
        .iter()
        .enumerate()
        .find(|(_, line)| line.contains("agent-00001"))
        .unwrap();
    let x = row[..row.find(" P ").unwrap()].width() + 1;
    app.mouse(
        MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: x as u16,
            row: y as u16,
            modifiers: KeyModifiers::NONE,
        },
        std::time::Instant::now(),
    );
    assert!(
        matches!(&app.workspace.selected, Some(OpsTarget::Member { identity_id, .. }) if identity_id == member)
    );
    assert!(
        app.menu
            .as_ref()
            .is_some_and(|menu| menu.title.contains("Label"))
    );
}

#[test]
fn label_editor_offers_definition_edits_and_preserves_a_cancelled_draft() {
    let mut app = populated_board(1, 2);
    let index = app
        .workspace_rows()
        .iter()
        .position(|row| matches!(row.target, OpsTarget::Member { .. }))
        .unwrap();
    app.workspace_select(index);
    paint(&app, 160, 36);
    key(&mut app, KeyCode::Char('l'));
    app.choose(Choice::EditLabels);
    let menu = app.menu.as_ref().expect("label editor list");
    assert!(menu.entries.iter().any(|entry| entry.label.contains("PR")));
    assert!(
        menu.entries
            .iter()
            .any(|entry| entry.label.contains("New label"))
    );
    app.choose(Choice::LabelDefinition("pr".into()));
    app.choose(Choice::LabelField(super::super::LabelField::Name));
    app.input.as_mut().unwrap().text = "Review draft".into();
    app.input_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
    assert!(
        app.menu
            .as_ref()
            .unwrap()
            .entries
            .iter()
            .any(|entry| entry.label.contains("Review draft"))
    );
    app.menu = None;
    app.choose(Choice::EditLabels);
    assert!(
        app.menu
            .as_ref()
            .unwrap()
            .entries
            .iter()
            .any(|entry| entry.label.contains("Review draft"))
    );
    app.choose(Choice::LabelField(super::super::LabelField::Glyph));
    app.input.as_mut().unwrap().text = "👩\u{200d}💻".into();
    app.input_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
    assert!(
        app.notice
            .as_deref()
            .is_some_and(|notice| notice.contains("one nonblank"))
    );
    assert_eq!(app.input.as_ref().unwrap().text.as_str(), "👩\u{200d}💻");
}

#[test]
fn label_editor_saves_one_valid_definition_and_retains_it_after_failure() {
    let mut app = populated_board(1, 2);
    app.choose(Choice::LabelDefinition("pr".into()));
    app.choose(Choice::LabelField(super::super::LabelField::Glyph));
    app.input.as_mut().unwrap().text = "界".into();
    app.input_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
    app.choose(Choice::LabelField(super::super::LabelField::Name));
    app.input.as_mut().unwrap().text = "Ship".into();
    app.input_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
    app.choose(Choice::LabelColor("working".into()));
    let effect = app.choose(Choice::LabelSave);
    assert!(
        matches!(effect, Effect::Act(Request::LabelEdit { edit: crate::config::LabelEdit::Upsert(ref label), .. }) if label.id == "pr" && label.glyph == "界" && label.name == "Ship" && label.color == "working"),
        "{effect:?}"
    );
    app.finished(Ok("Unrelated action finished.".into()));
    assert!(app.label_save_pending);
    app.finished_label_edit(Err("Labels changed; reload before saving.".into()));
    app.choose(Choice::EditLabels);
    let menu = app.menu.as_ref().unwrap();
    assert!(
        menu.entries
            .iter()
            .any(|entry| entry.label.contains("Ship"))
    );
    assert!(menu.entries.iter().any(|entry| entry.label.contains("界")));
}

#[test]
fn label_delete_requires_confirmation() {
    let mut app = populated_board(1, 2);
    app.choose(Choice::LabelDefinition("pr".into()));
    assert_eq!(app.choose(Choice::LabelDelete), Effect::None);
    assert!(app.confirm.is_some());
}

#[test]
fn wide_glyph_occupies_three_chip_cells_and_one_plain_space() {
    let mut app = populated_board(1, 2);
    let member = "66666666-6666-4666-8666-000000000000";
    let workspace = &mut app.view.as_mut().unwrap().home.as_mut().unwrap().workspace;
    let mut preferences = workspace.preferences.clone();
    preferences
        .labels
        .members
        .insert(member.into(), "blocked".into());
    workspace.set_preferences(preferences);
    let mut terminal = Terminal::new(TestBackend::new(160, 36)).unwrap();
    terminal
        .draw(|frame| crate::board::view::render(frame, &app))
        .unwrap();
    let row = terminal
        .backend()
        .buffer()
        .content
        .chunks(160)
        .find(|row| {
            row.iter()
                .map(|cell| cell.symbol())
                .collect::<String>()
                .contains("agent-00000")
        })
        .unwrap();
    let at = row.iter().position(|cell| cell.symbol() == "！").unwrap();
    assert_eq!(row[at + 2].bg, row[at].bg);
    assert_ne!(row[at + 3].bg, row[at].bg);
}

#[test]
fn an_assignment_outside_the_roster_does_not_reserve_a_slot() {
    let mut app = populated_board(1, 2);
    let before = paint(&app, 160, 36);
    let workspace = &mut app.view.as_mut().unwrap().home.as_mut().unwrap().workspace;
    let mut preferences = workspace.preferences.clone();
    preferences
        .labels
        .members
        .insert("66666666-6666-4666-8666-999999999999".into(), "pr".into());
    workspace.set_preferences(preferences);
    assert_eq!(paint(&app, 160, 36), before);
}

#[test]
fn digest_first_entry_uses_all_and_destination_picks_stay_independent() {
    let _no_commands = crate::runner::forbid_commands();
    let mut app = populated_board(2, 4);
    let index = app
        .workspace_rows()
        .iter()
        .position(|row| matches!(row.target, OpsTarget::Member { .. }))
        .unwrap();
    app.workspace_select(index);
    let agents = app.workspace.selected.clone();
    assert!(matches!(agents, Some(OpsTarget::Member { .. })));
    paint(&app, 160, 36);
    key(&mut app, KeyCode::Char('2'));
    assert_eq!(app.workspace.selected, Some(OpsTarget::DigestAll));

    let rows = app.workspace_rows();
    let index = rows
        .iter()
        .rposition(|row| matches!(row.target, OpsTarget::Member { .. }))
        .unwrap();
    let digest = rows[index].target.clone();
    app.workspace_select(index);
    key(&mut app, KeyCode::Char('1'));
    assert_eq!(app.workspace.selected, agents);
    let index = app
        .workspace_rows()
        .iter()
        .position(|row| {
            matches!(row.target, OpsTarget::Member { .. }) && Some(&row.target) != agents.as_ref()
        })
        .unwrap();
    app.workspace_select(index);
    let changed_agents = app.workspace.selected.clone();
    key(&mut app, KeyCode::Char('2'));
    assert_eq!(app.workspace.selected, Some(digest.clone()));
    key(&mut app, KeyCode::Char('2'));
    assert_eq!(app.workspace.selected, Some(digest));
    app.workspace_reconcile();
    assert!(
        app.workspace_rows()
            .iter()
            .any(|row| Some(&row.target) == app.workspace.selected.as_ref())
    );
    key(&mut app, KeyCode::Char('1'));
    assert_eq!(app.workspace.selected, changed_agents);
}

#[test]
fn escape_returns_one_level_and_never_quits_the_board() {
    for (width, height) in [(160, 36), (100, 24), (60, 18)] {
        let mut app = board();
        let target = app.workspace.selected.clone();
        let expanded = app.workspace.expanded.clone();
        paint(&app, width, height);
        assert_eq!(key(&mut app, KeyCode::Esc), Effect::None);
        assert_eq!(
            app.perform(&crate::action::Action::parse("inspect").unwrap()),
            Effect::None
        );
        let screen = paint(&app, width, height).join("\n");
        assert!(screen.contains("━━ worker "), "{screen}");
        assert!(screen.contains("Esc back"), "{screen}");
        assert!(
            !screen.contains("press j:"),
            "focused host metadata must not describe scrolling as Host: {screen}"
        );
        if width == 160 {
            assert_eq!(
                app.bindings()["pageup"].verb,
                Verb::Ui(OpsUiAction::ScrollPageUp)
            );
        }
        assert_eq!(app.focused_pane(), Some(Pane::Replies));
        assert_eq!(key(&mut app, KeyCode::Esc), Effect::None);
        assert_eq!(app.focused_pane(), Some(Pane::Rows));
        assert_eq!(app.workspace.selected, target);
        assert_eq!(app.workspace.expanded, expanded);
        for _ in 0..3 {
            assert_eq!(key(&mut app, KeyCode::Esc), Effect::None);
        }
        assert_eq!(key(&mut app, KeyCode::Char('q')), Effect::Quit);
    }
}

#[test]
fn destination_bindings_leave_conversation_and_dismiss_read_only_owners() {
    // The selected UUID survives entering and dismissing every overlay. Reads
    // emitted by opening recovery/discovery are deliberately not executed here.
    for owner in [
        "conversation",
        "help",
        "menu",
        "timers",
        "snapshots",
        "discovery",
        "checklist",
    ] {
        let mut app = board();
        let target = app.workspace.selected.clone();
        paint(&app, 160, 36);
        match owner {
            "conversation" => {
                app.perform(&crate::action::Action::parse("inspect").unwrap());
            }
            "help" => {
                key(&mut app, KeyCode::Char('?'));
            }
            "menu" => {
                app.context_menu();
            }
            "timers" => {
                key(&mut app, KeyCode::Char('c'));
            }
            "snapshots" => {
                app.open_recovery();
            }
            "discovery" => {
                app.open_discovery();
            }
            "checklist" => {
                app.open_checklist();
            }
            _ => unreachable!(),
        }
        paint(&app, 160, 36);
        assert_eq!(key(&mut app, KeyCode::Char('2')), Effect::None, "{owner}");
        assert_eq!(app.shell.tab, OpsTab::Digest, "{owner}");
        assert!(!app.modal_open(), "{owner}");
        assert_eq!(app.focused_pane(), Some(Pane::Rows), "{owner}");
        assert_eq!(
            app.workspace.selected,
            Some(OpsTarget::DigestAll),
            "{owner}"
        );
        assert_eq!(key(&mut app, KeyCode::Char('1')), Effect::None, "{owner}");
        assert_eq!(app.workspace.selected, target, "{owner}");
        assert_eq!(app.shell.tab, OpsTab::Agents, "{owner}");
    }
}

#[test]
fn typing_search_and_message_capture_shortcuts_and_keep_the_draft() {
    let mut app = board();
    paint(&app, 160, 36);
    key(&mut app, KeyCode::Enter);
    for ch in "q123l".chars() {
        assert_eq!(key(&mut app, KeyCode::Char(ch)), Effect::None);
    }
    assert_eq!(app.input.as_ref().unwrap().text.as_str(), "q123l");
    assert_eq!(app.shell.tab, OpsTab::Agents);
    assert_eq!(key(&mut app, KeyCode::Esc), Effect::None);
    assert!(app.input.is_none());
    assert_eq!(key(&mut app, KeyCode::Esc), Effect::None);
    assert_eq!(app.focused_pane(), Some(Pane::Rows));
    key(&mut app, KeyCode::Enter);
    assert_eq!(app.input.as_ref().unwrap().text.as_str(), "q123l");
    key(&mut app, KeyCode::Esc);
    key(&mut app, KeyCode::Esc);
    key(&mut app, KeyCode::Char('/'));
    for ch in "q123l".chars() {
        assert_eq!(key(&mut app, KeyCode::Char(ch)), Effect::None);
    }
    assert_eq!(app.search, "q123l");
    assert_eq!(app.shell.tab, OpsTab::Agents);
    key(&mut app, KeyCode::Esc);
    assert!(!app.searching);
    assert_eq!(key(&mut app, KeyCode::Esc), Effect::None);
}

#[test]
fn covered_editor_is_not_typing_owner_and_destination_keeps_its_uuid_draft() {
    let mut app = board();
    paint(&app, 160, 36);
    key(&mut app, KeyCode::Enter);
    for ch in "kept".chars() {
        key(&mut app, KeyCode::Char(ch));
    }
    app.help_state.borrow_mut().open(false);
    app.help = true;
    assert_eq!(
        app.workspace_input_owner(),
        crate::board::shell::OpsInputOwner::Popup
    );
    assert_eq!(key(&mut app, KeyCode::Char('1')), Effect::None);
    assert!(!app.help);
    assert!(app.input.is_none());
    assert_eq!(app.shell.tab, OpsTab::Agents);
    key(&mut app, KeyCode::Enter);
    assert_eq!(app.input.as_ref().unwrap().text.as_str(), "kept");
}

#[test]
fn configured_destination_and_reader_entry_share_the_effective_table() {
    let mut app = configured_member(
        "[bind]\nf2='digest-dashboard'\nv='copy {name}'\n",
        json!({"id":MEMBER,"name":"worker","presence":"active"}),
    );
    paint(&app, 160, 36);
    app.perform(&crate::action::Action::parse("inspect").unwrap());
    assert_eq!(
        key(&mut app, KeyCode::Char('v')),
        Effect::Act(Request::Copy {
            text: "worker".into(),
            program: None,
            feedback: crate::board::app::CopyFeedback::Destination,
        })
    );
    assert_eq!(key(&mut app, KeyCode::F(2)), Effect::None);
    assert_eq!(app.shell.tab, OpsTab::Digest);
    assert_eq!(app.focused_pane(), Some(Pane::Rows));
    key(&mut app, KeyCode::Char('1'));
    app.perform(&crate::action::Action::parse("inspect").unwrap());
    key(&mut app, KeyCode::Char('?'));
    assert_eq!(key(&mut app, KeyCode::F(2)), Effect::None);
    assert!(!app.help);
    assert_eq!(app.shell.tab, OpsTab::Digest);
}

#[test]
fn reader_entry_without_a_response_says_why_without_changing_selection() {
    let mut app = configured_member(
        "[bind]\nv='view-reply'\n",
        json!({"id":MEMBER,"name":"worker"}),
    );
    let target = app.workspace.selected.clone();
    assert!(!paint(&app, 160, 36).join("\n").contains("v reader"));
    app.context_menu();
    assert!(!app.menu.as_ref().unwrap().entries.iter().any(
        |entry| matches!(&entry.choice, Choice::Action(action) if action.verb == Verb::ViewReply)
    ));
    key(&mut app, KeyCode::Esc);
    assert_eq!(key(&mut app, KeyCode::Char('v')), Effect::None);
    assert!(app.row_details.reader.is_none());
    assert!(
        app.notice
            .as_deref()
            .is_some_and(|text| text.contains("response"))
    );
    assert_eq!(app.workspace.selected, target);
}

#[test]
fn reader_entry_uses_the_visible_response_without_requiring_retired_row_expansion() {
    let mut app = configured_member(
        "[bind]\nv='view-reply'\n",
        json!({"id":MEMBER,"name":"worker"}),
    );
    app.view.as_mut().unwrap().replies = vec![json!({
        "recipientId":MEMBER,"requestId":"req_44444444-4444-4444-8444-444444444444",
        "response":"Actual held response", "submittedAtMs":crate::status::now_ms(),
    })];
    paint(&app, 160, 36);
    let target = app.selected_detail_target().unwrap();
    assert!(!app.row_details.expanded.contains(&target));
    assert_eq!(key(&mut app, KeyCode::Char('v')), Effect::None);
    assert!(app.row_details.reader.is_some());
    let screen = paint(&app, 160, 36).join("\n");
    assert!(screen.contains("reply from worker"), "{screen}");
    assert!(screen.contains("Actual held response"), "{screen}");
    key(&mut app, KeyCode::Esc);
    assert!(app.row_details.reader.is_none());
    let screen = paint(&app, 160, 36).join("\n");
    assert!(super::help_lists(&app, "v"), "{screen}");
    app.context_menu();
    assert!(app.menu.as_ref().unwrap().entries.iter().any(
        |entry| matches!(&entry.choice, Choice::Action(action) if action.verb == Verb::ViewReply)
    ));
}

#[test]
fn pending_operations_hide_reopen_and_keep_their_single_outcome_without_resubmission() {
    use crate::board::workspace::{manage::Change, rename_member};
    for (kind, fields) in [
        (Kind::Create, vec!["next", "", "worker", ""]),
        (Kind::Add, vec!["worker"]),
        (Kind::Lead, vec!["worker"]),
        (Kind::RenameSquad, vec!["renamed"]),
        (Kind::RenameMember, vec!["renamed"]),
        (Kind::Remove, vec![]),
    ] {
        let mut app = board();
        assert_eq!(app.workspace_begin(kind), Effect::None);
        for text in fields {
            assert_eq!(app.workspace_submit_field(text.into()), Effect::None);
        }
        assert_eq!(
            app.workspace_form.as_ref().unwrap().stage,
            Stage::Review,
            "{kind:?}"
        );
        paint(&app, 160, 36);
        let mut submissions = 0;
        let mut observe = |effect: Effect| {
            if matches!(effect, Effect::Act(Request::WorkspaceOperation(_))) {
                submissions += 1;
            }
            effect
        };
        let Effect::Act(Request::WorkspaceOperation(request)) = observe(app.workspace_confirm())
        else {
            panic!("{kind:?}: one explicit reviewed request");
        };

        assert_eq!(
            observe(key(&mut app, KeyCode::Esc)),
            Effect::None,
            "{kind:?}"
        );
        let retained = app.workspace_form.as_ref().unwrap();
        assert!(!retained.shown);
        assert_eq!(retained.stage, Stage::Pending);
        assert!(app.reload_blocked());
        // Destination selection hides, but never submits or forgets, the owned operation.
        assert_eq!(observe(app.workspace_begin(kind)), Effect::None);
        assert_eq!(observe(key(&mut app, KeyCode::Char('2'))), Effect::None);
        assert_eq!(app.shell.tab, OpsTab::Digest);
        assert!(!app.workspace_form.as_ref().unwrap().shown);
        assert!(app.reload_blocked());
        assert_eq!(
            observe(app.workspace_begin(if kind == Kind::Create {
                Kind::Remove
            } else {
                Kind::Create
            })),
            Effect::None
        );
        assert_eq!(app.workspace_form.as_ref().unwrap().kind, kind);
        assert_eq!(
            app.workspace_form.as_ref().unwrap().operation.as_ref(),
            Some(&request)
        );
        assert!(!app.workspace_form.as_ref().unwrap().shown);
        assert_eq!(observe(app.context_menu()), Effect::None);
        let index = app
            .menu
            .as_ref()
            .unwrap()
            .entries
            .iter()
            .position(|entry| entry.label == format!("Pending {}", kind.label()))
            .unwrap();
        app.menu.as_mut().unwrap().selected = index;
        assert_eq!(observe(key(&mut app, KeyCode::Enter)), Effect::None);
        assert!(app.workspace_form.as_ref().unwrap().shown);
        assert_eq!(observe(app.workspace_confirm()), Effect::None);
        assert!(
            app.workspace_form
                .as_ref()
                .unwrap()
                .controls
                .get()
                .iter()
                .all(Option::is_none),
            "stale confirmation must stay revoked"
        );
        assert_eq!(observe(key(&mut app, KeyCode::Esc)), Effect::None);
        match request {
            Change::RenameMember(request) => app.finished_member_rename(rename_member::Completed {
                request,
                outcome: Ok(rename_member::Outcome::Applied {
                    name: "renamed".into(),
                    changed: true,
                }),
            }),
            Change::CloseMember(request) => {
                app.finished_close_member(crate::board::workspace::close_member::Completed {
                    request,
                    outcome: crate::board::workspace::close_member::Outcome::Changed {
                        pane_reason: None,
                    },
                })
            }
            Change::Membership(_) | Change::PublishLeads(_) | Change::PreviewLeads(_) => app
                .finished_workspace(Err(crate::core::SquadError::new(
                    "API_UNAVAILABLE",
                    "Outcome not confirmed",
                ))),
        }
        assert!(!app.workspace_form.as_ref().unwrap().shown);
        assert!(matches!(
            app.workspace_form.as_ref().unwrap().stage,
            Stage::Result(_)
        ));
        assert_eq!(observe(app.context_menu()), Effect::None);
        let index = app
            .menu
            .as_ref()
            .unwrap()
            .entries
            .iter()
            .position(|entry| entry.label == format!("{} result", kind.label()))
            .unwrap();
        app.menu.as_mut().unwrap().selected = index;
        assert_eq!(observe(key(&mut app, KeyCode::Enter)), Effect::None);
        assert!(app.workspace_form.as_ref().unwrap().shown);
        assert_eq!(observe(app.workspace_confirm()), Effect::None);

        assert_eq!(observe(key(&mut app, KeyCode::Esc)), Effect::None);
        assert!(app.workspace_form.is_none());
        assert!(!app.reload_blocked());
        assert_eq!(observe(key(&mut app, KeyCode::Esc)), Effect::None);
        assert_eq!(
            submissions, 1,
            "{kind:?}: one effect leaves App for the lane"
        );
    }
}

#[test]
fn q_steps_back_in_overlays_and_release_events_do_not_switch_tabs() {
    let mut app = board();
    paint(&app, 160, 36);
    key(&mut app, KeyCode::Char('?'));
    assert_eq!(key(&mut app, KeyCode::Char('q')), Effect::None);
    assert!(!app.help);
    app.perform(&crate::action::Action::parse("inspect").unwrap());
    assert_eq!(app.focused_pane(), Some(Pane::Replies));
    let mut release = KeyEvent::new(KeyCode::Char('2'), KeyModifiers::NONE);
    release.kind = ratatui::crossterm::event::KeyEventKind::Release;
    assert_eq!(app.key(release), Effect::None);
    assert_eq!(app.shell.tab, OpsTab::Agents);
    assert_eq!(key(&mut app, KeyCode::Char('q')), Effect::Quit);
}

#[test]
fn digest_restores_keep_explicit_uuid_and_the_other_destination_is_session_only() {
    for exec in [false, true] {
        let mut app = board();
        let target = app.workspace.selected.clone();
        app.shell.tab = OpsTab::Digest;
        let mut replacement = board();
        if exec {
            replacement.carry(app.resume().unwrap());
            replacement.restore_pending();
        } else {
            let hint = crate::board::view_state::ViewState {
                controls: None,
                scrolls: vec![],
                shell: OpsTab::Digest,
                expanded: app.workspace.expanded.clone(),
                pool_expanded: true,
                selected: target.clone(),
            };
            replacement.carry_view_hint(&hint, false);
        }
        assert_eq!(replacement.shell.tab, OpsTab::Digest);
        assert_eq!(replacement.workspace.selected, target);
        key(&mut replacement, KeyCode::Char('1'));
        key(&mut replacement, KeyCode::Char('2'));
        assert_eq!(replacement.workspace.selected, target);
    }
}

#[test]
fn digest_keyboard_pointer_and_authored_entry_share_the_selection_transition() {
    let _no_commands = crate::runner::forbid_commands();
    for entry in ["key", "pointer", "action"] {
        let mut app = board();
        let agents = app.workspace.selected.clone();
        paint(&app, 160, 36);
        let effect = match entry {
            "key" => key(&mut app, KeyCode::Char('2')),
            "pointer" => {
                let hit = *app
                    .tab_hits
                    .borrow()
                    .iter()
                    .find(|hit| hit.tab == 1)
                    .unwrap();
                app.mouse(
                    MouseEvent {
                        kind: MouseEventKind::Down(MouseButton::Left),
                        column: hit.x,
                        row: hit.y,
                        modifiers: KeyModifiers::NONE,
                    },
                    Instant::now(),
                )
            }
            _ => app.perform(&crate::action::Action::parse("digest-dashboard").unwrap()),
        };
        assert_eq!(effect, Effect::None);
        assert_eq!(
            app.workspace.selected,
            Some(OpsTarget::DigestAll),
            "{entry}"
        );
        key(&mut app, KeyCode::Char('1'));
        assert_eq!(app.workspace.selected, agents, "{entry}");
    }
}
