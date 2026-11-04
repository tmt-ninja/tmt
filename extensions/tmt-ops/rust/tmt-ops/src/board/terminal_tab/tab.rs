//! The member frame's stream state (#5989): where each built-in-host member's stream was found,
//! which member fills the board, and the one open stream with the screen it last drew. Nothing
//! here paints or reads a socket; the board loop calls [`Tab::sync`] each pass, and the events the
//! stream thread sends come back through [`Tab::apply`].
use super::{
    board::Dialog,
    discovery::{Address, Located, MemberTerm},
    stream::{Stream, StreamEvent},
};
use ratatui::layout::{Position, Rect};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    sync::Arc,
    time::Duration,
};
use tmt_pty_protocol::RelaunchKind;
use tmt_pty_protocol::{Eviction, Exit, Refusal, Size};
use tmt_tui::components::terminal::{Frame as Screenful, Modes, Occupant};

/// How long a member with no stream is believed before core is asked again.
const NO_STREAM_FOR_MS: u64 = 60_000;
/// How long a failed answer waits before core is asked again.
const FAILED_FOR_MS: u64 = 10_000;
/// While a member fills the board, how old its answer may get: paused, ended and a relaunched
/// shell are read from core this often, a bounded read only while the frame is open.
const FRAMED_FOR_MS: u64 = 1_000;

/// Opens the stream for one wanted terminal; the epoch tags every event it sends back.
pub(in crate::board) type Connect = Box<dyn Fn(u64, Address) -> Stream>;

/// What the open stream is doing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) enum Condition {
    /// The first attempt is `1`; a higher one is a retry after the stream was lost.
    Connecting {
        attempt: u32,
    },
    Live,
    /// The program ended; the kept terminal stays connected for a relaunch.
    Exited(Exit),
    Evicted(Eviction),
    Refused(Refusal),
    Lost(String),
}

impl Condition {
    /// The connection is over for now: only opening the frame again tries again.
    pub(in crate::board) fn ended(&self) -> bool {
        matches!(self, Self::Evicted(_) | Self::Refused(_) | Self::Lost(_))
    }
}

/// A header menu; menus open only with the mouse.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::board) enum FrameMenu {
    Members,
    Session,
    Checklist,
}

/// What a click on the frame's header, a menu row or a dialog choice does.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) enum FrameHit {
    Back,
    Menu(FrameMenu),
    Resume,
    Relaunch(RelaunchKind),
    Colab,
    Member(String),
    Checklist,
    Dismiss(Dialog),
}

/// What the frame shows of one terminal.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct View {
    pub condition: Condition,
    /// The last screen the program drew, kept while the stream reconnects or after it ended.
    pub screen: Option<Arc<Screenful>>,
}

struct Seen {
    located: Located,
    at_ms: u64,
    /// The address is still used, but core is asked again: the stream it names may be gone.
    stale: bool,
}

struct Open {
    identity: String,
    address: Address,
    epoch: u64,
    view: View,
    /// The window this viewer last gave the terminal.
    window: Option<Size>,
    /// Dropping it detaches from the supervisor.
    stream: Stream,
}

#[derive(Default)]
pub(in crate::board) struct Tab {
    seen: HashMap<String, Seen>,
    /// The member that fills the board. Keys go to its program, byte for byte.
    framed: Option<String>,
    connect: Option<Connect>,
    open: Option<Open>,
    epoch: u64,
    /// Where the last frame drew the screen, which is the size the program is given.
    area: Cell<Option<Rect>>,
    /// Where the last frame put the real cursor for the program.
    caret: Cell<Option<Caret>>,
    /// A drag over the screen, anchor then head, in screen cells. It belongs to the open stream.
    selection: Option<((u16, u16), (u16, u16))>,
    /// The dialog Esc closed; it stays closed until that state ends.
    dismissed: Option<Dialog>,
    menu: Option<FrameMenu>,
    /// The highlighted row of the open menu or dialog.
    cursor: usize,
    /// Where the last frame drew each clickable thing.
    hits: RefCell<Vec<(Rect, FrameHit)>>,
}

/// The real cursor: on the program's cursor cell, so an input method draws uncommitted text
/// there. Hidden when the program hides its cursor, but still moved.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::board) struct Caret {
    pub at: ratatui::layout::Position,
    pub shown: bool,
}

impl Tab {
    pub(in crate::board) fn set_connect(&mut self, connect: Connect) {
        self.connect = Some(connect);
    }

    /// The stream core named for `identity`, when it named one.
    pub(in crate::board) fn address(&self, identity: &str) -> Option<&Address> {
        match &self.seen.get(identity)?.located {
            Located::Stream(address, _) => Some(address),
            _ => None,
        }
    }

    /// What core last said the member's terminal runs: paused, ended, or a relaunched shell.
    pub(in crate::board) fn member_term(&self, identity: &str) -> Option<MemberTerm> {
        match &self.seen.get(identity)?.located {
            Located::Stream(_, term) => Some(term.clone()),
            _ => None,
        }
    }

    /// Core has not answered for `identity`, or its answer is old enough to ask again.
    pub(in crate::board) fn needs_locating(&self, identity: &str, now_ms: u64) -> bool {
        self.seen.get(identity).is_none_or(|seen| {
            seen.stale
                || self
                    .recheck_in(identity, seen, now_ms)
                    .is_some_and(|wait| wait.is_zero())
        })
    }

    /// How long until `identity`'s answer is old enough to ask again; none when it stays.
    pub(in crate::board) fn locating_wait(&self, identity: &str, now_ms: u64) -> Option<Duration> {
        self.seen
            .get(identity)
            .and_then(|seen| self.recheck_in(identity, seen, now_ms))
    }

    fn recheck_in(&self, identity: &str, seen: &Seen, now_ms: u64) -> Option<Duration> {
        let after = match seen.located {
            Located::Stream(..) if self.framed.as_deref() == Some(identity) => FRAMED_FOR_MS,
            Located::Stream(..) => return None,
            Located::NoStream => NO_STREAM_FOR_MS,
            Located::Failed(_) => FAILED_FOR_MS,
        };
        Some(Duration::from_millis(
            (seen.at_ms + after).saturating_sub(now_ms),
        ))
    }

    pub(in crate::board) fn located(&mut self, identity: &str, located: Located, now_ms: u64) {
        if self.framed.as_deref() == Some(identity) {
            // A dismissed dialog comes back the next time its state begins.
            let term = match &located {
                Located::Stream(_, term) => term.clone(),
                _ => MemberTerm::default(),
            };
            let still = match self.dismissed {
                Some(Dialog::Paused) => term.paused,
                Some(Dialog::Ended) => term.ended.is_some(),
                None => false,
            };
            if !still {
                self.dismissed = None;
            }
        }
        self.seen.insert(
            identity.to_owned(),
            Seen {
                located,
                at_ms: now_ms,
                stale: false,
            },
        );
    }

    /// Core is asked about `identity` again on the next pass: after an action or an exit.
    pub(in crate::board) fn recheck(&mut self, identity: &str) {
        if let Some(seen) = self.seen.get_mut(identity) {
            seen.stale = true;
        }
    }

    /// The member that fills the board, if one does.
    pub(in crate::board) fn framed(&self) -> Option<&str> {
        self.framed.as_deref()
    }

    /// `identity` fills the board; core is asked again first, since its program may have changed.
    pub(in crate::board) fn open_frame(&mut self, identity: &str) {
        self.framed = Some(identity.to_owned());
        self.dismissed = None;
        self.menu = None;
        self.cursor = 0;
        self.recheck(identity);
    }

    /// Back to the board: the stream is dropped on the next pass, which detaches it.
    pub(in crate::board) fn close_frame(&mut self) {
        self.framed = None;
        self.menu = None;
        self.hits.borrow_mut().clear();
        self.area.set(None);
        self.caret.set(None);
    }

    pub(in crate::board) fn dismissed(&self) -> Option<Dialog> {
        self.dismissed
    }

    pub(in crate::board) fn dismiss(&mut self, dialog: Dialog) {
        self.dismissed = Some(dialog);
        self.cursor = 0;
    }

    pub(in crate::board) fn menu(&self) -> Option<FrameMenu> {
        self.menu
    }

    pub(in crate::board) fn set_menu(&mut self, menu: Option<FrameMenu>) {
        self.menu = menu;
        self.cursor = 0;
    }

    pub(in crate::board) fn cursor(&self) -> usize {
        self.cursor
    }

    /// Moves the highlight by `step` within `len` rows, wrapping.
    pub(in crate::board) fn move_cursor(&mut self, step: isize, len: usize) {
        if len > 0 {
            self.cursor = (self.cursor as isize + step).rem_euclid(len as isize) as usize;
        }
    }

    /// The frame being drawn starts with no clickable places.
    pub(in crate::board) fn clear_hits(&self) {
        self.hits.borrow_mut().clear();
    }

    pub(in crate::board) fn add_hit(&self, area: Rect, hit: FrameHit) {
        self.hits.borrow_mut().push((area, hit));
    }

    /// Where the header drew `menu`'s button, so the menu opens under it.
    pub(in crate::board) fn menu_anchor(&self, menu: FrameMenu) -> Option<u16> {
        self.hits
            .borrow()
            .iter()
            .find(|(_, hit)| *hit == FrameHit::Menu(menu))
            .map(|(area, _)| area.x)
    }

    /// What was drawn at `at`; the last drawn (a menu over the header) wins.
    pub(in crate::board) fn hit(&self, at: Position) -> Option<FrameHit> {
        self.hits
            .borrow()
            .iter()
            .rev()
            .find(|(area, _)| area.contains(at))
            .map(|(_, hit)| hit.clone())
    }

    /// The frame is up and its member has a stream to show.
    #[cfg(test)]
    pub(in crate::board) fn showing(&self, identity: &str) -> bool {
        self.framed.as_deref() == Some(identity) && self.address(identity).is_some()
    }

    /// What the loop should keep open: the terminal of `wanted`, or nothing.
    pub(in crate::board) fn sync(&mut self, wanted: Option<(&str, &Address)>) -> bool {
        let current = self
            .open
            .as_ref()
            .map(|open| (open.identity.as_str(), &open.address));
        if current == wanted {
            return false;
        }
        self.open = None;
        if let (Some((identity, address)), Some(connect)) = (wanted, &self.connect) {
            self.epoch += 1;
            self.open = Some(Open {
                identity: identity.to_owned(),
                address: address.clone(),
                epoch: self.epoch,
                view: View {
                    condition: Condition::Connecting { attempt: 1 },
                    screen: None,
                },
                window: None,
                stream: connect(self.epoch, address.clone()),
            });
        }
        self.selection = None;
        true
    }

    /// A press on the screen at `at` starts a new selection there.
    pub(in crate::board) fn select_from(&mut self, at: (u16, u16)) {
        self.selection = Some((at, at));
    }

    /// A drag moves the selection's head to `at`.
    pub(in crate::board) fn select_to(&mut self, at: (u16, u16)) {
        if let Some((anchor, _)) = self.selection {
            self.selection = Some((anchor, at));
        }
    }

    /// The selection in reading order, first cell then last, both included; none for a press
    /// that did not move.
    fn selected_range(&self) -> Option<((u16, u16), (u16, u16))> {
        let (anchor, head) = self.selection?;
        if anchor == head {
            return None;
        }
        let key = |(column, row): (u16, u16)| (row, column);
        Some(if key(anchor) <= key(head) {
            (anchor, head)
        } else {
            (head, anchor)
        })
    }

    /// Whether the screen cell `(column, row)` is selected.
    pub(in crate::board) fn cell_selected(&self, column: u16, row: u16) -> bool {
        self.selected_range().is_some_and(|((c0, r0), (c1, r1))| {
            (r0, c0) <= (row, column) && (row, column) <= (r1, c1)
        })
    }

    /// The selected text of the last screen, rows joined by newlines and trailing blanks cut.
    pub(in crate::board) fn selected_text(&self) -> Option<String> {
        let ((c0, r0), (c1, r1)) = self.selected_range()?;
        let screen = self.open.as_ref()?.view.screen.as_ref()?;
        let mut rows = Vec::new();
        for row in r0..=r1.min(screen.rows.saturating_sub(1)) {
            let first = if row == r0 { c0 } else { 0 };
            let last = if row == r1 {
                c1
            } else {
                screen.cols.saturating_sub(1)
            };
            let mut text = String::new();
            for column in first..=last.min(screen.cols.saturating_sub(1)) {
                match screen.cell(column, row) {
                    Some(cell) if cell.occupant == Occupant::Continuation => {}
                    Some(cell) if cell.text.is_empty() => text.push(' '),
                    Some(cell) => text.push_str(&cell.text),
                    None => break,
                }
            }
            rows.push(text.trim_end().to_owned());
        }
        let text = rows.join("\n");
        (!text.trim().is_empty()).then_some(text)
    }

    /// Bytes for the program; dropped by the stream while it is not attached.
    pub(in crate::board) fn send(&self, bytes: &[u8]) {
        if let Some(open) = &self.open {
            open.stream.input(bytes);
        }
    }

    /// The input modes the program has set on the screen last shown.
    pub(in crate::board) fn modes(&self) -> Modes {
        self.open
            .as_ref()
            .and_then(|open| open.view.screen.as_ref())
            .map(|screen| screen.modes)
            .unwrap_or_default()
    }

    /// Where the screen was drawn in the last frame.
    pub(in crate::board) fn area(&self) -> Option<Rect> {
        self.area.get()
    }

    pub(in crate::board) fn drew(&self, area: Rect) {
        self.area.set(Some(area));
    }

    /// Where the frame being drawn puts the real cursor for the program; none until painted.
    pub(in crate::board) fn caret(&self) -> Option<Caret> {
        self.caret.get()
    }

    pub(in crate::board) fn place_caret(&self, caret: Option<Caret>) {
        self.caret.set(caret);
    }

    /// The framed program is given the room its screen has (the board less the header row),
    /// when the stream opens and whenever that area changes.
    pub(in crate::board) fn fit_window(&mut self) {
        if self.framed.is_none() {
            return;
        }
        let (Some(open), Some(area)) = (self.open.as_mut(), self.area.get()) else {
            return;
        };
        let Ok(size) = Size::new(area.width, area.height) else {
            return;
        };
        if open.window != Some(size) {
            open.window = Some(size);
            open.stream.resize(size);
        }
    }

    /// What the stream thread reported; events of a stream that was since replaced are dropped.
    /// An exit asks core again, so the frame learns the member ended (and later, relaunched).
    pub(in crate::board) fn apply(&mut self, epoch: u64, event: StreamEvent) -> bool {
        let Some(open) = self.open.as_mut().filter(|open| open.epoch == epoch) else {
            return false;
        };
        let identity = open.identity.clone();
        match event {
            StreamEvent::Connecting { attempt } => {
                open.view.condition = Condition::Connecting { attempt };
            }
            StreamEvent::Screen(screen) => {
                open.view.screen = Some(screen);
                open.view.condition = Condition::Live;
            }
            StreamEvent::Exited(exit) => open.view.condition = Condition::Exited(exit),
            StreamEvent::Evicted(eviction) => open.view.condition = Condition::Evicted(eviction),
            StreamEvent::Refused(refusal) => open.view.condition = Condition::Refused(refusal),
            StreamEvent::Lost(reason) => open.view.condition = Condition::Lost(reason),
        }
        if matches!(open.view.condition, Condition::Exited(_)) || open.view.condition.ended() {
            self.recheck(&identity);
        }
        true
    }

    /// The terminal of `identity` as the frame shows it, when its stream is the open one.
    pub(in crate::board) fn view(&self, identity: &str) -> Option<&View> {
        self.open
            .as_ref()
            .filter(|open| open.identity == identity)
            .map(|open| &open.view)
    }

    /// Drops the open stream so the next [`Tab::sync`] opens a fresh one, after it was lost.
    pub(in crate::board) fn reattach(&mut self) {
        if let Some(open) = self.open.take() {
            self.recheck(&open.identity);
        }
    }
}

#[cfg(test)]
pub(in crate::board) mod tests {
    use super::*;
    use crate::board::terminal_tab::stream::Timing;
    use std::{
        path::PathBuf,
        sync::{Arc, Mutex},
    };

    const ID: &str = "22222222-2222-4222-8222-222222222222";
    const OTHER: &str = "33333333-3333-4333-8333-333333333333";

    pub(in crate::board) fn address(name: &str) -> Address {
        Address {
            socket: PathBuf::from(format!("/nonexistent/tmt-terminal/{name}.sock")),
            pane: name.to_owned(),
        }
    }

    pub(in crate::board) fn stream(name: &str) -> Located {
        Located::Stream(address(name), MemberTerm::default())
    }

    /// The workspace test board with its member on the built-in host, so `j` frames it.
    pub(in crate::board) fn built_in(mut app: crate::board::app::App) -> crate::board::app::App {
        let target = app.workspace.selected.clone().unwrap();
        let workspace = &mut app.view.as_mut().unwrap().home.as_mut().unwrap().workspace;
        workspace.rows.get_mut(&target).unwrap()["pane"]["location"]["host"] =
            crate::board::new_member::model::BUILT_IN_HOST.into();
        app
    }

    /// A tab whose streams attach to nothing; `opened` lists the epochs it was asked for.
    pub(in crate::board) type Opened = Arc<Mutex<Vec<(u64, Address)>>>;

    pub(in crate::board) fn tab() -> (Tab, Opened) {
        let opened = Arc::new(Mutex::new(Vec::new()));
        let record = Arc::clone(&opened);
        let mut tab = Tab::default();
        tab.set_connect(Box::new(move |epoch, address| {
            record.lock().unwrap().push((epoch, address.clone()));
            Stream::open_with(
                address,
                Timing {
                    attempts: 1,
                    ..Timing::default()
                },
                |_| {},
            )
        }));
        (tab, opened)
    }

    fn screen(text: &str) -> Arc<Screenful> {
        let mut screen = tmt_tui::components::terminal::Screen::new(10, 2);
        screen.feed(text.as_bytes());
        Arc::new(screen.frame())
    }

    #[test]
    fn a_member_is_asked_for_until_core_answers_and_again_after_the_wait() {
        let mut tab = Tab::default();
        assert!(tab.needs_locating(ID, 0));
        tab.located(ID, Located::NoStream, 1_000);
        assert!(!tab.needs_locating(ID, 1_000 + NO_STREAM_FOR_MS - 1));
        assert!(tab.needs_locating(ID, 1_000 + NO_STREAM_FOR_MS));
        tab.located(ID, Located::Failed("boom".into()), 5_000);
        assert!(!tab.needs_locating(ID, 5_000 + FAILED_FOR_MS - 1));
        assert!(tab.needs_locating(ID, 5_000 + FAILED_FOR_MS));
        assert!(tab.address(ID).is_none(), "a failure shows no terminal");
        tab.located(ID, stream("a"), 9_000);
        assert!(
            !tab.needs_locating(ID, u64::MAX / 2),
            "an unframed stream stays"
        );
        assert_eq!(tab.locating_wait(ID, 9_000), None);
        assert_eq!(tab.address(ID), Some(&address("a")));
    }

    #[test]
    fn a_framed_member_is_read_again_every_second_and_at_once_when_opened() {
        let mut tab = Tab::default();
        tab.located(ID, stream("a"), 0);
        tab.open_frame(ID);
        assert!(tab.needs_locating(ID, 0), "opening asks core first");
        tab.located(ID, stream("a"), 10);
        assert!(!tab.needs_locating(ID, 10 + FRAMED_FOR_MS - 1));
        assert!(tab.needs_locating(ID, 10 + FRAMED_FOR_MS));
        assert_eq!(
            tab.locating_wait(ID, 10),
            Some(Duration::from_millis(FRAMED_FOR_MS))
        );
        tab.located(OTHER, stream("b"), 10);
        assert_eq!(tab.locating_wait(OTHER, 10), None, "only the framed member");
        tab.close_frame();
        assert_eq!(tab.locating_wait(ID, 10), None);
    }

    #[test]
    fn the_frame_shows_only_where_a_stream_exists() {
        let mut tab = Tab::default();
        tab.open_frame(ID);
        assert!(!tab.showing(ID), "no stream known yet");
        tab.located(ID, stream("a"), 0);
        assert!(tab.showing(ID));
        assert!(!tab.showing(OTHER));
        tab.close_frame();
        assert!(!tab.showing(ID));
    }

    #[test]
    fn the_member_term_is_what_core_said() {
        let mut tab = Tab::default();
        let term = MemberTerm {
            paused: true,
            ended: None,
            shell: false,
        };
        tab.located(ID, Located::Stream(address("a"), term.clone()), 0);
        assert_eq!(tab.member_term(ID), Some(term));
        tab.located(ID, Located::NoStream, 1);
        assert_eq!(tab.member_term(ID), None);
    }

    #[test]
    fn sync_opens_replaces_and_drops_the_one_stream() {
        let (mut tab, opened) = tab();
        let (a, b) = (address("a"), address("b"));
        assert!(!tab.sync(None), "nothing wanted, nothing open");
        assert!(tab.sync(Some((ID, &a))));
        assert!(!tab.sync(Some((ID, &a))), "the same wish changes nothing");
        assert!(tab.sync(Some((OTHER, &b))));
        assert!(tab.sync(None));
        assert!(tab.view(OTHER).is_none());
        assert_eq!(
            *opened.lock().unwrap(),
            vec![(1, a), (2, b)],
            "each open gets a new epoch"
        );
    }

    #[test]
    fn events_of_a_replaced_stream_are_dropped() {
        let (mut tab, _) = tab();
        let (a, b) = (address("a"), address("b"));
        tab.sync(Some((ID, &a)));
        tab.sync(Some((OTHER, &b)));
        assert!(!tab.apply(1, StreamEvent::Screen(screen("old"))));
        assert!(tab.view(ID).is_none());
        assert!(tab.apply(2, StreamEvent::Screen(screen("new"))));
        assert_eq!(tab.view(OTHER).unwrap().condition, Condition::Live);
        assert!(
            !tab.apply(9, StreamEvent::Lost("late".into())),
            "unknown epoch"
        );
    }

    #[test]
    fn an_exit_keeps_the_screen_asks_core_again_and_a_relaunch_is_live_again() {
        let (mut tab, _) = tab();
        let a = address("a");
        tab.located(ID, stream("a"), 0);
        tab.open_frame(ID);
        tab.located(ID, stream("a"), 0);
        tab.sync(Some((ID, &a)));
        let drawn = screen("$ ls");
        tab.apply(1, StreamEvent::Screen(drawn.clone()));
        tab.apply(1, StreamEvent::Exited(Exit::Code(0)));
        let view = tab.view(ID).unwrap();
        assert_eq!(view.condition, Condition::Exited(Exit::Code(0)));
        assert_eq!(view.screen.as_ref(), Some(&drawn));
        assert!(!view.condition.ended(), "the kept terminal stays connected");
        assert!(tab.needs_locating(ID, 1), "core is asked how it ended");
        tab.apply(1, StreamEvent::Screen(screen("again")));
        assert_eq!(tab.view(ID).unwrap().condition, Condition::Live);
    }

    #[test]
    fn a_lost_stream_is_over_until_reattached() {
        let (mut tab, opened) = tab();
        let a = address("a");
        tab.located(ID, stream("a"), 0);
        tab.sync(Some((ID, &a)));
        tab.apply(1, StreamEvent::Refused(Refusal::Full));
        assert!(tab.view(ID).unwrap().condition.ended());
        tab.reattach();
        assert!(tab.view(ID).is_none());
        tab.sync(Some((ID, &a)));
        assert_eq!(opened.lock().unwrap().len(), 2);
    }
}
