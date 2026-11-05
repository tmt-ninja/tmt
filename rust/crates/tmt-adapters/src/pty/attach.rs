//! A finite interactive relay. The CLI owns terminal modes; this owner waits on
//! input, the existing supervisor connection and invocation-owned signal wakes.
//! No input thread, scrollback replay, terminal-window resize or member signal exists.

use super::{
    Connection,
    protocol::{ClientMessage, Eviction, Exit, ServerMessage, Size},
};
use nix::{
    errno::Errno,
    poll::{PollFd, PollFlags, PollTimeout, poll},
};
use signal_hook::{
    SigId,
    consts::{SIGHUP, SIGINT, SIGQUIT, SIGTERM, SIGWINCH},
    flag, low_level,
};
use std::{
    io::{self, Read, Write},
    os::{fd::AsFd, unix::net::UnixStream},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachEnd {
    Detached,
    Exited(Exit),
    Evicted(Eviction),
    Signal(i32),
}

/// Install before acquiring raw mode; retain until after terminal restoration.
/// Signal-hook registrations are invocation-exclusive (like InteractiveChild),
/// not suitable for a long-lived embedded service. SIGKILL cannot be restored.
pub struct AttachSignals {
    reader: UnixStream,
    resized: Arc<AtomicBool>,
    stopped: Arc<AtomicUsize>,
    registrations: Vec<SigId>,
}

impl AttachSignals {
    pub fn install() -> io::Result<Self> {
        let (reader, writer) = UnixStream::pair()?;
        reader.set_nonblocking(true)?;
        writer.set_nonblocking(true)?;
        let mut guard = Self {
            reader,
            resized: Arc::new(AtomicBool::new(false)),
            stopped: Arc::new(AtomicUsize::new(0)),
            registrations: Vec::new(),
        };
        guard
            .registrations
            .push(flag::register(SIGWINCH, guard.resized.clone())?);
        guard
            .registrations
            .push(low_level::pipe::register(SIGWINCH, writer.try_clone()?)?);
        for signal in [SIGTERM, SIGHUP, SIGINT, SIGQUIT] {
            guard.registrations.push(flag::register_usize(
                signal,
                guard.stopped.clone(),
                signal as usize,
            )?);
            guard
                .registrations
                .push(low_level::pipe::register(signal, writer.try_clone()?)?);
        }
        Ok(guard)
    }

    fn drain(&mut self) -> io::Result<()> {
        let mut bytes = [0u8; 128];
        loop {
            match self.reader.read(&mut bytes) {
                Ok(0) => return Err(io::Error::other("attach signal notification closed")),
                Ok(_) => {}
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => return Ok(()),
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                Err(e) => return Err(e),
            }
        }
    }
}

impl Drop for AttachSignals {
    fn drop(&mut self) {
        for registration in self.registrations.drain(..).rev() {
            low_level::unregister(registration);
        }
    }
}

const MAX_INITIAL_SCREEN: usize = 1024 * 1024;
const CLEAR_SCREEN: &[u8] = b"\x1b[0m\x1b[2J\x1b[H";

/// The supervisor orders the requested screen between prior and later Output.
/// Keep only a byte count, never an aggregate screen buffer.
enum Paint {
    Waiting,
    Painting(usize),
    Discarding,
    Live,
}

/// The relay's view of the member's screen. A snapshot paints the first screen, and later
/// ones repaint it (#5614): after the member switches screens, whose switch never reaches
/// the outer terminal, and when the size in force returns to this terminal's after another
/// client had changed it. One request is outstanding at a time; a repaint asked for while
/// one is under way follows it.
struct Screen {
    paint: Paint,
    switches: Switches,
    /// The size this relay last asked for: the local terminal's.
    local: Size,
    /// Another client's size is in force, so what is painted is drawn for that size.
    away: bool,
    /// The first snapshot taken at another client's size was asked for again once.
    retried: bool,
    outstanding: bool,
    again: bool,
    /// Frames to send, in order, after the current one is handled.
    requests: Vec<ClientMessage>,
}

impl Screen {
    fn new(local: Size) -> Self {
        Self {
            paint: Paint::Waiting,
            switches: Switches::default(),
            local,
            away: false,
            retried: false,
            outstanding: true,
            again: false,
            requests: Vec::new(),
        }
    }

    fn resized_locally(&mut self, size: Size) {
        self.local = size;
        self.requests.push(ClientMessage::Resize(size));
    }

    fn repaint(&mut self) {
        if self.outstanding {
            self.again = true;
        } else {
            self.outstanding = true;
            self.requests.push(ClientMessage::Snapshot);
        }
    }

    fn frame(&mut self, message: &ServerMessage, output: &mut impl Write) -> io::Result<bool> {
        let mut bytes = Vec::new();
        match message {
            ServerMessage::SnapshotStart => {
                // A second start discards a snapshot not yet complete.
                self.switches.reset();
                output.write_all(CLEAR_SCREEN)?;
                self.paint = Paint::Painting(0);
            }
            ServerMessage::SnapshotData(data) => match self.paint {
                Paint::Painting(written) if data.len() <= MAX_INITIAL_SCREEN - written => {
                    self.switches.filter(data, &mut bytes);
                    output.write_all(&bytes)?;
                    self.paint = Paint::Painting(written + data.len());
                }
                Paint::Painting(_) => {
                    // A pathological screen must not fail attachment or leave a
                    // misleading partial view. Drain the rest, then follow live.
                    output.write_all(CLEAR_SCREEN)?;
                    self.switches.reset();
                    self.paint = Paint::Discarding;
                }
                Paint::Discarding => {}
                _ => return Err(invalid_screen()),
            },
            ServerMessage::SnapshotEnd(size) => {
                if !matches!(self.paint, Paint::Painting(_) | Paint::Discarding) {
                    return Err(invalid_screen());
                }
                self.switches.flush(&mut bytes);
                output.write_all(&bytes)?;
                self.paint = Paint::Live;
                self.outstanding = false;
                self.away = *size != self.local;
                if self.away && !self.retried {
                    // Another client resized between this relay's Resize and its
                    // Snapshot. Ask once more; after that, wait for the size to return.
                    // The Resized this answers with is this relay's own size, not a return.
                    self.retried = true;
                    self.again = false;
                    self.away = false;
                    self.requests.push(ClientMessage::Resize(self.local));
                    self.repaint();
                } else if std::mem::take(&mut self.again) {
                    self.repaint();
                }
            }
            ServerMessage::Output(data) => match self.paint {
                Paint::Waiting => {} // The requested screen supersedes these bytes.
                Paint::Live => {
                    if self.switches.filter(data, &mut bytes) {
                        self.repaint();
                    }
                    output.write_all(&bytes)?;
                }
                _ => return Err(invalid_screen()),
            },
            ServerMessage::Resized(size) => {
                let back = self.away && *size == self.local;
                self.away = *size != self.local;
                if back {
                    self.repaint();
                }
            }
            _ => return Ok(false),
        }
        Ok(true)
    }
}

fn invalid_screen() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "unexpected initial-screen frame",
    )
}

/// Runs until detach, exit, eviction, signal or transport failure. Raw output is
/// written without parsing or styling, except that the member's screen switches are
/// kept out of the outer terminal ([`Switches`]). Only the detach byte is consumed locally.
/// `size` reads the current local terminal and clamps it before any Resize frame.
pub fn attach(
    connection: &mut Connection,
    input: &impl AsFd,
    output: &mut impl Write,
    signals: &mut AttachSignals,
    detach_others: bool,
    mut size: impl FnMut() -> io::Result<Size>,
) -> io::Result<AttachEnd> {
    let local = size()?;
    connection.send(&ClientMessage::Resize(local))?;
    if detach_others {
        connection.send(&ClientMessage::TakeSole)?;
    }
    connection.send(&ClientMessage::Snapshot)?;
    let mut screen = Screen::new(local);
    loop {
        let signal = signals.stopped.load(Ordering::SeqCst);
        if signal != 0 {
            return Ok(AttachEnd::Signal(signal as i32));
        }
        if signals.resized.swap(false, Ordering::SeqCst) {
            screen.resized_locally(size()?);
        }
        for request in screen.requests.drain(..) {
            connection.send(&request)?;
        }
        // Fairness: a continuously writing program cannot starve Ctrl-\ or a
        // signal. If decoded frames remain, poll without blocking this round.
        let mut saturated = true;
        for _ in 0..64 {
            let message = connection.receive_available()?;
            if let Some(message) = &message
                && screen.frame(message, output)?
            {
                for request in screen.requests.drain(..) {
                    connection.send(&request)?;
                }
                continue;
            }
            match message {
                Some(ServerMessage::Exited(exit)) => {
                    output.flush()?;
                    return Ok(AttachEnd::Exited(exit));
                }
                Some(ServerMessage::Evicted(reason)) => {
                    output.flush()?;
                    return Ok(AttachEnd::Evicted(reason));
                }
                Some(_) => {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "unexpected attach frame",
                    ));
                }
                None => {
                    saturated = false;
                    break;
                }
            }
        }
        output.flush()?;
        let mut ready = [
            PollFd::new(input.as_fd(), PollFlags::POLLIN),
            PollFd::new(connection.descriptor(), PollFlags::POLLIN),
            PollFd::new(signals.reader.as_fd(), PollFlags::POLLIN),
        ];
        match poll(
            &mut ready,
            if saturated {
                PollTimeout::ZERO
            } else {
                PollTimeout::NONE
            },
        ) {
            Err(Errno::EINTR) => continue,
            Err(e) => return Err(e.into()),
            Ok(_) => {}
        }
        let input_ready = ready[0].revents().unwrap_or_else(PollFlags::empty);
        let signal_ready = ready[2].revents().unwrap_or_else(PollFlags::empty);
        if signal_ready.intersects(PollFlags::POLLIN | PollFlags::POLLHUP | PollFlags::POLLERR) {
            signals.drain()?;
            continue;
        }
        if input_ready.intersects(PollFlags::POLLERR | PollFlags::POLLNVAL) {
            return Err(io::Error::other("attach input is unavailable"));
        }
        if input_ready.intersects(PollFlags::POLLIN | PollFlags::POLLHUP) {
            let mut bytes = [0u8; 4096];
            let count = match nix::unistd::read(input.as_fd(), &mut bytes) {
                Ok(n) => n,
                Err(Errno::EINTR) => continue,
                Err(e) => return Err(e.into()),
            };
            if count == 0 {
                connection.send(&ClientMessage::Detach)?;
                return Ok(AttachEnd::Detached);
            }
            if forward_input(connection, &bytes[..count])? {
                return Ok(AttachEnd::Detached);
            }
        }
    }
}

fn forward_input(connection: &mut Connection, bytes: &[u8]) -> io::Result<bool> {
    let detach = bytes.iter().position(|b| *b == 0x1c);
    let before = &bytes[..detach.unwrap_or(bytes.len())];
    if !before.is_empty() {
        connection.input(before)?;
    }
    if detach.is_some() {
        connection.send(&ClientMessage::Detach)?;
    }
    Ok(detach.is_some())
}

mod switches;
use switches::Switches;

#[cfg(test)]
mod tests;
