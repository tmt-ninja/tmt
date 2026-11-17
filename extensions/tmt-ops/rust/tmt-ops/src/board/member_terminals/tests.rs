use super::*;

const MEMBER: &str = "11111111-1111-4111-8111-111111111111";

fn terminal(n: u8, created_ms: u64, busy: bool) -> Listed {
    Listed {
        id: format!("term_{}", format!("{n:02x}").repeat(16)),
        socket: PathBuf::from(format!("/tmp/pty/term_{n}.sock")),
        busy,
        created_ms,
        shell: None,
        program: None,
    }
}

/// Terminals as production builds them: Core is asked on its own (#6301).
fn automatic() -> Terminals {
    Terminals {
        automatic: true,
        ..Terminals::default()
    }
}

fn listed(terminals: Vec<Listed>) -> Completed {
    Completed::Listed(vec![(MEMBER.into(), List::Terminals(terminals))])
}

#[test]
fn rows_are_numbered_in_order_seen_and_an_ended_one_stays_greyed_for_the_session() {
    let mut terminals = automatic();
    terminals.finished(
        listed(vec![terminal(2, 20, true), terminal(1, 10, false)]),
        0,
    );
    let rows = terminals.rows(MEMBER);
    assert_eq!(
        rows.iter().map(Row::title).collect::<Vec<_>>(),
        ["Terminal 1", "Terminal 2"]
    );
    assert!(!rows[0].busy && rows[1].busy);

    // Terminal 1's shell ended: Core no longer lists it, the row stays as ended.
    terminals.finished(
        listed(vec![terminal(2, 20, false), terminal(3, 30, false)]),
        1,
    );
    let rows = terminals.rows(MEMBER);
    assert_eq!(
        rows.iter()
            .map(|row| (row.title(), row.ended))
            .collect::<Vec<_>>(),
        [
            ("Terminal 1".into(), true),
            ("Terminal 2".into(), false),
            ("Terminal 3".into(), false)
        ]
    );

    // `x` on the ended row drops it without asking Core; a live row is never dropped this way.
    let ended = rows[0].id.clone();
    let live = rows[1].id.clone();
    assert!(!terminals.forget(MEMBER, &live));
    assert!(terminals.forget(MEMBER, &ended));
    assert_eq!(terminals.rows(MEMBER).len(), 2);
    assert_eq!(
        terminals.offer(&[], None, 2),
        None,
        "forgetting asks nothing"
    );

    // A number is not reused while a row shows.
    terminals.finished(
        listed(vec![
            terminal(2, 20, false),
            terminal(3, 30, false),
            terminal(4, 40, false),
        ]),
        3,
    );
    assert_eq!(terminals.rows(MEMBER)[2].title(), "Terminal 4");
}

#[test]
fn a_closed_or_unavailable_member_shows_no_terminals_and_is_not_asked_again_soon() {
    let mut terminals = automatic();
    terminals.finished(listed(vec![terminal(1, 10, false)]), 0);
    terminals.finished(
        Completed::Listed(vec![(MEMBER.into(), List::Unavailable)]),
        5_000,
    );
    assert!(terminals.rows(MEMBER).is_empty());
    terminals.swept = true;
    assert_eq!(terminals.offer(&[], Some(MEMBER), 10_000), None);
    assert_eq!(
        terminals.offer(&[], Some(MEMBER), 5_000 + UNAVAILABLE_FOR_MS),
        Some(Task::List(vec![MEMBER.into()]))
    );
}

#[test]
fn the_lane_gets_one_task_at_a_time_asked_for_work_first_then_one_sweep_then_the_selected() {
    let mut terminals = automatic();
    let members = [MEMBER.to_owned(), "other".to_owned()];
    terminals.open(MEMBER);
    assert_eq!(
        terminals.offer(&members, Some(MEMBER), 0),
        Some(Task::Open(MEMBER.into()))
    );
    assert_eq!(terminals.offer(&members, Some(MEMBER), 0), None, "one out");
    let applied = terminals.finished(
        Completed::Opened {
            identity: MEMBER.into(),
            outcome: Ok(terminal(1, 10, false)),
        },
        0,
    );
    assert_eq!(
        applied.select,
        Some((MEMBER.into(), terminal(1, 10, false).id))
    );
    assert_eq!(
        terminals.offer(&members, Some(MEMBER), 0),
        Some(Task::List(members.to_vec())),
        "every member once after start"
    );
    terminals.finished(listed(vec![terminal(1, 10, false)]), 0);
    assert_eq!(terminals.offer(&members, Some(MEMBER), 1_000), None);
    assert_eq!(
        terminals.offer(&members, Some(MEMBER), SELECTED_FOR_MS),
        Some(Task::List(vec![MEMBER.into()]))
    );
}

#[test]
fn a_failed_open_says_why_and_a_close_removes_the_row_or_keeps_it_with_the_reason() {
    let mut terminals = automatic();
    let applied = terminals.finished(
        Completed::Opened {
            identity: MEMBER.into(),
            outcome: Err("This member already has 8 terminals.".into()),
        },
        0,
    );
    assert_eq!(
        applied,
        Applied {
            select: None,
            notice: Some("This member already has 8 terminals.".into())
        }
    );
    terminals.finished(
        listed(vec![terminal(1, 10, true), terminal(2, 20, false)]),
        0,
    );
    let [one, two] = [0, 1].map(|index| terminals.rows(MEMBER)[index].id.clone());
    let kept = terminals.finished(
        Completed::Closed {
            identity: MEMBER.into(),
            terminal: one.clone(),
            outcome: Err("Not confirmed.".into()),
        },
        1,
    );
    assert_eq!(kept.notice.as_deref(), Some("Not confirmed."));
    assert!(terminals.row(MEMBER, &one).is_some());
    terminals.finished(
        Completed::Closed {
            identity: MEMBER.into(),
            terminal: two.clone(),
            outcome: Ok(()),
        },
        2,
    );
    assert!(terminals.row(MEMBER, &two).is_none());
}

#[test]
fn folding_needs_rows_and_a_new_terminal_unfolds_its_member() {
    let mut terminals = automatic();
    assert!(!terminals.toggle_fold(MEMBER, false), "nothing to fold");
    terminals.finished(listed(vec![terminal(1, 10, false)]), 0);
    assert!(terminals.toggle_fold(MEMBER, false));
    assert!(terminals.folded(MEMBER));
    assert!(!terminals.toggle_fold(MEMBER, false));
    terminals.finished(
        Completed::Opened {
            identity: MEMBER.into(),
            outcome: Ok(terminal(2, 20, false)),
        },
        1,
    );
    assert!(!terminals.folded(MEMBER));
}

#[test]
fn only_core_shaped_terminals_are_read() {
    let good = serde_json::json!({"terminalId": format!("term_{}", "ab".repeat(16)),
        "socket": "/tmp/pty/x.sock", "busy": true, "createdMs": 5});
    assert!(super::listed(&good).is_some_and(|terminal| terminal.busy));
    for bad in [
        serde_json::json!({"terminalId": "term_../x", "socket": "/tmp/x.sock"}),
        serde_json::json!({"terminalId": format!("term_{}", "AB".repeat(16)), "socket": "/tmp/x.sock"}),
        serde_json::json!({"terminalId": format!("term_{}", "ab".repeat(16)), "socket": "relative.sock"}),
    ] {
        assert_eq!(super::listed(&bad), None, "{bad}");
    }
}

/// Core cleans the names; the board still keeps control characters off the screen and
/// takes a program only while busy (#6112).
#[test]
fn shell_and_program_names_are_display_text_and_a_program_needs_busy() {
    let id = format!("term_{}", "ab".repeat(16));
    let read = |busy: bool, shell: &str, program: &str| {
        let value = serde_json::json!({"terminalId": id, "socket": "/tmp/pty/x.sock",
            "busy": busy, "createdMs": 5, "shell": shell, "program": program});
        let terminal = super::listed(&value).unwrap();
        (terminal.shell, terminal.program)
    };
    assert_eq!(
        read(true, "zsh", "cargo"),
        (Some("zsh".into()), Some("cargo".into()))
    );
    assert_eq!(
        read(true, "\u{1b}]0;x\u{7}zsh", "編譯\u{1b}[2J"),
        (Some("]0;xzsh".into()), Some("編譯[2J".into()))
    );
    assert_eq!(read(false, " ", "sleep"), (None, None));
    let bare = serde_json::json!({"terminalId": id, "socket": "/tmp/pty/x.sock"});
    let terminal = super::listed(&bare).unwrap();
    assert_eq!((terminal.shell, terminal.program), (None, None));
}

mod board {
    use super::super::{Completed, List, Task};
    use super::terminal;
    use crate::board::{
        app::{
            App,
            workspace::tests::{MEMBER, board},
        },
        terminal_tab::tab::tests::{built_in, tab},
        workspace::OpsTarget,
    };
    use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

    fn press(app: &mut App, code: KeyCode) {
        app.key(KeyEvent::new(code, KeyModifiers::NONE));
    }

    /// The fixture's member on the built-in host with an idle and a busy terminal listed.
    fn listed_board() -> (App, OpsTarget) {
        let mut app = built_in(board());
        app.terminal = tab().0;
        let member = app.workspace.selected.clone().unwrap();
        app.terminals.finished(
            Completed::Listed(vec![(
                MEMBER.into(),
                List::Terminals(vec![terminal(1, 10, false), terminal(2, 20, true)]),
            )]),
            0,
        );
        (app, member)
    }

    fn select(app: &mut App, member: &OpsTarget, n: u8) {
        app.workspace.selected = super::super::target(member, &terminal(n, 0, false).id);
    }

    #[test]
    fn terminal_row_refuses_the_member_label_action() {
        let (mut app, member) = listed_board();
        select(&mut app, &member, 1);
        press(&mut app, KeyCode::Char('l'));
        assert_eq!(app.notice.as_deref(), Some("Select an agent to label."));
        assert!(app.menu.is_none());
    }

    #[test]
    fn terminal_rows_sit_under_their_member_and_fold_with_it() {
        let (mut app, member) = listed_board();
        let rows = app.workspace_rows();
        let at = rows.iter().position(|row| row.target == member).unwrap();
        assert_eq!(
            rows[at + 1..at + 3]
                .iter()
                .map(|row| (row.title.as_str(), row.depth))
                .collect::<Vec<_>>(),
            [
                ("Terminal 1", rows[at].depth + 1),
                ("Terminal 2", rows[at].depth + 1)
            ]
        );
        press(&mut app, KeyCode::Left);
        assert!(app.terminals.folded(MEMBER));
        assert!(
            !app.workspace_rows()
                .iter()
                .any(|row| matches!(row.target, OpsTarget::Terminal { .. }))
        );
        press(&mut app, KeyCode::Right);
        assert!(!app.terminals.folded(MEMBER));
    }

    #[test]
    fn t_opens_a_terminal_under_a_member_on_any_host_and_asks_core_on_the_lane() {
        let (mut app, member) = listed_board();
        app.terminals.swept = true;
        app.terminals.automatic = true;
        press(&mut app, KeyCode::Char('t'));
        assert_eq!(
            app.terminals.offer(&[], None, 0),
            Some(Task::Open(MEMBER.into()))
        );
        app.terminals.out = false;

        // A tmux member has terminals too (#6301).
        let mut tmux = board();
        tmux.terminals.swept = true;
        tmux.terminals.automatic = true;
        press(&mut tmux, KeyCode::Char('t'));
        assert_eq!(
            tmux.terminals.offer(&[], None, 0),
            Some(Task::Open(MEMBER.into()))
        );
        assert!(app.workspace_selected_member().is_some());
        select(&mut app, &member, 1);
        assert!(
            app.workspace_selected_member().is_none(),
            "a terminal row is never a recipient"
        );
        assert_eq!(
            app.workspace_row_scope(),
            crate::config::OpsKeyScope::Terminal
        );
    }

    #[test]
    fn x_closes_an_idle_terminal_and_asks_first_for_a_busy_one() {
        let (mut app, member) = listed_board();
        app.terminals.swept = true;
        app.terminals.automatic = true;
        select(&mut app, &member, 1);
        press(&mut app, KeyCode::Char('x'));
        assert_eq!(
            app.terminals.offer(&[], None, 0),
            Some(Task::Close {
                identity: MEMBER.into(),
                terminal: terminal(1, 0, false).id,
                force: false
            })
        );
        app.terminals.out = false;

        select(&mut app, &member, 2);
        press(&mut app, KeyCode::Char('x'));
        assert!(app.modal_open(), "a busy terminal asks first");
        // Core did not name the program: the body says only that one runs.
        assert_eq!(
            app.confirm.as_ref().unwrap().lines(),
            ["A program is still running. Closing ends it."]
        );
        assert_eq!(app.terminals.offer(&[], None, 0), None);
        // Cancel is first and the default: Enter changes nothing.
        press(&mut app, KeyCode::Enter);
        assert!(!app.modal_open());
        assert_eq!(app.terminals.offer(&[], None, 0), None);
        assert_eq!(
            app.choose(crate::board::app::Choice::CloseTerminal {
                identity: MEMBER.into(),
                terminal: terminal(2, 0, false).id,
            }),
            crate::board::app::Effect::None
        );
        assert!(matches!(
            app.terminals.offer(&[], None, 0),
            Some(Task::Close { force: true, .. })
        ));
    }

    #[test]
    fn the_close_confirm_names_the_program_core_reports() {
        let (mut app, member) = listed_board();
        let mut named = terminal(2, 20, true);
        named.shell = Some("zsh".into());
        named.program = Some("cargo".into());
        app.terminals.finished(
            Completed::Listed(vec![(
                MEMBER.into(),
                List::Terminals(vec![terminal(1, 10, false), named]),
            )]),
            0,
        );
        select(&mut app, &member, 2);
        press(&mut app, KeyCode::Char('x'));
        assert_eq!(
            app.confirm.as_ref().unwrap().lines(),
            ["A program is still running (cargo). Closing ends it."]
        );
    }

    /// A long program name ends in an ellipsis at 24 cells, and on a narrow board the
    /// confirm stays inside the board, wrapping its body rather than cutting it.
    #[test]
    fn a_long_program_name_is_ellipsized_and_the_confirm_fits_a_narrow_board() {
        let long = "cargo-nextest-run-with-a-very-long-name";
        let label = super::super::keys::program_label(long);
        assert_eq!(unicode_width::UnicodeWidthStr::width(label.as_str()), 24);
        assert!(label.ends_with('…') && long.starts_with(label.trim_end_matches('…')));
        assert_eq!(super::super::keys::program_label("編譯器"), "編譯器");

        let (mut app, member) = listed_board();
        let mut named = terminal(2, 20, true);
        named.program = Some(long.into());
        app.terminals.finished(
            Completed::Listed(vec![(
                MEMBER.into(),
                List::Terminals(vec![terminal(1, 10, false), named]),
            )]),
            0,
        );
        select(&mut app, &member, 2);
        press(&mut app, KeyCode::Char('x'));
        assert_eq!(
            app.confirm.as_ref().unwrap().lines(),
            [format!(
                "A program is still running ({label}). Closing ends it."
            )]
        );
        let mut terminal =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(44, 24)).unwrap();
        terminal
            .draw(|frame| crate::board::view::render(frame, &app))
            .unwrap();
        let screen: Vec<String> = (0..24)
            .map(|y| {
                (0..44)
                    .map(|x| terminal.backend().buffer()[(x, y)].symbol().to_owned())
                    .collect()
            })
            .collect();
        let top = screen
            .iter()
            .find(|row| row.contains("Close Terminal 2?"))
            .unwrap_or_else(|| panic!("no confirm in {screen:#?}"));
        assert!(
            top.contains('┌') && top.contains('┐'),
            "the box is whole: {top}"
        );
        let body = screen.join("\n");
        assert!(body.contains("(cargo-nextest"), "{body}");
    }

    #[test]
    fn x_on_an_ended_terminal_removes_the_row_without_asking_core() {
        let (mut app, member) = listed_board();
        app.terminals.swept = true;
        app.terminals.automatic = true;
        app.terminals.finished(
            Completed::Listed(vec![(
                MEMBER.into(),
                List::Terminals(vec![terminal(2, 20, false)]),
            )]),
            0,
        );
        select(&mut app, &member, 1);
        assert!(app.selected_terminal().unwrap().1.ended);
        press(&mut app, KeyCode::Char('x'));
        assert_eq!(app.terminals.rows(MEMBER).len(), 1);
        assert_eq!(app.workspace.selected.as_ref(), Some(&member));
        assert_eq!(app.terminals.offer(&[], None, 0), None);
    }

    #[test]
    fn enter_types_into_the_panel_until_the_back_key_and_z_shows_it_full_screen() {
        let (mut app, member) = listed_board();
        select(&mut app, &member, 1);
        assert!(app.terminal_sync(), "the selected terminal's stream opens");
        press(&mut app, KeyCode::Enter);
        assert_eq!(
            app.terminals.typing(),
            Some(terminal(1, 0, false).id.as_str())
        );
        // While typing, a board key is the terminal's.
        press(&mut app, KeyCode::Char('x'));
        assert!(!app.modal_open());
        app.key(KeyEvent::new(KeyCode::Char('g'), KeyModifiers::CONTROL));
        assert_eq!(app.terminals.typing(), None);
        press(&mut app, KeyCode::Char('z'));
        assert!(app.framed());
        assert_eq!(app.terminal_member_name(), "Terminal 1");
        assert_eq!(
            app.terminal_locate(),
            None,
            "Core is never asked to locate a terminal"
        );
        app.key(KeyEvent::new(KeyCode::Char('g'), KeyModifiers::CONTROL));
        assert!(!app.framed());
    }

    #[test]
    fn clicking_the_terminal_panel_focuses_it_without_changing_the_view() {
        use ratatui::crossterm::event::{MouseButton, MouseEvent, MouseEventKind};
        let mut app =
            super::super::scenes::capture_case("terminals-panel", crate::look::Look::default());
        let mut terminal =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(160, 36)).unwrap();
        terminal
            .draw(|frame| {
                crate::board::view::prepare(&mut app, frame.area());
                crate::board::view::render(frame, &app);
            })
            .unwrap();
        let buffer = terminal.backend().buffer();
        let (x, y) = (0..buffer.area.height)
            .find_map(|y| {
                (0..buffer.area.width)
                    .find(|x| {
                        let row: String = (*x..buffer.area.width)
                            .map(|x| buffer[(x, y)].symbol())
                            .collect();
                        row.starts_with("On branch fix/spinner")
                    })
                    .map(|x| (x, y))
            })
            .expect("terminal output is visible");
        let selected = app.selected_terminal().unwrap().1.id.clone();
        let offset = app.scrolls.offset(crate::config::Pane::Replies);
        assert!(app.terminals.typing().is_none());
        app.mouse(
            MouseEvent {
                kind: MouseEventKind::Down(MouseButton::Left),
                column: x,
                row: y,
                modifiers: KeyModifiers::NONE,
            },
            std::time::Instant::now(),
        );
        assert_eq!(
            app.terminals.typing(),
            Some(selected.as_str()),
            "click focuses the selected terminal"
        );
        assert_eq!(app.scrolls.offset(crate::config::Pane::Replies), offset);
    }

    #[test]
    fn dragging_terminal_text_copies_the_visible_selection_on_release() {
        use ratatui::crossterm::event::{MouseButton, MouseEvent, MouseEventKind};
        let mut app =
            super::super::scenes::capture_case("terminals-panel", crate::look::Look::default());
        let mut terminal =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(160, 36)).unwrap();
        terminal
            .draw(|frame| {
                crate::board::view::prepare(&mut app, frame.area());
                crate::board::view::render(frame, &app);
            })
            .unwrap();
        let buffer = terminal.backend().buffer();
        let (x, y) = (0..buffer.area.height)
            .find_map(|y| {
                (0..buffer.area.width)
                    .find(|x| {
                        let row: String = (*x..buffer.area.width)
                            .map(|x| buffer[(x, y)].symbol())
                            .collect();
                        row.starts_with("On branch fix/spinner")
                    })
                    .map(|x| (x, y))
            })
            .expect("terminal output is visible");
        let mouse = |app: &mut App, kind, column| {
            app.mouse(
                MouseEvent {
                    kind,
                    column,
                    row: y,
                    modifiers: KeyModifiers::NONE,
                },
                std::time::Instant::now(),
            )
        };
        mouse(&mut app, MouseEventKind::Down(MouseButton::Left), x);
        mouse(&mut app, MouseEventKind::Drag(MouseButton::Left), x + 9);
        let result = mouse(&mut app, MouseEventKind::Up(MouseButton::Left), x + 9);
        assert!(
            matches!(result, crate::board::app::Effect::Act(crate::board::app::Request::Copy { text, .. }) if text == "On branch")
        );
        let now = std::time::Instant::now();
        let click = |app: &mut App, kind, millis| {
            app.mouse(
                MouseEvent {
                    kind,
                    column: x + 1,
                    row: y,
                    modifiers: KeyModifiers::NONE,
                },
                now + std::time::Duration::from_millis(millis),
            )
        };
        click(&mut app, MouseEventKind::Down(MouseButton::Left), 0);
        click(&mut app, MouseEventKind::Up(MouseButton::Left), 1);
        click(&mut app, MouseEventKind::Down(MouseButton::Left), 100);
        let word = click(&mut app, MouseEventKind::Up(MouseButton::Left), 101);
        assert!(
            matches!(word, crate::board::app::Effect::Act(crate::board::app::Request::Copy { text, .. }) if text == "On")
        );
        click(&mut app, MouseEventKind::Down(MouseButton::Left), 200);
        let line = click(&mut app, MouseEventKind::Up(MouseButton::Left), 201);
        assert!(
            matches!(line, crate::board::app::Effect::Act(crate::board::app::Request::Copy { text, .. }) if text == "On branch fix/spinner")
        );
    }

    #[test]
    fn focused_terminal_uses_the_pane_rule_and_terminal_footer_in_every_look() {
        use tmt_cli_style::{Base, Depth, Theme};
        for (base, depth) in [
            (Base::Tmt, Depth::TrueColor),
            (Base::TmtLight, Depth::TrueColor),
            (Base::Terminal, Depth::Ansi16),
            (Base::Mono, Depth::None),
        ] {
            for scene in [
                "terminals-panel",
                "terminals-panel-focused",
                "terminals-panel-selected",
            ] {
                let mut app = super::super::scenes::capture_at(
                    scene,
                    crate::look::Look {
                        theme: Theme::new(base),
                        depth,
                    },
                    100,
                    36,
                );
                let mut terminal =
                    ratatui::Terminal::new(ratatui::backend::TestBackend::new(100, 36)).unwrap();
                terminal
                    .draw(|frame| {
                        crate::board::view::prepare(&mut app, frame.area());
                        crate::board::view::render(frame, &app);
                    })
                    .unwrap();
                let buffer = terminal.backend().buffer();
                let rows: Vec<String> = (0..36)
                    .map(|y| (0..100).map(|x| buffer[(x, y)].symbol()).collect())
                    .collect();
                let title = rows
                    .iter()
                    .find(|row| row.contains("worker · Terminal 1"))
                    .expect("panel title");
                let footer = &rows[35];
                if scene == "terminals-panel" {
                    assert!(title.starts_with("── "), "{base:?}: {title}");
                    assert!(rows.iter().any(|row| row.contains("click to type")));
                } else {
                    assert!(
                        title.starts_with("▸━ ") && title.contains("typing"),
                        "{base:?}: {title}"
                    );
                    assert!(
                        footer.contains("ctrl-g") && footer.contains("drag to copy"),
                        "{base:?}: {footer}"
                    );
                    assert!(
                        !footer.contains("q quote") && !footer.contains("y copy"),
                        "{base:?}: {footer}"
                    );
                }
                assert!(!rows.iter().any(|row| row.contains("┌──")), "no inner box");
            }
        }
    }

    #[test]
    fn ctrl_l_reaches_the_selected_terminal_as_input() {
        use crate::board::terminal_tab::stream::{
            Stream, StreamEvent,
            tests::{Fake, quick, size},
        };
        use tmt_pty_protocol::ClientMessage;

        let peer = Fake::new();
        let (events, input) = std::sync::mpsc::channel();
        let (mut app, member) = listed_board();
        app.terminal.set_connect(Box::new(move |epoch, address| {
            let events = events.clone();
            Stream::open_with(address, quick(), move |event| {
                let _ = events.send((epoch, event));
            })
        }));
        let mut listed = terminal(3, 30, false);
        listed.socket = peer.address.socket.clone();
        app.terminals.finished(
            Completed::Listed(vec![(MEMBER.into(), List::Terminals(vec![listed]))]),
            0,
        );
        select(&mut app, &member, 3);
        assert!(app.terminal_sync());
        let mut socket = peer.accept();
        socket.attach(size(80, 24), b"");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let (epoch, event) = input
                .recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
                .expect("terminal snapshot");
            let ready = matches!(event, StreamEvent::Screen(_));
            app.apply_terminal(epoch, event);
            if ready {
                break;
            }
        }
        press(&mut app, KeyCode::Enter);
        assert!(app.terminals.typing().is_some());
        app.key(KeyEvent::new(KeyCode::Char('l'), KeyModifiers::CONTROL));
        assert_eq!(socket.expect(), ClientMessage::Input(vec![0x0c]));
        app.key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL));
        assert_eq!(socket.expect(), ClientMessage::Input(vec![0x03]));
        assert!(app.notes_overlay.is_none());
        assert!(app.terminals.typing().is_some());
        app.key(KeyEvent::new(KeyCode::Char('g'), KeyModifiers::CONTROL));
        let mut screen =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(160, 36)).unwrap();
        screen
            .draw(|frame| {
                crate::board::view::prepare(&mut app, frame.area());
                crate::board::view::render(frame, &app);
            })
            .unwrap();
        let area = app.terminal.area().expect("painted terminal");
        app.mouse(
            ratatui::crossterm::event::MouseEvent {
                kind: ratatui::crossterm::event::MouseEventKind::Down(
                    ratatui::crossterm::event::MouseButton::Left,
                ),
                column: area.x,
                row: area.y,
                modifiers: KeyModifiers::NONE,
            },
            std::time::Instant::now(),
        );
        app.key(KeyEvent::new(KeyCode::Char('l'), KeyModifiers::CONTROL));
        assert_eq!(socket.expect(), ClientMessage::Input(vec![0x0c]));
    }

    #[test]
    fn a_terminal_row_has_no_recipient_and_its_stream_drops_when_the_selection_moves() {
        let (mut app, member) = listed_board();
        select(&mut app, &member, 1);
        assert_eq!(app.workspace_message_target(), None);
        assert_eq!(app.skill_recipient(), None);
        assert!(
            app.composer_projection()
                .is_none_or(|projection| projection.key.is_none())
        );
        let id = terminal(1, 0, false).id;
        assert!(app.terminal_sync());
        assert!(
            app.terminal.view(&id).is_some(),
            "the selected terminal streams"
        );
        app.workspace.selected = Some(member.clone());
        assert!(app.terminal_sync(), "moving off the row drops the stream");
        assert!(app.terminal.view(&id).is_none());
    }

    #[test]
    fn a_terminal_row_shows_mock_8s_keys() {
        let (mut app, member) = listed_board();
        select(&mut app, &member, 1);
        assert_eq!(
            crate::board::view::footer::agents_hints(&app, 200).as_deref(),
            Some("t New terminal  ⏎ Type  z Full screen  x Close  ctrl-g Back to list  ? Help")
        );
    }
}

#[test]
fn new_terminal_command_keeps_the_confirmed_terminal_and_never_replays_uncertain_submission() {
    let scratch = crate::test_support::Scratch::new("command-terminal");
    let executable = scratch.join("core");
    let terminal = format!("term_{}", "1".repeat(32));
    crate::test_support::write_ready_executable(
        &executable,
        &format!(
            r#"#!/bin/sh
request=$(cat)
printf '%s\n' "$request" >> '{}/calls'
case "$request" in
  *'"operation":"terminal.open"'*) printf '%s\n' '{{"terminalId":"{terminal}","socket":"/tmp/inert-command-terminal.sock"}}' ;;
  *'"operation":"terminal.run"'*) printf '%s\n' '{{"error":{{"code":"TERMINAL_RUN_UNCONFIRMED","message":"The command may have been submitted; do not retry automatically."}}}}'; exit 1 ;;
  *) exit 9 ;;
esac
"#,
            scratch.display()
        ),
    );
    let completed = complete(
        &Core::at(executable),
        Task::Run {
            identity: MEMBER.into(),
            terminal: None,
            command: "printf '%s' 'one value'".into(),
        },
    );
    assert!(
        matches!(&completed, Completed::Ran { opened: Some(opened), outcome: Err(message), .. } if opened.id == terminal && message.contains("do not retry"))
    );
    let calls: Vec<serde_json::Value> = std::fs::read_to_string(scratch.join("calls"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0]["operation"], "terminal.open");
    assert_eq!(calls[1]["operation"], "terminal.run");
    assert_eq!(
        calls[1]["input"],
        serde_json::json!({"identityId":MEMBER,"terminalId":terminal,"command":"printf '%s' 'one value'"})
    );
    let mut held = Terminals::default();
    let applied = held.finished(completed, 1);
    assert_eq!(applied.select, Some((MEMBER.into(), terminal.clone())));
    assert!(held.row(MEMBER, &terminal).is_some());
    assert!(held.offer(&[], None, 2).is_none());
}
