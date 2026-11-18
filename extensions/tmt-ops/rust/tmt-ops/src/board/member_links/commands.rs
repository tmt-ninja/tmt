//! Source ranges and verbatim bytes of inert command mentions.
use pulldown_cmark::{CodeBlockKind, Event, Parser, Tag};
use std::ops::Range;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(in crate::board) struct Command {
    pub shown: String,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct Reference {
    pub range: Range<usize>,
    pub content: Range<usize>,
    pub command: Command,
    pub console: bool,
}

fn marked(shown: &str) -> Option<&str> {
    shown
        .strip_prefix("! ")
        .or_else(|| shown.strip_prefix("！ "))
}

fn reference(
    range: Range<usize>,
    start: usize,
    shown: &str,
    text: &str,
    console: bool,
) -> Option<Reference> {
    (!text.trim().is_empty()).then(|| Reference {
        range,
        content: start..start + shown.len(),
        command: Command {
            shown: shown.into(),
            text: text.into(),
        },
        console,
    })
}

fn fence(source: &str, range: Range<usize>, found: &mut Vec<Reference>) {
    let raw = source[range.clone()].trim_end_matches(['\r', '\n']);
    let Some((opening, rest)) = raw.split_once('\n') else {
        return;
    };
    let Some((body, closing)) = rest.rsplit_once('\n') else {
        return;
    };
    let opening = opening.trim_start_matches(' ');
    let Some(marker @ ('`' | '~')) = opening.chars().next() else {
        return;
    };
    let count = opening.chars().take_while(|c| *c == marker).count();
    let closing = closing.trim_matches([' ', '\t']);
    if closing.len() < count || !closing.chars().all(|c| c == marker) {
        return;
    }
    let label = opening[count..]
        .split_ascii_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let body = body.strip_suffix('\r').unwrap_or(body);
    let start = range.start + raw.find('\n').unwrap() + 1;
    let range = range.start..range.start + raw.len();
    let console = matches!(label.as_str(), "console" | "shell-session");
    // Only the initial body marker designates an entire fence.
    if let Some(text) = marked(body) {
        found.extend(reference(range, start, body, text, false));
    } else if matches!(label.as_str(), "sh" | "bash" | "shell" | "zsh") {
        found.extend(reference(range, start, body, body, false));
    } else if console {
        let mut at = start;
        for line in body.split_inclusive('\n') {
            let shown = line.trim_end_matches(['\r', '\n']);
            if let Some(text) = shown.strip_prefix("$ ") {
                found.extend(reference(at..at + shown.len(), at, shown, text, true));
            }
            at += line.len();
        }
    }
}

pub(in crate::board) fn scan(source: &str) -> Vec<Reference> {
    let mut found = Vec::new();
    for (event, range) in Parser::new(source).into_offset_iter() {
        match event {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(_))) => {
                fence(source, range, &mut found)
            }
            Event::Code(_) => {
                let raw = &source[range.clone()];
                let ticks = raw.bytes().take_while(|byte| *byte == b'`').count();
                let shown = &raw[ticks..raw.len() - ticks];
                if let Some(text) = marked(shown) {
                    let start = range.start + ticks;
                    found.extend(reference(range, start, shown, text, false));
                }
            }
            _ => {}
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_mentions_preserve_utf8_ranges_and_command_bytes() {
        let fixtures: serde_json::Value =
            serde_json::from_str(include_str!("command-fixtures.json")).unwrap();
        for case in fixtures.as_array().unwrap() {
            let source = case["source"].as_str().unwrap();
            let actual: Vec<_> = scan(source)
                .into_iter()
                .map(|item| {
                    serde_json::json!({
                        "range": [item.range.start, item.range.end],
                        "content": [item.content.start, item.content.end],
                        "command": item.command.text,
                    })
                })
                .collect();
            assert_eq!(
                actual,
                *case["mentions"].as_array().unwrap(),
                "{}",
                case["name"]
            );
        }
    }
}
