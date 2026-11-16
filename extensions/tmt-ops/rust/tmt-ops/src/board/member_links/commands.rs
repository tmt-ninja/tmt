//! One explicit marker grammar for inert command mentions. Recognition never runs anything.
use pulldown_cmark::{CodeBlockKind, Event, Parser, Tag};
use std::ops::Range;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct Reference {
    pub range: Range<usize>,
    pub content: Range<usize>,
    pub shown: String,
}

/// Only the approved ASCII marker is recognized. `!!`, full-width punctuation and ordinary
/// shell fences stay ordinary text until their product contract is decided.
pub(in crate::board) fn command(shown: &str) -> Option<&str> {
    shown
        .strip_prefix("! ")
        .filter(|command| !command.trim().is_empty())
}

pub(in crate::board) fn scan(source: &str) -> Vec<Reference> {
    if !source.contains("! ") {
        return Vec::new();
    }
    let mut found = Vec::new();
    let mut fence = None;
    for (event, range) in Parser::new(source).into_offset_iter() {
        match event {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(_))) => {
                // A clipped or still-growing fence cannot stand for a complete command.
                let raw = &source[range.clone()];
                let opening = raw.lines().next().unwrap_or_default().trim_start();
                let marker = opening.chars().next().unwrap_or('`');
                let count = opening.chars().take_while(|c| *c == marker).count();
                let closing = raw.lines().last().unwrap_or_default().trim();
                fence = (raw.lines().count() >= 3
                    && closing.len() >= count
                    && closing.chars().all(|c| c == marker))
                .then_some(range);
            }
            Event::Start(Tag::CodeBlock(CodeBlockKind::Indented)) => fence = None,
            Event::End(pulldown_cmark::TagEnd::CodeBlock) => fence = None,
            Event::Text(_) if fence.is_some() => {
                let shown = source[range.clone()]
                    .strip_suffix('\n')
                    .unwrap_or(&source[range.clone()]);
                if command(shown).is_some() {
                    found.push(Reference {
                        range: fence.take().unwrap(),
                        content: range.start..range.start + shown.len(),
                        shown: shown.into(),
                    });
                }
            }
            Event::Code(_) => {
                let raw = &source[range.clone()];
                let ticks = raw.bytes().take_while(|byte| *byte == b'`').count();
                let shown = &raw[ticks..raw.len() - ticks];
                if command(shown).is_some() {
                    found.push(Reference {
                        content: range.start + ticks..range.end - ticks,
                        range,
                        shown: shown.into(),
                    });
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
    fn explicit_forms_preserve_exact_command_and_source_occurrences() {
        let source = "Try `! printf '%s' 'a b'` then `! printf '%s' 'a b'`.\n\n```sh\n! pwd\n```\n\n! echo hi\n";
        let found = scan(source);
        assert_eq!(found.len(), 3);
        for reference in &found {
            assert_eq!(&source[reference.content.clone()], reference.shown);
        }
        assert_eq!(found[0].shown, "! printf '%s' 'a b'");
        assert_eq!(found[1].shown, found[0].shown);
        assert_ne!(found[0].range, found[1].range);
        assert_eq!(&source[found[2].range.clone()], "```sh\n! pwd\n```");
        assert_eq!(command(&found[2].shown), Some("pwd"));
    }

    #[test]
    fn unmarked_fences_other_markers_and_prose_are_inert() {
        assert!(
            scan("`!! pwd` `！ pwd` `!`\n\n```bash\necho hi\n```\n\nPlease ! pwd now").is_empty()
        );
        assert!(scan("    ! pwd\n\n```sh\n! echo unfinished").is_empty());
        let found = scan("```\n! echo first\necho second\n```");
        assert_eq!(command(&found[0].shown), Some("echo first\necho second"));
    }
}
