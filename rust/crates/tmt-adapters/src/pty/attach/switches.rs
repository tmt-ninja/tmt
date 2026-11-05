//! The member's screen switches never reach the outer terminal (#5614 G2). The CLI keeps
//! that terminal on its own alternate screen; a member that enters or leaves its alternate
//! screen would otherwise move the outer one, showing the user's shell where the member's
//! normal screen belongs. Only DEC private mode sets and resets naming 47, 1047 or 1049
//! are touched; every other byte passes through unchanged.

/// Mode numbers that switch screens.
const SWITCHES: [&[u8]; 3] = [b"47", b"1047", b"1049"];

/// An unfinished `ESC [ ?` sequence longer than this is not a mode change worth holding.
const MAX_HELD: usize = 32;

/// A matcher that holds an unfinished `ESC [ ? Pn ; …` prefix across reads.
#[derive(Default)]
pub(super) struct Switches {
    held: Vec<u8>,
}

impl Switches {
    /// Appends `bytes` to `out` without screen switches. Returns whether one was removed.
    pub(super) fn filter(&mut self, bytes: &[u8], out: &mut Vec<u8>) -> bool {
        let mut removed = false;
        for &byte in bytes {
            removed |= self.byte(byte, out);
        }
        removed
    }

    /// A snapshot supersedes whatever an unfinished sequence would have done.
    pub(super) fn reset(&mut self) {
        self.held.clear();
    }

    /// Releases a held prefix unchanged, for the end of a snapshot.
    pub(super) fn flush(&mut self, out: &mut Vec<u8>) {
        out.append(&mut self.held);
    }

    fn byte(&mut self, byte: u8, out: &mut Vec<u8>) -> bool {
        let fits = match self.held.len() {
            0 => byte == 0x1b,
            1 => byte == b'[',
            2 => byte == b'?',
            n => n < MAX_HELD && (byte.is_ascii_digit() || byte == b';'),
        };
        if fits {
            self.held.push(byte);
            return false;
        }
        if self.held.len() >= 3 && matches!(byte, b'h' | b'l') {
            return self.finish(byte, out);
        }
        // Not a mode change: release what was held, then look at this byte afresh.
        let held = !self.held.is_empty();
        self.flush(out);
        if held {
            return self.byte(byte, out);
        }
        out.push(byte);
        false
    }

    fn finish(&mut self, end: u8, out: &mut Vec<u8>) -> bool {
        let params = &self.held[3..];
        let kept: Vec<&[u8]> = params
            .split(|b| *b == b';')
            .filter(|param| !SWITCHES.contains(param))
            .collect();
        let removed = kept.len() != params.split(|b| *b == b';').count();
        if !removed {
            out.extend_from_slice(&self.held);
            out.push(end);
        } else if !kept.is_empty() {
            out.extend_from_slice(b"\x1b[?");
            out.extend_from_slice(&kept.join(&b';'));
            out.push(end);
        }
        self.held.clear();
        removed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn whole(bytes: &[u8]) -> (Vec<u8>, bool) {
        let mut out = Vec::new();
        let mut switches = Switches::default();
        let removed = switches.filter(bytes, &mut out);
        switches.flush(&mut out);
        (out, removed)
    }

    #[test]
    fn screen_switches_are_removed_even_when_split_at_every_byte() {
        let stream = b"NORMAL\x1b[?1049hALT\x1b[?1049l\x1b[?47h\x1b[?1047lend";
        let expected = b"NORMALALTend".to_vec();
        assert_eq!(whole(stream), (expected.clone(), true));
        for cut in 1..stream.len() {
            let mut out = Vec::new();
            let mut switches = Switches::default();
            let first = switches.filter(&stream[..cut], &mut out);
            let second = switches.filter(&stream[cut..], &mut out);
            switches.flush(&mut out);
            assert_eq!(out, expected, "split at {cut}");
            assert!(first || second, "split at {cut}");
        }
    }

    #[test]
    fn other_private_modes_and_sequences_pass_through_byte_for_byte() {
        for bytes in [
            &b"\x1b[?25l\x1b[?1h\x1b[?2004h\x1b[?1000;1006h"[..],
            b"\x1b[?10490h\x1b[?147l\x1b[?104h",
            b"\x1b[1049h\x1b[2J\x1b[31mred\x1b[0m",
            b"\x1b]0;title\x07\x1b=\x1b>",
            b"\x1b\x1b[?1h\x1b[?",
            b"\x1b[?1049x\x1b[?1049",
            b"plain \xff\0 bytes",
        ] {
            assert_eq!(whole(bytes), (bytes.to_vec(), false), "{bytes:?}");
        }
    }

    #[test]
    fn a_combined_mode_change_keeps_its_other_modes() {
        assert_eq!(
            whole(b"\x1b[?1049;25h\x1b[?25;47;1h"),
            (b"\x1b[?25h\x1b[?25;1h".to_vec(), true)
        );
    }

    #[test]
    fn a_reset_drops_an_unfinished_sequence() {
        let mut out = Vec::new();
        let mut switches = Switches::default();
        switches.filter(b"a\x1b[?10", &mut out);
        switches.reset();
        switches.filter(b"49hb", &mut out);
        assert_eq!(out, b"a49hb");
    }
}
