use super::*;
use crate::board::app::workspace::tests::{MEMBER, ROOM, board};
use crate::board::workspace::manage::Change;
use crate::board::workspace::{OpsMember, OpsObservation, OpsSquad};
use crate::membership::workspace::RoomTarget;
use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use serde_json::json;

const INFRA: &str = "77777777-7777-4777-8777-777777777777";
const SPARE: &str = "88888888-8888-4888-8888-888888888888";

/// `worker` in product, an empty infra squad, and `spare` in Common pool, all unfolded.
fn app() -> App {
    let mut app = board();
    let home = app.view.as_mut().unwrap().home.as_mut().unwrap();
    home.workspace.rows.insert(
        OpsTarget::Squad(INFRA.into()),
        json!({"name":"infra","roomId":INFRA,"revision":4}),
    );
    home.workspace.roster.squads.push(OpsSquad {
        room_id: INFRA.into(),
        name: "infra".into(),
        members: vec![],
        lead: None,
        member_states: Default::default(),
        observation: OpsObservation::Complete,
        idle_alert: None,
    });
    home.workspace.roster.members.insert(
        SPARE.into(),
        OpsMember {
            id: SPARE.into(),
            name: "spare".into(),
            state: Some("idle".into()),
            waiting: false,
            presence: Some(true),
            usage: None,
            activity: Default::default(),
        },
    );
    app.shell.tab = crate::board::shell::OpsTab::Agents;
    app.workspace.expanded.insert(ROOM.into());
    app.workspace.pool_expanded = true;
    app.workspace.selected = Some(worker());
    app
}

fn worker() -> OpsTarget {
    OpsTarget::Member {
        room_id: Some(ROOM.into()),
        identity_id: MEMBER.into(),
    }
}

fn press(app: &mut App, code: KeyCode) -> Effect {
    app.key(KeyEvent::new(code, KeyModifiers::NONE))
}

fn lift_membership(app: &mut App) -> Effect {
    app.perform(&crate::action::Action::parse("move-membership").unwrap())
}

fn room(id: &str, name: &str, revision: u64) -> RoomTarget {
    RoomTarget {
        id: id.into(),
        name: name.into(),
        revision,
    }
}

fn applied(operation: Operation) -> Effect {
    Effect::Act(Request::WorkspaceOperation(Change::Membership(operation)))
}

fn lines(app: &App, width: u16) -> Vec<String> {
    let mut terminal =
        ratatui::Terminal::new(ratatui::backend::TestBackend::new(width, 36)).unwrap();
    terminal
        .draw(|frame| crate::board::view::render(frame, app))
        .unwrap();
    terminal
        .backend()
        .buffer()
        .content
        .chunks(usize::from(width))
        .map(|row| row.iter().map(|cell| cell.symbol()).collect())
        .collect()
}

#[test]
fn move_to_squad_then_up_moves_a_squad_membership_to_the_squad_above() {
    let mut app = app();
    assert_eq!(lift_membership(&mut app), Effect::None);
    assert_eq!(app.moving.as_ref().unwrap().target.as_deref(), Some(ROOM));
    press(&mut app, KeyCode::Up);
    assert_eq!(
        press(&mut app, KeyCode::Enter),
        applied(Operation::Assign {
            source: Some(room(ROOM, "product", 2)),
            destination: room(INFRA, "infra", 4),
            member: MEMBER.into(),
            move_member: true,
        })
    );
    assert_eq!(app.moving.as_ref().unwrap().phase, Phase::Applying);
}

#[test]
fn common_pool_is_the_last_target_and_moving_there_leaves_the_squad() {
    let mut app = app();
    lift_membership(&mut app);
    press(&mut app, KeyCode::Down);
    assert_eq!(
        app.moving.as_ref().unwrap().target,
        None,
        "Common pool follows the squads (infra, product)"
    );
    assert_eq!(
        press(&mut app, KeyCode::Enter),
        applied(Operation::Remove {
            room: room(ROOM, "product", 2),
            member: MEMBER.into(),
        })
    );
}

#[test]
fn a_pool_agent_joins_the_squad_it_is_moved_to() {
    let mut app = app();
    app.workspace.selected = Some(OpsTarget::Member {
        room_id: None,
        identity_id: SPARE.into(),
    });
    lift_membership(&mut app);
    assert_eq!(app.moving.as_ref().unwrap().target, None);
    press(&mut app, KeyCode::Up);
    assert_eq!(
        press(&mut app, KeyCode::Enter),
        applied(Operation::Assign {
            source: None,
            destination: room(ROOM, "product", 2),
            member: SPARE.into(),
            move_member: false,
        })
    );
}

#[test]
fn esc_puts_it_back_other_keys_are_ignored_and_the_same_squad_is_a_no_op() {
    let mut app = app();
    lift_membership(&mut app);
    for code in [
        KeyCode::Char('n'),
        KeyCode::Char('x'),
        KeyCode::Char('?'),
        KeyCode::Tab,
    ] {
        assert_eq!(press(&mut app, code), Effect::None);
        assert!(app.moving.is_some() && app.input.is_none() && !app.help);
    }
    assert_eq!(press(&mut app, KeyCode::Esc), Effect::None);
    assert!(app.moving.is_none());
    assert_eq!(app.workspace.selected, Some(worker()));
    lift_membership(&mut app);
    assert_eq!(press(&mut app, KeyCode::Enter), Effect::None);
    assert!(app.moving.is_none());
    assert_eq!(app.notice.as_deref(), Some("worker stays in product."));
}

#[test]
fn the_result_is_one_status_line_and_a_refused_move_changes_nothing() {
    let mut app = app();
    let rows = |app: &App| -> Vec<_> {
        app.workspace_rows()
            .iter()
            .map(|row| (row.target.clone(), row.title.clone()))
            .collect()
    };
    let before = rows(&app);
    lift_membership(&mut app);
    press(&mut app, KeyCode::Up);
    press(&mut app, KeyCode::Enter);
    app.finished_workspace(Err(crate::core::SquadError::new(
        "ROOM_REVISION_CONFLICT",
        "The room changed",
    )));
    assert_eq!(app.notice.as_deref(), Some("Not applied: The room changed"));
    assert!(app.moving.is_none());
    assert_eq!(rows(&app), before);
    lift_membership(&mut app);
    press(&mut app, KeyCode::Up);
    press(&mut app, KeyCode::Enter);
    app.finished_workspace(Ok(crate::membership::Outcome {
        document: json!({}),
        complete: true,
    }));
    assert_eq!(app.notice.as_deref(), Some("Moved worker to infra."));
}

#[test]
fn the_list_paints_the_lifted_line_and_its_old_place_at_every_width() {
    for width in [160, 100, 80] {
        let mut app = app();
        lift_membership(&mut app);
        let shown = lines(&app, width).join("\n");
        assert!(shown.contains("⇅ worker  → product"), "{width}: {shown}");
        assert!(!shown.contains("· moving"), "{width}: {shown}");
        press(&mut app, KeyCode::Up);
        let shown = lines(&app, width);
        let lifted = shown
            .iter()
            .position(|line| line.contains("⇅ worker  → infra"))
            .unwrap_or_else(|| panic!("{width}: {shown:#?}"));
        let infra = shown
            .iter()
            .position(|line| line.contains("infra"))
            .unwrap_or_else(|| panic!("{width}: {shown:#?}"));
        // The lifted line stays in view; a short stacked list may scroll its old place out.
        let placeholder = shown
            .iter()
            .position(|line| line.contains("┆ worker · moving"));
        assert!(placeholder.is_some() || width < 160, "{width}: {shown:#?}");
        assert!(infra < lifted, "{width}: {shown:#?}");
        assert!(
            placeholder.is_none_or(|at| lifted < at),
            "{width}: {shown:#?}"
        );
        assert!(
            shown
                .iter()
                .any(|line| line.contains("Moving worker · ↑↓ choose a squad")),
            "{width}"
        );
        assert!(
            shown
                .last()
                .unwrap()
                .contains("↑↓ choose squad  ⏎ move to infra  Esc cancel"),
            "{width}: {:?}",
            shown.last()
        );
    }
}

pub(in crate::board) fn nesting_board() -> App {
    let mut app = app();
    let snapshot = &mut app.view.as_mut().unwrap().home.as_mut().unwrap().workspace;
    snapshot.roster.observation = OpsObservation::Complete;
    snapshot.roster.membership_complete = true;
    for squad in &mut snapshot.roster.squads {
        squad.observation = OpsObservation::Complete;
        squad.members.push(SPARE.into());
    }
    snapshot
        .roster
        .squads
        .iter_mut()
        .find(|squad| squad.room_id == INFRA)
        .unwrap()
        .members
        .push(MEMBER.into());
    app.workspace.expanded.insert(INFRA.into());
    app
}

fn finish_save(app: &mut App, effect: Effect, root: &std::path::Path) {
    let Effect::Act(Request::MemberPlacement(save)) = effect else {
        panic!("expected a display-placement save, got {effect:?}");
    };
    let written = save.write(root).unwrap();
    save.finish(app, Ok(written));
}

fn cross_squad_board() -> App {
    let mut app = nesting_board();
    let roster = &mut app
        .view
        .as_mut()
        .unwrap()
        .home
        .as_mut()
        .unwrap()
        .workspace
        .roster;
    for squad in &mut roster.squads {
        if squad.room_id == INFRA {
            squad.members.retain(|id| id == MEMBER);
        } else if squad.room_id == ROOM {
            squad.members.retain(|id| id == SPARE);
        }
    }
    app.workspace.selected = Some(OpsTarget::Member {
        room_id: Some(INFRA.into()),
        identity_id: MEMBER.into(),
    });
    app.workspace_reconcile();
    app
}

#[test]
fn crossing_down_lands_first_and_saves_only_after_confirmed_membership() {
    for accepted in [false, true] {
        let mut app = cross_squad_board();
        let before = app.workspace.placements.clone();
        assert_eq!(press(&mut app, KeyCode::Char('m')), Effect::None);
        assert_eq!(press(&mut app, KeyCode::Down), Effect::None);
        let moving = app.moving.as_ref().unwrap();
        assert_eq!(moving.target.as_deref(), Some(ROOM));
        let (_, draft) = moving.order().unwrap();
        assert_eq!(
            draft.ordered_members().collect::<Vec<_>>(),
            [(MEMBER, 0), (SPARE, 0)]
        );
        assert_eq!(
            press(&mut app, KeyCode::Enter),
            applied(Operation::Assign {
                source: Some(room(INFRA, "infra", 4)),
                destination: room(ROOM, "product", 2),
                member: MEMBER.into(),
                move_member: true,
            })
        );
        assert_eq!(app.prune_member_placement(), Effect::None);
        let tab = KeyEvent::new(KeyCode::Tab, KeyModifiers::NONE);
        assert_eq!(
            app.moving_key(tab),
            None,
            "applying leaves normal keys to the board"
        );
        if !accepted {
            app.finished_workspace(Err(crate::core::SquadError::new(
                "ROOM_REVISION_CONFLICT",
                "Roster changed",
            )));
            assert!(app.moving.is_none());
            assert_eq!(app.prune_member_placement(), Effect::None);
            assert_eq!(app.workspace.placements, before);
            continue;
        }
        app.finished_workspace(Ok(crate::membership::Outcome {
            document: json!({}),
            complete: true,
        }));
        assert_eq!(app.workspace.placements, before);
        assert!(!app.workspace.saving_placement);
        assert_eq!(
            app.moving_key(tab),
            None,
            "awaiting leaves normal keys to the board"
        );
        assert_eq!(app.prune_member_placement(), Effect::None);
        assert_eq!(app.moving.as_ref().unwrap().phase, Phase::AwaitingRoster);
        assert_eq!(
            app.workspace.placements, before,
            "the pre-move roster does not consume the landing"
        );
        let roster = &mut app
            .view
            .as_mut()
            .unwrap()
            .home
            .as_mut()
            .unwrap()
            .workspace
            .roster;
        for squad in &mut roster.squads {
            if squad.room_id == INFRA {
                squad.members.retain(|id| id != MEMBER);
            } else if squad.room_id == ROOM {
                squad.members.push(MEMBER.into());
            }
        }
        let Effect::Act(Request::MemberPlacement(save)) = app.prune_member_placement() else {
            panic!("the confirmed roster should admit the landing save");
        };
        assert_eq!(save.expected, before);
        assert_eq!(
            save.next
                .group(Some(ROOM))
                .unwrap()
                .ordered_members()
                .collect::<Vec<_>>(),
            [(MEMBER, 0), (SPARE, 0)]
        );
        assert_eq!(save.next.group(Some(INFRA)), before.group(Some(INFRA)));
        save.finish(&mut app, Err("CAS conflict".into()));
        assert_eq!(app.workspace.placements, before);
        assert_eq!(
            app.notice.as_deref(),
            Some("Moved worker. Placement not saved: CAS conflict")
        );
    }
}

#[test]
fn drop_nests_under_the_previous_member_and_outdent_returns_to_root() {
    let mut app = nesting_board();
    let temporary =
        std::env::temp_dir().join(format!("ops-placement-{}", crate::id::new_v4().unwrap()));
    let depth = |app: &App, target: &OpsTarget| {
        app.workspace_rows()
            .iter()
            .find(|row| &row.target == target)
            .unwrap()
            .depth
    };
    let root = depth(&app, &worker());
    let other = OpsTarget::Member {
        room_id: Some(INFRA.into()),
        identity_id: MEMBER.into(),
    };
    press(&mut app, KeyCode::Char('m'));
    let shown = lines(&app, 160);
    assert!(shown.iter().any(|line| line.contains("Moving worker")));
    assert!(!shown.iter().any(|line| line.contains("choose a squad")));
    assert!(
        shown
            .last()
            .unwrap()
            .contains("↑↓ move  → nest  ← out  ⏎ drop  Esc cancel")
    );
    press(&mut app, KeyCode::Right);
    press(&mut app, KeyCode::Esc);
    assert_eq!(
        depth(&app, &worker()),
        root,
        "cancel leaves the original layout"
    );
    press(&mut app, KeyCode::Char('m'));
    press(&mut app, KeyCode::Right);
    let drop = press(&mut app, KeyCode::Enter);
    finish_save(&mut app, drop, &temporary);
    assert_eq!(depth(&app, &worker()), root + 1);
    assert_eq!(
        depth(&app, &other),
        root,
        "the other squad's appearance did not move"
    );

    let mut reopened = nesting_board();
    reopened.workspace.placements = super::super::placement::Placements::load(&temporary).unwrap();
    assert_eq!(depth(&reopened, &worker()), root + 1);
    let parent = OpsTarget::Member {
        room_id: Some(ROOM.into()),
        identity_id: SPARE.into(),
    };
    reopened.workspace.selected = Some(parent.clone());
    press(&mut reopened, KeyCode::Left);
    assert!(
        !reopened
            .workspace_rows()
            .iter()
            .any(|row| row.target == worker())
    );
    reopened.search = "worker".into();
    reopened.workspace_reconcile();
    assert_eq!(depth(&reopened, &worker()), root + 1);
    assert_eq!(depth(&reopened, &parent), root);
    assert!(reopened.workspace.member_folded(&parent));
    reopened.workspace.selected = Some(worker());
    reopened.search.clear();
    reopened.workspace_reconcile();
    assert!(
        !reopened.workspace.member_folded(&parent),
        "selected result stays visible"
    );

    // The only other root is currently a descendant. It cannot become its
    // ancestor's parent, even when that subtree is moved.
    reopened.workspace.selected = Some(parent);
    press(&mut reopened, KeyCode::Char('m'));
    press(&mut reopened, KeyCode::Right);
    assert_eq!(press(&mut reopened, KeyCode::Enter), Effect::None);

    app.workspace.selected = Some(worker());
    press(&mut app, KeyCode::Char('m'));
    press(&mut app, KeyCode::Left);
    let drop = press(&mut app, KeyCode::Enter);
    finish_save(&mut app, drop, &temporary);
    assert_eq!(depth(&app, &worker()), root);

    press(&mut app, KeyCode::Char('m'));
    press(&mut app, KeyCode::Right);
    let drop = press(&mut app, KeyCode::Enter);
    finish_save(&mut app, drop, &temporary);
    let make_observed = |app: &mut App, observation| {
        let squad = app
            .view
            .as_mut()
            .unwrap()
            .home
            .as_mut()
            .unwrap()
            .workspace
            .roster
            .squads
            .iter_mut()
            .find(|squad| squad.room_id == ROOM)
            .unwrap();
        squad.members.retain(|id| id != SPARE);
        squad.observation = observation;
    };
    make_observed(&mut app, OpsObservation::Partial);
    assert_eq!(app.prune_member_placement(), Effect::None);
    make_observed(&mut app, OpsObservation::Complete);
    let cleanup = app.prune_member_placement();
    finish_save(&mut app, cleanup, &temporary);
    assert_eq!(depth(&app, &worker()), root);
    assert_eq!(depth(&app, &other), root);
    std::fs::remove_dir_all(temporary).unwrap();
}

pub(in crate::board) fn nesting_scene(scene: &str, look: crate::look::Look) -> App {
    if scene == "agents-moving-across-squads" {
        let mut app = cross_squad_board();
        let view = app.view.as_mut().unwrap();
        view.look = look;
        view.home.as_mut().unwrap().workspace.squad_looks.clear();
        press(&mut app, KeyCode::Char('m'));
        press(&mut app, KeyCode::Down);
        return app;
    }
    let mut app = nesting_board();
    let view = app.view.as_mut().unwrap();
    view.look = look;
    view.home.as_mut().unwrap().workspace.squad_looks.clear();
    press(&mut app, KeyCode::Char('m'));
    press(&mut app, KeyCode::Right);
    if scene != "agents-nesting-lifted" {
        let Effect::Act(Request::MemberPlacement(save)) = press(&mut app, KeyCode::Enter) else {
            panic!("the fixture nests worker under spare");
        };
        let next = save.next.clone();
        save.finish(&mut app, Ok(next));
        crate::board::member_terminals::scenes::listed_rows(&mut app);
        if scene == "agents-nesting-folded" {
            app.workspace.selected = Some(OpsTarget::Member {
                room_id: Some(ROOM.into()),
                identity_id: SPARE.into(),
            });
            press(&mut app, KeyCode::Left);
        }
    }
    app
}
