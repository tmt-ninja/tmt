//! The member frame as the board shows it (#5989): `j` fills the board with a built-in member's
//! terminal under one header row, every key but the back key is the program's, and the paused
//! and ended dialogs and header menus act through core.
use super::{
    discovery::{Address, Located, MemberTerm},
    paint,
    stream::StreamEvent,
    tab::{
        Condition, FrameHit, FrameMenu,
        tests::{built_in, tab},
    },
};
use crate::board::{
    app::{
        App, Effect, Request, TerminalOp,
        workspace::tests::{MEMBER, board},
    },
    refresh::SelectedRead,
};
use crate::look::Look;
use ratatui::{
    Terminal,
    backend::TestBackend,
    buffer::Buffer,
    crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind},
    layout::Rect,
    style::Modifier,
};
use std::time::Duration;
use tmt_pty_protocol::{ClientMessage, RelaunchKind};
use tmt_tui::components::terminal::Screen;
use unicode_width::UnicodeWidthStr;

const WIDTH: u16 = 120;
const HEIGHT: u16 = 30;

fn reader() -> App {
    let mut app = built_in(board());
    app.focus = 1;
    app.terminal = tab().0;
    text(&app);
    app
}

fn draw(app: &App, width: u16, height: u16) -> Vec<String> {
    let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
    terminal
        .draw(|frame| crate::board::view::render(frame, app))
        .unwrap();
    let buffer = terminal.backend().buffer();
    (0..height)
        .map(|y| {
            let mut line = String::new();
            let mut x = 0;
            while x < width {
                let symbol = buffer[(x, y)].symbol();
                x += symbol.width().max(1) as u16;
                line.push_str(symbol);
            }
            line
        })
        .collect()
}

fn text(app: &App) -> String {
    draw(app, WIDTH, HEIGHT).join("\n")
}

fn key(code: KeyCode, modifiers: KeyModifiers) -> KeyEvent {
    KeyEvent::new(code, modifiers)
}

fn ctrl_g() -> KeyEvent {
    key(KeyCode::Char('g'), KeyModifiers::CONTROL)
}

fn term(paused: bool, ended: Option<&str>) -> MemberTerm {
    MemberTerm {
        paused,
        ended: ended.map(str::to_owned),
        shell: false,
    }
}

fn located(app: &mut App, address: Address, term: MemberTerm) {
    app.apply_terminal_located(MEMBER, Located::Stream(address, term));
}

fn click(app: &mut App, column: u16, row: u16) -> Effect {
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

/// Where the last draw put `hit`.
fn hit_at(app: &App, wanted: &FrameHit) -> (u16, u16) {
    for y in 0..HEIGHT {
        for x in 0..WIDTH {
            if app
                .terminal
                .hit(ratatui::layout::Position::new(x, y))
                .as_ref()
                == Some(wanted)
            {
                return (x, y);
            }
        }
    }
    panic!("{wanted:?} was not drawn")
}

fn asked(effect: Effect) -> Option<TerminalOp> {
    match effect {
        Effect::Act(Request::Terminal { identity, op }) => {
            assert_eq!(identity, MEMBER);
            Some(op)
        }
        _ => None,
    }
}

/// A framed member attached to a fake supervisor, with its first screen applied.
struct Framed {
    app: App,
    peer: super::stream::tests::Peer,
    events: std::sync::mpsc::Receiver<(u64, StreamEvent)>,
    _fake: super::stream::tests::Fake,
}

impl Framed {
    fn new(snapshot: &[u8]) -> Self {
        let fake = super::stream::tests::Fake::new();
        let (sender, events) = std::sync::mpsc::channel();
        let mut tab = super::tab::Tab::default();
        tab.set_connect(Box::new(move |epoch, address| {
            let sender = sender.clone();
            super::stream::Stream::open_with(address, super::stream::tests::quick(), move |event| {
                let _ = sender.send((epoch, event));
            })
        }));
        let mut app = reader();
        app.terminal = tab;
        app.focus = 0;
        app.key(key(KeyCode::Char('j'), KeyModifiers::NONE));
        assert!(app.framed(), "j opens the frame");
        located(&mut app, fake.address.clone(), MemberTerm::default());
        assert!(app.terminal_sync());
        let mut peer = fake.accept();
        peer.attach(super::stream::tests::size(40, 6), snapshot);
        let mut framed = Self {
            app,
            peer,
            events,
            _fake: fake,
        };
        framed.screen();
        text(&framed.app);
        framed.app.terminal_sync();
        assert_eq!(
            framed.peer.expect(),
            ClientMessage::Resize(super::stream::tests::size(WIDTH, HEIGHT - 1)),
            "the program gets the board less the header row"
        );
        framed
    }

    fn screen(&mut self) {
        loop {
            let (epoch, event) = self
                .events
                .recv_timeout(Duration::from_secs(5))
                .expect("an event from the stream");
            let screen = matches!(event, StreamEvent::Screen(_));
            self.app.apply_terminal(epoch, event);
            if screen {
                return;
            }
        }
    }

    fn typed(&mut self, event: KeyEvent) -> Vec<u8> {
        self.app.key(event);
        match self.peer.expect() {
            ClientMessage::Input(bytes) => bytes,
            other => panic!("expected input, got {other:?}"),
        }
    }

    fn set_term(&mut self, term: MemberTerm) {
        let address = self.app.terminal.address(MEMBER).unwrap().clone();
        located(&mut self.app, address, term);
        text(&self.app);
    }
}

#[test]
fn j_fills_the_board_with_the_member_under_one_header_and_ctrl_g_leads_back() {
    let mut framed = Framed::new(b"hello from the agent");
    let lines = draw(&framed.app, WIDTH, HEIGHT);
    assert!(lines[0].starts_with("▌ "), "{}", lines[0]);
    for word in [
        "● connected",
        "Digest 0 held",
        "▾ Members",
        "▾ Session",
        "▾ Checklist",
        "Colab",
        "ctrl-g  Board",
    ] {
        assert!(lines[0].contains(word), "{word}: {}", lines[0]);
    }
    assert!(lines[1].starts_with("hello from the agent"), "{}", lines[1]);
    framed.app.key(ctrl_g());
    assert!(!framed.app.framed());
    assert!(
        framed.app.terminal_sync(),
        "the stream is dropped with the frame"
    );
    assert!(!text(&framed.app).contains("▾ Members"));
}

#[test]
fn every_key_but_the_back_key_is_the_programs() {
    let mut framed = Framed::new(b"hi");
    for (event, bytes) in [
        (key(KeyCode::Char('a'), KeyModifiers::NONE), b"a".to_vec()),
        (key(KeyCode::Char('j'), KeyModifiers::NONE), b"j".to_vec()),
        (key(KeyCode::Char('z'), KeyModifiers::NONE), b"z".to_vec()),
        (key(KeyCode::Char('q'), KeyModifiers::NONE), b"q".to_vec()),
        (key(KeyCode::Esc, KeyModifiers::NONE), b"\x1b".to_vec()),
        (
            key(KeyCode::Char('c'), KeyModifiers::CONTROL),
            b"\x03".to_vec(),
        ),
        (
            key(KeyCode::Char('z'), KeyModifiers::CONTROL),
            b"\x1a".to_vec(),
        ),
        (
            key(KeyCode::PageUp, KeyModifiers::NONE),
            b"\x1b[5~".to_vec(),
        ),
    ] {
        assert_eq!(framed.typed(event), bytes, "{event:?}");
    }
    framed.app.paste("pasted");
    assert!(
        matches!(framed.peer.expect(), ClientMessage::Input(bytes) if bytes.ends_with(b"pasted") || bytes.windows(6).any(|w| w == b"pasted"))
    );
    framed.app.key(ctrl_g());
    assert!(
        !framed.app.framed(),
        "Ctrl-g is the board's, never the program's"
    );
}

#[test]
fn a_bound_back_key_replaces_ctrl_g_and_shows_on_the_header() {
    let mut app = crate::board::app::workspace::tests::configured_member(
        "[bind]\n'alt-b' = 'member-back'\n",
        serde_json::json!({"id": MEMBER, "name": "worker", "pane": {"location": {"host": "pty"}}}),
    );
    app.terminal = tab().0;
    app.focus = 0;
    app.key(key(KeyCode::Char('j'), KeyModifiers::NONE));
    assert!(app.framed());
    assert!(text(&app).lines().next().unwrap().contains("alt-b  Board"));
    app.key(key(KeyCode::Char('b'), KeyModifiers::ALT));
    assert!(!app.framed());
}

#[test]
fn a_board_resize_gives_the_program_the_new_room_under_the_header() {
    let mut framed = Framed::new(b"x");
    draw(&framed.app, 80, 20);
    framed.app.terminal_sync();
    assert_eq!(
        framed.peer.expect(),
        ClientMessage::Resize(super::stream::tests::size(80, 19))
    );
}

#[test]
fn a_paused_member_shows_its_dialog_and_resume_asks_core() {
    let mut framed = Framed::new(b"x");
    framed.set_term(term(true, None));
    let screen = text(&framed.app);
    assert!(
        screen.contains("Member paused") && screen.contains("■ paused"),
        "{screen}"
    );
    // The dialog has the keys now: nothing reaches the stopped program.
    assert_eq!(
        framed.app.key(key(KeyCode::Char('a'), KeyModifiers::NONE)),
        Effect::None
    );
    assert!(framed.peer.quiet());
    assert_eq!(
        asked(framed.app.key(key(KeyCode::Enter, KeyModifiers::NONE))),
        Some(TerminalOp::Resume)
    );
    framed.app.key(key(KeyCode::Esc, KeyModifiers::NONE));
    let header = draw(&framed.app, WIDTH, HEIGHT).remove(0);
    assert!(
        !text(&framed.app).contains("Member paused"),
        "Esc closes the dialog"
    );
    assert!(
        header.contains("■ paused"),
        "the header keeps the state: {header}"
    );
    let (x, y) = hit_at(&framed.app, &FrameHit::Resume);
    assert_eq!(
        asked(click(&mut framed.app, x, y)),
        Some(TerminalOp::Resume)
    );
    // Resumed: the dialog may come back the next time the member is stopped.
    framed.set_term(term(false, None));
    framed.set_term(term(true, None));
    assert!(text(&framed.app).contains("Member paused"));
}

#[test]
fn an_ended_agent_offers_resume_new_shell_and_back() {
    let mut framed = Framed::new(b"x");
    framed.set_term(term(false, Some("exit 0")));
    let screen = text(&framed.app);
    for word in [
        "Agent ended",
        "exit 0",
        "Resume the last session",
        "Start a new session",
        "Open a shell here",
        "○ not connected",
    ] {
        assert!(screen.contains(word), "{word}: {screen}");
    }
    let press = |framed: &mut Framed, code| asked(framed.app.key(key(code, KeyModifiers::NONE)));
    assert_eq!(
        press(&mut framed, KeyCode::Enter),
        Some(TerminalOp::Relaunch(RelaunchKind::Resume))
    );
    assert_eq!(
        press(&mut framed, KeyCode::Char('n')),
        Some(TerminalOp::Relaunch(RelaunchKind::New))
    );
    assert_eq!(
        press(&mut framed, KeyCode::Char('s')),
        Some(TerminalOp::Relaunch(RelaunchKind::Shell))
    );
    framed.app.key(ctrl_g());
    assert!(!framed.app.framed(), "the back key works over a dialog too");
}

#[test]
fn a_failed_relaunch_shows_its_reason_in_the_dialog() {
    let mut framed = Framed::new(b"x");
    framed.set_term(term(false, Some("exit 1")));
    framed
        .app
        .finished(Err("No remembered session for this member.".into()));
    assert!(text(&framed.app).contains("No remembered session"));
}

#[test]
fn the_session_menu_opens_with_the_mouse_and_offers_only_what_applies() {
    let mut framed = Framed::new(b"x");
    let (x, y) = hit_at(&framed.app, &FrameHit::Menu(FrameMenu::Session));
    click(&mut framed.app, x, y);
    let screen = text(&framed.app);
    assert!(screen.contains("Continue (not paused now)"), "{screen}");
    let entries = framed.app.menu_entries(FrameMenu::Session);
    assert!(
        entries.iter().all(|row| row.hit().is_none()),
        "a running agent has nothing to start"
    );
    framed.app.key(key(KeyCode::Esc, KeyModifiers::NONE));
    assert!(framed.app.terminal.menu().is_none());
    framed.set_term(term(false, Some("exit 0")));
    framed.app.key(key(KeyCode::Esc, KeyModifiers::NONE));
    let entries = framed.app.menu_entries(FrameMenu::Session);
    assert_eq!(
        entries[0].hit(),
        Some(&FrameHit::Relaunch(RelaunchKind::Resume))
    );
    assert_eq!(
        entries[1].hit(),
        Some(&FrameHit::Relaunch(RelaunchKind::New))
    );
    assert_eq!(entries[3].hit(), None, "nothing to continue");
}

#[test]
fn the_colab_button_and_the_members_menu_act() {
    let mut framed = Framed::new(b"x");
    let (x, y) = hit_at(&framed.app, &FrameHit::Colab);
    assert_eq!(asked(click(&mut framed.app, x, y)), Some(TerminalOp::Colab));
    let (x, y) = hit_at(&framed.app, &FrameHit::Menu(FrameMenu::Members));
    click(&mut framed.app, x, y);
    let screen = text(&framed.app);
    assert!(screen.contains("Back to board"), "{screen}");
    let (x, y) = hit_at(&framed.app, &FrameHit::Back);
    click(&mut framed.app, x, y);
    assert!(!framed.app.framed());
}

#[test]
fn a_lost_stream_says_so_and_enter_attaches_again() {
    let mut framed = Framed::new(b"x");
    framed
        .app
        .apply_terminal(1, StreamEvent::Lost("gone".into()));
    assert!(text(&framed.app).contains("⏎ tries again"));
    framed.app.key(key(KeyCode::Enter, KeyModifiers::NONE));
    assert!(
        framed.app.terminal_view().is_none(),
        "reattached on the next pass"
    );
}

#[test]
fn only_the_framed_member_is_read_and_the_talk_pane_has_no_terminal() {
    let mut app = reader();
    located(
        &mut app,
        super::tab::tests::address("a"),
        MemberTerm::default(),
    );
    assert!(!text(&app).contains("Terminal"), "no Chat/Terminal chips");
    assert!(
        app.terminal_locate().is_none(),
        "nothing is read without the frame"
    );
    app.open_member_frame(MEMBER);
    assert!(matches!(
        app.selected_read(),
        Some(SelectedRead::TerminalStream(id)) if id == MEMBER
    ));
}

#[test]
fn the_screen_is_dim_under_a_dialog() {
    let mut framed = Framed::new(b"agent");
    framed.set_term(term(true, None));
    let mut terminal = Terminal::new(TestBackend::new(WIDTH, HEIGHT)).unwrap();
    terminal
        .draw(|frame| crate::board::view::render(frame, &framed.app))
        .unwrap();
    assert!(
        terminal.backend().buffer()[(0, 1)]
            .modifier
            .contains(Modifier::DIM)
    );
    assert!(matches!(
        framed.app.terminal_view().unwrap().condition,
        Condition::Live
    ));
}

fn buffer(width: u16, height: u16) -> Buffer {
    Buffer::empty(Rect::new(0, 0, width, height))
}

fn row(buffer: &Buffer, y: u16) -> String {
    let mut text = String::new();
    let mut x = 0;
    while x < buffer.area.width {
        let symbol = buffer[(x, y)].symbol();
        x += symbol.width().max(1) as u16;
        text.push_str(symbol);
    }
    text.trim_end().to_owned()
}

#[test]
fn a_screen_is_cut_to_a_smaller_pane_and_leaves_a_bigger_one_blank() {
    let app = reader();
    let mut screen = Screen::new(10, 3);
    screen.feed(b"0123456789\r\nabcdefghij\r\nXYZ");
    let frame = screen.frame();
    // Smaller than the screen in both directions.
    let mut small = buffer(6, 2);
    paint::cells(&mut small, Rect::new(0, 0, 6, 2), &frame, false, app.look());
    assert_eq!(
        (row(&small, 0), row(&small, 1)),
        ("012345".into(), "abcdef".into())
    );
    // Equal.
    let mut equal = buffer(10, 3);
    paint::cells(
        &mut equal,
        Rect::new(0, 0, 10, 3),
        &frame,
        false,
        app.look(),
    );
    assert_eq!(row(&equal, 2), "XYZ");
    assert_eq!(row(&equal, 0), "0123456789");
    // Larger: the rest of the pane is untouched.
    let mut large = buffer(14, 5);
    paint::cells(
        &mut large,
        Rect::new(2, 1, 12, 4),
        &frame,
        false,
        app.look(),
    );
    assert_eq!(row(&large, 1), "  0123456789");
    assert_eq!(row(&large, 4), "", "below the screen nothing is drawn");
}

#[test]
fn a_wide_character_is_drawn_whole_or_not_at_all() {
    let app = reader();
    let mut screen = Screen::new(6, 1);
    screen.feed("ab你好".as_bytes());
    let frame = screen.frame();
    let mut whole = buffer(6, 1);
    paint::cells(&mut whole, Rect::new(0, 0, 6, 1), &frame, false, app.look());
    assert_eq!(row(&whole, 0), "ab你好");
    // The pane ends between the two columns of 好: it is left out, not cut.
    let mut cut = buffer(5, 1);
    paint::cells(&mut cut, Rect::new(0, 0, 5, 1), &frame, false, app.look());
    assert_eq!(row(&cut, 0), "ab你");
    let mut narrow = buffer(3, 1);
    paint::cells(
        &mut narrow,
        Rect::new(0, 0, 3, 1),
        &frame,
        false,
        app.look(),
    );
    assert_eq!(row(&narrow, 0), "ab");
}

#[test]
fn the_program_sets_the_colours_and_a_lost_stream_dims_them() {
    // Pinned, never `app.look()`: that reads NO_COLOR and COLORTERM of the process.
    let look = Look::default();
    let mut screen = Screen::new(12, 1);
    screen.feed(b"\x1b[31mred\x1b[0m \x1b[1mbold\x1b[0m");
    let frame = screen.frame();
    let mut live = buffer(12, 1);
    paint::cells(&mut live, Rect::new(0, 0, 12, 1), &frame, false, look);
    assert_eq!(live[(0, 0)].fg, ratatui::style::Color::Indexed(1));
    assert!(live[(4, 0)].modifier.contains(Modifier::BOLD));
    assert!(!live[(0, 0)].modifier.contains(Modifier::DIM));
    let mut dim = buffer(12, 1);
    paint::cells(&mut dim, Rect::new(0, 0, 12, 1), &frame, true, look);
    assert_eq!(dim[(0, 0)].fg, ratatui::style::Color::Indexed(1));
    assert!(dim[(0, 0)].modifier.contains(Modifier::DIM));
    assert!(dim[(4, 0)].modifier.contains(Modifier::BOLD));
}

#[test]
fn no_colour_leaves_the_program_colours_unpainted() {
    let look = Look {
        depth: tmt_cli_style::Depth::None,
        ..Look::default()
    };
    let mut screen = Screen::new(12, 1);
    screen.feed(b"\x1b[31mred\x1b[0m \x1b[1mbold\x1b[0m");
    let mut drawn = buffer(12, 1);
    paint::cells(
        &mut drawn,
        Rect::new(0, 0, 12, 1),
        &screen.frame(),
        false,
        look,
    );
    assert_eq!(drawn[(0, 0)].fg, ratatui::style::Color::Reset);
    assert!(drawn[(4, 0)].modifier.contains(Modifier::BOLD));
}

#[test]
fn a_menu_owns_every_cell_it_covers() {
    let mut framed = Framed::new(b"$ cargo test --workspace and a long line under the menu");
    let (x, y) = hit_at(&framed.app, &FrameHit::Menu(FrameMenu::Session));
    click(&mut framed.app, x, y);
    for line in draw(&framed.app, 60, 36).iter().skip(1).take(6) {
        let inside = line.split('│').nth(1).unwrap_or_default();
        assert!(
            !inside.contains("cargo") && !inside.contains("workspace"),
            "{line}"
        );
    }
}

#[test]
fn a_box_title_is_followed_by_its_rule() {
    let mut framed = Framed::new(b"x");
    framed.app.terminal.set_menu(Some(FrameMenu::Session));
    let lines = draw(&framed.app, 60, 36);
    assert!(lines[1].contains("Session ──"), "{}", lines[1]);
}

#[test]
fn the_header_says_connecting_until_a_screen_arrives_and_reconnecting_while_it_retries() {
    for (scene, words) in [
        ("frame-connecting", "◌ connecting…"),
        ("frame-reconnecting", "◌ reconnecting…"),
        ("frame-live", "● connected"),
    ] {
        let app = super::scenes::capture_case(scene, Look::default());
        let header = draw(&app, WIDTH, HEIGHT).remove(0);
        assert!(header.contains(words), "{scene}: {header}");
        if words != "● connected" {
            assert!(!header.contains("connected"), "{scene}: {header}");
        }
    }
}

#[test]
fn the_members_menu_lists_the_roster_with_dots_and_offers_the_next_member_needing_you() {
    let app = super::scenes::capture_case("frame-members-menu", Look::default());
    let lines = draw(&app, WIDTH, HEIGHT);
    let menu: Vec<_> = lines[1..12]
        .iter()
        .map(|line| line.trim_end().to_owned())
        .collect();
    let menu = menu.join("\n");
    for row in ["› ✗ builder", "◌ planner", "◆ reviewer", "○ scribe"] {
        assert!(menu.contains(row), "{row}:\n{menu}");
    }
    assert!(
        !menu.contains("worker"),
        "the framed member is on screen already:\n{menu}"
    );
    for row in [
        "Back to board",
        "Next member needing you",
        "n",
        "↑↓ select · ⏎ choose · Esc close",
    ] {
        assert!(menu.contains(row), "{row}:\n{menu}");
    }
    // After worker the names wrap to builder, which is blocked.
    assert_eq!(
        app.next_member_needing_you().as_deref(),
        Some("44444444-4444-4444-8444-444444444402")
    );
}

#[test]
fn the_checklist_menu_shows_open_items_a_collapsed_done_count_and_add_item() {
    let app = super::scenes::capture_case("frame-checklist-menu", Look::default());
    let rows = app.menu_entries(FrameMenu::Checklist);
    let open = rows
        .iter()
        .filter(|row| {
            matches!(
                row,
                super::board::MenuRow::Choice {
                    mark: Some(super::board::Mark::Open),
                    ..
                }
            )
        })
        .count();
    assert_eq!(open, 3);
    assert!(rows.contains(&super::board::MenuRow::Note("▸ Done 2".into())));
    assert_eq!(
        rows.last().and_then(|row| row.hit()),
        Some(&FrameHit::AddItem)
    );
    let screen = text(&app);
    assert!(screen.contains("☐ Fix the startup test"), "{screen}");
    assert!(
        !screen.contains("Rebase on main"),
        "done items stay collapsed: {screen}"
    );
}
