//! Sanitized terminal output for display, with no terminal or I/O dependencies.

#[derive(Default)]
enum Escape {
    #[default]
    Text,
    Introducer,
    Csi,
    String,
    StringEnd,
}

/// Strips terminal escape sequences, C0/C1 controls and hidden formatting.
/// Keeps newline and joiners, and expands tabs to four spaces. Holds only
/// an incomplete UTF-8 scalar and the escape parser state across chunks.
#[derive(Default)]
pub struct OutputSanitizer {
    escape: Escape,
    utf8_tail: Vec<u8>,
}

impl OutputSanitizer {
    /// Append arbitrary bytes and return the newly available display text.
    pub fn push(&mut self, bytes: &[u8]) -> String {
        let mut pending = std::mem::take(&mut self.utf8_tail);
        let mut input = if pending.is_empty() {
            bytes
        } else {
            pending.extend_from_slice(bytes);
            &pending
        };
        let mut display = String::with_capacity(input.len());
        loop {
            match std::str::from_utf8(input) {
                Ok(text) => {
                    self.filter(text, &mut display);
                    return display;
                }
                Err(error) => {
                    let (valid, rest) = input.split_at(error.valid_up_to());
                    self.filter(
                        std::str::from_utf8(valid).expect("validated prefix"),
                        &mut display,
                    );
                    let Some(length) = error.error_len() else {
                        self.utf8_tail.extend_from_slice(rest);
                        return display;
                    };
                    self.filter("�", &mut display);
                    input = &rest[length..];
                }
            }
        }
    }

    fn filter(&mut self, text: &str, display: &mut String) {
        use Escape::*;
        for ch in text.chars() {
            self.escape = match self.escape {
                Text => match ch {
                    '\u{1b}' => Introducer,
                    '\u{9b}' => Csi,
                    '\u{90}' | '\u{98}' | '\u{9d}' | '\u{9e}' | '\u{9f}' => String,
                    _ => {
                        match ch {
                            '\t' => display.push_str("    "),
                            '\n' => display.push(ch),
                            ch if !ch.is_control() && !hidden_format(ch) => display.push(ch),
                            _ => {}
                        }
                        Text
                    }
                },
                Introducer => match ch {
                    '[' => Csi,
                    ']' | 'P' | 'X' | '^' | '_' => String,
                    _ => Text,
                },
                Csi if ('@'..='~').contains(&ch) => Text,
                Csi => Csi,
                String | StringEnd => match ch {
                    '\u{7}' | '\u{9c}' => Text,
                    '\\' if matches!(self.escape, StringEnd) => Text,
                    '\u{1b}' => StringEnd,
                    _ => String,
                },
            };
        }
    }
}

/// Sanitize a whole output buffer, including an incomplete final UTF-8 scalar.
pub fn sanitize_output(bytes: &[u8]) -> String {
    let mut sanitizer = OutputSanitizer::default();
    let mut display = sanitizer.push(bytes);
    if !sanitizer.utf8_tail.is_empty() {
        sanitizer.filter("�", &mut display);
    }
    display
}

fn hidden_format(character: char) -> bool {
    matches!(
        character,
        '\u{061c}'
            | '\u{180e}'
            | '\u{200b}'
            | '\u{200e}'..='\u{200f}'
            | '\u{202a}'..='\u{202e}'
            | '\u{2060}'..='\u{2064}'
            | '\u{2066}'..='\u{206f}'
            | '\u{feff}'
            | '\u{fff9}'..='\u{fffb}'
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_byte_boundary_keeps_escape_payloads_out_and_complete_glyphs_in() {
        let raw = "first\r\n\x1b]52;clipboard\x1bXstill-hidden\x1b\\\x1b[31m界\u{202e}\t\u{9d}hidden\u{9c}end";
        let mut text = String::new();
        let mut output = OutputSanitizer::default();
        for byte in raw.as_bytes() {
            text.push_str(&output.push(std::slice::from_ref(byte)));
        }
        assert_eq!(text, "first\n界    end");
        assert_eq!(text, sanitize_output(raw.as_bytes()));
        assert_eq!(sanitize_output(b"end\xe7"), "end�");
        assert_eq!(output.push(b"\xffnext"), "�next");
    }
}
