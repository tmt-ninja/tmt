//! Explicit consent for commands that change the user's installation or
//! settings. A non-interactive run without --yes refuses; consent is never
//! assumed. The one prompt shared by setup and the extension commands.

use crate::{invocation::OutputMode, output::Failure};
use std::io::{self, BufRead, Write};
use tmt_cli_style::{Interaction, interaction::Mode};

pub struct Consent<'a> {
    /// Failure code when consent is required but cannot be asked.
    pub code: &'static str,
    /// The whole refusal message, in the caller's wording.
    pub refusal: &'a str,
    /// The yes/no question, without the "[y/N]" (or "[Y/n]") suffix.
    pub question: &'a str,
    /// What a decline prints.
    pub declined: &'a str,
}

/// Whether stdin and stderr can carry an interactive question.
pub fn interactive(mode: OutputMode) -> bool {
    Interaction::detect(mode.json).prompt() == Mode::Interactive
}

/// Asks on stderr only when stdin and stderr are terminals and output is not JSON.
pub fn ask(
    yes: bool,
    mode: OutputMode,
    consent: Consent<'_>,
    io_failure: impl Fn(io::Error) -> Failure,
) -> Result<bool, Failure> {
    ask_answering(yes, mode, consent, io_failure, false)
}

/// Like [`ask`], but Enter agrees; EOF never agrees.
pub fn ask_defaulting_yes(
    yes: bool,
    mode: OutputMode,
    consent: Consent<'_>,
    io_failure: impl Fn(io::Error) -> Failure,
) -> Result<bool, Failure> {
    ask_answering(yes, mode, consent, io_failure, true)
}

fn ask_answering(
    yes: bool,
    mode: OutputMode,
    consent: Consent<'_>,
    io_failure: impl Fn(io::Error) -> Failure,
    default_yes: bool,
) -> Result<bool, Failure> {
    if yes {
        return Ok(true);
    }
    ask_with(
        false,
        Interaction::detect(mode.json),
        consent,
        io_failure,
        default_yes,
        io::stdin().lock(),
        &mut tmt_cli_style::stream::stderr(),
    )
}

fn ask_with(
    yes: bool,
    interaction: Interaction,
    consent: Consent<'_>,
    io_failure: impl Fn(io::Error) -> Failure,
    default_yes: bool,
    input: impl BufRead,
    output: &mut impl Write,
) -> Result<bool, Failure> {
    if yes {
        return Ok(true);
    }
    if interaction.prompt() != Mode::Interactive {
        return Err(Failure::new(consent.code, consent.refusal, 1));
    }
    write!(output, "{}? {} ", consent.question, choices(default_yes))
        .and_then(|()| output.flush())
        .map_err(&io_failure)?;
    let accepted = read_answer(input, default_yes).map_err(&io_failure)?;
    if !accepted {
        writeln!(output, "{}", consent.declined).map_err(&io_failure)?;
    }
    Ok(accepted)
}

/// The capital letter is what Enter answers.
fn choices(default_yes: bool) -> &'static str {
    if default_yes { "[Y/n]" } else { "[y/N]" }
}

/// The most bytes of an answer read, counting its newline.
const ANSWER_LIMIT: u64 = 256;

/// The most bytes read past `ANSWER_LIMIT` to finish consuming a declined over-long line.
const DRAIN_LIMIT: u64 = 4096;

/// Reads one answer line and says whether it is `y` or `yes`, or, with `default_yes`, an empty
/// line ended by Enter (end of input is never an Enter). The answer counts only when its
/// newline or the end of input arrives within `ANSWER_LIMIT`: a read that used the whole limit
/// without either may be the prefix of a longer line, so it is declined. Only then is the rest
/// of that line consumed, up to its newline and at most `DRAIN_LIMIT` bytes, so it is not left
/// in the terminal for the shell to run after `tmt` exits. A terminal in canonical mode has
/// already delivered the whole line, so the drain waits for no new typing. Input after the
/// newline, and everything after a short answer, stays unread.
fn read_answer(mut input: impl BufRead, default_yes: bool) -> io::Result<bool> {
    let mut answer = Vec::new();
    io::Read::take(&mut input, ANSWER_LIMIT).read_until(b'\n', &mut answer)?;
    let complete = answer.last() == Some(&b'\n') || (answer.len() as u64) < ANSWER_LIMIT;
    if !complete {
        input.take(DRAIN_LIMIT).read_until(b'\n', &mut Vec::new())?;
        return Ok(false);
    }
    let enter = answer.last() == Some(&b'\n');
    Ok(
        match std::str::from_utf8(&answer)
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "y" | "yes" => true,
            "" => default_yes && enter,
            _ => false,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read};

    #[test]
    fn prompt_policy_controls_the_effect_and_uses_only_the_question_stream() {
        let base = Interaction {
            json: false,
            stdin: true,
            stdout: true,
            stderr: true,
            dumb: false,
        };
        let cases = [
            (base, false, b"yes\n".as_slice(), true, true),
            (
                Interaction {
                    stdout: false,
                    ..base
                },
                false,
                b"yes\n".as_slice(),
                true,
                true,
            ),
            (
                Interaction {
                    stderr: false,
                    ..base
                },
                false,
                b"yes\n".as_slice(),
                false,
                false,
            ),
            (
                Interaction {
                    stdin: false,
                    ..base
                },
                false,
                b"yes\n".as_slice(),
                false,
                false,
            ),
            (
                Interaction { json: true, ..base },
                false,
                b"yes\n".as_slice(),
                false,
                false,
            ),
            (
                Interaction { dumb: true, ..base },
                false,
                b"yes\n".as_slice(),
                true,
                true,
            ),
            (
                Interaction {
                    stderr: false,
                    ..base
                },
                true,
                b"".as_slice(),
                true,
                false,
            ),
            (base, false, b"no\n".as_slice(), false, true),
        ];
        for (interaction, yes, input, effect, question) in cases {
            let mut stderr = Vec::new();
            let result = ask_with(
                yes,
                interaction,
                Consent {
                    code: "TEST_CONSENT_REQUIRED",
                    refusal: "Not approved.",
                    question: "Proceed",
                    declined: "No change.",
                },
                |e| Failure::new("IO", e.to_string(), 1),
                false,
                Cursor::new(input),
                &mut stderr,
            );
            let applied = matches!(result, Ok(true));
            assert_eq!(applied, effect, "{interaction:?}");
            assert_eq!(!stderr.is_empty(), question, "{interaction:?}");
            if !effect && !question {
                let error = result.unwrap_err();
                assert_eq!(
                    (error.code.as_str(), error.status),
                    ("TEST_CONSENT_REQUIRED", 1)
                );
            }
            if question && !effect {
                assert_eq!(stderr, b"Proceed? [y/N] No change.\n");
            }
        }
    }

    #[test]
    fn default_yes_asks_on_stderr_but_eof_declines() {
        let interaction = Interaction {
            json: false,
            stdin: true,
            stdout: false,
            stderr: true,
            dumb: false,
        };
        for (input, accepted) in [(b"\n".as_slice(), true), (b"".as_slice(), false)] {
            let mut stderr = Vec::new();
            let result = ask_with(
                false,
                interaction,
                Consent {
                    code: "TEST",
                    refusal: "Refused",
                    question: "Proceed",
                    declined: "No change.",
                },
                |e| Failure::new("IO", e.to_string(), 1),
                true,
                Cursor::new(input),
                &mut stderr,
            )
            .unwrap();
            assert_eq!(result, accepted);
            assert!(stderr.starts_with(b"Proceed? [Y/n] "));
        }
    }

    fn affirmed(input: &[u8]) -> bool {
        read_answer(Cursor::new(input), false).unwrap()
    }

    #[test]
    fn a_complete_short_answer_is_read_by_its_text() {
        for answer in [
            "y\n",
            "yes\n",
            "Y\n",
            "YES\n",
            "  yes  \n",
            "yes\r\n",
            "yes",
            "y",
            " Yes ",
        ] {
            assert!(affirmed(answer.as_bytes()), "{answer:?}");
        }
        for answer in [
            "",
            "\n",
            "n\n",
            "no\n",
            "yess\n",
            "ye\n",
            "yes please\n",
            "yes no\n",
        ] {
            assert!(!affirmed(answer.as_bytes()), "{answer:?}");
        }
    }

    #[test]
    fn only_an_enter_agrees_by_default_and_the_prompt_says_so() {
        let by_default = |input: &[u8]| read_answer(Cursor::new(input), true).unwrap();
        for enter in ["\n", "\r\n", "  \n"] {
            assert!(by_default(enter.as_bytes()), "{enter:?}");
        }
        for answer in ["y\n", "YES\n", "yes", "y"] {
            assert!(by_default(answer.as_bytes()), "{answer:?}");
        }
        for answer in ["", "  ", "n\n", "no\n", "nope\n", "yess\n", "\u{ff}\n"] {
            assert!(!by_default(answer.as_bytes()), "{answer:?}");
        }
        let long = format!("{}\n", " ".repeat(400));
        assert!(
            !by_default(long.as_bytes()),
            "an over-limit line is declined"
        );
        assert!(!affirmed(b"\n"), "the default stays no unless asked");
        assert_eq!((choices(true), choices(false)), ("[Y/n]", "[y/N]"));
    }

    #[test]
    fn invalid_utf8_is_never_an_affirmative_answer() {
        assert!(!affirmed(b"y\xff\n"));
        assert!(!affirmed(b"\xffyes\n"));
    }

    /// The answer is bounded to 256 bytes with its newline. What follows the limit was never
    /// read, so a prefix that reads as `yes` proves nothing about the whole line.
    #[test]
    fn an_answer_that_exhausts_the_limit_without_ending_is_not_affirmative() {
        let padded = format!("yes{}", " ".repeat(253));
        assert_eq!(padded.len(), 256);
        assert!(!affirmed(padded.as_bytes()), "256 bytes, no newline");
        assert!(
            !affirmed(format!("{padded}NO\n").as_bytes()),
            "the line continues with NO"
        );
        assert!(
            !affirmed(format!("{padded}\n").as_bytes()),
            "the newline is byte 257"
        );
        assert!(
            !affirmed(format!("y{}\n", " ".repeat(400)).as_bytes()),
            "an over-limit line"
        );
    }

    /// What `read_answer` leaves unread, and its verdict.
    fn leftover(input: &[u8]) -> (bool, Vec<u8>) {
        let mut cursor = Cursor::new(input);
        let accepted = read_answer(&mut cursor, false).unwrap();
        let mut rest = Vec::new();
        cursor.read_to_end(&mut rest).unwrap();
        (accepted, rest)
    }

    /// An over-long answer is declined, and the rest of its line goes with it so the terminal does
    /// not hand it to the shell after `tmt` exits.
    #[test]
    fn a_declined_over_long_line_is_drained_to_its_newline() {
        let line = format!("yes{}rm -rf important\n", " ".repeat(300));
        let (accepted, rest) = leftover(format!("{line}next command\n").as_bytes());
        assert!(!accepted);
        assert_eq!(
            rest, b"next command\n",
            "only the over-long line is consumed"
        );
    }

    #[test]
    fn draining_stops_at_its_bound_without_a_newline() {
        let long = format!("yes{}", "x".repeat(10_000));
        let (accepted, rest) = leftover(long.as_bytes());
        assert!(!accepted);
        assert_eq!(
            rest.len(),
            long.len() - 256 - 4096,
            "256 answer bytes and at most 4096 drained bytes are read"
        );
    }

    #[test]
    fn a_short_answer_is_not_drained() {
        assert_eq!(leftover(b"yes\nnext\n"), (true, b"next\n".to_vec()));
        assert_eq!(leftover(b"no\nnext\n"), (false, b"next\n".to_vec()));
        let at_limit = format!("yes{}\nnext\n", " ".repeat(252));
        assert_eq!(leftover(at_limit.as_bytes()), (true, b"next\n".to_vec()));
    }

    #[test]
    fn a_failing_reader_is_an_error_not_an_answer() {
        struct Failing;
        impl Read for Failing {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                Err(io::Error::other("read failed"))
            }
        }
        let reader = io::BufReader::new(Failing);
        assert!(read_answer(reader, false).is_err());
    }

    #[test]
    fn an_answer_that_ends_within_the_limit_is_read_in_full() {
        let at_limit = format!("yes{}\n", " ".repeat(252));
        assert_eq!(at_limit.len(), 256);
        assert!(affirmed(at_limit.as_bytes()), "the newline is byte 256");
        let at_eof = format!("yes{}", " ".repeat(252));
        assert_eq!(at_eof.len(), 255);
        assert!(affirmed(at_eof.as_bytes()), "end of input before the limit");
    }
}
