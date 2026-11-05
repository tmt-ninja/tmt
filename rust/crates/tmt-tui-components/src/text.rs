//! Inert single-line labels for role-grid components.

const ESC: char = '\u{1b}';
const BEL: char = '\u{7}';

/// Invisible Unicode format characters that can reorder or hide text: bidi
/// embeddings, overrides and isolates, directional marks, and zero-width and
/// word-joiner forms. Zero-width joiners (U+200C/U+200D) stay, because scripts
/// and emoji sequences need them to render correctly.
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

/// Removes escape sequences (CSI, OSC, DCS, SOS, PM, APC and two-byte ESC
/// forms, including their 8-bit C1 introducers), all other control
/// characters, and hidden bidi/format characters. Newlines are kept; tabs
/// become four spaces; CR is dropped.
pub fn sanitize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(character) = chars.next() {
        let introducer = match character {
            ESC => match chars.next() {
                Some('[') => Some('['),
                Some(']') => Some(']'),
                Some(kind @ ('P' | 'X' | '^' | '_')) => Some(kind),
                // Two-byte sequence (for example ESC 7): drop both.
                _ => None,
            },
            '\u{9b}' => Some('['),
            '\u{9d}' => Some(']'),
            '\u{90}' => Some('P'),
            '\u{98}' => Some('X'),
            '\u{9e}' => Some('^'),
            '\u{9f}' => Some('_'),
            '\n' => {
                out.push('\n');
                continue;
            }
            '\t' => {
                out.push_str("    ");
                continue;
            }
            other if other.is_control() || hidden_format(other) => continue,
            other => {
                out.push(other);
                continue;
            }
        };
        match introducer {
            // CSI ends at a final byte in @..~.
            Some('[') => {
                for next in chars.by_ref() {
                    if ('@'..='~').contains(&next) {
                        break;
                    }
                }
            }
            // String sequences end at BEL (OSC) or ST (ESC \ or U+9C).
            Some(_) => {
                while let Some(next) = chars.next() {
                    if next == BEL || next == '\u{9c}' {
                        break;
                    }
                    if next == ESC {
                        if chars.peek() == Some(&'\\') {
                            chars.next();
                        }
                        break;
                    }
                }
            }
            None => {}
        }
    }
    out
}

/// Sanitizes a metadata label without admitting a second display row.
pub fn single_line(text: &str) -> String {
    sanitize(text).replace(['\n', '\u{2028}', '\u{2029}'], " ")
}
