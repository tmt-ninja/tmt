//! The hidden supervisor a built-in-host launch starts for one member. Stdout
//! carries one readiness line, `ready <program pid>`; failures go through the
//! shared error publisher on stderr, where the launcher reads them.

use crate::{invocation::OutputMode, output::Failure};
use std::{
    ffi::OsString,
    io::{self, Write},
    path::Path,
};
use tmt_adapters::pty::{Launch, protocol::Size, serve_process};

pub fn execute(
    directory: &Path,
    id: &str,
    cols: u16,
    rows: u16,
    program: Vec<OsString>,
    terminal: Option<crate::invocation::PtyTerminal>,
) -> io::Result<u8> {
    let Ok(size) = Size::new(cols, rows) else {
        return Failure::new(
            "PTY_SIZE_INVALID",
            "A terminal is 1 to 1000 columns and rows.",
            2,
        )
        .publish(OutputMode::default());
    };
    // An extra terminal (#5991) runs its shell in the member's launch directory, without
    // the variables that would make it look like the member or an agent.
    let (environment, terminal) = match terminal {
        None => (
            tmt_adapters::host::Host::pty_environment(directory, id),
            None,
        ),
        Some(terminal) => {
            if let Err(error) = std::env::set_current_dir(&terminal.directory) {
                return Failure::new(
                    "PTY_SERVE_FAILED",
                    "The member's launch directory could not be entered.",
                    1,
                )
                .caused_by(error)
                .publish(OutputMode::default());
            }
            (
                tmt_adapters::pty::terminal::environment(),
                Some(tmt_adapters::pty::TerminalOf {
                    owner: terminal.owner,
                    created_ms: terminal.created_ms,
                    member_alive: tmt_adapters::pty::terminal::member_alive(
                        terminal.member_pid,
                        terminal.member_start,
                    ),
                }),
            )
        }
    };
    let launch = Launch {
        directory: directory.to_path_buf(),
        id: id.to_owned(),
        size,
        program,
        environment,
        terminal,
    };
    let served = serve_process(launch, |program_pid| {
        let mut stdout = tmt_cli_style::stream::stdout(true);
        writeln!(stdout, "ready {program_pid}")?;
        stdout.flush()
    });
    match served {
        Ok(()) => Ok(0),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Failure::new(
            "PTY_MEMBER_RUNNING",
            "Another supervisor already serves this member.",
            1,
        )
        .caused_by(error)
        .publish(OutputMode::default()),
        Err(error) => Failure::new(
            "PTY_SERVE_FAILED",
            "The member supervisor could not run.",
            1,
        )
        .caused_by(error)
        .publish(OutputMode::default()),
    }
}
