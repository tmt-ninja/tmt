//! The one TMT command-line style: palette, marks, values, messages, lists,
//! detail views, tables and help. `design/cli-style.md` owns the
//! rules; this crate is their only implementation.
//!
//! It depends on no TMT crate, so core and every extension CLI render through
//! the same code. `CliOutput` selects an ordinary command's presentation;
//! rendering primitives use a [`Terminal`] decided for each stream. The default `table` feature enables
//! terminal tables and terminal-width detection; without it the terminal
//! width defaults to 80 columns unless a caller supplies one.

pub mod audit;
pub mod breakpoint;
#[cfg(feature = "table")]
pub mod detail;
pub mod foreign;
pub mod grid;
pub mod help;
pub mod interaction;
#[cfg(feature = "table")]
pub mod list;
pub mod mark;
pub mod message;
pub mod palette;
pub mod progress;
pub mod stream;
pub mod table;
pub mod theme;
pub mod value;

pub use anstyle::{AnsiColor, Effects};
pub use help::{
    CommandSpec, Example, HelpSection, OutputModes, Route, ShownExample, apply, command,
    command_with_sections, examples, frame, help_text, rendered_help, route, version_arg,
};
pub use interaction::{Interaction, Mode};
pub use palette::{Terminal, Token};
pub use theme::{Base, Depth, Paint, Role, Theme};

use std::io::{self, Write};

/// A command result must provide both presentations. Neither is a fallback for the other.
///
/// ```compile_fail
/// use tmt_cli_style::{Render, Terminal};
/// use std::io::{self, Write};
/// struct Incomplete;
/// impl Render for Incomplete {
///     fn human(&self, _: &mut dyn Write, _: &mut dyn Write, _: Terminal, _: Terminal) -> io::Result<()> { Ok(()) }
/// }
/// ```
pub trait Render {
    fn human(
        &self,
        stdout: &mut dyn Write,
        stderr: &mut dyn Write,
        stdout_terminal: Terminal,
        stderr_terminal: Terminal,
    ) -> io::Result<()>;
    fn json(&self, stdout: &mut dyn Write) -> io::Result<()>;
    /// A report may carry a partial result with a nonzero status.
    fn exit_status(&self) -> u8 {
        0
    }
}

impl<T: Render + ?Sized> Render for &T {
    fn human(
        &self,
        stdout: &mut dyn Write,
        stderr: &mut dyn Write,
        out: Terminal,
        err: Terminal,
    ) -> io::Result<()> {
        T::human(self, stdout, stderr, out, err)
    }
    fn json(&self, stdout: &mut dyn Write) -> io::Result<()> {
        T::json(self, stdout)
    }
    fn exit_status(&self) -> u8 {
        T::exit_status(self)
    }
}

/// A failure owns its existing exit status, independent of its presentation.
pub trait RenderFailure: Render {
    fn exit_status(&self) -> u8;
}

/// Invocation-scoped presentation owner for migrated ordinary commands.
pub struct CliOutput {
    json: bool,
}

impl CliOutput {
    pub fn new(json: bool) -> Self {
        Self { json }
    }

    pub fn finish<T: Render, E: RenderFailure>(&self, result: Result<T, E>) -> io::Result<u8> {
        let mut stdout = stream::stdout(self.json);
        let mut stderr = stream::stderr();
        let stdout_terminal = stdout.terminal();
        let stderr_terminal = stderr.terminal();
        self.finish_to(
            result,
            &mut stdout,
            &mut stderr,
            stdout_terminal,
            stderr_terminal,
        )
    }

    /// Inject streams and their presentation for deterministic boundary tests.
    pub fn finish_to<T: Render, E: RenderFailure>(
        &self,
        result: Result<T, E>,
        stdout: &mut dyn Write,
        stderr: &mut dyn Write,
        stdout_terminal: Terminal,
        stderr_terminal: Terminal,
    ) -> io::Result<u8> {
        match result {
            Ok(value) => {
                if self.json {
                    value.json(stdout)?;
                } else {
                    value.human(stdout, stderr, stdout_terminal, stderr_terminal)?;
                }
                Ok(value.exit_status())
            }
            Err(error) => {
                if self.json {
                    error.json(stdout)?;
                } else {
                    error.human(stdout, stderr, stdout_terminal, stderr_terminal)?;
                }
                Ok(RenderFailure::exit_status(&error))
            }
        }
    }
}

#[cfg(test)]
mod output_tests {
    use super::*;

    struct Good;
    struct Bad;
    struct Partial;
    impl Render for Good {
        fn human(
            &self,
            out: &mut dyn Write,
            _: &mut dyn Write,
            _: Terminal,
            _: Terminal,
        ) -> io::Result<()> {
            out.write_all(b"human\n")
        }
        fn json(&self, out: &mut dyn Write) -> io::Result<()> {
            out.write_all(b"{\"ok\":true}\n")
        }
    }
    impl Render for Bad {
        fn human(
            &self,
            _: &mut dyn Write,
            err: &mut dyn Write,
            _: Terminal,
            _: Terminal,
        ) -> io::Result<()> {
            err.write_all(b"error\n")
        }
        fn json(&self, out: &mut dyn Write) -> io::Result<()> {
            out.write_all(b"{\"error\":true}\n")
        }
    }
    impl RenderFailure for Bad {
        fn exit_status(&self) -> u8 {
            4
        }
    }

    impl Render for Partial {
        fn human(
            &self,
            out: &mut dyn Write,
            err: &mut dyn Write,
            ot: Terminal,
            et: Terminal,
        ) -> io::Result<()> {
            Good.human(out, err, ot, et)
        }
        fn json(&self, out: &mut dyn Write) -> io::Result<()> {
            Good.json(out)
        }
        fn exit_status(&self) -> u8 {
            5
        }
    }

    #[test]
    fn partial_report_is_printed_with_its_nonzero_status() {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let status = CliOutput::new(true)
            .finish_to::<_, Bad>(
                Ok(&Partial),
                &mut out,
                &mut err,
                Terminal::PLAIN,
                Terminal::PLAIN,
            )
            .unwrap();
        assert_eq!(status, 5);
        assert_eq!(out, b"{\"ok\":true}\n");
        assert!(err.is_empty());
    }

    #[test]
    fn owner_selects_one_presentation_stream_and_preserves_status() {
        for json in [false, true] {
            let owner = CliOutput::new(json);
            let (mut out, mut err) = (Vec::new(), Vec::new());
            assert_eq!(
                owner
                    .finish_to::<Good, Bad>(
                        Ok(Good),
                        &mut out,
                        &mut err,
                        Terminal::PLAIN,
                        Terminal::PLAIN
                    )
                    .unwrap(),
                0
            );
            assert_eq!(
                out,
                if json {
                    b"{\"ok\":true}\n".as_slice()
                } else {
                    b"human\n"
                }
            );
            assert!(err.is_empty());
            out.clear();
            assert_eq!(
                owner
                    .finish_to::<Good, Bad>(
                        Err(Bad),
                        &mut out,
                        &mut err,
                        Terminal::PLAIN,
                        Terminal::PLAIN
                    )
                    .unwrap(),
                4
            );
            assert_eq!(
                out,
                if json {
                    b"{\"error\":true}\n".as_slice()
                } else {
                    b""
                }
            );
            assert_eq!(err, if json { b"".as_slice() } else { b"error\n" });
        }
    }

    #[test]
    fn failed_json_write_does_not_publish_another_document() {
        struct Broken;
        impl Write for Broken {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::Error::other("closed"))
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let mut stderr = Vec::new();
        assert!(
            CliOutput::new(true)
                .finish_to::<Good, Bad>(
                    Ok(Good),
                    &mut Broken,
                    &mut stderr,
                    Terminal::PLAIN,
                    Terminal::PLAIN
                )
                .is_err()
        );
        assert!(stderr.is_empty());
    }
}
