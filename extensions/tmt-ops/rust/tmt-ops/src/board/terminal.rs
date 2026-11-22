//! Terminal lifecycle: the board owns raw mode, mouse capture and the
//! alternate screen only between `Guard::enter` and restore, which also runs
//! on error, panic and TERM/HUP. A terminal left in raw mode is a defect, not a cosmetic issue.

pub(super) mod background;

use ratatui::crossterm::{
    cursor::{Hide, Show},
    event::{
        DisableBracketedPaste, DisableFocusChange, DisableMouseCapture, EnableBracketedPaste,
        EnableFocusChange, EnableMouseCapture, KeyboardEnhancementFlags,
        PopKeyboardEnhancementFlags, PushKeyboardEnhancementFlags,
    },
    execute, queue,
    terminal::{
        BeginSynchronizedUpdate, EndSynchronizedUpdate, EnterAlternateScreen, LeaveAlternateScreen,
        disable_raw_mode, enable_raw_mode, supports_keyboard_enhancement,
    },
};
use ratatui::{
    Frame, Terminal,
    backend::ClearType,
    buffer::{Cell, CellDiffOption},
    layout::{Position, Size},
    style::Modifier,
};
use std::{
    io,
    sync::{
        Arc, Once,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};

/// The terminal state the board changes. A trait so restore is testable.
pub trait Screen {
    fn enter(&mut self) -> io::Result<()>;
    fn leave(&mut self) -> io::Result<()>;
    fn enable_keyboard_enhancement(&mut self) -> io::Result<bool> {
        Ok(false)
    }
    fn query_background(&mut self) -> io::Result<tmt_cli_style::theme::background::QueryReply> {
        Ok(tmt_cli_style::theme::background::QueryReply {
            background: None,
            received: Vec::new(),
            reply: None,
        })
    }
}

/// Asks again for the mouse reports (1000/1002/1003/1015/1006). Setting a mode
/// that is already set changes nothing, so it is safe at any time; it repairs a
/// request a multiplexer, a nested client or an emulator reset has dropped, which
/// would otherwise leave the wheel to the surrounding tmux pane (copy-mode).
pub fn reassert_mouse(output: &mut impl io::Write) -> io::Result<()> {
    execute!(output, EnableMouseCapture)
}

/// Only the terminal owner changes this flag; the panic hook needs the same
/// ownership evidence as ordinary cleanup so it never pops an unowned stack.
static KEYBOARD_ACTIVE: AtomicBool = AtomicBool::new(false);
/// Same ownership rule for the modifyOtherKeys request tmux needs to tell
/// Shift+Enter from Enter.
static MODIFY_OTHER_KEYS_ACTIVE: AtomicBool = AtomicBool::new(false);

/// `CSI > 4 ; 1 m` asks for keys without a legacy encoding only (Shift+Enter,
/// Ctrl+Enter, Shift+Tab); Alt+Enter and Ctrl+letters keep their old bytes.
/// `CSI > 4 ; 0 m` releases the request.
fn write_modify_other_keys(output: &mut impl io::Write, on: bool) -> io::Result<()> {
    output.write_all(if on { b"\x1b[>4;1m" } else { b"\x1b[>4;0m" })?;
    output.flush()
}

/// Inside tmux only: one read of the server's options at start. A failure or
/// any other setting means no request.
fn tmux_shift_enter() -> bool {
    let Some(socket) = crate::effects::tmux_socket() else {
        return false;
    };
    let option = |name| crate::effects::tmux_option(&socket, name).unwrap_or_default();
    crate::effects::tmux_reports_shift_enter(
        &option("extended-keys"),
        &option("extended-keys-format"),
    )
}

#[derive(Default)]
pub struct Crossterm<'a> {
    enhanced: bool,
    /// tmux was asked for Shift+Enter (see `tmux_shift_enter`).
    shift_enter: bool,
    output: Option<io::Stdout>,
    timing_reports: Option<&'a super::timing::Reports>,
}

impl<'a> Crossterm<'a> {
    pub(super) fn with_timing_reports(reports: &'a super::timing::Reports) -> Self {
        Self {
            timing_reports: Some(reports),
            ..Self::default()
        }
    }
}

fn push_keyboard(output: &mut io::Stdout) -> io::Result<()> {
    // Mark ownership before writing: partial output also needs cleanup.
    KEYBOARD_ACTIVE.store(true, Ordering::Relaxed);
    execute!(
        output,
        PushKeyboardEnhancementFlags(KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES)
    )
}

fn request_shift_enter(output: &mut io::Stdout) -> io::Result<()> {
    // Mark ownership before writing: partial output also needs cleanup.
    MODIFY_OTHER_KEYS_ACTIVE.store(true, Ordering::Relaxed);
    write_modify_other_keys(output, true)
}

impl Screen for Crossterm<'_> {
    fn enable_keyboard_enhancement(&mut self) -> io::Result<bool> {
        // A missing/unsupported reply is a capability observation, not a failure.
        // This runs before the input reader; crossterm queries share its queue.
        self.enhanced = supports_keyboard_enhancement().unwrap_or(false);
        if self.enhanced {
            push_keyboard(self.output.as_mut().expect("terminal entered"))?;
        } else if tmux_shift_enter() {
            self.shift_enter = true;
            request_shift_enter(self.output.as_mut().expect("terminal entered"))?;
        }
        Ok(self.enhanced || self.shift_enter)
    }

    fn query_background(&mut self) -> io::Result<tmt_cli_style::theme::background::QueryReply> {
        background::query()
    }

    fn enter(&mut self) -> io::Result<()> {
        if let Some(reports) = self.timing_reports {
            reports.screen_entered();
        }
        enable_raw_mode()?;
        let output = self.output.get_or_insert_with(io::stdout);
        execute!(
            output,
            EnterAlternateScreen,
            EnableMouseCapture,
            EnableFocusChange,
            EnableBracketedPaste,
            Hide
        )?;
        if self.enhanced {
            push_keyboard(output)?;
        } else if self.shift_enter {
            request_shift_enter(output)?;
        }
        Ok(())
    }

    fn leave(&mut self) -> io::Result<()> {
        // Try every cleanup group even if one fails; report the first failure.
        let keyboard = if KEYBOARD_ACTIVE.swap(false, Ordering::Relaxed) {
            execute!(io::stdout(), PopKeyboardEnhancementFlags)
        } else {
            Ok(())
        };
        let keyboard = if MODIFY_OTHER_KEYS_ACTIVE.swap(false, Ordering::Relaxed) {
            keyboard.and(write_modify_other_keys(&mut io::stdout(), false))
        } else {
            keyboard
        };
        let screen = execute!(
            io::stdout(),
            EndSynchronizedUpdate,
            DisableBracketedPaste,
            DisableFocusChange,
            DisableMouseCapture,
            LeaveAlternateScreen,
            Show
        );
        let raw = disable_raw_mode();
        if screen.is_ok()
            && raw.is_ok()
            && let Some(reports) = self.timing_reports
        {
            reports.screen_restored();
        }
        keyboard.and(screen).and(raw)
    }
}

/// Presents each changed frame as one synchronized terminal update.
pub struct Backend<W: io::Write> {
    inner: ratatui::backend::CrosstermBackend<Shared<W>>,
    /// The same output, for synchronized updates and OSC 8 around backend writes.
    out: Shared<W>,
    caret_visible: Option<bool>,
    caret_position: Option<Position>,
    synchronized: bool,
    /// The web links this frame paints, wrapped in OSC 8 when the terminal
    /// supports them; off, no OSC 8 bytes are written.
    links: super::hyperlinks::Links,
    /// Pin Ratatui's autoresize check to the dimensions sampled for this draw.
    frame_size: Option<Size>,
    /// Fullscreen resize needs internal bookkeeping but its erase would flash.
    resizing: bool,
}

/// One output, two writers: ratatui's backend keeps its writer private.
struct Shared<W>(std::rc::Rc<std::cell::RefCell<W>>);

impl<W> Clone for Shared<W> {
    fn clone(&self) -> Self {
        Self(std::rc::Rc::clone(&self.0))
    }
}

impl<W: io::Write> io::Write for Shared<W> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.borrow_mut().write(bytes)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.0.borrow_mut().flush()
    }
}

impl<W: io::Write> Backend<W> {
    #[cfg(test)]
    pub fn new(output: W) -> Self {
        Self::with_links(output, super::hyperlinks::Links::default())
    }

    pub fn with_links(output: W, links: super::hyperlinks::Links) -> Self {
        let out = Shared(std::rc::Rc::new(std::cell::RefCell::new(output)));
        Self {
            inner: ratatui::backend::CrosstermBackend::new(out.clone()),
            out,
            caret_visible: None,
            caret_position: None,
            synchronized: false,
            links,
            frame_size: None,
            resizing: false,
        }
    }

    fn begin_update(&mut self) -> io::Result<()> {
        if !self.synchronized {
            queue!(&mut self.out, BeginSynchronizedUpdate)?;
            self.synchronized = true;
        }
        Ok(())
    }

    fn end_update(&mut self) -> io::Result<()> {
        if std::mem::take(&mut self.synchronized) {
            queue!(&mut self.out, EndSynchronizedUpdate)?;
        }
        Ok(())
    }

    fn set_caret_visibility(&mut self, visible: bool) -> io::Result<()> {
        if self.caret_visible == Some(visible) {
            return Ok(());
        }
        self.begin_update()?;
        if visible {
            ratatui::backend::Backend::show_cursor(&mut self.inner)?;
        } else {
            ratatui::backend::Backend::hide_cursor(&mut self.inner)?;
        }
        self.caret_visible = Some(visible);
        Ok(())
    }
}

impl<W: io::Write> ratatui::backend::Backend for Backend<W> {
    type Error = io::Error;

    fn draw<'a, I>(&mut self, content: I) -> io::Result<()>
    where
        I: Iterator<Item = (u16, u16, &'a ratatui::buffer::Cell)>,
    {
        let mut content = content.peekable();
        if content.peek().is_none() {
            return Ok(());
        }
        self.begin_update()?;
        // Printing cells moves the terminal cursor even when the caret target is unchanged.
        self.caret_position = None;
        if !self.links.enabled() {
            return self.inner.draw(content);
        }
        let cells: Vec<_> = content.collect();
        for (run, open) in self.links.runs(&cells) {
            if let Some(open) = &open {
                io::Write::write_all(&mut self.out, open)?;
            }
            self.inner.draw(cells[run].iter().copied())?;
            if open.is_some() {
                io::Write::write_all(&mut self.out, &super::hyperlinks::close())?;
            }
        }
        Ok(())
    }

    fn append_lines(&mut self, lines: u16) -> io::Result<()> {
        self.inner.append_lines(lines)
    }

    fn hide_cursor(&mut self) -> io::Result<()> {
        self.set_caret_visibility(false)
    }

    fn show_cursor(&mut self) -> io::Result<()> {
        self.set_caret_visibility(true)
    }

    fn get_cursor_position(&mut self) -> io::Result<ratatui::layout::Position> {
        self.inner.get_cursor_position()
    }

    fn set_cursor_position<P: Into<ratatui::layout::Position>>(
        &mut self,
        position: P,
    ) -> io::Result<()> {
        let position = position.into();
        if self.caret_position != Some(position) {
            self.begin_update()?;
            self.inner.set_cursor_position(position)?;
            self.caret_position = Some(position);
        }
        Ok(())
    }

    fn clear(&mut self) -> io::Result<()> {
        self.inner.clear()
    }

    fn clear_region(&mut self, clear_type: ClearType) -> io::Result<()> {
        if self.resizing && clear_type == ClearType::All {
            return Ok(());
        }
        self.inner.clear_region(clear_type)
    }

    fn size(&self) -> io::Result<Size> {
        match self.frame_size {
            Some(size) => Ok(size),
            None => self.inner.size(),
        }
    }

    fn window_size(&mut self) -> io::Result<ratatui::backend::WindowSize> {
        self.inner.window_size()
    }

    fn flush(&mut self) -> io::Result<()> {
        self.end_update()?;
        ratatui::backend::Backend::flush(&mut self.inner)
    }
}

/// Present a fullscreen board frame. A display invalidation forces a repaint
/// even if the dimensions are unchanged.
pub(super) fn present<W: io::Write>(
    terminal: &mut Terminal<Backend<W>>,
    display_invalidated: bool,
    paint: impl FnOnce(&mut Frame<'_>),
) -> io::Result<()> {
    present_at(terminal, terminal.size()?, display_invalidated, paint)
}

fn present_at<W: io::Write>(
    terminal: &mut Terminal<Backend<W>>,
    size: Size,
    display_invalidated: bool,
    paint: impl FnOnce(&mut Frame<'_>),
) -> io::Result<()> {
    if display_invalidated || terminal.current_buffer_mut().area.as_size() != size {
        let backend = terminal.backend_mut();
        backend.caret_visible = None;
        backend.caret_position = None;
        backend.resizing = true;
        let resized = terminal.resize(size.into());
        terminal.backend_mut().resizing = false;
        resized?;

        // Diff metadata forces real blanks to be written. Keep the sentinel
        // symbol blank so Ratatui won't emit an extra space over a VS16
        // continuation cell, which can wrap or scroll at the bottom edge.
        let mut sentinel = Cell::EMPTY;
        sentinel.modifier = Modifier::SLOW_BLINK;
        sentinel.set_diff_option(CellDiffOption::Skip);
        terminal.current_buffer_mut().content.fill(sentinel);
        terminal.swap_buffers();
    }

    terminal.backend_mut().frame_size = Some(size);
    let drawn = terminal.draw(paint).map(|_| ());
    let backend = terminal.backend_mut();
    backend.frame_size = None;
    if drawn.is_err() {
        // A write can fail before Ratatui reaches the backend's flush.
        let _ = ratatui::backend::Backend::flush(backend);
    }
    drawn
}

/// Restores the screen exactly once: on `restore`, or when dropped, which
/// includes unwinding from a panic.
pub struct Guard<S: Screen> {
    screen: S,
    active: bool,
}

impl<S: Screen> Guard<S> {
    pub fn enter(mut screen: S) -> io::Result<Self> {
        if let Err(error) = screen.enter() {
            // Undo a partial entry (for example raw mode without the screen).
            let _ = screen.leave();
            return Err(error);
        }
        Ok(Self {
            screen,
            active: true,
        })
    }

    pub fn enable_keyboard_enhancement(&mut self) -> io::Result<bool> {
        self.screen.enable_keyboard_enhancement()
    }

    /// Restore before stopping, then re-enter with the already observed
    /// capability. The input reader may still exist, so resumption never queries.
    pub fn suspend(&mut self, pause: impl FnOnce() -> io::Result<()>) -> io::Result<()> {
        self.restore()?;
        let paused = pause();
        if let Err(error) = self.screen.enter() {
            let _ = self.screen.leave();
            return Err(error);
        }
        self.active = true;
        paused
    }

    pub fn query_background(&mut self) -> io::Result<tmt_cli_style::theme::background::QueryReply> {
        self.screen.query_background()
    }

    pub fn restore(&mut self) -> io::Result<()> {
        if !std::mem::replace(&mut self.active, false) {
            return Ok(());
        }
        self.screen.leave()
    }
}

impl<S: Screen> Drop for Guard<S> {
    fn drop(&mut self) {
        let _ = self.restore();
    }
}

/// The panic message would otherwise be printed into the alternate screen and
/// lost; restore first, retain a short private note, then report on the normal screen.
pub fn restore_before_panic_reports() {
    static INSTALL: Once = Once::new();
    INSTALL.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            let _ = Crossterm::default().leave();
            use std::io::Write;
            match crash_note(info) {
                Ok(path) => {
                    let _ = writeln!(
                        tmt_cli_style::stream::stderr(),
                        "Ops crash note: {}",
                        path.display()
                    );
                }
                Err(error) => {
                    let _ = writeln!(
                        tmt_cli_style::stream::stderr(),
                        "Ops crash note unavailable: {error}"
                    );
                }
            }
            previous(info);
        }));
    });
}

/// One replaceable note bounds retained crash data; use the same private,
/// atomic cache publisher as the rest of Ops. Never let reporting panic again.
fn crash_note(info: &std::panic::PanicHookInfo<'_>) -> io::Result<std::path::PathBuf> {
    use std::fmt::Write;
    let path = crate::cache::directory("crashes")
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no cache directory"))?
        .join("latest.txt");
    let message = info
        .payload()
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str))
        .unwrap_or("non-text panic");
    let mut note = format!("Ops board crash · pid {}\n", std::process::id());
    if let Some(at) = info.location() {
        let _ = writeln!(note, "{}:{}:{}", at.file(), at.line(), at.column());
    }
    note.extend(message.chars().take(512).flat_map(char::escape_default));
    note.push('\n');
    crate::cache::replace(&path, note.as_bytes())?;
    Ok(path)
}

/// Record signals for the board loop: TERM/HUP restore and exit; TSTP restores,
/// pauses and resumes the same board. Raw mode delivers Ctrl-C as a key.
pub fn stop_requested() -> io::Result<Arc<AtomicUsize>> {
    let flag = Arc::new(AtomicUsize::new(0));
    for signal in [
        signal_hook::consts::SIGTERM,
        signal_hook::consts::SIGHUP,
        signal_hook::consts::SIGTSTP,
    ] {
        signal_hook::flag::register_usize(signal, Arc::clone(&flag), signal as usize)?;
    }
    Ok(flag)
}

pub fn stop_signal(flag: &AtomicUsize) -> Option<i32> {
    match flag.load(Ordering::Relaxed) {
        0 => None,
        signal => i32::try_from(signal).ok(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, rc::Rc};

    #[derive(Clone, Default)]
    struct Fake {
        log: Rc<RefCell<Vec<&'static str>>>,
        fail_enter: bool,
        fail_query: bool,
        fail_keyboard: bool,
    }

    impl Screen for Fake {
        fn enable_keyboard_enhancement(&mut self) -> io::Result<bool> {
            self.log.borrow_mut().push("keyboard");
            if self.fail_keyboard {
                Err(io::Error::other("keyboard failed"))
            } else {
                Ok(true)
            }
        }
        fn query_background(&mut self) -> io::Result<tmt_cli_style::theme::background::QueryReply> {
            self.log.borrow_mut().push("query");
            if self.fail_query {
                return Err(io::Error::other("query failed"));
            }
            Ok(tmt_cli_style::theme::background::QueryReply {
                background: None,
                received: Vec::new(),
                reply: None,
            })
        }
        fn enter(&mut self) -> io::Result<()> {
            self.log.borrow_mut().push("enter");
            if self.fail_enter {
                return Err(io::Error::other("no terminal"));
            }
            Ok(())
        }
        fn leave(&mut self) -> io::Result<()> {
            self.log.borrow_mut().push("leave");
            Ok(())
        }
    }

    #[test]
    fn the_modify_other_keys_request_is_mode_one_and_its_reset_is_mode_zero() {
        let mut on = Vec::new();
        write_modify_other_keys(&mut on, true).unwrap();
        assert_eq!(on, b"\x1b[>4;1m");
        let mut off = Vec::new();
        write_modify_other_keys(&mut off, false).unwrap();
        assert_eq!(off, b"\x1b[>4;0m");
    }

    #[derive(Clone, Default)]
    struct Sink(Rc<RefCell<Vec<u8>>>);
    impl io::Write for Sink {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0.borrow_mut().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn resize_and_resume_repaint_without_erasing_the_display() {
        use ratatui::{backend::Backend as _, style::Style};
        use tmt_tui::components::terminal::Screen as Display;

        let sink = Sink::default();
        let mut backend = Backend::new(sink.clone());
        backend.frame_size = Some(Size::new(8, 3));
        let mut terminal = Terminal::new(backend).unwrap();
        for (width, height, resumed) in [(6, 3, false), (6, 2, false), (8, 3, false), (8, 3, true)]
        {
            let size = Size::new(width, height);
            let paint = |frame: &mut Frame<'_>| {
                assert_eq!(frame.area().as_size(), size);
                let buffer = frame.buffer_mut();
                buffer.set_string(0, 0, "Ops", Style::default());
                buffer.set_string(width - 2, 0, "界", Style::default());
                buffer.set_string(width - 2, 1, "⚡️", Style::default());
                buffer[(0, height - 1)].set_style(Style::new().add_modifier(Modifier::UNDERLINED));
                frame.set_cursor_position((2, 0));
            };
            sink.0.borrow_mut().clear();
            present_at(&mut terminal, size, resumed, paint).unwrap();
            let bytes = sink.0.borrow().clone();
            assert!(
                !bytes.windows(4).any(|sequence| sequence == b"\x1b[2J"),
                "resize to {width}x{height} erased the display: {bytes:?}"
            );
            assert!(
                !bytes.windows(4).any(|sequence| sequence == b"\x1b[5m"),
                "comparison cell leaked: {bytes:?}"
            );

            let mut stale = Display::new(width, height);
            for row in 1..=height {
                stale.feed(format!("\x1b[{row};1H{}", "x".repeat(width.into())).as_bytes());
            }
            stale.feed(&bytes);
            let mut clean = Display::new(width, height);
            clean.feed(format!("Ops{}界", " ".repeat(usize::from(width - 5))).as_bytes());
            for row in 2..=height {
                clean.feed(format!("\x1b[{row};1H").as_bytes());
                if row == height {
                    clean.feed(b"\x1b[4m \x1b[24m");
                } else {
                    clean.feed(b" ");
                }
                let blanks = if row == 2 { width - 3 } else { width - 1 };
                clean.feed(" ".repeat(blanks.into()).as_bytes());
                if row == 2 {
                    clean.feed("⚡️".as_bytes());
                }
            }
            clean.feed(b"\x1b[1;3H");
            assert_eq!(stale.frame(), clean.frame(), "{width}x{height}");

            sink.0.borrow_mut().clear();
            present_at(&mut terminal, size, false, paint).unwrap();
            assert!(sink.0.borrow().is_empty(), "the next draw is unchanged");

            // Clear handling is normal again on every later draw.
            sink.0.borrow_mut().clear();
            terminal.backend_mut().clear_region(ClearType::All).unwrap();
            assert_eq!(&*sink.0.borrow(), b"\x1b[2J");
        }
    }

    #[test]
    fn ctrl_l_restores_erased_board_while_opening_the_checklist() {
        use crate::board::{
            BoardEvent, app::workspace::tests::board, session, view, workspace::OpsTarget,
        };
        use ratatui::crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
        use std::sync::mpsc::channel;
        use tmt_tui::components::terminal::Screen as Display;

        let mut app = board();
        let member = app
            .workspace_rows()
            .iter()
            .position(|row| matches!(row.target, OpsTarget::Member { .. }))
            .unwrap();
        app.select(member);
        app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        let size = Size::new(160, 36);
        let sink = Sink::default();
        let mut backend = Backend::new(sink.clone());
        backend.frame_size = Some(size);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut display = Display::new(size.width, size.height);
        let (events, input) = channel();
        events
            .send(BoardEvent::Input(Event::Key(KeyEvent::new(
                KeyCode::Char('l'),
                KeyModifiers::CONTROL,
            ))))
            .unwrap();
        events.send(BoardEvent::InputClosed).unwrap();
        let mut first_frame = true;
        session(
            &mut app,
            &AtomicUsize::new(0),
            &input,
            |_, _, _, _| {},
            |_, _| {},
            |_| {},
            |_| {},
            |_| {},
            |_| {},
            || Ok(()),
            || Ok(()),
            None,
            |app, invalidated| {
                present_at(&mut terminal, size, invalidated, |frame| {
                    view::prepare(app, frame.area());
                    view::render(frame, app);
                })?;
                let bytes = std::mem::take(&mut *sink.0.borrow_mut());
                assert!(!bytes.windows(4).any(|part| part == b"\x1b[2J"));
                display.feed(&bytes);
                if std::mem::take(&mut first_frame) {
                    assert!(display.frame().row_text(0).contains("OPS"));
                    display.feed(b"\x1b[2J");
                    assert!(display.frame().row_text(0).is_empty());
                }
                Ok(())
            },
            |_| {},
            || {},
        )
        .unwrap();
        let displayed = display.frame();
        assert!(displayed.row_text(0).contains("OPS / UI"));
        assert!((0..size.height).any(|row| displayed.row_text(row).contains("SQUAD / AGENT")));
        assert_eq!(app.right_tab, crate::board::shell::RightTab::Checklist);
        assert!(app.input.is_some(), "the Talk draft stays open underneath");
    }

    /// Draws `text` in a 20x3 viewport with the caret at (2, 2) when `caret`.
    fn frame(
        terminal: &mut ratatui::Terminal<Backend<Sink>>,
        sink: &Sink,
        text: &str,
        caret: bool,
    ) -> String {
        sink.0.borrow_mut().clear();
        terminal
            .draw(|frame| {
                frame
                    .buffer_mut()
                    .set_string(0, 0, text, ratatui::style::Style::default());
                frame
                    .buffer_mut()
                    .set_string(0, 2, "> input", ratatui::style::Style::default());
                if caret {
                    frame.set_cursor_position((2, 2));
                }
            })
            .unwrap();
        String::from_utf8(sink.0.borrow().clone()).unwrap()
    }

    /// Draws "see docs now" with the span `docs` set, on a fresh viewport.
    fn linked(
        links: &super::super::hyperlinks::Links,
        area: ratatui::layout::Rect,
        url: &str,
    ) -> String {
        let sink = Sink::default();
        let mut terminal = ratatui::Terminal::with_options(
            Backend::with_links(sink.clone(), links.clone()),
            ratatui::TerminalOptions {
                viewport: ratatui::Viewport::Fixed(ratatui::layout::Rect::new(0, 0, 20, 3)),
            },
        )
        .unwrap();
        terminal
            .draw(|frame| {
                frame.buffer_mut().set_string(
                    0,
                    0,
                    "see docs now",
                    ratatui::style::Style::default(),
                );
                links.set(
                    super::super::hyperlinks::Span::new(area, url, 7)
                        .into_iter()
                        .collect(),
                );
            })
            .unwrap();
        String::from_utf8(sink.0.borrow().clone()).unwrap()
    }

    #[test]
    fn a_supported_link_label_is_wrapped_in_osc_8_and_the_text_around_it_is_not() {
        let links = super::super::hyperlinks::Links::default();
        links.enable(true);
        let area = ratatui::layout::Rect::new(4, 0, 4, 1);
        let out = linked(&links, area, "https://example.com/a?b=1");
        let open = out
            .find("\x1b]8;id=7;https://example.com/a?b=1\x1b\\")
            .expect("the link opens");
        let close = out.find("\x1b]8;;\x1b\\").expect("the link closes");
        let label = out.find("docs").expect("the label is written");
        assert!(open < label && label < close, "{out:?}");
        assert_eq!(out.matches("\x1b]8;").count(), 2, "{out:?}");
        // The words around the label are outside the pair.
        for plain in ["see", "now"] {
            let at = out.find(plain).unwrap();
            assert!(at < open || at > close, "{plain} inside the link: {out:?}");
        }
    }

    #[test]
    fn links_off_or_refused_add_no_byte_to_the_plain_backend() {
        let area = ratatui::layout::Rect::new(4, 0, 4, 1);
        let plain = linked(
            &super::super::hyperlinks::Links::default(),
            ratatui::layout::Rect::default(),
            "",
        );
        assert!(!plain.contains("\x1b]8"), "{plain:?}");
        // Off: the spans are ignored whatever the view hands over.
        let off = super::super::hyperlinks::Links::default();
        assert_eq!(linked(&off, area, "https://example.com/"), plain);
        // On, but nothing sets a span or the address is not http(s): the same bytes.
        let on = super::super::hyperlinks::Links::default();
        on.enable(true);
        for refused in [
            "",
            "mailto:a@example.com",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "https://example.com/\x1b]8;;\x07",
        ] {
            assert_eq!(linked(&on, area, refused), plain, "{refused:?}");
        }
    }

    #[test]
    fn idle_composer_frames_keep_cursor_visibility_and_place_it_once_per_update() {
        let sink = Sink::default();
        let mut terminal = ratatui::Terminal::with_options(
            Backend::new(sink.clone()),
            ratatui::TerminalOptions {
                viewport: ratatui::Viewport::Fixed(ratatui::layout::Rect::new(0, 0, 20, 3)),
            },
        )
        .unwrap();
        let first = frame(&mut terminal, &sink, "⠋", true);
        assert_eq!(first.matches("\x1b[?25h").count(), 1);
        for glyph in ["⠙", "⠹", "⠸"] {
            let update = frame(&mut terminal, &sink, glyph, true);
            assert!(update.starts_with("\x1b[?2026h"), "{update:?}");
            assert!(update.ends_with("\x1b[3;3H\x1b[?2026l"), "{update:?}");
            assert_eq!(update.matches("\x1b[3;3H").count(), 1);
            assert_eq!(update.matches("\x1b[?2026h").count(), 1);
            assert_eq!(update.matches("\x1b[?2026l").count(), 1);
            assert!(update.contains(glyph), "{update:?}");
            assert!(!update.contains("\x1b[?25"), "{update:?}");
            assert!(!update.contains("input"), "{update:?}");
            assert_eq!(frame(&mut terminal, &sink, glyph, true), "");
        }
        let unfocused = frame(&mut terminal, &sink, "⠸", false);
        assert_eq!(unfocused, "\x1b[?2026h\x1b[?25l\x1b[?2026l");
        assert_eq!(frame(&mut terminal, &sink, "⠸", false), "");
    }

    #[test]
    fn reasserting_the_mouse_sends_the_same_request_as_entering() {
        let mut sent = Vec::new();
        reassert_mouse(&mut sent).unwrap();
        let mut entered = Vec::new();
        execute!(&mut entered, EnableMouseCapture).unwrap();
        assert_eq!(sent, entered);
        let text = String::from_utf8(sent).unwrap();
        // Button and drag reports plus the SGR encoding the wheel arrives in.
        for mode in ["1000", "1002", "1006"] {
            assert!(text.contains(&format!("\x1b[?{mode}h")), "{text:?}");
        }
    }

    #[test]
    fn restore_runs_once_on_return_drop_and_panic() {
        let fake = Fake::default();
        let mut guard = Guard::enter(fake.clone()).unwrap();
        guard.restore().unwrap();
        drop(guard);
        assert_eq!(*fake.log.borrow(), ["enter", "leave"]);

        let fake = Fake::default();
        let inside = fake.clone();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let _guard = Guard::enter(inside).unwrap();
            panic!("board failure");
        }));
        assert!(result.is_err());
        assert_eq!(*fake.log.borrow(), ["enter", "leave"], "unwinding restores");
    }

    #[test]
    fn panic_restores_before_reporting_a_private_crash_note() {
        const CHILD: &str = "TMT_OPS_TEST_PANIC_NOTE_CHILD";
        if let Some(mode) = std::env::var_os(CHILD) {
            if mode == "unwritable" {
                let path = crate::cache::directory("crashes").unwrap();
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                std::fs::write(path, "a file, not a directory").unwrap();
            }
            restore_before_panic_reports();
            let _guard = Guard::enter(Crossterm::default()).unwrap();
            println!("Board raw mode entered");
            panic!("board panic note regression");
        }
        let root = crate::test_support::Scratch::new("panic-hook-test");
        let run = |mode: &str| {
            let log = root.join(format!("{mode}.log"));
            // Only the child sees this owned PTY. The parent verifies real
            // termios restoration before its finally block repairs/closes it.
            let status = std::process::Command::new("/usr/bin/python3")
                .args([
                    "-c",
                    r#"
import fcntl, os, pty, signal, subprocess, sys, termios
master, slave = pty.openpty()
before = termios.tcgetattr(slave)
# This wrapper owns the controlling terminal and stays alive while the
# panicking board child exits, so macOS does not revoke the slave before inspection.
os.setsid()
signal.signal(signal.SIGHUP, signal.SIG_IGN)
fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
try:
    with open(sys.argv[2], 'wb') as log:
        child = subprocess.run([sys.argv[1], '--exact',
            'board::terminal::tests::panic_restores_before_reporting_a_private_crash_note',
            '--nocapture'], stdin=slave, stdout=log, stderr=log,
            timeout=10)
    assert child.returncode != 0, child.returncode
    after = termios.tcgetattr(slave)
    # macOS sets PENDIN while reapplying cooked mode: pending input, not a
    # terminal mode owned by the board. All actual flags and control chars match.
    pending = getattr(termios, 'PENDIN', 0)
    before[3] &= ~pending
    after[3] &= ~pending
    assert after == before, ('panic left terminal modes changed', before, after)
finally:
    termios.tcsetattr(slave, termios.TCSANOW, before)
    os.close(slave)
    os.close(master)
"#,
                ])
                .arg(std::env::current_exe().unwrap())
                .arg(&log)
                .env(CHILD, mode)
                .env("TMPDIR", root.as_ref().as_os_str())
                .status()
                .unwrap();
            assert!(status.success(), "isolated panic/termios proof");
            std::fs::read_to_string(log).unwrap()
        };
        let text = run("saved");
        assert!(text.contains("Board raw mode entered"));
        let restored = text.find("\x1b[?1049l").expect("alternate screen restored");
        let reported = text.find("Ops crash note: ").expect("crash note reported");
        assert!(
            restored < reported,
            "path prints only after terminal restoration"
        );
        let path = text[reported..]
            .lines()
            .find_map(|line| line.strip_prefix("Ops crash note: "))
            .unwrap();
        let path = std::path::Path::new(path);
        assert!(path.is_absolute() && path.starts_with(&root));
        let note = std::fs::read_to_string(path).unwrap();
        assert!(note.contains("board panic note regression"));
        assert!(note.contains("terminal.rs:"));
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let failed = run("unwritable");
        assert!(failed.contains("Ops crash note unavailable:"), "{failed}");
        assert!(
            failed.contains("board panic note regression"),
            "original panic still reports: {failed}"
        );
        assert!(!failed.contains("panicked while processing panic"));
    }

    #[test]
    fn query_runs_inside_the_guard_and_failure_still_restores() {
        for fail_query in [false, true] {
            let fake = Fake {
                fail_query,
                ..Fake::default()
            };
            let mut guard = Guard::enter(fake.clone()).unwrap();
            assert_eq!(guard.query_background().is_err(), fail_query);
            drop(guard);
            assert_eq!(*fake.log.borrow(), ["enter", "query", "leave"]);
        }
    }

    #[test]
    fn suspend_restores_then_reenters_without_repeating_capability_queries() {
        for pause_failed in [false, true] {
            let fake = Fake::default();
            let log = fake.log.clone();
            let mut guard = Guard::enter(fake.clone()).unwrap();
            assert!(guard.enable_keyboard_enhancement().unwrap());
            let result = guard.suspend(|| {
                log.borrow_mut().push("pause");
                if pause_failed {
                    Err(io::Error::other("stop failed"))
                } else {
                    Ok(())
                }
            });
            assert_eq!(result.is_err(), pause_failed);
            drop(guard);
            assert_eq!(
                *fake.log.borrow(),
                ["enter", "keyboard", "leave", "pause", "enter", "leave"]
            );
        }
    }

    #[test]
    fn failed_keyboard_setup_and_resume_both_restore_partial_terminal_state() {
        let fake = Fake {
            fail_keyboard: true,
            ..Fake::default()
        };
        let mut guard = Guard::enter(fake.clone()).unwrap();
        assert!(guard.enable_keyboard_enhancement().is_err());
        drop(guard);
        assert_eq!(*fake.log.borrow(), ["enter", "keyboard", "leave"]);

        let fake = Fake::default();
        let mut guard = Guard::enter(fake.clone()).unwrap();
        guard.screen.fail_enter = true;
        assert!(guard.suspend(|| Ok(())).is_err());
        drop(guard);
        assert_eq!(*fake.log.borrow(), ["enter", "leave", "enter", "leave"]);
    }

    #[test]
    fn a_failed_entry_is_undone_and_reported() {
        let fake = Fake {
            fail_enter: true,
            ..Fake::default()
        };
        assert!(Guard::enter(fake.clone()).is_err());
        assert_eq!(*fake.log.borrow(), ["enter", "leave"]);
    }

    #[test]
    fn term_and_hup_are_recorded_for_the_exit_status() {
        let flag = stop_requested().unwrap();
        assert_eq!(stop_signal(&flag), None);
        signal_hook::low_level::raise(signal_hook::consts::SIGHUP).unwrap();
        assert_eq!(stop_signal(&flag), Some(signal_hook::consts::SIGHUP));
        signal_hook::low_level::raise(signal_hook::consts::SIGTERM).unwrap();
        assert_eq!(stop_signal(&flag), Some(signal_hook::consts::SIGTERM));
        assert_eq!(super::super::exit_status(stop_signal(&flag)), 143);
        assert_eq!(
            super::super::exit_status(Some(signal_hook::consts::SIGHUP)),
            129
        );
        assert_eq!(super::super::exit_status(None), 0);
    }
}
