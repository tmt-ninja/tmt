//! Core-internal controls, on the supervisor socket at protocol version 1.
//! These kinds are separate from the attach stream; they are not its public API.

use crate::{Exit, Frame, MAX_PAYLOAD, ProtocolError};

const INSPECT: u8 = 0x20;
const PUBLISH: u8 = 0x21;
const CLEAR: u8 = 0x22;
const CAPTURE: u8 = 0x23;
const PASTE: u8 = 0x24;
const ENTER: u8 = 0x25;
const AWAIT_LAUNCH: u8 = 0x26;
const LAUNCH_READY: u8 = 0x27;
const WAIT_LAUNCHER: u8 = 0x28;
const PUBLISH_IF: u8 = 0x29;
const CAPABILITIES: u8 = 0x2a;
const RESUME: u8 = 0x2b;
const RELAUNCH: u8 = 0x2c;
const CLOSE: u8 = 0x2d;
const TERMINAL: u8 = 0x2e;
const STATE: u8 = 0xa0;
const APPLIED: u8 = 0xa1;
const SCREEN: u8 = 0xa2;
const ERROR: u8 = 0xa3;
const LAUNCHED: u8 = 0xa4;
const CAPABILITY_FLAGS: u8 = 0xa5;
const TERMINAL_OWNER: u8 = 0xa6;
/// Bit 0 of the capability flags: the supervisor answers `Control::Resume`.
const RESUME_FLAG: u8 = 0x01;
/// Bit 1: the supervisor keeps its terminal after the program ends and answers
/// `Control::Relaunch`.
const RELAUNCH_FLAG: u8 = 0x02;
/// Bit 2: the supervisor answers `Control::Close`.
const CLOSE_FLAG: u8 = 0x04;
/// Bit 3: the supervisor serves one of a member's extra terminals and answers
/// `Control::Terminal`.
const TERMINAL_FLAG: u8 = 0x08;
/// An identity UUID and a start identity are short; this bounds a reply.
const OWNER_LIMIT: usize = 128;
/// At most this many program words in one relaunch.
const PROGRAM_WORDS: usize = 256;
const KEY_LIMIT: usize = 128;
const MARKER_LIMIT: usize = 2048;

/// One Core operation. Paste is not a real keystroke and never changes the size.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Control {
    Inspect,
    /// Ask which optional controls are supported. A supervisor that answers at
    /// all supports conditional publication; older ones reply `Applied(true)`,
    /// newer ones `ControlReply::Capabilities` with further flags.
    Capabilities,
    /// Legacy v1 publication frame, retained for existing clients.
    Publish {
        pane_pid: u32,
        key: String,
        marker: String,
    },
    /// Conditional publication; None expects an empty marker.
    PublishIf {
        pane_pid: u32,
        key: String,
        expected_key: Option<String>,
        marker: String,
    },
    Clear {
        key: String,
    },
    Capture,
    Paste(Vec<u8>),
    Enter,
    /// Wait for the managed wrapper to finish launch admission; output still flows.
    AwaitLaunch,
    /// Gate managed preparation until its launcher is listening for the result.
    WaitLauncher,
    /// A launch receipt, never binding or runtime authority.
    LaunchReady {
        pane_pid: u32,
    },
    /// Continue a member stopped by job control. Idempotent; a supervisor
    /// that predates it closes the connection on the unknown kind.
    Resume,
    /// Start a new program on the kept terminal of a member whose program has
    /// ended. Refused while a program runs; `kind` is recorded, not interpreted.
    Relaunch {
        kind: RelaunchKind,
        program: Vec<String>,
    },
    /// End the supervisor: hang up a running program, tell clients, remove the
    /// socket and lock. Idempotent from Core's side.
    Close,
    /// Ask an extra terminal whose it is and whether a program other than its
    /// shell runs there (#5991). A member supervisor closes the connection.
    Terminal,
}

/// What a relaunch starts. Only `Shell` changes what the supervisor reports:
/// a shell is not the member's agent, so it never takes the member's pane PID.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelaunchKind {
    Resume,
    New,
    Shell,
}

impl RelaunchKind {
    fn byte(self) -> u8 {
        match self {
            Self::Resume => 0,
            Self::New => 1,
            Self::Shell => 2,
        }
    }
}

/// A reply to the one outstanding control on a connection. Output can precede it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ControlReply {
    State {
        supervisor_pid: u32,
        pane_pid: u32,
        key_idle_ms: Option<u64>,
        marker: Option<String>,
        /// The member is stopped by job control. One trailing byte; a payload
        /// from a supervisor that predates it omits the byte and reads as false.
        paused: bool,
        /// How the member's program ended, while no program runs on the kept
        /// terminal. With `shell` and `relaunching`, a trailing group of seven
        /// bytes that older supervisors omit (read as none and false).
        ended: Option<Exit>,
        /// A relaunched shell, not the member's agent, holds the terminal.
        shell: bool,
        /// A relaunched agent launcher has not yet bound: `pane_pid` and
        /// `marker` are in transition, and the binding they replace is restored
        /// if the launcher ends first, so no reader may judge that binding lost.
        relaunching: bool,
    },
    Applied(bool),
    Screen(String),
    Error(String),
    /// The committed binding marker accompanying a managed-launch receipt.
    Launched(String),
    /// The answer to `Control::Capabilities` from a supervisor that has optional
    /// controls beyond conditional publication. One flag byte; unknown bits are
    /// ignored on read so later controls can add bits.
    Capabilities {
        resume: bool,
        relaunch: bool,
        close: bool,
        terminal: bool,
    },
    /// The answer to `Control::Terminal`: the identity UUID the terminal was
    /// opened for, when it started (Unix milliseconds), and whether the
    /// terminal's foreground job is not its shell.
    Terminal {
        owner: String,
        created_ms: u64,
        busy: bool,
    },
}

fn malformed() -> ProtocolError {
    ProtocolError::Malformed("invalid Core control payload")
}
fn take<'a>(bytes: &mut &'a [u8], length: usize) -> Result<&'a [u8], ProtocolError> {
    let (value, rest) = bytes.split_at_checked(length).ok_or_else(malformed)?;
    *bytes = rest;
    Ok(value)
}
fn string(bytes: &mut &[u8], limit: usize) -> Result<String, ProtocolError> {
    let size = u16::from_be_bytes(take(bytes, 2)?.try_into().unwrap()) as usize;
    if size > limit {
        return Err(ProtocolError::Oversized);
    }
    std::str::from_utf8(take(bytes, size)?)
        .map(str::to_owned)
        .map_err(|_| malformed())
}
fn put(out: &mut Vec<u8>, text: &str) {
    out.extend_from_slice(
        &u16::try_from(text.len())
            .expect("bounded control string")
            .to_be_bytes(),
    );
    out.extend_from_slice(text.as_bytes());
}
fn done(bytes: &[u8]) -> Result<(), ProtocolError> {
    if bytes.is_empty() {
        Ok(())
    } else {
        Err(malformed())
    }
}
fn nonempty(text: String) -> Result<String, ProtocolError> {
    if text.is_empty() {
        Err(malformed())
    } else {
        Ok(text)
    }
}

impl Frame for Control {
    fn kind(&self) -> u8 {
        match self {
            Self::Inspect => INSPECT,
            Self::Capabilities => CAPABILITIES,
            Self::Publish { .. } => PUBLISH,
            Self::PublishIf { .. } => PUBLISH_IF,
            Self::Clear { .. } => CLEAR,
            Self::Capture => CAPTURE,
            Self::Paste(_) => PASTE,
            Self::Enter => ENTER,
            Self::AwaitLaunch => AWAIT_LAUNCH,
            Self::WaitLauncher => WAIT_LAUNCHER,
            Self::LaunchReady { .. } => LAUNCH_READY,
            Self::Resume => RESUME,
            Self::Relaunch { .. } => RELAUNCH,
            Self::Close => CLOSE,
            Self::Terminal => TERMINAL,
        }
    }
    fn write_payload(&self, out: &mut Vec<u8>) {
        match self {
            Self::Publish {
                pane_pid,
                key,
                marker,
            } => {
                out.extend_from_slice(&pane_pid.to_be_bytes());
                put(out, key);
                put(out, marker);
            }
            Self::PublishIf {
                pane_pid,
                key,
                expected_key,
                marker,
            } => {
                out.extend_from_slice(&pane_pid.to_be_bytes());
                put(out, key);
                put(out, marker);
                put(out, expected_key.as_deref().unwrap_or(""));
            }
            Self::Clear { key } => put(out, key),
            Self::Paste(bytes) => out.extend_from_slice(bytes),
            Self::LaunchReady { pane_pid } => out.extend_from_slice(&pane_pid.to_be_bytes()),
            Self::Relaunch { kind, program } => {
                out.push(kind.byte());
                out.extend_from_slice(
                    &u16::try_from(program.len())
                        .expect("bounded program words")
                        .to_be_bytes(),
                );
                for word in program {
                    put(out, word);
                }
            }
            Self::Inspect
            | Self::Capabilities
            | Self::Capture
            | Self::Enter
            | Self::AwaitLaunch
            | Self::WaitLauncher
            | Self::Resume
            | Self::Close
            | Self::Terminal => {}
        }
    }
    fn read(kind: u8, mut bytes: &[u8]) -> Result<Self, ProtocolError> {
        let value = match kind {
            INSPECT => Self::Inspect,
            CAPABILITIES => Self::Capabilities,
            CAPTURE => Self::Capture,
            ENTER => Self::Enter,
            AWAIT_LAUNCH => Self::AwaitLaunch,
            WAIT_LAUNCHER => Self::WaitLauncher,
            RESUME => Self::Resume,
            CLOSE => Self::Close,
            TERMINAL => Self::Terminal,
            RELAUNCH => {
                let kind = match take(&mut bytes, 1)? {
                    [0] => RelaunchKind::Resume,
                    [1] => RelaunchKind::New,
                    [2] => RelaunchKind::Shell,
                    _ => return Err(malformed()),
                };
                let count = u16::from_be_bytes(take(&mut bytes, 2)?.try_into().unwrap()) as usize;
                if count == 0 || count > PROGRAM_WORDS {
                    return Err(malformed());
                }
                let mut program = Vec::with_capacity(count);
                for _ in 0..count {
                    program.push(string(&mut bytes, MAX_PAYLOAD)?);
                }
                if program[0].is_empty() {
                    return Err(malformed());
                }
                Self::Relaunch { kind, program }
            }
            LAUNCH_READY => {
                let pane_pid = u32::from_be_bytes(take(&mut bytes, 4)?.try_into().unwrap());
                if pane_pid == 0 {
                    return Err(malformed());
                }
                Self::LaunchReady { pane_pid }
            }
            PUBLISH | PUBLISH_IF => {
                let pane_pid = u32::from_be_bytes(take(&mut bytes, 4)?.try_into().unwrap());
                if pane_pid == 0 {
                    return Err(malformed());
                }
                let key = nonempty(string(&mut bytes, KEY_LIMIT)?)?;
                let marker = nonempty(string(&mut bytes, MARKER_LIMIT)?)?;
                if kind == PUBLISH {
                    Self::Publish {
                        pane_pid,
                        key,
                        marker,
                    }
                } else {
                    let expected = string(&mut bytes, KEY_LIMIT)?;
                    Self::PublishIf {
                        pane_pid,
                        key,
                        expected_key: (!expected.is_empty()).then_some(expected),
                        marker,
                    }
                }
            }
            CLEAR => Self::Clear {
                key: nonempty(string(&mut bytes, KEY_LIMIT)?)?,
            },
            PASTE => {
                if bytes.is_empty() || bytes.len() > MAX_PAYLOAD {
                    return Err(malformed());
                }
                let value = Self::Paste(bytes.to_vec());
                bytes = &[];
                value
            }
            other => return Err(ProtocolError::UnknownKind(other)),
        };
        done(bytes)?;
        Ok(value)
    }
}
impl Frame for ControlReply {
    fn kind(&self) -> u8 {
        match self {
            Self::State { .. } => STATE,
            Self::Applied(_) => APPLIED,
            Self::Screen(_) => SCREEN,
            Self::Error(_) => ERROR,
            Self::Launched(_) => LAUNCHED,
            Self::Capabilities { .. } => CAPABILITY_FLAGS,
            Self::Terminal { .. } => TERMINAL_OWNER,
        }
    }
    fn write_payload(&self, out: &mut Vec<u8>) {
        match self {
            Self::State {
                supervisor_pid,
                pane_pid,
                key_idle_ms,
                marker,
                paused,
                ended,
                shell,
                relaunching,
            } => {
                out.extend_from_slice(&supervisor_pid.to_be_bytes());
                out.extend_from_slice(&pane_pid.to_be_bytes());
                out.extend_from_slice(&key_idle_ms.unwrap_or(u64::MAX).to_be_bytes());
                put(out, marker.as_deref().unwrap_or(""));
                out.push(u8::from(*paused));
                let (tag, value) = match ended {
                    None => (0u8, 0),
                    Some(Exit::Code(code)) => (1, *code),
                    Some(Exit::Signal(signal)) => (2, *signal),
                };
                out.push(tag);
                out.extend_from_slice(&value.to_be_bytes());
                out.push(u8::from(*shell));
                out.push(u8::from(*relaunching));
            }
            Self::Applied(value) => out.push(u8::from(*value)),
            Self::Capabilities {
                resume,
                relaunch,
                close,
                terminal,
            } => out.push(
                [
                    (resume, RESUME_FLAG),
                    (relaunch, RELAUNCH_FLAG),
                    (close, CLOSE_FLAG),
                    (terminal, TERMINAL_FLAG),
                ]
                .into_iter()
                .filter(|(granted, _)| **granted)
                .fold(0, |flags, (_, bit)| flags | bit),
            ),
            Self::Terminal {
                owner,
                created_ms,
                busy,
            } => {
                put(out, owner);
                out.extend_from_slice(&created_ms.to_be_bytes());
                out.push(u8::from(*busy));
            }
            Self::Screen(text) | Self::Error(text) | Self::Launched(text) => {
                out.extend_from_slice(text.as_bytes())
            }
        }
    }
    fn read(kind: u8, mut bytes: &[u8]) -> Result<Self, ProtocolError> {
        let value = match kind {
            STATE => {
                let supervisor_pid = u32::from_be_bytes(take(&mut bytes, 4)?.try_into().unwrap());
                let pane_pid = u32::from_be_bytes(take(&mut bytes, 4)?.try_into().unwrap());
                if supervisor_pid == 0 || pane_pid == 0 {
                    return Err(malformed());
                }
                let idle = u64::from_be_bytes(take(&mut bytes, 8)?.try_into().unwrap());
                let marker = string(&mut bytes, MARKER_LIMIT)?;
                // Each later field is a trailing group an older supervisor omits.
                let flag = |byte: u8| match byte {
                    0 => Ok(false),
                    1 => Ok(true),
                    _ => Err(malformed()),
                };
                let (paused, ended, shell, relaunching) = match bytes {
                    [] => (false, None, false, false),
                    [paused] => (flag(*paused)?, None, false, false),
                    [paused, tag, a, b, c, d, shell, relaunching] => {
                        let value = i32::from_be_bytes([*a, *b, *c, *d]);
                        let ended = match (tag, value) {
                            (0, 0) => None,
                            (1, code) => Some(Exit::Code(code)),
                            (2, signal) => Some(Exit::Signal(signal)),
                            _ => return Err(malformed()),
                        };
                        (flag(*paused)?, ended, flag(*shell)?, flag(*relaunching)?)
                    }
                    _ => return Err(malformed()),
                };
                bytes = &[];
                Self::State {
                    supervisor_pid,
                    pane_pid,
                    key_idle_ms: (idle != u64::MAX).then_some(idle),
                    marker: (!marker.is_empty()).then_some(marker),
                    paused,
                    ended,
                    shell,
                    relaunching,
                }
            }
            APPLIED => {
                let answer = match take(&mut bytes, 1)? {
                    [0] => false,
                    [1] => true,
                    _ => return Err(malformed()),
                };
                Self::Applied(answer)
            }
            CAPABILITY_FLAGS => {
                let [flags] = take(&mut bytes, 1)? else {
                    unreachable!("take returns exactly one byte")
                };
                Self::Capabilities {
                    resume: flags & RESUME_FLAG != 0,
                    relaunch: flags & RELAUNCH_FLAG != 0,
                    close: flags & CLOSE_FLAG != 0,
                    terminal: flags & TERMINAL_FLAG != 0,
                }
            }
            TERMINAL_OWNER => {
                let owner = nonempty(string(&mut bytes, OWNER_LIMIT)?)?;
                let created_ms = u64::from_be_bytes(take(&mut bytes, 8)?.try_into().unwrap());
                let busy = match take(&mut bytes, 1)? {
                    [0] => false,
                    [1] => true,
                    _ => return Err(malformed()),
                };
                Self::Terminal {
                    owner,
                    created_ms,
                    busy,
                }
            }
            LAUNCHED => {
                if bytes.len() > MARKER_LIMIT {
                    return Err(ProtocolError::Oversized);
                }
                let marker = std::str::from_utf8(bytes)
                    .map_err(|_| malformed())?
                    .to_owned();
                bytes = &[];
                Self::Launched(nonempty(marker)?)
            }
            SCREEN | ERROR => {
                let limit = if kind == SCREEN { MAX_PAYLOAD } else { 256 };
                if bytes.len() > limit {
                    return Err(ProtocolError::Oversized);
                }
                let text = std::str::from_utf8(bytes)
                    .map_err(|_| malformed())?
                    .to_owned();
                bytes = &[];
                if kind == SCREEN {
                    Self::Screen(text)
                } else {
                    Self::Error(nonempty(text)?)
                }
            }
            other => return Err(ProtocolError::UnknownKind(other)),
        };
        done(bytes)?;
        Ok(value)
    }
}
